import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { member, resetOtp, origin } from "../../packages/test-fixtures/browser";
const docker = process.env.DOCKER_BIN || "docker";
const compose = [
  "compose",
  "--env-file",
  ".env.local",
  "-f",
  "infra/compose/compose.yml",
];
function run(args: string[]) {
  return execFileSync(docker, [...compose, ...args], { stdio: "pipe" });
}
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});
test("review versions, durable receipts and service restart reconcile without approving a replacement", async ({
  browser,
}) => {
  test.setTimeout(90000);
  resetOtp(["+916000000026", "+916000000027"]);
  const staff = await member(browser, "+916000000026", "Review staff", "Woman");
  const subject = await member(
    browser,
    "+916000000027",
    "Review subject",
    "Man",
  );
  let stopped = false;
  try {
    execFileSync(
      process.execPath,
      ["infra/scripts/grant-local-reviewer.mjs", staff.id],
      { env: { ...process.env, DOCKER_BIN: docker }, stdio: "pipe" },
    );
    const photo = await (
      await subject.context.request.get(origin + "/api/v1/profile/photo")
    ).body();
    async function replacePhoto() {
      const capture = await (
        await subject.context.request.post(origin + "/api/v1/profile/capture", {
          headers: { origin },
          data: {},
        })
      ).json();
      expect(
        (
          await subject.context.request.post(origin + "/api/v1/profile/photo", {
            headers: {
              origin,
              "content-type": "image/jpeg",
              "x-capture-id": capture.captureId,
              "x-capture-token": capture.token,
            },
            data: photo,
          })
        ).status(),
      ).toBe(200);
    }
    async function review(kind: "photo" | "identity") {
      const data = await (
        await staff.context.request.get(origin + "/api/v1/admin/reviews")
      ).json();
      return data.reviews.find(
        (r: { accountId: string; kind: string }) =>
          r.accountId === subject.id && r.kind === kind,
      );
    }
    const send = (data: object) =>
      staff.context.request.post(origin + "/api/v1/admin/reviews/decision", {
        headers: { origin },
        data,
      });
    const deliveries = async () =>
      (
        await (
          await staff.context.request.get(
            origin + "/api/v1/admin/reviews/delivery",
          )
        ).json()
      ).items as { decisionId: string; status: string; attempts: number }[];
    await replacePhoto();
    const old = await review("photo");
    await replacePhoto();
    const fresh = await review("photo");
    expect(old.reviewVersion).not.toBe(fresh.reviewVersion);
    const base = {
      accountId: subject.id,
      kind: "photo",
      decision: "approved",
      reason: "Local fixture reviewed for delivery test.",
    };
    const stale = await send({
      ...base,
      decisionId: randomUUID(),
      reviewVersion: old.reviewVersion,
    });
    expect((await stale.json()).status).toBe("rejected");
    const input = {
      ...base,
      decisionId: randomUUID(),
      reviewVersion: fresh.reviewVersion,
    };
    const repeated = await Promise.all(
      Array.from({ length: 6 }, () => send(input)),
    );
    for (const r of repeated) expect(r.status()).toBe(200);
    await expect
      .poll(
        async () =>
          (await deliveries()).find((x) => x.decisionId === input.decisionId)
            ?.status,
      )
      .toBe("applied");
    expect(
      (
        await send({ ...input, reason: "Changed reason must conflict" })
      ).status(),
    ).toBe(409);
    expect(
      (
        await subject.context.request.get(
          origin + "/api/v1/admin/reviews/delivery",
        )
      ).status(),
    ).toBe(403);
    await replacePhoto();
    const pending = await review("photo");
    // Recreate an unconfirmed-delivery state after the owning transaction committed.
    run([
      "exec",
      "-T",
      "commerce-operations",
      "node",
      "--input-type=module",
      "-e",
      `import pg from 'pg';if(process.env.APP_ENV!=='local')throw Error('Local fixtures only');const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();await c.query("UPDATE review_audit SET status='requested',next_attempt_at=now() WHERE id=$1",[process.argv[1]]);await c.end();`,
      input.decisionId,
    ]);
    await expect
      .poll(
        async () =>
          (await deliveries()).find((x) => x.decisionId === input.decisionId)
            ?.status,
        { timeout: 15000 },
      )
      .toBe("applied");
    expect((await review("photo")).reviewVersion).toBe(pending.reviewVersion);
    const outage = {
      ...base,
      decisionId: randomUUID(),
      reviewVersion: pending.reviewVersion,
    };
    run(["stop", "profile-discovery"]);
    stopped = true;
    expect((await (await send(outage)).json()).status).toBe("queued");
    run(["start", "--wait", "profile-discovery"]);
    stopped = false;
    await expect
      .poll(
        async () =>
          (await deliveries()).find((x) => x.decisionId === outage.decisionId)
            ?.status,
        { timeout: 20000 },
      )
      .toBe("applied");
    expect(
      (
        await (
          await subject.context.request.get(origin + "/api/v1/profile")
        ).json()
      ).photo.status,
    ).toBe("approved");
    const startIdentity = () =>
      subject.context.request.post(origin + "/api/v1/verification/start", {
        headers: { origin },
        data: { route: "local", consent: true, dateOfBirth: "1997-04-20" },
      });
    expect((await startIdentity()).status()).toBe(200);
    const identity = await review("identity");
    const identityInput = {
      ...base,
      kind: "identity",
      decisionId: randomUUID(),
      reviewVersion: identity.reviewVersion,
    };
    expect((await (await send(identityInput)).json()).status).toBe("applied");
    expect((await startIdentity()).status()).toBe(200);
    expect((await (await send(identityInput)).json()).status).toBe("applied");
    // A fresh id with the old submission version cannot approve a new submission.
    expect(
      (
        await (
          await send({ ...identityInput, decisionId: randomUUID() })
        ).json()
      ).status,
    ).toBe("rejected");
    expect(
      (
        await (
          await subject.context.request.get(origin + "/api/v1/verification")
        ).json()
      ).identity,
    ).toBe("pending");
    await staff.page.goto("/admin/reviews");
    await staff.page
      .getByText("Your review delivery history", { exact: true })
      .click();
    await expect(
      staff.page.getByText(`Decision ${outage.decisionId}`, { exact: false }),
    ).toBeVisible();
    await expect(
      staff.page
        .getByRole("article")
        .filter({ hasText: outage.decisionId })
        .getByText("applied", { exact: true }),
    ).toBeVisible();
  } finally {
    if (stopped) run(["start", "--wait", "profile-discovery"]);
    run([
      "exec",
      "-T",
      "commerce-operations",
      "node",
      "--input-type=module",
      "-e",
      `import pg from 'pg';const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();await c.query('DELETE FROM staff_roles WHERE account_id=$1',[process.argv[1]]);await c.end();`,
      staff.id,
    ]);
    await staff.context.close();
    await subject.context.close();
  }
});
