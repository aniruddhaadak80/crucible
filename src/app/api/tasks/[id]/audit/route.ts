import { guard, jsonOk } from "@/lib/http.ts";
import { listAudit, requireTask } from "@/lib/db/repository.ts";
import { getScope } from "@/lib/session.ts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** The append-only history for one task, oldest first. */
export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  return guard(async () => {
    const { id } = await ctx.params;
    const scope = await getScope();
    const task = await requireTask(scope, id);
    const events = await listAudit(scope, id);

    return jsonOk(
      {
        taskId: task.id,
        head: task.seal,
        count: events.length,
        events,
      },
      { headers: { "cache-control": "no-store" } },
    );
  });
}