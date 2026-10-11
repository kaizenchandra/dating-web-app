import { serviceToken } from "../../packages/shared-config/service-auth.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  pool,
  body,
  json,
  ApiError,
} from "../../packages/shared-config/runtime.ts";
const decision = z
  .object({
    decisionId: z.string().uuid(),
    accountId: z.string().uuid(),
    reviewVersion: z.string().uuid(),
    kind: z.enum(["identity", "photo"]),
    decision: z.enum(["approved", "rejected"]),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
// The audit row is also the transactional delivery outbox. The receiver owns
// its applied receipt and business transition in one transaction.
export async function deliverReview(id: string) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const result = await c.query(
      "SELECT * FROM review_audit WHERE id=$1 AND status='requested' AND review_version IS NOT NULL AND next_attempt_at<=now() FOR UPDATE SKIP LOCKED",
      [id],
    );
    if (!result.rowCount) {
      await c.query("COMMIT");
      return;
    }
    const row = result.rows[0];
    let status = "requested",
      failure: string | null = null;
    try {
      const response = await fetch(
        `http://${row.kind === "identity" ? "identity" : "profile-discovery"}:4000/internal/reviews/decision`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${serviceToken(row.kind === "identity" ? "identity" : "profile-discovery")}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            decisionId: row.id,
            accountId: row.target_id,
            reviewVersion: row.review_version,
            kind: row.kind,
            decision: row.decision,
            reason: row.reason,
          }),
          signal: AbortSignal.timeout(2500),
        },
      );
      if (response.ok) {
        const receipt = await response.json();
        if (receipt.ok === true) status = "applied";
        else failure = "INVALID_ACKNOWLEDGEMENT";
      } else if ([400, 403, 404, 409, 422].includes(response.status)) {
        status = "rejected";
        failure =
          response.status === 409
            ? "SUBMISSION_REPLACED_OR_DECIDED"
            : "OWNER_REJECTED_DECISION";
      } else failure = "OWNER_UNAVAILABLE";
    } catch {
      failure = "DELIVERY_UNCONFIRMED";
    }
    if (status === "requested" && row.attempts + 1 >= 10)
      status = "needs_attention";
    await c.query(
      "UPDATE review_audit SET status=$2,attempts=attempts+1,last_error=$3,updated_at=now(),next_attempt_at=now()+make_interval(secs=>$4) WHERE id=$1",
      [id, status, failure, Math.min(3600, 5 * 2 ** row.attempts)],
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function reviewDeliveryRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  actorId: string,
) {
  if (path === "/api/v1/admin/reviews/delivery" && req.method === "GET") {
    const rows = await pool.query(
      `SELECT id AS "decisionId",target_id AS "accountId",review_version AS "reviewVersion",kind,decision,reason,status,attempts,last_error AS "lastError",updated_at AS "updatedAt" FROM review_audit WHERE actor_id=$1 AND review_version IS NOT NULL ORDER BY created_at DESC LIMIT 50`,
      [actorId],
    );
    json(res, 200, { items: rows.rows });
    return true;
  }
  if (path !== "/api/v1/admin/reviews/decision" || req.method !== "POST")
    return false;
  const input = decision.parse(await body(req));
  await pool.query(
    "INSERT INTO review_audit(id,actor_id,target_id,kind,decision,reason,review_version) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING",
    [
      input.decisionId,
      actorId,
      input.accountId,
      input.kind,
      input.decision,
      input.reason,
      input.reviewVersion,
    ],
  );
  const stored = (
    await pool.query("SELECT * FROM review_audit WHERE id=$1", [
      input.decisionId,
    ])
  ).rows[0];
  if (
    !stored ||
    stored.actor_id !== actorId ||
    stored.target_id !== input.accountId ||
    stored.kind !== input.kind ||
    stored.decision !== input.decision ||
    stored.reason !== input.reason ||
    stored.review_version !== input.reviewVersion
  )
    throw new ApiError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "This decision ID is already bound to another request. Refresh the review queue.",
    );
  await deliverReview(input.decisionId);
  const row = (
    await pool.query("SELECT status FROM review_audit WHERE id=$1", [
      input.decisionId,
    ])
  ).rows[0];
  json(res, 200, {
    ok: row.status === "applied",
    status: row.status === "requested" ? "queued" : row.status,
  });
  return true;
}
let running = false;
export async function reconcileReviews() {
  if (running) return;
  running = true;
  try {
    const due = await pool.query(
      "SELECT id FROM review_audit WHERE status='requested' AND review_version IS NOT NULL AND next_attempt_at<=now() ORDER BY next_attempt_at LIMIT 5",
    );
    for (const row of due.rows) await deliverReview(row.id);
  } finally {
    running = false;
  }
}
