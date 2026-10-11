import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
test("opt-in unsent messages survive a browser restart, retry once and clear on logout", async ({
  browser,
}) => {
  test.setTimeout(90000);
  resetOtp(["+916000000033", "+916000000034"]);
  const a = await member(browser, "+916000000033", "Outbox sender", "Woman"),
    b = await member(browser, "+916000000034", "Outbox recipient", "Man");
  const dir = await mkdtemp(join(tmpdir(), "raahi-outbox-"));
  let device = await chromium.launchPersistentContext(dir, { headless: true });
  try {
    await connection(a.context, b.id, "unblock");
    await connection(b.context, a.id, "unblock");
    await connection(a.context, b.id, "unmatch");
    await connection(a.context, b.id, "like");
    const match = await (await connection(b.context, a.id, "like")).json();
    await device.addCookies(await a.context.cookies());
    let page = await device.newPage();
    await page.goto(origin + "/inbox?match=" + match.matchId);
    await expect(page.getByText("Live", { exact: true })).toBeVisible();
    await page
      .getByText("Unsent messages on this browser", { exact: true })
      .click();
    await page
      .getByLabel("Keep unsent messages when I close this browser")
      .click();
    await expect(
      page.getByLabel("Keep unsent messages when I close this browser"),
    ).toBeChecked();
    await expect(
      page.getByLabel("Keep unsent messages when I close this browser"),
    ).toBeEnabled();
    await page
      .getByLabel("Message", { exact: true })
      .fill("A hello saved on my private browser.");
    await device.setOffline(true);
    await page.getByRole("button", { name: "Send →", exact: true }).click();
    await expect(
      page.getByText("Not confirmed", { exact: true }),
    ).toBeVisible();
    const encrypted = await page.evaluate(
      async () =>
        new Promise<{ count: number; plain: boolean; extractable: boolean }>(
          (resolve) => {
            const r = indexedDB.open("raahi-private-outbox-v1");
            r.onsuccess = () => {
              const db = r.result;
              const tx = db.transaction(["messages", "settings"]);
              const m = tx.objectStore("messages").getAll(),
                s = tx.objectStore("settings").getAll();
              tx.oncomplete = () => {
                resolve({
                  count: m.result.length,
                  plain: JSON.stringify(m.result).includes("A hello saved"),
                  extractable: s.result[0].key.extractable,
                });
                db.close();
              };
            };
          },
        ),
    );
    expect(encrypted).toEqual({ count: 1, plain: false, extractable: false });
    await device.close();
    device = await chromium.launchPersistentContext(dir, { headless: true });
    page = await device.newPage();
    await page.goto(origin + "/inbox?match=" + match.matchId);
    await expect(page.getByText("Live", { exact: true })).toBeVisible();
    await expect(
      page
        .getByRole("log")
        .getByText("A hello saved on my private browser.", { exact: true }),
    ).toBeVisible();
    expect(
      (
        await (
          await b.context.request.get(
            origin + "/api/v1/messages?conversationId=" + match.matchId,
          )
        ).json()
      ).messages.some(
        (m: { text: string }) =>
          m.text === "A hello saved on my private browser.",
      ),
    ).toBe(false);
    await page
      .getByRole("button", { name: "Retry this message", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Retry this message", exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(async () => {
        const history = await (
          await b.context.request.get(
            origin + "/api/v1/messages?conversationId=" + match.matchId,
          )
        ).json();
        return history.messages.filter(
          (m: { text: string }) =>
            m.text === "A hello saved on my private browser.",
        ).length;
      })
      .toBe(1);
    await page
      .getByLabel("Message", { exact: true })
      .fill("Discard this private retry on logout.");
    await device.setOffline(true);
    await page.getByRole("button", { name: "Send →", exact: true }).click();
    await expect(
      page.getByText("Not confirmed", { exact: true }),
    ).toBeVisible();
    await device.setOffline(false);
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    const counts = await page.evaluate(
      async () =>
        new Promise<number[]>((resolve) => {
          const r = indexedDB.open("raahi-private-outbox-v1");
          r.onsuccess = () => {
            const db = r.result;
            const t = db.transaction(["messages", "settings"]),
              m = t.objectStore("messages").count(),
              s = t.objectStore("settings").count();
            t.oncomplete = () => {
              resolve([m.result, s.result]);
              db.close();
            };
          };
        }),
    );
    expect(counts).toEqual([0, 0]);
  } finally {
    await device.close();
    await a.context.close();
    await b.context.close();
    await rm(dir, { recursive: true, force: true });
  }
});
