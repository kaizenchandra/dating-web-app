import { serviceToken } from "../../packages/shared-config/service-auth.ts";
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import { ApiError, pool } from "../../packages/shared-config/runtime.ts";
export async function internal<T>(
  service: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`http://${service}:4000${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${serviceToken(service)}`,
      "content-type": "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(6000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      response.status,
      data.error?.code || "AUTHORITY_UNAVAILABLE",
      data.error?.message || "Permission could not be checked. Please retry.",
    );
  return data;
}
export async function account(req: IncomingMessage) {
  return internal<{ id: string }>("identity", "/internal/identity/me", {
    headers: { cookie: req.headers.cookie || "" },
  });
}
export type Match = { id: string; firstId: string; secondId: string };
export async function access(actor: string, id: string) {
  z.string().uuid().parse(id);
  return internal<Match>(
    "connections",
    `/internal/match?actor=${actor}&id=${id}`,
  );
}
export async function conversation(m: Match) {
  await pool.query(
    "INSERT INTO conversations(id,first_id,second_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    [m.id, m.firstId, m.secondId],
  );
}
