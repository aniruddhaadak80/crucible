/**
 * MCP-style agent interface, JSON-RPC 2.0 over HTTP POST.
 *
 * Every tool here calls the same service functions the UI calls. An agent
 * mutation and a button press cannot diverge because there is only one code
 * path. Mutating tools are idempotent on an explicit key, so a retry after a
 * timeout returns the original result instead of forging a second task.
 *
 * Standard JSON-RPC error codes are used throughout:
 *   -32700 parse error   -32600 invalid request   -32601 method not found
 *   -32602 invalid params                       -32603 internal error
 */

import { kaggleBundle } from "./kaggle.ts";
import {
  ENGINE_METADATA,
  createTaskView,
  decideTaskView,
  gradeTaskView,
  integrityView,
  listTaskViews,
  retireTaskView,
  updateTaskView,
  viewTask,
  withIdempotency,
  type TaskSummary,
} from "./service.ts";
import { getScope } from "./session.ts";
import { parseDecision, parseTaskInput } from "./validate.ts";
import { arxivFeed, closedModelNote, hubLineup, ARXIV_QUERY } from "./live/index.ts";
import { SITE } from "./site.ts";
import { GRADER_VERSION } from "./types.ts";
import type { ToolDescriptor } from "./types.ts";

export const MCP_PROTOCOL_VERSION = SITE.mcpProtocol;

/* ------------------------------------------------------------------ *
 * JSON-RPC plumbing
 * ------------------------------------------------------------------ */

export type RpcRequest = {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
};

export type RpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export const RPC = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

function ok(id: string | number | null, result: unknown): RpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function fail(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): RpcResponse {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}

function textResult(payload: unknown): {
  content: { type: "text"; text: string }[];
  structuredContent: unknown;
  isError?: boolean;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new RpcToolError(RPC.invalidParams, `"${key}" is required and must be a non-empty string.`);
  }
  return value;
}

export class RpcToolError extends Error {
  code: number;
  data: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "RpcToolError";
    this.code = code;
    this.data = data;
  }
}

/* ------------------------------------------------------------------ *
 * Tool catalogue
 * ------------------------------------------------------------------ */

const IDEMPOTENT_NOTE =
  "Supplying the same idempotencyKey twice returns the first result and performs no second mutation.";

