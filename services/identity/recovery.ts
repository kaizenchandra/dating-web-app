import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  pool,
  body,
  json,
  ApiError,
} from "../../packages/shared-config/runtime.ts";
export async function recoveryRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
) {
  if (path !== "/internal/recovery") return false;
  if (req.method === "GET") {
    const r = await pool.query(
      `SELECT id,'identity' AS service,'account deletion' AS kind,attempts,created_at AS "createdAt",last_error AS "lastError" FROM deletion_jobs WHERE status='needs_attention' ORDER BY created_at LIMIT 50`,
    );
    json(res, 200, { jobs: r.rows });
    return true;
  }
  if (req.method !== "POST")
    throw new ApiError(405, "METHOD_NOT_ALLOWED", "Use GET or POST.");
  const input = z
    .object({ requestId: z.string().uuid(), jobId: z.string().uuid() })
    .strict()
    .parse(await body(req));
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      input.requestId,
    ]);
    const previous = await c.query(
      "SELECT job_id FROM recovery_receipts WHERE request_id=$1",
      [input.requestId],
    );
    if (previous.rowCount) {
      if (previous.rows[0].job_id !== input.jobId)
        throw new ApiError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Recovery request ID conflict.",
        );
    } else {
      const updated = await c.query(
        "UPDATE deletion_jobs SET status='pending',attempts=0,next_attempt_at=now(),last_error=NULL WHERE id=$1 AND status='needs_attention' RETURNING id",
        [input.jobId],
      );
      if (!updated.rowCount)
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
    json(res, 200, { ok: true });
    return true;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
