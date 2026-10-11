"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../../../packages/generated-clients/client";
export default function Hosts() {
  const [rows, setRows] = useState<
    { accountId: string; reason: string; status: string }[]
  >([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    api("/admin/hosts", "get", undefined, c.signal)
      .then((r) => setRows(r.hosts))
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [attempt]);
  return (
    <main className="account-page">
      <Link href="/admin/security">Staff security</Link>
      <h1>
        Community
        <br />
        <em>care.</em>
      </h1>
      {error && <p role="alert">{error}</p>}
      <button
        onClick={() => {
          setError("");
          setAttempt((x) => x + 1);
        }}
      >
        Refresh host queue
      </button>
      {rows.map((r) => (
        <form
          className="status-card form-stack"
          key={r.accountId}
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              await api("/admin/hosts", "post", {
                accountId: r.accountId,
                decision: String(f.get("decision")) as "approved" | "rejected",
                reason: String(f.get("reason")),
              });
              setAttempt((x) => x + 1);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2>{r.status}</h2>
          <p>{r.accountId}</p>
          <p>{r.reason}</p>
          <label htmlFor={r.accountId}>Decision</label>
          <select id={r.accountId} name="decision">
            <option value="rejected">Reject</option>
            <option value="approved">Approve host</option>
          </select>
          <label htmlFor={r.accountId + "reason"}>Review reason</label>
          <textarea
            id={r.accountId + "reason"}
            name="reason"
            minLength={3}
            maxLength={1000}
            required
          />
          <button disabled={busy}>Record host decision</button>
        </form>
      ))}
    </main>
  );
}
