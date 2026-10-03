/**
 * Live external data, normalised.
 *
 * Two independent public sources, both key-free:
 *
 *  - Hugging Face Hub model API. Answers the question a benchmark author
 *    actually has: can a third party reproduce this row? It tells you whether
 *    the weights are gated and whether there is an immutable revision to pin.
 *  - arXiv API. Shows which capability benchmarks are being published right now,
 *    with the model lineups named in the abstracts.
 *
 * Every function here returns a `FeedEnvelope` whose `status` is `live` or
 * `fallback`. Nothing downstream is allowed to guess which it got.
 */

import type {
  ArxivPaper,
  FeedEnvelope,
  HubModelFacts,
  ModelFacts,
} from "../types.ts";
import { fetchJson, fetchText } from "./upstream.ts";
import {
  ARXIV_ATTRIBUTION,
  ARXIV_SNAPSHOT_DATE,
  CLOSED_MODEL_NOTES,
  HUB_ATTRIBUTION,
  HUB_SNAPSHOT_DATE,
  SEALED_ARXIV,
  SEALED_HUB,
} from "./fallback.ts";

const HUB_BASE = "https://huggingface.co/api/models/";
const HUB_PAGE = "https://huggingface.co/";
const ARXIV_ENDPOINT = "http://export.arxiv.org/api/query";
const ARXIV_PAGE = "https://arxiv.org/list/cs.CL/recent";

/** Two-plus minute cache. Enough to keep one visitor off the upstream's back. */
const REVALIDATE_SECONDS = 180;

/* ------------------------------------------------------------------ *
 * Hugging Face Hub
 * ------------------------------------------------------------------ */

type HubResponse = {
  modelId?: string;
  downloads?: number;
  likes?: number;
  gated?: boolean | string;
  pipeline_tag?: string;
  sha?: string;
  createdAt?: string;
  lastModified?: string;
  cardData?: { license?: string };
};

/** Only `owner/name`, so a model id can never walk out of the Hub path. */
export function isValidHubId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,64}\/[A-Za-z0-9][A-Za-z0-9._-]{0,96}$/.test(id);
}

function mapHub(id: string, raw: HubResponse): HubModelFacts {
  const gatedRaw = raw.gated;
  return {
    modelId: raw.modelId ?? id,
    likes: typeof raw.likes === "number" ? raw.likes : null,
    downloads: typeof raw.downloads === "number" ? raw.downloads : null,
    // The API uses `false` or a gate name such as "manual".
    gated: gatedRaw === undefined ? null : gatedRaw === false ? false : true,
    license: raw.cardData?.license ?? null,
    pipelineTag: raw.pipeline_tag ?? null,
    revision: raw.sha ?? null,
    createdAt: raw.createdAt ?? null,
    lastModified: raw.lastModified ?? null,
  };
}

/**
 * Look up one model on the Hub. A 401 or 404 is a *finding*, not an error:
 * it means the model publishes no public repository, so no revision can be
 * pinned by a third party.
 */
export async function lookupHubModel(
  modelId: string,
): Promise<{ found: boolean; facts: HubModelFacts | null }> {
  if (!isValidHubId(modelId)) return { found: false, facts: null };

  const result = await fetchJson<HubResponse>(`${HUB_BASE}${modelId}`, {
    revalidate: REVALIDATE_SECONDS,
  });

  if (!result.ok) return { found: false, facts: null };
  return { found: true, facts: mapHub(modelId, result.value) };
}

/** Engine-facing projection of the Hub lookup. */
export async function lookupModel(modelId: string): Promise<ModelFacts> {
  const fetchedAt = new Date().toISOString();
  const { found, facts } = await lookupHubModel(modelId);

  if (!found || !facts) {
    return {
      modelId,
      found: false,
      gated: null,
      license: null,
      downloads30d: null,
      likes: null,
      revision: null,
      pipelineTag: null,
      source: "unavailable",
      fetchedAt,
    };
  }

  return {
    modelId: facts.modelId,
    found: true,
    gated: facts.gated,
    license: facts.license,
    downloads30d: facts.downloads,
    likes: facts.likes,
    revision: facts.revision,
    pipelineTag: facts.pipelineTag,
    source: "huggingface",
    fetchedAt,
  };
}

/** Bounded batch. Never more than eight upstream calls for one page render. */
export async function lookupModels(modelIds: string[]): Promise<ModelFacts[]> {
  const unique = Array.from(new Set(modelIds.filter(isValidHubId))).slice(0, 8);
  return Promise.all(unique.map(lookupModel));
}

/** The model lineup used when nothing has been recorded yet. */
export function defaultLineup(): FeedEnvelope<HubModelFacts> {
  return {
    status: "fallback",
    fetchedAt: HUB_SNAPSHOT_DATE,
    sourceName: "Hugging Face Hub (sealed snapshot)",
    sourceUrl: HUB_PAGE,
    attribution: HUB_ATTRIBUTION,
    degradedReason:
      "Sealed snapshot recorded on 2026-10-03. These figures are what the Hub reported then, not what it reports now.",
    items: [...SEALED_HUB],
  };
}

