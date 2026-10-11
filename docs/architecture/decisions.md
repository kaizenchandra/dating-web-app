# Raahi architecture decisions

## Repository assessment — 11 October 2026

Clean tracked Next.js 16.4 / React 19.3 starter, App Router, TypeScript, Tailwind 4 and ESLint. No existing product, database, backend, tests or integrations. No unrelated tracked user edits were present. The installed Next.js route-handler and server/client guides were read before changes. Frontend moved to apps/web; root npm lockfile and dependencies retained. No Kubernetes.

## Ownership

| Service             | Runtime   | Exclusive database / business ownership                                                          |
| ------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| gateway             | Node / TS | No business database. Browser boundary, validation, sessions transport, rate limits, correlation |
| identity            | Node / TS | identity: accounts, authentication, sessions, consent, eligibility, verification orchestration   |
| profile-discovery   | Go        | profile_discovery: profiles, media metadata, preferences, discovery                              |
| connections         | Go        | connections: interests, invitations, matches, blocks                                             |
| communication       | Node / TS | communication: conversations, messages, call signalling, date plans, notifications               |
| commerce-operations | Node / TS | commerce_operations: payments, entitlements, reports, review, appeals, administration            |

Each database has a distinct login. No service may query another service's database. packages/shared-config contains infrastructure primitives only. All implemented member journeys use these owning services. No shared business models. The Next.js same-origin route forwards to configured GATEWAY_URL; the browser client uses NEXT_PUBLIC_GATEWAY_URL or /api/v1. Internal service tokens never enter browser code. Only web and gateway ports bind to localhost.

## Synchronous safety and event consistency

Identity authoritatively rejects restricted/ineligible accounts. Connections authoritatively checks relationship access immediately before messages and calls. Unavailable authority means deny, never stale allow. Match mutations write an outbox row in the same PostgreSQL transaction. Consumers persist processed event IDs with effects, use bounded exponential retry, and expose terminal failures for operator replay. Delivery is at least once. Connections dispatches durable match events over authenticated HTTP; communication consumes them transactionally and idempotently. Redis carries ephemeral delivery hints after persistence.

## Environments

APP_ENV=local enables explicitly labelled local mechanisms only. NODE_ENV=production is also used to run a Next production build locally and must not by itself select an integration mode. Production deployment will require explicit environment validation prohibiting simulators. Local secrets are random, generated into ignored .env.local; no credentials are committed. Separate provider credentials and approvals remain external requirements.

## Working design identity

Raahi is a working name, pending trademark/domain review. Midnight #121315; surface #1d1e22; warm text #f4efe8; muted #b9b6b3; coral #ff876f; lavender #c9bbf1; lime #dce6ab. Georgia headings and system sans body avoid remote font dependencies. Focus rings, 48px primary actions, reduced motion and flexible layouts are foundations; full WCAG conformance is not asserted.

## Local object storage choice
Both official MinIO image registry pulls failed in this environment on 11 October 2026. Local Compose uses SeaweedFS 4.00's S3 interface with generated credentials and no host-exposed ports. The profile service uses a standard S3 client and owns its private bucket. Production needs a managed private S3-compatible service, TLS, least-privilege bucket credentials, lifecycle/backup policies and encryption configuration. Local volume storage is not represented as production encrypted storage. Replaced objects enter a durable cleanup table; failed deletions are retried up to ten times and remain visible for repair. Durable pre-upload intents and bounded orphan reconciliation cover uncertain upload commits; broader crash/partition validation remains.

## Relationship authority
Connections owns a canonical pair row and locks it for relationship transitions. A partial unique index permits only one active match per pair; ended matches remain available for eventual report evidence. Discovery consults identity and connection APIs synchronously and excludes ineligible/blocked accounts. Match creation writes a transactional outbox event. The messaging slice implements this dispatcher and consumer. Repeated like/pass/block requests set state; undo is limited to unmatched passes. Local discovery implements age, city, intention, reciprocal age/gender preferences and long-distance preferences; city-centroid distance is computed from attributed GeoNames data without collecting precise location. Unknown/ambiguous cities return no estimate; radius filtering excludes them. Reciprocal smoking, drinking and children preferences are enforced; further optional dimensions remain.

