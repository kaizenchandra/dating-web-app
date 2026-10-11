"use client";
import { useEffect, useState } from "react";
import { api } from "../../../packages/generated-clients/client";
import type { paths } from "../../../packages/generated-clients/schema";
type Delivery =
  paths["/admin/reviews/delivery"]["get"]["responses"][200]["content"]["application/json"]["items"];
export function ReviewDelivery({ revision }: { revision: number }) {
  const [items, setItems] = useState<Delivery>([]),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    api("/admin/reviews/delivery", "get", undefined, c.signal)
      .then((r) => setItems(r.items))
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [revision, attempt]);
  return (
    <details className="status-card">
      <summary>Your review delivery history</summary>
      <p className="muted">
        Latest 50 decisions. Requested decisions retry automatically up to ten
        attempts. Rejected submissions need a fresh review; needs-attention
        entries require operator investigation. Retrying never approves a
        replacement submission.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button
        className="secondary"
        onClick={() => {
          setError("");
          setAttempt((x) => x + 1);
        }}
      >
        Refresh delivery history
      </button>
      {items.length === 0 && !error && <p>No versioned decisions found.</p>}
      {items.map((item) => (
        <article key={item.decisionId} className="panel">
          <p>
            {item.kind} · {item.decision} · <strong>{item.status}</strong>
          </p>
          <p className="muted">
            Decision {item.decisionId}
            <br />
            Attempts: {item.attempts} ·{" "}
            {new Date(item.updatedAt).toLocaleString()}
          </p>
          {item.lastError && <p>{item.lastError}</p>}
        </article>
      ))}
    </details>
  );
}
