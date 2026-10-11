"use client";
import Link from "next/link";
import { useState } from "react";
import { useAccount } from "../../components/account";
import { PhoneLogin } from "../../components/phone-login";
import { api } from "../../../../packages/generated-clients/client";
export default function Onboarding() {
  const { account, setAccount, error: loadError, retry } = useAccount();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function consent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      setAccount(
        await api("/account/consent", "post", {
          displayName: String(form.get("displayName")),
          adult: true,
          indiaResident: true,
          terms: true,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="account-page">
      <header>
        <Link href="/" className="brand">
          raahi<span>✳</span>
        </Link>
        <Link href="/settings" className="text-link">
          Account settings
        </Link>
      </header>
      <div className="onboarding-grid">
        <section>
          <p className="eyebrow">A THOUGHTFUL BEGINNING</p>
          <h1>
            A little trust.
            <br />
            <em>A little you.</em>
          </h1>
          <ol className="steps">
            <li className={account?.phone ? "done" : ""}>
              01 <span>Verify your mobile</span>
            </li>
            <li className={account?.consented ? "done" : ""}>
              02 <span>Your introduction & consent</span>
            </li>
            <li>
              03 <span>Age, identity & camera photo</span>
            </li>
            <li>
              04 <span>Your profile, your boundaries</span>
            </li>
          </ol>
        </section>
        <section className="auth-card">
          {!account ? (
            <>
              <p role={loadError ? "alert" : "status"}>
                {loadError || "Resuming your account…"}
              </p>
              {loadError && <button onClick={retry}>Retry</button>}
            </>
          ) : account.onboarding === "phone" ? (
            <>
              <h2>Your mobile, verified.</h2>
              <PhoneLogin local={account.environment === "local"} />
            </>
          ) : !account.consented ? (
            <>
              <h2>How should we say hello?</h2>
              <form onSubmit={consent} className="form-stack">
                <label htmlFor="displayName">Display name</label>
                <input
                  id="displayName"
                  name="displayName"
                  minLength={2}
                  maxLength={60}
                  required
                  autoComplete="given-name"
                  placeholder="The name you go by"
                />
                <label className="check">
                  <input type="checkbox" required /> I am at least 18 years old.
                </label>
                <label className="check">
                  <input type="checkbox" required /> I currently reside in
                  India.
                </label>
                <label className="check">
                  <input type="checkbox" required />{" "}
                  <span>
                    I accept the <Link href="/terms">development terms</Link>{" "}
                    and have read the{" "}
                    <Link href="/privacy">privacy notice</Link>.
                  </span>
                </label>
                <p className="muted">
                  This declaration does not verify your age. Dating access stays
                  locked until the required verification is approved.
                </p>
                {error && (
                  <p role="alert" className="form-error">
                    {error}
                  </p>
                )}
                <button disabled={busy}>
                  {busy ? "Saving…" : "Save & continue →"}
                </button>
              </form>
            </>
          ) : (
            <>
              <p className="eyebrow">INTRODUCTION SAVED</p>
              <h2>Nice to meet you, {account.displayName}.</h2>
              <p>
                Your mobile and consent step is saved. You can leave and resume
                here anytime.
              </p>
              <div className="local-notice">
                Continue with age, identity and camera photo review. Local
                outcomes are clearly labelled simulations, not real
                verification.
              </div>
              <Link href="/verify" className="button">
                Continue to verification →
              </Link>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
