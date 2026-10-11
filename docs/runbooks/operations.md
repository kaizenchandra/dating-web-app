# Local operations and release preparation

## Startup and migrations

Use Node 24 and Docker Compose v2. Run `npm ci`, `npm run local:env`, `npm run local:up`. Open http://localhost:3000. The environment generator preserves existing values and appends missing secret settings when upgrading. Review `infra/compose/.env.example` for optional provider settings. No secrets are committed.

Each owning service applies its own numbered SQL migrations at startup, recording checksums under a migration lock. Never edit an applied migration: add the next numbered migration. PostgreSQL databases/logins are isolated. No service reads another owner's tables. Database password changes require coordinated role credential changes; changing the env file alone does not change an initialized database.

No public demo people are seeded. Browser tests create explicitly reserved `+9160000000xx` accounts through local phone, verification and camera flows. Local phone/verification test controls refuse deployed environments. Tests reset OTP throttling only for their reserved numbers. Existing reports remain retained, so assertions use evidence IDs.

`npm run local:down` preserves volumes. Deleting volumes destroys local data and is not part of ordinary startup.

## Checks

Run `npm run check`, both Go `go test ./...` commands, and `npm run test:e2e` with the full Compose stack running. Install Chromium once with `npx playwright install chromium`. The suite runs serially because one test deliberately restarts communication to prove persistence and socket recovery. Camera/video tests use Chromium's synthetic hardware input while exercising the real capture/upload/media/network code; they do not stub application APIs.

Use `DOCKER_BIN=/Applications/OrbStack.app/Contents/MacOS/xbin/docker` if needed on this machine. With restricted host cache permissions, set `GOCACHE=/private/tmp/raahi-go-build` for Go tests.

## Backup and isolated restoration

```
node infra/scripts/backup.mjs /private/tmp/raahi-backup
node infra/scripts/verify-restore.mjs /private/tmp/raahi-backup
node infra/scripts/verify-media-restore.mjs /private/tmp/raahi-backup
```

The backup contains five custom-format pg_dump files and an object-storage archive. Directories/files use 0700/0600 permissions. It contains personal data: encrypt before copying elsewhere. Per-database snapshots are individually consistent; quiesce writes for a coordinated recovery point. For production use storage-native snapshots, encryption, monitored scheduled backups and approved retention. Live file-archive backups require additional crash-consistency validation under load.

The database validator restores only into uniquely named temporary databases, checks their tables, then drops those temporary databases. The media validator starts an isolated SeaweedFS instance on a temporary volume, retrieves private JPEG objects using signed S3 requests, then removes only that temporary instance/volume. It publishes no host ports.

For an actual recovery, stop application writes, restore all owning databases and the matching object snapshot into a separate environment, replay all deletion tombstones recorded after the backup, verify service ownership and migrations, revoke restored sessions, validate consistency, and only then switch traffic. Do not bring an old backup online without replaying deletion requests. Keep the deletion ledger independently backed up for this reason.

## Durable failures and reconciliation

Connections `outbox`: retry exponential backoff, at most ten attempts; inspect `last_error`, `next_attempt_at`, `delivered_at`. Requeue a failed event only after correcting its dependency. Communication `processed_events` makes repeat delivery idempotent. Delivery is at least once, not exactly once.

Communication `outbox` carries persisted-message hints; lost Redis hints recover through canonical HTTP history. Rows with attempts >= 10 remain visible. Requeue after Redis recovery. Events are never proof that a browser rendered a message; delivery/read receipts are explicit authenticated acknowledgements.

Identity `deletion_jobs`: `pending`, `complete`, `needs_attention`. Each acknowledged owner is recorded in `steps`; completed owner actions are idempotent. After fixing a dependency, an authorised administrator can retry a specific exhausted job at `/admin/recovery`, with recent reauthentication, deployed MFA and a recorded reason. Keep its ID and account tombstone. Never mark a job complete manually without owner evidence. The user's HttpOnly receipt exposes status only.

Profile `object_cleanup`: replacement objects retry deletion up to ten times; failed rows remain for operator repair. Account deletion lists and erases the entire account prefix, including replaced/orphaned files. A bounded orphan scanner reconciles non-deleted accounts; see Photo-storage recovery below.

