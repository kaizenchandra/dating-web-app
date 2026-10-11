import { createHmac, timingSafeEqual } from "node:crypto";
export function totp(secret: Buffer, counter: number, digits = 6) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(buffer).digest();
  const offset = digest.at(-1)! & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits)
    .toString()
    .padStart(digits, "0");
}
export function verifyTotp(
  secret: Buffer,
  code: string,
  last: number,
  now = Date.now(),
) {
  const counter = Math.floor(now / 30000);
  for (const candidate of [counter - 1, counter, counter + 1]) {
    const expected = totp(secret, candidate);
    if (
      candidate > last &&
      code.length === 6 &&
      timingSafeEqual(Buffer.from(code), Buffer.from(expected))
    )
      return candidate;
  }
  return null;
}
export function base32(bytes: Buffer) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let value = 0,
    bits = 0,
    out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
