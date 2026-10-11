import test from "node:test";
import assert from "node:assert/strict";
import { totp, verifyTotp } from "../services/commerce-operations/totp.ts";
test("TOTP matches RFC 6238 SHA1 vector and rejects replay/expired codes", () => {
  const key = Buffer.from("12345678901234567890");
  assert.equal(totp(key, 1, 8), "94287082");
  const code = totp(key, 100);
  assert.equal(verifyTotp(key, code, 99, 3000000), 100);
  assert.equal(verifyTotp(key, code, 100, 3000000), null);
  assert.equal(verifyTotp(key, code, 0, 3090000), null);
});
