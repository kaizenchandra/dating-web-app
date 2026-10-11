import Link from "next/link";
export default function Terms() {
  return (
    <main className="status-page">
      <Link className="brand" href="/">
        raahi<span>✳</span>
      </Link>
      <h1>
        Development
        <br />
        <em>terms.</em>
      </h1>
      <p>
        Version 2026-10-v1. This is a development preview for adults aged 18+
        residing in India. Dating journeys run against local services with
        explicitly simulated verification. Use test information in the local
        environment.
      </p>
      <p>
        Do not impersonate others, submit unlawful content, or attempt to bypass
        eligibility and consent controls. Verification, privacy and moderation
        workflows require further implementation before public launch.
      </p>
      <p>
        These preview terms are not the final consumer agreement. Public launch
        requires appropriate product, legal and operational review.
      </p>
      <Link href="/onboarding" className="text-link">
        Return to your account
      </Link>
    </main>
  );
}
