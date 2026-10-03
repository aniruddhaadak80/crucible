import { guard, jsonError, jsonOk, queryString } from "@/lib/http.ts";
import { kaggleBundle } from "@/lib/service.ts";
import { viewTask } from "@/lib/service.ts";
import { getScope } from "@/lib/session.ts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The Kaggle Benchmarks bundle for one task.
 *
 * `GET ?file=<path>` downloads a single generated file; with no `file` the
 * whole bundle is returned as JSON so the agent console and the UI can show it.
 */
export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  return guard(async () => {
    const { id } = await ctx.params;
    const scope = await getScope();
    const view = await viewTask(scope, id);
    const bundle = kaggleBundle(view.task, view.verdict);

    const wanted = queryString(request, "file");

    if (wanted === null) {
      return jsonOk(bundle, { headers: { "cache-control": "no-store" } });
    }

    // Only files this generator produced may be served. No path traversal.
    const file = bundle.files.find((f) => f.path === wanted);
    if (!file) {
      return jsonError(
        "not_found",
        `No file named "${wanted}" in this bundle. Available: ${bundle.files.map((f) => f.path).join(", ")}`,
      );
    }

    const contentType =
      file.language === "python"
        ? "text/x-python; charset=utf-8"
        : file.language === "bash"
          ? "text/x-shellscript; charset=utf-8"
          : "text/markdown; charset=utf-8";

    return new Response(file.content, {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-disposition": `attachment; filename="${file.path}"`,
        "cache-control": "no-store",
      },
    });
  });
}