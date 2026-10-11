# Delivery status

This is a working local platform, not a completed production release. A local gate is evidence of an integrated journey, not completion of every requested capability or external approval.

| Phase | Status | Verified evidence / dependency |
|---|---|---|
| 0 — foundation | Complete locally | Repository assessment, six purposeful services, private PG/Redis/S3 infrastructure, contracts/generated client, migrations, CI; clean-volume Compose startup and production Next build passed |
| 1 — authentication | Local gate complete; external dependencies | Real OTP persistence, consent, refresh/resume, sessions/revocation/logout; invalid OTP/CSRF/callback tests. OAuth success needs configured providers; SMS delivery needs vendor adapter |
| 2 — verification/photos/profiles | Local gate complete; external dependencies | Camera capture → validated/re-encoded private S3 → persisted preview; replay rejection, visibility and review RBAC. Verification approvals remain explicitly local simulations; real provider/liveness unresolved |
| 3 — discovery/connections | Core local gate complete; remaining scope | Real profile eligibility, reciprocal preferences, city/age/intent filters, introductions, matches, 12 concurrent retry uniqueness, blocks. City-centroid distance and shared-interest explanations are implemented; private recommendation feedback with hide/undo/reset is implemented; structured smoking/drinking/children dealbreakers and expanded field visibility are implemented |
| 4 — communication | Core local gate complete; external delivery dependency | Two-session WebSocket messages, six retry deduplication, durable history after service restart, unread/receipts, ownership and active blocking. Opt-in encrypted browser retries survive browser restart and clear on logout; in-app notifications work; external push/SMS/email is not integrated |
| 5 — calls/dates/safety/privacy | Core local gates complete; production dependencies | Two independent Chromium processes exchanged inbound audio/video bytes; date invite/accept/share/check-in; confidential after-unmatch reports, staff restriction, appeal; exports, consent withdrawal and deletion across all owners. Local relay-only TURN media with short-lived credentials passes; public relay deployment, provider evidence and operational/legal review remain |
| 6 — premium/advanced experiences | Partially implemented; payment gate blocked | Reviewed hosts, persisted groups/chat/events, transactional registration/cancellation tested; buddy consent, staff TOTP, quiet hours and Hindi navigation tested. Razorpay adapter and signature/denial paths implemented; no sandbox payment was performed without credentials |
| 7 — release preparation | Independent checks passed; full release gate blocked | Eight-width responsive checks and automated WCAG A/AA passed; production npm audit zero advisories; all five DB restores and isolated S3 photo restoration passed. Latest full 27-test regression passed, including feedback, private dealbreakers, versioned review recovery and deletion outage/restart. External approvals and production tests remain |

## Evidence recorded in this workspace

- `npm run check`: generated contracts, TypeScript, ESLint and eight business/security unit tests pass.
- `go test ./...` for both Go services passes (using a writable GOCACHE locally).
- Latest full browser regression: **27/27 passed (3.0 minutes)** against the real services. Includes real relay-only media between two independent WebRTC browser processes, encrypted retries across browser restart, receiver-credential isolation, audited recovery, six concurrent review retries, replacement-version protection, an actual profile-service outage and deletion recovery across an owner outage plus identity-worker restart.
- Real PostgreSQL/private-S3 recovery test passed: orphan scan/grace, current-photo preservation, transaction lock contention and exhausted failure retention. Staff recovery status and delivery history use backend RBAC/MFA.
- Authenticated edge integration passed: NGINX overwrites spoofed headers and the gateway increments the real Redis rate key for the observed client address.
- Real browser tests: auth, camera/profile, concurrent matching, persistent/reconnecting messages, real WebRTC media, dates, reporting/appeals, privacy deletion, communities and responsive/accessibility.
- Required widths: 320, 375, 390, 768, 820, 1024, 1280, 1440. Automated accessibility checks do not establish complete WCAG conformance; screen-reader, keyboard-under-dialog and device audits remain.
- Database restore: identity, profile_discovery, connections, communication and commerce_operations restored into temporary databases and inspected.
- Private object restore: 15 objects listed; five JPEGs fetched and validated from an isolated restored SeaweedFS instance.
- Production dependency audit: zero reported vulnerabilities. Five high-severity development-tool findings remain in the Next ESLint/fast-glob/micromatch/braces chain; no incompatible downgrade was applied.

