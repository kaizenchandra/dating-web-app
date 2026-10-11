import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  ApiError,
  body,
  json,
  pool,
} from "../../packages/shared-config/runtime.ts";
type Internal = (
  service: string,
  path: string,
  options?: RequestInit,
) => Promise<{
  id: string;
  restricted: boolean;
  targetId: string;
  evidence: Record<string, unknown>;
}>;
export async function reportsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  internal: Internal,
) {
  if (!["/api/v1/reports", "/api/v1/safety/account"].includes(path))
    return false;
  const actor = await internal("identity", "/internal/session", {
    headers: { cookie: req.headers.cookie || "" },
  });
  if (path === "/api/v1/safety/account" && req.method === "GET") {
    json(res, 200, { id: actor.id, restricted: actor.restricted });
    return true;
  }
  if (path === "/api/v1/reports" && req.method === "GET") {
    const rows = await pool.query(
      `SELECT id,kind,reason,detail,status,resolution,created_at AS "createdAt" FROM reports WHERE reporter_id=$1 ORDER BY created_at DESC LIMIT 100`,
      [actor.id],
    );
    json(res, 200, { reports: rows.rows });
    return true;
  }
  if (path === "/api/v1/reports" && req.method === "POST") {
    const input = z
      .object({
        kind: z.enum([
          "profile",
          "media",
          "message",
          "call",
          "offline",
          "appeal",
          "correction",
        ]),
        targetId: z.string().uuid().optional(),
        subjectId: z.string().uuid().optional(),
        reason: z.string().trim().min(3).max(120),
        detail: z.string().trim().min(10).max(3000),
      })
      .strict()
      .parse(await body(req));
    if (actor.restricted && !["appeal", "correction"].includes(input.kind))
      throw new ApiError(
        403,
        "ACCOUNT_RESTRICTED",
        "Restricted accounts can submit appeals or correction requests.",
      );
    let target =
      input.kind === "appeal" || input.kind === "correction"
        ? actor.id
        : input.targetId;
    let evidence = {};
    if (input.kind === "message" || input.kind === "call") {
      if (!input.subjectId)
        throw new ApiError(
          422,
          "SUBJECT_REQUIRED",
          "Choose the message or call to report.",
        );
      const found = await internal("communication", "/internal/evidence", {
        method: "POST",
        body: JSON.stringify({
          actorId: actor.id,
          subjectId: input.subjectId,
          kind: input.kind,
        }),
      });
      target = found.targetId;
      evidence = found.evidence;
    }
    if (!target)
      throw new ApiError(
        422,
        "TARGET_REQUIRED",
        "Provide the account associated with this report.",
      );
    const id = randomUUID();
    await pool.query(
      "INSERT INTO reports(id,reporter_id,target_id,subject_id,kind,reason,detail,evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        id,
        actor.id,
        target,
        input.subjectId || null,
        input.kind,
        input.reason,
        input.detail,
        JSON.stringify(evidence),
      ],
    );
    json(res, 200, { id, status: "submitted" });
    return true;
  }
  throw new ApiError(
    405,
    "METHOD_NOT_ALLOWED",
    "This action is not supported.",
  );
}
export async function moderationRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  actorId: string,
  internal: Internal,
) {
  if (path === "/api/v1/admin/reports" && req.method === "GET") {
    const rows = await pool.query(
      `SELECT id,reporter_id AS "reporterId",target_id AS "targetId",kind,reason,detail,evidence,status,resolution,created_at AS "createdAt" FROM reports ORDER BY created_at DESC LIMIT 100`,
    );
    json(res, 200, { reports: rows.rows });
    return true;
  }
  if (path === "/api/v1/admin/reports/action" && req.method === "POST") {
    const input = z
      .object({
        reportId: z.string().uuid(),
        action: z.enum(["review", "dismiss", "suspend", "restore", "resolve"]),
        resolution: z.string().trim().min(3).max(1000),
      })
      .strict()
      .parse(await body(req));
    const row = (
      await pool.query("SELECT * FROM reports WHERE id=$1", [input.reportId])
    ).rows[0];
    if (!row) throw new ApiError(404, "REPORT_NOT_FOUND", "Report not found.");
    if (row.target_id === actorId || row.reporter_id === actorId)
      throw new ApiError(
        403,
        "REVIEW_CONFLICT",
        "Another moderator must handle this report.",
      );
    const audit = randomUUID();
    await pool.query(
      "INSERT INTO review_audit(id,actor_id,target_id,kind,decision,reason) VALUES($1,$2,$3,$4,$5,$6)",
      [audit, actorId, row.target_id, "report", input.action, input.resolution],
    );
    try {
      if (input.action === "suspend" || input.action === "restore")
        await internal("identity", "/internal/restrict", {
          method: "POST",
          body: JSON.stringify({
            accountId: row.target_id,
            restricted: input.action === "suspend",
          }),
        });
      await pool.query(
        "UPDATE reports SET status=$2,resolution=$3 WHERE id=$1",
        [
          row.id,
          input.action === "review"
            ? "reviewing"
            : input.action === "dismiss"
              ? "dismissed"
              : "resolved",
          input.resolution,
        ],
      );
      await pool.query("UPDATE review_audit SET status='applied' WHERE id=$1", [
        audit,
      ]);
    } catch (e) {
      await pool.query(
        "UPDATE review_audit SET status='failed_or_unknown' WHERE id=$1",
        [audit],
      );
      throw e;
    }
    json(res, 200, { ok: true });
    return true;
  }
  return false;
}
