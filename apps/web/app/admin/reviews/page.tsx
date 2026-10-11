"use client";
import Link from "next/link";
import { ReviewDelivery } from "../../../components/review-delivery";
import { MediaRecovery } from "../../../components/media-recovery";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  api,
  reviewPhotoUrl,
} from "../../../../../packages/generated-clients/client";
type Review = {
  accountId: string;
  name: string;
  kind: "identity" | "photo";
  source: string;
  updatedAt: string;
  reviewVersion: string;
};
export default function Reviews() {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState("");
  const decisionIds = useRef<Record<string, string>>({});
  useEffect(() => {
    const c = new AbortController();
    api("/admin/reviews", "get", undefined, c.signal)
      .then((r) => setReviews(r.reviews))
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [attempt]);
  async function decide(
    event: React.FormEvent<HTMLFormElement>,
    review: Review,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const decisionId = (decisionIds.current[review.reviewVersion] ||=
        crypto.randomUUID());
      const result = await api("/admin/reviews/decision", "post", {
        decisionId,
        reviewVersion: review.reviewVersion,
        accountId: review.accountId,
        kind: review.kind,
        decision: String(form.get("decision")) as "approved" | "rejected",
        reason: String(form.get("reason")),
      });
      setNotice(
        result.status === "applied"
          ? "Decision saved in the owning service; audit record retained."
          : result.status === "queued"
            ? "Decision recorded for retry. Delivery is not yet confirmed; check delivery history."
            : "Decision could not be applied. Check delivery history and refresh the queue.",
      );
      setAttempt((a) => a + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="account-page">
      <header>
        <Link href="/" className="brand">
          raahi<span>✳</span>
        </Link>
        <Link href="/settings">Account</Link>
      </header>
      <p className="eyebrow section-label">AUTHORISED REVIEW STAFF</p>
      <h1>
        Care, with
        <br />
        <em>accountability.</em>
      </h1>
      <aside className="local-notice">
        Local review environment. Decisions are recorded as simulated
        verification. Production verification decisions require an approved
        provider. Staff access in deployed environments requires MFA.
      </aside>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <button
        className="secondary"
        onClick={() => {
          setError("");
          setAttempt((a) => a + 1);
        }}
      >
        Refresh queue
      </button>
      {reviews?.length === 0 && <p>No pending reviews.</p>}
      <p>
        <Link href="/admin/recovery">Administrator job recovery →</Link>
      </p>
      <MediaRecovery />
      <ReviewDelivery revision={attempt} />
      <div className="settings-grid">
        {reviews?.map((review) => (
          <form
            className="status-card form-stack"
            key={review.reviewVersion}
            onSubmit={(e) => decide(e, review)}
          >
            <p className="eyebrow">
              {review.kind} · {review.source}
            </p>
            <h2>{review.name || "Member"}</h2>
            {review.kind === "photo" && (
              <Image
                src={reviewPhotoUrl(review.accountId)}
                alt="Captured profile photo submitted for review"
                width={300}
                height={300}
                unoptimized
                style={{
                  objectFit: "cover",
                  width: "100%",
                  maxWidth: 300,
                  height: "auto",
                }}
              />
            )}
            <p className="muted">
              Account {review.accountId}
              <br />
              Submitted {new Date(review.updatedAt).toLocaleString()}
            </p>
            <label htmlFor={review.kind + review.accountId + "-decision"}>
              Decision
            </label>
            <select
              id={review.kind + review.accountId + "-decision"}
              name="decision"
            >
              <option value="rejected">Reject</option>
              <option value="approved">Approve local simulation</option>
            </select>
            <label htmlFor={review.kind + review.accountId + "-reason"}>
              Reason
            </label>
            <textarea
              id={review.kind + review.accountId + "-reason"}
              name="reason"
              minLength={3}
              maxLength={500}
              required
              rows={3}
            />
            <button disabled={busy}>
              {busy ? "Saving…" : "Record decision"}
            </button>
          </form>
        ))}
      </div>
    </main>
  );
}
