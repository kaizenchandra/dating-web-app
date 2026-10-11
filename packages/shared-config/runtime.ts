import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { ZodError } from "zod";
import { createClient } from "redis";
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 2000,
  query_timeout: 3000,
  max: 10,
});
export const redis = createClient({
  url: process.env.REDIS_URL,
  socket: {
    connectTimeout: 2000,
    reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
  },
});
redis.on("error", () =>
  console.error(JSON.stringify({ event: "redis_unavailable" })),
);
export function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function body(
  req: IncomingMessage,
  maxBytes = 32768,
): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes)
      throw new ApiError(413, "BODY_TOO_LARGE", "The request is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Send a valid JSON request.");
  }
}
export function serve(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  internal = true,
) {
  const server = createServer(async (req, res) => {
    const incoming = String(req.headers["x-correlation-id"] || "");
    const correlationId =
      internal && /^[a-f0-9-]{36}$/.test(incoming) ? incoming : randomUUID();
    const started = performance.now();
    res.on("finish", () =>
      console.log(
        JSON.stringify({
          event: "http_request",
          service: process.env.SERVICE_NAME || "gateway",
          method: req.method,
          status: res.statusCode,
          correlationId,
          durationMs: Math.round(performance.now() - started),
        }),
      ),
    );
    res.setHeader("x-correlation-id", correlationId);
    try {
      if (req.url === "/health/live") return json(res, 200, { status: "ok" });
      if (
        internal &&
        (!process.env.SERVICE_TOKEN ||
          req.headers.authorization !== `Bearer ${process.env.SERVICE_TOKEN}`)
      )
        throw new ApiError(401, "UNAUTHORIZED", "Authentication is required.");
      if (req.url === "/health/ready") {
        await Promise.all([pool.query("SELECT 1"), redis.ping()]);
        return json(res, 200, {
          status: "ok",
          service: process.env.SERVICE_NAME,
        });
      }
      await handler(req, res);
    } catch (error) {
      if (!(error instanceof ApiError) && !(error instanceof ZodError)) {
        const safe = error as {
          name?: string;
          code?: string;
          cause?: { code?: string };
        };
        console.error(
          JSON.stringify({
            event: "request_failed",
            correlationId,
            name: safe.name,
            code: safe.code,
            cause: safe.cause?.code,
          }),
        );
      }
      const e =
        error instanceof ZodError
          ? new ApiError(
              422,
              "INVALID_FIELDS",
              "Check the required fields and try again.",
            )
          : error instanceof ApiError
            ? error
            : new ApiError(
                503,
                "SERVICE_UNAVAILABLE",
                "This service is temporarily unavailable. Please retry.",
              );
      if (res.headersSent) {
        if (!res.writableEnded) res.destroy();
        return;
      }
      if (e.status === 429) res.setHeader("retry-after", "60");
      json(res, e.status, {
        error: { code: e.code, message: e.message, correlationId },
      });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.listen(Number(process.env.PORT || 4000), "0.0.0.0");
  const stop = () =>
    server.close(() => {
      Promise.allSettled([
        pool.end(),
        redis.isOpen ? redis.quit() : Promise.resolve(),
      ]).finally(() => process.exit(0));
    });
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  return server;
}
export async function startDependencies() {
  await redis.connect();
  await pool.query("SELECT 1");
}
