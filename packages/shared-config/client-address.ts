import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export function trustedClientAddress(
  headers: Headers,
  secret: string | undefined,
): string | null {
  if (!secret || secret.length < 32) return null;
  const supplied = headers.get("x-raahi-edge-token") || "";
  if (
    Buffer.byteLength(supplied) !== Buffer.byteLength(secret) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))
  )
    return null;
  const address = headers.get("x-raahi-client-address") || "";
  // Reject lists, zones and hostnames. Normalise equivalent IPv6 spellings.
  const family = isIP(address);
  if (family === 4) return address;
  if (family === 6 && !address.includes("%"))
    return new URL("http://[" + address + "]").hostname.slice(1, -1);
  return null;
}
