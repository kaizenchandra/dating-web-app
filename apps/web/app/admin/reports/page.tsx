"use client";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { api } from "../../../../../packages/generated-clients/client";
type Report = {
  id: string;
  kind: string;
  reason: string;
  detail: string;
  targetId: string;
  status: string;
  evidence: unknown;
};
function evidenceImage(evidence: unknown) {
  if (!evidence || typeof evidence !== "object") return null;
  const image = (evidence as Record<string, unknown>).image_jpeg_base64;
  return typeof image === "string" && /^[A-Za-z0-9+/=\s]+$/.test(image)
    ? "data:image/jpeg;base64," + image.replace(/\s/g, "")
    : null;
}
export default function Moderation() {
  const [rows, setRows] = useState<Report[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    api("/admin/reports", "get", undefined, c.signal)
      .then((r) => setRows(r.reports as Report[]))
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [attempt]);
  async function decide(e: React.FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("/admin/reports/action", "post", {
        reportId: id,
        action: String(f.get("action")) as
          "review" | "dismiss" | "suspend" | "restore",
        resolution: String(f.get("resolution")),
      });
      setAttempt((x) => x + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="account-page">
      <header>
        <Link href="/admin/security">Staff security</Link>
        <Link href="/admin/reviews">Verification queue</Link>
        <Link href="/admin/hosts">Host applications</Link>
      </header>
      <h1>
        Listen.
        <br />
        <em>Take action.</em>
      </h1>
      <p>
        Confidential review queue. Resolutions are shared with the reporting
        member; keep third-party personal information out of responses.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button
        onClick={() => {
          setError("");
          setAttempt((x) => x + 1);
        }}
      >
        Refresh queue
      </button>
      {rows.map((r) => (
        <form
          className="status-card form-stack"
          key={r.id}
          onSubmit={(e) => decide(e, r.id)}
        >
          <p className="eyebrow">
            {r.kind} · {r.status}
          </p>
          <h2>{r.reason}</h2>
          <p>{r.detail}</p>
          <p className="muted">Subject account: {r.targetId}</p>
          <details>
            <summary>Preserved evidence</summary>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {JSON.stringify(
                r.evidence,
                (key, value) =>
                  key === "image_jpeg_base64" && value
                    ? "[Preserved image]"
                    : value,
                2,
              )}
            </pre>
            {evidenceImage(r.evidence) && (
              <Image
                unoptimized
                src={evidenceImage(r.evidence)!}
                alt="Reported image evidence"
                width={320}
                height={320}
                style={{
                  maxWidth: "100%",
                  height: "auto",
                  objectFit: "contain",
                }}
              />
            )}
          </details>
          <label htmlFor={r.id + "action"}>Action</label>
          <select id={r.id + "action"} name="action">
            <option value="review">Begin review</option>
            <option value="dismiss">Dismiss report</option>
            <option value="resolve">Resolve request</option>
            <option value="suspend">Suspend account</option>
            <option value="restore">Restore account</option>
          </select>
          <label htmlFor={r.id + "resolution"}>Response and audit reason</label>
          <textarea
            id={r.id + "resolution"}
            name="resolution"
            minLength={3}
            maxLength={1000}
            required
          />
          <button disabled={busy}>Record action</button>
        </form>
      ))}
    </main>
  );
}