Operations `review_audit`: versioned decisions use durable owner receipts and bounded automatic retries. Exhausted delivery is visible in `/admin/recovery`; legacy unversioned rows require manual investigation and cannot be retried there.

Operations `subscriptions`: `needs_reconciliation` means checkout creation had an ambiguous result. Find the provider subscription by its `notes.raahi_checkout` ID, verify the account/plan, attach the provider ID under an audited operator procedure and run reconciliation. Do not create another checkout blindly. Provider fetches, not webhook arrival order, determine subscription state. The periodic reconciliation worker retries provider reads. Financial reconciliation and refund/chargeback handling require provider sandbox acceptance before release.

## Observability and security posture

Node HTTP logs include only service, method, status, duration and correlation ID. Never log bodies, cookies, phone numbers, codes, documents, biometric data or provider secrets. Readiness checks exercise each database and Redis; profile readiness also checks private object storage. Errors return a stable code and correlation ID without stack traces. Internal tokens are required at private boundaries. Each receiving service now has a distinct credential; callers receive only the destination tokens they need. Deployed environments still require private networks, secure secret distribution/rotation and preferably workload identity or mTLS. Receiver tokens do not provide per-caller identity or endpoint-scoped permissions.

Next responses deny framing, disable MIME sniffing, restrict camera/microphone to self, disable geolocation, and use no-referrer. Current CSP permits Next inline scripts; nonce-based CSP and deployed HTTPS websocket origin configuration require validation. Terminate TLS at the edge, enforce HSTS there, expose only gateway/web routes, configure the authenticated edge described below for client-address rate limiting, and keep all owning services/storage private. Direct local development uses a shared local rate key. Deployed Next API requests fail closed without an authenticated edge address. Arbitrary forwarded headers are ignored.

Production staff endpoints require a database role and a recently verified TOTP session. Set a separate high-entropy `MFA_ENCRYPTION_KEY`; local mode falls back to the local service secret and bypasses the MFA gate for development reviewers. Enrollment requires reauthentication. Recovery requires an audited administrator procedure; a self-service recovery flow is not implemented. Moderator role bootstrap is local-only.

The five development-only npm audit findings are the braces → micromatch → fast-glob → Next ESLint chain. The audit's suggested downgrade to Next ESLint 14 is incompatible with this repository; do not apply it blindly. Production dependency audit returned zero advisories on the recorded run.

## Deployment checklist requiring actual evidence

Configure real OAuth/SMS/verification providers; replace all local approvals with provider-backed evidence; private encrypted S3 with lifecycle/least-privilege keys; TLS and trusted edge rate limits; short-lived TURN credentials and cross-network tests; payment test/live separation and public signed webhooks; staff MFA/recovery and human operations; retention/legal review; load/fault/security testing; independent assistive-technology testing; encrypted backup schedules and deletion-ledger replay. No deployment or production readiness is asserted by this repository.

## Photo-storage recovery

The profile service writes a durable `object_cleanup` intent before upload. A one-minute worker scans 200 objects per batch with a durable cursor and queues unreferenced canonical camera keys with a one-hour grace period. Cleanup takes the same profile-row lock as uploads/deletion and rechecks the live key; an uncertain successful commit cannot cause deletion of the current photo. Replacement cleanup is immediate. Storage failures retry with exponential delay, capped at one hour and ten attempts. Exhausted rows remain visible.

Authorised staff can inspect aggregate counts and scan heartbeat under `/admin/reviews` → **Photo storage recovery**; `GET /admin/media` enforces staff RBAC and deployed MFA. A heartbeat older than five minutes needs investigation. Unknown key formats are never automatically deleted. Inspect exhausted `object_cleanup` rows inside the profile owner's database, resolve the storage failure, then reset only the investigated rows' attempts and next_attempt_at; do not blindly erase failure rows. Use `/admin/recovery` for audited single-job retry; no bulk retry is offered.

Run the real storage/transaction recovery test with `node infra/scripts/test-media-recovery.mjs` after local startup. It creates UUID-scoped fixtures, proves orphan discovery and grace, preserves a live key following an uncertain-commit scenario, tests the upload row lock, and retains exhausted failures. This tests recovery state, not a complete process-kill/partition fault matrix. Existing deployment secrets are passed into the ephemeral test container without printing them; the runner refuses non-local environments.

