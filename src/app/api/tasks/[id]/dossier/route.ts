import { guard, jsonError, jsonOk, queryString } from "@/lib/http.ts";
import { integrityView, viewTask } from "@/lib/service.ts";
import { getScope } from "@/lib/session.ts";
import { filenameFor, toCsv, toJson, toMarkdown, type DossierInput } from "@/lib/dossier.ts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Downloadable dossier. `?format=markdown|json|csv` streams a file with a
 * Content-Disposition header so the browser saves it rather than rendering it.
 */
export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  return guard(async () => {
    const { id } = await ctx.params;
    const scope = await getScope();
    const format = (queryString(request, "format") ?? "markdown").toLowerCase();

    if (!["markdown", "json", "csv"].includes(format)) {
      return jsonError("bad_request", "format must be markdown, json or csv");
    }

    const view = await viewTask(scope, id);
    const integrity = await integrityView(scope, id);

    const input: DossierInput = {
      task: view.task,
      verdict: view.verdict,
      grade: view.grade,
      integrity: integrity.integrity,
      attribution: null,
    };

    const extension = format === "markdown" ? "md" : format;
    const body =
      format === "json" ? toJson(input) : format === "csv" ? toCsv(input) : toMarkdown(input);

    return new Response(body, {
      status: 200,
      headers: {
        "content-type":
          format === "json"
            ? "application/json; charset=utf-8"
            : format === "csv"
              ? "text/csv; charset=utf-8"
              : "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${filenameFor(view.task, extension)}"`,
        "cache-control": "no-store",
      },
    });
  });
}

/** The same dossier as JSON for the on-page preview. */
export async function POST(_request: Request, ctx: Ctx): Promise<Response> {
  return guard(async () => {
    const { id } = await ctx.params;
    const scope = await getScope();
    const view = await viewTask(scope, id);
    const integrity = await integrityView(scope, id);
    return jsonOk({
      task: view.task,
      verdict: view.verdict,
      grade: view.grade,
      integrity: integrity.integrity,
    });
  });
}