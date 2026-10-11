"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getStatus,
  type PlatformStatus,
} from "../../../../packages/generated-clients/client";
export default function Status() {
  const [data, setData] = useState<PlatformStatus | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    getStatus(controller.signal)
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt]);
  return (
    <main className="status-page">
      <Link className="brand" href="/">
        raahi<span>✳</span>
      </Link>
      <p className="eyebrow">BUILDING WITH INTENTION</p>
      <h1>
        Before the
        <br />
        <em>first hello.</em>
      </h1>
      <p className="intro">
        Raahi is in development. This live check shows whether the platform’s
        services can reach their databases and coordination infrastructure.
      </p>
      <section className="status-card" aria-live="polite">
        <h2>Platform readiness</h2>
        {loading ? (
          <p>Checking services…</p>
        ) : error ? (
          <p role="alert">{error}</p>
        ) : (
          data?.services.map((service) => (
            <div className="service" key={service.name}>
              <span>{service.name}</span>
              <strong className={service.status === "ready" ? "ready" : ""}>
                {service.status}
              </strong>
            </div>
          ))
        )}
        <button
          disabled={loading}
          onClick={() => {
            setLoading(true);
            setError("");
            setAttempt((x) => x + 1);
          }}
        >
          {loading ? "Checking…" : "Check again"}
        </button>
      </section>
      <p className="muted">
        Service readiness does not mean dating features or provider integrations
        are complete.
      </p>
      <Link className="text-link" href="/">
        ← Back to Raahi
      </Link>
    </main>
  );
}
