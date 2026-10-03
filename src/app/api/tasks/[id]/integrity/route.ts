import { guard, jsonOk } from "@/lib/http.ts";
import { integrityView } from "@/lib/service.ts";
import { getScope } from "@/lib/session.ts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Recompute the whole chain and report the first broken link. */
export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  return guard(async () => {
    const { id } = await ctx.params;
    const result = await integrityView(await getScope(), id);

    return jsonOk(result, {
      // A broken chain is a real failure of this endpoint's purpose.
      status: result.integrity.ok ? 200 : 409,
      headers: { "cache-control": "no-store" },
    });
  });
}