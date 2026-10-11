import { serviceToken } from "../../packages/shared-config/service-auth.ts";
import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  pool,
  body,
  json,
  ApiError,
} from "../../packages/shared-config/runtime.ts";
import { current, cookie, hash, setCookie } from "./security.ts";
const owners = [
  "connections",
  "communication",
  "profile-discovery",
  "commerce-operations",
];
async function owner(service: string, action: string, accountId: string) {
  const response = await fetch(
    `http://${service}:4000/internal/privacy/${action}?accountId=${accountId}`,
    {
      method: action === "delete" ? "POST" : "GET",
      headers: { authorization: `Bearer ${serviceToken(service)}` },
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!response.ok)
    throw new ApiError(
      503,
      "PRIVACY_DEPENDENCY",
      "An owning service is unavailable. Please retry.",
    );
  return response.json();
}
export async function privacyRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
) {
  if (
    ![
      "/api/v1/account/export",
      "/api/v1/account/withdraw",
      "/api/v1/account/delete",
      "/api/v1/account/deletion",
    ].includes(path)
  )
    return false;
  if (path === "/api/v1/account/deletion" && req.method === "GET") {
    const result = await pool.query(
      "SELECT id,status,steps,attempts FROM deletion_jobs WHERE receipt_hash=$1",
      [hash(cookie(req, "raahi_deletion"))],
    );
    if (!result.rowCount)
      throw new ApiError(
        404,
        "RECEIPT_REQUIRED",
        "No deletion receipt is available in this browser.",
      );
    json(res, 200, result.rows[0]);
    return true;
  }
  const a = (await current(req, false, true))!;
  if (path === "/api/v1/account/withdraw" && req.method === "POST") {
    z.object({ confirm: z.literal(true) })
      .strict()
      .parse(await body(req));
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        "UPDATE accounts SET consented_at=NULL,paused=true WHERE id=$1",
        [a.id],
      );
      await c.query(
        "INSERT INTO consent_history(id,account_id,version,action) VALUES(gen_random_uuid(),$1,'2026-10-v1','withdrawn')",
        [a.id],
      );
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    json(res, 200, { ok: true });
    return true;
  }
  if (Date.now() - a.reauthenticated_at.getTime() > 600000)
    throw new ApiError(
      401,
      "REAUTHENTICATE",
      "Sign in again before exporting or deleting your account.",
    );
  if (path === "/api/v1/account/export" && req.method === "GET") {
    const records = await Promise.all(
      owners.map(async (service) => [
        service,
        await owner(service, "export", a.id),
      ]),
    );
    const identity = await pool.query(
      "SELECT id,phone,display_name,consented_at,paused,created_at FROM accounts WHERE id=$1",
      [a.id],
    );
    const consents = await pool.query(
      "SELECT version,action,created_at FROM consent_history WHERE account_id=$1",
      [a.id],
    );
    const verification = await pool.query(
      "SELECT age_state,identity_state,source,date_of_birth,consented_at FROM verifications WHERE account_id=$1",
      [a.id],
    );
    const wellbeing = await pool.query(
      "SELECT locale,quiet_enabled,quiet_start,quiet_end,read_receipts FROM wellbeing WHERE account_id=$1",
      [a.id],
    );
    const providers = await pool.query(
      "SELECT provider,email,name,created_at FROM provider_identities WHERE account_id=$1",
      [a.id],
    );
    json(res, 200, {
      wellbeing: wellbeing.rows,
      linkedProviders: providers.rows,
      exportedAt: new Date().toISOString(),
      identity: identity.rows[0],
      consents: consents.rows,
      verification: verification.rows,
      ...Object.fromEntries(records),
    });
    return true;
  }
  if (path === "/api/v1/account/delete" && req.method === "POST") {
    z.object({ confirmation: z.literal("DELETE") })
      .strict()
      .parse(await body(req));
    const receipt = randomBytes(32).toString("base64url");
    const id = randomUUID();
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        "UPDATE accounts SET restricted=true,paused=true,consented_at=NULL WHERE id=$1",
        [a.id],
      );
      await c.query(
        "INSERT INTO deletion_jobs(id,account_id,receipt_hash) VALUES($1,$2,$3) ON CONFLICT(account_id) DO UPDATE SET receipt_hash=$3",
        [id, a.id, hash(receipt)],
      );
      await c.query("DELETE FROM sessions WHERE account_id=$1", [a.id]);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    setCookie(res, "raahi_session", "", 0);
    setCookie(res, "raahi_deletion", receipt, 2592000);
    json(res, 200, { id, status: "pending" });
    return true;
  }
  throw new ApiError(
    405,
    "METHOD_NOT_ALLOWED",
    "This action is not supported.",
  );
}
let running = false;
export async function processDeletions() {
  if (running) return;
  running = true;
  try {
    const jobs = await pool.query(
      "SELECT * FROM deletion_jobs WHERE status='pending' AND next_attempt_at<=now() ORDER BY created_at LIMIT 5",
    );
    for (const job of jobs.rows) {
      try {
        for (const service of owners) {
          if (job.steps[service]) continue;
          await owner(service, "delete", job.account_id);
          job.steps[service] = "erased";
          await pool.query("UPDATE deletion_jobs SET steps=$2 WHERE id=$1", [
            job.id,
            JSON.stringify(job.steps),
          ]);
        }
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          await c.query(
            "DELETE FROM otp_challenges WHERE account_id=$1 OR phone=(SELECT phone FROM accounts WHERE id=$1)",
            [job.account_id],
          );
          for (const table of [
            "sessions",
            "provider_identities",
            "consent_history",
            "verifications",
            "wellbeing",
          ])
            await c.query(`DELETE FROM ${table} WHERE account_id=$1`, [
              job.account_id,
            ]);
          await c.query("DELETE FROM accounts WHERE id=$1", [job.account_id]);
          await c.query(
            "UPDATE deletion_jobs SET status='complete',completed_at=now(),steps=steps||'{\"identity\":\"erased\"}'::jsonb,last_error=NULL WHERE id=$1",
            [job.id],
          );
          await c.query("COMMIT");
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      } catch {
        await pool.query(
          "UPDATE deletion_jobs SET attempts=attempts+1,next_attempt_at=now()+least(power(2,attempts+1),3600)*interval '1 second',status=CASE WHEN attempts>=9 THEN 'needs_attention' ELSE 'pending' END,last_error='owner unavailable; retry required' WHERE id=$1",
          [job.id],
        );
      }
    }
  } catch {
    console.error('{"event":"deletion_worker_unavailable"}');
  } finally {
    running = false;
  }
}
