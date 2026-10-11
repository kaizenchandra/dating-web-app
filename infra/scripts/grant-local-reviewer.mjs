import { execFileSync } from "node:child_process";
const id = process.argv[2];
const role = process.argv[3] === "--admin" ? "admin" : "moderator";
if (
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
    id || "",
  )
)
  throw Error(
    "Usage: node infra/scripts/grant-local-reviewer.mjs <account UUID>",
  );
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
    `import pg from 'pg';if(process.env.APP_ENV!=='local')throw Error('Local operator bootstrap only');const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();await db.query("INSERT INTO staff_roles(account_id,role) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET role=excluded.role",[process.argv[1],process.argv[2]]);await db.end();`,
    id,
    role,
  ],
  { stdio: "inherit" },
);
console.log(
  "Local " + role + " role granted. Visit /admin/reviews after signing in.",
);
