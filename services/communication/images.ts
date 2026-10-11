import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import {
  ApiError,
  body,
  json,
  pool,
} from "../../packages/shared-config/runtime.ts";
import { access } from "./access.ts";
export async function imageRoute(
  req: IncomingMessage,
  res: ServerResponse,
  actor: string,
  url: URL,
) {
  if (url.pathname !== "/api/v1/messages/image") return false;
  if (req.method === "GET") {
    const id = z.string().uuid().parse(url.searchParams.get("id"));
    const result = await pool.query(
      "SELECT i.* FROM message_images i WHERE i.id=$1 AND (i.attached OR (i.sender_id=$2 AND i.created_at>now()-interval '24 hours'))",
      [id, actor],
    );
    const image = result.rows[0];
    if (!image)
      throw new ApiError(
        404,
        "IMAGE_UNAVAILABLE",
        "This image is no longer available.",
      );
    await access(actor, image.conversation_id);
    res.writeHead(200, {
      "content-type": "image/jpeg",
      "content-length": image.data.length,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-disposition": 'inline; filename="message.jpg"',
    });
    res.end(image.data);
    return true;
  }
  if (req.method !== "POST")
    throw new ApiError(405, "METHOD_NOT_ALLOWED", "Use GET or POST.");
  const input = z
    .object({
      conversationId: z.string().uuid(),
      clientImageId: z.string().uuid(),
      data: z
        .string()
        .min(4)
        .max(6990508)
        .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    })
    .strict()
    .parse(await body(req, 7 * 1024 * 1024));
  await access(actor, input.conversationId);
  const bytes = Buffer.from(input.data, "base64");
  if (bytes.length > 5 * 1024 * 1024)
    throw new ApiError(
      413,
      "IMAGE_TOO_LARGE",
      "Choose an image smaller than 5 MB.",
    );
  const digest = createHash("sha256").update(bytes).digest("hex");
  // Serialize per-sender storage accounting, retries and deletion.
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [actor]);
    if (
      (
        await c.query("SELECT 1 FROM deleted_accounts WHERE account_id=$1", [
          actor,
        ])
      ).rowCount
    )
      throw new ApiError(
        403,
        "ACCOUNT_UNAVAILABLE",
        "Account access has ended.",
      );
    const old = (
      await c.query(
        "SELECT * FROM message_images WHERE sender_id=$1 AND client_image_id=$2",
        [actor, input.clientImageId],
      )
    ).rows[0];
    if (old) {
      if (
        old.source_hash !== digest ||
        old.conversation_id !== input.conversationId
      )
        throw new ApiError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "This image ID belongs to different content.",
        );
      await c.query("COMMIT");
      json(res, 200, { id: old.id });
      return true;
    }
    const usage = (
      await c.query(
        "SELECT count(*) FILTER(WHERE created_at>now()-interval '1 hour')::int AS recent,coalesce(sum(octet_length(data)),0)::int AS bytes FROM message_images WHERE sender_id=$1",
        [actor],
      )
    ).rows[0];
    if (usage.recent >= 20)
      throw new ApiError(
        429,
        "IMAGE_RATE_LIMIT",
        "Image limit reached. Try again in an hour.",
      );
    let encoded: Buffer;
    try {
      const decoder = sharp(bytes, {
        limitInputPixels: 16000000,
        failOn: "warning",
      });
      const metadata = await decoder.metadata();
      if (
        !["jpeg", "png", "webp"].includes(metadata.format || "") ||
        (metadata.pages || 1) > 1
      )
        throw Error("Unsupported image");
      encoded = await decoder
        .rotate()
        .resize({
          width: 1600,
          height: 1600,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 80 })
        .toBuffer();
    } catch {
      throw new ApiError(
        415,
        "INVALID_IMAGE",
        "Choose a valid, non-animated JPEG, PNG or WebP under 16 megapixels.",
      );
    }
    if (
      encoded.length > 1048576 ||
      usage.bytes + encoded.length > 100 * 1048576
    )
      throw new ApiError(
        413,
        "IMAGE_STORAGE_LIMIT",
        "Image storage limit reached or image is too detailed. Try a smaller image.",
      );
    const id = randomUUID();
    await c.query(
      "INSERT INTO message_images(id,sender_id,conversation_id,client_image_id,source_hash,data) VALUES($1,$2,$3,$4,$5,$6)",
      [id, actor, input.conversationId, input.clientImageId, digest, encoded],
    );
    await c.query("COMMIT");
    json(res, 200, { id });
    return true;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
setInterval(() => {
  void pool
    .query(
      "DELETE FROM message_images WHERE NOT attached AND created_at<now()-interval '24 hours'",
    )
    .catch(() => console.error('{"event":"image_cleanup_unavailable"}'));
}, 60000).unref();
