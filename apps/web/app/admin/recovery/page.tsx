"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../../../packages/generated-clients/client";
import type { paths } from "../../../../../packages/generated-clients/schema";
type Queue =
  paths["/admin/recovery"]["get"]["responses"][200]["content"]["application/json"];
export default function Recovery() {
  const [data, setData] = useState<Queue | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState(0);
  const requests = useRef<Record<string, { id: string; reason: string }>>({});
  useEffect(() => {
    const c = new AbortController();
    api("/admin/recovery", "get", undefined, c.signal)
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [attempt]);
  return (
    <main className="account-page">
      <header>
        <Link className="brand" href="/">
          raahi<span>✳</span>
        </Link>
        <Link href="/admin/reviews">Review queue</Link>
      </header>
      <p className="eyebrow">AUTHORISED ADMINISTRATORS</p>
      <h1>
        Recover with <em>care.</em>
      </h1>
      <p className="intro">
        Inspect the failure and resolve its cause before retrying. The same job
        and decision version are preserved. Retrying deletion never restores
        account access.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error} <Link href="/admin/security">Staff security</Link>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <button
        className="secondary"
        disabled={busy}
        onClick={() => {
          setError("");
          setAttempt((x) => x + 1);
        }}
      >
        Refresh recovery queue
      </button>
      {!data && !error && <p role="status">Loading recovery jobs…</p>}
      {data && (
        <>
          {data.unavailable.length > 0 && (
            <p role="alert">
              Could not load: {data.unavailable.join(", ")}. These owners may
              have pending failures.
            </p>
          )}
          {data.jobs.length === 0 && (
            <p>No exhausted jobs returned by available owners.</p>
          )}
          <div className="settings-grid">
            {data.jobs.map((job) => (
              <form
                className="status-card form-stack"
                key={job.service + job.id}
                onSubmit={async (e) => {
                  e.preventDefault();
                  const reason = String(
                    new FormData(e.currentTarget).get("reason"),
                  ).trim();
                  const key = job.service + job.id;
                  let request = requests.current[key];
                  if (!request || request.reason !== reason)
                    request = requests.current[key] = {
                      id: crypto.randomUUID(),
                      reason,
                    };
                  setBusy(true);
                  setError("");
                  setNotice("");
                  try {
                    await api("/admin/recovery", "post", {
                      requestId: request.id,
                      service: job.service,
                      jobId: job.id,
                      reason,
                    });
                    setNotice(
                      "Retry confirmed by the owning service. The worker will resume this job.",
                    );
                    setAttempt((x) => x + 1);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <h2>{job.kind}</h2>
                <p>Job {job.id}</p>
                <p>
                  {job.service} · {job.attempts} attempts
                </p>
                <p>{job.lastError || "Failure details unavailable"}</p>
                <label htmlFor={job.id}>
                  What was investigated and resolved?
                </label>
                <textarea
                  id={job.id}
                  name="reason"
                  required
                  minLength={10}
                  maxLength={500}
                  rows={3}
                />
                <button disabled={busy}>Retry this job</button>
              </form>
            ))}
          </div>
          <h2>Your recovery audit</h2>
          <p className="muted">
            Latest 50 requests. An unconfirmed response does not prove the
            action failed; retry the same job with the same reason to reuse its
            request ID in this page.
          </p>
          {data.audit.map((item) => (
            <article className="status-card" key={item.requestId}>
              <p>
                {item.service} · {item.status}
              </p>
              <p>Job {item.jobId}</p>
              <p>{item.reason}</p>
              <small>{new Date(item.createdAt).toLocaleString()}</small>
              {item.status === "unconfirmed" && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await api("/admin/recovery", "post", {
                        requestId: item.requestId,
                        service: item.service,
                        jobId: item.jobId,
                        reason: item.reason,
                      });
                      setNotice("Recovery request confirmed.");
                      setAttempt((x) => x + 1);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Retry unconfirmed request
                </button>
              )}
            </article>
          ))}
        </>
      )}
    </main>
  );
}
