import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const secret = () => randomBytes(32).toString("hex");
let env = existsSync(".env.local")
  ? readFileSync(".env.local", "utf8")
  : "APP_ENV=local\nWEB_ORIGIN=http://localhost:3000\n";
if (!/^APP_ENV=local$/m.test(env))
  throw Error("Local configuration helper refuses deployed environments.");
// Preserve an existing local MFA encryption key when rotating service credentials.
const old = env.match(/^SERVICE_TOKEN=(.+)$/m)?.[1];
const values = Object.fromEntries(
  [
    "DB_PASSWORD",
    "S3_SECRET_KEY",
    "OTP_PEPPER",
    "IDENTITY_SERVICE_TOKEN",
    "COMMUNICATION_SERVICE_TOKEN",
    "COMMERCE_OPERATIONS_SERVICE_TOKEN",
    "PROFILE_DISCOVERY_SERVICE_TOKEN",
    "CONNECTIONS_SERVICE_TOKEN",
    "GATEWAY_SERVICE_TOKEN",
    "WEB_PROXY_TOKEN",
    "EDGE_PROXY_TOKEN",
  ].map((k) => [k, secret()]),
);
values.MFA_ENCRYPTION_KEY = old || secret();
let added = 0;
for (const [key, value] of Object.entries(values))
  if (!new RegExp("^" + key + "=.+$", "m").test(env)) {
    env = env.replace(new RegExp("^" + key + "=.*\\n?", "m"), "");
    env += "\n" + key + "=" + value + "\n";
    added++;
  }
writeFileSync(".env.local", env, { mode: 0o600 });
console.log(
  `Local configuration ready; ${added} missing secret settings generated, existing values preserved.`,
);
