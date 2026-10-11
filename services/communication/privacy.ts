import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { pool, json, ApiError } from "../../packages/shared-config/runtime.ts";
export async function privacyRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
) {
  if (
    !["/internal/privacy/delete", "/internal/privacy/export"].includes(
      url.pathname,
    )
  )
    return false;
  const id = z.string().uuid().parse(url.searchParams.get("accountId"));
  if (url.pathname.endsWith("/export") && req.method === "GET") {
    const messages = await pool.query(
      "SELECT m.id,m.conversation_id,m.text,m.created_at,(SELECT encode(data,'base64') FROM message_images WHERE id=m.image_id) AS image_jpeg_base64 FROM messages m WHERE m.sender_id=$1 ORDER BY m.sequence",
      [id],
    );
    const calls = await pool.query(
      "SELECT id,conversation_id,status,created_at,ended_at FROM calls WHERE caller_id=$1 OR callee_id=$1",
      [id],
    );
    const plans = await pool.query(
      "SELECT id,venue,address,scheduled_at,budget_inr,status FROM date_plans WHERE proposer_id=$1",
      [id],
    );
    const checkins = await pool.query(
      "SELECT plan_id,state,note,created_at FROM date_checkins WHERE account_id=$1",
      [id],
    );
    const groups = await pool.query(
      "SELECT group_id,text,created_at FROM group_messages WHERE sender_id=$1",
      [id],
    );
    const feedback = await pool.query(
      "SELECT call_id,experience,note,created_at FROM call_feedback WHERE account_id=$1",
      [id],
    );
    json(res, 200, {
      groupMessages: groups.rows,
      callFeedback: feedback.rows,
      sentMessages: messages.rows,
      calls: calls.rows,
      proposedDates: plans.rows,
      checkins: checkins.rows,
    });
    return true;
  }
  if (req.method !== "POST")
    throw new ApiError(405, "METHOD_NOT_ALLOWED", "Unsupported action.");
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [id]);
    await c.query(
      "INSERT INTO deleted_accounts(account_id) VALUES($1) ON CONFLICT DO NOTHING",
      [id],
    );
    for (const q of [
      "UPDATE group_messages SET text='[Removed by account deletion]',name='Former member' WHERE sender_id=$1",
      "UPDATE messages SET text='[Removed by account deletion]',image_id=NULL WHERE sender_id=$1",
      "DELETE FROM message_images WHERE sender_id=$1",
      "DELETE FROM notifications WHERE account_id=$1",
      "DELETE FROM read_cursors WHERE account_id=$1",
      "DELETE FROM call_feedback WHERE account_id=$1",
      "DELETE FROM date_checkins WHERE account_id=$1",
      "UPDATE date_plans SET status='cancelled',venue='[Removed]',address='[Removed]' WHERE proposer_id=$1",
      "UPDATE calls SET status='ended',ended_at=coalesce(ended_at,now()) WHERE caller_id=$1 OR callee_id=$1",
    ])
      await c.query(q, [id]);
    await c.query("COMMIT");
    json(res, 200, { ok: true });
    return true;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
