import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { callConfiguration } from "../services/communication/turn.ts";
test("TURN credentials expire, contain no account ID and keep the shared secret server-side", () => {
  const names = [
    "TURN_URLS",
    "TURN_SHARED_SECRET",
    "WEBRTC_ICE_SERVERS",
    "WEBRTC_RELAY_ONLY",
    "APP_ENV",
  ];
  const previous = Object.fromEntries(names.map((k) => [k, process.env[k]]));
  try {
    process.env.APP_ENV = "local";
    process.env.TURN_URLS = '["turn:127.0.0.1:3478?transport=udp"]';
    process.env.TURN_SHARED_SECRET = "a".repeat(64);
    process.env.WEBRTC_RELAY_ONLY = "true";
    process.env.WEBRTC_ICE_SERVERS = "[]";
    const now = 1800000000000,
      result = callConfiguration(now),
      server = result.iceServers[0];
    assert.equal(result.expiresIn, 600);
    assert.equal(result.iceTransportPolicy, "relay");
    assert.equal(Number(server.username!.split(":")[0]), now / 1000 + 600);
    assert.equal(
      server.credential,
      createHmac("sha1", process.env.TURN_SHARED_SECRET)
        .update(server.username!)
        .digest("base64"),
    );
    assert.ok(!JSON.stringify(result).includes(process.env.TURN_SHARED_SECRET));
    assert.notEqual(
      callConfiguration(now).iceServers[0].username,
      server.username,
    );
    delete process.env.TURN_SHARED_SECRET;
    assert.throws(() => callConfiguration(now));
  } finally {
    for (const k of names) {
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k];
    }
  }
});
