import { serviceToken } from "../../packages/shared-config/service-auth.ts";
import { recoveryRoute } from "./recovery.ts";
import { communitiesRoute, hostReview } from "./communities.ts";
import { commerceRoute, syncSubscription } from "./commerce.ts";
import { privacyRoute } from "./privacy.ts";
import { staffMfa } from "./mfa.ts";
import { reportsRoute, moderationRoute } from "./reports.ts";
import { reviewDeliveryRoute, reconcileReviews } from "./review-delivery.ts";
import { z } from "zod";
import {
  startDependencies,
  serve,
  ApiError,
  json,
  pool,
} from "../../packages/shared-config/runtime.ts";
import { migrate } from "../../packages/shared-config/migrate.ts";
await startDependencies();
await migrate(new URL("./migrations/", import.meta.url));
async function internal(
  service: string,
  path: string,
  options: RequestInit = {},
) {
  const response = await fetch(`http://${service}:4000${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${serviceToken(service)}`,
      "content-type": "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(3000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      response.status,
      data.error?.code || "DEPENDENCY_UNAVAILABLE",
      data.error?.message || "This service is unavailable.",
    );
  return data;
}
serve(async (req, res) => {
  const path = new URL(req.url!, "http://operations").pathname;
  if (await communitiesRoute(req, res, path)) return;
  if (await commerceRoute(req, res, path)) return;
  if (await privacyRoute(req, res, path)) return;
  if (await reportsRoute(req, res, path, internal)) return;
  if (!path.startsWith("/api/v1/admin/"))
    throw new ApiError(404, "NOT_FOUND", "This route does not exist.");
  const account = await internal("identity", "/internal/identity/me", {
    headers: { cookie: req.headers.cookie || "" },
  });
  const role = await pool.query(
    "SELECT role FROM staff_roles WHERE account_id=$1",
    [account.id],
  );
  if (!role.rowCount)
    throw new ApiError(
      403,
      "STAFF_REQUIRED",
      "This area is restricted to authorised review staff.",
    );
  if (await staffMfa(req, res, path, account)) return;
  if (await recoveryRoute(req, res, path, account, role.rows[0].role, internal))
    return;
  if (path === "/api/v1/admin/media" && req.method === "GET") {
    return json(
      res,
      200,
      await internal("profile-discovery", "/internal/media/status"),
    );
  }
  if (path === "/api/v1/admin/reviews/photo" && req.method === "GET") {
    const id = z
      .string()
      .uuid()
      .parse(
        new URL(req.url!, "http://operations").searchParams.get("accountId"),
      );
    const response = await fetch(
      "http://profile-discovery:4000/internal/reviews/photo?accountId=" + id,
      {
        headers: {
          authorization: `Bearer ${serviceToken("profile-discovery")}`,
        },
        signal: AbortSignal.timeout(3000),
      },
    );
    if (!response.ok)
      throw new ApiError(
        response.status,
        "PHOTO_UNAVAILABLE",
        "Review photo is unavailable.",
      );
    res.writeHead(200, {
      "content-type": "image/jpeg",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  if (await hostReview(req, res, path, account.id)) return;
  if (await moderationRoute(req, res, path, account.id, internal)) return;
  if (path === "/api/v1/admin/reviews" && req.method === "GET") {
    const [identity, photos] = await Promise.all([
      internal("identity", "/internal/reviews"),
      internal("profile-discovery", "/internal/reviews"),
    ]);
    return json(res, 200, {
      reviews: [...identity.reviews, ...photos.reviews],
    });
  }
  if (await reviewDeliveryRoute(req, res, path, account.id)) return;
  throw new ApiError(404, "NOT_FOUND", "This route does not exist.");
});

setInterval(
  () =>
    Promise.all([
      pool.query(
        "DELETE FROM reports WHERE created_at<now()-interval '365 days'",
      ),
      pool.query(
        "DELETE FROM review_audit WHERE created_at<now()-interval '365 days'",
      ),
      pool.query(
        "DELETE FROM recovery_actions WHERE created_at<now()-interval '365 days' AND status='confirmed'",
      ),
    ]).catch(() => console.error('{"event":"retention_cleanup_failed"}')),
  3600000,
).unref();

let reconciling = false;
setInterval(async () => {
  if (reconciling) return;
  reconciling = true;
  try {
    const rows = await pool.query(
      "SELECT id FROM subscriptions WHERE (provider_id IS NOT NULL OR provider_order_id IS NOT NULL) AND updated_at<now()-interval '5 minutes' ORDER BY updated_at LIMIT 10",
    );
    for (const row of rows.rows) await syncSubscription(row.id);
  } catch {
    console.error('{"event":"payment_reconciliation_failed"}');
  } finally {
    reconciling = false;
  }
}, 60000).unref();

setInterval(
  () =>
    reconcileReviews().catch(() =>
      console.error('{"event":"review_reconciliation_failed"}'),
    ),
  5000,
).unref();
