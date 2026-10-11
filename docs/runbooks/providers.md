# External integration readiness

| Capability | Implemented and verified locally | External dependency / unverified work |
|---|---|---|
| Google / Apple / LinkedIn | OIDC adapters, initiation/callback validation, PKCE/state/nonce, explicit linking; failure paths tested | Client credentials, registered HTTPS callbacks, approved scopes and provider-account success/cancellation/link-conflict tests |
| Indian mobile OTP | Secure persisted single-use OTP, browser binding, attempts/cooldown/rate limits; local delivery tested | Approved SMS vendor adapter, sender/template approvals and delivery evidence |
| Age / identity | Consent, pending/reject/retry/approve state machine; conspicuous local simulator | DigiLocker requester approval or an alternative provider; real adapter integration and human operating process |
| Photo / liveness | Fresh camera session, authenticated validated upload, metadata stripping, private S3, review states | Real liveness/face match and provider evidence; camera alone is not liveness |
| Media storage | Private SeaweedFS S3, replacement cleanup; isolated backup restore and private JPEG retrieval verified | Managed encrypted storage, least-privilege credentials, lifecycle and broader process-kill/partition validation |
| Payments | Gold/Diamond/Platinum subscriptions and 30-day order passes, raw signature validation, deduplication, reconciliation, cancellation, refund request, server entitlement | Test keys, three monthly INR plans and webhook secret; real sandbox charge/replay/reordering/refund/chargeback tests; merchant approval |
| Calls | Authenticated WebRTC signalling, two independent browser processes with real inbound audio/video bytes, relay-only coturn transport and 600-second credentials, media controls | Public TURN deployment, cross-network/device tests and deployed reconnect validation |
| Notifications | Persisted private in-app inbox/notification state | Push/SMS/email credentials and delivery adapter; no external delivery claimed |
| Trusted contacts | Explicit preview and browser share sheet / clipboard | Delivery confirmation or dedicated trusted-contact integration, if desired; no emergency monitoring claimed |
| Staff security | Backend RBAC, encrypted TOTP enrollment, replay/rate controls, audit records | Deployed MFA validation, recovery procedure, trained human operations |

No deployment, merchant/provider approval or production verification is asserted. DigiLocker is not UIDAI authentication. Do not request government-service credentials or OTPs inside the app; do not treat Aadhaar as citizenship evidence.

## Phase 1 adapter setup

The OIDC adapters use openid-client, state, nonce, PKCE, ID-token signature checks, and a browser-bound, one-time Redis flow with a 10-minute expiry. Provider subjects, not email addresses, identify accounts. Missing email and Apple relay email remain optional private attributes. Apple's optional first-login name is preserved after a successful validated exchange. No provider tokens are placed in localStorage.

Configure `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET`, and `APPLE_CLIENT_ID` / `APPLE_CLIENT_SECRET` in the ignored environment file. Apple CLIENT_SECRET is the developer-generated signed client-secret JWT and needs rotation before expiry; Apple callbacks require deployed HTTPS. Register exactly `WEB_ORIGIN/api/v1/auth/oauth/{google|apple|linkedin}/callback`. Google and LinkedIn use query callbacks; Apple uses form_post and a Secure SameSite=None flow cookie. Keep the ordinary session cookie SameSite=Lax. Apple linking checks the initiating session server-side because form_post omits its Lax cookie. The Secure flow cookie binds the callback to the browser. This interaction still requires independent provider testing and is not verified by local OTP tests.

LinkedIn discovery uses its documented /oauth/.well-known/openid-configuration location with an explicit expected issuer check. Request only approved openid/profile/email scopes. Google requests openid/profile/email. Apple requests openid/name/email. Verify cancellation, replay, expired client secret, missing email, relay email, first-login user information and link conflicts against provider test accounts before release.

SMS uses a server-to-server HTTPS adapter contract: bearer token, POST JSON `{to, template: "raahi_sign_in", code}`. A configured adapter must translate this to the approved SMS provider and return success only for accepted delivery. No vendor integration has been verified. Local mode returns a conspicuous `localCode` only when APP_ENV=local, LOCAL_TEST_DELIVERY=enabled and WEB_ORIGIN is loopback. Production/staging rejects that flag and requires HTTPS.

