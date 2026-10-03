/**
 * Input validation.
 *
 * Deliberately hand-written rather than schema-derived: the error messages are
 * written for the person typing into the forge, and every rule here is a place
 * where unbounded input could otherwise reach the database or a regex engine.
 */

import {
  ASSERTION_KINDS,
  TASK_STATUSES,
  type Assertion,
  type BenchmarkTaskInput,
  type Transcript,
} from "./types.ts";
import { ValidationError } from "./db/repository.ts";

export type Details = { path: string; message: string }[];

const LIMITS = {
  name: 120,
  nameMin: 3,
  failureMode: 600,
  failureModeMin: 10,
  prompt: 8000,
  promptMin: 10,
  fixtures: 40,
  assertions: 40,
  transcripts: 60,
  completion: 20000,
  label: 120,
  budget: 10_000_000,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optInt(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.trunc(value);
}

function validateAssertion(raw: unknown, index: number, out: Details): Assertion | null {
  const path = `assertions[${index}]`;
  if (!isRecord(raw)) {
    out.push({ path, message: "must be an object" });
    return null;
  }

  const kind = str(raw.kind);
  if (!kind || !(ASSERTION_KINDS as readonly string[]).includes(kind)) {
    out.push({ path: `${path}.kind`, message: `must be one of ${ASSERTION_KINDS.join(", ")}` });
    return null;
  }

  const label = str(raw.label) ?? "";
  if (label.length < 1 || label.length > LIMITS.label) {
    out.push({ path: `${path}.label`, message: `must be 1-${LIMITS.label} characters` });
  }

  const rawWeight = raw.weight;
  let weight = 1;
  if (typeof rawWeight !== "number" || !Number.isFinite(rawWeight) || rawWeight < 0 || rawWeight > 100) {
    out.push({ path: `${path}.weight`, message: "must be a number between 0 and 100" });
  } else {
    weight = rawWeight;
  }

  // Kind-specific fields. A regex of unbounded length is a denial-of-service
  // vector against the grader, so the pattern length is capped hard.
  const pattern = str(raw.pattern);
  const needle = str(raw.needle);
  const pathExpr = str(raw.path);
  const rubric = str(raw.rubric);
  const jsonExpected = str(raw.jsonExpected);

  const assertion: Assertion = {
    id: str(raw.id) ?? `a${index + 1}`,
    kind: kind as Assertion["kind"],
    label,
    weight,
    required: raw.required === true,
  };

  switch (kind) {
    case "regex": {
      if (!pattern || pattern.length === 0) {
        out.push({ path: `${path}.pattern`, message: "regex assertions need a pattern" });
      } else if (pattern.length > 500) {
        out.push({ path: `${path}.pattern`, message: "pattern must be at most 500 characters" });
      } else {
        try {
          new RegExp(pattern, "i");
        } catch {
          out.push({ path: `${path}.pattern`, message: "pattern is not a valid regular expression" });
        }
        assertion.pattern = pattern;
      }
      break;
    }
    case "contains":
    case "not_contains": {
      if (!needle || needle.length === 0) {
        out.push({ path: `${path}.needle`, message: `${kind} assertions need a needle` });
      } else if (needle.length > 300) {
        out.push({ path: `${path}.needle`, message: "needle must be at most 300 characters" });
      } else {
        assertion.needle = needle;
      }
      break;
    }
    case "json_path_equals": {
      if (!pathExpr || pathExpr.length === 0) {
        out.push({ path: `${path}.path`, message: "json_path_equals needs a path" });
      } else if (pathExpr.length > 200 || !/^[A-Za-z0-9_$.\-[\]]+$/.test(pathExpr)) {
        out.push({ path: `${path}.path`, message: "path may only contain letters, digits, dots, dashes and array indexes" });
      } else {
        assertion.path = pathExpr;
      }
      if (jsonExpected !== null) assertion.jsonExpected = jsonExpected.slice(0, 500);
      break;
    }
    case "number_between": {
      const min = raw.min;
      const max = raw.max;
      if (typeof min !== "number" || !Number.isFinite(min)) {
        out.push({ path: `${path}.min`, message: "number_between needs a numeric min" });
      } else if (typeof max !== "number" || !Number.isFinite(max)) {
        out.push({ path: `${path}.max`, message: "number_between needs a numeric max" });
      } else {
        assertion.min = min;
        assertion.max = max;
      }
      break;
    }
    case "judge_rubric": {
      if (!rubric || rubric.trim().length < 5) {
        out.push({ path: `${path}.rubric`, message: "judge_rubric needs a rubric of at least 5 characters" });
      } else if (rubric.length > 600) {
        out.push({ path: `${path}.rubric`, message: "rubric must be at most 600 characters" });
      } else {
        assertion.rubric = rubric;
      }
      break;
    }
    default:
      break;
  }

  return assertion;
}

function validateTranscript(raw: unknown, index: number, out: Details): Transcript | null {
  const path = `transcripts[${index}]`;
  if (!isRecord(raw)) {
    out.push({ path, message: "must be an object" });
    return null;
  }
  const modelId = str(raw.modelId);
  if (!modelId || modelId.length < 2 || modelId.length > 120) {
    out.push({ path: `${path}.modelId`, message: "must be 2-120 characters" });
  }
  const completion = str(raw.completion);
  if (completion === null) {
    out.push({ path: `${path}.completion`, message: "completion text is required" });
  } else if (completion.length > LIMITS.completion) {
    out.push({ path: `${path}.completion`, message: `must be at most ${LIMITS.completion} characters` });
  }

  const latency = optInt(raw.latencyMs);
  const tokensIn = optInt(raw.tokensIn);
  const tokensOut = optInt(raw.tokensOut);

  return {
    id: str(raw.id) ?? `tr${index + 1}`,
    modelId: modelId ?? "",
    modelLabel: str(raw.modelLabel) ?? modelId ?? "unknown",
    prompt: str(raw.prompt) ?? "",
    completion: completion ?? "",
    latencyMs: typeof latency === "number" ? Math.max(0, latency) : 0,
    tokensIn: typeof tokensIn === "number" ? Math.max(0, tokensIn) : 0,
    tokensOut: typeof tokensOut === "number" ? Math.max(0, tokensOut) : 0,
    origin: raw.origin === "recorded" ? "recorded" : "seeded",
  };
}

/** Validate a create payload. Throws ValidationError with every problem found. */
export function parseTaskInput(raw: unknown, mode: "create" | "update"): BenchmarkTaskInput {
  const out: Details = [];
  if (!isRecord(raw)) {
    throw new ValidationError([{ path: "body", message: "must be a JSON object" }]);
  }

  const input: BenchmarkTaskInput = {};

  if (mode === "create" || raw.name !== undefined) {
    const name = str(raw.name)?.trim() ?? "";
    if (name.length < LIMITS.nameMin || name.length > LIMITS.name) {
      out.push({ path: "name", message: `must be ${LIMITS.nameMin}-${LIMITS.name} characters` });
    } else {
      input.name = name;
    }
  }

  if (mode === "create" || raw.failureMode !== undefined) {
    const failureMode = str(raw.failureMode)?.trim() ?? "";
    if (failureMode.length < LIMITS.failureModeMin || failureMode.length > LIMITS.failureMode) {
      out.push({
        path: "failureMode",
        message: `must be ${LIMITS.failureModeMin}-${LIMITS.failureMode} characters`,
      });
    } else {
      input.failureMode = failureMode;
    }
  }

  if (mode === "create" || raw.prompt !== undefined) {
    const prompt = str(raw.prompt) ?? "";
    if (prompt.length < LIMITS.promptMin || prompt.length > LIMITS.prompt) {
      out.push({ path: "prompt", message: `must be ${LIMITS.promptMin}-${LIMITS.prompt} characters` });
    } else {
      input.prompt = prompt;
    }
  }

  if (raw.sealedFixtures !== undefined) {
    if (!Array.isArray(raw.sealedFixtures)) {
      out.push({ path: "sealedFixtures", message: "must be an array" });
    } else if (raw.sealedFixtures.length > LIMITS.fixtures) {
      out.push({ path: "sealedFixtures", message: `at most ${LIMITS.fixtures} entries` });
    } else {
      const fixtures: string[] = [];
      raw.sealedFixtures.forEach((item, i) => {
        const value = str(item)?.trim() ?? "";
        if (!/^[A-Za-z0-9_.-]{1,60}=[A-Za-z0-9:_-]{8,140}$/.test(value)) {
          out.push({
            path: `sealedFixtures[${i}]`,
            message: 'must look like name=hash, for example input.csv=sha256:abc123',
          });
        } else {
          fixtures.push(value);
        }
      });
      input.sealedFixtures = fixtures;
    }
  }

  if (raw.assertions !== undefined) {
    if (!Array.isArray(raw.assertions)) {
      out.push({ path: "assertions", message: "must be an array" });
    } else if (raw.assertions.length > LIMITS.assertions) {
      out.push({ path: "assertions", message: `at most ${LIMITS.assertions} assertions` });
    } else {
      const parsed: Assertion[] = [];
      raw.assertions.forEach((item, i) => {
        const a = validateAssertion(item, i, out);
        if (a) parsed.push(a);
      });
      if (parsed.length > 0) input.assertions = parsed;
    }
  }

  if (raw.transcripts !== undefined) {
    if (!Array.isArray(raw.transcripts)) {
      out.push({ path: "transcripts", message: "must be an array" });
    } else if (raw.transcripts.length > LIMITS.transcripts) {
      out.push({ path: "transcripts", message: `at most ${LIMITS.transcripts} transcripts` });
    } else {
      const parsed: Transcript[] = [];
      raw.transcripts.forEach((item, i) => {
        const t = validateTranscript(item, i, out);
        if (t) parsed.push(t);
      });
      input.transcripts = parsed;
    }
  }

  if (raw.seed !== undefined) {
    const seed = optInt(raw.seed);
    if (seed === undefined) out.push({ path: "seed", message: "must be an integer or null" });
    else input.seed = seed;
  }

  if (raw.targetModel !== undefined) {
    const model = str(raw.targetModel);
    if (model !== null && (model.length < 2 || model.length > 120)) {
      out.push({ path: "targetModel", message: "must be 2-120 characters" });
    } else {
      input.targetModel = model;
    }
  }

  if (raw.targetTemp !== undefined) {
    const temp = optInt(raw.targetTemp);
    if (temp === undefined) {
      out.push({ path: "targetTemp", message: "must be a number or null" });
    } else if (temp !== null && (temp < 0 || temp > 2)) {
      out.push({ path: "targetTemp", message: "must be between 0 and 2" });
    } else {
      input.targetTemp = temp;
    }
  }

  if (raw.targetRevision !== undefined) {
    const rev = str(raw.targetRevision);
    if (rev !== null && (rev.length < 4 || rev.length > 120)) {
      out.push({ path: "targetRevision", message: "must be 4-120 characters" });
    } else {
      input.targetRevision = rev;
    }
  }

  if (raw.tokenBudget !== undefined) {
    const budget = optInt(raw.tokenBudget);
    if (budget === null) {
      out.push({ path: "tokenBudget", message: "must be a whole number" });
    } else if (budget === undefined || budget < 0 || budget > LIMITS.budget) {
      out.push({ path: "tokenBudget", message: `must be 0-${LIMITS.budget}` });
    } else {
      input.tokenBudget = budget;
    }
  }

  if (raw.status !== undefined) {
    const status = str(raw.status);
    if (!status || !(TASK_STATUSES as readonly string[]).includes(status)) {
      out.push({ path: "status", message: `must be one of ${TASK_STATUSES.join(", ")}` });
    } else {
      input.status = status as BenchmarkTaskInput["status"];
    }
  }

  if (out.length > 0) throw new ValidationError(out);
  return input;
}

export function parseDecision(
  raw: unknown,
): { verdict: "adopt" | "iterate" | "discard"; note: string } {
  const out: Details = [];
  if (!isRecord(raw)) throw new ValidationError([{ path: "body", message: "must be an object" }]);

  const verdict = str(raw.verdict);
  if (verdict !== "adopt" && verdict !== "iterate" && verdict !== "discard") {
    out.push({ path: "verdict", message: "must be adopt, iterate or discard" });
  }
  const note = str(raw.note)?.trim() ?? "";
  if (note.length < 3 || note.length > 600) {
    out.push({ path: "note", message: "must be 3-600 characters" });
  }
  if (out.length > 0) throw new ValidationError(out);
  return { verdict: verdict as "adopt" | "iterate" | "discard", note };
}

export const VALIDATION_LIMITS = LIMITS;