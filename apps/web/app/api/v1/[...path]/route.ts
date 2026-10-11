import type { NextRequest } from "next/server";
import { trustedClientAddress } from "../../../../../../packages/shared-config/client-address";
async function proxy(request: NextRequest) {
  try {
    const headers = new Headers();
    for (const key of [
      "cookie",
      "content-type",
      "origin",
      "x-capture-id",
      "x-capture-token",
      "x-razorpay-signature",
      "x-razorpay-event-id",
    ])
      if (request.headers.has(key)) headers.set(key, request.headers.get(key)!);
    const address = trustedClientAddress(
      request.headers,
      process.env.EDGE_PROXY_TOKEN,
    );
    const local =
      process.env.APP_ENV === "local" ||
      (!process.env.APP_ENV &&
        process.env.NODE_ENV === "development" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(request.nextUrl.hostname));
    if (!local && !address)
      return Response.json(
        {
          error: {
            code: "EDGE_REQUIRED",
            message:
              "The request could not be verified. Please retry through the configured site address.",
            correlationId: crypto.randomUUID(),
          },
        },
        { status: 503 },
      );
    headers.set("x-web-proxy-token", process.env.SERVICE_TOKEN || "");
    headers.set("x-client-address", address || "local-web");
    let body: Uint8Array | undefined;
    if (request.method !== "GET" && request.method !== "HEAD") {
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (reader)
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (
            length >
            (request.nextUrl.pathname === "/api/v1/messages/image"
              ? 7 * 1024 * 1024
              : request.nextUrl.pathname === "/api/v1/profile/photo"
                ? 5 * 1024 * 1024
                : 32768)
          ) {
            await reader.cancel();
            return Response.json(
              {
                error: {
                  code: "BODY_TOO_LARGE",
                  message: "Request too large.",
                  correlationId: crypto.randomUUID(),
                },
              },
              { status: 413 },
            );
          }
          chunks.push(value);
        }
      body = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
      }
    }
    const url = `${process.env.GATEWAY_URL || "http://localhost:4000"}${request.nextUrl.pathname}${request.nextUrl.search}`;
    const response = await fetch(url, {
      method: request.method,
      headers,
      body: body as BodyInit | undefined,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    const output = new Headers({ "cache-control": "no-store" });
    for (const key of [
      "content-type",
      "location",
      "retry-after",
      "x-correlation-id",
    ])
      if (response.headers.has(key))
        output.set(key, response.headers.get(key)!);
    for (const cookie of response.headers.getSetCookie())
      output.append("set-cookie", cookie);
    return new Response(response.body, {
      status: response.status,
      headers: output,
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "GATEWAY_UNAVAILABLE",
          message: "Unable to reach Raahi. Please retry.",
          correlationId: crypto.randomUUID(),
        },
      },
      { status: 503 },
    );
  }
}
export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
