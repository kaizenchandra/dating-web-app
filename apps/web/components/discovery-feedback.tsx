"use client";
import { useEffect, useState } from "react";
import { api } from "../../../packages/generated-clients/client";
const reasons = {
  intent: "Different intentions",
  distance: "Too far for me",
  interests: "Different interests",
  not_for_me: "Not for me",
} as const;
export type FeedbackReason = keyof typeof reasons;
export function FeedbackReasonSelect() {
  return (
    <label>
      Why hide this recommendation?
      <select name="reason" defaultValue="not_for_me">
        {Object.entries(reasons).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
export function DiscoveryFeedback({
  revision,
  onReset,
}: {
  revision: number;
  onReset: () => void;
}) {
  const [summary, setSummary] = useState<Awaited<
    ReturnType<typeof load>
  > | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  function load(signal?: AbortSignal) {
    return api("/discovery/feedback", "get", undefined, signal);
  }
  useEffect(() => {
    const c = new AbortController();
    load(c.signal)
      .then(setSummary)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [revision, attempt]);
  return (
    <details className="panel">
      <summary>
        Your discovery choices{summary ? ` · ${summary.total} hidden` : ""}
      </summary>
      <p className="muted">
        Your reasons stay private. Hiding removes that profile from
        recommendations until you undo or reset your choices. Use Block or
        Report for safety concerns.
      </p>
      {error && (
        <div role="alert" className="form-error">
          {error}{" "}
          <button
            className="secondary"
            onClick={() => {
              setError("");
              setAttempt((x) => x + 1);
            }}
          >
            Retry choices
          </button>
        </div>
      )}
      {!summary && !error && <p role="status">Loading your choices…</p>}
      {summary && (
        <>
          <ul>
            {summary.reasons.map((x) => (
              <li key={x.reason}>
                {reasons[x.reason]}: {x.count}
              </li>
            ))}
          </ul>
          {summary.total === 0 ? (
            <p>No profiles hidden by feedback.</p>
          ) : (
            <button
              className="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await api("/discovery/feedback", "post", { action: "reset" });
                  setAttempt((x) => x + 1);
                  onReset();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Resetting…" : "Reset hidden recommendations"}
            </button>
          )}
        </>
      )}
    </details>
  );
}
