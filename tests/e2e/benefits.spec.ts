import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  member,
  resetOtp,
  origin,
  connection,
} from "../../packages/test-fixtures/browser";
// Explicit entitlement/usage fixtures test authorization, never payment acceptance.
function fixture(
  service: string,
  statements: { sql: string; values: unknown[] }[],
) {
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
      service,
      "node",
      "--input-type=module",
      "-e",
      `import pg from 'pg';if(process.env.APP_ENV!=='local')throw Error('Local fixtures only');const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();for(const q of JSON.parse(process.argv[1]))await db.query(q.sql,q.values);await db.end();`,
      JSON.stringify(statements),
    ],
    { stdio: "pipe" },
  );
}
// Local-only Docker database fixtures; UUID values are strictly checked.
function connectionsFixture(statements: { sql: string; values: unknown[] }[]) {
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
      "postgres",
      "psql",
      "-U",
      "raahi_admin",
      "-d",
      "connections",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      statements
        .map((q) => {
          let sql = q.sql;
          q.values.forEach((v, i) => {
            if (typeof v !== "string" || !/^[a-f0-9-]{36}$/.test(v))
              throw Error("UUID fixtures only");
            sql = sql.replaceAll("$" + (i + 1), "'" + v + "'");
          });
          return sql;
        })
        .join(";\n"),
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
test("tier allowances, atomic quota, super-like introduction acceptance and hidden profile fields", async ({
  browser,
}) => {
  test.setTimeout(120000);
  resetOtp(["+916000000071", "+916000000072", "+916000000073"]);
  const a = await member(browser, "+916000000071", "Allowance sender", "Woman");
  const b = await member(
    browser,
    "+916000000072",
    "Allowance recipient",
    "Man",
  );
  const c = await member(browser, "+916000000073", "Allowance third", "Man");
  const subscription = randomUUID();
  try {
    for (const u of [a, b, c]) {
      connectionsFixture([
        {
          sql: "DELETE FROM connection_usage WHERE account_id=$1",
          values: [u.id],
        },
      ]);
      for (const v of [a, b, c])
        if (u !== v) {
          await connection(u.context, v.id, "unblock");
          await connection(u.context, v.id, "unmatch");
        }
      const profile = await (
        await u.context.request.get(origin + "/api/v1/profile")
      ).json();
      expect(
        (
          await u.context.request.put(origin + "/api/v1/profile", {
            headers: { origin },
            data: { ...profile.profile, city: "Panaji", hiddenFields: [] },
          })
        ).ok(),
      ).toBe(true);
    }
    const allowance = async () =>
      (
        await a.context.request.get(origin + "/api/v1/connections/allowance")
      ).json();
    const send = (id: string, superLike = true) =>
      a.context.request.post(origin + "/api/v1/connections/action", {
        headers: { origin },
        data: {
          targetId: id,
          action: "like",
          superLike,
          introduction: "A thoughtful direct hello",
        },
      });
    expect((await send(b.id)).status()).toBe(429);
    expect((await allowance()).directIntroductionsUsed).toBe(0);
    fixture("commerce-operations", [
      { sql: "DELETE FROM subscriptions WHERE account_id=$1", values: [a.id] },
      {
        sql: "INSERT INTO subscriptions(id,account_id,status,tier,paid_count,current_end) VALUES($1,$2,'active','gold',1,now()+interval '1 hour')",
        values: [subscription, a.id],
      },
    ]);
    // Four spent Gold credits leave exactly one; concurrent retries must consume once.
    connectionsFixture([
      {
        sql: "INSERT INTO connection_usage(account_id,target_id,feature) SELECT $1,gen_random_uuid(),'super_like' FROM generate_series(1,4)",
        values: [a.id],
      },
    ]);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => send(b.id)),
    );
    for (const r of results) expect(r.status()).toBe(200);
    expect((await allowance()).superLikesUsed).toBe(5);
    expect((await allowance()).directIntroductionsUsed).toBe(1);
    expect((await send(c.id)).status()).toBe(429);
    expect((await allowance()).directIntroductionsUsed).toBe(1);
    await b.page.goto("/interests");
    const card = b.page
      .locator("article")
      .filter({
        has: b.page.getByRole("heading", { name: /Allowance sender/ }),
      });
    await expect(card.getByText("Super like ✦", { exact: true })).toBeVisible();
    await expect(
      card.getByText("A thoughtful direct hello", { exact: true }),
    ).toBeVisible();
    await card
      .getByRole("button", { name: "Accept interest", exact: true })
      .click();
    await expect(b.page.getByRole("status")).toContainText("now matched");
    for (const [tier, likes, intros] of [
      ["diamond", 15, 25],
      ["platinum", 30, 50],
    ] as const) {
      fixture("commerce-operations", [
        {
          sql: "UPDATE subscriptions SET tier=$2 WHERE id=$1",
          values: [subscription, tier],
        },
      ]);
      const state = await allowance();
      expect(state.features.superLikesPerDay).toBe(likes);
      expect(state.features.directIntroductionsPerDay).toBe(intros);
    }
    await a.page.goto("/profile");
    await a.page.getByText("Choose what others see", { exact: true }).click();
    await a.page
      .getByLabel("Show age on my public profile", { exact: true })
      .uncheck();
    await a.page
      .getByLabel("Show city and approximate distance on my public profile", {
        exact: true,
      })
      .uncheck();
    await a.page
      .getByRole("button", { name: "Save your profile →", exact: true })
      .click();
    await expect(a.page.getByRole("status")).toContainText("saved");
    fixture("commerce-operations", [
      {
        sql: "UPDATE subscriptions SET current_end=now()-interval '1 second' WHERE id=$1",
        values: [subscription],
      },
    ]);
    expect((await allowance()).features.superLikesPerDay).toBe(0);
    expect((await send(c.id)).status()).toBe(429);
    const preview = await (
      await a.context.request.get(origin + "/api/v1/profile/preview")
    ).json();
    expect(preview.ageYears).toBeNull();
    expect(preview.profile.city).toBe("");
    const matches = await (
      await b.context.request.get(origin + "/api/v1/connections")
    ).json();
    const person = matches.matches.find(
      (m: { person: { id: string } }) => m.person.id === a.id,
    ).person;
    expect(person.age).toBeNull();
    expect(person.city).toBe("");
    expect(person.approximateDistanceKm).toBeNull();
    await a.page.goto("/profile/preview");
    await expect(a.page.getByText(/Age private/)).toBeVisible();
    await a.page.reload();
    await expect(a.page.getByText(/Age private/)).toBeVisible();
    await a.page.goto("/premium");
    await expect(
      a.page.getByText("5 super likes per day", { exact: true }),
    ).toBeVisible();
  } finally {
    fixture("commerce-operations", [
      { sql: "DELETE FROM subscriptions WHERE id=$1", values: [subscription] },
    ]);
    await Promise.all([
      a.context.close(),
      b.context.close(),
      c.context.close(),
    ]);
  }
});
