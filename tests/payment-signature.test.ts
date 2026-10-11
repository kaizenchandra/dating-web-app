import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyPaymentSignature } from "../services/commerce-operations/payment-signature.ts";
test("payment signature authenticates exact raw bytes, rejects malformed and unconfigured secrets", () => {
  const raw = Buffer.from('{"event":"subscription.charged"}');
  const secret = "unit-test-only-webhook-secret";
  const signature = createHmac("sha256", secret).update(raw).digest("hex");
  assert.equal(verifyPaymentSignature(raw, signature, secret), true);
  assert.equal(
    verifyPaymentSignature(Buffer.from(raw + " "), signature, secret),
    false,
  );
  assert.equal(verifyPaymentSignature(raw, signature, ""), false);
  assert.equal(verifyPaymentSignature(raw, "bad", secret), false);
});
