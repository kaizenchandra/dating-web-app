import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
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
test("host review, community membership, group messages, concurrent registration and leave permissions", async ({
  browser,
}) => {
  test.setTimeout(90000);
  resetOtp(["+916000000016", "+916000000017", "+916000000018"]);
  const host = await member(browser, "+916000000016", "Tara", "Woman");
  const guest = await member(browser, "+916000000017", "Neel", "Man");
  const staff = await member(browser, "+916000000018", "Care team", "Woman");
  try {
    await connection(host.context, guest.id, "unblock");
    await connection(guest.context, host.id, "unblock");
    const old = await (
      await host.context.request.get(origin + "/api/v1/communities")
    ).json();
    for (const g of old.groups || [])
      if (g.host)
        await host.context.request.post(
          origin + "/api/v1/communities/membership",
          { headers: { origin }, data: { groupId: g.id, action: "close" } },
        );
    await host.page.goto("/communities");
    if (old.hostStatus !== "approved") {
      await host.page
        .getByLabel("Your hosting experience and plans")
        .fill(
          "I host small public book discussions and will review venue accessibility.",
        );
      await host.page.getByRole("button", { name: "Apply to host" }).click();
      await expect(host.page.getByRole("status")).toContainText("received");
    }
    execFileSync("node", ["infra/scripts/grant-local-reviewer.mjs", staff.id], {
      stdio: "pipe",
      env: process.env,
    });
    // Enroll a real TOTP secret through the staff UI; reset only this reserved local fixture.
    execFileSync(
      process.env.DOCKER_BIN || "docker",
      [
        "compose",
        "--env-file",
        ".env.local",
        "-f",
        "infra/compose/compose.yml",
        "exec",
        "-T",
        "commerce-operations",
        "node",
        "--input-type=module",
        "-e",
        `import pg from 'pg';if(process.env.APP_ENV!=='local')throw Error('Local fixtures only');const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();await db.query('DELETE FROM staff_mfa WHERE account_id=$1',[process.argv[1]]);await db.end();`,
        staff.id,
      ],
      { stdio: "pipe" },
    );
    await staff.page.goto("/admin/security");
    await staff.page
      .getByRole("button", { name: "Enroll authenticator" })
      .click();
    const encoded = await staff.page.locator("code").innerText();
    let bits = 0,
      value = 0;
    const bytes: number[] = [];
    for (const char of encoded) {
      value = (value << 5) | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(char);
      bits += 5;
      if (bits >= 8) {
        bytes.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }
    const { totp } = await import("../../services/commerce-operations/totp");
    const code = totp(Buffer.from(bytes), Math.floor(Date.now() / 30000));
    await staff.page.getByLabel("Authenticator code").fill(code);
    await staff.page
      .getByRole("button", { name: "Verify authenticator", exact: true })
      .click();
    await expect(staff.page.getByRole("status")).toContainText(
      "Authenticator verified",
    );
    expect(
      (
        await staff.context.request.post(origin + "/api/v1/admin/mfa/verify", {
          headers: { origin },
          data: { code },
        })
      ).status(),
    ).toBe(400);
    await staff.page.goto("/admin/hosts");
    const application = staff.page.locator("form").filter({ hasText: host.id });
    await application
      .getByLabel("Decision", { exact: true })
      .selectOption("approved");
    await application
      .getByLabel("Review reason")
      .fill("Local test host review completed.");
    await application
      .getByRole("button", { name: "Record host decision" })
      .click();
    await expect(
      application.getByRole("heading", { name: "approved", exact: true }),
    ).toBeVisible();
    await host.page.reload();
    await host.page.getByText("Create a community", { exact: true }).click();
    await host.page.getByLabel("Community name").fill("Bengaluru slow Sundays");
    await host.page.getByLabel("City", { exact: true }).fill("Bengaluru");
    await host.page.getByLabel("Shared interest").fill("Books");
    await host.page
      .getByLabel("About your community")
      .fill("Small conversations about books at public cafes.");
    await host.page
      .getByRole("button", { name: "Create community", exact: true })
      .click();
    await expect(
      host.page.getByRole("heading", {
        name: "Bengaluru slow Sundays",
        exact: true,
      }),
    ).toBeVisible();
    await guest.page.goto("/communities");
    const card = guest.page.locator("article").filter({
      has: guest.page.getByRole("heading", {
        name: "Bengaluru slow Sundays",
        exact: true,
      }),
    });
    await card
      .getByRole("button", { name: "Join community", exact: true })
      .click();
    await card
      .getByRole("button", { name: "Open community", exact: true })
      .click();
    await host.page
      .getByRole("button", { name: "Open community", exact: true })
      .click();
    await guest.page
      .getByLabel("Community message", { exact: true })
      .fill("Hello everyone, what are you reading?");
    await guest.page.getByRole("button", { name: "Send to community" }).click();
    await expect(
      host.page
        .getByRole("log")
        .getByText("Hello everyone, what are you reading?", { exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await guest.page.reload();
    await card
      .getByRole("button", { name: "Open community", exact: true })
      .click();
    await expect(guest.page.getByRole("log")).toContainText(
      "what are you reading",
    );
    await host.page.getByText("Create an event", { exact: true }).click();
    await host.page.getByLabel("Event title").fill("A chapter and a chai");
    await host.page
      .getByLabel("Public venue and address")
      .fill("Public library cafe, central Bengaluru");
    await host.page
      .getByLabel("Date and time", { exact: true })
      .fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
    await host.page.getByLabel("Places", { exact: true }).fill("2");
    await host.page
      .getByRole("button", { name: "Create event", exact: true })
      .click();
    await expect(
      host.page.getByRole("heading", { name: "A chapter and a chai" }),
    ).toBeVisible();
    const groups = await (
      await host.context.request.get(origin + "/api/v1/communities")
    ).json();
    const group = groups.groups.find(
      (g: { name: string }) => g.name === "Bengaluru slow Sundays",
    );
    const events = await (
      await host.context.request.get(
        origin + "/api/v1/communities/events?groupId=" + group.id,
      )
    ).json();
    const event = events.events[0];
    const retries = await Promise.all(
      Array.from({ length: 6 }, () =>
        guest.context.request.post(
          origin + "/api/v1/communities/events/action",
          {
            headers: { origin },
            data: { eventId: event.id, action: "register" },
          },
        ),
      ),
    );
    for (const r of retries) expect(r.status()).toBe(200);
    const after = await (
      await guest.context.request.get(
        origin + "/api/v1/communities/events?groupId=" + group.id,
      )
    ).json();
    expect(after.events[0].registrations).toBe(1);
    await guest.page
      .getByRole("button", { name: "Refresh communities" })
      .click();
    await expect(
      guest.page.getByRole("button", { name: "Cancel registration" }),
    ).toBeVisible();
    await host.page
      .getByRole("button", { name: "Register", exact: true })
      .click();
    await expect(
      host.page.getByRole("button", {
        name: "Cancel registration",
        exact: true,
      }),
    ).toBeVisible();
    await guest.page.getByText("Find an event buddy", { exact: true }).click();
    await guest.page.getByLabel("Registered member").selectOption(host.id);
    await guest.page
      .getByRole("button", { name: "Invite event buddy", exact: true })
      .click();
    await host.page.getByText("Find an event buddy", { exact: true }).click();
    await host.page
      .getByRole("button", { name: "Accept buddy invitation", exact: true })
      .click();
    await expect(
      host.page
        .getByRole("status")
        .filter({ hasText: "You are event buddies." }),
    ).toBeVisible();
    await expect(
      guest.page.getByText("Tara · accepted", { exact: true }),
    ).toBeVisible();
    await guest.page
      .getByRole("button", { name: "Cancel registration" })
      .click();
    await expect(
      guest.page
        .getByRole("status")
        .filter({ hasText: "Registration cancelled." }),
    ).toBeVisible();
    await card.getByRole("button", { name: "Leave community" }).click();
    await expect(guest.page.getByRole("status")).toContainText(
      "You left the community.",
    );
    expect(
      (
        await guest.context.request.get(
          origin + "/api/v1/communities/messages?groupId=" + group.id,
        )
      ).status(),
    ).toBe(403);
    await guest.page.goto("/premium");
    await expect(guest.page.getByText(/Checkout unavailable:/)).toBeVisible();
    expect(
      (
        await guest.context.request.get(origin + "/api/v1/discovery?curated=1")
      ).status(),
    ).toBe(403);
    expect(
      (
        await guest.context.request.post(origin + "/api/v1/webhooks/razorpay", {
          data: { event: "subscription.charged" },
          headers: {
            "x-razorpay-signature": "0".repeat(64),
            "x-razorpay-event-id": "invalid-local-test",
          },
        })
      ).status(),
    ).toBe(401);
  } finally {
    await host.context.close();
    await guest.context.close();
    await staff.context.close();
  }
});
