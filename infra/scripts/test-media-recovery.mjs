import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
const result = spawnSync(process.env.DOCKER_BIN || "docker", [
  "run", "--rm", "--network", "raahi_default", "--env-file", ".env.local",
  "-v", resolve("services/profile-discovery") + ":/workspace:ro",
  "-w", "/workspace", "golang:1.25-bookworm", "sh", "-c",
  'test "$APP_ENV" = local || exit 1; export DATABASE_URL="postgres://profile_discovery:${DB_PASSWORD}@postgres:5432/profile_discovery?sslmode=disable" S3_ENDPOINT="media:9000" S3_ACCESS_KEY="raahi_media"; go test -tags=integration -run TestRecoveryAgainstPostgresAndPrivateStorage -count=1 -v .',
], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
