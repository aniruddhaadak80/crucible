import { guard, jsonError, jsonOk, rateLimit, readJsonBody } from "@/lib/http.ts";
import { decideTaskView } from "@/lib/service.ts";
import { getActor, getScope } from "@/lib/session.ts";
import { parseDecision } from "@/lib/validate.ts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  return guard(async () => {
    const { id } = await ctx.params;
    const scope = await getScope();
    const actor = await getActor("ui");

    const limit = rateLimit(`decide:${scope}`, 40, 60_000);
    if (!limit.ok) {
      return jsonError("rate_limited", `Too many decisions. Try again in ${limit.retryAfter}s.`);
    }

    const body = await readJsonBody(request);
    const { verdict, note } = parseDecision(body);
    const view = await decideTaskView(scope, id, verdict, note, actor);

    return jsonOk({
      decision: view.task.decision,
      score: view.verdict.score,
      band: view.verdict.band,
      seal: view.task.seal,
    });
  });
}