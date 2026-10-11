# Development retention policy — 2026-10-v1

This is the implemented local-development policy, not a claim that a production legal assessment is complete. Use test data. Production purposes, retention periods, user notices and lawful exceptions require review before launch.

| Category | Active account | Deletion behavior | Current enforcement |
|---|---|---|---|
| OTP challenges | Five-minute validity; cleanup after one day | Delete account-linked and matching-phone records | Identity cleanup worker / deletion transaction |
| Sessions | Seven days; maximum 30 active sessions | Revoke immediately, erase records | Identity authority; sockets recheck within two seconds |
| Phone, provider identity, consent, DOB | While account exists | Erased after other owners acknowledge deletion | Identity job, migrations and deletion tests |
| Profile fields, photo metadata, captures | While account exists | Profile erased; full account S3 prefix erased; capture sessions deleted | Go profile deletion API |
| Replaced photo objects | Pending cleanup | Also included in prefix erasure | Durable cleanup retries; operator-visible failures |
| Interests, introductions, blocks, matches | While account exists | Account relationship and match records erased; unpublished related outbox removed | Go connection deletion API |
| Private/group messages sent | While participants retain history | Sent text replaced by deletion marker; group display name removed | Communication deletion API; safety evidence is a separate retained copy |
| Received messages and shared conversation IDs | Retained for the other participant | Other participant's text is not erased; deleted account has no access | Authoritative relationship/eligibility checks |
| Call media | Not recorded or stored by the service | No service media recording to delete | Peer-to-peer WebRTC; cannot prevent external recording |
| Call metadata, date plans | While account exists | Calls end, own feedback/check-ins erased, proposed venue/address removed and plan cancelled | Communication deletion API; pseudonymous shared IDs remain |
| Communities/events/buddies | While account exists | Membership/registration/buddy records erased; hosted groups close and event details are removed | Operations deletion API |
| Safety reports and staff audit | 365 days from creation | Kept for confidential review, including preserved evidence | Hourly expiration worker; no claim of a legal hold mechanism |
| Subscription/payment/refund records | Retained for reconciliation | Renewal cancelled before deletion completes; pseudonymous financial references retained | Provider cancellation may block deletion; **financial expiration/chargeback policy is a release dependency** |
| Deletion ledger/tombstones | Indefinite in local development | Kept to prevent restoring erased data from backups | Database-backed receipt/progress records; separately back up ledger |
| Backups | Operator-controlled | Data ages out when backups expire; replay tombstones on restore | No automatic backup expiry in local Compose; production encrypted rotation required |
| HTTP logs | Container runtime retention | No request bodies, secrets, documents or personal profile fields | Redacted structured metadata only; configure deployment log rotation |

A deletion receipt shows `complete` only after each owning service acknowledges its implemented erasure policy. It does not mean retained reports, other participants' content or backup copies were destroyed. The user sees these exceptions before confirming deletion. Jobs that exceed ten retries show `needs_attention` and stay incomplete.

Recommendation feedback is private profile-service data retained until the owner restores/resets it or either referenced profile is deleted. It is included in the owner's personal-data export. Reasons are bounded categories, not free-text sensitive notes; no notification is sent to the target.

Opt-in unsent message retries stay in the current browser for at most 72 hours of application access (expired entries are purged when reopened; a closed browser cannot run cleanup). Disabling persistence clears saved retries. Successful logout clears this origin's saved messages and keys; if browser storage is inaccessible, server logout still succeeds and login displays a site-data cleanup notice. Account deletion attempts browser cleanup as part of its flow. Browser encryption does not protect against malicious same-origin scripts, extensions or someone controlling the signed-in browser. Recovery receipts retain opaque request/job IDs for replay protection; confirmed recovery reasons expire after 365 days; unconfirmed actions are retained for operator investigation until resolved.

Chat image uploads: unattached images become inaccessible after 24 hours and are removed by a minute worker. Attached images remain with the conversation until sender account deletion, which removes the bytes and changes sent messages to deletion markers. A separately submitted report preserves its normalized image evidence under the existing 365-day report policy, including after unmatch/deletion. Sender data exports include sent image bytes as JPEG base64. Browser saved retries retain the image ID and caption, not another image copy; an upload that expired before sending cannot be restored from its retry ID.
