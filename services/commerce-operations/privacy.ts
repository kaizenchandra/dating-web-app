import { cancelForDeletion } from "./commerce.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { pool, json, ApiError } from "../../packages/shared-config/runtime.ts";
export async function privacyRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
) {
  if (!["/internal/privacy/delete", "/internal/privacy/export"].includes(path))
    return false;
  const id = z
    .string()
    .uuid()
    .parse(new URL(req.url!, "http://internal").searchParams.get("accountId"));
  if (path.endsWith("/export") && req.method === "GET") {
    const reports = await pool.query(
      "SELECT id,kind,reason,detail,status,resolution,created_at FROM reports WHERE reporter_id=$1",
      [id],
    );
    const subscriptions = await pool.query(
      "SELECT id,status,tier,billing_mode,amount,currency,current_end,paid_count,created_at FROM subscriptions WHERE account_id=$1",
      [id],
    );
    const refunds = await pool.query(
      "SELECT id,subscription_id,reason,status,created_at FROM refund_requests WHERE account_id=$1",
      [id],
    );
    const memberships = await pool.query(
      "SELECT group_id,joined_at FROM community_members WHERE account_id=$1",
      [id],
    );
    const registrations = await pool.query(
      "SELECT event_id FROM event_registrations WHERE account_id=$1",
      [id],
    );
    const hosted = await pool.query(
      "SELECT id,name,city,interest,description,closed FROM communities WHERE host_id=$1",
      [id],
    );
    json(res, 200, {
      reports: reports.rows,
      subscriptions: subscriptions.rows,
      refunds: refunds.rows,
      memberships: memberships.rows,
      registrations: registrations.rows,
      hostedCommunities: hosted.rows,
    });
    return true;
  }
  if (req.method !== "POST")
    throw new ApiError(405, "METHOD_NOT_ALLOWED", "Unsupported action.");
  await cancelForDeletion(id);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "UPDATE communities SET closed=true,description='[Removed]',name='Closed community' WHERE host_id=$1",
      [id],
    );
    await c.query(
      "UPDATE community_events SET status='cancelled',venue='[Removed]',title='Closed event' WHERE group_id IN(SELECT id FROM communities WHERE host_id=$1)",
      [id],
    );
    await c.query(
      "DELETE FROM event_buddies WHERE invitation_id IN(SELECT id FROM buddy_invitations WHERE inviter_id=$1 OR invitee_id=$1)",
      [id],
    );
    await c.query(
      "DELETE FROM buddy_invitations WHERE inviter_id=$1 OR invitee_id=$1",
      [id],
    );
    await c.query("DELETE FROM community_members WHERE account_id=$1", [id]);
    await c.query("DELETE FROM event_registrations WHERE account_id=$1", [id]);
    await c.query("DELETE FROM hosts WHERE account_id=$1", [id]);
    await c.query("DELETE FROM staff_roles WHERE account_id=$1", [id]);
    await c.query("DELETE FROM staff_mfa WHERE account_id=$1", [id]);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  json(res, 200, {
    ok: true,
    retained:
      "Confidential reports and audit records retained under the published 365-day local policy.",
  });
  return true;
}
