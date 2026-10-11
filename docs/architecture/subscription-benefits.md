# Subscription benefits and privacy

Operations owns the single tier policy (`services/commerce-operations/plans.ts`). A confirmed, unexpired paid period determines the current tier; cancelled renewal retains benefits until period end. No cached browser claim grants access. Connections synchronously requests the owner entitlement for metered actions and fails closed if unavailable.

| Plan | Super likes/day | Direct introductions/day | Discovery ordering |
|---|---:|---:|---|
| Free | 0 | 3 | Standard |
| Gold | 5 | 10 | Shared interests |
| Diamond | 15 | 25 | Interests or matching intentions |
| Platinum | 30 | 50 | Interests, intentions or same city |

A direct introduction is the existing personal interest message, now subject to an allowance. It appears in the recipient's Connections requests. It does not bypass consent, blocks, verification or match-only chat. Accepting the request forms a mutual match through the existing transaction. Text/images within a mutual match remain unlimited by subscription. An ordinary like without text uses neither allowance. A super like with text consumes one of each allowance and displays a distinct badge in incoming/sent interests.

Limits reset at midnight Asia/Kolkata; unused daily credits do not accumulate. Changing tier changes the limit immediately but retains today's usage. Connections owns `connection_usage` (migration 002). Sender advisory locks serialize simultaneous actions to different targets; pair locks serialize matching/safety. The usage insertion and relationship update commit together, so denied/failed actions do not consume credits. The ledger uniquely records each sender/recipient/feature: retrying an existing action does not consume again. An introduction already published to a person cannot be edited into repeated unsolicited messages. Usage records remain for the account lifetime for deduplication and are deleted when either involved account is deleted. There is no user-facing credit reset or refund-on-unmatch operation.

`GET /connections/allowance` returns authoritative limits, used amounts and the next reset time. `/premium` and `/discover` show this state with retry controls. Backend 429 DAILY_ALLOWANCE_REACHED explains the limit. The super-like checkbox is an explicit opt-in in discovery's introduction form. Blocking and ending a match clear super-like presentation; a new unpaid interest cannot inherit an old badge.

Age and location hiding are deliberately free, honoring the product requirement that essential privacy remain free. In `/profile` → Choose what others see, uncheck age or city/distance, then save. The profile service's common projection removes hidden age from candidate/connection cards and public preview (null), city becomes empty and approximate distance is null. The owner retains their actual data. Eligibility, mutual age preferences and geographic filters still use private values; hiding display fields is not a promise that filtering cannot reveal broad compatibility. Changing or losing a subscription never re-exposes a hidden field. Exact GPS location is not published.

## Verification

`benefits.spec.ts` uses real HTTP APIs, databases and independent browser sessions. Explicit, local-only subscription fixtures exercise Gold/Diamond/Platinum and expiry; they are not provider payment tests. It checks free denial, duplicate concurrent sends, atomic rollback when a super-like limit is reached, recipient acceptance, usage, plan changes, profile controls, persisted private preview and private matched cards. Unit tests cover tier policy, IST midnight rollover and location projection. Existing connection tests cover mutual-match concurrency and immediate blocking. Payment-provider acceptance remains separately blocked as documented in the provider runbook.
