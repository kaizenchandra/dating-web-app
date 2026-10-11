"use client";
import Link from "next/link";
import { ConnectionAllowance } from "../../components/connection-allowance";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../../packages/generated-clients/client";
import { MemberNav } from "../../components/member-nav";
import type { paths } from "../../../../packages/generated-clients/schema";
import { loadCheckout, openCheckout } from "../../lib/razorpay";
type Membership =
  paths["/premium"]["get"]["responses"][200]["content"]["application/json"];
type Tier = "gold" | "diamond" | "platinum";
type Billing = "recurring" | "month_pass";
const labels: Record<string, string> = {
  interests: "Shared interests first",
  intent: "Shared intentions first",
  city: "Same city first",
};
export default function Premium() {
  const checkoutRef = useRef<{ close(): void } | null>(null);
  const [billing, setBilling] = useState<Billing>("recurring");
  useEffect(() => () => checkoutRef.current?.close(), []);
  const [data, setData] = useState<Membership | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const c = new AbortController();
    api("/premium", "get", undefined, c.signal)
      .then((r) => setData(r))
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [attempt]);
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
  async function purchase(tier: Tier, billingMode: Billing) {
    await action(async () => {
      setNotice("");
      const constructor = await loadCheckout();
      const checkout = await api("/premium/checkout", "post", {
        tier,
        billingMode,
      });
      const result = await openCheckout(constructor, checkout, (instance) => {
        checkoutRef.current = instance;
      });
      checkoutRef.current = null;
      if (!result) {
        setNotice(
          "Checkout closed. No payment is confirmed here. Resume the same plan or reconcile if you paid.",
        );
        return;
      }
      const verified = await api("/premium/verify", "post", {
        id: checkout.id,
        paymentId: result.razorpay_payment_id,
        signature: result.razorpay_signature,
      });
      setNotice(
        verified.active
          ? "Your paid membership is confirmed."
          : "Payment is awaiting provider confirmation. Use Restore / reconcile to check again.",
      );
    });
  }
  return (
    <main className="account-page">
      <MemberNav />
      <p className="eyebrow section-label">GO AT YOUR OWN PACE</p>
      <h1>
        A little more
        <br />
        <em>room to wander.</em>
      </h1>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!data && !error && <p>Loading membership…</p>}
      <button
        className="secondary"
        onClick={() => {
          setError("");
          setAttempt((x) => x + 1);
        }}
      >
        Refresh membership
      </button>
      <p>
        Matching, messages, calls and essential safety and privacy controls stay
        free. Hide your age, city and approximate distance in{" "}
        <Link href="/profile">profile visibility settings</Link>. Free accounts
        receive 3 direct introductions per day; allowances reset at midnight
        IST.
      </p>
      <label htmlFor="billing">Billing option</label>
      <select
        id="billing"
        value={billing}
        disabled={busy}
        onChange={(e) => setBilling(e.target.value as Billing)}
      >
        <option value="recurring">Monthly renewal · up to 12 cycles</option>
        <option value="month_pass">30-day pass · no automatic renewal</option>
      </select>
      <p className="muted">
        {billing === "recurring"
          ? "UPI AutoPay and cards are offered by Razorpay where enabled. Cancel renewal from this page."
          : "Pay once through Razorpay with UPI or cards. Apple Pay appears only for eligible merchant accounts, wallets and devices; it is unavailable in test mode."}
      </p>
      {data && !data.configured && (
        <aside className="local-notice">
          Checkout unavailable: Razorpay credentials and signed webhook
          configuration are required. No payment or membership is simulated.
        </aside>
      )}
      {data?.configured && (
        <p>
          {data.mode} environment · membership activates after server
          confirmation.
        </p>
      )}
      <div className="settings-grid">
        {data?.plans.map((plan) => (
          <section className="status-card" key={plan.id}>
            <p className="eyebrow">RAAHI MEMBERSHIP</p>
            <h2>{plan.name}</h2>
            <p>
              ₹{plan.priceInr.toLocaleString("en-IN")} /{" "}
              {billing === "recurring" ? "month" : "30 days"}
            </p>
            <ul>
              <li>{plan.features.superLikesPerDay} super likes per day</li>
              <li>
                {plan.features.directIntroductionsPerDay} direct introductions
                per day
              </li>
              <li>Unlimited matched messaging</li>
              {plan.discoveryModes.map((mode) => (
                <li key={mode}>{labels[mode]}</li>
              ))}
            </ul>
            <p className="muted">
              Choose how eligible profiles are ordered within each discovery
              page. Your filters and boundaries still apply.
            </p>
            <button
              disabled={
                busy ||
                data.active ||
                !(billing === "recurring"
                  ? plan.recurringReady
                  : plan.passReady)
              }
              onClick={() => void purchase(plan.id, billing)}
            >
              {busy ? "Please wait…" : `Choose ${plan.name}`}
            </button>
            {data.configured &&
              billing === "recurring" &&
              !plan.recurringReady && (
                <p>Monthly provider plan setup is pending.</p>
              )}
          </section>
        ))}
      </div>
      {data?.active && (
        <section className="status-card">
          <h2>Your {data.tier} membership is active</h2>
          <p>Use your discovery ordering:</p>
          <ul>
            {data.discoveryModes.map((mode) => (
              <li key={mode}>
                <Link href={`/discover?ranking=${mode}`}>{labels[mode]}</Link>
              </li>
            ))}
          </ul>
          <p>
            To change tiers, cancel renewal and wait for your paid period to
            end.
          </p>
        </section>
      )}
      <ConnectionAllowance revision={attempt} />
      <h2>Your membership</h2>
      <button
        disabled={busy}
        onClick={() =>
          action(async () => {
            await api("/premium/reconcile", "post", {});
            setNotice("Checked your subscriptions with the provider.");
          })
        }
      >
        Restore / reconcile membership
      </button>
      {data?.subscriptions.map((s) => (
        <section className="status-card" key={s.id}>
          <p>
            {s.tier} · {s.status} · ₹{(s.amount / 100).toLocaleString("en-IN")}{" "}
            ·{" "}
            {s.currentEnd
              ? "Period ends " + new Date(s.currentEnd).toLocaleDateString()
              : "No confirmed paid period"}
          </p>
          {s.billingMode === "recurring" && (
            <button
              className="secondary"
              disabled={
                busy || ["cancelled", "completed", "expired"].includes(s.status)
              }
              onClick={() =>
                action(async () => {
                  await api("/premium/cancel", "post", { id: s.id });
                  setNotice(
                    "Cancellation submitted to the provider. Refresh to see confirmed status.",
                  );
                })
              }
            >
              Cancel renewal
            </button>
          )}
          {s.billingMode === "month_pass" && <p>No automatic renewal.</p>}
          {["created", "authenticated"].includes(s.status) && (
            <button
              disabled={busy || !data.configured}
              onClick={() => void purchase(s.tier, s.billingMode)}
            >
              Resume checkout
            </button>
          )}
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const reason = String(
                new FormData(e.currentTarget).get("reason"),
              );
              void action(async () => {
                const r = await api("/premium/refund", "post", {
                  id: s.id,
                  reason,
                });
                setNotice(
                  "Refund request " +
                    r.id +
                    " received for review. A refund has not yet been issued.",
                );
              });
            }}
          >
            <label htmlFor={s.id}>Refund request reason</label>
            <textarea
              id={s.id}
              name="reason"
              minLength={10}
              maxLength={1000}
              required
            />
            <button disabled={busy}>Request refund review</button>
          </form>
        </section>
      ))}
    </main>
  );
}
