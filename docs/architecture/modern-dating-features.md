# Connection style and better introductions

This increment adds working profile, discovery and connection journeys. It does not add unverified AI, biometric claims or provider-dependent features.

## Product rationale

Recent official research/releases emphasise clearer intentions, personal expression and lower-pressure connection: [Bumble's 2026 product announcement](https://ir.bumble.com/news/news-details/2026/Bumble-Announces-Two-New-Features-For-Confidence-and-Clarity-in-Dating-2026-36eaJ_omGR/default.aspx), [Tinder's 2026 trend report](https://www.tinderpressroom.com/2025-12-03-TINDERS-YEAR-IN-SWIPE-TM-2025). These are directional product inputs, not representative statistics for all Indian adults or evidence that our features improve match success. Raahi's copy and interactions are independent.

## Implemented feature list

| Feature | Journey | Access |
|---|---|---|
| Dating pace | Profile → slow and steady / chat then meet / open to meeting soon → preview and discovery card | All accounts |
| First-date preferences | Select up to three: chai/coffee, food walk, arts/culture, public outdoor walk, games/quizzes, video first | All accounts |
| Opening question | Save a question of up to 180 characters; show it in public preview and profile details | All accounts |
| Style filters | Discovery → dating pace and first-date preference → eligible persisted profiles matching visible answers | All accounts |
| Editable conversation starters | Read a profile → answer their question or ask about a shared visible interest → edit → explicitly send | Existing direct-introduction allowance |
| Recipient introduction control | Profile → accept eligible pre-match introductions or text only after a mutual match | Free privacy control |
| Field-level visibility | Hide pace, date preferences or opening question; remove from previews/cards and filter explanations | Free privacy control |

Paid daily allowances and ranking modes remain defined centrally in operations. These enhancements do not change plan prices, invent paid benefits, bypass quota, or meter matched chat. A preference is not consent to meet or to receive a call. The generic starter and shared-interest question are deterministic drafts, not AI-generated messages. Nothing sends automatically.

## Ownership and acceptance

Profile/discovery owns four new JSON profile fields: `datingPace`, `dateVibes`, `openingQuestion`, `introductionPolicy`. Existing owner storage, export and deletion handle them; no new database table or cross-owner SQL is needed. Older profiles default to no pace, no preferences, no question and the previous eligible-introductions behaviour (`everyone`). Strict server validation enforces supported values, a maximum of three distinct date preferences and the question bound. The OpenAPI version remains v1 with additive optional fields; generated clients are rebuilt.

A single visibility projection serves preview, discovery and cross-service cards. Hidden style answers cannot match the public style filters. Existing age/gender preferences, eligibility, blocks, pauses, incognito and dealbreakers still apply. Pagination remains the existing bounded candidate scan; a page may be empty with a next cursor. First-date ideas are preferences, not venue bookings or planned dates.

Connections checks the profile owner's introduction policy synchronously under the relationship transaction before recording an unmatched text introduction or consuming usage. It rejects `matches_only`, invalid policy and unavailable authority. Plain interests/super likes without text remain available subject to plan limits and safety. Existing mutual-match rules still guard persistent chat. Changing this preference prevents subsequent pre-match text; it does not erase an already delivered introduction. Blocking is the immediate way to stop a particular person.

Verification: `connection-style.spec.ts` covers two independent accounts, profile save/reload/preview, direct API validation, private-field projection, filtered discovery, refusal without consuming credit, explicit draft edit/send, recipient receipt and acceptance. Existing preferences and benefit suites verify interactions with privacy, quotas and subscription expiry. Unit tests cover validation, legacy defaults and visibility-aware filtering.

## Still outside this increment

Voice/video profile introductions, live speed-dating rotation, broader localisation and real external notification delivery remain in the phase-status backlog. Provider identity/liveness, SMS and Razorpay acceptance still need their documented credentials and approvals. No completion claim is made for those capabilities.
