"use client";
import Image from "next/image";
import { ProfileDetails } from "../../../components/profile-preferences";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  api,
  ownPhotoUrl,
  type ProfileResult,
} from "../../../../../packages/generated-clients/client";
import { useAccount } from "../../../components/account";
import { MemberNav } from "../../../components/member-nav";
export default function Preview() {
  const { account } = useAccount();
  const [data, setData] = useState<ProfileResult | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!account) return;
    const c = new AbortController();
    api("/profile/preview", "get", undefined, c.signal)
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [account, attempt]);
  return (
    <main className="account-page">
      <header>
        <Link href="/" className="brand">
          raahi<span>✳</span>
        </Link>
        <Link href="/profile" className="text-link">
          Edit profile
        </Link>
      </header>
      <MemberNav />
      <p className="eyebrow section-label">
        YOUR PUBLIC PROFILE · PRIVATE PREVIEW
      </p>
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            onClick={() => {
              setError("");
              setAttempt((a) => a + 1);
            }}
          >
            Retry
          </button>
        </div>
      )}
      {data ? (
        <article className="preview-card">
          <div className="preview-image">
            {data.photo.status !== "not_started" ? (
              <Image
                unoptimized
                src={ownPhotoUrl()}
                alt={`${data.profile.displayName}'s captured photo`}
                width={600}
                height={750}
                className="profile-photo"
              />
            ) : (
              <div className="empty-photo">
                <span>✳</span>
                <p>Your story needs a face.</p>
                <Link href="/profile" className="button">
                  Capture a photo
                </Link>
              </div>
            )}
          </div>
          <div className="preview-story">
            <p className="eyebrow">
              {data.profile.city || "CITY PRIVATE / NOT SET"}
            </p>
            <h1>{data.profile.displayName}</h1>
            <p className="muted">
              {data.profile.pronouns} · {data.profile.gender}
            </p>
            <p className="badge">
              {data.eligible
                ? `${data.ageYears == null ? "Age private" : `${data.ageYears} years`} · ${account?.environment === "local" ? "simulated verification" : "verified age"}`
                : "Verification incomplete"}
            </p>
            <h2>{data.profile.intent || "A connection, with intention."}</h2>
            <p>{data.profile.bio || "Your introduction will appear here."}</p>
            <div className="interest-tags">
              {data.profile.interests.filter(Boolean).map((interest, index) => (
                <span key={index}>{interest}</span>
              ))}
            </div>
            <blockquote>
              <span>A small thing that means a lot to me…</span>
              <p>
                {data.profile.prompt ||
                  "Your answer makes this space your own."}
              </p>
            </blockquote>
            <ProfileDetails profile={data.profile} />
            <Link className="button" href="/discover">
              Explore connections →
            </Link>
            <p className="muted">
              This is how your visible fields appear. Discovery requires
              complete verification.
            </p>
          </div>
        </article>
      ) : (
        !error && <p role="status">Loading your preview…</p>
      )}
    </main>
  );
}
