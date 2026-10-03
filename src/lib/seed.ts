/**
 * Bundled reference tasks.
 *
 * These are fixtures, not results. Every transcript here is marked
 * `origin: "seeded"` and the UI labels them as bundled reference material, so
 * nothing on this product can be mistaken for a live model run.
 *
 * They exist to make the engine legible on first visit: between them they
 * produce a publishable verdict, a judge-bound verdict and a
 * non-discriminating verdict, which is the whole argument the product makes.
 */

import { GENESIS_SEAL } from "./canonical.ts";
import type { BenchmarkTask, Transcript } from "./types.ts";

/** Scope for every seeded row. User rows can never land here. */
export const SEED_SCOPE = "seed";

const REFERENCE_NOTE =
  "Bundled reference material, not a live model run.";

function tr(
  id: string,
  modelId: string,
  completion: string,
  opts: { latencyMs: number; tokensOut: number },
): Transcript {
  return {
    id,
    modelId,
    modelLabel: modelId.split("/").pop() ?? modelId,
    prompt: "see task prompt",
    completion,
    latencyMs: opts.latencyMs,
    tokensIn: 240,
    tokensOut: opts.tokensOut,
    origin: "seeded",
  };
}

/* ------------------------------------------------------------------ *
 * 1. Publishable. Exact assertions, real spread, everything pinned.
 * ------------------------------------------------------------------ */

const UNIT_DRIFT: BenchmarkTask = {
  id: "seed-unit-drift",
  slug: "csv-unit-drift",
  name: "CSV unit-of-measure drift",
  failureMode:
    "The model returns micrograms where the canonical schema demands milligrams, and the downstream loader silently reads the wrong column.",
  prompt: [
    "You are given three rows from a chemistry export.",
    "Return ONLY a JSON object of the form:",
    '{"rows":[{"id":string,"amount":number,"unit":"mg"}],"meta":{"units":"mg","count":number}}',
    "Convert every amount to milligrams. Do not add commentary.",
  ].join("\n"),
  sealedFixtures: [
    "export_rows.csv=sha256:6f1a2c9d4e8b73a5109fd2c4e7b81a3d6c5f0e2b94d7a1c8e3f5b0d2a6c9e4f7",
    "schema_v3.json=sha256:b3d9e1f04c7a2685e93b1d0c7f4a62e8d5c0b93f7a1e6d4c8b2f0a3e7d5c9b16",
  ],
  assertions: [
    {
      id: "unit-canonical",
      kind: "json_path_equals",
      label: "every unit is mg",
      weight: 3,
      required: true,
      path: "meta.units",
      jsonExpected: "mg",
    },
    {
      id: "count-three",
      kind: "json_path_equals",
      label: "exactly three rows counted",
      weight: 2,
      required: true,
      path: "meta.count",
      jsonExpected: "3",
    },
    {
      id: "no-micrograms",
      kind: "not_contains",
      label: "no micrograms anywhere",
      weight: 2,
      required: true,
      needle: "µg",
    },
    {
      id: "total-in-range",
      kind: "number_between",
      label: "total mass lands in 400-500 mg",
      weight: 2,
      required: false,
      min: 400,
      max: 500,
    },
  ],
  transcripts: [
    tr(
      "seed-unit-drift-1",
      "google/gemini-2.5-flash",
      '{"rows":[{"id":"a","amount":120,"unit":"mg"},{"id":"b","amount":250,"unit":"mg"},{"id":"c","amount":95,"unit":"mg"}],"meta":{"units":"mg","count":3,"total":465}}',
      { latencyMs: 1840, tokensOut: 96 },
    ),
    tr(
      "seed-unit-drift-2",
      "anthropic/claude-sonnet-4",
      'Here is the converted data:\n{"rows":[{"id":"a","amount":120000,"unit":"µg"},{"id":"b","amount":250000,"unit":"µg"},{"id":"c","amount":95000,"unit":"µg"}],"meta":{"units":"µg","count":3}}',
      { latencyMs: 2410, tokensOut: 132 },
    ),
    tr(
      "seed-unit-drift-3",
      "meta/llama-3.1-70b",
      "Row a: 0.120 g\nRow b: 0.250 g\nRow c: 0.095 g\nTotal mass is 0.465 g across three samples.",
      { latencyMs: 3120, tokensOut: 58 },
    ),
  ],
  seed: 20260923,
  targetModel: "google/gemini-2.5-flash",
  targetTemp: 0,
  targetRevision: "seed-reference-revision",
  tokenBudget: 400,
  status: "poured",
  decision: {
    verdict: "adopt",
    note: "Reference task. Demonstrates a fully deterministic, fully discriminating grade.",
    recordedAt: "2026-09-23T09:00:00.000Z",
    scoreAtDecision: 0,
  },
  scope: SEED_SCOPE,
  createdAt: "2026-09-23T09:00:00.000Z",
  updatedAt: "2026-09-23T09:00:00.000Z",
  deletedAt: null,
  seal: GENESIS_SEAL,
};

/* ------------------------------------------------------------------ *
 * 2. Judge-bound. Most of the weight needs a model in the loop.
 * ------------------------------------------------------------------ */

