import Link from "next/link";
export default function Privacy() {
  return (
    <main className="status-page">
      <Link className="brand" href="/">
        raahi<span>✳</span>
      </Link>
      <h1>
        Your data.
        <br />
        <em>Your space.</em>
      </h1>
      <p>
        Development notice, version 2026-10-v1. The local preview stores your
        supplied mobile number, display name, consent record and account
        preferences in the local PostgreSQL volume. A configured sign-in
        provider may supply its subject identifier, optional email and name.
        Email is never used to merge accounts.
      </p>
      <p>
        Session cookies are HttpOnly and expire after 7 days. OTP challenges
        expire after 5 minutes; only a keyed hash of the code is stored. Expired
        authentication records are cleaned periodically. Local codes shown on
        screen are test delivery, not actual SMS verification.
      </p>
      <p>
        No real identity documents or biometric information should be submitted
        to this preview. You can export your data, withdraw consent and request
        deletion in Privacy controls. Messages you sent are replaced with a
        deletion marker; reports and staff audit records are retained for 365
        days under the local development policy. Backup copies require separate
        expiry and deletion-ledger replay on restore. Use test data only. The
        final retention policy and production privacy notice must be completed
        before launch.
      </p>
      <Link href="/privacy-control" className="text-link">
        Return to your account
      </Link>
    </main>
  );
}
