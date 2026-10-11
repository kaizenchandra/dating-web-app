import * as oidc from "openid-client";
import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ApiError,
  json,
  pool,
  redis,
} from "../../packages/shared-config/runtime.ts";
import {
  cookie,
  current,
  hash,
  issueSession,
  origin,
  setCookie,
} from "./security.ts";
const issuers = {
  google: "https://accounts.google.com",
  apple: "https://appleid.apple.com",
  linkedin: "https://www.linkedin.com",
};
export type Provider = keyof typeof issuers;
export const providers = Object.keys(issuers) as Provider[];
export function configured(provider: Provider) {
  return (
    !!process.env[`${provider.toUpperCase()}_CLIENT_ID`] &&
    !!process.env[`${provider.toUpperCase()}_CLIENT_SECRET`] &&
    (provider !== "apple" || origin.startsWith("https://"))
  );
}
const configs = new Map<Provider, oidc.Configuration>();
async function configuration(provider: Provider) {
  if (!configured(provider))
    throw new ApiError(
      503,
      "PROVIDER_NOT_CONFIGURED",
      "This sign-in provider is not configured. You can use mobile sign-in.",
    );
  if (configs.has(provider)) return configs.get(provider)!;
  try {
    const config = await oidc.discovery(
      new URL(
        provider === "linkedin"
          ? "https://www.linkedin.com/oauth/.well-known/openid-configuration"
          : issuers[provider],
      ),
      process.env[`${provider.toUpperCase()}_CLIENT_ID`]!,
      process.env[`${provider.toUpperCase()}_CLIENT_SECRET`]!,
      undefined,
      { timeout: 5 },
    );
    if (config.serverMetadata().issuer !== issuers[provider])
      throw new Error("Unexpected provider issuer");
    oidc.enableNonRepudiationChecks(config);
    configs.set(provider, config);
    return config;
  } catch {
    throw new ApiError(
      503,
      "PROVIDER_UNAVAILABLE",
      "The sign-in provider is unavailable. Please retry later.",
    );
  }
}
export async function startOAuth(
  req: IncomingMessage,
  res: ServerResponse,
  provider: Provider,
  link: boolean,
) {
  const account = await current(req, true);
  if (
    link &&
    (!account ||
      Date.now() - new Date(account.reauthenticated_at).getTime() > 600000)
  )
    throw new ApiError(
      401,
      "REAUTHENTICATE",
      "Sign in again before linking an account.",
    );
  if (!link && account)
    throw new ApiError(
      409,
      "ALREADY_SIGNED_IN",
      "Use account settings to link a provider.",
    );
  const config = await configuration(provider);
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const verifier = oidc.randomPKCECodeVerifier();
  const binding = randomBytes(32).toString("base64url");
  await redis.set(
    `oauth:${hash(state)}`,
    JSON.stringify({
      provider,
      nonce,
      verifier,
      binding: hash(binding),
      accountId: link ? account!.id : null,
      sessionHash: link ? hash(cookie(req, "raahi_session")) : null,
    }),
    { EX: 600 },
  );
  setCookie(res, "raahi_oauth", binding, 600, provider === "apple");
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: `${origin}/api/v1/auth/oauth/${provider}/callback`,
    scope: provider === "apple" ? "openid name email" : "openid profile email",
    state,
    nonce,
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    ...(provider === "apple" ? { response_mode: "form_post" } : {}),
  });
  json(res, 200, { url: url.href });
}
export async function callback(
  req: IncomingMessage,
  res: ServerResponse,
  provider: Provider,
) {
  const target = new URL(req.url!, origin);
  let form: URLSearchParams | undefined;
  if (req.method === "POST") {
    let text = "";
    for await (const chunk of req) {
      text += chunk.toString();
      if (text.length > 16384)
        throw new ApiError(413, "BODY_TOO_LARGE", "Invalid provider response.");
    }
    form = new URLSearchParams(text);
  }
  const params = form || target.searchParams;
  const state = params.get("state");
  let error = "PROVIDER_CALLBACK_FAILED";
  try {
    if (!state) throw new Error("state missing");
    const saved = await redis.getDel(`oauth:${hash(state)}`);
    if (!saved) throw new Error("state expired");
    const flow = JSON.parse(saved);
    if (
      flow.provider !== provider ||
      flow.binding !== hash(cookie(req, "raahi_oauth"))
    )
      throw new Error("binding mismatch");
    if (params.has("error")) {
      error =
        params.get("error") === "access_denied"
          ? "PROVIDER_CANCELLED"
          : "PROVIDER_UNAVAILABLE";
      throw new Error("provider rejected");
    }
    if (flow.accountId) {
      // Apple form_post omits the Lax session cookie. Validate the initiating
      // session server-side after validating the Secure, browser-bound flow cookie.
      const session = await pool.query(
        "SELECT s.account_id FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>now() AND NOT a.restricted",
        [flow.sessionHash],
      );
      if (session.rows[0]?.account_id !== flow.accountId)
        throw new Error("Link session revoked");
    }
    const config = await configuration(provider);
    const input = form
      ? new Request(target, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: form,
        })
      : target;
    const tokens = await oidc.authorizationCodeGrant(config, input, {
      expectedState: state,
      expectedNonce: flow.nonce,
      pkceCodeVerifier: flow.verifier,
    });
    const claims = tokens.claims();
    if (!claims?.sub) throw new Error("missing subject");
    const email = typeof claims.email === "string" ? claims.email : null;
    let name =
      typeof claims.name === "string" ? claims.name.slice(0, 120) : null;
    if (provider === "apple" && form?.get("user")) {
      try {
        const user = JSON.parse(form.get("user")!);
        name =
          [user.name?.firstName, user.name?.lastName]
            .filter((x) => typeof x === "string")
            .join(" ")
            .slice(0, 120) || name;
      } catch {
        /* optional first-login name is not authentication data */
      }
    }
    const client = await pool.connect();
    let token = "";
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `${provider}:${claims.sub}`,
      ]);
      const existing = await client.query(
        "SELECT account_id FROM provider_identities WHERE provider=$1 AND subject=$2",
        [provider, claims.sub],
      );
      if (
        flow.accountId &&
        existing.rowCount &&
        existing.rows[0].account_id !== flow.accountId
      ) {
        error = "ACCOUNT_LINK_CONFLICT";
        throw new Error("linked elsewhere");
      }
      const id = flow.accountId || existing.rows[0]?.account_id || randomUUID();
      if (!flow.accountId && !existing.rowCount)
        await client.query("INSERT INTO accounts(id) VALUES($1)", [id]);
      const account = await client.query(
        "SELECT restricted FROM accounts WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (account.rows[0].restricted) {
        error = "ACCOUNT_RESTRICTED";
        throw new Error("restricted");
      }
      await client.query(
        "INSERT INTO provider_identities(provider,subject,account_id,email,name) VALUES($1,$2,$3,$4,$5) ON CONFLICT(provider,subject) DO UPDATE SET email=coalesce(EXCLUDED.email,provider_identities.email),name=coalesce(EXCLUDED.name,provider_identities.name)",
        [provider, claims.sub, id, email, name],
      );
      if (flow.sessionHash)
        await client.query("DELETE FROM sessions WHERE token_hash=$1", [
          flow.sessionHash,
        ]);
      token = await issueSession(client, id, req);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      if ((e as { code?: string }).code === "23505")
        error = "ACCOUNT_LINK_CONFLICT";
      throw e;
    } finally {
      client.release();
    }
    setCookie(res, "raahi_session", token, 604800);
    setCookie(res, "raahi_oauth", "", 0, provider === "apple");
    res.writeHead(303, {
      location: "/onboarding",
      "cache-control": "no-store",
    });
    res.end();
    return;
  } catch {
    setCookie(res, "raahi_oauth", "", 0, provider === "apple");
    res.writeHead(303, {
      location: `/login?error=${error}`,
      "cache-control": "no-store",
    });
    res.end();
  }
}
