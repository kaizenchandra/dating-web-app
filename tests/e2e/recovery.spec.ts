import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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
function fixture(service: string, sql: string, args: string[] = []) {
  return compose(
    "exec",
    "-T",
    service,
    "node",
    "--input-type=module",
    "-e",
    `import pg from 'pg';if(process.env.APP_ENV!=='local')throw Error('Local fixtures only');const url=new URL(process.env.DATABASE_URL);if(process.argv[2]){url.username=process.argv[2];url.pathname='/'+process.argv[2]}const c=new pg.Client({connectionString:url.toString()});await c.connect();const r=await c.query(process.argv[1],JSON.parse(process.argv[3]));console.log(JSON.stringify(r.rows));await c.end();`,
    sql,
    service === "identity" ? "identity" : args[0] || "commerce_operations",
    JSON.stringify(args.slice(1)),
  ).toString();
}
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});
test("admin recovery is authorised, audited and idempotent across deletion, media and review jobs", async ({
  browser,
}) => {
  test.setTimeout(90000);
  resetOtp(["+916000000031", "+916000000032"]);
  const admin = await member(
    browser,
    "+916000000031",
    "Recovery operator",
    "Woman",
  );
  const victim = await member(
    browser,
    "+916000000032",
    "Recovery member",
    "Man",
  );
  let stopped = false;
  const mediaId = randomUUID(),
    reviewId = randomUUID();
  try {
    expect(
      (
        await admin.context.request.get(origin + "/api/v1/admin/recovery")
      ).status(),
    ).toBe(403);
    execFileSync(
      process.execPath,
      ["infra/scripts/grant-local-reviewer.mjs", admin.id],
      { env: { ...process.env, DOCKER_BIN: docker }, stdio: "pipe" },
    );
    expect(
      (
        await admin.context.request.get(origin + "/api/v1/admin/recovery")
      ).status(),
    ).toBe(403);
    execFileSync(
      process.execPath,
      ["infra/scripts/grant-local-reviewer.mjs", admin.id, "--admin"],
      { env: { ...process.env, DOCKER_BIN: docker }, stdio: "pipe" },
    );
    compose("stop", "profile-discovery");
    stopped = true;
    const missing = await (
      await admin.context.request.get(origin + "/api/v1/admin/recovery")
    ).json();
    expect(missing.unavailable).toContain("profile-discovery");
    expect(
      (
        await victim.context.request.post(origin + "/api/v1/account/delete", {
          headers: { origin },
          data: { confirmation: "DELETE" },
        })
      ).status(),
    ).toBe(200);
    const receipt = async () =>
      await (
        await victim.context.request.get(origin + "/api/v1/account/deletion")
      ).json();
    await expect
      .poll(async () => (await receipt()).attempts, { timeout: 15000 })
      .toBeGreaterThan(0);
    const job = (await receipt()).id;
    fixture(
      "identity",
      "UPDATE deletion_jobs SET status='needs_attention',attempts=10 WHERE id=$1",
      ["identity", job],
    );
    compose("start", "--wait", "profile-discovery");
    stopped = false;
    fixture(
      "commerce-operations",
      "INSERT INTO object_cleanup(id,object_key,attempts,last_error) VALUES($1,$2,10,'fixture storage outage')",
      [
        "profile_discovery",
        mediaId,
        randomUUID() + "/" + randomUUID() + ".jpg",
      ],
    );
    fixture(
      "commerce-operations",
      "INSERT INTO review_audit(id,actor_id,target_id,kind,decision,reason,status,review_version,attempts,last_error) VALUES($1,$2,$2,'photo','rejected','Fixture recovery review','needs_attention',$3,10,'fixture owner unavailable')",
      ["commerce_operations", reviewId, admin.id, randomUUID()],
    );
    await admin.page.goto("/admin/recovery");
    const form = admin.page.locator("form").filter({ hasText: job });
    await form
      .getByLabel("What was investigated and resolved?")
      .fill("Owner connectivity restored and deletion receipt investigated.");
    await form.getByRole("button", { name: "Retry this job" }).click();
    await expect(admin.page.getByRole("status")).toContainText(
      "Retry confirmed",
    );
    await expect
      .poll(async () => (await receipt()).status, { timeout: 20000 })
      .toBe("complete");
    const state = await (
      await admin.context.request.get(origin + "/api/v1/admin/recovery")
    ).json();
    const audit = state.audit.find((x: { jobId: string }) => x.jobId === job);
    expect(audit.status).toBe("confirmed");
    const payload = {
      requestId: audit.requestId,
      service: audit.service,
      jobId: audit.jobId,
      reason: audit.reason,
    };
    expect(
      (
        await admin.context.request.post(origin + "/api/v1/admin/recovery", {
          headers: { origin },
          data: payload,
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await admin.context.request.post(origin + "/api/v1/admin/recovery", {
          headers: { origin },
          data: { ...payload, reason: "A conflicting payload is rejected" },
        })
      ).status(),
    ).toBe(409);
    for (const id of [mediaId, reviewId]) {
      const item = admin.page.locator("form").filter({ hasText: id });
      await item
        .getByLabel("What was investigated and resolved?")
        .fill(
          "Investigated the local fixture failure and restored owner availability.",
        );
      await item.getByRole("button", { name: "Retry this job" }).click();
      await expect(item).toHaveCount(0);
    }
    const after = await (
      await admin.context.request.get(origin + "/api/v1/admin/recovery")
    ).json();
    for (const id of [job, mediaId, reviewId])
      expect(
        after.audit.some(
          (x: { jobId: string; status: string }) =>
            x.jobId === id && x.status === "confirmed",
        ),
      ).toBe(true);
    const pending = JSON.parse(
      fixture(
        "commerce-operations",
        "SELECT attempts FROM object_cleanup WHERE id=$1",
        ["profile_discovery", mediaId],
      ),
    );
    if (pending.length) expect(pending[0].attempts).toBe(0);
  } finally {
    if (stopped) compose("start", "--wait", "profile-discovery");
    fixture(
      "commerce-operations",
      "DELETE FROM staff_roles WHERE account_id=$1",
      ["commerce_operations", admin.id],
    );
    fixture("commerce-operations", "DELETE FROM object_cleanup WHERE id=$1", [
      "profile_discovery",
      mediaId,
    ]);
    fixture("commerce-operations", "DELETE FROM review_audit WHERE id=$1", [
      "commerce_operations",
      reviewId,
    ]);
    await admin.context.close();
    await victim.context.close();
  }
});