export const TOOLS: readonly ToolDescriptor[] = [
  {
    name: "list_tasks",
    kind: "read",
    title: "List forged tasks",
    description:
      "Every benchmark task owned by the calling session, newest first, each with its engine verdict. Retired tasks are excluded unless includeRetired is true.",
    mutates: false,
    idempotent: true,
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        before: { type: "string", description: "ISO timestamp cursor for the next page" },
        status: { type: "string", enum: ["forging", "poured", "retired"] },
        includeRetired: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_task",
    kind: "read",
    title: "Read one task",
    description:
      "Full record plus the engine verdict, every transcript grade with per-assertion evidence, and the head of the audit chain.",
    mutates: false,
    idempotent: true,
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", minLength: 1 } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "grade_task",
    kind: "analysis",
    title: "Run the engine and seal the verdict",
    description:
      "Re-runs crucible-grade over a task, consulting the live Hugging Face Hub for the target model's revision and gating. Appends a grade event to the chain and returns the new seal. Deterministic: identical input yields an identical score.",
    mutates: true,
    idempotent: true,
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", minLength: 1 } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "rank_lineup",
    kind: "analysis",
    title: "Rank the recorded lineup",
    description:
      "Grades every recorded transcript of a task with the shared grader and ranks the models by score. Reports the population sigma, so a task that cannot separate models is visible as such.",
    mutates: false,
    idempotent: true,
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", minLength: 1 } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "verify_integrity",
    kind: "read",
    title: "Replay the audit chain",
    description:
      "Recomputes every seal in a task's SHA-384 chain from genesis and reports the first broken link, if any.",
    mutates: false,
    idempotent: true,
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", minLength: 1 } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "live_signals",
    kind: "read",
    title: "Read live model and preprint signals",
    description:
      "Live Hugging Face Hub facts for the benchmark lineup, including whether each model's weights are gated and whether a pinnable revision exists, plus the newest arXiv capability-evaluation papers.",
    mutates: false,
    idempotent: true,
    inputSchema: {
      type: "object",
      properties: { paperLimit: { type: "integer", minimum: 1, maximum: 20, default: 6 } },
      additionalProperties: false,
    },
  },
  {
    name: "export_bundle",
    kind: "read",
    title: "Generate the Kaggle Benchmarks bundle",
    description:
      "Returns a runnable kaggle_benchmarks task file, a self-contained Python grader, a self-check and the CLI commands to push and run it. Grading is implemented in the bundle itself, so the exported file grades identically.",
    mutates: false,
    idempotent: true,
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", minLength: 1 } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "forge_task",
    kind: "write",
    title: "Forge a new benchmark task",
    description:
      "Creates a task from a failure mode, a prompt, assertions and recorded transcripts. Returns the persisted record with its verdict and the first audit seal. " + IDEMPOTENT_NOTE,
    mutates: true,
    idempotent: true,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 3, maxLength: 120 },
        failureMode: { type: "string", minLength: 10, maxLength: 600 },
        prompt: { type: "string", minLength: 10, maxLength: 8000 },
        sealedFixtures: { type: "array", items: { type: "string" }, maxItems: 40 },
        assertions: { type: "array", items: { type: "object" }, maxItems: 40 },
        transcripts: { type: "array", items: { type: "object" }, maxItems: 60 },
        seed: { type: ["integer", "null"] },
        targetModel: { type: ["string", "null"] },
        targetTemp: { type: ["number", "null"], minimum: 0, maximum: 2 },
        targetRevision: { type: ["string", "null"] },
        tokenBudget: { type: "integer", minimum: 0, maximum: 10_000_000 },
        idempotencyKey: { type: "string", maxLength: 200 },
      },
      required: ["name", "failureMode", "prompt"],
      additionalProperties: false,
    },
  },
  {
    name: "revise_task",
    kind: "write",
    title: "Revise a task",
    description:
      "Patches any subset of a task's fields through the same service the UI uses. Records the pre-change engine score on the audit event. " + IDEMPOTENT_NOTE,
    mutates: true,
    idempotent: true,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", minLength: 1 },
        name: { type: "string", minLength: 3, maxLength: 120 },
        failureMode: { type: "string", minLength: 10, maxLength: 600 },
        prompt: { type: "string", minLength: 10, maxLength: 8000 },
        sealedFixtures: { type: "array", items: { type: "string" }, maxItems: 40 },
        assertions: { type: "array", items: { type: "object" }, maxItems: 40 },
        transcripts: { type: "array", items: { type: "object" }, maxItems: 60 },
        seed: { type: ["integer", "null"] },
        targetModel: { type: ["string", "null"] },
        targetTemp: { type: ["number", "null"], minimum: 0, maximum: 2 },
        targetRevision: { type: ["string", "null"] },
        tokenBudget: { type: "integer", minimum: 0, maximum: 10_000_000 },
        status: { type: "string", enum: ["forging", "poured", "retired"] },
        idempotencyKey: { type: "string", maxLength: 200 },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "record_decision",
    kind: "write",
    title: "Record an adopt/iterate/discard decision",
    description:
      "Files a decision with a note. The engine score at the moment of the decision is stored on the record and sealed into the chain. " + IDEMPOTENT_NOTE,
    mutates: true,
    idempotent: true,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", minLength: 1 },
        verdict: { type: "string", enum: ["adopt", "iterate", "discard"] },
        note: { type: "string", minLength: 3, maxLength: 600 },
        idempotencyKey: { type: "string", maxLength: 200 },
      },
      required: ["id", "verdict", "note"],
      additionalProperties: false,
    },
  },
  {
    name: "retire_task",
    kind: "write",
    title: "Retire a task as a tombstone",
    description:
      "Soft-deletes a task. The row and its audit events are retained so the chain still replays, and the replay result is returned as proof. " + IDEMPOTENT_NOTE,
    mutates: true,
    idempotent: true,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", minLength: 1 },
        idempotencyKey: { type: "string", maxLength: 200 },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
] as const;

export const TOOL_NAMES = TOOLS.map((t) => t.name);

