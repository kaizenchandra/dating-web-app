import { callConfiguration } from "./turn.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  ApiError,
  body,
  json,
  pool,
  redis,
} from "../../packages/shared-config/runtime.ts";
import { access, conversation, internal } from "./access.ts";
type Call = {
  id: string;
  conversation_id: string;
  caller_id: string;
  callee_id: string;
  status: string;
  created_at: Date;
};
function view(c: Call) {
  return {
    id: c.id,
    conversationId: c.conversation_id,
    callerId: c.caller_id,
    calleeId: c.callee_id,
    status: c.status,
    createdAt: c.created_at.toISOString(),
  };
}
export async function callAccess(actor: string, id: string) {
  const result = await pool.query<Call>(
    "SELECT * FROM calls WHERE id=$1 AND (caller_id=$2 OR callee_id=$2)",
    [id, actor],
  );
  if (!result.rowCount)
    throw new ApiError(404, "CALL_NOT_FOUND", "This call is unavailable.");
  const call = result.rows[0];
  await access(actor, call.conversation_id);
  return call;
}
export async function callsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  actor: string,
  url: URL,
) {
  if (!url.pathname.startsWith("/api/v1/calls")) return false;
  if (url.pathname === "/api/v1/calls/config" && req.method === "GET") {
    const id = z.string().uuid().parse(url.searchParams.get("conversationId"));
    await access(actor, id);
    try {
      json(res, 200, callConfiguration());
    } catch {
      throw new ApiError(
        503,
        "TURN_CONFIGURATION_INVALID",
        "Calling relay configuration is unavailable. Please retry later.",
      );
    }

    return true;
  }
  if (url.pathname === "/api/v1/calls" && req.method === "GET") {
    const id = z.string().uuid().parse(url.searchParams.get("conversationId"));
    await access(actor, id);
    await pool.query(
      "UPDATE calls SET status='ended',ended_at=now() WHERE conversation_id=$1 AND ((status='ringing' AND created_at<now()-interval '60 seconds') OR (status='accepted' AND created_at<now()-interval '2 hours'))",
      [id],
    );
    const result = await pool.query<Call>(
      "SELECT * FROM calls WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 10",
      [id],
    );
    json(res, 200, { calls: result.rows.map(view) });
    return true;
  }
  if (url.pathname === "/api/v1/calls" && req.method === "POST") {
    const input = z
      .object({ conversationId: z.string().uuid() })
      .strict()
      .parse(await body(req));
    const m = await access(actor, input.conversationId);
    const recipient = m.firstId === actor ? m.secondId : m.firstId;
    const availability = await internal<{ acceptsCalls: boolean }>(
      "identity",
      "/internal/availability?id=" + recipient,
    );
    if (!availability.acceptsCalls)
      throw new ApiError(
        409,
        "CALL_UNAVAILABLE",
        "This person is not available for a call right now.",
      );
    await conversation(m);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [actor]);
      await client.query(
        "UPDATE calls SET status='ended',ended_at=now() WHERE conversation_id=$1 AND status='ringing' AND created_at<now()-interval '60 seconds'",
        [m.id],
      );
      const recent = await client.query(
        "SELECT count(*)::int AS n FROM calls WHERE caller_id=$1 AND created_at>now()-interval '10 minutes'",
        [actor],
      );
      if (recent.rows[0].n >= 3)
        throw new ApiError(
          429,
          "CALL_RATE_LIMIT",
          "Please wait before requesting another call.",
        );
      const result = await client.query<Call>(
        "INSERT INTO calls(id,conversation_id,caller_id,callee_id) VALUES(gen_random_uuid(),$1,$2,$3) ON CONFLICT(conversation_id) WHERE status IN ('ringing','accepted') DO NOTHING RETURNING *",
        [m.id, actor, m.firstId === actor ? m.secondId : m.firstId],
      );
      if (!result.rowCount)
        throw new ApiError(
          409,
          "CALL_EXISTS",
          "A call request is already active.",
        );
      await client.query("COMMIT");
      json(res, 200, view(result.rows[0]));
      return true;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  if (url.pathname === "/api/v1/calls/action" && req.method === "POST") {
    const input = z
      .object({
        callId: z.string().uuid(),
        action: z.enum(["accept", "decline", "end"]),
      })
      .strict()
      .parse(await body(req));
    const call = await callAccess(actor, input.callId);
    if (input.action !== "end" && call.callee_id !== actor)
      throw new ApiError(
        403,
        "CALLEE_REQUIRED",
        "Only the invited person can respond.",
      );
    const state =
      input.action === "accept"
        ? "accepted"
        : input.action === "decline"
          ? "declined"
          : "ended";
    const result = await pool.query<Call>(
      "UPDATE calls SET status=$1,ended_at=CASE WHEN $1='accepted' THEN NULL ELSE now() END WHERE id=$2 AND (status='ringing' AND created_at>now()-interval '60 seconds' OR ($3='end' AND status='accepted')) RETURNING *",
      [state, call.id, input.action],
    );
    if (!result.rowCount)
      throw new ApiError(
        409,
        "CALL_STATE_CHANGED",
        "This call is no longer waiting for that action.",
      );
    json(res, 200, view(result.rows[0]));
    return true;
  }
  if (url.pathname === "/api/v1/calls/feedback" && req.method === "POST") {
    const input = z
      .object({
        callId: z.string().uuid(),
        experience: z.enum(["comfortable", "technical_issue", "unsafe"]),
        note: z.string().max(1000),
      })
      .strict()
      .parse(await body(req));
    const call = await pool.query(
      "SELECT id FROM calls WHERE id=$1 AND (caller_id=$2 OR callee_id=$2)",
      [input.callId, actor],
    );
    if (!call.rowCount)
      throw new ApiError(404, "CALL_NOT_FOUND", "Call unavailable.");
    await pool.query(
      "INSERT INTO call_feedback(call_id,account_id,experience,note) VALUES($1,$2,$3,$4) ON CONFLICT(call_id,account_id) DO UPDATE SET experience=$3,note=$4",
      [input.callId, actor, input.experience, input.note],
    );
    json(res, 200, { ok: true });
    return true;
  }
  throw new ApiError(404, "NOT_FOUND", "Call route unavailable.");
}
export const signalSchema = z
  .object({
    type: z.literal("call.signal"),
    callId: z.string().uuid(),
    description: z
      .object({
        type: z.enum(["offer", "answer"]),
        sdp: z.string().max(100000),
      })
      .optional(),
    candidate: z
      .object({
        candidate: z.string().max(3000),
        sdpMid: z.string().nullable().optional(),
        sdpMLineIndex: z.number().nullable().optional(),
        usernameFragment: z.string().nullable().optional(),
      })
      .optional(),
  })
  .strict();
export async function relaySignal(
  actor: string,
  input: z.infer<typeof signalSchema>,
) {
  const call = await callAccess(actor, input.callId);
  if (call.status !== "accepted")
    throw new ApiError(
      403,
      "CALL_NOT_ACCEPTED",
      "Both people must accept before media signalling.",
    );
  await redis.publish(
    "raahi:call-signals",
    JSON.stringify({
      ...input,
      version: 1,
      senderId: actor,
      targetId: call.caller_id === actor ? call.callee_id : call.caller_id,
      conversationId: call.conversation_id,
    }),
  );
}
