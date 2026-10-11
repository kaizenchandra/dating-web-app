# Requirement → route → API → verification

All API paths below use `/api/v1` at the configured gateway. OpenAPI is `packages/api-contracts/openapi.v1.json`; TypeScript types are generated into `packages/generated-clients/schema.ts`. Tests run against real services, PostgreSQL, Redis and S3 storage. Provider credentials are not replaced with mock success responses.

| Journey | Frontend | Owning API | Evidence / limits |
|---|---|---|---|
| Health and startup | `/`, `/status` | gateway `/status`, service `/health/ready` | foundation.spec.ts; clean-volume Compose start previously verified |
| Phone, consent, sessions, OAuth/linking | `/login`, `/onboarding`, `/settings` | identity `/auth/*`, `/account/*` | auth.spec.ts; live provider callbacks remain external |
| Identity, age and camera profiles | `/verify`, `/profile`, `/profile/preview` | identity `/verification/*`; Go `/profile/*` | profile.spec.ts: camera persistence, replay rejection, visibility, local review; real verification unresolved |
| Discovery and relationships | `/discover`, `/interests` | Go `/discovery/*`, `/connections/*` | connections.spec.ts: city-radius filtering, shared-interest explanation, independent accounts, 12 concurrent mutual-like retries, immediate block |
| Messaging and notifications | `/inbox` | communication `/inbox`, `/messages*`, `/notifications*`, `/socket` | messaging.spec.ts: persistence, six duplicate retries, ownership, restart/reconnect and active block |
| Calling | `/calls` | communication `/calls*`, authenticated signalling | calls-dates.spec.ts: two independent browser processes, inbound audio/video bytes on both, consent, mute/end; TURN remains unconfigured |
| Date plans | `/dates` | communication `/dates*` | calls-dates.spec.ts: public venue, invite/accept, persistence, explicit sharing preview and check-in |
| Reports, suspension, appeals | `/safety`, `/admin/reports` | operations `/reports`, `/safety/account`, `/admin/reports*`; identity restriction authority | safety.spec.ts: after-unmatch evidence, confidential ownership, staff-only enforcement, revocation, appeal and restoration |
| Staff MFA | `/admin/security` | operations `/admin/mfa/*` | RFC 6238/replay unit tests; production MFA enforcement exists, deployment validation remains |
| Data control | `/privacy-control` | identity `/account/export`, `/account/withdraw`, `/account/delete`, `/account/deletion`; each owner `/internal/privacy/*` | privacy.spec.ts: export, withdrawal, cross-owner deletion, receipt survives reload |
| Membership | `/premium` | operations `/premium*`, `/webhooks/razorpay`, `/internal/entitlement` | invalid signature/unconfigured checkout/entitlement denial tested; provider sandbox success/replay/reordering gate blocked on credentials |
| Communities, host review, events | `/communities`, `/admin/hosts` | operations `/communities*`, `/admin/hosts`; communication `/communities/messages` | communities.spec.ts: review, membership, durable chat, concurrent registration and leave; buddy acceptance added to regression |
| Language and wellbeing | `/wellbeing` | identity `/account/wellbeing`, `/internal/availability` | persisted Hindi navigation, read-receipt default, IST quiet hours; forms remain English |
| Responsive/accessibility | all core member pages | real APIs | responsive.spec.ts: 320, 375, 390, 768, 820, 1024, 1280, 1440px; axe WCAG A/AA; manual assistive-technology audit remains |

Unimplemented scope is explicitly tracked in phase-status/status.md. An API adapter or local simulator is not evidence of production approval or successful provider integration.

## Private recommendation feedback

`/discover` → `GET/POST /discovery/feedback` (profile-discovery). A verified member can hide a recommendation with a structured private reason, undo that choice, inspect reason totals and reset all hidden recommendations. Discovery excludes saved targets in its owner database; this does not change relationship permissions or infer new demographic preferences. Session ownership is authoritative, repeats use a unique `(account_id,target_id)` row, and both account references cascade on deletion. Personal-data export includes owned feedback. No asynchronous cross-service event is required for this local state transition.

