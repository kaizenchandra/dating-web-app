import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
const servers = z.array(
  z.object({
    urls: z.union([z.string(), z.array(z.string())]),
    username: z.string().optional(),
    credential: z.string().optional(),
  }),
);
export function callConfiguration(now = Date.now()) {
  const iceServers = servers.parse(
    JSON.parse(process.env.WEBRTC_ICE_SERVERS || "[]"),
  );
  const urls = z
    .array(z.string().regex(/^turns?:[^\s]+$/))
    .max(6)
    .parse(JSON.parse(process.env.TURN_URLS || "[]"));
  let expiresIn = 0;
  if (urls.length) {
    const secret = process.env.TURN_SHARED_SECRET;
    if (!secret || secret.length < 32)
      throw new Error(
        "TURN shared secret must be configured with at least 32 characters",
      );
    expiresIn = 600;
    // Random suffix avoids placing account identifiers in relay logs.
    const username = `${Math.floor(now / 1000) + expiresIn}:${randomUUID()}`;
    iceServers.push({
      urls,
      username,
      credential: createHmac("sha1", secret).update(username).digest("base64"),
    });
  }
  const turnConfigured = iceServers.some((s) =>
    (Array.isArray(s.urls) ? s.urls : [s.urls]).some(
      (u) => u.startsWith("turn:") || u.startsWith("turns:"),
    ),
  );
  if (process.env.APP_ENV !== "local" && !urls.length && turnConfigured)
    throw new Error("Deployed TURN requires temporary credentials");
  const iceTransportPolicy =
    process.env.WEBRTC_RELAY_ONLY === "true" ? "relay" : "all";
  if (iceTransportPolicy === "relay" && !turnConfigured)
    throw new Error("Relay-only calling requires TURN");
  return { iceServers, turnConfigured, expiresIn, iceTransportPolicy };
}
