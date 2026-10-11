import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  pool,
  json,
  body,
  ApiError,
} from "../../packages/shared-config/runtime.ts";
import { internal } from "./access.ts";
export async function groupMessages(
  req: IncomingMessage,
  res: ServerResponse,
  actorId: string,
  url: URL,
) {
  if (url.pathname !== "/api/v1/communities/messages") return false;
  const input =
    req.method === "POST"
      ? z
          .object({
            groupId: z.string().uuid(),
            clientMessageId: z.string().uuid(),
            text: z.string().trim().min(1).max(2000),
          })
          .strict()
          .parse(await body(req))
      : null;
  const groupId =
    input?.groupId || z.string().uuid().parse(url.searchParams.get("groupId"));
  await internal(
    "commerce-operations",
    `/internal/community-access?actorId=${actorId}&groupId=${groupId}`,
  );
  if (req.method === "GET") {
    const rows = await pool.query(
      'SELECT id,sender_id AS "senderId",name,text,created_at AS "createdAt" FROM (SELECT * FROM group_messages WHERE group_id=$1 ORDER BY created_at DESC LIMIT 100) latest ORDER BY created_at',
      [groupId],
    );
    json(res, 200, { messages: rows.rows });
    return true;
  }
  if (input) {
    const a = await internal<{ displayName: string }>(
      "identity",
      "/internal/identity/me",
      { headers: { cookie: req.headers.cookie || "" } },
    );
    const rows = await pool.query(
      "INSERT INTO group_messages(id,group_id,sender_id,name,text,client_message_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(sender_id,client_message_id) DO NOTHING RETURNING id",
      [
        randomUUID(),
        groupId,
        actorId,
        a.displayName,
        input.text,
        input.clientMessageId,
      ],
    );
    if (!rows.rowCount) {
      const old = (
        await pool.query(
          "SELECT group_id,text FROM group_messages WHERE sender_id=$1 AND client_message_id=$2",
          [actorId, input.clientMessageId],
        )
      ).rows[0];
      if (old.group_id !== groupId || old.text !== input.text)
        throw new ApiError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Message ID was used for different content.",
        );
    }
    json(res, 200, { ok: true });
    return true;
  }
  throw new ApiError(405, "METHOD_NOT_ALLOWED", "Unsupported action.");
}