Acceptance evidence: `connections.spec.ts` exercises hide/undo, six concurrent duplicate writes, reload persistence, reason totals, reset and rejected ownership injection; `privacy.spec.ts` checks export and cross-service deletion; `responsive.spec.ts` covers discovery at all eight required widths.

## Media recovery visibility

`/admin/reviews` → `GET /admin/media` → profile owner's `/internal/media/status`; staff RBAC/MFA gates aggregate recovery counts. `profile.spec.ts` verifies ordinary-member denial and staff screen integration. `media_recovery_integration_test.go` verifies the worker with actual PostgreSQL and private S3, including lock contention and protected live keys.

## Versioned review delivery

`/admin/reviews` → `POST /admin/reviews/decision` with `decisionId`/`reviewVersion`; staff history uses `GET /admin/reviews/delivery`. Operations owns the durable request/retry state, identity/profile own atomic decision receipts. `reviews.spec.ts` covers concurrent duplicate submissions, changed-payload conflict, replacement-version rejection, receipt replay after a replacement, real profile-service stop/start reconciliation, identity resubmission and staff history permissions/UI. Real external verification is still not approved or configured.

## Structured dealbreakers and visibility

`/profile` → `GET/PUT /profile`, private `/profile/preview` and authenticated `/discovery`. Optional smoking/drinking/children answers support reciprocal allowed-answer dealbreakers. Empty categories are unrestricted; unknown answers fail active categories. Fourteen additional hidden-field controls are projected by one Go function across preview and all candidate cards. Private answers may still satisfy filtering; shared-interest explanations use only visible interests. `preferences.spec.ts` checks UI persistence, API validation, redaction, unknown answers and both directions of filtering with real accounts; Go tests protect projection and rule semantics.

## Signed-in logout control

The root layout shows an account control after session validation, including during onboarding and on mobile pages. Its reusable `LogoutButton` calls the existing `POST /auth/logout`, waits for server revocation and uses a full navigation to `/login` to discard cached private pages. Settings reuses the same component. Failed requests retain the button with an accessible retry error. `auth.spec.ts` checks signed-out invisibility, onboarding visibility, logout from a 320px profile page, offline failure/retry, cookie removal and rejection of the old session token.

## Administrator recovery

`/admin/recovery` → `GET/POST /admin/recovery` requires an admin role, deployed MFA and recent sign-in for mutations. Identity requeues exhausted deletion jobs, profile-discovery requeues exhausted cleanup jobs, and operations requeues exhausted versioned reviews. Owners atomically record recovery receipts; operations preserves the request/audit reason and explicitly shows unavailable services. The screen can retry an unconfirmed audit request using its original ID after reload. `recovery.spec.ts` verifies member/moderator denial, real owner outage, deletion resumption, all three queues and payload-bound retries.

## Browser-retained unsent messages

`/inbox` uses the existing `/messages` contract and durable `clientMessageId` semantics. Saving unsent retries is an explicit private-device opt-in. IndexedDB holds AES-GCM ciphertext with a non-extractable browser key, scoped to the authenticated account; text is not written to localStorage. Restored retries require user action and still pass normal server match/block checks. Browser persistence is not server acknowledgement. The local queue is capped at 100 entries, expires entries after 72 hours on next access, and clears on disable/logout/deletion. `outbox.spec.ts` restarts an actual persistent Chromium profile, verifies ciphertext, explicit retry, single durable delivery and logout cleanup.