Official implementation references: [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect), [LinkedIn OIDC](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2), [Apple authorization](https://developer.apple.com/documentation/signinwithapplerestapi/request-an-authorization-to-the-sign-in-with-apple-server), [openid-client code grant](https://github.com/panva/openid-client/blob/main/docs/functions/authorizationCodeGrant.md).

## Phase 2 implementation evidence and limits

Identity/age local simulation persists pending, approved and rejected states and supports retry. Every approval retains source=local. DigiLocker and alternative providers return a clear unavailable response; no provider approval has been invented. Real liveness and face matching are not implemented. Browser camera capture requests a fresh two-minute capability, submits authenticated image bytes, rejects reuse/expiry, validates image formats and dimensions, and strips metadata by decoding/re-encoding. The local S3 bucket is private and images are served through the authenticated owner API. Capture provenance cannot be cryptographically proven by a browser camera UI alone; production needs an approved liveness SDK and server verification.

The Go service owns profile fields, preferences, visibility, photo state and cleanup tasks. Optional-field visibility is applied centrally server-side to previews and discovery. Review decisions are persisted; local staff roles are enforced by the operations API. Bootstrap an explicit local reviewer with `node infra/scripts/grant-local-reviewer.mjs <account UUID>` and open `/admin/reviews`. Account UUID comes from the authenticated `/api/v1/account` response. Staff production access requires enrolled and verified TOTP MFA. The queue includes a staff-only captured-photo inspection route. Versioned review decisions reconcile through durable owner receipts and bounded retries. Real document-provider evidence remains incomplete.

## Payment configuration and acceptance gate

Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` in the ignored `.env.local` or deployment secret manager. Local mode accepts only `rzp_test_` keys. Do not put secrets in NEXT_PUBLIC variables.

| Tier | Default INR price | Monthly provider plan variable | Discovery ordering |
|---|---:|---|---|
| Gold | 499 | RAZORPAY_GOLD_PLAN_ID | Shared interests |
| Diamond | 999 | RAZORPAY_DIAMOND_PLAN_ID | Interests or matching intention |
| Platinum | 1499 | RAZORPAY_PLATINUM_PLAN_ID | Interests, intention or same city |

Prices are configurable through `PREMIUM_GOLD_INR`, `PREMIUM_DIAMOND_INR`, `PREMIUM_PLATINUM_INR` (whole rupees, application limit 1–15000). Configure each provider plan with period monthly, interval 1, INR, and amount equal to displayed price ×100 paise. The server validates this before creating recurring checkout. Legacy RAZORPAY_PLAN_ID remains the Gold fallback. Existing purchases retain their stored tier, price and provider plan. No upgrade/proration flow is claimed; changing tier requires the previous paid period to end. Rankings operate within each eligible page; all normal filters and safety controls remain free.

At `/premium`, choose monthly renewal (12 billing cycles, UPI AutoPay/cards where enabled) or a one-time 30-day pass (Razorpay Orders/Standard Checkout, no renewal mandate). Passes need keys but no provider plan IDs. Enable automatic payment capture for orders. Authorised-only payments do not activate access. The first server-confirmed capture starts a fixed 30-day period; retries do not extend it. Partial/full pass refunds halt access after canonical reconciliation.

Register a publicly reachable HTTPS `/api/v1/webhooks/razorpay` endpoint for subscription lifecycle/charged events, order.paid, payment.captured and refund.processed. Raw bytes and signature/event ID headers are forwarded without browser authentication. Signatures are checked before processing. Failed application is retried; duplicate completed events return success. Each delivery fetches canonical provider state under a row lock, protecting against reordered deliveries. Periodic reconciliation runs independently. Browser callback signatures bind the payment to the stored order/subscription reference; neither a redirect nor a browser-supplied tier/price grants access. Checkout creation is serialized per account; retrying the same pending purchase resumes it. Ambiguous creation is retained as needs_reconciliation rather than creating duplicate billing.

For an ambiguous purchase, operators must inspect Razorpay using the stored checkout UUID (`notes.raahi_checkout`, or order receipt), verify the account, tier, amount and mode, then repair the provider ID in the owning operations database and reconcile. Never mark a row paid manually. If creation is proven absent, an operator may retire the unconfirmed row after recording the investigation. Abandoned passes do not automatically release the account because their provider order might still be paid; no automatic tier switching across outstanding orders is implemented.

Cancellation requests end recurring renewal at cycle end; paid access lasts through its confirmed period. Refund requests are stored for human review and do not issue money. Recurring refund/chargeback entitlement policy and provider dispute acceptance remain release blockers.

### Apple Pay

Apple Pay is offered through Razorpay Standard Checkout for the **one-time pass**, only when Razorpay has enabled it for the merchant and the customer has an eligible device/wallet. There is no fake Apple Pay button or unsupported recurring Apple Pay mandate. Follow Razorpay's current merchant eligibility/international-payment requirements and enablement process. Apple Pay is **not supported in Razorpay test mode**.

Deploy HTTPS and obtain the official domain association file from Razorpay. Place the unchanged file at `apps/web/public/.well-known/apple-developer-merchantid-domain-association` before building, or serve it through the edge at the same public path. It must return HTTP 200 directly, with text/plain, without authentication or redirects; verify the domain with Razorpay. Do not create an invented file. Configure this in the deployment edge if static-file MIME differs. The app CSP permits the Razorpay SDK and checkout frames, and Permissions-Policy permits payment in those frames. Validate the actual checkout CSP on your enabled merchant integration.

Rebuild with `npm run local:up` after changing configuration; operations startup automatically applies migration 008. Test actual sandbox UPI/card charges, duplicate/reordered webhook deliveries, callback failure, ambiguous creation, cancellation and deleted-account billing before launch. Test Apple Pay separately with an approved live merchant and eligible Apple device, using an explicitly authorised transaction. No successful provider charge or Apple Pay payment has been verified in this workspace; local security and browser tests do not substitute for that gate.

References: [Standard Checkout](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/), [subscriptions](https://razorpay.com/docs/payments/subscriptions/integration-guide/), [Apple Pay prerequisites and domain verification](https://razorpay.com/docs/payments/payment-methods/apple-pay/), [webhook validation](https://razorpay.com/docs/webhooks/validate-test/).

Subscription feature enforcement now includes daily super-like/direct-introduction limits; see [benefits policy](../architecture/subscription-benefits.md). The connections service requires its configured outbound operations service token. `npm run local:up` applies connections migration 002 and rebuilds the four affected services. These benefits depend on the existing confirmed paid-period entitlement; enabling UI controls never confirms a payment.
