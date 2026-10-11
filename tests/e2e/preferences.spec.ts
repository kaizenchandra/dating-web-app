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
test("private profile answers stay redacted while reciprocal dealbreakers filter real discovery", async ({
  browser,
}) => {
  test.setTimeout(60000);
  resetOtp(["+916000000028", "+916000000029"]);
  const a = await member(browser, "+916000000028", "Anika", "Woman");
  const b = await member(browser, "+916000000029", "Dev", "Man");
  try {
    await connection(a.context, b.id, "unblock");
    await connection(b.context, a.id, "unblock");
    await connection(a.context, b.id, "unmatch");
    await a.page.goto("/profile");
    await a.page.getByLabel("Smoking", { exact: true }).selectOption("never");
    await a.page
      .getByLabel("Education (optional)", { exact: true })
      .fill("Private university answer");
    await a.page.getByLabel("Interests (separate with commas)").fill("Books");
    await a.page.getByText("Your dealbreakers", { exact: true }).click();
    await a.page
      .getByRole("group", { name: "Smoking you are open to", exact: true })
      .getByLabel("Never", { exact: true })
      .check();
    await a.page.getByText("Choose what others see", { exact: true }).click();
    for (const field of ["education", "smoking answer", "gender", "interests"])
      await a.page
        .getByLabel(`Show ${field} on my public profile`, { exact: true })
        .uncheck();
    await a.page.getByRole("button", { name: "Save your profile" }).click();
    await expect(
      a.page.getByText("Your profile is saved.", { exact: true }),
    ).toBeVisible();
    await a.page.reload();
    await expect(a.page.getByLabel("Smoking", { exact: true })).toHaveValue(
      "never",
    );
    await a.page.getByText("Choose what others see", { exact: true }).click();
    await expect(
      a.page.getByLabel("Show education on my public profile", { exact: true }),
    ).not.toBeChecked();
    await a.page.getByRole("link", { name: "Preview your profile" }).click();
    await expect(
      a.page.getByRole("heading", { name: "Anika", exact: true }),
    ).toBeVisible();
    await expect(
      a.page.getByText("Private university answer", { exact: true }),
    ).toHaveCount(0);
    const visible = (
      await (
        await a.context.request.get(origin + "/api/v1/profile/preview")
      ).json()
    ).profile;
    expect(visible.smoking).toBe("");
    expect(visible.education).toBe("");
    expect(visible.gender).toBe("");
    expect(visible.interests).toEqual([]);
    const own = (
      await (await a.context.request.get(origin + "/api/v1/profile")).json()
    ).profile;
    expect(own.smoking).toBe("never");
    expect(own.education).toBe("Private university answer");
    const bp = (
      await (await b.context.request.get(origin + "/api/v1/profile")).json()
    ).profile;
    const updateB = (patch: object) =>
      b.context.request.put(origin + "/api/v1/profile", {
        headers: { origin },
        data: {
          ...bp,
          interests: ["Books"],
          preferredGender: "Woman",
          ...patch,
        },
      });
    const discover = async (context: typeof a.context) =>
      (await (await context.request.get(origin + "/api/v1/discovery")).json())
        .items as {
        id: string;
        gender: string;
        education: string;
        smoking: string;
        interests: string[];
        sharedInterests: string[];
        dealbreakers?: object;
      }[];
    await updateB({ smoking: "" });
    expect((await discover(a.context)).some((x) => x.id === b.id)).toBe(false);
    await updateB({ smoking: "regularly" });
    expect((await discover(a.context)).some((x) => x.id === b.id)).toBe(false);
    await updateB({
      smoking: "never",
      dealbreakers: { smoking: ["regularly"] },
    });
    expect((await discover(a.context)).some((x) => x.id === b.id)).toBe(false);
    await updateB({ smoking: "never", dealbreakers: { smoking: ["never"] } });
    expect((await discover(a.context)).some((x) => x.id === b.id)).toBe(true);
    const card = (await discover(b.context)).find((x) => x.id === a.id)!;
    expect(card).toBeDefined();
    expect(card.gender).toBe("");
    expect(card.education).toBe("");
    expect(card.smoking).toBe("");
    expect(card.interests).toEqual([]);
    expect(card.sharedInterests).toEqual([]);
    expect(card.dealbreakers).toBeUndefined();
    expect(
      (
        await a.context.request.put(origin + "/api/v1/profile", {
          headers: { origin },
          data: { ...own, hiddenFields: ["phone"] },
        })
      ).status(),
    ).toBe(422);
    expect(
      (
        await a.context.request.put(origin + "/api/v1/profile", {
          headers: { origin },
          data: { ...own, dealbreakers: { smoking: ["never", "never"] } },
        })
      ).status(),
    ).toBe(422);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
