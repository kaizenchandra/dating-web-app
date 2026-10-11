import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  ApiError,
  body,
  json,
  pool,
} from "../../packages/shared-config/runtime.ts";
import { current, local, type AccountRow } from "./security.ts";
export function ageYears(date: string, now = new Date()) {
  const dob = new Date(date + "T00:00:00Z");
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  if (
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() &&
      now.getUTCDate() < dob.getUTCDate())
  )
    age--;
  return age;
}
export async function verification(id: string) {
  const result = await pool.query(
    "SELECT *,to_char(date_of_birth,'YYYY-MM-DD') AS dob FROM verifications WHERE account_id=$1",
    [id],
  );
  const v = result.rows[0];
  return {
    age: v?.age_state || "not_started",
    identity: v?.identity_state || "not_started",
    source: v?.source || null,
    ageYears: v?.dob ? ageYears(v.dob) : null,
    reason: v?.reason || "",
    local,
  };
}
export async function eligibility(account: AccountRow) {
  const v = await verification(account.id);
  return {
    id: account.id,
    reauthenticatedAt: account.reauthenticated_at?.toISOString(),
    displayName: account.display_name,
    consented: !!account.consented_at,
    paused: account.paused,
    ageYears: v.ageYears,
    identityApproved:
      !!account.phone &&
      !!account.consented_at &&
      !account.paused &&
      v.age === "approved" &&
      v.identity === "approved" &&
      (local || v.source !== "local") &&
      (local || account.phone_source === "sms"),
    verificationSource: v.source,
  };
}
export async function decideIdentity(
  accountId: string,
  decision: "approved" | "rejected",
  reason: string,
  delivery?: { decisionId: string; reviewVersion: string },
) {
  if (!local)
    throw new ApiError(
      403,
      "PROVIDER_REQUIRED",
      "Production verification requires an approved provider.",
    );
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const locked = await c.query(
      "SELECT id FROM accounts WHERE id=$1 FOR UPDATE",
      [accountId],
    );
    if (!locked.rowCount)
      throw new ApiError(
        409,
        "REVIEW_NOT_PENDING",
        "This account is no longer available.",
      );
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          accountId,
          decision,
          reason,
          version: delivery?.reviewVersion,
        }),
      )
      .digest("hex");
    if (delivery) {
      const receipt = await c.query(
        "SELECT payload_hash FROM review_receipts WHERE decision_id=$1",
        [delivery.decisionId],
      );
      if (receipt.rowCount) {
        if (receipt.rows[0].payload_hash !== hash)
          throw new ApiError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "This decision ID belongs to another request.",
          );
        await c.query("COMMIT");
        return;
      }
    }
    const result = await c.query(
      "UPDATE verifications SET age_state=$1,identity_state=$1,reason=$2,updated_at=now() WHERE account_id=$3 AND source='local' AND identity_state='pending' AND ($4::uuid IS NULL OR review_version=$4)",
      [decision, reason, accountId, delivery?.reviewVersion || null],
    );
    if (!result.rowCount)
      throw new ApiError(
        409,
        "REVIEW_NOT_PENDING",
        "This submission was replaced or is no longer pending.",
      );
    if (delivery)
      await c.query(
        "INSERT INTO review_receipts(decision_id,account_id,payload_hash) VALUES($1,$2,$3)",
        [delivery.decisionId, accountId, hash],
      );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function internalReview(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
) {
  if (path === "/internal/reviews" && req.method === "GET") {
    const result = await pool.query(
      'SELECT v.account_id AS "accountId",a.display_name AS name,\'identity\' AS kind,v.source,v.review_version AS "reviewVersion",v.updated_at AS "updatedAt" FROM verifications v JOIN accounts a ON a.id=v.account_id WHERE v.identity_state=\'pending\' ORDER BY v.updated_at LIMIT 100',
    );
    json(res, 200, { reviews: result.rows });
    return true;
  }
  if (path === "/internal/reviews/decision" && req.method === "POST") {
    const input = z
      .object({
        accountId: z.string().uuid(),
        kind: z.literal("identity"),
        decision: z.enum(["approved", "rejected"]),
        reason: z.string().min(3).max(500),
        decisionId: z.string().uuid(),
        reviewVersion: z.string().uuid(),
      })
      .strict()
      .parse(await body(req));
    await decideIdentity(input.accountId, input.decision, input.reason, input);
    json(res, 200, { ok: true });
    return true;
  }
  return false;
}
export async function verificationRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
) {
  const account = (await current(req))!;
  if (path === "/internal/identity/me" && req.method === "GET") {
    json(res, 200, await eligibility(account));
    return true;
  }
  if (path === "/api/v1/verification" && req.method === "GET") {
    json(res, 200, await verification(account.id));
    return true;
  }
  if (!account.phone || !account.consented_at)
    throw new ApiError(
      403,
      "ONBOARDING_REQUIRED",
      "Complete mobile verification and consent first.",
    );
  if (path === "/api/v1/verification/start" && req.method === "POST") {
    const input = z
      .object({
        route: z.enum(["local", "digilocker", "alternative"]),
        consent: z.literal(true),
        dateOfBirth: z.iso.date(),
      })
      .strict()
      .parse(await body(req));
    if (input.route !== "local")
      throw new ApiError(
        503,
        "VERIFICATION_PROVIDER_NOT_CONFIGURED",
        "This verification provider is awaiting configuration and approval. Do not submit identity documents here.",
      );
    if (!local)
      throw new ApiError(
        403,
        "SIMULATOR_FORBIDDEN",
        "Local verification is unavailable in this environment.",
      );
    const age = ageYears(input.dateOfBirth);
    if (age < 18 || age > 100)
      throw new ApiError(
        422,
        "AGE_INELIGIBLE",
        "This platform is for adults aged 18 to 100.",
      );
    await pool.query(
      "INSERT INTO verifications(account_id,age_state,identity_state,source,date_of_birth,consented_at) VALUES($1,'pending','pending','local',$2,now()) ON CONFLICT(account_id) DO UPDATE SET age_state='pending',identity_state='pending',source='local',date_of_birth=$2,reason='',consented_at=now(),updated_at=now(),review_version=gen_random_uuid()",
      [account.id, input.dateOfBirth],
    );
    json(res, 200, await verification(account.id));
    return true;
  }
  if (path === "/api/v1/verification/local-decision" && req.method === "POST") {
    if (!local)
      throw new ApiError(
        403,
        "SIMULATOR_FORBIDDEN",
        "Local verification is unavailable.",
      );
    const input = z
      .object({ decision: z.enum(["approved", "rejected"]) })
      .strict()
      .parse(await body(req));
    await decideIdentity(
      account.id,
      input.decision,
      input.decision === "rejected"
        ? "Simulated rejection. You can start a new test review."
        : "",
    );
    json(res, 200, await verification(account.id));
    return true;
  }
  return false;
}
