import { test, expect } from "@playwright/test";
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
test("export, consent withdrawal and durable deletion erase owned records across services", async ({
  browser,
}) => {
  test.setTimeout(90000);
  resetOtp(["+916000000014", "+916000000015"]);
  const a = await member(browser, "+916000000014", "Leela", "Woman");
  const b = await member(browser, "+916000000015", "Aryan", "Man");
  try {
    await connection(a.context, b.id, "unblock");
    await connection(b.context, a.id, "unblock");
    expect(
      (
        await a.context.request.post(origin + "/api/v1/discovery/feedback", {
          headers: { origin },
          data: { action: "hide", targetId: b.id, reason: "intent" },
        })
      ).status(),
    ).toBe(200);
    await connection(a.context, b.id, "like");
    const match = await (await connection(b.context, a.id, "like")).json();
    expect(match.matched).toBe(true);
    const sent = await a.context.request.post(origin + "/api/v1/messages", {
      headers: { origin },
      data: {
        conversationId: match.matchId,
        clientMessageId: randomUUID(),
        text: "A private message included only in my sent export.",
      },
    });
    expect(sent.status()).toBe(200);
    await a.page.goto("/privacy-control");
    const downloadPromise = a.page.waitForEvent("download");
    await a.page.getByRole("button", { name: "Download my data" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("raahi-personal-data.json");
    const stream = await download.createReadStream();
    let raw = "";
    for await (const chunk of stream!) raw += chunk.toString();
    const data = JSON.parse(raw);
    expect(data.identity.id).toBe(a.id);
    expect(data.communication.sentMessages).toHaveLength(1);
    expect(data["profile-discovery"][0].profile.displayName).toBe("Leela");
    expect(data["profile-discovery"][0].discoveryFeedback).toEqual([
      expect.objectContaining({ targetId: b.id, reason: "intent" }),
    ]);
    await a.page.getByRole("button", { name: "Withdraw consent" }).click();
    await expect(a.page.getByRole("status")).toContainText("Consent withdrawn");
    expect(
      (await a.context.request.get(origin + "/api/v1/discovery")).status(),
    ).toBe(403);
    expect(
      (
        await b.context.request.post(origin + "/api/v1/messages", {
          headers: { origin },
          data: {
            conversationId: match.matchId,
            clientMessageId: randomUUID(),
            text: "Not accepted after consent withdrawal",
          },
        })
      ).status(),
    ).toBe(403);
    await a.page.getByLabel("Type DELETE to confirm").fill("DELETE");
    await a.page.evaluate(() => {
      indexedDB.open = () => {
        throw new DOMException("Storage disabled", "SecurityError");
      };
    });
    await a.page
      .getByRole("button", { name: "Permanently delete my account" })
      .click();
    await expect(a.page.getByRole("status")).toContainText(
      "Browser storage could not be cleared",
    );
    await expect(
      a.page.getByRole("heading", { name: "Deletion: complete", exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await a.page.reload();
    await expect(
      a.page.getByRole("heading", { name: "Deletion: complete", exact: true }),
    ).toBeVisible();
    expect(
      (await a.context.request.get(origin + "/api/v1/account")).status(),
    ).toBe(401);
    // Read through each service-owned API using internal auth inside its own container.
    const { execFileSync } = await import("node:child_process");
    const output = execFileSync(
      process.env.DOCKER_BIN || "docker",
      [
        "compose",
        "--env-file",
        ".env.local",
        "-f",
        "infra/compose/compose.yml",
        "exec",
        "-T",
        "identity",
        "node",
        "--input-type=module",
        "-e",
        `const id=process.argv[1];for(const s of ['profile-discovery','connections','communication']){const r=await fetch('http://'+s+':4000/internal/privacy/export?accountId='+id,{headers:{authorization:'Bearer '+JSON.parse(process.env.SERVICE_TOKENS)[s]}});if(!r.ok)throw Error(s);console.log(JSON.stringify({service:s,data:await r.json()}))}`,
        a.id,
      ],
      { encoding: "utf8" },
    );
    const rows = output
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x));
    expect(rows.find((x) => x.service === "profile-discovery").data).toEqual(
      [],
    );
    expect(rows.find((x) => x.service === "connections").data).toEqual([]);
    expect(
      rows.find((x) => x.service === "communication").data.sentMessages[0].text,
    ).toBe("[Removed by account deletion]");
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
