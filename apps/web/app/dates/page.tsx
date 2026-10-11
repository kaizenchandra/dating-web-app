"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccount } from "../../components/account";
import {
  api,
  type DatePlan,
} from "../../../../packages/generated-clients/client";
export default function Dates() {
  const { account } = useAccount();
  const [match, setMatch] = useState("");
  const [plans, setPlans] = useState<DatePlan[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [share, setShare] = useState<DatePlan | null>(null);
  useEffect(() => {
    if (!account) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const id = new URLSearchParams(window.location.search).get("match") || "";
    Promise.resolve().then(() => setMatch(id));
    async function load() {
      if (!id) return;
      try {
        const result = await api("/dates", "get", undefined, undefined, {
          conversationId: id,
        });
        if (!stopped) setPlans(result.plans);
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      } finally {
        if (!stopped) timer = setTimeout(load, 2500);
      }
    }
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [account, attempt]);
  async function act(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setNotice(message);
      setAttempt((x) => x + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const shareText = share
    ? `My date plan\n${share.venue}\n${share.address}\n${new Date(share.scheduledAt).toLocaleString()}\nBudget: ₹${share.budgetInr}\nI’ll check in with you directly. Raahi does not send emergency alerts.`
    : "";
  return (
    <main className="account-page">
      <header>
        <Link
          href={match ? `/inbox?match=${match}` : "/inbox"}
          className="text-link"
        >
          ← Back to conversation
        </Link>
        <span className="brand">
          raahi<span>✳</span>
        </span>
      </header>
      <p className="eyebrow section-label">
        A LITTLE PLAN FOR A REAL-WORLD HELLO
      </p>
      <h1>
        Make it
        <br />
        <em>a date.</em>
      </h1>
      <p className="intro">
        A coffee. A bookshop. A walk somewhere public. Agree on the details
        together, and keep someone you trust in the loop.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="success-notice">
          {notice}
        </p>
      )}
      <div className="settings-grid">
        <form
          className="auth-card form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            act(
              () =>
                api("/dates", "post", {
                  conversationId: match,
                  venue: String(f.get("venue")),
                  address: String(f.get("address")),
                  scheduledAt: new Date(String(f.get("time"))).toISOString(),
                  budgetInr: Number(f.get("budget")),
                  publicVenue: true,
                }),
              "Your date invitation is saved. It needs their acceptance.",
            );
          }}
        >
          <h2>Suggest a plan.</h2>
          <label htmlFor="venue">Public venue</label>
          <input
            id="venue"
            name="venue"
            required
            minLength={2}
            maxLength={120}
            placeholder="A café, museum or public park"
          />
          <label htmlFor="address">Venue address</label>
          <input
            id="address"
            name="address"
            required
            minLength={5}
            maxLength={300}
          />
          <label htmlFor="time">Date & time</label>
          <input id="time" name="time" type="datetime-local" required />
          <label htmlFor="budget">Approximate budget · INR</label>
          <input
            id="budget"
            name="budget"
            type="number"
            min={0}
            max={100000}
            defaultValue={500}
            required
          />
          <label className="check">
            <input type="checkbox" required /> This is a public venue, not a
            private home.
          </label>
          <button disabled={busy || !match}>
            {busy ? "Saving…" : "Send date invitation"}
          </button>
          <p className="muted">
            Venue details are supplied by members and have not been
            independently verified.
          </p>
        </form>
        <section>
          <h2>Your plans</h2>
          {plans.length === 0 && (
            <p className="muted">Your first plan starts here.</p>
          )}
          {plans.map((plan) => (
            <article className="status-card" key={plan.id}>
              <p className="eyebrow">{plan.status}</p>
              <h2>{plan.venue}</h2>
              <p>
                {plan.address}
                <br />
                {new Date(plan.scheduledAt).toLocaleString()}
                <br />
                Approx. ₹{plan.budgetInr.toLocaleString("en-IN")}
              </p>
              {plan.status === "invited" && plan.proposerId !== account?.id && (
                <div className="camera-actions">
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(
                        () =>
                          api("/dates/action", "post", {
                            planId: plan.id,
                            action: "accept",
                          }),
                        "Plan accepted.",
                      )
                    }
                  >
                    Accept plan
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      act(
                        () =>
                          api("/dates/action", "post", {
                            planId: plan.id,
                            action: "decline",
                          }),
                        "Plan declined.",
                      )
                    }
                  >
                    Decline plan
                  </button>
                </div>
              )}
              {["invited", "accepted"].includes(plan.status) && (
                <>
                  <form
                    className="form-stack"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      act(
                        () =>
                          api("/dates/action", "post", {
                            planId: plan.id,
                            action: "reschedule",
                            scheduledAt: new Date(
                              String(f.get("newTime")),
                            ).toISOString(),
                          }),
                        "New time proposed. The other person needs to accept again.",
                      );
                    }}
                  >
                    <label htmlFor={plan.id + "time"}>
                      Suggest another time
                    </label>
                    <input
                      id={plan.id + "time"}
                      name="newTime"
                      type="datetime-local"
                      required
                    />
                    <button className="secondary" disabled={busy}>
                      Propose new time
                    </button>
                  </form>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      act(
                        () =>
                          api("/dates/action", "post", {
                            planId: plan.id,
                            action: "cancel",
                          }),
                        "Plan cancelled.",
                      )
                    }
                  >
                    Cancel plan
                  </button>
                </>
              )}
              {plan.status === "accepted" && (
                <>
                  <button disabled={busy} onClick={() => setShare(plan)}>
                    Preview trusted-contact share
                  </button>
                  <p className="muted">
                    Check-ins are saved privately. No contact or emergency
                    service is automatically notified.
                  </p>
                  <div className="camera-actions">
                    {(["arrived", "safe", "left"] as const).map((state) => (
                      <button
                        className="secondary"
                        disabled={busy}
                        key={state}
                        onClick={() =>
                          act(
                            () =>
                              api("/dates/check-in", "post", {
                                planId: plan.id,
                                state,
                                note: "",
                              }),
                            `Your “${state}” check-in is saved.`,
                          )
                        }
                      >
                        {state === "arrived"
                          ? "I’ve arrived"
                          : state === "safe"
                            ? "I’m safe"
                            : "I’ve left"}
                      </button>
                    ))}
                  </div>
                  <form
                    className="form-stack"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      act(
                        () =>
                          api("/dates/check-in", "post", {
                            planId: plan.id,
                            state: "feedback",
                            note: String(f.get("note")),
                          }),
                        "Your private date feedback is saved.",
                      );
                    }}
                  >
                    <label htmlFor={plan.id + "feedback"}>
                      Private post-date feedback
                    </label>
                    <textarea
                      id={plan.id + "feedback"}
                      name="note"
                      maxLength={1000}
                    />
                    <button className="secondary" disabled={busy}>
                      Save feedback
                    </button>
                  </form>
                </>
              )}
            </article>
          ))}
        </section>
      </div>
      {share && (
        <section
          className="status-card"
          aria-label="Trusted contact share preview"
        >
          <h2>Review before you share.</h2>
          <pre className="share-preview">{shareText}</pre>
          <div className="camera-actions">
            <button
              onClick={async () => {
                try {
                  const canShare = typeof navigator.share === "function";
                  if (canShare)
                    await navigator.share({
                      title: "My Raahi date plan",
                      text: shareText,
                    });
                  else await navigator.clipboard.writeText(shareText);
                  setNotice(
                    canShare
                      ? "Device sharing completed; confirm delivery with your contact."
                      : "Plan copied. Send it to your trusted contact yourself.",
                  );
                  setShare(null);
                } catch (e) {
                  if ((e as Error).name !== "AbortError")
                    setError(
                      "Sharing was unavailable. Select and copy the preview text.",
                    );
                }
              }}
            >
              Share with my device
            </button>
            <button className="secondary" onClick={() => setShare(null)}>
              Cancel sharing
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
