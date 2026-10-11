import test from "node:test";
import assert from "node:assert/strict";
import { quietNow } from "../services/identity/wellbeing.ts";
test("quiet hours use IST across midnight and equal hours mean all day", () => {
  assert.equal(quietNow(22, 8, new Date("2026-10-11T18:00:00Z")), true);
  assert.equal(quietNow(22, 8, new Date("2026-10-11T04:00:00Z")), false);
  assert.equal(quietNow(9, 17, new Date("2026-10-11T04:00:00Z")), true);
  assert.equal(quietNow(0, 0, new Date()), true);
});
