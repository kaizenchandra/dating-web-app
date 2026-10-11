import { test } from "node:test";
import assert from "node:assert/strict";
import { trustedClientAddress } from "../packages/shared-config/client-address.ts";
const secret = "a".repeat(64);
test("edge addresses require a separate secret and a single canonical IP", () => {
  const headers = new Headers({
    "x-raahi-edge-token": secret,
    "x-raahi-client-address": "2001:0db8:0:0:0:0:0:1",
  });
  assert.equal(trustedClientAddress(headers, secret), "2001:db8::1");
  for (const invalid of [
    "1.2.3.4, 5.6.7.8",
    "localhost",
    "fe80::1%eth0",
    "",
    "999.1.1.1",
  ]) {
    headers.set("x-raahi-client-address", invalid);
    assert.equal(trustedClientAddress(headers, secret), null);
  }
  headers.set("x-raahi-client-address", "192.0.2.5");
  assert.equal(trustedClientAddress(headers, secret), "192.0.2.5");
  headers.set("x-raahi-edge-token", "b".repeat(64));
  assert.equal(trustedClientAddress(headers, secret), null);
  assert.equal(trustedClientAddress(headers, undefined), null);
});