const ENVELOPE_COLLAPSE: BenchmarkTask = {
  id: "seed-envelope-collapse",
  slug: "nested-envelope-collapse",
  name: "Nested envelope collapse",
  failureMode:
    "Given a tool result, the model wraps the payload in a second envelope and the caller's parser sees data: null.",
  prompt: [
    "A tool returned this payload:",
    '{"status":"ok","data":{"rows":[1,2,3]}}',
    "Reply with ONLY the JSON the caller expects, which is the inner data object verbatim.",
  ].join("\n"),
  sealedFixtures: ["tool_result_07.json=sha256:11ac90b7e2d34f6810c5a7be9d2f40318c6e5a9b7d0c2f4e8a1b3d5f7c9e0a24"],
  assertions: [
    {
      id: "top-level-rows",
      kind: "json_path_equals",
      label: "rows sit at the top level",
      weight: 1,
      required: true,
      path: "rows",
      jsonExpected: "[1,2,3]",
    },
    {
      id: "no-double-envelope",
      kind: "regex",
      label: "no nested data envelope",
      weight: 2,
      required: true,
      pattern: "\"data\"\\s*:",
    },
    {
      id: "tone",
      kind: "judge_rubric",
      label: "answer contains no hedging preamble",
      weight: 4,
      required: false,
      rubric:
        "The completion contains no preamble such as 'Sure', 'Certainly' or 'Here is'. Judge on the completion text alone.",
    },
  ],
  transcripts: [
    tr(
      "seed-envelope-1",
      "openai/gpt-4.1",
      '{"rows":[1,2,3]}',
      { latencyMs: 1120, tokensOut: 22 },
    ),
    tr(
      "seed-envelope-2",
      "anthropic/claude-sonnet-4",
      'Sure! Here is the inner data object:\n{"data":{"rows":[1,2,3]}}',
      { latencyMs: 1980, tokensOut: 41 },
    ),
    tr(
      "seed-envelope-3",
      "google/gemini-2.5-pro",
      'Certainly. The caller expects:\n{"status":"ok","data":{"rows":[1,2,3]}}',
      { latencyMs: 2760, tokensOut: 48 },
    ),
  ],
  seed: 4242,
  targetModel: "openai/gpt-4.1",
  targetTemp: null,
  targetRevision: null,
  tokenBudget: 200,
  status: "forging",
  decision: null,
  scope: SEED_SCOPE,
  createdAt: "2026-09-23T09:05:00.000Z",
  updatedAt: "2026-09-23T09:05:00.000Z",
  deletedAt: null,
  seal: GENESIS_SEAL,
};

/* ------------------------------------------------------------------ *
 * 3. Non-discriminating. Every model passes, so the task measures nothing.
 * ------------------------------------------------------------------ */

const RETRY_STORM: BenchmarkTask = {
  id: "seed-retry-storm",
  slug: "retry-storm",
  name: "Retry storm under a flaky tool",
  failureMode:
    "When a tool call fails twice, the model retries in a tight loop instead of surfacing the error. I want to know which models get this right.",
  prompt: [
    "A tool named fetch_record has failed twice with a 503.",
    "Decide what to do next and reply with a single JSON object:",
    '{"action":"retry"|"escalate","backoff_ms":number,"reason":string}',
  ].join("\n"),
  sealedFixtures: ["tool_fault_injection.json=sha256:9c2d7f10ab4e65381d7c0a2f9e4b6c835d10e7f2a4b8c6d0e3f5a9c1b7d4e2f"],
  assertions: [
    {
      id: "escalates",
      kind: "json_path_equals",
      label: "escalates rather than retrying",
      weight: 3,
      required: true,
      path: "action",
      jsonExpected: "escalate",
    },
    {
      id: "has-backoff",
      kind: "number_between",
      label: "backoff is at least one second",
      weight: 2,
      required: false,
      min: 1000,
      max: 60000,
    },
    {
      id: "single-object",
      kind: "regex",
      label: "exactly one JSON object",
      weight: 1,
      required: false,
      pattern: "^\\s*\\{",
    },
  ],
  transcripts: [
    tr(
      "seed-retry-1",
      "google/gemini-2.5-flash",
      '{"action":"escalate","backoff_ms":5000,"reason":"two 503s in a row"}',
      { latencyMs: 1310, tokensOut: 34 },
    ),
    tr(
      "seed-retry-2",
      "anthropic/claude-sonnet-4",
      '{"action":"escalate","backoff_ms":5000,"reason":"repeated upstream 503"}',
      { latencyMs: 1602, tokensOut: 36 },
    ),
    tr(
      "seed-retry-3",
      "openai/gpt-4.1",
      '{"action":"escalate","backoff_ms":5000,"reason":"persistent 503"}',
      { latencyMs: 1500, tokensOut: 35 },
    ),
  ],
  seed: 777,
  targetModel: "google/gemini-2.5-flash",
  targetTemp: 0,
  targetRevision: null,
  tokenBudget: 300,
  status: "forging",
  decision: null,
  scope: SEED_SCOPE,
  createdAt: "2026-09-23T09:10:00.000Z",
  updatedAt: "2026-09-23T09:10:00.000Z",
  deletedAt: null,
  seal: GENESIS_SEAL,
};

export const SEED_TASKS: readonly BenchmarkTask[] = [
  UNIT_DRIFT,
  ENVELOPE_COLLAPSE,
  RETRY_STORM,
];

export const SEED_NOTE = REFERENCE_NOTE;