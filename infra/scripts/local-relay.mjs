import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
let env = readFileSync(".env.local", "utf8");
if (!/^APP_ENV=local$/m.test(env))
  throw Error("Local relay setup requires APP_ENV=local");
const defaults = {
  TURN_SHARED_SECRET: randomBytes(32).toString("hex"),
  TURN_URLS: '["turn:127.0.0.1:3478?transport=udp"]',
  WEBRTC_RELAY_ONLY: "true",
};
for (const [key, value] of Object.entries(defaults))
  if (!new RegExp("^" + key + "=.+$", "m").test(env)) {
    env = env.replace(new RegExp("^" + key + "=.*\\n?", "m"), "");
    env += "\n" + key + "=" + value + "\n";
  }
writeFileSync(".env.local", env, { mode: 0o600 });
console.log(
  "Local relay settings prepared; existing values preserved. Start Compose with --profile relay.",
);
