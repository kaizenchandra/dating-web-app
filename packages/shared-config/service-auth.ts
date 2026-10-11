// Each receiver has its own credential. Containers receive only credentials
// for their declared downstream services; the browser proxy has a separate key.
export function serviceToken(service: string): string {
  const tokens = JSON.parse(process.env.SERVICE_TOKENS || "{}") as Record<
    string,
    string
  >;
  const token = tokens[service];
  if (typeof token !== "string" || token.length < 32)
    throw new Error("Internal destination credential is unavailable");
  return token;
}
