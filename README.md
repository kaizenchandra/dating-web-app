# Raahi

An India-focused adult dating platform, under development. See [phase status](docs/phase-status/status.md) for actual completion evidence. The working local stack includes Next.js, four Node/TypeScript services, two Go services, PostgreSQL, Redis and private S3 storage. Phone onboarding, camera profiles, discovery/matching, messages, calls, dates, reports, privacy controls and communities use real services and persisted data. Real verification and payment-provider acceptance remain external dependencies.

## Local development

Prerequisites: Node 24, npm and Docker Compose v2+ (Docker Desktop or OrbStack). Go 1.25+ is needed only for host-side Go development. No external provider account is needed for the clearly labelled local testing journeys.

```sh
npm ci
npm run local:env
npm run local:up
```

Open http://localhost:3000. The live readiness screen checks the gateway, all five owning services and their PostgreSQL/Redis dependencies. Gateway health is also available at http://localhost:4000/api/v1/status. Infrastructure and internal services are not exposed to host ports.

On macOS if OrbStack's Docker is not on PATH:

```sh
export PATH="/Applications/OrbStack.app/Contents/MacOS/xbin:$PATH"
```

For frontend hot reload, keep the backend running, stop only the Compose web container, then run `npm run dev`. GATEWAY_URL defaults to http://localhost:4000. Do not run two frontends on the same port.

```sh
docker compose --env-file .env.local -f infra/compose/compose.yml stop web
npm run dev
```

## Checks

```sh
npm run check
npx playwright install chromium
npm run test:e2e
npm run build
```

Browser tests require the real running stack. `npm run contracts` regenerates types from versioned OpenAPI. CI builds and starts the Compose stack before browser checks.

## Databases and shutdown

The Postgres initialization script creates five isolated databases and logins on a fresh volume. Each service applies its own checksum-tracked migrations at startup. No fake public profiles are seeded. Changing an initialized database password requires an explicit credential migration; changing .env.local alone will not update existing roles.

`npm run local:down` preserves volumes. Do not add `--volumes` unless you intend to delete local data. Never use local environment secrets or Compose's development network posture for a production deployment.

## Documentation

- [Architecture and service ownership](docs/architecture/decisions.md)
- [Requirements and route traceability](docs/api/traceability.md)
- [API/event conventions](docs/api/conventions.md)
- [Provider readiness](docs/runbooks/providers.md)
- [Phase status](docs/phase-status/status.md)

## Authentication slice

`/login` → explicit local OTP delivery → `/onboarding` consent → `/settings` is persisted in the identity database. The identity service applies checksum-tracked SQL migrations under `services/identity/migrations` during startup. No manual seed is required. Browser tests reset OTP challenges only for their reserved local fixture numbers; they require APP_ENV=local. On systems without Docker on PATH, set `DOCKER_BIN` to its absolute executable path for those tests.

Production OAuth/SMS credentials are not included; see the provider runbook. Self-declared adulthood and local phone codes do not establish verified age, identity or real phone ownership. Dating access requires approved age/identity and camera photo states; in local mode these approvals are visibly simulated.

## Verification and profiles

Continue from `/onboarding` to `/verify`, then `/profile` and `/profile/preview`. Local verification and photo-review outcomes are conspicuously simulated. Profile edits and camera photos persist in PostgreSQL and private SeaweedFS object storage. Gallery upload is not offered. Camera access requires localhost or HTTPS and browser permission. Production identity/liveness approvals remain unresolved.

Staff review: grant an explicit local moderator role with `node infra/scripts/grant-local-reviewer.mjs <account UUID>`, then sign in to that account and visit `/admin/reviews`. Normal accounts receive 403. This bootstrap refuses non-local environments. The queue is a development workflow, not evidence that production human-review operations are ready.

## Integrated member journeys

After local sign-in, consent, verification simulation and camera capture, use `/discover`, `/interests` and `/inbox`. Two independent accounts are needed for mutual matching and communication. `/calls` opens from a conversation and exchanges actual WebRTC media; local tests verify audio/video between separate Chromium processes. Production TURN is not configured.

`/dates` provides consent-based invitations and explicit sharing. `/safety` stores confidential reports and appeals, including message evidence after unmatching. `/privacy-control` exports owned data, withdraws consent and tracks cross-service account deletion. `/wellbeing` saves Hindi navigation, read-receipt defaults and IST quiet hours. `/communities` supports reviewed hosts, membership, public-venue events, registration, group chat and event-buddy invitations. `/premium` remains visibly unavailable until provider credentials/plan/webhooks are configured.

Staff routes are `/admin/reviews`, `/admin/reports`, `/admin/hosts`, `/admin/security` and administrator-only `/admin/recovery`. The backend enforces roles; deployed environments additionally enforce TOTP. See [operations and recovery](docs/runbooks/operations.md) and [retention policy](docs/runbooks/retention.md).

The full requested production scope is **not complete**. See [phase status](docs/phase-status/status.md) for remaining software work as well as external approvals. Local verification is not production identity assurance, and no successful provider payment has been claimed.

New integrated controls: `/profile` supports reciprocal smoking/drinking/children dealbreakers and optional-field visibility. `/discover` provides private hide reasons, undo and reset. `/admin/reviews` includes durable decision-delivery history and photo-recovery status. Review retries are tied to the exact submission version, so a replacement photo cannot inherit an earlier approval. Photo recovery is checked against real PostgreSQL/S3 with `node infra/scripts/test-media-recovery.mjs` after local startup.


The inbox offers opt-in encrypted browser retries that survive closing the browser; restored messages require explicit retry. Logout revokes the server session and clears saved retries. `/admin/recovery` provides audited recovery for exhausted deletion, media cleanup and versioned review jobs. Bootstrap a local administrator explicitly with `node infra/scripts/grant-local-reviewer.mjs <account UUID> --admin`.

Optional local TURN relay and authenticated edge profiles, credential upgrades and their verification commands are documented in [operations](docs/runbooks/operations.md). Production relay deployment and TLS remain separate requirements.

In a mutual-match conversation, use the message field for text or **Send an image** to preview and send JPEG/PNG/WebP images (up to 5 MB). Select **Video / audio call** to invite your match; the recipient sees **Review call invitation** in the selected inbox conversation. After accepting audio, each person independently uses **Preview camera → Share camera** to enable video. Camera/microphone access requires localhost or HTTPS.

Memberships at `/premium` now offer Gold (₹499), Diamond (₹999) and Platinum (₹1,499), with configurable prices, monthly renewal or a non-renewing 30-day pass. Razorpay UPI/card checkout requires provider credentials. Apple Pay is conditional on live merchant/device eligibility for the pass. Follow [payment setup and acceptance requirements](docs/runbooks/providers.md#payment-configuration-and-acceptance-gate); checkout never grants access from a browser success redirect.

Connection-style enhancements: set dating pace, first-date preferences and an opening question in `/profile`; filter those preferences in `/discover`, use an editable conversation starter, and control whether people may send pre-match introductions. Visibility and consent controls remain free. [Implemented feature list](docs/architecture/modern-dating-features.md).
