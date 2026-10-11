"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../packages/generated-clients/client";
import type { paths } from "../../../packages/generated-clients/schema";
type Allowance =
  paths["/connections/allowance"]["get"]["responses"][200]["content"]["application/json"];
export function ConnectionAllowance({ revision = 0 }: { revision?: number }) {
  const [data, setData] = useState<Allowance | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api("/connections/allowance", "get", undefined, controller.signal)
      .then((r) => {
        setData(r);
        setError("");
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [revision, attempt]);
  return (
    <aside className="status-card" aria-label="Daily connection allowance">
      {error ? (
        <>
          <p role="alert">{error}</p>
          <button
            type="button"
            className="secondary"
            onClick={() => setAttempt((x) => x + 1)}
          >
            Retry allowance
          </button>
        </>
      ) : data ? (
        <>
          <p>
            <strong>{data.tier || "Free"}</strong> ·{" "}
            {Math.max(0, data.features.superLikesPerDay - data.superLikesUsed)}{" "}
            of {data.features.superLikesPerDay} super likes left ·{" "}
            {Math.max(
              0,
              data.features.directIntroductionsPerDay -
                data.directIntroductionsUsed,
            )}{" "}
            of {data.features.directIntroductionsPerDay} direct introductions
            left.
          </p>
          <p className="muted">
            Resets at midnight IST (
            {new Date(data.resetsAt).toLocaleDateString("en-IN", {
              timeZone: "Asia/Kolkata",
            })}
            ). Direct introductions appear in Connections for acceptance.
            Matched chat is unlimited.
          </p>
          <Link href="/premium">Compare plans</Link>
        </>
      ) : (
        <p>Loading daily allowance…</p>
      )}
    </aside>
  );
}
