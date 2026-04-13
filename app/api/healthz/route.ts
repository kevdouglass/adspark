/**
 * GET /api/healthz — Container health + graceful-shutdown drain probe.
 *
 * This route is consumed by Docker's HEALTHCHECK, compose's
 * healthcheck, Kubernetes readiness probes, and any reverse proxy
 * that needs to know whether to route new traffic to this instance.
 *
 * Behavior:
 *   - Normal operation → 200 with the full HealthReport payload
 *   - SIGTERM received, draining in-flight requests → 503 with the
 *     same payload (load balancers stop routing new traffic)
 *
 * The payload deliberately exposes the TIMEOUT CONTRACT so a reverse
 * proxy configuration can be smoke-tested against it:
 *
 *   curl -s http://adspark:3000/api/healthz | jq .recommendedProxyTimeoutMs
 *
 * If the proxy's idle timeout is below that number, the client-side
 * AbortSignal (135s) never fires because the proxy kills the stream
 * first, and users see an opaque 502/504 from the proxy instead of a
 * clean typed error envelope from the route handler. Making the
 * required config a queryable contract turns a silent footgun into a
 * deployment checklist item.
 *
 * Thin route handler per the project's architecture discipline — all
 * logic lives in `lib/api/services.ts::getHealth()` so the route is a
 * 3-line delegate. Tests target the service function directly; this
 * route is covered by a single-shape route test.
 */

import { NextResponse } from "next/server";
import { getHealth, isShuttingDown } from "@/lib/api/services";

// Next.js 15 defaults GET handlers to static where possible. Force
// dynamic so the shutdown flag is read at request time, not baked in
// at build time.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const health = getHealth();
  const status = isShuttingDown() ? 503 : 200;
  return NextResponse.json(health, {
    status,
    headers: {
      // Never cache the health response — clients poll this endpoint
      // during shutdown expecting a 200→503 transition within one
      // poll interval.
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
