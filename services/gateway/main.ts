import { serviceToken } from "../../packages/shared-config/service-auth.ts";
import { createHash } from "node:crypto";
import {
  serve,
  json,
  ApiError,
  redis,
} from "../../packages/shared-config/runtime.ts";
const services = [
  "identity",
  "profile-discovery",
  "connections",
  "communication",
  "commerce-operations",
];
const origin = process.env.WEB_ORIGIN || "http://localhost:3000";
redis
  .connect()
  .catch(() => console.error('{"event":"gateway_redis_unavailable"}'));
import { websocketUpgrades } from "./upgrade.ts";
const server = serve(async (req, res) => {
  const path = new URL(req.url!, "http://gateway").pathname;
  if (path === "/api/v1/status" && req.method === "GET") {
    const checks = await Promise.all(
      services.map(async (name) => {
        try {
          const response = await fetch(`http://${name}:4000/health/ready`, {
            headers: { authorization: `Bearer ${serviceToken(name)}` },
            signal: AbortSignal.timeout(3000),
          });
          return { name, status: response.ok ? "ready" : "unavailable" };
        } catch {
          return { name, status: "unavailable" };
        }
      }),
    );
    return json(res, checks.every((x) => x.status === "ready") ? 200 : 503, {
      environment: process.env.APP_ENV === "local" ? "local" : "production",
      services: checks,
    });
  }
  const callback =
    /^\/api\/v1\/auth\/oauth\/(google|apple|linkedin)\/callback$/.test(path);
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method!) &&
    !callback &&
    path !== "/api/v1/webhooks/razorpay" &&
    req.headers.origin !== origin
  )
    throw new ApiError(
      403,
      "ORIGIN_REJECTED",
      "The request origin could not be verified. Reload the page and try again.",
    );
  if (
    path.startsWith("/api/v1/auth/") ||
    path === "/api/v1/account" ||
    path.startsWith("/api/v1/account/") ||
    path.startsWith("/api/v1/verification") ||
    path.startsWith("/api/v1/profile") ||
    path.startsWith("/api/v1/admin/") ||
    path.startsWith("/api/v1/communities") ||
    path.startsWith("/api/v1/premium") ||
    path === "/api/v1/webhooks/razorpay" ||
    path === "/api/v1/reports" ||
    path === "/api/v1/safety/account" ||
    path.startsWith("/api/v1/discovery") ||
    path.startsWith("/api/v1/connections") ||
    path.startsWith("/api/v1/calls") ||
    path.startsWith("/api/v1/dates") ||
    [
      "/api/v1/inbox",
      "/api/v1/messages",
      "/api/v1/messages/receipt",
      "/api/v1/messages/image",
      "/api/v1/notifications",
      "/api/v1/notifications/read",
    ].includes(path)
  ) {
    // Only the web proxy can provide the client address. Direct callers are keyed by their socket.
    const address =
      req.headers["x-web-proxy-token"] === process.env.WEB_PROXY_TOKEN
        ? String(req.headers["x-client-address"] || req.socket.remoteAddress)
        : req.socket.remoteAddress || "unknown";
    const key =
      "rate:" +
      createHash("sha256")
        .update(address + ":" + Math.floor(Date.now() / 60000))
        .digest("hex");
    const count = await redis.eval(
      "local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],60) end;return n",
      { keys: [key], arguments: [] },
    );
    if (Number(count) > (process.env.APP_ENV === "local" ? 600 : 120))
      throw new ApiError(
        429,
        "RATE_LIMIT",
        "Too many requests. Try again in a minute.",
      );
    let payload: Buffer | undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (
          size >
          (path === "/api/v1/messages/image"
            ? 7 * 1024 * 1024
            : path === "/api/v1/profile/photo"
              ? 5 * 1024 * 1024
              : 32768)
        )
          throw new ApiError(
            413,
            "BODY_TOO_LARGE",
            "This request is too large.",
          );
        chunks.push(chunk);
      }
      payload = Buffer.concat(chunks);
    }
    const target =
      path === "/api/v1/communities/messages"
        ? "communication"
        : path.startsWith("/api/v1/communities")
          ? "commerce-operations"
          : path.startsWith("/api/v1/calls") || path.startsWith("/api/v1/dates")
            ? "communication"
            : [
                  "/api/v1/inbox",
                  "/api/v1/messages",
                  "/api/v1/messages/receipt",
                  "/api/v1/messages/image",
                  "/api/v1/notifications",
                  "/api/v1/notifications/read",
                ].includes(path)
              ? "communication"
              : path.startsWith("/api/v1/connections")
                ? "connections"
                : path.startsWith("/api/v1/premium") ||
                    path === "/api/v1/webhooks/razorpay" ||
                    path.startsWith("/api/v1/admin/") ||
                    path === "/api/v1/reports" ||
                    path === "/api/v1/safety/account"
                  ? "commerce-operations"
                  : path.startsWith("/api/v1/profile") ||
                      path.startsWith("/api/v1/discovery")
                    ? "profile-discovery"
                    : "identity";
    const headers: Record<string, string> = {
      authorization: `Bearer ${serviceToken(target)}`,
      "x-correlation-id": String(res.getHeader("x-correlation-id")),
    };
    for (const name of [
      "cookie",
      "content-type",
      "origin",
      "x-capture-id",
      "x-capture-token",
      "x-razorpay-signature",
      "x-razorpay-event-id",
    ])
      if (typeof req.headers[name] === "string")
        headers[name] = req.headers[name];
    const response = await fetch(`http://${target}:4000${req.url}`, {
      method: req.method,
      headers,
      body: payload as BodyInit | undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    for (const name of ["content-type", "location", "retry-after"])
      if (response.headers.has(name))
        res.setHeader(name, response.headers.get(name)!);
    const cookies = response.headers.getSetCookie();
    if (cookies.length) res.setHeader("set-cookie", cookies);
    res.setHeader("cache-control", "no-store");
    res.writeHead(response.status);
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  throw new ApiError(404, "NOT_FOUND", "This route does not exist.");
}, false);

websocketUpgrades(server, origin);
