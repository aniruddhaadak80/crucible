import { guard, jsonOk } from "@/lib/http.ts";
import { ARXIV_QUERY, arxivFeed, defaultLineup, hubLineup } from "@/lib/live/index.ts";

export const dynamic = "force-dynamic";

/**
 * Live external data, normalised.
 *
 * Both sources are independent, so a failure in one still leaves the other
 * live. Each envelope carries `status: live | fallback` plus the reason it
 * degraded, and the client is required to render that distinction.
 */
export async function GET(): Promise<Response> {
  return guard(async () => {
    const lineupIds = [
      "Qwen/Qwen2.5-72B-Instruct",
      "meta-llama/Llama-3.1-70B-Instruct",
      "mistralai/Mistral-7B-Instruct-v0.3",
      "deepseek-ai/DeepSeek-V3",
      "google/gemini-2.5-flash",
      "anthropic/claude-sonnet-4",
      "openai/gpt-4.1",
    ];

    // Independent sources, so fetch them together and never let one abort the other.
    const [hub, papers] = await Promise.all([
      hubLineup(lineupIds).catch(() => defaultLineup()),
      arxivFeed(ARXIV_QUERY, 8).catch(() => null),
    ]);

    return jsonOk(
      {
        hub,
        papers: papers ?? {
          status: "fallback" as const,
          fetchedAt: new Date().toISOString(),
          sourceName: "arXiv (unavailable)",
          sourceUrl: "https://arxiv.org/",
          attribution: "Preprints from arXiv.",
          degradedReason: "The arXiv request failed outright.",
          items: [],
        },
      },
      { headers: { "cache-control": "no-store" } },
    );
  });
}