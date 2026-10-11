import test from "node:test";
import assert from "node:assert/strict";
import { capturedPass } from "../services/commerce-operations/payment-state.ts";
import {
  discoveryModes,
  plans,
} from "../services/commerce-operations/plans.ts";
const payment = {
  id: "pay_example",
  order_id: "order_example",
  amount: 49900,
  currency: "INR",
  status: "captured",
  captured: true,
  amount_refunded: 0,
  created_at: 1700000000,
};
test("passes require captured, unrefunded payment matching the stored order and price", () => {
  assert.equal(capturedPass(payment, "order_example", 49900, "INR").paid, true);
  for (const change of [
    { status: "authorized", captured: false },
    { amount_refunded: 1 },
    { status: "failed" },
  ])
    assert.equal(
      capturedPass({ ...payment, ...change }, "order_example", 49900, "INR")
        .paid,
      false,
    );
  for (const change of [
    { order_id: "order_other" },
    { amount: 1 },
    { currency: "USD" },
  ])
    assert.throws(() =>
      capturedPass({ ...payment, ...change }, "order_example", 49900, "INR"),
    );
});
test("tier catalogue prices use paise and progressively grant server-owned ranking modes", () => {
  for (const plan of plans()) assert.equal(plan.amount, plan.priceInr * 100);
  assert.deepEqual(discoveryModes.gold, ["interests"]);
  assert.deepEqual(discoveryModes.diamond, ["interests", "intent"]);
  assert.deepEqual(discoveryModes.platinum, ["interests", "intent", "city"]);
});

test("subscription benefits distinguish every tier and keep privacy free", async () => {
  const { features } = await import("../services/commerce-operations/plans.ts");
  for (const [tier, likes, intros] of [
    [null, 0, 3],
    ["gold", 5, 10],
    ["diamond", 15, 25],
    ["platinum", 30, 50],
  ] as const) {
    assert.deepEqual(features(tier), {
      superLikesPerDay: likes,
      directIntroductionsPerDay: intros,
      hideAge: true,
      hideLocation: true,
    });
  }
});
