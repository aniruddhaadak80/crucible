import { guard, jsonOk, rateLimit, readJsonBody } from "@/lib/http.ts";
import { getSettings, putSettings } from "@/lib/service.ts";
import { describeAdapter, ping } from "@/lib/db/client.ts";
import { getScope } from "@/lib/session.ts";
import { ValidationError } from "@/lib/db/repository.ts";
import { GRADE_BANDS, WEIGHT_SUM } from "@/lib/grade.ts";
import { ENGINE_METADATA } from "@/lib/service.ts";
import { SITE } from "@/lib/site.ts";
import { SEALED_HUB } from "@/lib/live/fallback.ts";
import { defaultLineup } from "@/lib/live/index.ts";

export const dynamic = "force-dynamic";

/**
 * Settings and diagnostics.
 *
 * GET is informational and includes a real store round trip. PUT persists the
 * per-scope preferences the UI actually reads back.
 */

export type ScopeSettings = {
  /** Preferred token budget applied to new tasks. */
  defaultTokenBudget?: number;
  /** Whether the lineup page should probe closed models. */
  showClosedModels?: boolean;
};

export async function GET(): Promise<Response> {
  return guard(async () => {
    const scope = await getScope();
    const [saved, probe] = await Promise.all([getSettings(scope), ping()]);
    const adapter = describeAdapter();

    return jsonOk({
      scope: `${scope.slice(0, 8)}…`,
      settings: saved ?? {},
      store: {
        kind: probe.kind,
        ok: probe.ok,
        durable: adapter.durable,
        note: adapter.note,
        roundTrip: probe.detail,
      },
      engine: {
        ...ENGINE_METADATA,
        weightSum: round4(WEIGHT_SUM),
        bands: GRADE_BANDS,
      },
      endpoints: {
        api: SITE.apiBase,
        agent: SITE.agentEndpoint,
        health: `${SITE.apiBase}/health`,
        manifest: `${SITE.liveUrl}/mcp.json`,
      },
      feedSnapshot: {
        capturedAt: defaultLineup().fetchedAt,
        models: SEALED_HUB.length,
      },
    });
  });
}

export async function PUT(request: Request): Promise<Response> {
  return guard(async () => {
    const scope = await getScope();

    const limit = rateLimit(`settings:${scope}`, 30, 60_000);
    if (!limit.ok) {
      return Response.json(
        { error: { code: "rate_limited", message: `Too many updates. Try again in ${limit.retryAfter}s.` } },
        { status: 429 },
      );
    }

    const body = await readJsonBody(request);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new ValidationError([{ path: "body", message: "must be a JSON object" }]);
    }

    const record = body as Record<string, unknown>;
    const details: { path: string; message: string }[] = [];
    const next: ScopeSettings = {};

    if (record.defaultTokenBudget !== undefined) {
      const value = record.defaultTokenBudget;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10_000_000) {
        details.push({ path: "defaultTokenBudget", message: "must be a number between 0 and 10000000" });
      } else {
        next.defaultTokenBudget = Math.trunc(value);
      }
    }

    if (record.showClosedModels !== undefined) {
      if (typeof record.showClosedModels !== "boolean") {
        details.push({ path: "showClosedModels", message: "must be true or false" });
      } else {
        next.showClosedModels = record.showClosedModels;
      }
    }

    if (details.length > 0) throw new ValidationError(details);

    const saved = await putSettings(scope, next as Record<string, unknown>);
    return jsonOk({ settings: saved });
  });
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}