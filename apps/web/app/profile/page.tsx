"use client";
import Image from "next/image";
import { ConnectionStyleEditor } from "../../components/connection-style";
import { ProfilePreferences } from "../../components/profile-preferences";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccount } from "../../components/account";
import { MemberNav } from "../../components/member-nav";
import { Camera } from "../../components/camera";
import {
  api,
  ownPhotoUrl,
  type Profile,
  type ProfileResult,
} from "../../../../packages/generated-clients/client";
const fields: [keyof Profile, string, string][] = [
  ["displayName", "Display name", "The name you go by"],
  ["gender", "Gender", "In your own words"],
  ["pronouns", "Pronouns", "e.g. she / her"],
  ["city", "City in India", "e.g. Bengaluru"],
  ["intent", "Relationship intention", "What are you looking for?"],
  ["work", "Work (optional)", "What keeps you curious?"],
  ["education", "Education (optional)", ""],
  ["lifestyle", "Lifestyle (optional)", ""],
  ["futurePlans", "Future plans (optional)", ""],
  [
    "communication",
    "Communication preferences",
    "e.g. voice notes, slow replies",
  ],
  ["boundaries", "Dating boundaries", "What helps you feel comfortable?"],
  [
    "preferredGender",
    "Who would you like to meet?",
    "Any, woman, man, non-binary…",
  ],
];
export default function EditProfile() {
  const { account, error: accountError } = useAccount();
  const [data, setData] = useState<ProfileResult | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [photoVersion, setPhotoVersion] = useState(0);
  useEffect(() => {
    if (!account) return;
    const c = new AbortController();
    api("/profile", "get", undefined, c.signal)
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [account, attempt]);
  function update(key: keyof Profile, value: unknown) {
    setData((d) => (d ? { ...d, profile: { ...d.profile, [key]: value } } : d));
  }
  async function act(fn: () => Promise<ProfileResult>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setData(await fn());
      setNotice(message);
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
        <Link href="/profile/preview" className="text-link">
          Preview your profile ↗
        </Link>
      </header>
      <MemberNav />
      <p className="eyebrow section-label">THE THINGS THAT MAKE YOU, YOU</p>
      <h1>
        More than
        <br />
        <em>a first impression.</em>
      </h1>
      {accountError && <p role="alert">{accountError}</p>}
      {error && (
        <div role="alert" className="form-error">
          {error}
          <button
            className="secondary"
            onClick={() => {
              setError("");
              setAttempt((a) => a + 1);
            }}
          >
            Reload saved profile
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="success-notice">
          {notice}
        </p>
      )}
      {data ? (
        <div className="profile-grid">
          <aside className="status-card photo-card">
            {data.photo.status !== "not_started" && (
              <>
                <Image
                  unoptimized
                  src={ownPhotoUrl() + "?v=" + photoVersion}
                  width={480}
                  height={600}
                  alt="Your current profile photo"
                  className="profile-photo"
                />
                <p>
                  Photo review: <strong>{data.photo.status}</strong>
                  {data.photo.source === "local" ? " · local simulation" : ""}
                </p>
              </>
            )}
            <Camera
              onSaved={(result) => {
                setData(result);
                setPhotoVersion((v) => v + 1);
                setNotice(
                  "Photo saved. Review is pending; replacement resets photo approval.",
                );
              }}
            />
            {account?.environment === "local" &&
              data.photo.status === "pending" && (
                <aside className="local-notice">
                  <p>
                    Local moderation simulator. No liveness or face matching has
                    been performed.
                  </p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(
                        () =>
                          api("/profile/photo/local-decision", "post", {
                            decision: "approved",
                          }),
                        "Photo review simulated.",
                      )
                    }
                  >
                    Simulate photo approval
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      act(
                        () =>
                          api("/profile/photo/local-decision", "post", {
                            decision: "rejected",
                          }),
                        "Photo rejection simulated. Retake to submit again.",
                      )
                    }
                  >
                    Simulate photo rejection
                  </button>
                </aside>
              )}
          </aside>
          <form
            className="auth-card form-stack profile-form"
            onSubmit={(e) => {
              e.preventDefault();
              act(
                () => api("/profile", "put", data.profile),
                "Your profile is saved.",
              );
            }}
          >
            <h2>Tell your story.</h2>
            <div className="field-grid">
              {fields.map(([key, label, placeholder]) => (
                <div key={key}>
                  <label htmlFor={key}>{label}</label>
                  <input
                    id={key}
                    name={key}
                    value={String(data.profile[key])}
                    required={[
                      "displayName",
                      "gender",
                      "city",
                      "intent",
                    ].includes(key)}
                    maxLength={key === "displayName" ? 60 : 200}
                    placeholder={placeholder}
                    onChange={(e) => update(key, e.target.value)}
                  />
                </div>
              ))}
            </div>
            <label htmlFor="bio">A little about you</label>
            <textarea
              id="bio"
              rows={4}
              maxLength={1000}
              value={data.profile.bio}
              onChange={(e) => update("bio", e.target.value)}
              placeholder="What would someone discover over a long conversation?"
            />
            <label htmlFor="prompt">
              A small thing that means a lot to me…
            </label>
            <textarea
              id="prompt"
              rows={3}
              maxLength={500}
              value={data.profile.prompt}
              onChange={(e) => update("prompt", e.target.value)}
            />
            <div className="field-grid">
              <div>
                <label htmlFor="languages">
                  Languages (separate with commas)
                </label>
                <input
                  id="languages"
                  value={data.profile.languages.join(", ")}
                  onChange={(e) =>
                    update(
                      "languages",
                      e.target.value.split(",").map((s) => s.trim()),
                    )
                  }
                />
              </div>
              <div>
                <label htmlFor="interests">
                  Interests (separate with commas)
                </label>
                <input
                  id="interests"
                  value={data.profile.interests.join(", ")}
                  onChange={(e) =>
                    update(
                      "interests",
                      e.target.value.split(",").map((s) => s.trim()),
                    )
                  }
                />
              </div>
              <div>
                <label htmlFor="height">Height in cm</label>
                <input
                  id="height"
                  type="number"
                  min={100}
                  max={250}
                  required
                  value={data.profile.heightCm}
                  onChange={(e) => update("heightCm", Number(e.target.value))}
                />
              </div>
              <div>
                <label htmlFor="minAge">Minimum preferred age</label>
                <input
                  id="minAge"
                  type="number"
                  min={18}
                  max={100}
                  required
                  value={data.profile.minAge}
                  onChange={(e) => update("minAge", Number(e.target.value))}
                />
              </div>
              <div>
                <label htmlFor="maxAge">Maximum preferred age</label>
                <input
                  id="maxAge"
                  type="number"
                  min={data.profile.minAge}
                  max={100}
                  required
                  value={data.profile.maxAge}
                  onChange={(e) => update("maxAge", Number(e.target.value))}
                />
              </div>
            </div>
            <ConnectionStyleEditor profile={data.profile} onChange={update} />
            <ProfilePreferences profile={data.profile} onChange={update} />
            {(
              [
                ["showWork", "Show work on my public profile"],
                ["showHeight", "Show height on my public profile"],
                ["longDistance", "Open to long-distance connections"],
                ["incognito", "Incognito: hide me from discovery"],
              ] as const
            ).map(([key, label]) => (
              <label className="check" key={key}>
                <input
                  type="checkbox"
                  checked={data.profile[key]}
                  onChange={(e) => update(key, e.target.checked)}
                />
                {label}
              </label>
            ))}
            <button disabled={busy}>
              {busy ? "Saving…" : "Save your profile →"}
            </button>
            <p className="muted">
              Your legal identity and phone number never appear in the public
              preview.
            </p>
          </form>
        </div>
      ) : (
        !error && <p role="status">Loading your profile…</p>
      )}
    </main>
  );
}
