"use client";
import Link from "next/link";
import { clearBrowserOutbox } from "../../lib/message-outbox";
import { useEffect, useState } from "react";
import {
  api,
  ClientError,
} from "../../../../packages/generated-clients/client";
type Receipt = {
  id: string;
  status: string;
  steps: Record<string, unknown>;
  attempts: number;
};
export default function PrivacyControl() {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleted, setDeleted] = useState(false);
  useEffect(() => {
    let alive = true;
    const c = new AbortController();
    const refresh = () =>
      api("/account/deletion", "get", undefined, c.signal)
        .then((r) => {
          if (alive) setReceipt(r);
        })
        .catch((e) => {
          if (
            e.name !== "AbortError" &&
            !(e instanceof ClientError && e.status === 404) &&
            alive
          )
            setError(e.message);
        });
    void refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      alive = false;
      c.abort();
      clearInterval(timer);
    };
  }, [deleted]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exportData() {
    await action(async () => {
      const data = await api("/account/export", "get");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "raahi-personal-data.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Your data export is ready. Store it privately.");
    });
  }
  async function remove(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await action(async () => {
      await api("/account/delete", "post", { confirmation: "DELETE" });
      setDeleted(true);
      let cleanupNotice = "";
      try {
        await clearBrowserOutbox();
      } catch {
        cleanupNotice =
          " Browser storage could not be cleared. Clear this site's data in your browser to remove saved message retries.";
      }
      setNotice(
        "Access revoked. Your deletion receipt will update as each service finishes." +
          cleanupNotice,
      );
    });
  }
  return (
    <main className="account-page">
      <header>
        <Link href="/" className="brand">
          raahi<span>✳</span>
        </Link>
        <Link href="/settings">Account</Link>
      </header>
      <h1>
        Your choices.
        <br />
        <em>Your control.</em>
      </h1>
      {error && (
        <p role="alert" className="form-error">
          {error} <Link href="/login">Sign in again</Link>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {receipt && (
        <section className="status-card" aria-label="Deletion receipt">
          <h2>Deletion: {receipt.status}</h2>
          <p>Receipt {receipt.id}</p>
          <ul>
            {Object.entries(receipt.steps).map(([owner, state]) => (
              <li key={owner}>
                {owner}: {String(state)}
              </li>
            ))}
          </ul>
          {receipt.status === "needs_attention" && (
            <p>
              The retry limit was reached. Contact the operator with this
              receipt; deletion is not complete.
            </p>
          )}
        </section>
      )}
      {!deleted && !receipt && (
        <div className="settings-grid">
          <section className="status-card">
            <h2>A copy of your data</h2>
            <p>
              Download your account, profile, sent messages, date plans and
              submitted reports. Requires sign-in within the last ten minutes.
            </p>
            <button disabled={busy} onClick={exportData}>
              Download my data
            </button>
          </section>
          <section className="status-card">
            <h2>Withdraw dating consent</h2>
            <p>
              Immediately pauses discovery and prevents further messages and
              calls. Your data stays stored until you delete it. You can give
              consent again in onboarding.
            </p>
            <button
              disabled={busy}
              onClick={() =>
                action(async () => {
                  await api("/account/withdraw", "post", { confirm: true });
                  setNotice("Consent withdrawn. Dating access is paused.");
                })
              }
            >
              Withdraw consent
            </button>
          </section>
          <form className="form-stack status-card" onSubmit={remove}>
            <h2>Delete your account</h2>
            <p>
              This cannot be undone. Sessions end immediately. Profile photos,
              profile data, connections and identity records are erased by their
              owning services. Your sent messages become deletion markers.
              Confidential reports and moderation audit records remain for 365
              days under the local retention policy. Backup expiry is handled
              separately by the operator.
            </p>
            <label htmlFor="confirmation">Type DELETE to confirm</label>
            <input
              id="confirmation"
              name="confirmation"
              pattern="DELETE"
              autoComplete="off"
              required
            />
            <button disabled={busy}>Permanently delete my account</button>
          </form>
        </div>
      )}
      <Link href="/privacy">Read the development privacy notice</Link>
    </main>
  );
}
