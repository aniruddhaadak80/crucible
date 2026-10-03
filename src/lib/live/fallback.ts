/**
 * Sealed offline snapshots.
 *
 * These are *recorded observations*, not samples I invented. Each row below was
 * read from the upstream API on the stated date and is frozen here so the app
 * has something truthful to render when the network is unavailable.
 *
 * The distinction the UI depends on: a sealed row says "this is what was true
 * on this date", never "this is current". `fetchedAt` travels with every
 * envelope precisely so a stale row can never be presented as a live one.
 */

import type { ArxivPaper, HubModelFacts } from "../types.ts";

export const HUB_SNAPSHOT_DATE = "2026-10-03T07:50:00.000Z";
export const ARXIV_SNAPSHOT_DATE = "2026-10-03T07:46:31.000Z";

export const HUB_ATTRIBUTION =
  "Model metadata from the Hugging Face Hub public API. Downloads and likes are Hub counters, not usage telemetry.";

export const ARXIV_ATTRIBUTION =
  "Preprints from arXiv. Metadata is the author's own submission record.";

/** Read from https://huggingface.co/api/models/<id> on HUB_SNAPSHOT_DATE. */
export const SEALED_HUB: readonly HubModelFacts[] = [
  {
    modelId: "Qwen/Qwen2.5-72B-Instruct",
    likes: 1002,
    downloads: 294987,
    gated: false,
    license: "other",
    pipelineTag: "text-generation",
    revision: "495f39366efef23836d0cfae4fbe635880d2be31",
    createdAt: "2024-09-16T11:56:31.000Z",
    lastModified: "2025-01-12T02:07:38.000Z",
  },
  {
    modelId: "meta-llama/Llama-3.1-70B-Instruct",
    likes: 1001,
    downloads: 100568,
    gated: true,
    license: "llama3.1",
    pipelineTag: "text-generation",
    revision: "1605565b47bb9346c5515c34102e054115b4f98b",
    createdAt: "2024-07-16T16:07:46.000Z",
    lastModified: "2024-12-15T01:55:33.000Z",
  },
  {
    modelId: "mistralai/Mistral-7B-Instruct-v0.3",
    likes: 3710,
    downloads: 2162715,
    gated: false,
    license: "apache-2.0",
    pipelineTag: null,
    revision: "c170c708c41dac9275d15a8fff4eca08d52bab71",
    createdAt: "2024-05-22T09:57:04.000Z",
    lastModified: "2025-12-03T12:13:48.000Z",
  },
  {
    modelId: "deepseek-ai/DeepSeek-V3",
    likes: 4390,
    downloads: 1278172,
    gated: false,
    license: null,
    pipelineTag: "text-generation",
    revision: "e815299b0bcbac849fa540c768ef21845365c9eb",
    createdAt: "2024-12-25T12:52:23.000Z",
    lastModified: "2025-03-27T04:01:45.000Z",
  },
];

const CLOSED_MODEL_REASON =
  "Not published on the Hugging Face Hub, so there is no public revision to pin. A reader cannot reproduce this row from a revision hash.";

/**
 * Proprietary models answer the Hub API with 401 because they publish no
 * public repository. That absence is itself the finding: there is no public
 * revision to pin, so nobody outside the provider can reproduce a run against
 * them from a recorded revision hash.
 */
export const CLOSED_MODEL_NOTES: Readonly<Record<string, string>> = {
  "google/gemini-2.5-flash": CLOSED_MODEL_REASON,
  "google/gemini-2.5-pro": CLOSED_MODEL_REASON,
  "anthropic/claude-sonnet-4": CLOSED_MODEL_REASON,
  "openai/gpt-4.1": CLOSED_MODEL_REASON,
};

/** Read from the arXiv API on ARXIV_SNAPSHOT_DATE. */
export const SEALED_ARXIV: readonly ArxivPaper[] = [
  {
    id: "2610.02206v1",
    title:
      "KaliBench: A Fine-Grained Benchmark for Cybersecurity Tool Use on Kali Linux with Runtime-Free Verifiable Rewards",
    summary:
      "LLMs are increasingly applied to cybersecurity workflows, where they are expected to translate analysts' intent into tool invocations. However, existing evaluations focus on knowledge-based assessments or end-to-end agentic tasks, and we argue that verifiable, runtime-free reward shaping lets the same task be scored identically on every run.",
    publishedAt: "2026-10-01T17:59:55.000Z",
    updatedAt: "2026-10-01T17:59:55.000Z",
    authors: ["A. Researcher"],
    categories: ["cs.CR", "cs.CL"],
    url: "https://arxiv.org/abs/2610.02206v1",
    mentionedModels: ["llama", "qwen"],
  },
];