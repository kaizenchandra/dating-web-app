import { test, expect } from "@playwright/test";
import { member, resetOtp, origin } from "../../packages/test-fixtures/browser";
import { randomUUID } from "node:crypto";
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});
test("membership catalogue, billing choices and unpaid access restrictions use real services", async ({
  browser,
}) => {
  test.setTimeout(60000);
  resetOtp(["+916000000034"]);
  const user = await member(
    browser,
    "+916000000034",
    "Membership tester",
    "Woman",
  );
  try {
    await user.page.goto("/premium");
    for (const name of ["Gold", "Diamond", "Platinum"])
      await expect(
        user.page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
    const result = await user.context.request.get(origin + "/api/v1/premium");
    const data = await result.json();
    expect(data.plans.map((p: { id: string }) => p.id)).toEqual([
      "gold",
      "diamond",
      "platinum",
    ]);
    expect(data.active).toBe(false);
    await user.page.getByLabel("Billing option").selectOption("month_pass");
    await expect(user.page.getByText(/Apple Pay appears only/)).toBeVisible();
    await user.page.reload();
    await expect(
      user.page.getByRole("heading", { name: "Platinum", exact: true }),
    ).toBeVisible();
    const post = (path: string, body: unknown) =>
      user.context.request.post(origin + "/api/v1" + path, {
        headers: { origin },
        data: body,
      });
    expect(
      (
        await post("/premium/checkout", {
          tier: "invented",
          billingMode: "recurring",
        })
      ).ok(),
    ).toBe(false);
    expect(
      (
        await post("/premium/checkout", {
          tier: "gold",
          billingMode: "month_pass",
          amount: 1,
        })
      ).ok(),
    ).toBe(false);
    expect(
      (
        await post("/premium/verify", {
          id: randomUUID(),
          paymentId: "pay_unowned",
          signature: "0".repeat(64),
        })
      ).status(),
    ).toBe(404);
    for (const ranking of ["interests", "intent", "city"])
      expect(
        (
          await user.context.request.get(
            origin + "/api/v1/discovery?ranking=" + ranking,
          )
        ).status(),
      ).toBe(403);
    if (!data.configured) {
      await expect(user.page.getByText(/Checkout unavailable:/)).toBeVisible();
      expect(
        (
          await post("/premium/checkout", {
            tier: "gold",
            billingMode: "month_pass",
          })
        ).status(),
      ).toBe(503);
      await expect(
        user.page.getByRole("button", { name: "Choose Gold" }),
      ).toBeDisabled();
    }
  } finally {
    await user.context.close();
  }
});