| Requirement | Screen | API/boundary | Evidence |
|---|---|---|---|
| Short-lived relay credentials | `/calls` | `GET /calls/config?conversationId=` | `tests/turn.test.ts`, `tests/e2e/calls-dates.spec.ts` with EXPECT_TURN_RELAY=1 |
| Destination credential isolation | All integrated routes | Internal owner boundary | `tests/e2e/service-auth.spec.ts` |
| Authenticated edge client address | Browser API proxy | Edge → Next → gateway rate limit | `tests/client-address.test.ts`, `infra/scripts/test-edge.mjs` |

## Text, images and video calls

`/inbox` sends durable text through `POST /messages`; a stable clientMessageId prevents duplicate retries. `POST /messages/image` validates and re-encodes a selected image and returns an owner/conversation-bound image ID. `POST /messages` attaches that ID atomically under the existing authoritative connection guard. `GET /messages/image?id=` checks current match access on every read; only the sender sees unsent images. History and WebSocket hints use the existing message contract with nullable imageId. The inbox polls call invitations for the selected conversation; its video/audio link opens `/calls`, where explicit acceptance starts audio and Preview camera → Share camera enables video.

Acceptance: two accounts exchange text and image messages, reload/restart preserves history, concurrent upload/send retries yield one result, wrong-owner/anonymous/blocked reads or sends fail, deletion removes image bytes, and reports preserve evidence after unmatch. `images.spec.ts`, `messaging.spec.ts`, `outbox.spec.ts`, `privacy.spec.ts`, `safety.spec.ts` and two-independent-browser `calls-dates.spec.ts` cover these journeys. No public image links or application API mocks are used.

| Gold / Diamond / Platinum selection and billing modes | `/premium` | GET `/premium`, POST `/premium/checkout`, `/premium/verify`, `/premium/reconcile`, `/premium/cancel`, `/premium/refund`; `/webhooks/razorpay` | `membership.spec.ts`, `payment-state.test.ts`, `payment-signature.test.ts`; actual provider acceptance blocked on credentials |
| Tier-authorised discovery ordering | `/discover?ranking=interests\|intent\|city` | GET `/discovery?ranking=…`, internal operations entitlement | `membership.spec.ts` checks unpaid denial for every ranking; actual paid-provider activation not yet verified |

## Subscription feature enforcement

| Requirement | Screen / API | Checks |
|---|---|---|
| Tier-based daily super likes and direct introductions | `/premium`, `/discover`; `GET /connections/allowance`, `POST /connections/action` with optional `superLike` | `benefits.spec.ts`, `payment-state.test.ts`, `allowances_test.go` |
| Consent before direct chat, super-like badge | `/interests`; existing connection acceptance and match guard | `benefits.spec.ts`, `connections.spec.ts` |
| Free age/location hiding survives expiry | `/profile`, preview, discovery and connection cards; existing profile APIs with `hiddenFields: [age, city]` | `benefits.spec.ts`, `preferences_test.go` |

Policy and ownership: [subscription benefits](../architecture/subscription-benefits.md). No new cross-service database reads or duplicate entitlement policy were introduced.

## Connection-style enhancement

| Requirement | Routes / contract | Verification |
|---|---|---|
| Persist pace, up to three date preferences and an opening question | `/profile`, `/profile/preview`; profile JSON fields `datingPace`, `dateVibes`, `openingQuestion` | `connection-style.spec.ts`, `connection_style_test.go` |
| Filter visible connection styles | `/discover`; GET `/discovery?datingPace=…&dateVibe=…` | `connection-style.spec.ts`, visibility-aware filter unit test |
| Editable draft from visible answers | Discovery profile dialog → existing POST `/connections/action` | Two-account explicit edit/send/accept in `connection-style.spec.ts` |
| Recipient controls on direct introductions | Profile `introductionPolicy`; internal eligibility returns owner policy, checked before usage/relationship commit | Refusal with unchanged allowance in `connection-style.spec.ts` |

See [product/ownership notes](../architecture/modern-dating-features.md). No new event type is required: profile changes are owner reads; introductions use existing persisted relationship state and matching uses the existing transactional outbox.
