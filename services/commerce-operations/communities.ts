import { serviceToken } from "../../packages/shared-config/service-auth.ts";
import { pairingRoute } from "./pairing.ts";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  pool,
  json,
  body,
  ApiError,
} from "../../packages/shared-config/runtime.ts";
async function service<T>(
  name: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const r = await fetch(`http://${name}:4000${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${serviceToken(name)}`,
      ...options.headers,
    },
    signal: AbortSignal.timeout(3000),
  });
  if (!r.ok)
    throw new ApiError(
      r.status,
      "COMMUNITY_PERMISSION",
      "Community permission could not be confirmed. Complete verification or retry.",
    );
  return r.json();
}
async function blocks(id: string) {
  return (
    await service<{ ids: string[] }>("connections", "/internal/blocks?id=" + id)
  ).ids;
}
async function eligible(id: string) {
  const r = await service<{ eligible: boolean }>(
    "profile-discovery",
    "/internal/eligibility?id=" + id,
  );
  if (!r.eligible)
    throw new ApiError(
      403,
      "ELIGIBILITY_REQUIRED",
      "Complete your profile and verification, and unpause your account.",
    );
}
export async function groupAccess(groupId: string, actorId: string) {
  await eligible(actorId);
  const row = (
    await pool.query(
      "SELECT c.* FROM communities c JOIN hosts h ON h.account_id=c.host_id AND h.status='approved' JOIN community_members m ON m.group_id=c.id WHERE c.id=$1 AND m.account_id=$2 AND NOT c.closed",
      [groupId, actorId],
    )
  ).rows[0];
  if (!row)
    throw new ApiError(
      403,
      "MEMBERSHIP_REQUIRED",
      "This community is unavailable or you are no longer a member.",
    );
  await eligible(row.host_id);
  const members = await pool.query(
    "SELECT account_id FROM community_members WHERE group_id=$1",
    [groupId],
  );
  const blocked = await blocks(actorId);
  if (members.rows.some((m) => blocked.includes(m.account_id)))
    throw new ApiError(
      403,
      "GROUP_BLOCKED",
      "A blocked relationship is present in this group. Leave the group from Communities.",
    );
  return row;
}
export async function communitiesRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
) {
  const url = new URL(req.url!, "http://communities");
  if (path === "/internal/community-access" && req.method === "GET") {
    const actor = z.string().uuid().parse(url.searchParams.get("actorId"));
    const group = z.string().uuid().parse(url.searchParams.get("groupId"));
    await groupAccess(group, actor);
    json(res, 200, { ok: true });
    return true;
  }
  if (!path.startsWith("/api/v1/communities")) return false;
  const actor = await service<{ id: string }>(
    "identity",
    "/internal/identity/me",
    { headers: { cookie: req.headers.cookie || "" } },
  );
  await eligible(actor.id);
  if (await pairingRoute(req, res, path, actor.id)) return true;
  if (path === "/api/v1/communities" && req.method === "GET") {
    const blocked = await blocks(actor.id);
    const groups = await pool.query(
      `SELECT c.id,c.name,c.city,c.interest,c.description,c.host_id AS "hostId",c.host_id=$1 AS host,EXISTS(SELECT 1 FROM community_members m WHERE m.group_id=c.id AND account_id=$1) AS joined,(SELECT count(*)::int FROM community_members m WHERE m.group_id=c.id) AS members FROM communities c JOIN hosts h ON h.account_id=c.host_id AND h.status='approved' WHERE NOT c.closed AND NOT(c.host_id=ANY($2::uuid[])) ORDER BY c.created_at DESC LIMIT 50`,
      [actor.id, blocked],
    );
    const host = await pool.query(
      "SELECT status FROM hosts WHERE account_id=$1",
      [actor.id],
    );
    json(res, 200, {
      groups: groups.rows,
      hostStatus: host.rows[0]?.status || "not_applied",
    });
    return true;
  }
  if (path === "/api/v1/communities/host" && req.method === "POST") {
    const { reason } = z
      .object({ reason: z.string().trim().min(10).max(1000) })
      .strict()
      .parse(await body(req));
    await pool.query(
      "INSERT INTO hosts(account_id,reason) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET reason=$2,status='pending',updated_at=now() WHERE hosts.status<>'approved'",
      [actor.id, reason],
    );
    json(res, 200, { ok: true });
    return true;
  }
  if (path === "/api/v1/communities" && req.method === "POST") {
    const input = z
      .object({
        name: z.string().trim().min(3).max(80),
        city: z.string().trim().min(2).max(60),
        interest: z.string().trim().min(2).max(60),
        description: z.string().trim().min(10).max(1000),
      })
      .strict()
      .parse(await body(req));
    const id = randomUUID();
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const host = await c.query(
        "SELECT account_id FROM hosts WHERE account_id=$1 AND status='approved' FOR UPDATE",
        [actor.id],
      );
      if (!host.rowCount)
        throw new ApiError(
          403,
          "HOST_REVIEW_REQUIRED",
          "Human host approval is required.",
        );
      await c.query(
        "INSERT INTO communities(id,host_id,name,city,interest,description) VALUES($1,$2,$3,$4,$5,$6)",
        [
          id,
          actor.id,
          input.name,
          input.city,
          input.interest,
          input.description,
        ],
      );
      await c.query(
        "INSERT INTO community_members(group_id,account_id) VALUES($1,$2)",
        [id, actor.id],
      );
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    json(res, 200, { id });
    return true;
  }
  if (path === "/api/v1/communities/membership" && req.method === "POST") {
    const input = z
      .object({
        groupId: z.string().uuid(),
        action: z.enum(["join", "leave", "close"]),
      })
      .strict()
      .parse(await body(req));
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const row = (
        await c.query(
          "SELECT * FROM communities WHERE id=$1 AND NOT closed FOR UPDATE",
          [input.groupId],
        )
      ).rows[0];
      if (!row)
        throw new ApiError(
          404,
          "COMMUNITY_NOT_FOUND",
          "This community is closed.",
        );
      if (input.action === "close") {
        if (row.host_id !== actor.id)
          throw new ApiError(
            403,
            "HOST_REQUIRED",
            "Only the host can close this community.",
          );
        await c.query("UPDATE communities SET closed=true WHERE id=$1", [
          input.groupId,
        ]);
        await c.query(
          "UPDATE community_events SET status='cancelled' WHERE group_id=$1",
          [input.groupId],
        );
      } else if (input.action === "leave") {
        if (row.host_id === actor.id)
          throw new ApiError(
            409,
            "HOST_CLOSE_REQUIRED",
            "Close your community before leaving.",
          );
        await c.query(
          "DELETE FROM event_buddies WHERE invitation_id IN(SELECT b.id FROM buddy_invitations b JOIN community_events e ON e.id=b.event_id WHERE e.group_id=$1 AND (b.inviter_id=$2 OR b.invitee_id=$2))",
          [input.groupId, actor.id],
        );
        await c.query(
          "UPDATE buddy_invitations SET status='cancelled' WHERE event_id IN(SELECT id FROM community_events WHERE group_id=$1) AND (inviter_id=$2 OR invitee_id=$2)",
          [input.groupId, actor.id],
        );
        await c.query(
          "DELETE FROM community_members WHERE group_id=$1 AND account_id=$2",
          [input.groupId, actor.id],
        );
        await c.query(
          "DELETE FROM event_registrations WHERE account_id=$1 AND event_id IN(SELECT id FROM community_events WHERE group_id=$2)",
          [actor.id, input.groupId],
        );
      } else {
        await eligible(row.host_id);
        const host = await c.query(
          "SELECT 1 FROM hosts WHERE account_id=$1 AND status='approved'",
          [row.host_id],
        );
        if (!host.rowCount)
          throw new ApiError(
            403,
            "HOST_REVIEW_REQUIRED",
            "The host is awaiting review.",
          );
        const members = await c.query(
          "SELECT account_id FROM community_members WHERE group_id=$1",
          [input.groupId],
        );
        const excluded = await blocks(actor.id);
        if (members.rows.some((m) => excluded.includes(m.account_id)))
          throw new ApiError(
            403,
            "GROUP_BLOCKED",
            "A blocked relationship is present in this group.",
          );
        if (!members.rows.some((m) => m.account_id === actor.id)) {
          if (members.rows.length >= 30)
            throw new ApiError(409, "GROUP_FULL", "This community is full.");
          await c.query(
            "INSERT INTO community_members(group_id,account_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
            [input.groupId, actor.id],
          );
        }
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
  if (path === "/api/v1/communities/events" && req.method === "GET") {
    const group = z.string().uuid().parse(url.searchParams.get("groupId"));
    await groupAccess(group, actor.id);
    const rows = await pool.query(
      `SELECT e.id,e.group_id AS "groupId",e.title,e.kind,e.venue,e.starts_at AS "startsAt",e.capacity,e.status,EXISTS(SELECT 1 FROM event_registrations r WHERE r.event_id=e.id AND r.account_id=$2) AS registered,(SELECT count(*)::int FROM event_registrations r WHERE r.event_id=e.id) AS registrations FROM community_events e WHERE e.group_id=$1 ORDER BY e.starts_at DESC LIMIT 50`,
      [group, actor.id],
    );
    json(res, 200, { events: rows.rows });
    return true;
  }
  if (path === "/api/v1/communities/events" && req.method === "POST") {
    const input = z
      .object({
        groupId: z.string().uuid(),
        title: z.string().trim().min(3).max(100),
        kind: z.enum(["meetup", "activity", "speed introductions"]),
        venue: z.string().trim().min(5).max(300),
        startsAt: z.iso.datetime({ offset: true }),
        capacity: z.number().int().min(2).max(30),
      })
      .strict()
      .parse(await body(req));
    const group = await groupAccess(input.groupId, actor.id);
    if (group.host_id !== actor.id)
      throw new ApiError(
        403,
        "HOST_REQUIRED",
        "Only the host can create events.",
      );
    if (
      new Date(input.startsAt).getTime() < Date.now() + 60000 ||
      new Date(input.startsAt).getTime() > Date.now() + 31536000000
    )
      throw new ApiError(
        422,
        "INVALID_DATE",
        "Choose an event time in the next year.",
      );
    const id = randomUUID();
    await pool.query(
      "INSERT INTO community_events(id,group_id,title,kind,venue,starts_at,capacity) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        id,
        input.groupId,
        input.title,
        input.kind,
        input.venue,
        input.startsAt,
        input.capacity,
      ],
    );
    json(res, 200, { id });
    return true;
  }
  if (path === "/api/v1/communities/events/action" && req.method === "POST") {
    const input = z
      .object({
        eventId: z.string().uuid(),
        action: z.enum(["register", "withdraw", "cancel"]),
      })
      .strict()
      .parse(await body(req));
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const event = (
        await c.query("SELECT * FROM community_events WHERE id=$1 FOR UPDATE", [
          input.eventId,
        ])
      ).rows[0];
      if (!event)
        throw new ApiError(404, "EVENT_NOT_FOUND", "Event not found.");
      const group = await groupAccess(event.group_id, actor.id);
      if (input.action === "cancel") {
        if (group.host_id !== actor.id)
          throw new ApiError(403, "HOST_REQUIRED", "Only the host can cancel.");
        await c.query(
          "UPDATE community_events SET status='cancelled' WHERE id=$1",
          [input.eventId],
        );
      } else if (input.action === "withdraw") {
        await c.query(
          "DELETE FROM event_buddies WHERE invitation_id IN(SELECT id FROM buddy_invitations WHERE event_id=$1 AND (inviter_id=$2 OR invitee_id=$2))",
          [input.eventId, actor.id],
        );
        await c.query(
          "UPDATE buddy_invitations SET status='cancelled' WHERE event_id=$1 AND (inviter_id=$2 OR invitee_id=$2)",
          [input.eventId, actor.id],
        );
        await c.query(
          "DELETE FROM event_registrations WHERE event_id=$1 AND account_id=$2",
          [input.eventId, actor.id],
        );
      } else {
        if (event.status !== "open" || event.starts_at.getTime() <= Date.now())
          throw new ApiError(409, "EVENT_CLOSED", "Registration is closed.");
        const members = await c.query(
          "SELECT account_id FROM event_registrations WHERE event_id=$1",
          [input.eventId],
        );
        if (!members.rows.some((m) => m.account_id === actor.id)) {
          if (members.rows.length >= event.capacity)
            throw new ApiError(409, "EVENT_FULL", "This event is full.");
          await c.query(
            "INSERT INTO event_registrations(event_id,account_id) VALUES($1,$2)",
            [input.eventId, actor.id],
          );
        }
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
  throw new ApiError(404, "NOT_FOUND", "Community action not found.");
}
export async function hostReview(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  actorId: string,
) {
  if (path !== "/api/v1/admin/hosts") return false;
  if (req.method === "GET") {
    const r = await pool.query(
      'SELECT account_id AS "accountId",reason,status FROM hosts ORDER BY updated_at DESC LIMIT 100',
    );
    json(res, 200, { hosts: r.rows });
    return true;
  }
  if (req.method === "POST") {
    const input = z
      .object({
        accountId: z.string().uuid(),
        decision: z.enum(["approved", "rejected"]),
        reason: z.string().trim().min(3).max(1000),
      })
      .strict()
      .parse(await body(req));
    if (input.accountId === actorId)
      throw new ApiError(
        403,
        "SELF_REVIEW",
        "Another moderator must review this application.",
      );
    await eligible(input.accountId);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const changed = await c.query(
        "UPDATE hosts SET status=$2,review_reason=$3,updated_at=now() WHERE account_id=$1",
        [input.accountId, input.decision, input.reason],
      );
      if (!changed.rowCount)
        throw new ApiError(
          404,
          "APPLICATION_NOT_FOUND",
          "Application not found.",
        );
      await c.query(
        "INSERT INTO review_audit(id,actor_id,target_id,kind,decision,reason,status) VALUES(gen_random_uuid(),$1,$2,'host',$3,$4,'applied')",
        [actorId, input.accountId, input.decision, input.reason],
      );
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
