import { createHmac, timingSafeEqual } from "node:crypto";
export function verifyPaymentSignature(
  raw: Buffer,
  signature: string,
  secret: string,
) {
  if (!secret || !/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(
    createHmac("sha256", secret).update(raw).digest(),
    Buffer.from(signature, "hex"),
  );
}