/* ------------------------------------------------------------------ *
 * Dispatch
 * ------------------------------------------------------------------ */

export const DEFAULT_LINEUP = [
  "Qwen/Qwen2.5-72B-Instruct",
  "meta-llama/Llama-3.1-70B-Instruct",
  "mistralai/Mistral-7B-Instruct-v0.3",
  "deepseek-ai/DeepSeek-V3",
  "google/gemini-2.5-flash",
  "anthropic/claude-sonnet-4",
  "openai/gpt-4.1",
] as const;

export async function callTool(
  name: string,
  rawParams: unknown,
  scope: string,
): Promise<unknown> {
  const params = asRecord(rawParams);
  const actor = `agent:${name}`;

  switch (name) {
    case "list_tasks": {
      const limitRaw = params.limit;
      const limit =
        typeof limitRaw === "number" && Number.isFinite(limitRaw)
          ? Math.min(Math.max(Math.trunc(limitRaw), 1), 50)
          : 20;
      const status = typeof params.status === "string" ? params.status : null;
      if (status && !["forging", "poured", "retired"].includes(status)) {
        throw new RpcToolError(RPC.invalidParams, `"status" must be forging, poured or retired.`);
      }
      const result = await listTaskViews(scope, {
        limit,
        before: typeof params.before === "string" ? params.before : null,
        status: status as "forging" | "poured" | "retired" | null,
        includeRetired: params.includeRetired === true,
      });
      return textResult(result);
    }

    case "get_task": {
      const view = await viewTask(scope, requireString(params, "id"));
      return textResult(view);
    }

    case "grade_task": {
      const result = await gradeTaskView(scope, requireString(params, "id"), actor);
      return textResult({
        verdict: result.verdict,
        grade: result.grade,
        modelFacts: result.modelFacts,
        seal: result.seal,
      });
    }

    case "rank_lineup": {
      const view = await viewTask(scope, requireString(params, "id"));
      const ranked = [...view.grade.grades]
        .sort((a, b) => b.score - a.score || a.modelId.localeCompare(b.modelId))
        .map((g, i) => ({
          rank: i + 1,
          modelId: g.modelId,
          modelLabel: g.modelLabel,
          score: g.score,
          determinism: g.determinism,
          latencyMs: g.latencyMs,
          tokensOut: g.tokensOut,
          passed: g.outcomes.filter((o) => o.passed === true).length,
          failed: g.outcomes.filter((o) => o.passed === false).length,
          undecided: g.outcomes.filter((o) => o.passed === null).length,
        }));
      return textResult({
        taskId: view.task.id,
        taskName: view.task.name,
        grader: GRADER_VERSION,
        separation: {
          mean: view.grade.meanScore,
          populationSigma: view.grade.spread,
          min: view.grade.minScore,
          max: view.grade.maxScore,
          discriminating: view.grade.spread > 0,
        },
        verdict: view.verdict,
        ranking: ranked,
      });
    }

    case "verify_integrity": {
      const result = await integrityView(scope, requireString(params, "id"));
      return textResult(result);
    }

    case "live_signals": {
      const limitRaw = params.paperLimit;
      const paperLimit =
        typeof limitRaw === "number" && Number.isFinite(limitRaw)
          ? Math.min(Math.max(Math.trunc(limitRaw), 1), 20)
          : 6;
      const [hub, papers] = await Promise.all([
        hubLineup([...DEFAULT_LINEUP]),
        arxivFeed(ARXIV_QUERY, paperLimit),
      ]);
      return textResult({
        hub,
        papers,
        closedModels: DEFAULT_LINEUP.filter((m) => closedModelNote(m) !== null).map((m) => ({
          modelId: m,
          note: closedModelNote(m),
        })),
      });
    }

    case "export_bundle": {
      const view = await viewTask(scope, requireString(params, "id"));
      return textResult(kaggleBundle(view.task, view.verdict));
    }

    case "forge_task": {
      const input = parseTaskInput(params, "create");
      const key = typeof params.idempotencyKey === "string" ? params.idempotencyKey : null;
      const { value, replayed } = await withIdempotency(scope, key, "forge_task", () =>
        createTaskView(
          scope,
          input as { name: string; failureMode: string; prompt: string },
          actor,
        ),
      );
      return textResult({ ...value, idempotentReplay: replayed });
    }

    case "revise_task": {
      const id = requireString(params, "id");
      // `id` and `idempotencyKey` are envelope fields, not task fields, so they
      // must not reach the patch parser.
      const patch = parseTaskInput(
        Object.fromEntries(
          Object.entries(params).filter(
            ([key]) => key !== "id" && key !== "idempotencyKey",
          ),
        ),
        "update",
      );
      const key = typeof params.idempotencyKey === "string" ? params.idempotencyKey : null;
      const { value, replayed } = await withIdempotency(scope, key, "revise_task", () =>
        updateTaskView(scope, id, patch, actor),
      );
      return textResult({ ...value, idempotentReplay: replayed });
    }

    case "record_decision": {
      const id = requireString(params, "id");
      const { verdict, note } = parseDecision({ verdict: params.verdict, note: params.note });
      const key = typeof params.idempotencyKey === "string" ? params.idempotencyKey : null;
      const { value, replayed } = await withIdempotency(scope, key, "record_decision", () =>
        decideTaskView(scope, id, verdict, note, actor),
      );
      return textResult({ ...value, idempotentReplay: replayed });
    }

    case "retire_task": {
      const id = requireString(params, "id");
      const key = typeof params.idempotencyKey === "string" ? params.idempotencyKey : null;
      const { value, replayed } = await withIdempotency(scope, key, "retire_task", () =>
        retireTaskView(scope, id, actor),
      );
      return textResult({ ...value, idempotentReplay: replayed });
    }

    default:
      throw new RpcToolError(RPC.methodNotFound, `Unknown tool "${name}".`, {
        available: TOOL_NAMES,
      });
  }
}

