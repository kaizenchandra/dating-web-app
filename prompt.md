Paste this into your IntelliJ Codex agent:

```text
Act as a senior product designer, full-stack architect, and backend engineer working inside IntelliJ.

Design and develop an original, India-focused dating platform with:
- Frontend: Next.js App Router and TypeScript.
- Backend: Node.js with TypeScript and Go microservices.
- Database: PostgreSQL.
- Cache and ephemeral coordination: Redis.
- Local development: Docker Compose.

Implement the application in integrated phases. Every phase must deliver working frontend-to-backend journeys before starting the next phase.

Build actual functionality. Do not stop at a plan, static screens, disconnected services, or frontend mocks presented as completed integrations.

1. PRODUCT OBJECTIVE

Create a modern dating platform for adults aged 18+ residing in India at launch.

Combine:
- Detailed profiles and intentional introductions.
- Efficient discovery and mutual matching.
- Authenticity and identity verification.
- Private communication.
- Consent-based calling.
- Safer offline date planning.
- Strong privacy and user control.

Use Aisle and Tinder only as functional references. Create independent branding, layouts, components, copy, and interaction presentation.

The application must support desktop, mobile, and iPad/tablet browsers.

2. EXECUTION RULES

Before changing code:
- Inspect the repository and applicable AGENTS.md instructions.
- Identify existing frontend, backend, infrastructure, and tests.
- Follow established conventions where compatible.
- Preserve unrelated user changes.
- Review existing integrations before replacing them.

Make reasonable implementation decisions without repeatedly asking for confirmation.

Work in coherent phases and continue until the agreed scope is complete.

Never:
- Declare a phase complete while its frontend still depends on an obsolete mock.
- Build duplicate implementations of the same business rule.
- Silently substitute fake verification, payments, messages, or calls.
- Claim deployment, provider approval, or production readiness without evidence.
- Leave important user actions wired to placeholder buttons.

External credentials and approvals can be genuine blockers. Continue independent work, document the exact dependency, and clearly distinguish sandbox functionality from production integration.

3. DELIVERY STRATEGY: INTEGRATED VERTICAL SLICES

For every feature:
1. Define its user journey and acceptance criteria.
2. Define the API contract and permissions.
3. Implement database changes and backend behaviour.
4. Implement frontend screens against the real API.
5. Implement loading, errors, retries, and cancellation.
6. Verify the complete journey.
7. Document remaining external dependencies.

Do not build the entire frontend first and connect the backend later.

After every phase, provide a brief update covering:
- Working journeys.
- Services and screens implemented.
- Checks performed.
- Remaining dependencies.
- Next phase.

Do not stop after an update unless genuinely blocked.

4. ARCHITECTURE AND SERVICE OWNERSHIP

Use a small, purposeful set of microservices. Avoid one service per entity.

Suggested initial ownership:

Node.js / TypeScript:
A. API Gateway and browser-facing BFF
- Public API boundary.
- Session handling.
- Request validation.
- Aggregation.
- Rate limiting.
- Correlation IDs.
- WebSocket upgrade routing.
- Frontend-compatible error responses.

B. Identity and Account Service
- OAuth/OIDC.
- Mobile OTP.
- Account linking.
- Sessions.
- Eligibility.
- Verification orchestration.
- Consent.
- Account deletion coordination.

C. Communication Service
- Persistent messaging.
- WebSocket events.
- Conversation permissions.
- Call signalling.
- Date plans.
- Notifications.

D. Commerce and Operations Service
- Subscription entitlements.
- Payment-provider integration.
- Support.
- Reporting and moderation workflows.
- Administrative actions.

Go:
E. Profile and Discovery Service
- Profiles and preferences.
- Media metadata.
- Candidate eligibility.
- Filters.
- Recommendations.
- Pagination.

F. Connection Service
- Likes.
- Passes.
- Introductions.
- Invitations.
- Mutual matches.
- Blocking relationships.
- Match lifecycle.

Adjust service boundaries only when repository evidence or clear domain needs justify it. Record the decision.

For local development:
- One PostgreSQL instance may host separate databases/schemas.
- Each service owns its tables and migrations.
- Do not query another service’s tables directly.
- Share infrastructure where useful without sharing business-data ownership.
- Use a clear event interface; introduce a dedicated broker only when needed.

5. CROSS-SERVICE CONSISTENCY

Use synchronous APIs for operations requiring immediate confirmation.

Use durable events for asynchronous work such as notifications, indexing, and deletion orchestration.

Implement where applicable:
- Transactional outbox.
- Idempotent consumers.
- Event IDs and versions.
- Retry policies.
- Dead-letter/failure visibility.
- Reconciliation jobs.
- Compensating actions for multi-service workflows.

Do not claim exactly-once delivery.

Critical safety restrictions must not rely only on eventual consistency.

For example:
- Blocking must immediately prevent new messages and calls.
- Suspension must prevent authenticated restricted actions.
- Discovery must exclude ineligible accounts.
- Match access must be checked by the authoritative service.

If an authoritative safety check is unavailable, fail closed for the affected action.

6. MONOREPO STRUCTURE

Use a structure similar to:

apps/
  web/

services/
  gateway/
  identity/
  communication/
  commerce-operations/
  profile-discovery/
  connections/

packages/
  api-contracts/
  generated-clients/
  ui/
  shared-config/
  test-fixtures/

infra/
  compose/
  migrations/
  scripts/

docs/
  architecture/
  api/
  runbooks/
  phase-status/

Avoid sharing service-internal database models across services.

7. FRONTEND DESIGN

Create an original working brand name and premium dark identity.

Visual direction:
- Deep charcoal/midnight backgrounds.
- Layered surfaces.
- Warm off-white text.
- Accessible muted text.
- Electric coral primary actions.
- Selective lavender/lime highlights.
- Expressive headings and readable body text.
- Spacious layouts.
- Restrained motion.
- Playful details in suitable moments.

Avoid:
- Generic dashboard styling for the dating experience.
- Excessive neon, gradients, or glass effects.
- Fake testimonials or user counts.
- Public attractiveness scores.
- Unsupported safety claims.

Responsive behaviour:
- Mobile bottom navigation and touch-friendly sheets.
- Tablet adaptive navigation and split views.
- Desktop persistent navigation and controlled content widths.
- Virtual-keyboard-aware messaging.
- No hover-only actions.

Validate widths:
320, 375, 390, 768, 820, 1024, 1280, and 1440px.

Aim for WCAG 2.2 AA with keyboard access, visible focus, semantic HTML, accessible errors, contrast, reduced motion, and gesture alternatives.

8. CONTRACT-FIRST INTEGRATION

Create versioned OpenAPI contracts before implementing endpoints.

Include:
- Request and response schemas.
- Authentication requirements.
- Permissions.
- Error codes.
- Pagination.
- Idempotency semantics.
- Rate-limit responses.
- Relevant state transitions.

Generate TypeScript clients for the frontend and service-to-service clients where practical.

Define WebSocket/event schemas separately with versioned contracts.

Use a consistent error envelope containing:
- Stable machine-readable code.
- User-appropriate message.
- Optional field errors.
- Correlation ID.

Never expose stack traces, provider secrets, or sensitive personal information.

The frontend must use configured gateway URLs and generated clients. Avoid scattered hardcoded endpoints.

Add a requirement-to-route/API/test traceability document.

9. LOGIN AND REGISTRATION

Support:
1. Google.
2. Apple.
3. LinkedIn.
4. Indian mobile OTP.

Use OAuth 2.0/OpenID Connect as supported by each provider.

Implement:
- Provider initiation.
- State/nonce validation.
- PKCE where appropriate.
- Callback validation.
- Provider cancellation.
- Provider outage.
- Missing email.
- Apple Private Relay.
- Apple first-login name/email handling.
- LinkedIn approved scopes.
- Existing/new-user routing.
- Restricted-account handling.

Use server-managed secure sessions:
- HttpOnly cookies.
- Appropriate SameSite policy.
- Secure cookies in deployed HTTPS environments.
- Session rotation.
- Expiry.
- Revocation.
- CSRF protection appropriate to the deployment.
- Explicit account-linking after reauthentication.

Do not merge accounts solely by matching email addresses.

Do not expose client secrets to the frontend or store access tokens in localStorage.

Require verified +91 mobile ownership before dating access, regardless of initial provider.

OTP backend requirements:
- Cryptographically secure codes.
- Short configurable expiry.
- Protected storage.
- Single use.
- Attempt limits.
- Resend cooldown.
- Rate limits.
- No OTP logging.
- SMS-provider adapter.
- Local-only test delivery mechanism.

The local OTP delivery mechanism must be impossible to enable accidentally in production.

10. VERIFICATION AND CAMERA-ONLY PHOTOS

Implement:
- Adult age verification.
- DigiLocker integration adapter.
- Alternative identity-verification route.
- Consent.
- Pending/rejected/approved states.
- Retry and human review.
- Separate phone, age, identity, and photo badges.

DigiLocker and UIDAI authentication are separate integrations. Do not invent approval or eligibility.

Do not collect government-service credentials or OTPs inside the app.

Keep legal identity private. Aadhaar is not proof of citizenship.

Profile photographs must originate from the current camera-capture flow.

Implement:
- Camera permissions.
- Capture/review/retake.
- Short-lived server-issued capture sessions.
- Authenticated submission.
- Upload validation.
- Replay-resistant session handling.
- Metadata removal.
- Image processing.
- Moderation states.
- Photo replacement.
- Reverification.
- Capture freshness.
- Secure object storage.

Do not offer gallery upload or social-photo import for profile images.

Camera capture alone does not prove liveness. Use a provider adapter for liveness and face matching, with explicit consent and retention controls.

Without an approved provider:
- Support a clearly labelled local verification simulator.
- Prevent simulated verification from being treated as production verification.
- Keep the production verification requirement visibly unresolved.

11. PROFILES, DISCOVERY, AND MATCHING

Profiles:
- Display name and verified age.
- Gender/pronouns.
- Dating preferences.
- City and languages.
- Relationship intentions.
- Bio and prompts.
- Interests.
- Height.
- Optional education/work.
- Optional lifestyle and future plans.
- Communication preferences.
- Dating boundaries.
- Field visibility.
- Voice/video introduction when supported.
- Public preview.

Discovery:
- Curated profiles.
- Detailed browsing.
- Age/city/distance/preferences.
- Dealbreakers.
- Verification filters.
- Intent filters.
- Shared-interest explanations.
- Manual city selection.
- Approximate distance.
- Long-distance preferences.
- Pause and incognito.
- Recommendation feedback.

Connections:
- Like/pass.
- Like profile content.
- Personalised introduction.
- Incoming and sent interests.
- Invitation acceptance/decline.
- Mutual match.
- Match list.
- Undo where permitted.
- Unmatch.
- Block.

Enforce eligibility and permissions on the backend.

Use database uniqueness constraints and transactions to prevent duplicate likes, matches, or conversations during concurrent requests.

12. MESSAGING AND CALLS

Messaging:
- Match inbox.
- Persistent history.
- Pagination.
- Text/emoji.
- WebSocket delivery.
- Reconnection.
- Message IDs.
- Idempotent send.
- Explicit delivery-state semantics.
- Unread counts.
- Optional read receipts.
- Report/block/unmatch.
- Message safety warnings.
- Reporting after unmatching.

A message should be acknowledged as accepted only after durable persistence.

Handle:
- Socket disconnect.
- Duplicate events.
- Out-of-order events.
- Expired sessions.
- Offline retry.
- Restricted accounts.

Calls:
- Mutual permission.
- Invitation and acceptance.
- Audio-first entry.
- Camera preview.
- Mute/camera/end.
- Call-request limits.
- Immediate safety controls.
- Reconnect.
- Post-call feedback.

Use WebRTC with authenticated signalling and configured STUN/TURN where appropriate.

Do not consider calling complete after building only the call screen or signalling endpoints. Verify media between two independent browser sessions.

If TURN or external infrastructure is missing, distinguish local working calls from production connectivity limitations.

Implement optional captions, blur, or content detection only when their real capability exists.

Do not claim external recording can be prevented.

13. SAFETY, PRIVACY, AND MODERATION

Implement:
- Report profiles, media, messages, calls, and offline incidents.
- Immediate blocking.
- Report acknowledgement/status.
- Human-review queues.
- Enforcement actions.
- Appeals.
- Reporter confidentiality.
- Staff access controls.
- Admin MFA support.
- Audit history.
- Data-access requests.
- Correction requests.
- Consent withdrawal.
- Deletion orchestration.
- Defined retention per data category.
- Active-session management.
- Notification privacy.
- Profile pause.
- Quiet hours.

Use real backend RBAC and authorisation checks. Hiding admin controls in the frontend is insufficient.

Never place raw identity documents, OTPs, or biometric information in logs.

Define and test how deletion affects messages, reports, subscriptions, backups, and legally retained records.

14. DATE PLANS, COMMUNITIES, AND PREMIUM

Date plans:
- Ideas.
- Public venue.
- Date/time.
- Budget.
- Invite/accept/decline.
- Reschedule/cancel.
- Trusted-contact preview and explicit sharing.
- Check-ins.
- Post-date feedback.

Communities:
- Interest groups.
- Local events.
- Host verification.
- Registration/cancellation.
- Friend pairing.
- Group chat.
- Speed dating.
- Group activities.
- Leave/report/block.

Premium:
- Original subscription tiers.
- INR pricing.
- UPI/cards through a provider.
- Checkout.
- Signed webhook validation.
- Idempotent payment processing.
- Server-side entitlement updates.
- Restore/reconcile.
- Cancellation.
- Refund-request route.

Never grant paid entitlements based only on a browser success redirect.

Keep essential safety and privacy features free.

15. DEVELOPMENT PHASES

PHASE 0 — REPOSITORY AND DELIVERY FOUNDATION
Deliver:
- Repository assessment.
- Architecture decisions.
- Requirements traceability.
- Service ownership.
- Route map.
- Design tokens.
- API/event conventions.
- Environment templates.
- Docker Compose infrastructure.
- Health checks.
- CI foundation.

Gate:
A fresh checkout starts infrastructure, services, and frontend with documented commands.

PHASE 1 — AUTHENTICATION AND ACCOUNT JOURNEY
Deliver:
- Login/Register.
- Google/Apple/LinkedIn adapters.
- Mobile OTP.
- Sessions.
- Account linking.
- Consent.
- Onboarding state.
- Account settings foundation.

Gate:
A user signs in through a configured provider or explicit local test mechanism, refreshes successfully, resumes onboarding, and logs out. Invalid sessions are rejected.

PHASE 2 — VERIFICATION, PHOTOS, AND PROFILES
Deliver:
- Verification adapters.
- Camera capture.
- Object storage.
- Profile CRUD.
- Visibility.
- Preferences.
- Review queues.

Gate:
Captured photos and profile changes persist through reloads and are reflected in authenticated previews. Unapproved users cannot access dating functionality.

PHASE 3 — DISCOVERY AND CONNECTIONS
Deliver:
- Real database-backed discovery.
- Filters.
- Likes/passes.
- Introductions.
- Invitations.
- Matching.
- Blocking.

Gate:
Two independent accounts can discover, express interest, match exactly once, and see consistent state. Blocked profiles are excluded.

PHASE 4 — MESSAGING AND NOTIFICATIONS
Deliver:
- Persistent conversations.
- WebSocket messaging.
- Reconnection.
- Unread state.
- Notification adapters.
- Messaging safety controls.

Gate:
Two independent browser sessions exchange messages; history survives reconnect/restart; retries do not duplicate messages; unauthorised users cannot access conversations.

PHASE 5 — CALLS, DATE PLANS, AND SAFETY
Deliver:
- Working WebRTC flow.
- Date plans.
- Sharing/check-in adapters.
- Reports.
- Moderation.
- Appeals.
- Privacy/deletion workflows.

Gate:
Call media works in the supported test environment. Blocking revokes communication access. Reports persist and appear in authorised moderation views.

PHASE 6 — PAYMENTS AND ADVANCED EXPERIENCES
Deliver:
- Sandbox payment integration.
- Entitlements.
- Curated recommendations.
- Communities/events.
- Group experiences.
- Additional localisation.
- Wellbeing controls.

Gate:
Provider webhook confirmation updates entitlements correctly; duplicate/reordered webhooks are handled; advanced journeys use real persisted state.

PHASE 7 — HARDENING AND RELEASE PREPARATION
Deliver:
- Responsive/accessibility verification.
- Security and authorisation checks.
- Performance checks.
- Backup/restore validation.
- Observability.
- Operational runbooks.
- External integration readiness matrix.
- Deployment instructions.

Gate:
Core journeys pass end-to-end against the real services. Remaining external approvals and production limitations are explicitly identified.

16. TESTING STRATEGY

Use proportionate tests that verify meaningful behaviour:
- Unit tests for business rules.
- Service tests against PostgreSQL/Redis.
- API contract checks.
- Integration tests for service boundaries.
- Playwright end-to-end journeys.
- WebSocket integration checks.
- Two-session communication tests.
- Payment webhook tests.
- Authorisation and ownership tests.

Prioritise:
- Concurrent mutual matching.
- Duplicate message retry.
- Blocking during an active conversation.
- Session revocation.
- Provider callback failure.
- Account-link conflict.
- OTP expiry/rate limits.
- Verification rejection.
- Payment webhook replay.
- Account deletion across services.

Use deterministic test fixtures. Do not use mocks for final core end-to-end acceptance checks.

17. OPERATIONS AND SECURITY

Implement:
- Input validation at service boundaries.
- Parameterised database access.
- Ownership/permission checks.
- TLS-ready configuration.
- Restrictive CORS.
- Upload limits and file validation.
- Secure headers.
- Secret configuration.
- Structured redacted logs.
- Correlation IDs.
- Health/readiness checks.
- Timeouts and bounded retries.
- Metrics/tracing where practical.
- Graceful shutdown.
- Database migrations.
- Backup and recovery instructions.

Use local infrastructure suitable for the repository. Do not introduce Kubernetes unless explicitly required.

18. COMPLETION DEFINITION

A feature is complete only when:
- Its frontend is implemented.
- Its backend contract is implemented.
- Data persists correctly.
- Permissions are enforced.
- Relevant service events are handled.
- Loading/error/retry states work.
- Relevant checks pass.
- External dependencies are documented.
- No obsolete mock remains in the normal integrated path.

Maintain a phase-status document containing:
- Complete.
- In progress.
- Blocked.
- External dependency.
- Verified evidence.

19. FINAL DELIVERY

Provide:
- Implemented frontend and backend.
- Local startup commands.
- Environment-variable templates without secrets.
- Database migration/seed instructions.
- Service ownership and architecture documentation.
- API/event contracts.
- OAuth/provider setup instructions.
- Test results.
- Working journey summary.
- External integration readiness matrix.
- Remaining limitations.
- Deployment and operational guidance.

Begin by inspecting the repository. Then implement Phase 0 and continue through the integrated phases.

Do not stop after presenting an architecture or plan. Keep frontend and backend working together throughout development.
```