"use client";
import Image from "next/image";
import {
  paceLabels,
  vibeLabels,
  IntroductionComposer,
} from "../../components/connection-style";
import { ConnectionAllowance } from "../../components/connection-allowance";
import { ProfileDetails } from "../../components/profile-preferences";
import {
  DiscoveryFeedback,
  FeedbackReasonSelect,
  type FeedbackReason,
} from "../../components/discovery-feedback";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MemberNav } from "../../components/member-nav";
import { useAccount } from "../../components/account";
import {
  api,
  discover,
  candidatePhotoUrl,
  type Candidate,
} from "../../../../packages/generated-clients/client";
export default function Discover() {
  const { account } = useAccount();
  const [items, setItems] = useState<Candidate[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [allowanceRevision, setAllowanceRevision] = useState(0);
  const [ranking, setRanking] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [notice, setNotice] = useState("");
  const [feedbackRevision, setFeedbackRevision] = useState(0);
  const [hidden, setHidden] = useState<string | null>(null);
  const [passed, setPassed] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const chosen =
      query.get("ranking") || (query.get("curated") === "1" ? "interests" : "");
    if (chosen)
      Promise.resolve().then(() => {
        setRanking(chosen);
        setFilters({ ranking: chosen });
      });
  }, []);
  useEffect(() => {
    if (!account) return;
    const c = new AbortController();
    discover(filters, c.signal)
      .then((r) => {
        setItems(r.items);
        setCursor(r.nextCursor);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [account, filters, attempt]);
  useEffect(() => {
    if (selected) dialog.current?.showModal();
    else dialog.current?.close();
  }, [selected]);
  async function action(
    person: Candidate,
    action: "like" | "pass" | "block",
    introduction = "",
    content: "profile" | "prompt" | "bio" = "profile",
    superLike = false,
  ) {
    setBusy(true);
    setError("");
    try {
      const result = await api("/connections/action", "post", {
        targetId: person.id,
        action,
        introduction,
        content,
        superLike,
      });
      setHidden(null);
      setPassed(null);
      setItems((old) => old.filter((p) => p.id !== person.id));
      setSelected(null);
      setNotice(
        result.matched
          ? `You and ${person.displayName} chose each other. Your match is in Connections.`
          : action === "like"
            ? "Your interest is sent. A conversation starts with mutual interest."
            : action === "block"
              ? "Blocked. This profile cannot connect with you."
              : "Profile passed.",
      );
      if (action === "pass") setPassed(person.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setAllowanceRevision((x) => x + 1);
    }
  }
  return (
    <main className="account-page">
      <header>
        <Link href="/" className="brand">
          raahi<span>✳</span>
        </Link>
        <span className="muted">A thoughtful hello can change a day.</span>
      </header>
      <MemberNav />
      <ConnectionAllowance revision={allowanceRevision} />
      <div className="discover-heading">
        <div>
          <p className="eyebrow section-label">A WORLD OF POSSIBLE HELLOS</p>
          <h1>
            Find your
            <br />
            <em>kind of connection.</em>
          </h1>
        </div>
        <p className="intro">
          Read a little deeper. Notice what you share. Start with something that
          matters.
        </p>
      </div>
      {account?.environment === "local" && (
        <p className="local-notice">
          Local testing: every visible member is a persisted local account with
          simulated verification. No real verification is implied.
        </p>
      )}
      <form
        className="filter-bar"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setLoading(true);
          setError("");
          setFilters(
            Object.fromEntries(
              [...f.entries()].map(([k, v]) => [k, String(v)]),
            ) as Record<string, string>,
          );
        }}
      >
        <label>
          City
          <input name="city" placeholder="Your preferred city" maxLength={80} />
        </label>
        <label>
          Age from
          <input
            name="minAge"
            type="number"
            min={18}
            max={100}
            placeholder="18"
          />
        </label>
        <label>
          Age to
          <input
            name="maxAge"
            type="number"
            min={18}
            max={100}
            placeholder="40"
          />
        </label>
        <label>
          Intention
          <input name="intent" placeholder="Any intention" maxLength={100} />
        </label>
        <label>
          City distance (km)
          <input
            name="maxDistanceKm"
            type="number"
            min={10}
            max={3000}
            placeholder="Any distance"
          />
        </label>
        <label htmlFor="discovery-ranking">Discovery order</label>
        <select
          id="discovery-ranking"
          name="ranking"
          value={ranking}
          onChange={(e) => setRanking(e.target.value)}
        >
          <option value="">Standard · free</option>
          <option value="interests">Shared interests · Gold+</option>
          <option value="intent">Same intention first · Diamond+</option>
          <option value="city">Same city first · Platinum</option>
        </select>
        <label htmlFor="filter-dating-pace">Dating pace</label>
        <select id="filter-dating-pace" name="datingPace">
          <option value="">Any pace</option>
          {Object.entries(paceLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <label htmlFor="filter-date-vibe">First-date preference</label>
        <select id="filter-date-vibe" name="dateVibe">
          <option value="">Any date idea</option>
          {Object.entries(vibeLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <button disabled={loading}>Apply filters</button>
      </form>
      <p className="muted">
        Distances are approximate city-to-city estimates, never precise
        locations. City data:{" "}
        <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">
          GeoNames
        </a>
        .
      </p>
      {account && (
        <DiscoveryFeedback
          revision={feedbackRevision}
          onReset={() => {
            setHidden(null);
            setNotice(
              "Hidden recommendations reset. Your other preferences still apply.",
            );
            setAttempt((a) => a + 1);
          }}
        />
      )}
      {error && (
        <div className="form-error" role="alert">
          <p>{error}</p>
          <div className="camera-actions">
            <button
              className="secondary"
              onClick={() => {
                setError("");
                setLoading(true);
                setAttempt((a) => a + 1);
              }}
            >
              Retry
            </button>
            <Link className="text-link" href="/verify">
              Review verification
            </Link>
            <Link className="text-link" href="/profile">
              Edit profile
            </Link>
          </div>
        </div>
      )}
      {notice && (
        <div className="success-notice" role="status">
          {notice}{" "}
          {hidden && (
            <button
              className="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await api("/discovery/feedback", "post", {
                    action: "restore",
                    targetId: hidden,
                  });
                  setHidden(null);
                  setNotice(
                    "Recommendation restored. Your preferences still apply.",
                  );
                  setFeedbackRevision((x) => x + 1);
                  setAttempt((x) => x + 1);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Undo hide
            </button>
          )}
          {passed && (
            <button
              className="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api("/connections/action", "post", {
                    targetId: passed,
                    action: "undo",
                  });
                  setPassed(null);
                  setAttempt((a) => a + 1);
                  setNotice("Pass undone.");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Undo last pass
            </button>
          )}
        </div>
      )}
      {loading ? (
        <p role="status">Finding eligible profiles…</p>
      ) : !error && items.length === 0 ? (
        <section className="empty-state">
          <span aria-hidden="true">✳</span>
          <h2>A little space for possibility.</h2>
          <p>
            No eligible profiles fit this page of your preferences yet. Adjust
            your filters, enable long distance in your profile, or check back
            later.
          </p>
          <p className="muted">
            In local testing, create a second verified test account in an
            independent browser session.
          </p>
        </section>
      ) : (
        <div className="discovery-grid">
          {items.map((person) => (
            <article className="person-card" key={person.id}>
              <Image
                unoptimized
                src={candidatePhotoUrl(person.id)}
                alt={`${person.displayName}'s camera photo`}
                width={600}
                height={700}
              />
              <div className="person-info">
                <p className="eyebrow">{person.city}</p>
                <p className="muted">
                  {person.approximateDistanceKm == null
                    ? "City distance unavailable"
                    : person.approximateDistanceKm === 0
                      ? "Same city area"
                      : `Approximately ${person.approximateDistanceKm} km between cities`}
                </p>
                {!!person.sharedInterests?.length && (
                  <p>You both enjoy {person.sharedInterests.join(", ")}.</p>
                )}
                <h2>
                  {person.displayName}
                  {person.age == null ? " · Age private" : `, ${person.age}`}
                </h2>
                <p className="badge">
                  {person.verificationSource === "local"
                    ? "Local verification simulation"
                    : "Identity reviewed"}
                </p>
                <p>{person.intent}</p>
                {person.datingPace && (
                  <p className="badge">{paceLabels[person.datingPace]}</p>
                )}
                {!!person.dateVibes?.length && (
                  <p className="muted">
                    {person.dateVibes.map((v) => vibeLabels[v]).join(" · ")}
                  </p>
                )}
                <p className="muted">{person.bio}</p>
                <div className="interest-tags">
                  {person.interests
                    .filter(Boolean)
                    .slice(0, 4)
                    .map((x, i) => (
                      <span key={i}>{x}</span>
                    ))}
                </div>
                <div className="person-actions">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => action(person, "pass")}
                    aria-label={`Pass ${person.displayName}`}
                  >
                    Pass
                  </button>
                  <button disabled={busy} onClick={() => setSelected(person)}>
                    Read & say hello ↗
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {cursor && !loading && (
        <button
          className="secondary"
          onClick={() => {
            setLoading(true);
            setFilters((f) => ({ ...f, cursor }));
          }}
        >
          Next profiles →
        </button>
      )}
      <dialog
        ref={dialog}
        className="profile-dialog"
        onCancel={() => setSelected(null)}
      >
        {selected && (
          <>
            <button
              className="dialog-close secondary"
              aria-label="Close profile"
              onClick={() => setSelected(null)}
            >
              ×
            </button>
            <p className="eyebrow">
              {selected.city} · {selected.intent}
            </p>
            <h2>
              {selected.displayName}
              {selected.age == null ? " · Age private" : `, ${selected.age}`}
            </h2>
            <p>{selected.bio}</p>
            <Link href={`/safety?target=${selected.id}`}>
              Report this profile
            </Link>
            <blockquote>
              <span>A small thing that means a lot to me…</span>
              <p>{selected.prompt || "Not answered yet"}</p>
            </blockquote>
            <ProfileDetails profile={selected} />
            <form
              className="form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                action(
                  selected,
                  "like",
                  String(f.get("introduction") || ""),
                  String(f.get("content")) as "profile" | "prompt" | "bio",
                  f.get("superLike") === "on",
                );
              }}
            >
              <label htmlFor="content">What caught your attention?</label>
              <select id="content" name="content">
                <option value="profile">Their profile</option>
                <option value="prompt">Their prompt</option>
                <option value="bio">Their bio</option>
              </select>
              <IntroductionComposer key={selected.id} person={selected} />
              <p className="muted">
                Uses one direct introduction when text is included. They must
                accept before chat opens.
              </p>
              <label className="check">
                <input type="checkbox" name="superLike" />
                Send as a super like ✦ (uses one daily super like)
              </label>
              <button disabled={busy}>
                {busy ? "Sending…" : "Send interest ♡"}
              </button>
            </form>
            <form
              className="form-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                const reason = String(
                  new FormData(e.currentTarget).get("reason"),
                ) as FeedbackReason;
                setBusy(true);
                setError("");
                try {
                  await api("/discovery/feedback", "post", {
                    action: "hide",
                    targetId: selected.id,
                    reason,
                  });
                  setItems((items) =>
                    items.filter((p) => p.id !== selected.id),
                  );
                  setHidden(selected.id);
                  setPassed(null);
                  setSelected(null);
                  setFeedbackRevision((x) => x + 1);
                  setNotice(
                    "Recommendation hidden. Your reason stays private.",
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <FeedbackReasonSelect />
              <p className="muted">
                This hides this profile from your recommendations. They will not
                be notified.
              </p>
              <button className="secondary" disabled={busy}>
                Hide recommendation
              </button>
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
            </form>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => action(selected, "block")}
            >
              Block this profile
            </button>
          </>
        )}
      </dialog>
    </main>
  );
}
