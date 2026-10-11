import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  pool,
  body,
  json,
  ApiError,
} from "../../packages/shared-config/runtime.ts";
const services = [
  "identity",
  "profile-discovery",
  "commerce-operations",
] as const;
type Forward = (
  service: string,
  path: string,
  options?: RequestInit,
) => Promise<unknown>;
export async function recoveryRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  actor: { id: string; reauthenticatedAt?: string },
  role: string,
  forward: Forward,
) {
  if (path !== "/api/v1/admin/recovery") return false;
  if (role !== "admin")
    throw new ApiError(
      403,
      "ADMIN_REQUIRED",
      "Recovery is restricted to authorised administrators.",
    );
  if (req.method === "GET") {
    const results = await Promise.allSettled(
      services.map(async (service) => {
        if (service !== "commerce-operations")
          return (
            (await forward(service, "/internal/recovery")) as {
              jobs: unknown[];
            }
          ).jobs;
        return (
          await pool.query(
            `SELECT id,'commerce-operations' AS service,'review delivery' AS kind,attempts,created_at AS "createdAt",last_error AS "lastError" FROM review_audit WHERE status='needs_attention' AND review_version IS NOT NULL ORDER BY created_at LIMIT 50`,
          )
        ).rows;
      }),
    );
    const jobs: unknown[] = [],
      unavailable: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") jobs.push(...r.value);
      else unavailable.push(services[i]);
    });
    const audit = await pool.query(
      `SELECT request_id AS "requestId",service,job_id AS "jobId",reason,status,created_at AS "createdAt" FROM recovery_actions WHERE actor_id=$1 ORDER BY created_at DESC LIMIT 50`,
      [actor.id],
    );
    json(res, 200, { jobs, unavailable, audit: audit.rows });
    return true;
  }
  if (req.method !== "POST")
    throw new ApiError(405, "METHOD_NOT_ALLOWED", "Use GET or POST.");
  if (
    !actor.reauthenticatedAt ||
    Date.now() - Date.parse(actor.reauthenticatedAt) > 600000
  )
    throw new ApiError(
      401,
      "REAUTHENTICATION_REQUIRED",
      "Sign in again before retrying an exhausted job.",
    );
  const input = z
    .object({
      requestId: z.string().uuid(),
      service: z.enum(services),
      jobId: z.string().uuid(),
      reason: z.string().trim().min(10).max(500),
    })
    .strict()
    .parse(await body(req));
  await pool.query(
    "INSERT INTO recovery_actions(request_id,actor_id,service,job_id,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
    [input.requestId, actor.id, input.service, input.jobId, input.reason],
  );
  const saved = (
    await pool.query("SELECT * FROM recovery_actions WHERE request_id=$1", [
      input.requestId,
    ])
  ).rows[0];
  if (
    !saved ||
    saved.actor_id !== actor.id ||
    saved.service !== input.service ||
    saved.job_id !== input.jobId ||
    saved.reason !== input.reason
  )
    throw new ApiError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "This recovery request ID belongs to another action.",
    );
  if (saved.status !== "confirmed") {
    if (input.service !== "commerce-operations") {
      const result = (await forward(input.service, "/internal/recovery", {
        method: "POST",
        body: JSON.stringify({
          requestId: input.requestId,
          jobId: input.jobId,
        }),
      })) as { ok: boolean };
      if (result.ok !== true)
        throw new ApiError(
          503,
          "RECOVERY_UNCONFIRMED",
          "Owner recovery was not confirmed. Retry the same action.",
        );
    } else {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          input.requestId,
        ]);
        const receipt = await c.query(
          "SELECT job_id FROM recovery_receipts WHERE request_id=$1",
          [input.requestId],
        );
        if (receipt.rowCount) {
          if (receipt.rows[0].job_id !== input.jobId)
            throw new ApiError(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Recovery request ID conflict.",
            );
        } else {
          const changed = await c.query(
            "UPDATE review_audit SET status='requested',attempts=0,next_attempt_at=now(),last_error=NULL,updated_at=now() WHERE id=$1 AND status='needs_attention' AND review_version IS NOT NULL RETURNING id",
            [input.jobId],
          );
          if (!changed.rowCount)
            throw new ApiError(
              409,
              "JOB_NOT_EXHAUSTED",
              "This job is no longer awaiting recovery.",
            );
          await c.query(
            "INSERT INTO recovery_receipts(request_id,job_id) VALUES($1,$2)",
            [input.requestId, input.jobId],
          );
        }
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    }
    await pool.query(
      "UPDATE recovery_actions SET status='confirmed' WHERE request_id=$1",
      [input.requestId],
    );
  }
  json(res, 200, { ok: true });
  return true;
}
