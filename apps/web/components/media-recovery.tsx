"use client";
import { useEffect, useState } from "react";
import { api } from "../../../packages/generated-clients/client";
import type { paths } from "../../../packages/generated-clients/schema";
type Status =
  paths["/admin/media"]["get"]["responses"][200]["content"]["application/json"];
export function MediaRecovery() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [checkedAt, setCheckedAt] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    api("/admin/media", "get", undefined, c.signal)
      .then((value) => {
        setStatus(value);
        setCheckedAt(Date.now());
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [attempt]);
  return (
    <section className="status-card" aria-label="Photo storage recovery">
      <h2>Photo storage recovery</h2>
      <p className="muted">
        The worker scans up to 200 objects each minute. Unreferenced photos wait
        at least one hour before cleanup; current profile photos are protected
        by a database lock. Exhausted retries need operator investigation.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!status && !error && <p role="status">Loading recovery status…</p>}
      {status && (
        <>
          <p>
            Pending cleanup: {status.pending} · Needs attention: {status.failed}
          </p>
          <p>
            Last scan:{" "}
            {status.lastScanAt
              ? new Date(status.lastScanAt).toLocaleString()
              : "Waiting for first scan"}
          </p>
          {status.lastScanAt &&
            checkedAt - Date.parse(status.lastScanAt) > 300000 && (
              <p role="alert">
                The scan heartbeat is over five minutes old. Check the profile
                service worker.
              </p>
            )}
          <p>
            Last batch: {status.scanned} scanned · {status.queued} queued
          </p>
          {status.lastScanError && <p role="alert">{status.lastScanError}</p>}
        </>
      )}
      <button
        className="secondary"
        onClick={() => {
          setError("");
          setAttempt((x) => x + 1);
        }}
      >
        Refresh recovery status
      </button>
    </section>
  );
}
