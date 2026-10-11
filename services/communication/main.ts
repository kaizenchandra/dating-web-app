import { imageRoute } from "./images.ts";
import { groupMessages } from "./groups.ts";
import { privacyRoute } from "./privacy.ts";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import {
  startDependencies,
  serve,
  ApiError,
  body,
  json,
  pool,
  redis,
} from "../../packages/shared-config/runtime.ts";
import { migrate } from "../../packages/shared-config/migrate.ts";
import type { Connections } from "../../packages/generated-clients/client.ts";
await startDependencies();
await migrate(new URL("./migrations/", import.meta.url));
import { internal, account, access, conversation } from "./access.ts";
import { callsRoute, signalSchema, relaySignal, callAccess } from "./calls.ts";
import { datesRoute } from "./dates.ts";
const sendSchema = z
  .object({
    conversationId: z.string().uuid(),
    clientMessageId: z.string().uuid(),
    text: z.string().trim().max(2000),
    imageId: z.string().uuid().optional(),
  })
  .strict();
type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  sequence: string;
  text: string;
  image_id: string | null;
  created_at: Date;
  delivered_at: Date | null;
  read_at: Date | null;
};
function message(row: MessageRow) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    sequence: Number(row.sequence),
    text: row.text,
    imageId: row.image_id,
    createdAt: row.created_at.toISOString(),
    deliveredAt: row.delivered_at?.toISOString() || null,
    readAt: row.read_at?.toISOString() || null,
  };
}
const server = serve(async (req, res) => {
  const url = new URL(req.url!, "http://communication");
  const path = url.pathname;
  if (await privacyRoute(req, res, url)) return;
  if (path === "/internal/events" && req.method === "POST") {
    const event = z
      .object({
        id: z.string().uuid(),
        version: z.literal(1),
        type: z.literal("connection.matched"),
        aggregateId: z.string().uuid(),
        aggregateVersion: z.literal(1),
        occurredAt: z.iso.datetime({ offset: true }),
        correlationId: z.string().uuid(),
        payload: z.object({
          matchId: z.string().uuid(),
          firstAccountId: z.string().uuid(),
          secondAccountId: z.string().uuid(),
        }),
      })
      .strict()
      .parse(await body(req));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const seen = await client.query(
        "INSERT INTO processed_events(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id",
        [event.id],
      );
      const deleted = await client.query(
        "SELECT account_id FROM deleted_accounts WHERE account_id=ANY($1::uuid[])",
        [[event.payload.firstAccountId, event.payload.secondAccountId]],
      );
      if (seen.rowCount && !deleted.rowCount) {
        await client.query(
          "INSERT INTO conversations(id,first_id,second_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [
            event.payload.matchId,
            event.payload.firstAccountId,
            event.payload.secondAccountId,
          ],
        );
        for (const id of [
          event.payload.firstAccountId,
          event.payload.secondAccountId,
        ])
          await client.query(
            "INSERT INTO notifications(id,event_id,account_id,kind,conversation_id) VALUES(gen_random_uuid(),$1,$2,'match',$3) ON CONFLICT DO NOTHING",
            [event.id, id, event.payload.matchId],
          );
      }
      await client.query("COMMIT");
      return json(res, 200, { ok: true });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  if (path === "/internal/commit-message" && req.method === "POST") {
    const input = sendSchema
      .extend({
        actorId: z.string().uuid(),
        recipientId: z.string().uuid(),
        firstId: z.string().uuid(),
        secondId: z.string().uuid(),
        expiresAt: z.number().int(),
      })
      .strict()
      .parse(await body(req));
    if (input.expiresAt < Date.now() || input.expiresAt > Date.now() + 3000)
      throw new ApiError(403, "AUTHORIZATION_EXPIRED", "Retry the message.");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL transaction_timeout='1s'");
      await client.query("SET LOCAL statement_timeout='900ms'");
      const valid = await client.query(
        "SELECT clock_timestamp()<to_timestamp($1/1000.0) AS valid",
        [input.expiresAt],
      );
      if (!valid.rows[0].valid)
        throw new ApiError(403, "AUTHORIZATION_EXPIRED", "Retry the message.");
      await client.query(
        "INSERT INTO conversations(id,first_id,second_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [input.conversationId, input.firstId, input.secondId],
      );
      if (input.imageId) {
        const image = (
          await client.query(
            "SELECT * FROM message_images WHERE id=$1 AND sender_id=$2 AND conversation_id=$3 AND (attached OR created_at>now()-interval '24 hours') FOR UPDATE",
            [input.imageId, input.actorId, input.conversationId],
          )
        ).rows[0];
        if (!image)
          throw new ApiError(
            403,
            "IMAGE_UNAVAILABLE",
            "This image is unavailable or belongs to another conversation.",
          );
        const used = await client.query(
          "SELECT client_message_id FROM messages WHERE image_id=$1",
          [input.imageId],
        );
        if (
          used.rowCount &&
          used.rows[0].client_message_id !== input.clientMessageId
        )
          throw new ApiError(
            409,
            "IMAGE_ALREADY_SENT",
            "This image was already sent.",
          );
        await client.query(
          "UPDATE message_images SET attached=true WHERE id=$1",
          [input.imageId],
        );
      }
      const result = await client.query<MessageRow>(
        "INSERT INTO messages(id,conversation_id,sender_id,recipient_id,client_message_id,text,image_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(sender_id,client_message_id) DO NOTHING RETURNING *",
        [
          randomUUID(),
          input.conversationId,
          input.actorId,
          input.recipientId,
          input.clientMessageId,
          input.text,
          input.imageId || null,
        ],
      );
      let row = result.rows[0];
      if (!row) {
        row = (
          await client.query<MessageRow>(
            "SELECT * FROM messages WHERE sender_id=$1 AND client_message_id=$2",
            [input.actorId, input.clientMessageId],
          )
        ).rows[0];
        if (
          row.conversation_id !== input.conversationId ||
          row.text !== input.text ||
          row.image_id !== (input.imageId || null)
        )
          throw new ApiError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "This message ID was used for different content.",
          );
      } else {
        await client.query(
          "INSERT INTO outbox(id,conversation_id,sequence) VALUES($1,$2,$3)",
          [row.id, row.conversation_id, row.sequence],
        );
        await client.query(
          "INSERT INTO notifications(id,event_id,account_id,kind,conversation_id) VALUES(gen_random_uuid(),$1,$2,'message',$3) ON CONFLICT DO NOTHING",
          [row.id, input.recipientId, input.conversationId],
        );
      }
      await client.query("COMMIT");
      return json(res, 200, message(row));
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
  if (path === "/internal/evidence" && req.method === "POST") {
    const input = z
      .object({
        actorId: z.string().uuid(),
        subjectId: z.string().uuid(),
        kind: z.enum(["message", "call"]),
      })
      .strict()
      .parse(await body(req));
    const result =
      input.kind === "message"
        ? await pool.query(
            "SELECT m.id,m.sender_id,m.recipient_id,m.text,m.created_at,m.image_id,(SELECT encode(data,'base64') FROM message_images WHERE id=m.image_id) AS image_jpeg_base64 FROM messages m WHERE m.id=$1 AND (m.sender_id=$2 OR m.recipient_id=$2)",
            [input.subjectId, input.actorId],
          )
        : await pool.query(
            "SELECT id,caller_id,callee_id,status,created_at,ended_at FROM calls WHERE id=$1 AND (caller_id=$2 OR callee_id=$2)",
            [input.subjectId, input.actorId],
          );
    if (!result.rowCount)
      throw new ApiError(
        404,
        "EVIDENCE_NOT_FOUND",
        "This item is not available to your account.",
      );
    const row = result.rows[0];
    const ids =
      input.kind === "message"
        ? [row.sender_id, row.recipient_id]
        : [row.caller_id, row.callee_id];
    return json(res, 200, {
      targetId: ids.find((id) => id !== input.actorId),
      evidence: row,
    });
  }
  const a = await account(req);
  if (
    (await imageRoute(req, res, a.id, url)) ||
    (await groupMessages(req, res, a.id, url)) ||
    (await callsRoute(req, res, a.id, url)) ||
    (await datesRoute(req, res, a.id, url))
  )
    return;
  if (path === "/api/v1/inbox" && req.method === "GET") {
    const connections = await internal<Connections>(
      "connections",
      "/api/v1/connections",
      { headers: { cookie: req.headers.cookie || "" } },
    );
    const conversations = await Promise.all(
      connections.matches.map(async (match) => {
        const result = await pool.query(
          "SELECT count(*)::int AS count FROM messages WHERE conversation_id=$1 AND recipient_id=$2 AND sequence>coalesce((SELECT through_sequence FROM read_cursors WHERE account_id=$2 AND conversation_id=$1),0)",
          [match.id, a.id],
        );
        return {
          id: match.id,
          person: match.person,
          unread: result.rows[0].count,
        };
      }),
    );
    return json(res, 200, { conversations });
  }
  if (path === "/api/v1/messages" && req.method === "GET") {
    const id = z.string().uuid().parse(url.searchParams.get("conversationId"));
    const before = url.searchParams.has("before")
      ? z.coerce.number().int().positive().parse(url.searchParams.get("before"))
      : Number.MAX_SAFE_INTEGER;
    const m = await access(a.id, id);
    await conversation(m);
    const result = await pool.query<MessageRow>(
      "SELECT * FROM messages WHERE conversation_id=$1 AND sequence<$2 ORDER BY sequence DESC LIMIT 50",
      [id, before],
    );
    return json(res, 200, {
      messages: result.rows.toReversed().map(message),
      nextCursor:
        result.rows.length === 50 ? Number(result.rows.at(-1)!.sequence) : null,
    });
  }
  if (path === "/api/v1/messages" && req.method === "POST") {
    const input = sendSchema.parse(await body(req));
    if (!input.text && !input.imageId)
      throw new ApiError(
        422,
        "EMPTY_MESSAGE",
        "Write a message or attach an image.",
      );
    const result = await internal("connections", "/internal/guard-message", {
      method: "POST",
      body: JSON.stringify({ ...input, actorId: a.id }),
    });
    return json(res, 200, result);
  }
  if (path === "/api/v1/messages/receipt" && req.method === "POST") {
    const input = z
      .object({
        conversationId: z.string().uuid(),
        throughSequence: z.number().int().positive(),
        shareReadReceipt: z.boolean(),
      })
      .strict()
      .parse(await body(req));
    await access(a.id, input.conversationId);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const max = await client.query(
        "SELECT coalesce(max(sequence),0)::text AS max FROM messages WHERE conversation_id=$1",
        [input.conversationId],
      );
      const through = Math.min(input.throughSequence, Number(max.rows[0].max));
      await client.query(
        "INSERT INTO read_cursors(account_id,conversation_id,through_sequence) VALUES($1,$2,$3) ON CONFLICT(account_id,conversation_id) DO UPDATE SET through_sequence=greatest(read_cursors.through_sequence,EXCLUDED.through_sequence)",
        [a.id, input.conversationId, through],
      );
      const changed = await client.query(
        "UPDATE messages SET delivered_at=coalesce(delivered_at,now()),read_at=CASE WHEN $4 THEN coalesce(read_at,now()) ELSE read_at END WHERE conversation_id=$1 AND recipient_id=$2 AND sequence<=$3 AND (delivered_at IS NULL OR ($4 AND read_at IS NULL)) RETURNING id",
        [input.conversationId, a.id, through, input.shareReadReceipt],
      );
      if (changed.rowCount)
        await client.query(
          "INSERT INTO outbox(id,conversation_id,sequence) VALUES(gen_random_uuid(),$1,$2)",
          [input.conversationId, through],
        );
      await client.query("COMMIT");
      return json(res, 200, { ok: true });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  if (path === "/api/v1/notifications" && req.method === "GET") {
    const result = await pool.query(
      'SELECT id,kind,conversation_id AS "conversationId",created_at AS "createdAt",read FROM notifications WHERE account_id=$1 ORDER BY created_at DESC LIMIT 50',
      [a.id],
    );
    return json(res, 200, { notifications: result.rows });
  }
  if (path === "/api/v1/notifications/read" && req.method === "POST") {
    await pool.query("UPDATE notifications SET read=true WHERE account_id=$1", [
      a.id,
    ]);
    return json(res, 200, { ok: true });
  }
  throw new ApiError(404, "NOT_FOUND", "This route does not exist.");
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 131072 });
type SocketInfo = {
  actorId: string;
  request: IncomingMessage;
  conversationId: string | null;
};
const sockets = new Map<WebSocket, SocketInfo>();
server.on("upgrade", async (req, socket, head) => {
  const expected = `Bearer ${process.env.SERVICE_TOKEN}`;
  const received = req.headers.authorization || "";
  if (
    req.url !== "/api/v1/socket" ||
    expected.length !== received.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(received))
  ) {
    socket.destroy();
    return;
  }
  try {
    const a = await account(req);
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.set(ws, { actorId: a.id, request: req, conversationId: null });
      ws.on("close", () => sockets.delete(ws));
      ws.on("error", () => ws.close());
      ws.on("message", async (raw) => {
        try {
          const incoming = JSON.parse(raw.toString());
          if (incoming.type === "call.signal") {
            await relaySignal(a.id, signalSchema.parse(incoming));
            return;
          }
          const data = z
            .object({
              type: z.literal("subscribe"),
              conversationId: z.string().uuid(),
            })
            .strict()
            .parse(JSON.parse(raw.toString()));
          await access(a.id, data.conversationId);
          sockets.get(ws)!.conversationId = data.conversationId;
          ws.send(
            JSON.stringify({
              type: "subscribed",
              version: 1,
              conversationId: data.conversationId,
            }),
          );
        } catch {
          ws.close(1008, "Conversation unavailable");
        }
      });
    });
  } catch {
    socket.destroy();
  }
});
const subscriber = redis.duplicate();
await subscriber.connect();
await subscriber.subscribe("raahi:message-available", async (raw) => {
  let event: { conversationId: string };
  try {
    event = JSON.parse(raw);
  } catch {
    return;
  }
  await Promise.all(
    [...sockets.entries()]
      .filter(([, s]) => s.conversationId === event.conversationId)
      .map(async ([ws, s]) => {
        try {
          await account(s.request);
          await access(s.actorId, event.conversationId);
          if (ws.readyState === WebSocket.OPEN) ws.send(raw);
        } catch {
          ws.close(1008, "Access revoked");
        }
      }),
  );
});
let publishing = false;
setInterval(async () => {
  if (publishing) return;
  publishing = true;
  try {
    const rows = await pool.query(
      "SELECT id,conversation_id,sequence FROM outbox WHERE delivered_at IS NULL AND attempts<10 ORDER BY created_at LIMIT 20",
    );
    for (const row of rows.rows) {
      try {
        await redis.publish(
          "raahi:message-available",
          JSON.stringify({
            type: "message.available",
            version: 1,
            id: row.id,
            conversationId: row.conversation_id,
            sequence: Number(row.sequence),
          }),
        );
        await pool.query("UPDATE outbox SET delivered_at=now() WHERE id=$1", [
          row.id,
        ]);
      } catch {
        await pool.query(
          "UPDATE outbox SET attempts=attempts+1,last_error='redis unavailable' WHERE id=$1",
          [row.id],
        );
      }
    }
  } catch {
    console.error('{"event":"message_outbox_unavailable"}');
  } finally {
    publishing = false;
  }
}, 500).unref();
setInterval(() => {
  for (const [ws, s] of sockets) {
    Promise.all([
      account(s.request),
      s.conversationId
        ? access(s.actorId, s.conversationId)
        : Promise.resolve(),
    ])
      .then(() => {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
      })
      .catch(() => ws.close(1008, "Access revoked"));
  }
}, 2000).unref();
process.on("SIGTERM", () => {
  for (const ws of sockets.keys()) ws.close(1012, "Service restarting");
  subscriber.quit().catch(() => {});
  wss.close();
});

await subscriber.subscribe("raahi:call-signals", async (raw) => {
  const event = JSON.parse(raw) as { targetId: string; callId: string };
  await Promise.all(
    [...sockets.entries()]
      .filter(([, s]) => s.actorId === event.targetId)
      .map(async ([ws, s]) => {
        try {
          await account(s.request);
          const call = await callAccess(s.actorId, event.callId);
          if (call.status === "accepted" && ws.readyState === WebSocket.OPEN)
            ws.send(raw);
        } catch {
          ws.close(1008, "Call unavailable");
        }
      }),
  );
});