## Review-decision delivery

Each submission has a UUID version. Staff submit a stable `decisionId` and the reviewed `reviewVersion`; operations persists the request before contacting its owner. The owning identity/profile service commits its decision and payload-bound receipt together. A new camera photo or identity submission receives a new version. Replaying an old receipt acknowledges the old decision without changing the replacement.

The operations worker polls every five seconds, processes at most five due requests, and uses row locks with `SKIP LOCKED`. Transport failures retry exponentially (five seconds to one hour), with ten attempts before `needs_attention`. Definite owner rejection is terminal `rejected`; refresh the queue for a fresh submission. Staff can view their latest 50 versioned requests under **Your review delivery history** on `/admin/reviews`. Audit storage remains the durable source for older records. Unversioned legacy `failed_or_unknown` decisions are not automatically replayed because the original submission cannot be safely identified.

For `needs_attention`, investigate the owning service and receipt before resetting that specific audit row to `requested`, attempts to zero and next_attempt_at to now. Preserve its decision ID, version and payload. Never manufacture a new ID to bypass a conflict. No browser recovery action is provided yet. Receipts are technical hashes without review reasons and cascade on subject-account deletion; audit reasons follow the operations retention policy. Delivery is at least once with idempotent application, not exactly once.

Administrator recovery is now available at `/admin/recovery` for exhausted deletion, photo-cleanup and versioned-review jobs. For explicit local testing only, `node infra/scripts/grant-local-reviewer.mjs <UUID> --admin` grants the admin role; ordinary moderators are denied recovery. Supply an investigation reason and preserve the request ID when retrying an unconfirmed request. The screen shows owner outages and the administrator's last 50 audit entries. Legacy unversioned reviews remain manual because their original submission cannot be identified safely.


## Relay and edge verification

To test actual relay-only calls locally:

```sh
node infra/scripts/local-relay.mjs
docker compose --env-file .env.local -f infra/compose/compose.yml --profile relay up --build -d --wait
EXPECT_TURN_RELAY=1 npm run test:e2e -- tests/e2e/calls-dates.spec.ts
```

The helper preserves existing settings. If TURN_URLS is explicitly `[]` or WEBRTC_RELAY_ONLY is `false`, set the desired local values deliberately in `.env.local` before asserting relay-only behavior. Keep the relay profile enabled on future starts when relay-only mode is configured. Coturn's local config binds published ports to loopback and allows loopback peers for this test only. Do not deploy it unchanged. Configure public relay addresses, reviewed peer restrictions, TLS and capacity/quotas for production. Authenticated matched members receive 600-second REST credentials; the shared secret stays server-side. Active calls refresh credentials and restart ICE before expiry. Longer calls and deployed network changes still need device testing. See [coturn REST authentication](https://github.com/coturn/coturn/blob/master/README.turnserver).

The optional local edge uses `nginx:1.28-alpine`:

```sh
docker compose --env-file .env.local -f infra/compose/compose.yml --profile edge up -d --wait edge
node infra/scripts/test-edge.mjs
```

Port 3080 is an integration-test ingress; the default browser origin remains localhost:3000. The test confirms that the edge's observed IPv4 address increments the real Redis rate key while supplied forwarding addresses do not. Production must expose only a TLS edge, set WEB_ORIGIN to its HTTPS origin, and prevent direct access to Next/gateway/owners. NGINX overwrites the dedicated edge token and address headers; Next validates the secret and canonical IP before forwarding under its separate web-proxy token. Do not trust X-Forwarded-For from arbitrary clients. If a load balancer precedes NGINX, configure a strictly scoped trusted-proxy policy separately; the supplied template intentionally uses the immediate peer. WebSocket upgrades route directly to the gateway, which checks browser origin and the communication service checks the session. [NGINX header configuration](https://nginx.org/en/docs/http/ngx_http_proxy_module.html), [WebSocket forwarding](https://nginx.org/en/docs/http/websocket.html).

`local:env` upgrades old shared-token setups by generating destination credentials and preserving the old key as the explicit MFA encryption key when no key was set. Rebuild all services together after this change. An old SERVICE_TOKEN line in `.env.local` is no longer used by Compose. Rotate destination tokens together with their callers; no dual-key rolling rotation is implemented.
