import { recoveryRoute } from "./recovery.ts";
import { wellbeingRoute } from "./wellbeing.ts";
import { privacyRoute, processDeletions } from "./privacy.ts";
import { randomInt, randomUUID, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  startDependencies,
  serve,
  ApiError,
  body,
  json,
  pool,
} from "../../packages/shared-config/runtime.ts";
import { migrate } from "../../packages/shared-config/migrate.ts";
import {
  assertEnvironment,
  cookie,
  current,
  equal,
  hash,
  issueSession,
  local,
  protectedCode,
  publicAccount,
  setCookie,
  type AccountRow,
} from "./security.ts";
import { sms } from "./sms.ts";
import {
  callback,
  configured,
  providers,
  startOAuth,
  type Provider,
} from "./oauth.ts";
import { verificationRoute, internalReview } from "./verification.ts";
import { batchEligibility } from "./eligibility.ts";
assertEnvironment();
await startDependencies();
await migrate(new URL("./migrations/", import.meta.url));
const phoneSchema = z
  .object({ phone: z.string().regex(/^\+91[6-9]\d{9}$/) })
  .strict();
serve(async (req, res) => {
  const path = new URL(req.url!, "http://identity").pathname;
  if (await recoveryRoute(req, res, path)) return;
  if (await wellbeingRoute(req, res, path)) return;
  if (await privacyRoute(req, res, path)) return;
  if (path === "/internal/session" && req.method === "GET") {
    const a = (await current(req, false, true))!;
    return json(res, 200, {
      id: a.id,
      restricted: a.restricted,
      reauthenticatedAt: a.reauthenticated_at.toISOString(),
    });
  }
  if (path === "/internal/restrict" && req.method === "POST") {
    const input = z
      .object({ accountId: z.string().uuid(), restricted: z.boolean() })
      .strict()
      .parse(await body(req));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE accounts SET restricted=$1 WHERE id=$2", [
        input.restricted,
        input.accountId,
      ]);
      await client.query("DELETE FROM sessions WHERE account_id=$1", [
        input.accountId,
      ]);
      await client.query("COMMIT");
      return json(res, 200, { ok: true });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  if (path === "/internal/eligibility" && req.method === "POST")
    return batchEligibility(req, res);
  if (
    path.startsWith("/internal/reviews") &&
    (await internalReview(req, res, path))
  )
    return;
  if (
    path.startsWith("/api/v1/verification") ||
    path === "/internal/identity/me"
  ) {
    if (await verificationRoute(req, res, path)) return;
  }
  if (path === "/api/v1/auth/options" && req.method === "GET")
    return json(res, 200, {
      local,
      providers: providers.map((id) => ({ id, configured: configured(id) })),
    });
  if (path === "/api/v1/auth/otp/request" && req.method === "POST") {
    const { phone } = phoneSchema.parse(await body(req));
    const account = await current(req, true);
    const id = randomUUID();
    const code = randomInt(0, 1000000).toString().padStart(6, "0");
    const binding = randomBytes(32).toString("base64url");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [phone]);
      const count = await client.query(
        "SELECT count(*)::int AS count, max(created_at) AS latest FROM otp_challenges WHERE phone=$1 AND created_at>now()-interval '1 hour'",
        [phone],
      );
      if (
        count.rows[0].latest &&
        Date.now() - new Date(count.rows[0].latest).getTime() < 60000
      )
        throw new ApiError(
          409,
          "RESEND_COOLDOWN",
          "Wait 60 seconds before requesting another code.",
        );
      if (count.rows[0].count >= 5)
        throw new ApiError(
          429,
          "OTP_RATE_LIMIT",
          "Too many codes requested. Try again in an hour.",
        );
      await client.query(
        "INSERT INTO otp_challenges(id,phone,code_hash,account_id,binding_hash,expires_at,source) VALUES($1,$2,$3,$4,$5,now()+interval '5 minutes',$6)",
        [
          id,
          phone,
          protectedCode(id, code),
          account?.id || null,
          hash(binding),
          local ? "local" : "sms",
        ],
      );
      await sms.send(phone, code);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    setCookie(res, "raahi_challenge", binding, 300);
    return json(res, 200, {
      challengeId: id,
      expiresIn: 300,
      ...(local ? { localCode: code } : {}),
    });
  }
  if (path === "/api/v1/auth/otp/verify" && req.method === "POST") {
    const input = z
      .object({
        challengeId: z.string().uuid(),
        code: z.string().regex(/^\d{6}$/),
      })
      .strict()
      .parse(await body(req));
    const client = await pool.connect();
    let token = "";
    let account: AccountRow | undefined;
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT * FROM otp_challenges WHERE id=$1 FOR UPDATE",
        [input.challengeId],
      );
      const challenge = result.rows[0];
      if (
        !challenge ||
        challenge.consumed_at ||
        new Date(challenge.expires_at).getTime() <= Date.now() ||
        challenge.attempts >= 5 ||
        !equal(challenge.binding_hash, hash(cookie(req, "raahi_challenge")))
      )
        throw new ApiError(
          400,
          "OTP_INVALID",
          "The code is expired or unavailable. Request a new one.",
        );
      if (
        !equal(
          challenge.code_hash,
          protectedCode(input.challengeId, input.code),
        )
      ) {
        await client.query(
          "UPDATE otp_challenges SET attempts=attempts+1 WHERE id=$1",
          [input.challengeId],
        );
        await client.query("COMMIT");
        throw new ApiError(
          400,
          "OTP_INCORRECT",
          "That code is incorrect. Try again.",
        );
      }
      if (challenge.account_id) {
        const signedIn = await current(req);
        if (signedIn!.id !== challenge.account_id)
          throw new ApiError(
            403,
            "ACCOUNT_CHANGED",
            "Sign in again before verifying your phone.",
          );
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        challenge.phone,
      ]);
      const existing = await client.query(
        "SELECT * FROM accounts WHERE phone=$1 FOR UPDATE",
        [challenge.phone],
      );
      if (
        challenge.account_id &&
        existing.rowCount &&
        existing.rows[0].id !== challenge.account_id
      )
        throw new ApiError(
          409,
          "PHONE_ALREADY_LINKED",
          "This phone belongs to another account. Sign in to that account; accounts are not automatically merged.",
        );
      const id = challenge.account_id || existing.rows[0]?.id || randomUUID();
      if (!challenge.account_id && !existing.rowCount)
        await client.query(
          "INSERT INTO accounts(id,phone,phone_source) VALUES($1,$2,$3)",
          [id, challenge.phone, challenge.source],
        );
      if (challenge.account_id)
        await client.query(
          "UPDATE accounts SET phone=$1,phone_source=$2 WHERE id=$3",
          [challenge.phone, challenge.source, id],
        );
      const row = await client.query<AccountRow>(
        "SELECT * FROM accounts WHERE id=$1 FOR UPDATE",
        [id],
      );
      account = row.rows[0];
      token = await issueSession(client, id, req);
      await client.query(
        "UPDATE otp_challenges SET consumed_at=now() WHERE id=$1",
        [input.challengeId],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    setCookie(res, "raahi_session", token, 604800);
    setCookie(res, "raahi_challenge", "", 0);
    return json(res, 200, publicAccount(account!));
  }
  if (path === "/api/v1/auth/logout" && req.method === "POST") {
    await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
      hash(cookie(req, "raahi_session")),
    ]);
    setCookie(res, "raahi_session", "", 0);
    return json(res, 200, { ok: true });
  }
  if (path === "/api/v1/auth/oauth/start" && req.method === "POST") {
    const input = z
      .object({
        provider: z.enum(["google", "apple", "linkedin"]),
        link: z.boolean().optional(),
      })
      .strict()
      .parse(await body(req));
    return startOAuth(req, res, input.provider, !!input.link);
  }
  const oauth = path.match(
    /^\/api\/v1\/auth\/oauth\/(google|apple|linkedin)\/callback$/,
  );
  if (
    oauth &&
    ((oauth[1] === "apple" && req.method === "POST") ||
      (oauth[1] !== "apple" && req.method === "GET"))
  )
    return callback(req, res, oauth[1] as Provider);
  if (path.startsWith("/api/v1/account")) {
    const account = (await current(req))!;
    if (path === "/api/v1/account" && req.method === "GET")
      return json(res, 200, publicAccount(account));
    if (path === "/api/v1/account/consent" && req.method === "POST") {
      if (!account.phone)
        throw new ApiError(
          403,
          "PHONE_REQUIRED",
          "Verify your Indian mobile number first.",
        );
      const input = z
        .object({
          displayName: z.string().trim().min(2).max(60),
          adult: z.literal(true),
          indiaResident: z.literal(true),
          terms: z.literal(true),
        })
        .strict()
        .parse(await body(req));
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query<AccountRow>(
          "UPDATE accounts SET display_name=$1,consented_at=now(),consent_version='2026-10-v1',adult_declared=true,india_resident=true WHERE id=$2 RETURNING *",
          [input.displayName, account.id],
        );
        await client.query(
          "INSERT INTO consent_history(id,account_id,version) VALUES(gen_random_uuid(),$1,'2026-10-v1')",
          [account.id],
        );
        await client.query("COMMIT");
        return json(res, 200, publicAccount(result.rows[0]));
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }
    if (path === "/api/v1/account/preferences" && req.method === "PATCH") {
      const input = z
        .object({ paused: z.boolean() })
        .strict()
        .parse(await body(req));
      const result = await pool.query<AccountRow>(
        "UPDATE accounts SET paused=$1 WHERE id=$2 RETURNING *",
        [input.paused, account.id],
      );
      return json(res, 200, publicAccount(result.rows[0]));
    }
    if (path === "/api/v1/account/sessions" && req.method === "GET") {
      const result = await pool.query(
        "SELECT id,created_at,expires_at FROM sessions WHERE account_id=$1 AND expires_at>now() ORDER BY created_at DESC LIMIT 30",
        [account.id],
      );
      return json(res, 200, {
        sessions: result.rows.map((s) => ({
          id: s.id,
          createdAt: s.created_at.toISOString(),
          expiresAt: s.expires_at.toISOString(),
          current: s.id === account.session_id,
        })),
      });
    }
    if (path === "/api/v1/account/sessions/revoke" && req.method === "POST") {
      await pool.query("DELETE FROM sessions WHERE account_id=$1 AND id<>$2", [
        account.id,
        account.session_id,
      ]);
      return json(res, 200, { ok: true });
    }
  }
  throw new ApiError(404, "NOT_FOUND", "This route does not exist.");
});
// Ephemeral authentication records are retained for at most one day, sessions until expiry.
setInterval(
  () =>
    Promise.all([
      pool.query(
        "DELETE FROM otp_challenges WHERE created_at<now()-interval '1 day'",
      ),
      pool.query("DELETE FROM sessions WHERE expires_at<now()"),
    ]).catch(() => console.error('{"event":"identity_cleanup_failed"}')),
  60000,
).unref();

setInterval(() => void processDeletions(), 2000).unref();
