"use client";
import Link from "next/link";
import { EventBuddy } from "../../components/event-buddy";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../../packages/generated-clients/client";
import { MemberNav } from "../../components/member-nav";
type Group = {
  id: string;
  name: string;
  city: string;
  interest: string;
  description: string;
  hostId: string;
  joined: boolean;
  members: number;
  host: boolean;
};
type Event = {
  id: string;
  title: string;
  kind: string;
  venue: string;
  startsAt: string;
  capacity: number;
  registrations: number;
  registered: boolean;
  status: string;
};
type Message = {
  id: string;
  senderId: string;
  name: string;
  text: string;
  createdAt: string;
};
export default function Communities() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [host, setHost] = useState("");
  const [selected, setSelected] = useState<Group | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const pending = useRef<{
    groupId: string;
    clientMessageId: string;
    text: string;
  } | null>(null);
  useEffect(() => {
    const c = new AbortController();
    api("/communities", "get", undefined, c.signal)
      .then((r) => {
        setGroups(r.groups);
        setHost(r.hostStatus);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [attempt]);
  useEffect(() => {
    if (!selected) return;
    const c = new AbortController();
    const refresh = () =>
      Promise.all([
        api("/communities/events", "get", undefined, c.signal, {
          groupId: selected.id,
        }),
        api("/communities/messages", "get", undefined, c.signal, {
          groupId: selected.id,
        }),
      ])
        .then(([e, m]) => {
          setEvents(e.events);
          setMessages(m.messages);
        })
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        });
    void refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      c.abort();
      clearInterval(timer);
    };
  }, [selected, attempt]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setAttempt((x) => x + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !text.trim()) return;
    if (
      !pending.current ||
      pending.current.text !== text.trim() ||
      pending.current.groupId !== selected.id
    )
      pending.current = {
        groupId: selected.id,
        clientMessageId: crypto.randomUUID(),
        text: text.trim(),
      };
    await action(async () => {
      await api("/communities/messages", "post", pending.current!);
      pending.current = null;
      setText("");
    });
  }
  return (
    <main className="account-page">
      <MemberNav />
      <p className="eyebrow section-label">FIND YOUR KIND OF COMPANY</p>
      <h1>
        Shared interests.
        <br />
        <em>New possibilities.</em>
      </h1>
      <p>
        Small communities, public venues and space to get to know each other.
        Host review is separate from identity verification and does not
        guarantee an event’s safety.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <button
        className="secondary"
        onClick={() => {
          setError("");
          setAttempt((x) => x + 1);
        }}
      >
        Refresh communities
      </button>
      <div className="settings-grid">
        {groups.map((g) => (
          <article className="status-card" key={g.id}>
            <p className="eyebrow">
              {g.city} · {g.interest}
            </p>
            <h2>{g.name}</h2>
            <p>{g.description}</p>
            <p>{g.members}/30 members · Human-reviewed host</p>
            {g.joined ? (
              <>
                <button
                  onClick={() => {
                    setSelected(g);
                    setError("");
                    setMessages([]);
                    setEvents([]);
                  }}
                >
                  Open community
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await api("/communities/membership", "post", {
                        groupId: g.id,
                        action: g.host ? "close" : "leave",
                      });
                      if (selected?.id === g.id) setSelected(null);
                      setNotice(
                        g.host
                          ? "Community closed."
                          : "You left the community.",
                      );
                    })
                  }
                >
                  {g.host ? "Close community" : "Leave community"}
                </button>
              </>
            ) : (
              <button
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await api("/communities/membership", "post", {
                      groupId: g.id,
                      action: "join",
                    });
                    setNotice("You joined " + g.name);
                  })
                }
              >
                Join community
              </button>
            )}
            <p>
              <Link href={`/safety?target=${g.hostId}&kind=offline`}>
                Report host or event
              </Link>
            </p>
          </article>
        ))}
      </div>
      {host && groups.length === 0 && (
        <p>No communities yet. Approved hosts can create the first one.</p>
      )}
      {selected && (
        <section className="status-card">
          <header>
            <h2>{selected.name}</h2>
            <button className="secondary" onClick={() => setSelected(null)}>
              Close room
            </button>
          </header>
          <h3>Events & activities</h3>
          {events.length === 0 && <p>No events scheduled.</p>}
          {events.map((e) => (
            <article className="status-card" key={e.id}>
              <p className="eyebrow">
                {e.kind} · {e.status}
              </p>
              <h3>{e.title}</h3>
              <p>
                {e.venue} · {new Date(e.startsAt).toLocaleString()}
              </p>
              <p>
                {e.registrations}/{e.capacity} registered
              </p>
              <button
                disabled={busy || e.status !== "open"}
                onClick={() =>
                  action(async () => {
                    await api("/communities/events/action", "post", {
                      eventId: e.id,
                      action: e.registered ? "withdraw" : "register",
                    });
                    setNotice(
                      e.registered
                        ? "Registration cancelled."
                        : "You are registered.",
                    );
                  })
                }
              >
                {e.registered ? "Cancel registration" : "Register"}
              </button>
              {e.registered && e.status === "open" && (
                <EventBuddy eventId={e.id} />
              )}
              {selected.host && (
                <button
                  className="secondary"
                  disabled={busy || e.status !== "open"}
                  onClick={() =>
                    action(async () => {
                      await api("/communities/events/action", "post", {
                        eventId: e.id,
                        action: "cancel",
                      });
                    })
                  }
                >
                  Cancel event
                </button>
              )}
            </article>
          ))}
          {selected.host && (
            <details>
              <summary>Create an event</summary>
              <form
                className="form-stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void action(async () => {
                    await api("/communities/events", "post", {
                      groupId: selected.id,
                      title: String(f.get("title")),
                      kind: String(f.get("kind")) as
                        "meetup" | "activity" | "speed introductions",
                      venue: String(f.get("venue")),
                      startsAt: new Date(
                        String(f.get("startsAt")),
                      ).toISOString(),
                      capacity: Number(f.get("capacity")),
                    });
                    setNotice("Event created.");
                  });
                }}
              >
                <label htmlFor="event-title">Event title</label>
                <input
                  id="event-title"
                  name="title"
                  minLength={3}
                  maxLength={100}
                  required
                />
                <label htmlFor="event-kind">Format</label>
                <select id="event-kind" name="kind">
                  <option value="meetup">Meetup</option>
                  <option value="activity">Group activity</option>
                  <option value="speed introductions">
                    Hosted offline speed introductions
                  </option>
                </select>
                <label htmlFor="event-venue">Public venue and address</label>
                <input
                  id="event-venue"
                  name="venue"
                  minLength={5}
                  maxLength={300}
                  required
                />
                <label htmlFor="event-time">Date and time</label>
                <input
                  id="event-time"
                  name="startsAt"
                  type="datetime-local"
                  required
                />
                <label htmlFor="capacity">Places</label>
                <input
                  id="capacity"
                  name="capacity"
                  type="number"
                  min={2}
                  max={30}
                  defaultValue={12}
                  required
                />
                <button disabled={busy}>Create event</button>
              </form>
            </details>
          )}
          <h3>Community conversation</h3>
          <p className="muted">
            Messages refresh every three seconds. A blocked relationship locks
            room access; you can still leave from the community card.
          </p>
          <div
            className="group-history"
            role="log"
            aria-label="Community messages"
          >
            {messages.map((m) => (
              <article key={m.id}>
                <strong>{m.name}</strong>
                <p>{m.text}</p>
                <Link href={`/safety?target=${m.senderId}&kind=profile`}>
                  Report member
                </Link>
                <button
                  className="text-link"
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await api("/connections/action", "post", {
                        targetId: m.senderId,
                        action: "block",
                      });
                      setSelected(null);
                      setNotice(
                        "Member blocked. Shared room access is now restricted.",
                      );
                    })
                  }
                >
                  Block member
                </button>
              </article>
            ))}
          </div>
          <form className="form-stack" onSubmit={send}>
            <label htmlFor="group-text">Community message</label>
            <textarea
              id="group-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={2000}
              required
            />
            <button disabled={busy || !text.trim()}>Send to community</button>
          </form>
        </section>
      )}
      {host === "approved" ? (
        <details className="status-card">
          <summary>Create a community</summary>
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void action(async () => {
                await api("/communities", "post", {
                  name: String(f.get("name")),
                  city: String(f.get("city")),
                  interest: String(f.get("interest")),
                  description: String(f.get("description")),
                });
                setNotice("Community created.");
              });
            }}
          >
            <label htmlFor="group-name">Community name</label>
            <input
              id="group-name"
              name="name"
              minLength={3}
              maxLength={80}
              required
            />
            <label htmlFor="group-city">City</label>
            <input
              id="group-city"
              name="city"
              minLength={2}
              maxLength={60}
              required
            />
            <label htmlFor="group-interest">Shared interest</label>
            <input
              id="group-interest"
              name="interest"
              minLength={2}
              maxLength={60}
              required
            />
            <label htmlFor="group-description">About your community</label>
            <textarea
              id="group-description"
              name="description"
              minLength={10}
              maxLength={1000}
              required
            />
            <button disabled={busy}>Create community</button>
          </form>
        </details>
      ) : (
        <form
          className="status-card form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void action(async () => {
              await api("/communities/host", "post", {
                reason: String(f.get("reason")),
              });
              setNotice("Host application received for human review.");
            });
          }}
        >
          <h2>Make room for others</h2>
          <p>Host application: {host || "Loading…"}</p>
          <label htmlFor="host-reason">Your hosting experience and plans</label>
          <textarea
            id="host-reason"
            name="reason"
            minLength={10}
            maxLength={1000}
            required
          />
          <button disabled={busy || host === "pending"}>Apply to host</button>
        </form>
      )}
    </main>
  );
}
