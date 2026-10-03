import {
  guard,
  jsonError,
  jsonOk,
  queryString,
  rateLimit,
  readJsonBody,
} from "@/lib/http.ts";
import { createTaskView, listTaskViews } from "@/lib/service.ts";
import { ensureSeed } from "@/lib/db/repository.ts";
import { getActor, getScope } from "@/lib/session.ts";
import { parseTaskInput } from "@/lib/validate.ts";
import { TASK_STATUSES, type TaskStatus } from "@/lib/types.ts";

export const dynamic = "force-dynamic";

/** Bounded page size. A public endpoint must not be asked for 10k rows. */
const MAX_LIMIT = 50;

export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const scope = await getScope();
    await ensureSeed();

    const rawLimit = queryString(request, "limit");
    // `Number(null)` is 0, which would silently clamp every listing to one row.
    const parsedLimit = rawLimit === null ? 20 : Number.parseInt(rawLimit, 10);
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), MAX_LIMIT)
      : 20;

    const rawStatus = queryString(request, "status");
    let status: TaskStatus | null = null;
    if (rawStatus !== null) {
      if (!(TASK_STATUSES as readonly string[]).includes(rawStatus)) {
        return jsonError("bad_request", `status must be one of ${TASK_STATUSES.join(", ")}`);
      }
      status = rawStatus as TaskStatus;
    }

    const result = await listTaskViews(scope, {
      limit,
      before: queryString(request, "before"),
      status,
      includeRetired: queryString(request, "includeRetired") === "true",
    });

    return jsonOk(result, {
      headers: { "cache-control": "no-store" },
    });
  });
}

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const scope = await getScope();
    const actor = await getActor("ui");

    // Best-effort throttle: one forged task per second per session is plenty
    // for a human and still lets an agent drive the endpoint.
    const limit = rateLimit(`forge:${scope}`, 20, 60_000);
    if (!limit.ok) {
      return jsonError("rate_limited", `Too many forges. Try again in ${limit.retryAfter}s.`);
    }

    const body = await readJsonBody(request);
    const input = parseTaskInput(body, "create");
    const view = await createTaskView(
      scope,
      input as { name: string; failureMode: string; prompt: string },
      actor,
    );

    return jsonOk(view, { status: 201 });
  });
}