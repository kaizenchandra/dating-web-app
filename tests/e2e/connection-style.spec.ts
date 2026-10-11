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
test("connection style persists, filters respect visibility and introductions respect recipient choice", async ({
  browser,
}) => {
  test.setTimeout(90000);
  resetOtp(["+916000000081", "+916000000082"]);
  const a = await member(browser, "+916000000081", "Modern sender", "Woman");
  const b = await member(browser, "+916000000082", "Modern recipient", "Man");
  const headers = { origin };
  try {
    await connection(a.context, b.id, "unblock");
    await connection(b.context, a.id, "unblock");
    await connection(a.context, b.id, "unmatch");
    for (const u of [a, b]) {
      const data = await (
        await u.context.request.get(origin + "/api/v1/profile")
      ).json();
      expect(
        (
          await u.context.request.put(origin + "/api/v1/profile", {
            headers,
            data: {
              ...data.profile,
              city: "Kochi",
              intent: "Modern test connection",
              hiddenFields: [],
              datingPace: "",
              dateVibes: [],
              openingQuestion: "",
              introductionPolicy: "everyone",
            },
          })
        ).ok(),
      ).toBe(true);
      await u.context.request.post(origin + "/api/v1/discovery/feedback", {
        headers,
        data: { action: "reset" },
      });
    }
    await b.page.goto("/profile");
    await b.page
      .getByLabel("My dating pace", { exact: true })
      .selectOption("slow_and_steady");
    await b.page.getByLabel("Chai or coffee", { exact: true }).check();
    await b.page.getByLabel("A video hello first", { exact: true }).check();
    await b.page
      .getByLabel("A question someone can answer", { exact: true })
      .fill("Which small adventure would you plan for Sunday?");
    await b.page
      .getByLabel("Who can send me a direct introduction?", { exact: true })
      .selectOption("matches_only");
    await b.page.getByRole("button", { name: "Save your profile" }).click();
    await expect(
      b.page.getByText("Your profile is saved.", { exact: true }),
    ).toBeVisible();
    await b.page.reload();
    await expect(
      b.page.getByLabel("My dating pace", { exact: true }),
    ).toHaveValue("slow_and_steady");
    await b.page.goto("/profile/preview");
    await expect(
      b.page.getByText("Which small adventure would you plan for Sunday?", {
        exact: true,
      }),
    ).toBeVisible();
    const allowance = async () =>
      (
        await a.context.request.get(origin + "/api/v1/connections/allowance")
      ).json();
    const before = await allowance();
    const send = () =>
      a.context.request.post(origin + "/api/v1/connections/action", {
        headers,
        data: {
          targetId: b.id,
          action: "like",
          introduction: "A bookshop followed by chai sounds lovely.",
        },
      });
    expect((await send()).status()).toBe(403);
    expect((await allowance()).directIntroductionsUsed).toBe(
      before.directIntroductionsUsed,
    );
    const find = async (query: string) => {
      let cursor = "";
      for (let n = 0; n < 20; n++) {
        const response = await a.context.request.get(
          origin +
            "/api/v1/discovery?" +
            query +
            (cursor ? "&cursor=" + cursor : ""),
        );
        expect(response.ok()).toBe(true);
        const data = await response.json();
        const person = data.items.find((p: { id: string }) => p.id === b.id);
        if (person) return person;
        if (!data.nextCursor) return null;
        cursor = data.nextCursor;
      }
      throw Error("Discovery pagination did not terminate");
    };
    expect(await find("datingPace=meet_soon")).toBeNull();
    expect(
      await find("datingPace=slow_and_steady&dateVibe=video_first"),
    ).toMatchObject({ id: b.id, introductionPolicy: "matches_only" });
    const profile = await (
      await b.context.request.get(origin + "/api/v1/profile")
    ).json();
    expect(
      (
        await b.context.request.put(origin + "/api/v1/profile", {
          headers,
          data: { ...profile.profile, dateVibes: ["games", "games"] },
        })
      ).status(),
    ).toBe(422);
    await b.context.request.put(origin + "/api/v1/profile", {
      headers,
      data: {
        ...profile.profile,
        hiddenFields: ["datingPace", "dateVibes", "openingQuestion"],
      },
    });
    expect(await find("datingPace=slow_and_steady")).toBeNull();
    const hidden = await find("");
    expect(hidden).toMatchObject({
      datingPace: "",
      dateVibes: [],
      openingQuestion: "",
    });
    await b.context.request.put(origin + "/api/v1/profile", {
      headers,
      data: {
        ...profile.profile,
        hiddenFields: [],
        introductionPolicy: "everyone",
      },
    });
    await a.page.goto("/discover");
    await a.page
      .getByLabel("Dating pace", { exact: true })
      .selectOption("slow_and_steady");
    await a.page
      .getByLabel("First-date preference", { exact: true })
      .selectOption("video_first");
    await a.page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click();
    const card = a.page
      .getByRole("article")
      .filter({
        has: a.page.getByRole("heading", { name: /Modern recipient/ }),
      });
    for (let i = 0; i < 20; i++) {
      await a.page.waitForLoadState("networkidle");
      if (await card.count()) break;
      await a.page.getByRole("button", { name: "Next profiles" }).click();
    }
    await card.getByRole("button", { name: "Read & say hello" }).click();
    await a.page
      .getByRole("button", { name: "Answer their question", exact: true })
      .click();
    await expect(
      a.page.getByLabel("Direct introduction (optional)", { exact: true }),
    ).toHaveValue(/Which small adventure/);
    const unsent = await (
      await b.context.request.get(origin + "/api/v1/connections")
    ).json();
    expect(
      unsent.incoming.some(
        (p: { person: { id: string } }) => p.person.id === a.id,
      ),
    ).toBe(false);
    await a.page
      .getByLabel("Direct introduction (optional)", { exact: true })
      .fill("A bookshop followed by chai sounds lovely.");
    await a.page.getByRole("button", { name: "Send interest" }).click();
    await expect(
      a.page.getByText(
        "Your interest is sent. A conversation starts with mutual interest.",
        { exact: true },
      ),
    ).toBeVisible();
    await b.page.goto("/interests");
    const incoming = b.page
      .getByRole("article")
      .filter({ has: b.page.getByRole("heading", { name: /Modern sender/ }) });
    await expect(
      incoming.getByText("A bookshop followed by chai sounds lovely.", {
        exact: true,
      }),
    ).toBeVisible();
    await incoming
      .getByRole("button", { name: "Accept interest", exact: true })
      .click();
    await expect(b.page.getByRole("status")).toContainText("now matched");
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