/** Live model facts for a fixed, allowlisted lineup. */
export async function hubLineup(
  modelIds: string[],
): Promise<FeedEnvelope<HubModelFacts>> {
  const unique = Array.from(new Set(modelIds.filter(isValidHubId))).slice(0, 8);
  const looked = await Promise.all(unique.map((id) => lookupHubModel(id)));
  const usable = looked.flatMap((r) => (r.found && r.facts ? [r.facts] : []));

  if (usable.length === 0) {
    const sealed = defaultLineup();
    return {
      ...sealed,
      degradedReason: `No lineup model resolved on the Hub (${unique.length} probed). Showing the sealed snapshot instead.`,
    };
  }

  // Probe failures for specific closed models are surfaced, not silently dropped.
  const missing = looked
    .map((r, i) => (r.found ? null : unique[i]))
    .filter((v): v is string => v !== null);

  return {
    status: "live",
    fetchedAt: new Date().toISOString(),
    sourceName: "Hugging Face Hub API",
    sourceUrl: HUB_PAGE,
    attribution: HUB_ATTRIBUTION,
    degradedReason:
      missing.length > 0
        ? `Not published on the Hub, so no revision is pinnable: ${missing.join(", ")}.`
        : null,
    items: usable,
  };
}

/* ------------------------------------------------------------------ *
 * arXiv
 * ------------------------------------------------------------------ */

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function pick(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(block);
  return match ? decodeXml(match[1]) : null;
}

/**
 * Model lineups named in a title or abstract.
 *
 * Deliberately a fixed vocabulary rather than a heuristic. A wrong model name
 * in a "what is being benchmarked" panel is worse than a missing one, because
 * a reader will treat it as a measurement.
 */
const KNOWN_MODELS: readonly { pattern: RegExp; canonical: string }[] = [
  // Only a leading word boundary: a trailing one rejects the version digit in
  // "Qwen2.5" and silently drops a model that is plainly named in the title.
  { pattern: /\bgpt-?4(?:\.\d)?/i, canonical: "gpt-4" },
  { pattern: /\bclaude/i, canonical: "claude" },
  { pattern: /\bgemini/i, canonical: "gemini" },
  { pattern: /\bllama/i, canonical: "llama" },
  { pattern: /\bqwen/i, canonical: "qwen" },
  { pattern: /\bmistral/i, canonical: "mistral" },
  { pattern: /\bdeepseek/i, canonical: "deepseek" },
  { pattern: /\bgrok/i, canonical: "grok" },
  { pattern: /\bkimi/i, canonical: "kimi" },
];

export function detectModels(text: string): string[] {
  const found = new Set<string>();
  for (const { pattern, canonical } of KNOWN_MODELS) {
    if (pattern.test(text)) found.add(canonical);
  }
  return [...found].sort();
}

function parseAtom(xml: string): ArxivPaper[] {
  const entries = xml.split(/<entry>/).slice(1);
  const papers: ArxivPaper[] = [];

  for (const block of entries) {
    const slice = block.split("</entry>")[0] ?? block;
    const id = pick(slice, "id");
    const title = pick(slice, "title");
    if (!id || !title) continue;

    const summary = pick(slice, "summary") ?? "";
    const authors = [...slice.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((m) =>
      decodeXml(m[1]),
    );
    const categories = [...slice.matchAll(/<category[^>]*term="([^"]+)"/g)].map((m) => m[1]);

    papers.push({
      id: id.replace(/^https?:\/\/arxiv\.org\/abs\//, ""),
      title,
      summary,
      publishedAt: pick(slice, "published") ?? pick(slice, "updated") ?? "",
      updatedAt: pick(slice, "updated") ?? "",
      authors: authors.slice(0, 8),
      categories,
      url: id.startsWith("http") ? id : `https://arxiv.org/abs/${id}`,
      mentionedModels: detectModels(`${title} ${summary}`),
    });
  }

  return papers;
}

export function arxivFallback(): FeedEnvelope<ArxivPaper> {
  return {
    status: "fallback",
    fetchedAt: ARXIV_SNAPSHOT_DATE,
    sourceName: "arXiv (sealed snapshot)",
    sourceUrl: ARXIV_PAGE,
    attribution: ARXIV_ATTRIBUTION,
    degradedReason:
      "Sealed snapshot recorded on 2026-10-03. These preprints are what the API returned then.",
    items: [...SEALED_ARXIV],
  };
}

/** Newest first papers matching a bounded query. */
export async function arxivFeed(
  query: string,
  limit = 8,
): Promise<FeedEnvelope<ArxivPaper>> {
  const bounded = Math.min(Math.max(limit, 1), 20);
  const params = new URLSearchParams({
    search_query: query.slice(0, 200),
    start: "0",
    max_results: String(bounded),
    sortBy: "submittedDate",
    sortOrder: "descending",
  });

  const result = await fetchText(`${ARXIV_ENDPOINT}?${params.toString()}`, {
    revalidate: REVALIDATE_SECONDS,
    timeoutMs: 8000,
  });

  if (!result.ok) {
    return {
      ...arxivFallback(),
      degradedReason: `arXiv was unreachable (${result.reason}). Showing the sealed snapshot instead.`,
    };
  }

  const papers = parseAtom(result.value);
  if (papers.length === 0) {
    return {
      ...arxivFallback(),
      degradedReason:
        "arXiv returned no entries for this query. Showing the sealed snapshot instead.",
    };
  }

  return {
    status: "live",
    fetchedAt: new Date().toISOString(),
    sourceName: "arXiv API",
    sourceUrl: `https://arxiv.org/search/?query=${encodeURIComponent(query)}&searchtype=all`,
    attribution: ARXIV_ATTRIBUTION,
    degradedReason: null,
    items: papers,
  };
}

/** The query the lineup route uses. Capability-evaluation papers, newest first. */
export const ARXIV_QUERY = 'cat:cs.CL AND (abs:"benchmark" OR abs:"evaluation")';

/** Look up closed-model notes for the UI without another upstream call. */
export function closedModelNote(modelId: string): string | null {
  return CLOSED_MODEL_NOTES[modelId] ?? null;
}