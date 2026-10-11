import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  ApiError,
  body,
  json,
  pool,
} from "../../packages/shared-config/runtime.ts";
import { access, conversation } from "./access.ts";
type Plan = {
  id: string;
  conversation_id: string;
  proposer_id: string;
  venue: string;
  address: string;
  scheduled_at: Date;
  budget_inr: number;
  status: string;
};
const view = (p: Plan) => ({
  id: p.id,
  conversationId: p.conversation_id,
  proposerId: p.proposer_id,
  venue: p.venue,
  address: p.address,
  scheduledAt: p.scheduled_at.toISOString(),
  budgetInr: p.budget_inr,
  status: p.status,
});
const future = z.iso
  .datetime({ offset: true })
  .refine(
    (v) =>
      new Date(v).getTime() > Date.now() &&
      new Date(v).getTime() < Date.now() + 365 * 86400000,
    "Choose a future time within a year.",
  );
export async function datesRoute(
  req: IncomingMessage,
  res: ServerResponse,
  actor: string,
  url: URL,
) {
  if (!url.pathname.startsWith("/api/v1/dates")) return false;
  if (url.pathname === "/api/v1/dates" && req.method === "GET") {
    const id = z.string().uuid().parse(url.searchParams.get("conversationId"));
    await access(actor, id);
    const result = await pool.query<Plan>(
      "SELECT * FROM date_plans WHERE conversation_id=$1 ORDER BY scheduled_at DESC LIMIT 50",
      [id],
    );
    json(res, 200, { plans: result.rows.map(view) });
    return true;
  }
  if (url.pathname === "/api/v1/dates" && req.method === "POST") {
    const input = z
      .object({
        conversationId: z.string().uuid(),
        venue: z.string().trim().min(2).max(120),
        address: z.string().trim().min(5).max(300),
        scheduledAt: future,
        budgetInr: z.number().int().min(0).max(100000),
        publicVenue: z.literal(true),
      })
      .strict()
      .parse(await body(req));
    const m = await access(actor, input.conversationId);
    await conversation(m);
    const result = await pool.query<Plan>(
      "INSERT INTO date_plans(id,conversation_id,proposer_id,venue,address,scheduled_at,budget_inr) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6) RETURNING *",
      [
        m.id,
        actor,
        input.venue,
        input.address,
        input.scheduledAt,
        input.budgetInr,
      ],
    );
    json(res, 200, view(result.rows[0]));
    return true;
  }
  if (url.pathname === "/api/v1/dates/action" && req.method === "POST") {
    const input = z
      .object({
        planId: z.string().uuid(),
        action: z.enum(["accept", "decline", "cancel", "reschedule"]),
        scheduledAt: future.optional(),
      })
      .strict()
      .parse(await body(req));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<Plan>(
        "SELECT * FROM date_plans WHERE id=$1 FOR UPDATE",
        [input.planId],
      );
      if (!result.rowCount)
        throw new ApiError(404, "PLAN_NOT_FOUND", "This plan is unavailable.");
      const plan = result.rows[0];
      await access(actor, plan.conversation_id);
      if (
        ["accept", "decline"].includes(input.action) &&
        (plan.proposer_id === actor || plan.status !== "invited")
      )
        throw new ApiError(
          409,
          "INVITE_NOT_PENDING",
          "Only the invited person can respond to a pending plan.",
        );
      if (["cancelled", "declined"].includes(plan.status))
        throw new ApiError(
          409,
          "PLAN_ENDED",
          "Create a new plan to start again.",
        );
      if (input.action === "reschedule" && !input.scheduledAt)
        throw new ApiError(422, "DATE_REQUIRED", "Choose a new time.");
      const state =
        input.action === "accept"
          ? "accepted"
          : input.action === "decline"
            ? "declined"
            : input.action === "cancel"
              ? "cancelled"
              : "invited";
      const updated = await client.query<Plan>(
        "UPDATE date_plans SET status=$1,scheduled_at=coalesce($2,scheduled_at),proposer_id=CASE WHEN $3='reschedule' THEN $4 ELSE proposer_id END WHERE id=$5 RETURNING *",
        [
          state,
          input.action === "reschedule" ? input.scheduledAt : null,
          input.action,
          actor,
          plan.id,
        ],
      );
      await client.query("COMMIT");
      json(res, 200, view(updated.rows[0]));
      return true;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  if (url.pathname === "/api/v1/dates/check-in" && req.method === "POST") {
    const input = z
      .object({
        planId: z.string().uuid(),
        state: z.enum(["arrived", "safe", "left", "feedback"]),
        note: z.string().max(1000),
      })
      .strict()
      .parse(await body(req));
    const result = await pool.query<Plan>(
      "SELECT p.* FROM date_plans p JOIN conversations c ON c.id=p.conversation_id WHERE p.id=$1 AND (c.first_id=$2 OR c.second_id=$2)",
      [input.planId, actor],
    );
    if (!result.rowCount)
      throw new ApiError(404, "PLAN_NOT_FOUND", "Plan unavailable.");
    if (result.rows[0].status !== "accepted")
      throw new ApiError(
        409,
        "PLAN_NOT_ACCEPTED",
        "Accept a plan before checking in.",
      );
    await pool.query(
      "INSERT INTO date_checkins(id,plan_id,account_id,state,note) VALUES(gen_random_uuid(),$1,$2,$3,$4)",
      [input.planId, actor, input.state, input.note],
    );
    json(res, 200, { ok: true });
    return true;
  }
  throw new ApiError(404, "NOT_FOUND", "Date plan route unavailable.");
}
