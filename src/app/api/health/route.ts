import { describeAdapter, ping } from "@/lib/db/client.ts";
import { ensureSeed, listTasks } from "@/lib/db/repository.ts";
import { getScope } from "@/lib/session.ts";
import { guard, jsonOk } from "@/lib/http.ts";
import { ENGINE_VERSION, GRADER_VERSION } from "@/lib/types.ts";

/**
 * Health probe.
 *
 * This does not return a static success object. It resolves the real adapter,
 * performs a real round trip to the store, counts real rows, and reports which
 * adapter answered so an operator can tell a hosted database from the embedded
 * development one.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return guard(async () => {
    const startedAt = Date.now();
    const adapter = describeAdapter();
    const probe = await ping();

    let seeded = false;
    let rows = 0;
    let seedError: string | null = null;

    if (probe.ok) {
      try {
        const scope = await getScope();
        await ensureSeed();
        seeded = true;
        const listed = await listTasks(scope, { limit: 1 });
        rows = listed.total;
      } catch (error) {
        seedError = error instanceof Error ? error.message : "unknown error";
      }
    }

    const body = {
      status: probe.ok && seedError === null ? "ok" : "degraded",
      /** The store that actually answered the probe. */
      store: {
        kind: probe.kind,
        durable: adapter.durable,
        roundTrip: probe.detail,
        ok: probe.ok,
      },
      seed: { applied: seeded, rows, error: seedError },
      engine: { version: ENGINE_VERSION, grader: GRADER_VERSION },
      elapsedMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    };

    // A degraded store is a real failure and must not report 200.
    return jsonOk(body, { status: body.status === "ok" ? 200 : 503 });
  });
}