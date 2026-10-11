"use client";
import { useEffect, useState } from "react";
import { api } from "../../../packages/generated-clients/client";
type Pairing = {
  members: { id: string; name: string }[];
  invitations: {
    id: string;
    inviterId: string;
    inviteeId: string;
    status: string;
  }[];
  selfId: string;
};
export function EventBuddy({ eventId }: { eventId: string }) {
  const [data, setData] = useState<Pairing | null>(null);
  const [target, setTarget] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    const refresh = () =>
      api("/communities/pairing", "get", undefined, c.signal, { eventId })
        .then(setData)
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        });
    void refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      c.abort();
      clearInterval(timer);
    };
  }, [eventId, attempt]);
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
  return (
    <details>
      <summary>Find an event buddy</summary>
      <p>
        Invite a registered member to attend together. Both people choose; this
        does not create a dating match or unlock private messages.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <label htmlFor={eventId + "buddy"}>Registered member</label>
      <select
        id={eventId + "buddy"}
        value={target}
        onChange={(e) => setTarget(e.target.value)}
      >
        <option value="">Choose a member</option>
        {data?.members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <button
        disabled={busy || !target}
        onClick={() =>
          action(async () => {
            await api("/communities/pairing", "post", {
              eventId,
              targetId: target,
            });
            setNotice("Buddy invitation sent.");
          })
        }
      >
        Invite event buddy
      </button>
      {data?.invitations.map((i) => (
        <section key={i.id}>
          <p>
            {data.members.find(
              (m) =>
                m.id ===
                (i.inviterId === data.selfId ? i.inviteeId : i.inviterId),
            )?.name || "Event member"}{" "}
            · {i.status}
          </p>
          {i.status === "pending" && i.inviteeId === data.selfId && (
            <>
              <button
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await api("/communities/pairing/action", "post", {
                      id: i.id,
                      action: "accept",
                    });
                    setNotice("You are event buddies.");
                  })
                }
              >
                Accept buddy invitation
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await api("/communities/pairing/action", "post", {
                      id: i.id,
                      action: "decline",
                    });
                  })
                }
              >
                Decline buddy invitation
              </button>
            </>
          )}
          {["pending", "accepted"].includes(i.status) && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                action(async () => {
                  await api("/communities/pairing/action", "post", {
                    id: i.id,
                    action: "cancel",
                  });
                })
              }
            >
              Cancel buddy arrangement
            </button>
          )}
        </section>
      ))}
    </details>
  );
}
