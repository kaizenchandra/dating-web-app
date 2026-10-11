import { serviceToken } from "../../packages/shared-config/service-auth.ts";
import { randomUUID, createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  ApiError,
  body,
  json,
  pool,
} from "../../packages/shared-config/runtime.ts";
import { verifyPaymentSignature } from "./payment-signature.ts";
import {
  plans,
  features,
  tierIds,
  credentialsReady,
  discoveryModes,
  type Tier,
} from "./plans.ts";
import { subscriptionSchema, capturedPass } from "./payment-state.ts";
async function provider(path: string, data?: unknown): Promise<unknown> {
  if (!credentialsReady())
    throw new ApiError(
      503,
      "PAYMENTS_NOT_CONFIGURED",
      "Razorpay credentials and signed webhook configuration are required. Local checkout requires test keys.",
    );
  const r = await fetch("https://api.razorpay.com/v1/" + path, {
    method: data ? "POST" : "GET",
    headers: {
      authorization:
        "Basic " +
        Buffer.from(
          process.env.RAZORPAY_KEY_ID + ":" + process.env.RAZORPAY_KEY_SECRET,
        ).toString("base64"),
      "content-type": "application/json",
    },
    body: data ? JSON.stringify(data) : undefined,
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok)
    throw new ApiError(
      503,
      "PAYMENT_PROVIDER_UNAVAILABLE",
      "Razorpay could not confirm this request. Reconcile before creating another checkout.",
    );
  return r.json();
}
function checkoutView(row: Record<string, unknown>) {
  return {
    id: row.id,
    keyId: process.env.RAZORPAY_KEY_ID,
    tier: row.tier,
    billingMode: row.billing_mode,
    amount: row.amount,
    currency: row.currency,
    ...(row.billing_mode === "recurring"
      ? { subscriptionId: row.provider_id }
      : { orderId: row.provider_order_id }),
  };
}
export async function syncSubscription(id: string) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const row = (
      await c.query("SELECT * FROM subscriptions WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (!row) {
      await c.query("COMMIT");
      return;
    }
    if (row.billing_mode === "month_pass") {
      if (!row.provider_order_id) {
        await c.query("COMMIT");
        return;
      }
      const order = z
        .object({
          id: z.string(),
          amount: z.number().int(),
          currency: z.string(),
        })
        .parse(
          await provider("orders/" + encodeURIComponent(row.provider_order_id)),
        );
      if (
        order.id !== row.provider_order_id ||
        order.amount !== row.amount ||
        order.currency !== row.currency
      )
        throw new ApiError(
          409,
          "ORDER_MISMATCH",
          "Order requires operator review.",
        );
      const payments = z
        .object({ items: z.array(z.unknown()) })
        .parse(
          await provider(
            "orders/" + encodeURIComponent(row.provider_order_id) + "/payments",
          ),
        );
      let confirmed: ReturnType<typeof capturedPass> | undefined;
      for (const raw of payments.items) {
        const state = capturedPass(
          raw,
          row.provider_order_id,
          row.amount,
          row.currency,
        );
        if (state.paid || state.payment.id === row.provider_payment_id)
          confirmed = state;
      }
      const deleted = (
        await c.query("SELECT 1 FROM deleted_accounts WHERE account_id=$1", [
          row.account_id,
        ])
      ).rowCount;
      if (confirmed?.paid) {
        // First canonical capture starts one fixed period. Replays never extend it.
        await c.query(
          "UPDATE subscriptions SET paid_at=coalesce(paid_at,now()),current_end=coalesce(current_end,now()+interval '30 days'),provider_payment_id=$2,paid_count=1,status=CASE WHEN $3 THEN 'cancelled' WHEN coalesce(current_end,now()+interval '30 days')<=now() THEN 'expired' ELSE 'active' END,updated_at=now() WHERE id=$1",
          [id, confirmed.payment.id, !!deleted],
        );
      } else if (row.paid_count > 0) {
        await c.query(
          "UPDATE subscriptions SET status='halted',updated_at=now() WHERE id=$1",
          [id],
        );
      }
    } else if (row.provider_id) {
      const remote = subscriptionSchema.parse(
        await provider("subscriptions/" + encodeURIComponent(row.provider_id)),
      );
      const expected =
        row.provider_plan_id ||
        plans().find((p) => p.id === row.tier)?.providerPlanId;
      if (
        !expected ||
        remote.id !== row.provider_id ||
        remote.plan_id !== expected
      )
        throw new ApiError(
          409,
          "PLAN_MISMATCH",
          "Subscription plan requires operator review.",
        );
      await c.query(
        "UPDATE subscriptions SET status=$2,current_end=to_timestamp($3),paid_count=$4,provider_plan_id=$5,updated_at=now() WHERE id=$1",
        [id, remote.status, remote.current_end, remote.paid_count, expected],
      );
    }
    await c.query("UPDATE subscriptions SET updated_at=now() WHERE id=$1", [
      id,
    ]);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function cancelForDeletion(accountId: string) {
  const rows = await pool.query(
    "SELECT * FROM subscriptions WHERE account_id=$1 AND billing_mode='recurring' AND status NOT IN ('cancelled','completed','expired')",
    [accountId],
  );
  for (const row of rows.rows) {
    if (!row.provider_id)
      throw new ApiError(
        503,
        "PAYMENT_RECONCILIATION_REQUIRED",
        "Unconfirmed recurring checkout needs operator reconciliation before deletion.",
      );
    await provider(
      "subscriptions/" + encodeURIComponent(row.provider_id) + "/cancel",
      { cancel_at_cycle_end: 0 },
    );
    await syncSubscription(row.id);
  }
  await pool.query(
    "INSERT INTO deleted_accounts(account_id) VALUES($1) ON CONFLICT DO NOTHING",
    [accountId],
  );
}
async function entitlement(id: string) {
  const r = await pool.query(
    "SELECT tier FROM subscriptions WHERE account_id=$1 AND paid_count>0 AND current_end>now() AND status IN ('active','cancelled','completed') AND NOT EXISTS(SELECT 1 FROM deleted_accounts WHERE account_id=$1) ORDER BY created_at DESC LIMIT 1",
    [id],
  );
  const tier = (r.rows[0]?.tier || null) as Tier | null;
  return {
    active: !!tier,
    features: features(tier),
    tier,
    discoveryModes: tier ? discoveryModes[tier] : [],
  };
}
export async function commerceRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
) {
  if (path === "/internal/entitlement" && req.method === "GET") {
    const id = z
      .string()
      .uuid()
      .parse(new URL(req.url!, "http://ops").searchParams.get("accountId"));
    json(res, 200, await entitlement(id));
    return true;
  }
  if (path === "/api/v1/webhooks/razorpay" && req.method === "POST") {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 32768)
        throw new ApiError(413, "BODY_TOO_LARGE", "Webhook is too large.");
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks);
    if (
      !verifyPaymentSignature(
        raw,
        String(req.headers["x-razorpay-signature"] || ""),
        process.env.RAZORPAY_WEBHOOK_SECRET || "",
      )
    )
      throw new ApiError(
        401,
        "WEBHOOK_SIGNATURE_INVALID",
        "Webhook signature is invalid.",
      );
    const eventId = z
        .string()
        .min(1)
        .max(200)
        .parse(req.headers["x-razorpay-event-id"]),
      digest = createHash("sha256").update(raw).digest("hex");
    await pool.query(
      "INSERT INTO payment_events(id,payload_hash,applied) VALUES($1,$2,false) ON CONFLICT DO NOTHING",
      [eventId, digest],
    );
    const existing = (
      await pool.query(
        "SELECT payload_hash,applied FROM payment_events WHERE id=$1",
        [eventId],
      )
    ).rows[0];
    if (existing.payload_hash !== digest)
      throw new ApiError(409, "EVENT_CONFLICT", "Event ID content mismatch.");
    if (existing.applied) {
      json(res, 200, { ok: true });
      return true;
    }
    const event = z
      .object({
        event: z.string(),
        payload: z.object({
          subscription: z
            .object({ entity: z.object({ id: z.string() }) })
            .optional(),
          payment: z
            .object({
              entity: z.object({ order_id: z.string().nullable().optional() }),
            })
            .optional(),
          order: z.object({ entity: z.object({ id: z.string() }) }).optional(),
          refund: z
            .object({ entity: z.object({ payment_id: z.string() }) })
            .optional(),
        }),
      })
      .parse(JSON.parse(raw.toString()));
    const subscription = event.payload.subscription?.entity.id,
      order =
        event.payload.order?.entity.id ||
        event.payload.payment?.entity.order_id;
    if (subscription || order || event.payload.refund) {
      const row = subscription
        ? await pool.query(
            "SELECT id FROM subscriptions WHERE provider_id=$1",
            [subscription],
          )
        : order
          ? await pool.query(
              "SELECT id FROM subscriptions WHERE provider_order_id=$1",
              [order],
            )
          : await pool.query(
              "SELECT id FROM subscriptions WHERE provider_payment_id=$1",
              [event.payload.refund!.entity.payment_id],
            );
      if (!row.rowCount)
        throw new ApiError(
          503,
          "PURCHASE_PENDING",
          "Purchase mapping is not available. Retry delivery.",
        );
      await syncSubscription(row.rows[0].id);
    }
    await pool.query("UPDATE payment_events SET applied=true WHERE id=$1", [
      eventId,
    ]);
    json(res, 200, { ok: true });
    return true;
  }
  if (!path.startsWith("/api/v1/premium")) return false;
  const response = await fetch("http://identity:4000/internal/identity/me", {
    headers: {
      authorization: `Bearer ${serviceToken("identity")}`,
      cookie: req.headers.cookie || "",
    },
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok)
    throw new ApiError(
      response.status,
      "SESSION_REQUIRED",
      "Sign in to manage membership.",
    );
  const actor = await response.json();
  if (path === "/api/v1/premium" && req.method === "GET") {
    const rows = await pool.query(
      'SELECT id,status,tier,billing_mode AS "billingMode",amount,current_end AS "currentEnd",created_at AS "createdAt" FROM subscriptions WHERE account_id=$1 ORDER BY created_at DESC LIMIT 20',
      [actor.id],
    );
    json(res, 200, {
      configured: credentialsReady(),
      mode: credentialsReady()
        ? process.env.RAZORPAY_KEY_ID!.startsWith("rzp_test_")
          ? "provider test"
          : "live"
        : "unconfigured",
      ...(await entitlement(actor.id)),
      plans: plans().map((p) => ({
        id: p.id,
        name: p.name,
        priceInr: p.priceInr,
        currency: p.currency,
        discoveryModes: p.discoveryModes,
        features: p.features,
        recurringReady: credentialsReady() && !!p.providerPlanId,
        passReady: credentialsReady(),
      })),
      subscriptions: rows.rows,
    });
    return true;
  }
  if (path === "/api/v1/premium/checkout" && req.method === "POST") {
    const input = z
      .object({
        tier: z.enum(tierIds),
        billingMode: z.enum(["recurring", "month_pass"]),
      })
      .strict()
      .parse(await body(req));
    if (!actor.identityApproved)
      throw new ApiError(
        403,
        "VERIFICATION_REQUIRED",
        "Complete verification before subscribing.",
      );
    if (!credentialsReady())
      throw new ApiError(
        503,
        "PAYMENTS_NOT_CONFIGURED",
        "Checkout unavailable: Razorpay credentials and signed webhooks are required.",
      );
    const plan = plans().find((p) => p.id === input.tier)!;
    if (input.billingMode === "recurring") {
      if (!plan.providerPlanId)
        throw new ApiError(
          503,
          "PLAN_NOT_CONFIGURED",
          "This recurring plan is not configured.",
        );
      const remote = z
        .object({
          period: z.literal("monthly"),
          interval: z.literal(1),
          item: z.object({
            amount: z.number().int(),
            currency: z.literal("INR"),
          }),
        })
        .parse(
          await provider("plans/" + encodeURIComponent(plan.providerPlanId)),
        );
      if (remote.item.amount !== plan.amount)
        throw new ApiError(
          409,
          "PRICE_MISMATCH",
          "Provider pricing differs from the displayed plan. Contact support.",
        );
    }
    const id = randomUUID(),
      c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [actor.id]);
      await c.query(
        "UPDATE subscriptions SET status='expired' WHERE account_id=$1 AND billing_mode='month_pass' AND current_end<=now() AND status='active'",
        [actor.id],
      );
      const existing = (
        await c.query(
          "SELECT * FROM subscriptions WHERE account_id=$1 AND (status NOT IN ('cancelled','completed','expired') OR (paid_count>0 AND current_end>now())) ORDER BY created_at DESC LIMIT 1",
          [actor.id],
        )
      ).rows[0];
      if (existing) {
        await c.query("COMMIT");
        if (
          existing.tier === input.tier &&
          existing.billing_mode === input.billingMode &&
          ["created", "authenticated"].includes(existing.status) &&
          (existing.provider_id || existing.provider_order_id)
        ) {
          json(res, 200, checkoutView(existing));
          return true;
        }
        throw new ApiError(
          409,
          "SUBSCRIPTION_EXISTS",
          "A membership or unconfirmed checkout already exists. Resume it or wait for the current paid period to end before changing plans.",
        );
      }
      await c.query(
        "INSERT INTO subscriptions(id,account_id,tier,billing_mode,amount,currency,provider_plan_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          id,
          actor.id,
          plan.id,
          input.billingMode,
          plan.amount,
          plan.currency,
          input.billingMode === "recurring" ? plan.providerPlanId : null,
        ],
      );
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    try {
      if (input.billingMode === "recurring") {
        const remote = subscriptionSchema.parse(
          await provider("subscriptions", {
            plan_id: plan.providerPlanId,
            total_count: 12,
            quantity: 1,
            customer_notify: true,
            notes: { raahi_checkout: id, tier: plan.id },
          }),
        );
        if (remote.plan_id !== plan.providerPlanId)
          throw Error("Provider plan mismatch");
        await pool.query(
          "UPDATE subscriptions SET provider_id=$2,status=$3 WHERE id=$1",
          [id, remote.id, remote.status],
        );
      } else {
        const remote = z
          .object({
            id: z.string().regex(/^order_[A-Za-z0-9]+$/),
            amount: z.number().int(),
            currency: z.string(),
          })
          .parse(
            await provider("orders", {
              amount: plan.amount,
              currency: "INR",
              receipt: id,
              partial_payment: false,
              notes: { raahi_checkout: id, tier: plan.id },
            }),
          );
        if (remote.amount !== plan.amount || remote.currency !== "INR")
          throw Error("Provider amount mismatch");
        await pool.query(
          "UPDATE subscriptions SET provider_order_id=$2,status='created' WHERE id=$1",
          [id, remote.id],
        );
      }
      json(
        res,
        200,
        checkoutView(
          (await pool.query("SELECT * FROM subscriptions WHERE id=$1", [id]))
            .rows[0],
        ),
      );
      return true;
    } catch {
      await pool.query(
        "UPDATE subscriptions SET status='needs_reconciliation' WHERE id=$1",
        [id],
      );
      throw new ApiError(
        503,
        "CHECKOUT_UNCONFIRMED",
        "Checkout creation was interrupted. Reconcile this purchase with support; no membership has been granted.",
      );
    }
  }
  if (path === "/api/v1/premium/verify" && req.method === "POST") {
    const input = z
      .object({
        id: z.string().uuid(),
        paymentId: z.string().regex(/^pay_[A-Za-z0-9]+$/),
        signature: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .parse(await body(req));
    const row = (
      await pool.query(
        "SELECT * FROM subscriptions WHERE id=$1 AND account_id=$2",
        [input.id, actor.id],
      )
    ).rows[0];
    if (!row)
      throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "Purchase not found.");
    const reference =
      row.billing_mode === "recurring"
        ? row.provider_id
        : row.provider_order_id;
    if (!reference)
      throw new ApiError(
        409,
        "CHECKOUT_UNCONFIRMED",
        "Provider reference is unavailable.",
      );
    const signed =
      row.billing_mode === "recurring"
        ? input.paymentId + "|" + reference
        : reference + "|" + input.paymentId;
    if (
      !verifyPaymentSignature(
        Buffer.from(signed),
        input.signature,
        process.env.RAZORPAY_KEY_SECRET || "",
      )
    )
      throw new ApiError(
        401,
        "PAYMENT_SIGNATURE_INVALID",
        "Payment confirmation could not be verified.",
      );
    await syncSubscription(row.id);
    json(res, 200, { ok: true, active: (await entitlement(actor.id)).active });
    return true;
  }
  if (path === "/api/v1/premium/reconcile" && req.method === "POST") {
    const rows = await pool.query(
      "SELECT id FROM subscriptions WHERE account_id=$1 AND (provider_id IS NOT NULL OR provider_order_id IS NOT NULL) ORDER BY created_at DESC LIMIT 20",
      [actor.id],
    );
    for (const row of rows.rows) await syncSubscription(row.id);
    json(res, 200, { ok: true });
    return true;
  }
  if (path === "/api/v1/premium/cancel" && req.method === "POST") {
    const { id } = z
      .object({ id: z.string().uuid() })
      .strict()
      .parse(await body(req));
    const row = (
      await pool.query(
        "SELECT * FROM subscriptions WHERE id=$1 AND account_id=$2",
        [id, actor.id],
      )
    ).rows[0];
    if (!row?.provider_id || row.billing_mode !== "recurring")
      throw new ApiError(
        404,
        "SUBSCRIPTION_NOT_FOUND",
        "No recurring subscription to cancel.",
      );
    if (!["cancelled", "completed", "expired"].includes(row.status))
      await provider(
        "subscriptions/" + encodeURIComponent(row.provider_id) + "/cancel",
        { cancel_at_cycle_end: 1 },
      );
    await syncSubscription(id);
    json(res, 200, { ok: true });
    return true;
  }
  if (path === "/api/v1/premium/refund" && req.method === "POST") {
    const input = z
      .object({
        id: z.string().uuid(),
        reason: z.string().trim().min(10).max(1000),
      })
      .strict()
      .parse(await body(req));
    if (
      !(
        await pool.query(
          "SELECT id FROM subscriptions WHERE id=$1 AND account_id=$2",
          [input.id, actor.id],
        )
      ).rowCount
    )
      throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "Purchase not found.");
    const id = randomUUID();
    await pool.query(
      "INSERT INTO refund_requests(id,account_id,subscription_id,reason) VALUES($1,$2,$3,$4)",
      [id, actor.id, input.id, input.reason],
    );
    json(res, 200, { id, status: "submitted" });
    return true;
  }
  throw new ApiError(
    404,
    "NOT_FOUND",
    "This membership action is not available.",
  );
}
