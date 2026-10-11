"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PhoneLogin } from "../../components/phone-login";
import { api } from "../../../../packages/generated-clients/client";
type Options = {
  local: boolean;
  providers: { id: string; configured: boolean }[];
};
export default function Login() {
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    api("/auth/options", "get", undefined, c.signal)
      .then(setOptions)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    const reason = new URLSearchParams(window.location.search).get("error");
    if (reason)
      Promise.resolve().then(() =>
        setError(
          reason === "BROWSER_STORAGE_UNCLEARED"
            ? "You are signed out. Saved message retries could not be cleared. Clear this site’s browser data on a shared device."
            : reason === "PROVIDER_CANCELLED"
              ? "Sign-in was cancelled. Choose a method to try again."
              : reason === "ACCOUNT_LINK_CONFLICT"
                ? "That provider is linked to another account. Accounts cannot be merged automatically."
                : "Provider sign-in could not be completed. Please try again or use your mobile number.",
        ),
      );
    return () => c.abort();
  }, [attempt]);
  async function provider(id: "google" | "apple" | "linkedin") {
    setBusy(id);
    setError("");
    try {
      const result = await api("/auth/oauth/start", "post", { provider: id });
      window.location.assign(result.url);
    } catch (e) {
      setError((e as Error).message);
      setBusy("");
    }
  }
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Link href="/" className="brand">
          raahi<span>✳</span>
        </Link>
        <p className="eyebrow">GOOD THINGS START WITH HELLO</p>
        <h1>
          Your next
          <br />
          chapter.
          <br />
          <em>Your pace.</em>
        </h1>
        <p className="intro">
          A little courage. A little curiosity. Space for a connection that
          feels like you.
        </p>
        <p className="muted">India · Adults 18+ · Development preview</p>
      </section>
      <section className="auth-card">
        <p className="eyebrow">COME AS YOU ARE</p>
        <h2>Let’s start with you.</h2>
        <p className="muted">
          Sign in or create an account. Every member needs an Indian mobile
          number before dating access.
        </p>
        {options?.local && (
          <aside className="local-notice">
            Local development environment. Test phone verification does not
            establish real mobile ownership.
          </aside>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {!options ? (
          <button
            onClick={() => {
              setError("");
              setAttempt((a) => a + 1);
            }}
          >
            Retry connection
          </button>
        ) : (
          <>
            <PhoneLogin local={options.local} />
            <div className="divider">or continue with</div>
            <div className="providers">
              {options.providers.map((p) => (
                <button
                  className="secondary"
                  key={p.id}
                  disabled={!p.configured || !!busy}
                  onClick={() =>
                    provider(p.id as "google" | "apple" | "linkedin")
                  }
                >
                  {p.id === "apple"
                    ? "Apple"
                    : p.id === "google"
                      ? "Google"
                      : "LinkedIn"}
                  {!p.configured
                    ? " · not configured"
                    : busy === p.id
                      ? " · connecting…"
                      : ""}
                </button>
              ))}
            </div>
            <p className="muted">
              Provider sign-in requires configuration. Email addresses are never
              used to automatically merge accounts.
            </p>
          </>
        )}
        <p className="fine-print">
          Read the development <Link href="/terms">terms</Link> and{" "}
          <Link href="/privacy">privacy notice</Link> before continuing.
        </p>
      </section>
    </main>
  );
}
