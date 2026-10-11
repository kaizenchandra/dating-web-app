"use client";
import Link from "next/link";
import { ChatImage, ImageComposer } from "../../components/chat-image";
import {
  loadOutbox,
  saveOutbox,
  removeOutbox,
  configureOutbox,
} from "../../lib/message-outbox";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "../../components/account";
import { MemberNav } from "../../components/member-nav";
import {
  api,
  socketUrl,
  type Inbox,
  type Message,
} from "../../../../packages/generated-clients/client";
type Pending = {
  conversationId: string;
  clientMessageId: string;
  text: string;
  imageId?: string;
  failed: boolean;
  createdAt: number;
};
function merge(before: Message[], incoming: Message[]) {
  const map = new Map(before.map((m) => [m.id, m]));
  for (const m of incoming) map.set(m.id, m);
  return [...map.values()].sort((a, b) => a.sequence - b.sequence);
}
export default function InboxPage() {
  const { account } = useAccount();
  const [inbox, setInbox] = useState<Inbox["conversations"]>([]);
  const [selected, setSelected] = useState("");
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [cursor, setCursor] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [saveRetries, setSaveRetries] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [storageBusy, setStorageBusy] = useState(false);
  const inFlight = useRef(new Set<string>());
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Connecting…");
  const [locked, setLocked] = useState(false);
  const [shareReadReceipt, setShareReadReceipt] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [incomingCall, setIncomingCall] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const keepPosition = useRef(false);
  useEffect(() => {
    if (!account) return;
    let active = true;
    loadOutbox(account.id)
      .then((result) => {
        if (active) {
          setSaveRetries(result.enabled);
          setPending((old) => {
            const byId = new Map(old.map((x) => [x.clientMessageId, x]));
            for (const item of result.messages)
              if (!byId.has(item.clientMessageId))
                byId.set(item.clientMessageId, { ...item, failed: true });
            return [...byId.values()];
          });
          setStorageReady(true);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setStorageReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, [account]);

  useEffect(() => {
    if (!account) return;
    const c = new AbortController();
    api("/account/wellbeing", "get", undefined, c.signal)
      .then((p) => setShareReadReceipt(p.readReceipts))
      .catch(() => {});
    return () => c.abort();
  }, [account]);
  useEffect(() => {
    if (!account) return;
    const c = new AbortController();
    api("/inbox", "get", undefined, c.signal)
      .then((result) => {
        setInbox(result.conversations);
        const requested = new URLSearchParams(window.location.search).get(
          "match",
        );
        if (requested && result.conversations.some((x) => x.id === requested))
          setSelected(requested);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    api("/notifications", "get", undefined, c.signal)
      .then((r) =>
        setNotificationCount(r.notifications.filter((n) => !n.read).length),
      )
      .catch(() => {});
    return () => c.abort();
  }, [account, attempt]);
  useEffect(() => {
    if (!selected || !account) return;
    const c = new AbortController();
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let retry = 0;
    async function load() {
      try {
        const result = await api("/messages", "get", undefined, c.signal, {
          conversationId: selected,
        });
        if (stopped) return;
        setMessages((old) => ({
          ...old,
          [selected]: merge(old[selected] || [], result.messages),
        }));
        setCursor(result.nextCursor);
        const last = result.messages.at(-1);
        if (last) {
          await api(
            "/messages/receipt",
            "post",
            {
              conversationId: selected,
              throughSequence: last.sequence,
              shareReadReceipt,
            },
            c.signal,
          );
          setInbox((old) =>
            old.map((x) => (x.id === selected ? { ...x, unread: 0 } : x)),
          );
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError((e as Error).message);
        setLocked(true);
        setMessages((old) => ({ ...old, [selected]: [] }));
      }
    }
    function connect() {
      if (stopped) return;
      socket = new WebSocket(socketUrl());
      socket.onopen = () => {
        retry = 0;
        setStatus("Live");
        setLocked(false);
        socket!.send(
          JSON.stringify({ type: "subscribe", conversationId: selected }),
        );
      };
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.version === 1 && data.conversationId === selected)
            void load();
        } catch {
          /* malformed hints never alter message state */
        }
      };
      socket.onclose = (event) => {
        if (stopped) return;
        if (event.code === 1008) {
          setLocked(true);
          setMessages((old) => ({ ...old, [selected]: [] }));
          setStatus("Access unavailable");
          setError("This conversation is unavailable or your session expired.");
          return;
        }
        setStatus("Reconnecting…");
        timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 10000));
      };
      socket.onerror = () => setStatus("Connection interrupted");
    }
    void load();
    connect();
    return () => {
      stopped = true;
      c.abort();
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }, [selected, account, shareReadReceipt, attempt]);
  useEffect(() => {
    if (keepPosition.current) {
      keepPosition.current = false;
      return;
    }
    scroll.current?.scrollTo({
      top: scroll.current.scrollHeight,
      behavior: "instant",
    });
  }, [messages, pending, selected]);
  useEffect(() => {
    if (!selected || !account || locked) return;
    const c = new AbortController();
    const poll = () =>
      api("/calls", "get", undefined, c.signal, { conversationId: selected })
        .then((r) =>
          setIncomingCall(
            r.calls.some(
              (x) => x.status === "ringing" && x.calleeId === account.id,
            ),
          ),
        )
        .catch(() => {
          if (!c.signal.aborted) setIncomingCall(false);
        });
    void poll();
    const timer = setInterval(poll, 3000);
    return () => {
      c.abort();
      clearInterval(timer);
    };
  }, [selected, account, locked]);
  async function send(item: Pending) {
    if (!account || inFlight.current.has(item.clientMessageId)) return;
    inFlight.current.add(item.clientMessageId);
    setError("");
    try {
      if (saveRetries) await saveOutbox(account.id, item);
      const saved = await api("/messages", "post", {
        conversationId: item.conversationId,
        clientMessageId: item.clientMessageId,
        text: item.text,
        ...(item.imageId ? { imageId: item.imageId } : {}),
      });
      setMessages((old) => ({
        ...old,
        [item.conversationId]: merge(old[item.conversationId] || [], [saved]),
      }));
      if (saveRetries)
        await removeOutbox(item.clientMessageId).catch(() =>
          setError(
            "Message stored by the server. A browser retry copy could not be cleared; repeating it will use the same message ID.",
          ),
        );
      setPending((old) =>
        old.filter((p) => p.clientMessageId !== item.clientMessageId),
      );
    } catch (e) {
      setPending((old) =>
        old.map((p) =>
          p.clientMessageId === item.clientMessageId
            ? { ...p, failed: true }
            : p,
        ),
      );
      setError((e as Error).message);
    } finally {
      inFlight.current.delete(item.clientMessageId);
    }
  }
  async function older() {
    if (!cursor) return;
    keepPosition.current = true;
    try {
      const result = await api("/messages", "get", undefined, undefined, {
        conversationId: selected,
        before: String(cursor),
      });
      setMessages((old) => ({
        ...old,
        [selected]: merge(old[selected] || [], result.messages),
      }));
      setCursor(result.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const conversation = inbox.find((x) => x.id === selected);
  const history = messages[selected] || [];
  return (
    <main className="account-page inbox-page">
      <header>
        <Link href="/" className="brand">
          raahi<span>✳</span>
        </Link>
        <button
          className="secondary"
          onClick={async () => {
            try {
              await api("/notifications/read", "post", {});
              setNotificationCount(0);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Updates · {notificationCount}{" "}
          <span className="sr-only">Mark notifications read</span>
        </button>
      </header>
      <MemberNav />
      <div className="inbox-heading">
        <p className="eyebrow">LET THE CONVERSATION UNFOLD</p>
        <h1>
          Your <em>hellos.</em>
        </h1>
      </div>
      <details className="status-card">
        <summary>Unsent messages on this browser</summary>
        <p className="muted">
          Opt in only on a private device. Saved retries are encrypted in this
          browser, retained for up to 72 hours, and restored for you to review
          before sending. Signing out, deleting your account or disabling this
          option clears them. Browser storage can be cleared by your browser;
          this is not a backup.
        </p>
        <label className="check">
          <input
            type="checkbox"
            disabled={!storageReady || storageBusy}
            checked={saveRetries}
            onChange={async (e) => {
              if (!account) return;
              const enabled = e.target.checked;
              setStorageBusy(true);
              setError("");
              try {
                await configureOutbox(account.id, enabled);
                setSaveRetries(enabled);
                if (enabled)
                  for (const item of pending)
                    await saveOutbox(account.id, item);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setStorageBusy(false);
              }
            }}
          />
          Keep unsent messages when I close this browser
        </label>
        {storageBusy && <p role="status">Saving browser retry preference…</p>}
        <p>{pending.length} messages awaiting local confirmation.</p>
        {account && (
          <button
            className="secondary"
            onClick={async () => {
              try {
                if (account) await configureOutbox(account.id, false);
                setSaveRetries(false);
                setPending([]);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Discard all unsent messages
          </button>
        )}
      </details>
      {error && (
        <div className="form-error" role="alert">
          {error}
          <button
            className="secondary"
            onClick={() => {
              setError("");
              setLocked(false);
              setAttempt((a) => a + 1);
            }}
          >
            Retry connection
          </button>
        </div>
      )}
      <div className={`inbox-shell ${selected ? "conversation-open" : ""}`}>
        <aside className="conversation-list">
          <h2>Your matches</h2>
          {inbox.length === 0 ? (
            <p className="muted">
              A mutual match opens a conversation.{" "}
              <Link className="text-link" href="/discover">
                Discover people
              </Link>
            </p>
          ) : (
            inbox.map((c) => (
              <button
                className={
                  selected === c.id ? "conversation selected" : "conversation"
                }
                key={c.id}
                onClick={() => {
                  setSelected(c.id);
                  setLocked(false);
                  setError("");
                  setCursor(null);
                }}
              >
                <span className="avatar-letter">
                  {c.person.displayName.slice(0, 1)}
                </span>
                <span>
                  <strong>{c.person.displayName}</strong>
                  <small>{c.person.city}</small>
                </span>
                {c.unread > 0 && <span className="unread">{c.unread}</span>}
              </button>
            ))
          )}
        </aside>
        <section className="chat-panel" aria-label="Conversation">
          {conversation ? (
            <>
              <div className="chat-header">
                <button
                  className="secondary back-inbox"
                  onClick={() => setSelected("")}
                >
                  ← Matches
                </button>
                <div>
                  <h2>{conversation.person.displayName}</h2>
                  <span className="muted" role="status">
                    {status}
                  </span>
                </div>
                <button
                  className="secondary"
                  onClick={async () => {
                    try {
                      await api("/connections/action", "post", {
                        targetId: conversation.person.id,
                        action: "block",
                      });
                      setLocked(true);
                      setMessages((old) => ({ ...old, [selected]: [] }));
                      setError("Blocked. Communication access has ended.");
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Block
                </button>
              </div>
              <div className="conversation-tools">
                <Link href={`/calls?match=${selected}`}>
                  Video / audio call
                </Link>
                <Link href={`/dates?match=${selected}`}>Plan a date</Link>
                <Link href={`/safety?target=${conversation.person.id}`}>
                  Report profile
                </Link>
              </div>
              {incomingCall && !locked && (
                <p role="status" className="local-notice">
                  Incoming call invitation.{" "}
                  <Link href={`/calls?match=${selected}`}>
                    Review call invitation
                  </Link>
                </p>
              )}
              <div className="chat-safety">
                Keep your pace. Never share OTPs or send money to someone you
                haven’t met.
              </div>
              <div
                className="message-history"
                ref={scroll}
                role="log"
                aria-label="Message history"
                aria-live="polite"
              >
                {cursor && (
                  <button className="secondary" onClick={older}>
                    Load earlier messages
                  </button>
                )}
                {history.length === 0 && !locked && (
                  <div className="chat-empty">
                    <span>♡</span>
                    <h2>A good conversation starts with curiosity.</h2>
                    <p>Ask about something that caught your attention.</p>
                  </div>
                )}
                {history.map((m) => (
                  <div
                    className={`message ${m.senderId === account?.id ? "mine" : "theirs"}`}
                    key={m.id}
                  >
                    {m.imageId && <ChatImage id={m.imageId} />}
                    {m.text && <p>{m.text}</p>}
                    <Link href={`/safety?kind=message&subject=${m.id}`}>
                      Report message
                    </Link>
                    <small>
                      {new Date(m.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {m.senderId === account?.id
                        ? ` · ${m.readAt ? "Read" : m.deliveredAt ? "Delivered" : "Stored"}`
                        : ""}
                    </small>
                  </div>
                ))}
                {pending
                  .filter((p) => p.conversationId === selected)
                  .map((p) => (
                    <div
                      className="message mine pending"
                      key={p.clientMessageId}
                    >
                      {p.imageId && <ChatImage id={p.imageId} />}
                      <p>{p.text}</p>
                      <small>{p.failed ? "Not confirmed" : "Sending…"}</small>
                      <button
                        className="secondary"
                        onClick={async () => {
                          try {
                            await removeOutbox(p.clientMessageId);
                            setPending((old) =>
                              old.filter(
                                (x) => x.clientMessageId !== p.clientMessageId,
                              ),
                            );
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        Discard unsent message
                      </button>
                      {p.failed && (
                        <button
                          className="secondary"
                          disabled={locked}
                          onClick={() => {
                            setPending((old) =>
                              old.map((x) =>
                                x.clientMessageId === p.clientMessageId
                                  ? { ...x, failed: false }
                                  : x,
                              ),
                            );
                            void send(p);
                          }}
                        >
                          Retry this message
                        </button>
                      )}
                    </div>
                  ))}
              </div>
              <form
                className="message-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!text.trim() || locked || !storageReady || storageBusy)
                    return;
                  const item = {
                    conversationId: selected,
                    clientMessageId: crypto.randomUUID(),
                    text: text.trim(),
                    failed: false,
                    createdAt: Date.now(),
                  };
                  setPending((old) => [...old, item]);
                  setText("");
                  void send(item);
                }}
              >
                <label className="sr-only" htmlFor="message">
                  Message
                </label>
                <textarea
                  id="message"
                  rows={2}
                  maxLength={2000}
                  required
                  disabled={locked}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={
                    locked
                      ? "Conversation unavailable"
                      : "Start with something real…"
                  }
                />
                <button
                  disabled={
                    locked || !text.trim() || !storageReady || storageBusy
                  }
                >
                  Send →
                </button>
              </form>
              <ImageComposer
                key={selected}
                conversationId={selected}
                disabled={locked || !storageReady || storageBusy}
                onSend={(imageId, caption) => {
                  const item = {
                    conversationId: selected,
                    clientMessageId: crypto.randomUUID(),
                    text: caption,
                    imageId,
                    failed: false,
                    createdAt: Date.now(),
                  };
                  setPending((old) => [...old, item]);
                  void send(item);
                }}
              />
              <label className="check read-receipts">
                <input
                  type="checkbox"
                  checked={shareReadReceipt}
                  onChange={(e) => setShareReadReceipt(e.target.checked)}
                />{" "}
                Share read receipts in this session
              </label>
            </>
          ) : (
            <div className="chat-empty">
              <span>✳</span>
              <h2>Make a little room for conversation.</h2>
              <p>Choose a match to say hello.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
