"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../../packages/generated-clients/client";
type Kind =
  | "profile"
  | "media"
  | "message"
  | "call"
  | "offline"
  | "appeal"
  | "correction";
export default function Safety() {
  const [reports, setReports] = useState<
    Awaited<ReturnType<typeof getReports>>
  >([]);
  const [restricted, setRestricted] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [kind, setKind] = useState<Kind>("profile");
  const [target, setTarget] = useState("");
  const [subject, setSubject] = useState("");
  async function getReports() {
    return (await api("/reports", "get")).reports;
  }
  useEffect(() => {
    const c = new AbortController();
    Promise.all([
      api("/safety/account", "get", undefined, c.signal),
      api("/reports", "get", undefined, c.signal),
    ])
      .then(([a, r]) => {
        const q = new URLSearchParams(location.search);
        setTarget(q.get("target") || "");
        setSubject(q.get("subject") || "");
        const k = q.get("kind");
        if (
          [
            "profile",
            "media",
            "message",
            "call",
            "offline",
            "appeal",
            "correction",
          ].includes(k || "")
        )
          setKind(k as Kind);

        setRestricted(a.restricted);
        if (a.restricted) setKind("appeal");
        setReports(r.reports);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [attempt]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await api("/reports", "post", {
        kind,
        ...(target ? { targetId: target } : {}),
        ...(subject ? { subjectId: subject } : {}),
        reason: String(f.get("reason")),
        detail: String(f.get("detail")),
      });
      setNotice(
        `Request ${result.id} received. You can follow its status below.`,
      );
      setReports(await getReports());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="account-page">
      <header>
        <Link className="brand" href="/">
          raahi<span>✳</span>
        </Link>
        <Link href="/settings">Account</Link>
      </header>
      <p className="eyebrow section-label">YOUR VOICE MATTERS</p>
      <h1>
        Room to
        <br />
        <em>speak up.</em>
      </h1>
      <p>
        Report an experience, appeal a decision or ask us to correct your data.
        Your report is visible to authorised review staff, not the person you
        report. This service is not an emergency response service.
      </p>
      {restricted && (
        <aside className="local-notice">
          Dating access is restricted. You can still submit an appeal here.
        </aside>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error} <Link href="/login">Sign in</Link>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <button
        className="secondary"
        onClick={() => {
          setError("");
          setAttempt((x) => x + 1);
        }}
      >
        Refresh requests
      </button>
      <form className="form-stack status-card" onSubmit={submit}>
        <label htmlFor="kind">Request type</label>
        <select
          id="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind)}
        >
          {(restricted
            ? ["appeal", "correction"]
            : [
                "profile",
                "media",
                "message",
                "call",
                "offline",
                "appeal",
                "correction",
              ]
          ).map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        {!["appeal", "correction", "message", "call"].includes(kind) && (
          <>
            <label htmlFor="target">Account ID</label>
            <input
              id="target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              required
            />
          </>
        )}
        {["message", "call"].includes(kind) && (
          <>
            <label htmlFor="subject">
              {kind === "message" ? "Message" : "Call"} ID
            </label>
            <input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
            />
          </>
        )}
        <label htmlFor="reason">Reason</label>
        <input
          id="reason"
          name="reason"
          minLength={3}
          maxLength={120}
          required
        />
        <label htmlFor="detail">What happened?</label>
        <textarea
          id="detail"
          name="detail"
          minLength={10}
          maxLength={3000}
          rows={5}
          required
        />
        <p className="muted">
          Do not include passwords, government document numbers or OTPs.
        </p>
        <button disabled={busy}>
          {busy ? "Submitting…" : "Submit confidential request"}
        </button>
      </form>
      <h2>Your requests</h2>
      {reports.length === 0 && <p>No requests yet.</p>}
      {reports.map((r) => (
        <article className="status-card" key={r.id}>
          <p className="eyebrow">
            {r.kind} · {r.status}
          </p>
          <h3>{r.reason}</h3>
          <p>{r.detail}</p>
          {r.resolution && <p>Response: {r.resolution}</p>}
          <small>{r.id}</small>
        </article>
      ))}
    </main>
  );
}
