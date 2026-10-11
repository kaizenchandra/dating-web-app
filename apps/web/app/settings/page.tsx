"use client";
import { LogoutButton } from "../../components/logout-button";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useAccount } from "../../components/account";
import {
  api,
  type Verification,
  type ProfileResult,
} from "../../../../packages/generated-clients/client";
type Session = {
  id: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
};
export default function Settings() {
  const { account, setAccount, error: loadError, retry } = useAccount();
  const [verification, setVerification] = useState<Verification | null>(null);
  const [profile, setProfile] = useState<ProfileResult | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!account) return;
    const c = new AbortController();
    Promise.all([
      api("/account/sessions", "get", undefined, c.signal),
      api("/verification", "get", undefined, c.signal),
      api("/profile", "get", undefined, c.signal),
    ])
      .then(([r, v, p]) => {
        setSessions(r.sessions);
        setVerification(v);
        setProfile(p);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [account]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
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
        <Link href="/onboarding" className="text-link">
          Back to onboarding
        </Link>
      </header>
      <p className="eyebrow section-label">YOUR SPACE, YOUR CHOICE</p>
      <h1>
        Account &<br />
        <em>control.</em>
      </h1>
      {loadError && (
        <>
          <p role="alert">{loadError}</p>
          <button onClick={retry}>Retry</button>
        </>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {account ? (
        <div className="settings-grid">
          <section className="status-card">
            <h2>Your account</h2>
            <p>
              <Link href="/wellbeing">
                Language, quiet hours & read receipts
              </Link>
            </p>
            <p>
              <Link href="/premium">Membership</Link> ·{" "}
              <Link href="/communities">Communities</Link>
            </p>
            <p>{account.displayName || "Your introduction is waiting"}</p>
            <p className="muted">
              {account.phone || "Mobile verification required"}
            </p>
            <p className="muted">
              Phone verification:{" "}
              {account.phoneSource === "local"
                ? "local simulation"
                : account.phoneSource === "sms"
                  ? "SMS verified"
                  : "not verified"}
            </p>
            <p className="muted">
              Age: {verification?.age || "Loading…"} · Identity:{" "}
              {verification?.identity || "Loading…"} · Photo:{" "}
              {profile?.photo?.status || "Not captured"}
            </p>
            <Link href="/safety">Reports, appeals & correction requests</Link>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                action(async () => {
                  setAccount(
                    await api("/account/preferences", "patch", {
                      paused: !account.paused,
                    }),
                  );
                  setNotice(
                    account.paused
                      ? "Account unpaused. Dating access still requires verification."
                      : "Your account is paused.",
                  );
                })
              }
            >
              {account.paused ? "Unpause account" : "Pause account"}
            </button>
          </section>
          <section className="status-card">
            <h2>Active sessions</h2>
            <Link href="/privacy-control">Export, consent & deletion</Link>
            {sessions.length ? (
              sessions.map((s) => (
                <div className="service" key={s.id}>
                  <span>
                    {s.current ? "This session" : "Another session"}
                    <br />
                    <small>
                      Expires {new Date(s.expiresAt).toLocaleDateString()}
                    </small>
                  </span>
                  <span>{s.current ? "Current" : "Active"}</span>
                </div>
              ))
            ) : (
              <p>Loading sessions…</p>
            )}
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                action(async () => {
                  await api("/account/sessions/revoke", "post", {});
                  setSessions((await api("/account/sessions", "get")).sessions);
                  setNotice("Other sessions signed out.");
                })
              }
            >
              Sign out other sessions
            </button>
            <LogoutButton label="Sign out" />
          </section>
          <section className="status-card">
            <h2>Link a sign-in provider</h2>
            <p className="muted">
              Requires sign-in within the last 10 minutes. Linking never
              combines two existing accounts.
            </p>
            {(["google", "apple", "linkedin"] as const).map((provider) => (
              <button
                key={provider}
                className="secondary provider-link"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    const result = await api("/auth/oauth/start", "post", {
                      provider,
                      link: true,
                    });
                    window.location.assign(result.url);
                  })
                }
              >
                Link {provider}
              </button>
            ))}
          </section>
        </div>
      ) : (
        !loadError && <p role="status">Loading your account…</p>
      )}
    </main>
  );
}
