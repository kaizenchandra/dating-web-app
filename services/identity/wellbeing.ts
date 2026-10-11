import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  pool,
  body,
  json,
  ApiError,
} from "../../packages/shared-config/runtime.ts";
import { current } from "./security.ts";
const schema = z
  .object({
    locale: z.enum(["en", "hi"]),
    quietEnabled: z.boolean(),
    quietStart: z.number().int().min(0).max(23),
    quietEnd: z.number().int().min(0).max(23),
    readReceipts: z.boolean(),
  })
  .strict();
export function quietNow(start: number, end: number, at = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(at),
  );
  return (
    start === end ||
    (start < end ? hour >= start && hour < end : hour >= start || hour < end)
  );
}
async function preferences(id: string) {
  const row = (
    await pool.query(
      'SELECT locale,quiet_enabled AS "quietEnabled",quiet_start AS "quietStart",quiet_end AS "quietEnd",read_receipts AS "readReceipts" FROM wellbeing WHERE account_id=$1',
      [id],
    )
  ).rows[0];
  return (
    row || {
      locale: "en",
      quietEnabled: false,
      quietStart: 22,
      quietEnd: 8,
      readReceipts: false,
    }
  );
}
export async function wellbeingRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
) {
  if (path === "/internal/availability" && req.method === "GET") {
    const id = z
      .string()
      .uuid()
      .parse(new URL(req.url!, "http://identity").searchParams.get("id"));
    const p = await preferences(id);
    json(res, 200, {
      acceptsCalls: !p.quietEnabled || !quietNow(p.quietStart, p.quietEnd),
    });
    return true;
  }
  if (path !== "/api/v1/account/wellbeing") return false;
  const a = (await current(req))!;
  if (req.method === "GET") {
    json(res, 200, await preferences(a.id));
    return true;
  }
  if (req.method === "PUT") {
    const p = schema.parse(await body(req));
    await pool.query(
      "INSERT INTO wellbeing(account_id,locale,quiet_enabled,quiet_start,quiet_end,read_receipts) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(account_id) DO UPDATE SET locale=$2,quiet_enabled=$3,quiet_start=$4,quiet_end=$5,read_receipts=$6",
      [
        a.id,
        p.locale,
        p.quietEnabled,
        p.quietStart,
        p.quietEnd,
        p.readReceipts,
      ],
    );
    json(res, 200, p);
    return true;
  }
  throw new ApiError(405, "METHOD_NOT_ALLOWED", "Unsupported action.");
}
