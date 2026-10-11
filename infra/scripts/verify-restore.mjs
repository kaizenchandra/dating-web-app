import { spawnSync } from "node:child_process";
import { openSync, closeSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
if (!process.argv[2])
  throw Error(
    "Usage: node infra/scripts/verify-restore.mjs <backup directory>",
  );
const dir = resolve(process.argv[2]);
const docker = process.env.DOCKER_BIN || "docker";
const compose = [
  "compose",
  "--env-file",
  ".env.local",
  "-f",
  "infra/compose/compose.yml",
];
const suffix = randomBytes(5).toString("hex");
function run(args, fd) {
  const r = spawnSync(docker, [...compose, "exec", "-T", "postgres", ...args], {
    stdio: [fd ?? "ignore", "pipe", "pipe"],
  });
  if (r.status !== 0)
    throw Error("Restore validation command failed: " + args[0]);
  return r.stdout.toString().trim();
}
for (const name of [
  "identity",
  "profile_discovery",
  "connections",
  "communication",
  "commerce_operations",
]) {
  const file = dir + "/" + name + ".dump";
  if (!existsSync(file)) throw Error("Missing " + file);
  const scratch = "restorecheck_" + suffix + "_" + name;
  run(["createdb", "-U", "raahi_admin", scratch]);
  try {
    const fd = openSync(file, "r");
    try {
      run(
        [
          "pg_restore",
          "-U",
          "raahi_admin",
          "-d",
          scratch,
          "--no-owner",
          "--no-acl",
          "--exit-on-error",
        ],
        fd,
      );
    } finally {
      closeSync(fd);
    }
    const count = run([
      "psql",
      "-U",
      "raahi_admin",
      "-d",
      scratch,
      "-Atc",
      "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'",
    ]);
    if (Number(count) < 2) throw Error("Incomplete restore");
    console.log(name + ": restored and inspected " + count + " public tables");
  } finally {
    run(["dropdb", "-U", "raahi_admin", scratch]);
  }
}
const fd = openSync(dir + "/media.tar.gz", "r");
try {
  const r = spawnSync("tar", ["-tzf", "-"], { stdio: [fd, "pipe", "pipe"] });
  if (r.status !== 0) throw Error("Object archive validation failed");
  console.log(
    "Object archive readable; full isolated SeaweedFS restore still required before release.",
  );
} finally {
  closeSync(fd);
}