## Communities and commerce ownership

Communities, reviewed hosts, events, memberships, registration capacity and event-buddy consent live in commerce-operations because they share human host operations and event administration. Communication exclusively owns group messages and consults membership/eligibility/block authorities before access. Group membership does not create a dating match or grant private conversation permission. A blocked relationship locks access to a shared room until the member leaves; leaving remains available. Offline speed-introduction events are host-led venue events, not a simulated online video speed-dating engine.

Premium owns subscriptions and provider reconciliation. The Go discovery service requests a current entitlement before optional shared-interest sorting. Safety, blocking, privacy, messages and call consent are free. The browser cannot assign entitlement state.

## Privacy workflow

Identity records a deletion job in the transaction that restricts the account and revokes sessions. A retrying worker calls each owner's idempotent deletion API, records progress, then erases identity records last. Communication preserves deletion markers in shared history and retains no sent text outside separately retained safety evidence. Operations retains confidential reports/audit and financial records according to the development retention policy. Unknown subscription creation prevents a false completion acknowledgement until reconciled. Receipts contain no personal data. Backup restoration must replay deletion tombstones.

## Continuation: private preferences and recovery

- Profile-discovery owns private recommendation feedback and structured dealbreakers alongside profiles. Filtering is reciprocal; hidden answers can affect compatibility but only the central visible-profile projection crosses the candidate boundary. Feedback is an explicit per-candidate exclusion, not a learned attractiveness score or an inferred demographic preference.
- Photo storage uses a durable pre-upload cleanup intent, bounded orphan scanning and a live-reference check under the upload/deletion profile lock. Storage and PostgreSQL do not share a transaction; uncertain outcomes converge through reconciliation rather than immediate compensating deletion.
- Review-audit requests serve as a durable delivery outbox. The reviewed submission version and client decision ID travel to the owner, whose receipt and decision update are atomic. Old receipts acknowledge old work, while new requests for outdated versions are rejected. This preserves ownership without cross-service table access or exactly-once claims.


## Continued delivery: recovery, browser retries and internal credentials

Administrator recovery is an operations-owned audit workflow calling owner recovery APIs synchronously. Opaque request receipts are committed with each owner mutation, making transport retries safe without shared tables. A member cannot replay an administrative action; administrator role, recent reauthentication and deployed MFA are checked by the backend.

Unsent messages may be saved only after explicit per-browser consent. AES-GCM entries and a nonextractable same-origin key are stored in IndexedDB, bounded to 100 entries and 72-hour access-time expiry. Restored entries require manual review/retry; the canonical message UUID and server uniqueness guarantee deduplication. Server acknowledgement remains conditional on database persistence. Browser encryption is not isolation from compromised same-origin code.

Internal HTTP authentication uses one secret per receiving service, distributed only to configured callers. This reduces accidental cross-destination credential reuse, but is not caller-specific authorization or mTLS. The web proxy and trusted edge have separate credentials. Tests verify a service's own receiver key is rejected by four other owners and each destination key succeeds.

## Private chat images

Communication owns chat image bytes and message attachment metadata. For this bounded local implementation, re-encoded JPEGs are stored transactionally in its PostgreSQL database (maximum 1 MiB each, 100 MiB per sender), avoiding cross-owner photo storage and object/database orphan races. This is separate from camera-only profile photos, which remain in private S3. Chat permits gallery JPEG/PNG/WebP selection. Uploads are capped at 5 MiB and 16 megapixels, decoded and re-encoded to a maximum 1600px side with metadata removed. The decoder is an explicit Sharp dependency; see [Sharp output behavior](https://sharp.pixelplumbing.com/api-output/).

Image uploads are sender-keyed and payload-bound; image-to-message attachment is unique. The connection service retains the pair lock through the durable message write. Unattached uploads expire after 24 hours, with a minute cleanup sweep and read/send expiry checks. A sender can upload at most 20 stored images per hour. Scaling media volume requires an owner-controlled private object-store migration, not a public CDN link. There is no automated image content-classification claim. Confidential reports snapshot the normalized bytes into the operations owner's evidence store for authorised human review.
