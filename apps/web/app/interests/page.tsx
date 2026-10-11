"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { MemberNav } from "../../components/member-nav";
import { useAccount } from "../../components/account";
import {
  api,
  candidatePhotoUrl,
  type Connections,
} from "../../../../packages/generated-clients/client";
export default function Interests() {
  const { account } = useAccount();
  const [data, setData] = useState<Connections | null>(null);
  const [tab, setTab] = useState<"incoming" | "sent" | "matches" | "blocked">(
    "incoming",
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!account) return;
    const c = new AbortController();
    api("/connections", "get", undefined, c.signal)
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [account, attempt]);
  async function action(
    id: string,
    action: "like" | "pass" | "block" | "unblock" | "unmatch",
  ) {
    setBusy(true);
    setError("");
    try {
      const result = await api("/connections/action", "post", {
        targetId: id,
        action,
      });
      setNotice(
        result.matched
          ? "It’s mutual. You are now matched."
          : "Your choice has been saved.",
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
        <Link className="text-link" href="/discover">
          Discover people ↗
        </Link>
      </header>
      <MemberNav />
      <p className="eyebrow section-label">HELLOS THAT GO BOTH WAYS</p>
      <h1>
        A little spark.
        <br />
        <em>A mutual choice.</em>
      </h1>
      <div className="tabs" role="tablist" aria-label="Connections">
        {(["incoming", "sent", "matches", "blocked"] as const).map((t) => (
          <button
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "" : "secondary"}
            key={t}
            onClick={() => setTab(t)}
          >
            {t === "incoming"
              ? "For you"
              : t === "sent"
                ? "Sent"
                : t === "matches"
                  ? "Matches"
                  : "Blocked"}
            {data ? ` · ${data[t].length}` : ""}
          </button>
        ))}
      </div>
      {error && (
        <div className="form-error" role="alert">
          <p>{error}</p>
          <button
            className="secondary"
            onClick={() => {
              setError("");
              setAttempt((a) => a + 1);
            }}
          >
            Retry
          </button>
          <Link href="/verify" className="text-link">
            Verification
          </Link>
        </div>
      )}
      {notice && (
        <p className="success-notice" role="status">
          {notice}
        </p>
      )}
      {!data && !error && <p role="status">Loading your connections…</p>}
      {data && (
        <section role="tabpanel">
          {data[tab].length === 0 ? (
            <div className="empty-state">
              <span aria-hidden="true">♡</span>
              <h2>
                {tab === "matches"
                  ? "Your next chapter starts with a hello."
                  : "Nothing here, for now."}
              </h2>
              <p>Connections happen at their own pace.</p>
              <Link href="/discover" className="button">
                Explore profiles →
              </Link>
            </div>
          ) : tab === "blocked" ? (
            data.blocked.map((p) => (
              <div className="service" key={p.id}>
                <span>Blocked account · {p.id.slice(0, 8)}</span>
                <button
                  disabled={busy}
                  className="secondary"
                  onClick={() => action(p.id, "unblock")}
                >
                  Unblock
                </button>
              </div>
            ))
          ) : (
            <div className="connections-list">
              {data[tab].map((entry) => (
                <article key={entry.person.id} className="connection-card">
                  <Image
                    unoptimized
                    src={candidatePhotoUrl(entry.person.id)}
                    alt={`${entry.person.displayName}'s camera photo`}
                    width={100}
                    height={130}
                  />
                  <div>
                    <p className="eyebrow">{entry.person.city}</p>
                    <h2>
                      {entry.person.displayName}
                      {entry.person.age == null
                        ? " · Age private"
                        : `, ${entry.person.age}`}
                    </h2>
                    {"superLike" in entry && entry.superLike && (
                      <p className="badge">Super like ✦</p>
                    )}
                    <p>
                      {"introduction" in entry
                        ? entry.introduction ||
                          "Interested in getting to know you."
                        : entry.person.intent}
                    </p>
                    {tab === "incoming" && (
                      <div className="camera-actions">
                        <button
                          disabled={busy}
                          onClick={() => action(entry.person.id, "like")}
                        >
                          Accept interest
                        </button>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => action(entry.person.id, "pass")}
                        >
                          Decline
                        </button>
                      </div>
                    )}
                    {tab === "matches" && (
                      <>
                        {"id" in entry && (
                          <Link
                            className="button"
                            href={`/inbox?match=${entry.id}`}
                          >
                            Open conversation →
                          </Link>
                        )}
                        <p className="muted">
                          Matched{" "}
                          {"matchedAt" in entry
                            ? new Date(entry.matchedAt).toLocaleDateString()
                            : ""}
                          . Your conversation is private to this match.
                        </p>
                        <button
                          disabled={busy}
                          className="secondary"
                          onClick={() => action(entry.person.id, "unmatch")}
                        >
                          Unmatch
                        </button>
                      </>
                    )}
                    <button
                      disabled={busy}
                      className="secondary"
                      onClick={() => action(entry.person.id, "block")}
                    >
                      Block
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
