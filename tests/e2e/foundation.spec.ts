import { test, expect } from "@playwright/test";
test("landing leads to live gateway readiness", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("link", { name: "Platform status · Development preview" })
    .click();
  await expect(page.getByText("identity", { exact: true })).toBeVisible();
  await expect(page.getByText("ready", { exact: true })).toHaveCount(5);
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByText("ready", { exact: true })).toHaveCount(5);
});
for (const width of [320, 375, 390, 768, 820, 1024, 1280, 1440])
  test(`landing fits ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
