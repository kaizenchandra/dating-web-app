import { test, expect } from "@playwright/test";
import {
  member,
  resetOtp,
  connection,
  origin,
} from "../../packages/test-fixtures/browser";
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});
test.beforeAll(() => resetOtp(["+916000000005", "+916000000006"]));
test("two independent accounts discover, match once under concurrency, and block immediately", async ({
  browser,
}) => {
  test.setTimeout(60000);
  const a = await member(browser, "+916000000005", "Kavya", "Woman");
  const b = await member(browser, "+916000000006", "Arjun", "Man");
  try {
    await connection(a.context, b.id, "unblock");
    await connection(b.context, a.id, "unblock");
    await connection(a.context, b.id, "unmatch");
    for (const user of [a, b])
      expect(
        (
          await user.context.request.post(
            origin + "/api/v1/discovery/feedback",
            { headers: { origin }, data: { action: "reset" } },
          )
        ).status(),
      ).toBe(200);
    for (const user of [a, b]) {
      const p = await (
        await user.context.request.get(origin + "/api/v1/profile")
      ).json();
      expect(
        (
          await user.context.request.put(origin + "/api/v1/profile", {
            headers: { origin },
            data: { ...p.profile, interests: ["Books"], longDistance: true },
          })
        ).status(),
      ).toBe(200);
    }
    const bp = await (
      await b.context.request.get(origin + "/api/v1/profile")
    ).json();
    await b.context.request.put(origin + "/api/v1/profile", {
      headers: { origin },
      data: { ...bp.profile, city: "Mumbai" },
    });
    const near = await (
      await a.context.request.get(
        origin + "/api/v1/discovery?city=Mumbai&maxDistanceKm=100",
      )
    ).json();
    expect(near.items.some((p: { id: string }) => p.id === b.id)).toBe(false);
    const far = await (
      await a.context.request.get(
        origin + "/api/v1/discovery?city=Mumbai&maxDistanceKm=1000",
      )
    ).json();
    const card = far.items.find((p: { id: string }) => p.id === b.id);
    expect(card.approximateDistanceKm).toBeGreaterThan(800);
    expect(card.sharedInterests).toContain("Books");
    await b.context.request.put(origin + "/api/v1/profile", {
      headers: { origin },
      data: { ...bp.profile, city: "Bengaluru", longDistance: false },
    });
    await a.page.goto("/discover");
    await a.page.getByLabel("City distance (km)").fill("10");
    await a.page.getByRole("button", { name: "Apply filters" }).click();
    await expect(
      a.page.getByRole("heading", { name: "Arjun, 29", exact: true }),
    ).toBeVisible();
    await expect(
      a.page
        .getByRole("article")
        .filter({
          has: a.page.getByRole("heading", { name: "Arjun, 29", exact: true }),
        })
        .getByText("You both enjoy Books.", { exact: true }),
    ).toBeVisible();
    await a.page
      .getByRole("article")
      .filter({
        has: a.page.getByRole("heading", { name: "Arjun, 29", exact: true }),
      })
      .getByRole("button", { name: "Read & say hello" })
      .click();
    await a.page
      .getByLabel("Why hide this recommendation?")
      .selectOption("interests");
    await a.page
      .getByRole("button", { name: "Hide recommendation", exact: true })
      .click();
    await expect(
      a.page.getByRole("heading", { name: "Arjun, 29", exact: true }),
    ).toHaveCount(0);
    await a.page
      .getByRole("button", { name: "Undo hide", exact: true })
      .click();
    await expect(
      a.page.getByRole("heading", { name: "Arjun, 29", exact: true }),
    ).toBeVisible();
    const feedback = (context: typeof a.context, data: object) =>
      context.request.post(origin + "/api/v1/discovery/feedback", {
        headers: { origin },
        data,
      });
    const hidden = await Promise.all(
      Array.from({ length: 6 }, () =>
        feedback(a.context, {
          action: "hide",
          targetId: b.id,
          reason: "distance",
        }),
      ),
    );
    for (const response of hidden) expect(response.status()).toBe(200);
    expect(
      await (
        await a.context.request.get(origin + "/api/v1/discovery/feedback")
      ).json(),
    ).toEqual({ total: 1, reasons: [{ reason: "distance", count: 1 }] });
    expect(
      (
        await feedback(b.context, { action: "restore", targetId: b.id })
      ).status(),
    ).toBe(422);
    expect(
      (
        await feedback(b.context, { action: "restore", targetId: a.id })
      ).status(),
    ).toBe(200);
    expect(
      (
        await feedback(b.context, { action: "reset", accountId: a.id })
      ).status(),
    ).toBe(422);
    expect(
      (
        await feedback(a.context, {
          action: "hide",
          targetId: b.id,
          reason: "invalid",
        })
      ).status(),
    ).toBe(422);
    await a.page.reload();
    await expect(
      a.page.getByText("Your discovery choices · 1 hidden"),
    ).toBeVisible();
    await expect(
      a.page.getByRole("heading", { name: "Arjun, 29", exact: true }),
    ).toHaveCount(0);
    await a.page.getByText("Your discovery choices · 1 hidden").click();
    await expect(
      a.page.getByText("Too far for me: 1", { exact: true }),
    ).toBeVisible();
    await a.page
      .getByRole("button", {
        name: "Reset hidden recommendations",
        exact: true,
      })
      .click();
    await expect(
      a.page.getByRole("heading", { name: "Arjun, 29", exact: true }),
    ).toBeVisible();
    await a.page
      .getByRole("article")
      .filter({
        has: a.page.getByRole("heading", { name: "Arjun, 29", exact: true }),
      })
      .getByRole("button", { name: "Read & say hello" })
      .click();
    await a.page
      .getByLabel("Direct introduction (optional)", { exact: true })
      .fill("Which book would you take on a long train journey?");
    await a.page.getByRole("button", { name: "Send interest" }).click();
    await expect(
      a.page.getByText(
        "Your interest is sent. A conversation starts with mutual interest.",
      ),
    ).toBeVisible();
    await b.page.goto("/interests");
    await expect(
      b.page.getByText("Which book would you take on a long train journey?"),
    ).toBeVisible();
    await b.page.getByRole("button", { name: "Accept interest" }).click();
    await expect(
      b.page.getByText("It’s mutual. You are now matched."),
    ).toBeVisible();
    const replies = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        connection(i % 2 ? a.context : b.context, i % 2 ? b.id : a.id, "like"),
      ),
    );
    for (const response of replies) expect(response.status()).toBe(200);
    const ids = await Promise.all(
      replies.map(async (r) => (await r.json()).matchId),
    );
    expect(new Set(ids).size).toBe(1);
    for (const user of [a, b]) {
      const data = await (
        await user.context.request.get(origin + "/api/v1/connections")
      ).json();
      expect(data.matches).toHaveLength(1);
      expect(data.matches[0].id).toBe(ids[0]);
    }
    await a.page.goto("/interests");
    await a.page.getByRole("tab", { name: /Matches/ }).click();
    await expect(
      a.page.getByRole("heading", { name: "Arjun, 29", exact: true }),
    ).toBeVisible();
    await a.page.getByRole("button", { name: "Block", exact: true }).click();
    await expect(a.page.getByText("Your choice has been saved.")).toBeVisible();
    expect((await connection(b.context, a.id, "like")).status()).toBe(403);
    for (const user of [a, b]) {
      const state = await (
        await user.context.request.get(origin + "/api/v1/connections")
      ).json();
      expect(state.matches).toHaveLength(0);
      const discovery = await (
        await user.context.request.get(origin + "/api/v1/discovery")
      ).json();
      expect(
        discovery.items.some(
          (p: { id: string }) => p.id === (user === a ? b.id : a.id),
        ),
      ).toBe(false);
    }
    expect(
      (
        await b.context.request.get(
          origin + "/api/v1/discovery/photo?id=" + a.id,
        )
      ).status(),
    ).toBe(404);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
