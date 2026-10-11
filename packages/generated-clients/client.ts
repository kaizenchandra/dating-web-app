import type { paths } from "./schema";
export type PlatformStatus =
  paths["/status"]["get"]["responses"][200]["content"]["application/json"];
const base = process.env.NEXT_PUBLIC_GATEWAY_URL || "/api/v1";
export async function getStatus(signal?: AbortSignal): Promise<PlatformStatus> {
  const response = await fetch(`${base}/status`, {
    signal,
    credentials: "same-origin",
  });
  const data = await response.json();
  if (!data.services)
    throw new Error(data.error?.message || "Unable to reach the platform.");
  return data;
}
export type Account =
  paths["/account"]["get"]["responses"][200]["content"]["application/json"];
type Method<P extends keyof paths> = Extract<
  keyof paths[P],
  "get" | "post" | "patch" | "put" | "delete"
>;
type Operation<P extends keyof paths, M extends Method<P>> = paths[P][M];
type RequestBody<P extends keyof paths, M extends Method<P>> =
  Operation<P, M> extends {
    requestBody: { content: { "application/json": infer B } };
  }
    ? B
    : undefined;
type Result<P extends keyof paths, M extends Method<P>> =
  Operation<P, M> extends {
    responses: { 200: { content: { "application/json": infer R } } };
  }
    ? R
    : never;
export class ClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function api<P extends keyof paths, M extends Method<P>>(
  path: P,
  method: M,
  body?: RequestBody<P, M>,
  signal?: AbortSignal,
  query?: Record<string, string>,
): Promise<Result<P, M>> {
  const response = await fetch(
    `${base}${path}${query ? `?${new URLSearchParams(query)}` : ""}`,
    {
      method: method.toUpperCase(),
      credentials: "same-origin",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    },
  );
  const data = await response.json();
  if (!response.ok)
    throw new ClientError(
      response.status,
      data.error?.code || "REQUEST_FAILED",
      data.error?.message || "Unable to complete the request. Please retry.",
    );
  return data;
}

export type Profile =
  paths["/profile"]["put"]["requestBody"]["content"]["application/json"];
export type ProfileResult =
  paths["/profile"]["get"]["responses"][200]["content"]["application/json"];
export type Verification =
  paths["/verification"]["get"]["responses"][200]["content"]["application/json"];
export async function submitPhoto(
  blob: Blob,
  capture: { captureId: string; token: string },
  signal?: AbortSignal,
): Promise<ProfileResult> {
  const response = await fetch(`${base}/profile/photo`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": blob.type,
      "x-capture-id": capture.captureId,
      "x-capture-token": capture.token,
    },
    body: blob,
    signal,
  });
  const result = await response.json();
  if (!response.ok)
    throw new ClientError(
      response.status,
      result.error?.code,
      result.error?.message || "Photo could not be saved.",
    );
  return result;
}
export const ownPhotoUrl = () => `${base}/profile/photo`;
export type Candidate =
  paths["/discovery"]["get"]["responses"][200]["content"]["application/json"]["items"][number];
export type Connections =
  paths["/connections"]["get"]["responses"][200]["content"]["application/json"];
export const candidatePhotoUrl = (id: string) =>
  `${base}/discovery/photo?id=${encodeURIComponent(id)}`;
export async function discover(
  filters: Record<string, string>,
  signal?: AbortSignal,
): Promise<
  paths["/discovery"]["get"]["responses"][200]["content"]["application/json"]
> {
  if (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("curated") === "1"
  )
    filters = { ...filters, curated: "1" };
  const response = await fetch(
    `${base}/discovery?${new URLSearchParams(filters)}`,
    { credentials: "same-origin", signal },
  );
  const data = await response.json();
  if (!response.ok)
    throw new ClientError(
      response.status,
      data.error?.code,
      data.error?.message || "Discovery is unavailable.",
    );
  return data;
}

export type Message =
  paths["/messages"]["get"]["responses"][200]["content"]["application/json"]["messages"][number];
export type Inbox =
  paths["/inbox"]["get"]["responses"][200]["content"]["application/json"];
export function socketUrl() {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  const url = new URL("/api/v1/socket", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "3000")
    url.port = "4000";
  return url.href;
}
export type Call =
  paths["/calls"]["get"]["responses"][200]["content"]["application/json"]["calls"][number];
export type DatePlan =
  paths["/dates"]["get"]["responses"][200]["content"]["application/json"]["plans"][number];

export const reviewPhotoUrl = (id: string) =>
  `${base}/admin/reviews/photo?accountId=${encodeURIComponent(id)}`;

export function messageImageUrl(id: string) {
  return `${base}/messages/image?id=${encodeURIComponent(id)}`;
}
