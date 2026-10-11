import { tmpdir } from "node:os";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { member, resetOtp } from "../../packages/test-fixtures/browser";
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});
test("authenticated screens fit all required widths and pass automated WCAG AA checks", async ({
  browser,
}) => {
  test.setTimeout(180000);
  resetOtp(["+916000000019"]);
  const user = await member(browser, "+916000000019", "Anaya", "Woman");
  try {
    const routes = [
      "/profile",
      "/profile/preview",
      "/discover",
      "/interests",
      "/inbox",
      "/settings",
      "/safety",
      "/privacy-control",
      "/premium",
      "/communities",
      "/wellbeing",
    ];
    for (const width of [320, 375, 390, 768, 820, 1024, 1280, 1440]) {
      await user.page.setViewportSize({ width, height: 900 });
      for (const route of routes) {
        await user.page.goto(route);
        await user.page.waitForLoadState("networkidle");
        const overflow = await user.page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1,
        );
        expect(overflow, route + " overflow at " + width).toBe(false);
      }
      if ([390, 820, 1440].includes(width)) {
        await user.page.goto("/discover");
        await user.page.waitForLoadState("networkidle");
        await user.page.screenshot({
          path: `${tmpdir()}/raahi-discover-${width}.png`,
          fullPage: true,
        });
      }
    }
    await user.page.setViewportSize({ width: 390, height: 844 });
    for (const route of ["/", "/login", ...routes]) {
      await user.page.goto(route);
      await user.page.waitForLoadState("networkidle");
      const result = await new AxeBuilder({ page: user.page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(
        result.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => n.target),
        })),
        route,
      ).toEqual([]);
    }
    await user.page.goto("/wellbeing");
    await user.page.getByLabel("Navigation language / भाषा").selectOption("hi");
    await user.page.getByLabel("Quiet hours / शांत समय").check();
    await user.page.getByLabel("Start hour (IST)").fill("0");
    await user.page.getByLabel("End hour (IST)").fill("0");
    await user.page
      .getByRole("button", { name: "Save preferences", exact: true })
      .click();
    await expect(user.page.getByRole("status")).toContainText(
      "Preferences saved",
    );
    await user.page.reload();
    await expect(
      user.page.getByLabel("Navigation language / भाषा"),
    ).toHaveValue("hi");
    await user.page.goto("/discover");
    await expect(
      user.page
        .getByRole("navigation", { name: "Member navigation" })
        .getByRole("link", { name: "खोजें", exact: true }),
    ).toBeVisible();
  } finally {
    await user.context.close();
  }
});
