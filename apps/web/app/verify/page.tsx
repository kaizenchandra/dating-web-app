"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccount } from "../../components/account";
import { MemberNav } from "../../components/member-nav";
import {
  api,
  type Verification,
} from "../../../../packages/generated-clients/client";
export default function Verify() {
  const { account, error: accountError } = useAccount();
  const [verification, setVerification] = useState<Verification | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!account) return;
    const c = new AbortController();
    api("/verification", "get", undefined, c.signal)
      .then(setVerification)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [account, attempt]);
  async function act(fn: () => Promise<Verification>) {
    setBusy(true);
    setError("");
    try {
      setVerification(await fn());
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
        <span className="muted">A little trust goes a long way.</span>
      </header>
      <MemberNav />
      <p className="eyebrow section-label">VERIFICATION, WITH YOUR CONSENT</p>
      <h1>
        Real connections.
        <br />
        <em>Careful beginnings.</em>
      </h1>
      <div className="settings-grid">
        <section className="status-card">
          <h2>Your verification</h2>
          <p>
            Legal identity stays private. Age, identity and profile photos have
            separate review states.
          </p>
          {accountError && <p role="alert">{accountError}</p>}
          {verification ? (
            <>
              <div className="service">
                <span>Mobile ownership</span>
                <strong>
                  {account?.phoneSource === "local"
                    ? "Local simulation"
                    : account?.phone
                      ? "Verified"
                      : "Required"}
                </strong>
              </div>
              <div className="service">
                <span>Age</span>
                <strong>{verification.age}</strong>
              </div>
              <div className="service">
                <span>Identity</span>
                <strong>{verification.identity}</strong>
              </div>
              <div className="service">
                <span>Verification source</span>
                <strong>{verification.source || "None"}</strong>
              </div>
              {verification.reason && (
                <p role="status">{verification.reason}</p>
              )}
            </>
          ) : (
            <p role="status">Loading verification…</p>
          )}
          <Link href="/profile" className="button">
            Continue to your profile →
          </Link>
        </section>
        <section className="status-card">
          <h2>
            {verification?.local
              ? "Local verification simulator"
              : "Identity verification"}
          </h2>
          <p className="muted">
            DigiLocker and alternative identity providers require approval and
            configuration. We never ask for government-service passwords or
            OTPs.
          </p>
          {verification?.local && (
            <>
              <aside className="local-notice">
                Testing only. These outcomes do not prove age, identity,
                liveness, or citizenship. Simulated approvals cannot satisfy
                production eligibility.
              </aside>
              <form
                className="form-stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  act(() =>
                    api("/verification/start", "post", {
                      route: "local",
                      consent: true,
                      dateOfBirth: String(form.get("dob")),
                    }),
                  );
                }}
              >
                <label htmlFor="dob">Test date of birth</label>
                <input id="dob" name="dob" type="date" required />
                <label className="check">
                  <input type="checkbox" required /> I consent to storing this
                  test date of birth and verification outcome locally.
                </label>
                <button disabled={busy}>
                  {busy ? "Saving…" : "Start local review"}
                </button>
              </form>
              {verification.identity === "pending" && (
                <div className="camera-actions">
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(() =>
                        api("/verification/local-decision", "post", {
                          decision: "approved",
                        }),
                      )
                    }
                  >
                    Simulate approval
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      act(() =>
                        api("/verification/local-decision", "post", {
                          decision: "rejected",
                        }),
                      )
                    }
                  >
                    Simulate rejection
                  </button>
                </div>
              )}
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              setError("");
              setAttempt((a) => a + 1);
            }}
          >
            Refresh status
          </button>
        </section>
      </div>
    </main>
  );
}
