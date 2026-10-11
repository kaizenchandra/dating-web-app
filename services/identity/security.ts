import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { PoolClient } from "pg";
import { ApiError, pool } from "../../packages/shared-config/runtime.ts";
export const origin = process.env.WEB_ORIGIN || "http://localhost:3000";
export const local = process.env.APP_ENV === "local";
export function assertEnvironment() {
  if (!["local", "production", "staging"].includes(process.env.APP_ENV || ""))
    throw new Error("APP_ENV must be explicit");
  if (!process.env.OTP_PEPPER || process.env.OTP_PEPPER.length < 32)
    throw new Error("OTP_PEPPER is required");
  if (
    local &&
    (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname) ||
      process.env.LOCAL_TEST_DELIVERY !== "enabled")
  )
    throw new Error(
      "Local delivery requires explicit flag and loopback origin",
    );
  if (
    !local &&
    (process.env.LOCAL_TEST_DELIVERY === "enabled" ||
      !origin.startsWith("https://"))
  )
    throw new Error(
      "Deployed environments require HTTPS and forbid local delivery",
    );
}
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const protectedCode = (id: string, code: string) =>
  createHmac("sha256", process.env.OTP_PEPPER!)
    .update(`${id}:${code}`)
    .digest("hex");
export function equal(a: string, b: string) {
  return (
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
export function cookie(req: IncomingMessage, name: string) {
  return (
    (req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(name + "="))
      ?.slice(name.length + 1) || ""
  );
}
export function setCookie(
  res: ServerResponse,
  name: string,
  value: string,
  maxAge: number,
  crossSite = false,
) {
  const existing = res.getHeader("set-cookie");
  const cookies = Array.isArray(existing)
    ? existing
    : existing
      ? [String(existing)]
      : [];
  res.setHeader("set-cookie", [
    ...cookies,
    `${name}=${value}; HttpOnly; Path=/; SameSite=${crossSite ? "None" : "Lax"}; Max-Age=${maxAge}${origin.startsWith("https://") ? "; Secure" : ""}`,
  ]);
}
export type AccountRow = {
  id: string;
  phone: string | null;
  phone_source: string | null;
  display_name: string;
  consented_at: Date | null;
  paused: boolean;
  restricted: boolean;
  session_id: string;
  reauthenticated_at: Date;
};
export async function current(
  req: IncomingMessage,
  optional = false,
  allowRestricted = false,
): Promise<AccountRow | null> {
  const token = cookie(req, "raahi_session");
  if (!token) {
    if (optional) return null;
    throw new ApiError(401, "SESSION_REQUIRED", "Sign in to continue.");
  }
  const result = await pool.query<AccountRow>(
    "SELECT a.*,s.id AS session_id,s.reauthenticated_at FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>now()",
    [hash(token)],
  );
  if (!result.rowCount && optional) return null;
  if (!result.rowCount)
    throw new ApiError(
      401,
      "SESSION_EXPIRED",
      "Your session expired. Please sign in again.",
    );
  if (result.rows[0].restricted && !allowRestricted)
    throw new ApiError(
      403,
      "ACCOUNT_RESTRICTED",
      "This account is restricted. Contact support.",
    );
  return result.rows[0];
}
export function publicAccount(a: AccountRow) {
  return {
    id: a.id,
    phone: a.phone ? `${a.phone.slice(0, 3)}••••••${a.phone.slice(-4)}` : null,
    phoneSource: a.phone_source,
    displayName: a.display_name,
    consented: !!a.consented_at,
    paused: a.paused,
    onboarding: a.restricted
      ? "appeal"
      : !a.phone
        ? "phone"
        : !a.consented_at
          ? "consent"
          : "verification",
    environment: local ? "local" : "production",
  };
}
export async function issueSession(
  client: PoolClient,
  id: string,
  req: IncomingMessage,
) {
  const token = randomBytes(32).toString("base64url");
  await client.query("DELETE FROM sessions WHERE token_hash=$1", [
    hash(cookie(req, "raahi_session")),
  ]);
  await client.query(
    "INSERT INTO sessions(id,account_id,token_hash,expires_at) VALUES(gen_random_uuid(),$1,$2,now()+interval '7 days')",
    [id, hash(token)],
  );
  // Bound active sessions to 30, retaining the newest.
  await client.query(
    "DELETE FROM sessions WHERE account_id=$1 AND id NOT IN (SELECT id FROM sessions WHERE account_id=$1 ORDER BY created_at DESC LIMIT 30)",
    [id],
  );
  return token;
}
