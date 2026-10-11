import { spawnSync } from "node:child_process";
import { mkdirSync, openSync, closeSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const dir = resolve(
  process.argv[2] || "backups/" + new Date().toISOString().replaceAll(":", "-"),
);
mkdirSync(dir, { recursive: true, mode: 0o700 });
const compose = [
  "compose",
  "--env-file",
  ".env.local",
  "-f",
  "infra/compose/compose.yml",
];
const docker = process.env.DOCKER_BIN || "docker";
function dump(file, args) {
  const fd = openSync(dir + "/" + file, "wx", 0o600);
  try {
    const r = spawnSync(docker, [...compose, ...args], {
      stdio: ["ignore", fd, "pipe"],
    });
    if (r.status !== 0)
      throw Error(
        "Backup failed for " + file + "; inspect service availability.",
      );
  } finally {
    closeSync(fd);
  }
}
for (const name of [
  "identity",
  "profile_discovery",
  "connections",
  "communication",
  "commerce_operations",
])
  dump(name + ".dump", [
    "exec",
    "-T",
    "postgres",
    "pg_dump",
    "-U",
    "raahi_admin",
    "-d",
    name,
    "-Fc",
    "--no-owner",
    "--no-acl",
  ]);
dump("media.tar.gz", [
  "exec",
  "-T",
  "media",
  "tar",
  "-czf",
  "-",
  "-C",
  "/data",
  ".",
]);
writeFileSync(
  dir + "/manifest.json",
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      format: 1,
      consistency:
        "Per-database snapshots. Quiesce writes for coordinated recovery.",
      containsPersonalData: true,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  "Backup written to " +
    dir +
    ". Encrypt before transferring off this machine.",
);
