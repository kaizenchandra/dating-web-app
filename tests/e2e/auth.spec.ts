import { resetOtp } from "../../packages/test-fixtures/browser";
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
const docker = process.env.DOCKER_BIN || "docker";
const origin = process.env.TEST_BASE_URL || "http://localhost:3000";
const headers = { origin };
test.beforeAll(() => {
  // Deterministic, local-only test accounts. Never reset arbitrary accounts.
  execFileSync(
    docker,
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
      `
 import pg from 'pg';
 if(process.env.APP_ENV!=='local')throw Error('Fixture reset is local-only');
 const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();await db.query('BEGIN');
 const phones=['+916000000001','+916000000002','+916000000003'];
 for(const table of ['sessions','consent_history','provider_identities','verifications'])await db.query('DELETE FROM '+table+' WHERE account_id IN (SELECT id FROM accounts WHERE phone=ANY($1))',[phones]);
 await db.query('DELETE FROM otp_challenges WHERE phone=ANY($1)',[phones]);
 await db.query('DELETE FROM accounts WHERE phone=ANY($1)',[phones]);await db.query('COMMIT');await db.end();
 `,
    ],
    { stdio: "pipe" },
  );
});
test("phone sign-in, consent, reload, session revocation and logout use durable state", async ({
  page,
  browser,
}) => {
  await page.goto("/login");
  await expect(
    page.getByRole("button", { name: "Log out", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Indian mobile number").fill("6000000001");
  await page.getByRole("button", { name: "Send local test code" }).click();
  const code = await page.getByTestId("local-code").innerText();
  await page.getByLabel("Six-digit code").fill(code);
  await page.getByRole("button", { name: "Verify & continue" }).click();
  await expect(page).toHaveURL(/onboarding/);
  await expect(
    page.getByRole("button", { name: "Log out", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Display name").fill("Aarohi");
  for (const checkbox of await page.getByRole("checkbox").all())
    await checkbox.check();
  await page.getByRole("button", { name: "Save & continue" }).click();
  await expect(page.getByText("Nice to meet you, Aarohi.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Nice to meet you, Aarohi.")).toBeVisible();
  const cookie = (await page.context().cookies()).find(
    (c) => c.name === "raahi_session",
  )!;
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe("Lax");
  // A second independent browser context has no account access.
  const outsider = await browser.newContext();
  expect(
    (await outsider.request.get(origin + "/api/v1/account")).status(),
  ).toBe(401);
  await outsider.close();
  await page.goto("/settings");
  await page
    .getByRole("button", { name: "Pause account", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Unpause account", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Unpause account", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out other sessions" }).click();
  await expect(page.getByText("Other sessions signed out.")).toBeVisible();
  await page.goto("/profile");
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(
    page.getByRole("button", { name: "Log out", exact: true }),
  ).toBeVisible();
  await page.context().setOffline(true);
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Try logging out again." }),
  ).toBeVisible();
  await page.context().setOffline(false);
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL(/login/);
  await expect(
    page.getByRole("button", { name: "Log out", exact: true }),
  ).toHaveCount(0);
  expect(
    (await page.context().cookies()).some((c) => c.name === "raahi_session"),
  ).toBe(false);
  const stolen = await browser.newContext({
    extraHTTPHeaders: { cookie: `raahi_session=${cookie.value}` },
  });
  expect((await stolen.request.get(origin + "/api/v1/account")).status()).toBe(
    401,
  );
  await stolen.close();
});
test("OTP rejects foreign browsers, repeated requests, guesses, replays and CSRF", async ({
  request,
  browser,
}) => {
  const challenge = await request.post("/api/v1/auth/otp/request", {
    headers,
    data: { phone: "+916000000002" },
  });
  expect(challenge.status()).toBe(200);
  const data = await challenge.json();
  expect(
    (
      await request.post("/api/v1/auth/otp/request", {
        headers,
        data: { phone: "+916000000002" },
      })
    ).status(),
  ).toBe(409);
  const foreign = await browser.newContext();
  expect(
    (
      await foreign.request.post(origin + "/api/v1/auth/otp/verify", {
        headers,
        data: { challengeId: data.challengeId, code: data.localCode },
      })
    ).status(),
  ).toBe(400);
  await foreign.close();
  const incorrect = data.localCode === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++)
    expect(
      (
        await request.post("/api/v1/auth/otp/verify", {
          headers,
          data: { challengeId: data.challengeId, code: incorrect },
        })
      ).status(),
    ).toBe(400);
  expect(
    (
      await request.post("/api/v1/auth/otp/verify", {
        headers,
        data: { challengeId: data.challengeId, code: data.localCode },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/v1/auth/logout", {
        headers: { origin: "https://attacker.example" },
      })
    ).status(),
  ).toBe(403);
  const next = await request.post("/api/v1/auth/otp/request", {
    headers,
    data: { phone: "+916000000003" },
  });
  const nextData = await next.json();
  expect(
    (
      await request.post("/api/v1/auth/otp/verify", {
        headers,
        data: { challengeId: nextData.challengeId, code: nextData.localCode },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.post("/api/v1/auth/otp/verify", {
        headers,
        data: { challengeId: nextData.challengeId, code: nextData.localCode },
      })
    ).status(),
  ).toBe(400);
});
test("unconfigured provider and invalid callback fail safely", async ({
  request,
}) => {
  const result = await request.post("/api/v1/auth/oauth/start", {
    headers,
    data: { provider: "google" },
  });
  expect(result.status()).toBe(503);
  expect((await result.json()).error.code).toBe("PROVIDER_NOT_CONFIGURED");
  const callback = await request.get(
    "/api/v1/auth/oauth/google/callback?state=invalid&code=invalid",
    { maxRedirects: 0 },
  );
  expect(callback.status()).toBe(303);
  expect(callback.headers().location).toContain("PROVIDER_CALLBACK_FAILED");
});

test("a correct OTP is rejected after server-side expiry", async ({
  request,
}) => {
  resetOtp(["+916000000020"]);
  const response = await request.post("/api/v1/auth/otp/request", {
    headers,
    data: { phone: "+916000000020" },
  });
  expect(response.status()).toBe(200);
  const challenge = await response.json();
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
      "identity",
      "node",
      "--input-type=module",
      "-e",
      `import pg from 'pg';if(process.env.APP_ENV!=='local')throw Error('Local fixtures only');const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();await db.query("UPDATE otp_challenges SET expires_at=now()-interval '1 second' WHERE id=$1 AND phone='+916000000020'",[process.argv[1]]);await db.end();`,
      challenge.challengeId,
    ],
    { stdio: "pipe" },
  );
  expect(
    (
      await request.post("/api/v1/auth/otp/verify", {
        headers,
        data: { challengeId: challenge.challengeId, code: challenge.localCode },
      })
    ).status(),
  ).toBe(400);
});
