import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";

test("receiver credentials reject another service's token", async () => {
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
      `const tokens=JSON.parse(process.env.SERVICE_TOKENS);const rows=[];
    for(const service of ['profile-discovery','connections','communication','commerce-operations']) {
      const url='http://'+service+':4000/internal/privacy/export?accountId=00000000-0000-4000-8000-000000000000';
      const wrong=await fetch(url,{headers:{authorization:'Bearer '+process.env.SERVICE_TOKEN}});
      const correct=await fetch(url,{headers:{authorization:'Bearer '+tokens[service]}});
      rows.push({service,wrong:wrong.status,correct:correct.status});
    }console.log(JSON.stringify(rows));`,
    ],
    { encoding: "utf8" },
  );
  const rows = JSON.parse(output);
  expect(rows).toHaveLength(4);
  for (const row of rows) {
    expect(row.wrong, row.service).toBe(401);
    expect(row.correct, row.service).toBe(200);
  }
});
