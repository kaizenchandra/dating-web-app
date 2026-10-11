import { serviceToken } from "../../packages/shared-config/service-auth.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  pool,
  json,
  body,
  ApiError,
} from "../../packages/shared-config/runtime.ts";
import { groupAccess } from "./communities.ts";
export async function pairingRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  actorId: string,
) {
  if (!path.startsWith("/api/v1/communities/pairing")) return false;
  async function permitted(eventId: string) {
    const e = (
      await pool.query("SELECT * FROM community_events WHERE id=$1", [eventId])
    ).rows[0];
    if (!e || e.status !== "open")
      throw new ApiError(404, "EVENT_UNAVAILABLE", "Event is unavailable.");
    await groupAccess(e.group_id, actorId);
    const registered = await pool.query(
      "SELECT 1 FROM event_registrations WHERE event_id=$1 AND account_id=$2",
      [eventId, actorId],
    );
    if (!registered.rowCount)
      throw new ApiError(
        403,
        "REGISTRATION_REQUIRED",
        "Register for the event first.",
      );
    return e;
  }
  if (path === "/api/v1/communities/pairing" && req.method === "GET") {
    const id = z
      .string()
      .uuid()
      .parse(new URL(req.url!, "http://pairing").searchParams.get("eventId"));
    await permitted(id);
    const rows = await pool.query(
      "SELECT account_id FROM event_registrations WHERE event_id=$1 AND account_id<>$2",
      [id, actorId],
    );
    const r = await fetch("http://identity:4000/internal/eligibility", {
      method: "POST",
      headers: {
        authorization: `Bearer ${serviceToken("identity")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ids: rows.rows.map((x) => x.account_id) }),
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok)
      throw new ApiError(
        503,
        "ELIGIBILITY_UNAVAILABLE",
        "Member eligibility is unavailable.",
      );
    const data = (await r.json()) as {
      accounts: {
        id: string;
        displayName: string;
        identityApproved: boolean;
      }[];
    };
    const invitations = await pool.query(
      'SELECT id,inviter_id AS "inviterId",invitee_id AS "inviteeId",status FROM buddy_invitations WHERE event_id=$1 AND (inviter_id=$2 OR invitee_id=$2) ORDER BY created_at DESC LIMIT 50',
      [id, actorId],
    );
    json(res, 200, {
      members: data.accounts
        .filter((a) => a.identityApproved)
        .map((a) => ({ id: a.id, name: a.displayName })),
      invitations: invitations.rows,
      selfId: actorId,
    });
    return true;
  }
  if (path === "/api/v1/communities/pairing" && req.method === "POST") {
    const input = z
      .object({ eventId: z.string().uuid(), targetId: z.string().uuid() })
      .strict()
      .parse(await body(req));
    const event = await permitted(input.eventId);
    if (input.targetId === actorId)
      throw new ApiError(422, "INVALID_TARGET", "Choose another member.");
    await groupAccess(event.group_id, input.targetId);
    const exists = await pool.query(
      "SELECT 1 FROM event_registrations WHERE event_id=$1 AND account_id=$2",
      [input.eventId, input.targetId],
    );
    if (!exists.rowCount)
      throw new ApiError(
        409,
        "NOT_REGISTERED",
        "This person is not registered.",
      );
    await pool.query(
      "INSERT INTO buddy_invitations(id,event_id,inviter_id,invitee_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [randomUUID(), input.eventId, actorId, input.targetId],
    );
    json(res, 200, { ok: true });
    return true;
  }
  if (path === "/api/v1/communities/pairing/action" && req.method === "POST") {
    const input = z
      .object({
        id: z.string().uuid(),
        action: z.enum(["accept", "decline", "cancel"]),
      })
      .strict()
      .parse(await body(req));
    const invite = (
      await pool.query(
        "SELECT * FROM buddy_invitations WHERE id=$1 AND (inviter_id=$2 OR invitee_id=$2)",
        [input.id, actorId],
      )
    ).rows[0];
    if (!invite)
      throw new ApiError(404, "INVITATION_NOT_FOUND", "Invitation not found.");
    if (input.action !== "cancel" && invite.invitee_id !== actorId)
      throw new ApiError(
        403,
        "INVITEE_REQUIRED",
        "Only the invited person can answer.",
      );
    if (input.action === "accept") {
      const e = await permitted(invite.event_id);
      await groupAccess(e.group_id, invite.inviter_id);
    }
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT id FROM community_events WHERE id=$1 FOR UPDATE", [
        invite.event_id,
      ]);
      const current = (
        await c.query(
          "SELECT status FROM buddy_invitations WHERE id=$1 FOR UPDATE",
          [invite.id],
        )
      ).rows[0];
      if (input.action === "accept") {
        if (current.status !== "pending" && current.status !== "accepted")
          throw new ApiError(
            409,
            "INVITATION_CLOSED",
            "This invitation is closed.",
          );
        const registered = await c.query(
          "SELECT account_id FROM event_registrations WHERE event_id=$1 AND account_id=ANY($2::uuid[])",
          [invite.event_id, [invite.inviter_id, invite.invitee_id]],
        );
        if (registered.rowCount !== 2)
          throw new ApiError(
            409,
            "REGISTRATION_REQUIRED",
            "Both people must still be registered.",
          );
        const existing = await c.query(
          "SELECT 1 FROM event_buddies WHERE event_id=$1 AND account_id=ANY($2::uuid[]) AND invitation_id<>$3",
          [invite.event_id, [invite.inviter_id, invite.invitee_id], invite.id],
        );
        if (existing.rowCount)
          throw new ApiError(
            409,
            "BUDDY_EXISTS",
            "One person already has a buddy for this event.",
          );
        for (const id of [invite.inviter_id, invite.invitee_id])
          await c.query(
            "INSERT INTO event_buddies(event_id,account_id,invitation_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            [invite.event_id, id, invite.id],
          );
        await c.query(
          "UPDATE buddy_invitations SET status='accepted' WHERE id=$1",
          [invite.id],
        );
      } else {
        await c.query("DELETE FROM event_buddies WHERE invitation_id=$1", [
          invite.id,
        ]);
        await c.query("UPDATE buddy_invitations SET status=$2 WHERE id=$1", [
          invite.id,
          input.action === "cancel" ? "cancelled" : "declined",
        ]);
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    json(res, 200, { ok: true });
    return true;
  }
  throw new ApiError(405, "METHOD_NOT_ALLOWED", "Unsupported action.");
}
