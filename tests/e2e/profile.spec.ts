import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
const origin = process.env.TEST_BASE_URL || "http://localhost:3000";
test.use({
  permissions: ["camera"],
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});
test.beforeAll(() => {
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
      `
 import pg from 'pg';if(process.env.APP_ENV!=='local')throw Error('Local fixtures only');const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();await db.query("DELETE FROM otp_challenges WHERE phone='+916000000004'");await db.end();
 `,
    ],
    { stdio: "pipe" },
  );
});
test("verification rejection/retry and real camera capture persist through the Go service", async ({
  page,
  browser,
}) => {
  await page.goto("/login");
  await page.getByLabel("Indian mobile number").fill("6000000004");
  await page.getByRole("button", { name: "Send local test code" }).click();
  await page
    .getByLabel("Six-digit code")
    .fill(await page.getByTestId("local-code").innerText());
  await page.getByRole("button", { name: "Verify & continue" }).click();
  await expect(page).toHaveURL(/onboarding/);
  expect(
    (
      await page.request.post(origin + "/api/v1/account/consent", {
        headers: { origin },
        data: {
          displayName: "Meera",
          adult: true,
          indiaResident: true,
          terms: true,
        },
      })
    ).status(),
  ).toBe(200);
  await page.goto("/verify");
  await page
    .getByLabel("Test date of birth", { exact: true })
    .fill("1997-04-20");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Start local review" }).click();
  await page
    .getByRole("button", { name: "Simulate rejection", exact: true })
    .click();
  await expect(
    page.getByText("Simulated rejection. You can start a new test review."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start local review" }).click();
  await page
    .getByRole("button", { name: "Simulate approval", exact: true })
    .click();
  await expect(page.getByText("approved", { exact: true })).toHaveCount(2);
  await page.reload();
  await expect(page.getByText("approved", { exact: true })).toHaveCount(2);
  await page.goto("/profile");
  await page.getByLabel("Display name", { exact: true }).fill("Meera");
  await page.getByLabel("Gender", { exact: true }).fill("Woman");
  await page.getByLabel("City in India").fill("Pune");
  await page
    .getByLabel("Relationship intention")
    .fill("A long-term relationship");
  await page
    .getByLabel("A little about you")
    .fill("Long walks, short poems, and a good cup of filter coffee.");
  await page.getByLabel("Work (optional)").fill("Architect");
  await page.getByLabel("Show work on my public profile").uncheck();
  await page.getByRole("button", { name: "Save your profile" }).click();
  await expect(page.getByText("Your profile is saved.")).toBeVisible();
  await page.getByRole("button", { name: "Open camera" }).click();
  await expect(page.getByLabel("Live camera preview")).toBeVisible();
  await page.waitForFunction(() => {
    const v = document.querySelector("video");
    return !!v && v.videoWidth > 0;
  });
  await page
    .getByRole("button", { name: "Capture photo", exact: true })
    .click();
  await page.getByRole("button", { name: "Use this photo" }).click();
  await expect(
    page.getByText(
      "Photo saved. Review is pending; replacement resets photo approval.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Simulate photo approval" }).click();
  await expect(page.getByText("Photo review simulated.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("A little about you")).toHaveValue(
    "Long walks, short poems, and a good cup of filter coffee.",
  );
  const photo = await page.request.get(origin + "/api/v1/profile/photo");
  expect(photo.status()).toBe(200);
  expect(photo.headers()["content-type"]).toContain("image/jpeg");
  expect((await photo.body()).length).toBeGreaterThan(1000);
  const outsider = await browser.newContext();
  expect(
    (await outsider.request.get(origin + "/api/v1/profile/photo")).status(),
  ).toBe(401);
  await outsider.close();
  await page.getByRole("link", { name: "Preview your profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Meera", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Architect", { exact: true })).toHaveCount(0);
  await expect(
    page
      .getByRole("article")
      .getByText("Long walks, short poems, and a good cup of filter coffee."),
  ).toBeVisible();
  // Replay a valid captured image through a one-use capability and verify re-approval is required.
  const capture = await (
    await page.request.post(origin + "/api/v1/profile/capture", {
      headers: { origin },
      data: {},
    })
  ).json();
  const upload = {
    headers: {
      origin,
      "content-type": "image/jpeg",
      "x-capture-id": capture.captureId,
      "x-capture-token": capture.token,
    },
    data: await photo.body(),
  };
  const first = await page.request.post(
    origin + "/api/v1/profile/photo",
    upload,
  );
  expect(first.status()).toBe(200);
  expect((await first.json()).photo.status).toBe("pending");
  expect(
    (
      await page.request.post(origin + "/api/v1/profile/photo", upload)
    ).status(),
  ).toBe(409);
  const account = await (
    await page.request.get(origin + "/api/v1/account")
  ).json();
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
      `import pg from 'pg';const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();await db.query('DELETE FROM staff_roles WHERE account_id=$1',[process.argv[1]]);await db.end();`,
      account.id,
    ],
    { stdio: "pipe" },
  );
  expect(
    (await page.request.get(origin + "/api/v1/admin/media")).status(),
  ).toBe(403);
  expect(
    (await page.request.get(origin + "/api/v1/admin/reviews")).status(),
  ).toBe(403);
  execFileSync(
    process.execPath,
    ["infra/scripts/grant-local-reviewer.mjs", account.id],
    {
      env: { ...process.env, DOCKER_BIN: process.env.DOCKER_BIN || "docker" },
      stdio: "pipe",
    },
  );
  await page.goto("/admin/reviews");
  await expect(
    page.getByRole("heading", { name: "Meera", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Photo storage recovery", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Pending cleanup: \d+ · Needs attention: \d+/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Refresh recovery status" }).click();
  expect(
    (await page.request.get(origin + "/api/v1/admin/media")).status(),
  ).toBe(200);
  const review = page
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: "Meera", exact: true }) });
  await expect
    .poll(async () =>
      review
        .getByRole("img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await review.getByLabel("Decision", { exact: true }).selectOption("rejected");
  await review
    .getByLabel("Reason", { exact: true })
    .fill("Local fixture photo rejected for review test.");
  await review.getByRole("button", { name: "Record decision" }).click();
  await expect(
    page.getByText(
      "Decision saved in the owning service; audit record retained.",
    ),
  ).toBeVisible();
  expect(
    (await (await page.request.get(origin + "/api/v1/profile")).json()).photo
      .status,
  ).toBe("rejected");
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
      `import pg from 'pg';const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();await db.query('DELETE FROM staff_roles WHERE account_id=$1',[process.argv[1]]);await db.end();`,
      account.id,
    ],
    { stdio: "pipe" },
  );
});
