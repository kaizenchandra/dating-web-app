import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
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
test("private chat images persist, retry once, reject misuse and disappear on deletion", async ({
  browser,
}) => {
  test.setTimeout(90000);
  resetOtp(["+916000000035", "+916000000036"]);
  const a = await member(browser, "+916000000035", "Meera", "Woman"),
    b = await member(browser, "+916000000036", "Kabir", "Man");
  try {
    await connection(a.context, b.id, "unblock");
    await connection(b.context, a.id, "unblock");
    await connection(a.context, b.id, "unmatch");
    await connection(a.context, b.id, "like");
    const { matchId: id } = await (
      await connection(b.context, a.id, "like")
    ).json();
    const png = await sharp({
      create: { width: 40, height: 40, channels: 3, background: "#ff876f" },
    })
      .withExif({ IFD0: { Artist: "Private metadata" } })
      .png()
      .toBuffer();
    await a.page.goto("/inbox?match=" + id);
    await b.page.goto("/inbox?match=" + id);
    await a.page.getByText("Send an image", { exact: true }).click();
    await a.page
      .getByLabel("Choose image", { exact: true })
      .setInputFiles({ name: "hello.png", mimeType: "image/png", buffer: png });
    await expect(a.page.getByAltText("Image ready to send")).toBeVisible();
    await a.page
      .getByLabel("Image caption (optional)")
      .fill("A little colour for your day");
    await a.page
      .getByRole("button", { name: "Send image", exact: true })
      .click();
    await expect(
      b.page
        .getByRole("log")
        .getByText("A little colour for your day", { exact: true }),
    ).toBeVisible();
    await expect(
      b.page.getByRole("log").getByAltText("Shared image"),
    ).toBeVisible();
    await expect
      .poll(() =>
        b.page
          .getByRole("log")
          .getByAltText("Shared image")
          .evaluate((e: HTMLImageElement) => e.naturalWidth),
      )
      .toBeGreaterThan(0);
    const history = await (
      await b.context.request.get(
        origin + "/api/v1/messages?conversationId=" + id,
      )
    ).json();
    const sent = history.messages.find(
      (m: { text: string }) => m.text === "A little colour for your day",
    );
    const imageUrl = origin + "/api/v1/messages/image?id=" + sent.imageId;
    const image = await b.context.request.get(imageUrl);
    expect(image.status()).toBe(200);
    expect(image.headers()["cache-control"]).toContain("no-store");
    const metadata = await sharp(await image.body()).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.exif).toBeUndefined();
    const anonymous = await browser.newContext();
    expect((await anonymous.request.get(imageUrl)).status()).toBe(401);
    await anonymous.close();
    expect(
      (
        await b.context.request.post(origin + "/api/v1/messages", {
          headers: { origin },
          data: {
            conversationId: id,
            clientMessageId: randomUUID(),
            text: "",
            imageId: sent.imageId,
          },
        })
      ).status(),
    ).toBe(403);
    const payload = {
      conversationId: id,
      clientImageId: randomUUID(),
      data: png.toString("base64"),
    };
    const uploads = await Promise.all(
      [1, 2, 3].map(() =>
        a.context.request.post(origin + "/api/v1/messages/image", {
          headers: { origin },
          data: payload,
        }),
      ),
    );
    for (const r of uploads) expect(r.status()).toBe(200);
    const ids = await Promise.all(
      uploads.map(async (r) => (await r.json()).id),
    );
    expect(new Set(ids).size).toBe(1);
    expect(
      (
        await b.context.request.get(
          origin + "/api/v1/messages/image?id=" + ids[0],
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await a.context.request.post(origin + "/api/v1/messages/image", {
          headers: { origin },
          data: {
            ...payload,
            data: Buffer.from("not an image").toString("base64"),
          },
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await a.context.request.post(origin + "/api/v1/messages/image", {
          headers: { origin },
          data: {
            ...payload,
            clientImageId: randomUUID(),
            data: Buffer.from("not an image").toString("base64"),
          },
        })
      ).status(),
    ).toBe(415);
    const retry = {
      conversationId: id,
      clientMessageId: randomUUID(),
      text: "",
      imageId: ids[0],
    };
    const sends = await Promise.all(
      [1, 2, 3].map(() =>
        a.context.request.post(origin + "/api/v1/messages", {
          headers: { origin },
          data: retry,
        }),
      ),
    );
    for (const r of sends) expect(r.status()).toBe(200);
    expect(
      new Set(await Promise.all(sends.map(async (r) => (await r.json()).id)))
        .size,
    ).toBe(1);
    execFileSync(
      process.env.DOCKER_BIN || "docker",
      [
        "compose",
        "--env-file",
        ".env.local",
        "-f",
        "infra/compose/compose.yml",
        "restart",
        "communication",
      ],
      { stdio: "pipe" },
    );
    await expect
      .poll(
        async () => {
          try {
            return (await b.context.request.get(imageUrl)).status();
          } catch {
            return 0;
          }
        },
        { timeout: 20000 },
      )
      .toBe(200);
    await b.page.reload();
    await expect(
      b.page.getByRole("log").getByAltText("Shared image"),
    ).toHaveCount(2);
    await connection(a.context, b.id, "block");
    expect((await b.context.request.get(imageUrl)).status()).toBe(403);
    expect(
      (
        await b.context.request.post(origin + "/api/v1/messages/image", {
          headers: { origin },
          data: { ...payload, clientImageId: randomUUID() },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await a.context.request.post(origin + "/api/v1/account/delete", {
          headers: { origin },
          data: { confirmation: "DELETE" },
        })
      ).status(),
    ).toBe(200);
    await expect
      .poll(
        async () =>
          (
            await (
              await a.context.request.get(origin + "/api/v1/account/deletion")
            ).json()
          ).status,
        { timeout: 20000 },
      )
      .toBe("complete");
    expect((await b.context.request.get(imageUrl)).status()).toBe(404);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
