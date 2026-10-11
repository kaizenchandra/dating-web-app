# Verification evidence — 11 October 2026

Executed locally against the real Compose services. No provider credentials were available, and no live payment or real identity approval is claimed.

| Check | Result |
|---|---|
| Clean-volume foundation startup | Passed earlier in Phase 0 |
| Final Compose build and readiness | All services healthy; Next production build passed |
| Contract generation / TypeScript / ESLint | Passed, no lint warnings |
| Node business/security unit tests | 6 passed |
| Go profile/discovery tests | Passed, including image processing and city-distance privacy/symmetry |
| Go connection tests | Passed |
| Full Playwright regression | 21 passed in 2.1 minutes |
| Subsequent distance/responsive/reporting regression | 3 passed in 1.3 minutes |
| Final sign-out/OTP regression | 4 passed in 2.4 seconds |
| Required widths | 320, 375, 390, 768, 820, 1024, 1280, 1440px; no horizontal page overflow on tested routes |
| Automated accessibility | No axe WCAG A/AA violations on tested landing/login/member screens; not a complete conformance claim |
| Two-browser calls | Separate Chromium processes; nonzero inbound audio and video RTP bytes on both sides |
| Database recovery | All five databases restored into scratch databases and inspected |
| Private object recovery | Isolated restored S3 listed 15 objects; five JPEGs fetched and validated |
| Production npm audit | Zero reported advisories |
| Development npm audit | Five high-severity transitive ESLint findings remain documented |
| Whitespace/diff check | Passed |

The suite covers OTP ownership/attempts/cooldown/expiry/replay, CSRF, invalid callbacks, session revocation, camera capture and replay rejection, review photo authorisation, concurrent match uniqueness, duplicate message retries, history after service restart, blocking, call consent/media/quiet hours, date acceptance, confidential reports after unmatching, moderation/suspension/appeals, privacy export/deletion, staff TOTP/replay rejection, human host review, group chat, concurrent registration, buddy acceptance and leave permissions.

Camera tests use Chromium's synthetic capture devices while exercising actual browser capture, authenticated upload, image processing, private storage and WebRTC transport. Application APIs and databases are not mocked. Payment signature unit tests do not substitute for provider sandbox acceptance. See status.md for all unresolved scope and providers.md for configuration dependencies.

## Continuation: feedback and media recovery

- Contract generation, TypeScript, ESLint and six unit tests passed. Profile Go tests passed.
- Feedback ownership/concurrency, privacy export/deletion and all-width responsive/accessibility: 3/3 browser tests passed (1.3 minutes).
- Real PostgreSQL/S3 recovery integration passed (1.08 seconds): orphan scan/grace, live-key preservation, transaction lock and exhausted-failure retention.
- Camera/review staff status and privacy deletion after recovery changes: 2/2 browser tests passed (12 seconds).
- Updated production Next build and Compose health checks passed. The new CI step is authored but not run remotely.

- Versioned review delivery plus camera/deletion regression: **3/3 passed (25.8 seconds)**. This included six concurrent decision retries, payload conflict, stale photo/identity versions, replay after replacement and a real profile-service stop/start.

- Structured preferences initially exposed a test lookup failure with implicit select labels. Explicit label/control associations fixed it; the two-account preference/redaction journey passed (4.9 seconds). Matching, camera and eight-width responsive/accessibility regression also passed (3 tests).

- Real deletion fault/recovery journey passed (9.8 seconds): stopped commerce owner, verified immediate session revocation and partial receipt, restarted identity, restored owner and observed the same receipt reach completion with all owner acknowledgements. This is a bounded outage/restart test, not a full network-partition stress matrix.

## Latest full regression

**24/24 Playwright tests passed (2.5 minutes)** after all continuation changes. `npm run check` and profile Go tests passed; production Next builds passed. Final gateway readiness returned all five owning services `ready`. The local app remains at `http://localhost:3000`. No remote CI run, deployment, real verification approval or successful provider payment is claimed.

## Visible logout after login

Shared account controls now expose Log out throughout signed-in pages, including onboarding; Settings uses the same logout component. TypeScript, lint and production Next build passed. Focused auth and authenticated responsive/accessibility checks: **5/5 passed (1.3 minutes)**, including actual offline retry, cookie removal and revoked-token rejection. These targeted checks follow the earlier full 24-test regression.


## Latest continuation verification

- **27/27 Playwright journeys passed (3.0 minutes)** against the real services and the IDE development frontend, with EXPECT_TURN_RELAY=1. Covers the prior journeys plus administrator recovery, encrypted unsent retries across a real browser restart, receiver credential isolation, and deletion when browser storage is inaccessible.
- Actual selected WebRTC candidate pairs were relay candidates; both independent browser processes exchanged audio/video RTP through local coturn.
- `npm run check`: contract generation, TypeScript, lint and **8/8 unit tests** passed. Both Go service suites passed.
- Real NGINX → production Next → gateway → Redis check passed: spoofed addresses were ignored and the observed socket address incremented the canonical rate key. Header parsing also rejects invalid addresses and missing/wrong edge secrets.
- An intermediate full run had three failures when the live IDE server picked up the new edge requirement without local environment settings. The localhost-only development fallback fixed the cause; the complete rerun above passed. Deployed builds still require an authenticated edge.
- CI now includes optional relay/edge profiles and relay assertions; no remote CI execution is claimed.

## Conversation media continuation

- Real text, image, browser retry, account privacy and two-process relay call journeys: **5/5 passed (35.9 seconds)**. This extends the earlier 27-test evidence; a full 28-test run is not claimed.
- Image checks cover frontend file preview/caption/send, both participants' image rendering, normalized JPEG/EXIF removal, anonymous and wrong-owner denial, concurrent upload/send retry uniqueness, durable bytes after communication restart, block enforcement and account deletion.
- Production frontend build, Node TypeScript/lint/8 unit checks, and connections Go tests passed. Communication migration `005_images.sql` applied through its normal owning-service startup.
- Final image/reporting/responsive checks: **3/3 passed (1.3 minutes)**, including the open attachment composer at 320/390/820px, all eight required member-screen widths with automated WCAG checks, and authorised viewing of preserved reported-image evidence after unmatching.
