import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  ApiError,
  pool,
  redis,
  json,
  body,
} from "../../packages/shared-config/runtime.ts";
import { base32, verifyTotp } from "./totp.ts";
const key = () => {
  const value =
    process.env.MFA_ENCRYPTION_KEY ||
    (process.env.APP_ENV === "local" ? process.env.SERVICE_TOKEN : "");
  if (!value)
    throw new ApiError(
      503,
      "MFA_NOT_CONFIGURED",
      "Staff MFA encryption is not configured.",
    );
  return createHash("sha256").update(value).digest();
};
function encrypt(secret: Buffer) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  return Buffer.concat([
    iv,
    c.update(secret),
    c.final(),
    c.getAuthTag(),
  ]).toString("base64");
}
function decrypt(value: string) {
  const b = Buffer.from(value, "base64");
  const d = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(-16));
  return Buffer.concat([d.update(b.subarray(12, -16)), d.final()]);
}
function sessionKey(req: IncomingMessage) {
  return (
    "staff-mfa:" +
    createHash("sha256")
      .update(req.headers.cookie || "")
      .digest("hex")
  );
}
export async function staffMfa(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  actor: { id: string; reauthenticatedAt?: string },
) {
  if (path === "/api/v1/admin/mfa/setup" && req.method === "POST") {
    if (
      !actor.reauthenticatedAt ||
      Date.now() - new Date(actor.reauthenticatedAt).getTime() > 600000
    )
      throw new ApiError(
        401,
        "REAUTHENTICATE",
        "Sign in again before enrolling an authenticator.",
      );
    const existing = await pool.query(
      "SELECT confirmed FROM staff_mfa WHERE account_id=$1",
      [actor.id],
    );
    if (existing.rows[0]?.confirmed)
      throw new ApiError(
        409,
        "MFA_ENROLLED",
        "An authenticator is already enrolled. Contact an authorised administrator for recovery.",
      );
    const secret = randomBytes(20);
    await pool.query(
      "INSERT INTO staff_mfa(account_id,secret) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET secret=$2,confirmed=false,last_counter=0",
      [actor.id, encrypt(secret)],
    );
    const encoded = base32(secret);
    json(res, 200, {
      secret: encoded,
      uri: `otpauth://totp/Raahi:${actor.id}?secret=${encoded}&issuer=Raahi&digits=6&period=30`,
    });
    return true;
  }
  if (path === "/api/v1/admin/mfa/verify" && req.method === "POST") {
    const { code } = z
      .object({ code: z.string().regex(/^\d{6}$/) })
      .strict()
      .parse(await body(req));
    const counter = await redis.incr("mfa-attempt:" + actor.id);
    if (counter === 1) await redis.expire("mfa-attempt:" + actor.id, 180);
    if (counter > 5)
      throw new ApiError(
        429,
        "MFA_RATE_LIMIT",
        "Wait three minutes before trying again.",
      );
    const result = await pool.query(
      "SELECT secret,last_counter FROM staff_mfa WHERE account_id=$1",
      [actor.id],
    );
    if (!result.rowCount)
      throw new ApiError(
        409,
        "MFA_SETUP_REQUIRED",
        "Enroll an authenticator first.",
      );
    const valid = verifyTotp(
      decrypt(result.rows[0].secret),
      code,
      Number(result.rows[0].last_counter),
    );
    if (valid === null)
      throw new ApiError(
        400,
        "MFA_INVALID",
        "The authenticator code is invalid, expired or already used.",
      );
    const updated = await pool.query(
      "UPDATE staff_mfa SET confirmed=true,last_counter=$1 WHERE account_id=$2 AND last_counter<$1",
      [valid, actor.id],
    );
    if (!updated.rowCount)
      throw new ApiError(400, "MFA_REPLAY", "That code has already been used.");
    await redis.set(sessionKey(req), actor.id, { EX: 600 });
    json(res, 200, { ok: true });
    return true;
  }
  if (
    process.env.APP_ENV !== "local" &&
    (await redis.get(sessionKey(req))) !== actor.id
  )
    throw new ApiError(
      403,
      "ADMIN_MFA_REQUIRED",
      "Verify your authenticator in Staff security.",
    );
  return false;
}
