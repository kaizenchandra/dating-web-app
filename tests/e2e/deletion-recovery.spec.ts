import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { member, resetOtp, origin } from "../../packages/test-fixtures/browser";
const docker = process.env.DOCKER_BIN || "docker";
function compose(...args: string[]) {
  return execFileSync(
    docker,
    [
      "compose",
      "--env-file",
      ".env.local",
      "-f",
      "infra/compose/compose.yml",
      ...args,
    ],
    { stdio: "pipe" },
  );
}
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});
test("deletion stays pending through owner outage and worker restart, then resumes from durable steps", async ({
  browser,
}) => {
  test.setTimeout(90000);
  resetOtp(["+916000000030"]);
  const a = await member(
    browser,
    "+916000000030",
    "Deletion recovery",
    "Woman",
  );
  let stopped = false;
  try {
    await a.page.goto("/privacy-control");
    await a.page.getByLabel("Type DELETE to confirm").fill("DELETE");
    compose("stop", "commerce-operations");
    stopped = true;
    await a.page
      .getByRole("button", { name: "Permanently delete my account" })
      .click();
    await expect(
      a.page.getByRole("heading", { name: "Deletion: pending", exact: true }),
    ).toBeVisible();
    expect(
      (await a.context.request.get(origin + "/api/v1/account")).status(),
    ).toBe(401);
    expect(
      (await a.context.request.get(origin + "/api/v1/discovery")).status(),
    ).toBe(401);
    const receipt = async () =>
      await (
        await a.context.request.get(origin + "/api/v1/account/deletion")
      ).json();
    await expect
      .poll(async () => (await receipt()).attempts, { timeout: 15000 })
      .toBeGreaterThan(0);
    const partial = await receipt();
    expect(partial.status).toBe("pending");
    expect(partial.steps["profile-discovery"]).toBe("erased");
    expect(partial.steps["commerce-operations"]).toBeUndefined();
    const outsider = await browser.newContext();
    expect(
      (
        await outsider.request.get(origin + "/api/v1/account/deletion")
      ).status(),
    ).toBe(404);
    await outsider.close();
    compose("restart", "identity");
    compose("up", "-d", "--wait", "--no-deps", "identity");
    await a.page.reload();
    await expect(
      a.page.getByRole("heading", { name: "Deletion: pending", exact: true }),
    ).toBeVisible();
    expect((await receipt()).id).toBe(partial.id);
    compose("start", "--wait", "commerce-operations");
    stopped = false;
    await expect(
      a.page.getByRole("heading", { name: "Deletion: complete", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    const complete = await receipt();
    for (const owner of [
      "identity",
      "profile-discovery",
      "connections",
      "communication",
      "commerce-operations",
    ])
      expect(complete.steps[owner]).toBe("erased");
    expect(complete.id).toBe(partial.id);
    expect(
      (await a.context.request.get(origin + "/api/v1/account")).status(),
    ).toBe(401);
  } finally {
    if (stopped) compose("start", "--wait", "commerce-operations");
    await a.context.close();
  }
});
