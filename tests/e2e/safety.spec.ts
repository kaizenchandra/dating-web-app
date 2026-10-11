import sharp from "sharp";
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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
test("confidential reports survive unmatch, staff suspend access and member appeals", async ({
  browser,
}) => {
  test.setTimeout(90000);
  resetOtp(["+916000000011", "+916000000012", "+916000000013"]);
  const a = await member(browser, "+916000000011", "Mira", "Woman");
  const b = await member(browser, "+916000000012", "Kabir", "Man");
  const staff = await member(browser, "+916000000013", "Reviewer", "Woman");
  try {
    await connection(a.context, b.id, "unblock");
    await connection(b.context, a.id, "unblock");
    await connection(a.context, b.id, "unmatch");
    await connection(a.context, b.id, "like");
    const matched = await (await connection(b.context, a.id, "like")).json();
    const imageBytes = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#c9bbf1" },
    })
      .png()
      .toBuffer();
    const upload = await b.context.request.post(
      origin + "/api/v1/messages/image",
      {
        headers: { origin },
        data: {
          conversationId: matched.matchId,
          clientImageId: randomUUID(),
          data: imageBytes.toString("base64"),
        },
      },
    );
    expect(upload.status()).toBe(200);
    const imageId = (await upload.json()).id;
    const sent = await b.context.request.post(origin + "/api/v1/messages", {
      headers: { origin },
      data: {
        conversationId: matched.matchId,
        clientMessageId: randomUUID(),
        text: "Message preserved for a confidential report.",
        imageId,
      },
    });
    expect(sent.status()).toBe(200);
    const message = await sent.json();
    await connection(a.context, b.id, "unmatch");
    await a.page.goto("/safety?kind=message&subject=" + message.id);
    await a.page.getByLabel("Reason", { exact: true }).fill("Unwanted contact");
    await a.page
      .getByLabel("What happened?")
      .fill("I would like a moderator to review this conversation.");
    await a.page
      .getByRole("button", { name: "Submit confidential request" })
      .click();
    await expect(a.page.getByRole("status")).toContainText("received");
    await a.page.reload();
    await expect(
      a.page.getByRole("heading", { name: "Unwanted contact" }).first(),
    ).toBeVisible();
    expect(
      (await b.context.request.get(origin + "/api/v1/reports")).status(),
    ).toBe(200);
    const own = await (
      await b.context.request.get(origin + "/api/v1/reports")
    ).json();
    expect(
      own.reports.some(
        (r: { reason: string }) => r.reason === "Unwanted contact",
      ),
    ).toBe(false);
    expect(
      (await a.context.request.get(origin + "/api/v1/admin/reports")).status(),
    ).toBe(403);
    expect(
      (
        await staff.context.request.post(origin + "/api/v1/reports", {
          headers: { origin },
          data: {
            kind: "message",
            subjectId: message.id,
            reason: "Invalid ownership",
            detail: "This account was not a conversation participant.",
          },
        })
      ).status(),
    ).toBe(404);
    execFileSync("node", ["infra/scripts/grant-local-reviewer.mjs", staff.id], {
      stdio: "pipe",
      env: process.env,
    });
    await staff.page.goto("/admin/reports");
    const row = staff.page.locator("form").filter({ hasText: message.id });
    await row.getByText("Preserved evidence", { exact: true }).click();
    await expect(row.getByAltText("Reported image evidence")).toBeVisible();
    await row.getByLabel("Action", { exact: true }).selectOption("suspend");
    await row
      .getByLabel("Response and audit reason")
      .fill("Account access restricted pending review.");
    await row.getByRole("button", { name: "Record action" }).click();
    await expect(row).toContainText("resolved");
    expect(
      (await b.context.request.get(origin + "/api/v1/account")).status(),
    ).toBe(401);
    resetOtp(["+916000000012"]);
    await b.page.goto("/login");
    await b.page.getByLabel("Indian mobile number").fill("6000000012");
    await b.page.getByRole("button", { name: "Send local test code" }).click();
    await b.page
      .getByLabel("Six-digit code")
      .fill(await b.page.getByTestId("local-code").innerText());
    await b.page.getByRole("button", { name: "Verify & continue" }).click();
    await expect(b.page).toHaveURL(/safety/);
    await b.page
      .getByLabel("Reason", { exact: true })
      .fill("Request reconsideration");
    await b.page
      .getByLabel("What happened?")
      .fill("Please review the context of this restriction.");
    await b.page
      .getByRole("button", { name: "Submit confidential request" })
      .click();
    await expect(b.page.getByRole("status")).toContainText("received");
    expect(
      (await b.context.request.get(origin + "/api/v1/discovery")).status(),
    ).toBe(403);
    const appeals = await (
      await b.context.request.get(origin + "/api/v1/reports")
    ).json();
    const appeal = appeals.reports.find(
      (r: { kind: string }) => r.kind === "appeal",
    );
    expect(
      (
        await staff.context.request.post(
          origin + "/api/v1/admin/reports/action",
          {
            headers: { origin },
            data: {
              reportId: appeal.id,
              action: "restore",
              resolution: "Local acceptance test review completed.",
            },
          },
        )
      ).status(),
    ).toBe(200);
  } finally {
    await a.context.close();
    await b.context.close();
    await staff.context.close();
  }
});
