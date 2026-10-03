import { guard, jsonError, jsonOk, rateLimit, readJsonBody } from "@/lib/http.ts";
import { retireTaskView, updateTaskView, viewTask } from "@/lib/service.ts";
import { getActor, getScope } from "@/lib/session.ts";
import { parseTaskInput } from "@/lib/validate.ts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  return guard(async () => {
    const { id } = await ctx.params;
    const view = await viewTask(await getScope(), id);
    return jsonOk(view, { headers: { "cache-control": "no-store" } });
  });
}

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  return guard(async () => {
    const { id } = await ctx.params;
    const scope = await getScope();
    const actor = await getActor("ui");

    const limit = rateLimit(`revise:${scope}`, 40, 60_000);
    if (!limit.ok) {
      return jsonError("rate_limited", `Too many revisions. Try again in ${limit.retryAfter}s.`);
    }

    const body = await readJsonBody(request);
    const patch = parseTaskInput(body, "update");
    const view = await updateTaskView(scope, id, patch, actor);
    return jsonOk(view);
  });
}

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  return guard(async () => {
    const { id } = await ctx.params;
    const scope = await getScope();
    const actor = await getActor("ui");

    const limit = rateLimit(`retire:${scope}`, 20, 60_000);
    if (!limit.ok) {
      return jsonError("rate_limited", `Too many retirements. Try again in ${limit.retryAfter}s.`);
    }

    // Soft delete. The tombstone is retained so the audit chain still replays,
    // and the replay result is returned so the caller sees the proof directly.
    const result = await retireTaskView(scope, id, actor);
    return jsonOk({
      retired: true,
      task: { id: result.task.id, deletedAt: result.task.deletedAt, status: result.task.status },
      integrity: result.integrity,
    });
  });
}