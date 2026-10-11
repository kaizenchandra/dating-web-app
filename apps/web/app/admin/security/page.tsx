"use client";
import Link from "next/link";
import { useState } from "react";
import { api } from "../../../../../packages/generated-clients/client";
export default function StaffSecurity() {
  const [secret, setSecret] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function setup() {
    setBusy(true);
    setError("");
    try {
      setSecret((await api("/admin/mfa/setup", "post", {})).secret);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/admin/mfa/verify", "post", {
        code: String(new FormData(e.currentTarget).get("code")),
      });
      setSecret("");
      setNotice(
        "Authenticator verified. This session has staff access for 10 minutes.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="account-page">
      <Link href="/admin/reports">Moderation</Link>
      <h1>
        Staff <em>security.</em>
      </h1>
      <p>
        Staff roles are checked on the server. Add the enrollment secret to an
        authenticator app. Keep it private.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <button disabled={busy} onClick={setup}>
        Enroll authenticator
      </button>
      {secret && (
        <p className="local-notice">
          Enrollment secret: <code>{secret}</code>
        </p>
      )}
      <form className="form-stack status-card" onSubmit={verify}>
        <label htmlFor="code">Authenticator code</label>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          autoComplete="one-time-code"
          required
        />
        <button disabled={busy}>Verify authenticator</button>
      </form>
    </main>
  );
}
