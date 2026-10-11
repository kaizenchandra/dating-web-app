import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
test("local OTP cannot start for production or non-loopback origin", () => {
  const script =
    "import {assertEnvironment} from './services/identity/security.ts';assertEnvironment();";
  for (const env of [
    {
      APP_ENV: "production",
      WEB_ORIGIN: "https://example.com",
      LOCAL_TEST_DELIVERY: "enabled",
    },
    {
      APP_ENV: "local",
      WEB_ORIGIN: "https://example.com",
      LOCAL_TEST_DELIVERY: "enabled",
    },
    {
      APP_ENV: "local",
      WEB_ORIGIN: "http://localhost:3000",
      LOCAL_TEST_DELIVERY: "",
    },
  ]) {
    assert.throws(() =>
      execFileSync(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", script],
        {
          env: { ...process.env, ...env, OTP_PEPPER: "x".repeat(64) },
          stdio: "pipe",
        },
      ),
    );
  }
});