export async function handleRpc(request: RpcRequest): Promise<RpcResponse> {
  const id =
    typeof request.id === "string" || typeof request.id === "number" ? request.id : null;

  if (typeof request.method !== "string" || request.method === "") {
    return fail(id, RPC.invalidRequest, `"method" is required and must be a string.`);
  }

  const scope = await getScope();

  try {
    switch (request.method) {
      case "initialize":
        return ok(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SITE.name, version: SITE.version, url: SITE.liveUrl },
          instructions:
            "Crucible forges benchmark tasks and grades them with exact assertions. " +
            "Call list_tasks, then grade_task or rank_lineup before recommending publication. " +
            "grade_task returns the seal; verify_integrity replays the chain.",
          engine: ENGINE_METADATA,
        });

      case "notifications/initialized":
        // Notification: no id, so no response body per JSON-RPC.
        return ok(id, {});

      case "ping":
        return ok(id, {});

      case "tools/list":
        return ok(id, {
          tools: TOOLS.map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: {
              readOnlyHint: !t.mutates,
              destructiveHint: t.name === "retire_task",
              idempotentHint: t.idempotent,
              openWorldHint: t.name === "live_signals",
            },
          })),
        });

      case "tools/call": {
        const params = asRecord(request.params);
        const name = params.name;
        if (typeof name !== "string" || name === "") {
          return fail(id, RPC.invalidParams, `"params.name" is required and must be a string.`);
        }
        const result = await callTool(name, params.arguments, scope);
        return ok(id, result);
      }

      case "resources/list":
        return ok(id, { resources: [] });

      default:
        return fail(id, RPC.methodNotFound, `Unknown method "${request.method}".`, {
          supported: ["initialize", "tools/list", "tools/call", "ping"],
        });
    }
  } catch (error) {
    if (error instanceof RpcToolError) {
      return fail(id, error.code, error.message, error.data);
    }
    if (error instanceof Error && error.name === "NotFoundError") {
      return fail(id, RPC.invalidParams, error.message);
    }
    if (error instanceof Error && error.name === "ValidationError") {
      const details = (error as Error & { details?: unknown }).details;
      return fail(id, RPC.invalidParams, error.message, details);
    }
    if (error instanceof Error && error.name === "ConflictError") {
      return fail(id, RPC.invalidParams, error.message);
    }
    console.error("[crucible] agent tool failure", error);
    return fail(id, RPC.internal, "The tool call could not be completed.");
  }
}

export type { TaskSummary };