## External dependency

Real Google/Apple/LinkedIn client setup and approval; Indian SMS vendor/template approvals; DigiLocker or alternative identity/age provider; liveness/face matching; production moderation evidence; Razorpay test keys, monthly INR plan and signed public webhook; merchant approval; public TURN deployment; external notification delivery; encrypted managed infrastructure and production privacy/retention review. See [provider setup](../runbooks/providers.md).

## Remaining software and validation limitations

These are implementation work, not external credential excuses:

- Optional voice/video profile introductions. Structured smoking/drinking/children dealbreakers and fourteen additional field visibility controls are implemented; full localisation and broader optional dimensions remain. City distance is coarse, uses attributed GeoNames centroids, and stays unavailable for unknown or ambiguous city names.
- Full localisation beyond Hindi navigation and bilingual wellbeing. Online speed-dating media rotation is not implemented; event hosts can schedule offline speed introductions.
- Broader deletion partition/concurrency stress tests. Administrator recovery UI is implemented and tested for exhausted deletion, media and versioned review jobs. A real owner outage plus identity-worker restart now passes with durable receipt resumption. Versioned review decisions now have atomic owner receipts, durable bounded retries and staff delivery history; real service-stop/restart and replacement-protection tests passed. Durable failure rows and runbooks exist. Media now has bounded orphan scans, live-key protection, delayed cleanup, exponential retries and a staff status view; process-kill/partition stress remains.
- Financial refund/chargeback entitlement transitions and complete retention enforcement need sandbox acceptance; refund requests persist but do not issue money. Ambiguous checkout creation requires operator reconciliation.
- External notification adapters and distributed tracing/load testing remain. Browser-persistent encrypted retries, separate receiver credentials, authenticated edge client-address forwarding and short-lived TURN credentials are now implemented. Public TLS edge deployment and cross-network relay behavior still need deployment evidence.
- Full production moderation operations, provider document evidence, human access/recovery policies, accessibility assistive-technology audit, security assessment and cross-device/cross-network tests.

No deployment, provider approval, production verification or production readiness is claimed. Unrelated `.idea` additions and `prompt.md` were preserved.


## Current continuation: integrated recovery and hardening

- **Complete locally:** administrator recovery screen and APIs for deletion, media cleanup and versioned review delivery; role checks, recent reauthentication, deployed MFA, reason/audit and payload-bound retry receipts.
- **Complete locally:** explicit private-browser message persistence with AES-GCM, 100-entry bound, 72-hour access-time expiry, restore/review/manual retry, stable server message IDs, logout cleanup and deletion cleanup fallback.
- **Complete locally:** coturn relay-only audio/video between independent browser processes, 600-second server-issued credentials and client refresh; separate receiver credentials and dedicated web/edge tokens; real NGINX forwarding and Redis address-key spoof resistance.
- **In progress:** remaining optional profile media, broader localisation, online speed rotation, financial workflows, notification adapters and release stress/operational checks listed above. They are not marked complete by these increments.
- **External dependency:** real identity/liveness, OAuth/provider acceptance, SMS delivery, Razorpay sandbox/merchant approval and public encrypted infrastructure.

## Conversation text, images and video

Text messaging continues to use the existing durable message/receipt/outbox flow. Image messaging now adds preview, optional captions, private validated uploads, normalized metadata-free JPEG delivery, server-bound retry IDs, blocked-access enforcement and sender deletion cleanup. Gallery selection is available for chat only; profile photos remain camera-only. The selected inbox conversation shows incoming call invitations and links to the working audio/video flow with explicit camera preview/share consent. Staff can inspect preserved reported-image evidence after unmatching.

Targeted text/image/outbox/privacy/call journeys passed against real services, including separate browser processes exchanging relayed audio/video. Remaining platform scope elsewhere in this document is unchanged.

