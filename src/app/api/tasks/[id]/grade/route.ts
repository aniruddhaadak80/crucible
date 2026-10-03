import { guard, jsonError, jsonOk, rateLimit } from "@/lib/http.ts";
import { gradeTaskView } from "@/lib/service.ts";
import { getActor, getScope } from "@/lib/session.ts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Re-run the engine and append the verdict to the audit chain.
 *
 * POST rather than GET because grading here is not free: it records that a
 * grade was taken, which is a mutation, and it costs an upstream model lookup.
 */
export async function POST(_request: Request, ctx: Ctx): Promise<Response> {
  return guard(async () => {
    const { id } = await ctx.params;
    const scope = await getScope();
    const actor = await getActor("ui");

    const limit = rateLimit(`grade:${scope}`, 60, 60_000);
    if (!limit.ok) {
      return jsonError("rate_limited", `Too many grades. Try again in ${limit.retryAfter}s.`);
    }

    const result = await gradeTaskView(scope, id, actor);

    return jsonOk({
      verdict: result.verdict,
      grade: result.grade,
      modelFacts: result.modelFacts,
      seal: result.seal,
    });
  });
}