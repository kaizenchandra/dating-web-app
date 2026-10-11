export async function GET() {
  try {
    const response = await fetch(
      `${process.env.GATEWAY_URL || "http://localhost:4000"}/api/v1/status`,
      { cache: "no-store", signal: AbortSignal.timeout(5000) },
    );
    return new Response(await response.text(), {
      status: response.status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "GATEWAY_UNAVAILABLE",
          message: "The platform is unavailable. Please retry.",
          correlationId: crypto.randomUUID(),
        },
      },
      { status: 503 },
    );
  }
}