## Gold, Diamond and Platinum membership update

- **Implemented:** database-owned tier/price snapshots; Razorpay recurring subscriptions and non-renewing 30-day Orders; Standard Checkout UI; verified callback endpoint; signed replay-aware webhooks; canonical reconciliation; cancellation/refund requests; tier-authorised discovery ordering. Migration: operations `008_membership_tiers.sql`.
- **Verified:** contract generation, TypeScript, ESLint, 10 unit tests, Go profile tests, production image build and healthy local services. Browser evidence is recorded below after completion.
- **External dependency / blocked acceptance:** no configured Razorpay credentials, plan IDs or approved public webhook; no successful sandbox payment performed. Apple Pay requires merchant/domain enablement and a live eligible wallet; it is not a sandbox feature. Recurring Apple Pay is not represented as supported. See the payment section of [provider setup](../runbooks/providers.md).
- **Limitations:** no automatic proration/tier changes while an existing purchase is pending/paid; ambiguous checkout creation requires operator investigation. Provider dispute/refund release tests remain open.
- **Browser evidence:** `membership.spec.ts` and `responsive.spec.ts`: **2 passed in 1.2m**, against rebuilt PostgreSQL-backed services. Verified three catalogue tiers, billing selection, persisted reload, invalid input/unowned confirmation rejection, unconfigured checkout denial and unpaid ranking restrictions. All requested widths (320, 375, 390, 768, 820, 1024, 1280, 1440) and automated WCAG checks passed. No provider SDK success or paid entitlement was simulated.

## Subscription feature allowances and privacy controls

- **Implemented:** Free 0/3, Gold 5/10, Diamond 15/25, Platinum 30/50 daily super-like/direct-introduction limits. Operations owns policy; connections owns transactional usage, recipient-specific retry deduplication and IST resets. Discovery has super-like opt-in and usage counters; incoming interests display the badge and require acceptance before chat.
- **Implemented:** age, city and distance hiding through persisted profile visibility controls and common server projection. Privacy remains free, including after subscription expiry; private eligibility/preferences still apply.
- **Verified:** 11 Node unit tests, contract generation, TypeScript, lint, both affected Go suites, production frontend build and healthy rebuilt services. Benefit integration uses explicit local paid-period fixtures, not simulated Razorpay charges.
- **External dependency:** real Razorpay payment activation/merchant setup remains as above; no new provider dependency for allowance enforcement or privacy controls.
- **Final browser evidence:** `benefits.spec.ts`, `connections.spec.ts`, `membership.spec.ts`, `responsive.spec.ts`: **4 passed in 1.3m**. Includes six simultaneous retries consuming one credit, quota rejection rolling back introduction usage, all paid-tier limits, downgrade on expiry, recipient acceptance, private cards/preview after expiry, mutual match concurrency, blocking, all eight specified widths and automated WCAG checks. An initial fixture role mismatch was corrected; the final run completed sequentially without overlapping Playwright artifact output.

## Modern connection-style enhancement

- **Implemented:** structured dating pace, up to three first-date preferences, opening questions, corresponding discovery filters and public details. Persisted profile visibility applies to every new field.
- **Implemented:** editable, deterministic conversation drafts from the person's visible opening question/shared interests; no automatic sending. Recipient introduction policy is enforced synchronously before charging an allowance. Plain interests and matched chat retain existing consent rules.
- **Checks so far:** generated contracts, TypeScript, lint, 11 Node tests, both Go suites and production Compose build passed. Rebuilt web/profile/connections services are healthy. Browser results recorded after completion below.
- **Dependencies:** none added for these features. Existing identity, notification, payment and production-readiness dependencies remain unresolved. [Feature list and ownership](../architecture/modern-dating-features.md).
- **Final browser evidence:** new connection-style journey and responsive/accessibility suite **2 passed (1.2m)** after explicit discovery-label correction; existing benefit and private-preference journeys also passed against these service changes. All eight required widths and automated WCAG checks passed. The first selector timeout and interrupted pre-rebuild responsive run are superseded by the successful final run; no API response mocks were used.
