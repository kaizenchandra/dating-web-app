import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { pool, json, body } from "../../packages/shared-config/runtime.ts";
import { eligibility } from "./verification.ts";
import type { AccountRow } from "./security.ts";
export async function batchEligibility(
  req: IncomingMessage,
  res: ServerResponse,
) {
  const input = z
    .object({ ids: z.array(z.string().uuid()).max(50) })
    .strict()
    .parse(await body(req));
  const result = await pool.query<AccountRow>(
    "SELECT * FROM accounts WHERE id=ANY($1::uuid[]) AND NOT restricted",
    [input.ids],
  );
  const accounts = await Promise.all(result.rows.map(eligibility));
  json(res, 200, { accounts });
}
