import { test } from "node:test";
import assert from "node:assert/strict";
import { ageYears } from "../services/identity/verification.ts";
test("age threshold changes only on birthday in UTC", () => {
  assert.equal(ageYears("2008-10-12", new Date("2026-10-11T23:59:59Z")), 17);
  assert.equal(ageYears("2008-10-12", new Date("2026-10-12T00:00:00Z")), 18);
});
