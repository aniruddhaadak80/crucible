/**
 * crucible-grader-v1.0.0 and crucible-grade-v1.0.0
 *
 * One module, two jobs:
 *
 *  1. `gradeTranscript` decides a recorded completion against a task's
 *     assertions using exact comparisons only. Given the same bytes it returns
 *     the same numbers forever, which is the entire point of the product.
 *
 *  2. `gradeTask` scores whether the *task itself* is worth publishing.
 *
 * A benchmark task is the artefact under test here, not the model. Six
 * published factors, weights summing to exactly 1, each produced from a
 * measured quantity with the sentence that produced it attached.
 */

import {
  ASSERTION_SPECIFICITY,
  ENGINE_VERSION,
  GRADER_VERSION,
  type Assertion,
  type AssertionOutcome,
  type BenchmarkTask,
  type GradeBand,
  type GradeFactor,
  type GradeFactorId,
  type ModelFacts,
  type EngineVerdict,
  type TaskGrade,
  type Transcript,
  type TranscriptGrade,
  isJudgeKind,
} from "./types.ts";

/* ------------------------------------------------------------------ *
 * Numbers
 * ------------------------------------------------------------------ */

/** Published factor weights. These six numbers sum to exactly 1. */
export const GRADE_WEIGHTS: Readonly<Record<GradeFactorId, number>> = {
  determinism: 0.26,
  discrimination: 0.22,
  fixture_seal: 0.18,
  assertion_specificity: 0.16,
  reproduction: 0.1,
  cost_fit: 0.08,
};

export const WEIGHT_SUM = Object.values(GRADE_WEIGHTS).reduce((a, b) => a + b, 0);

/**
 * Population standard deviation target. A task whose recorded scores scatter
 * by about 0.22 is separating models as well as this design can; beyond that
 * the extra spread is noise from a flaky assertion, not signal.
 */
export const DISCRIMINATION_TARGET_SIGMA = 0.22;

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function clamp(value: number, lo: number, hi: number): number {
  if (Number.isNaN(value)) return lo;
  return value < lo ? lo : value > hi ? hi : value;
}

/** Round to `places` decimals so serialised output is byte-stable. */
export function round(value: number, places = 4): number {
  const f = 10 ** places;
  // `+0` normalises -0 to 0 so JSON output never shows "-0".
  return Math.round(value * f) / f + 0;
}

/* ------------------------------------------------------------------ *
 * Assertion evaluation
 * ------------------------------------------------------------------ */

const NUMBER_PATTERN = /-?\d+(?:\.\d+)?/g;

function fold(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function safeRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

/** Extract the first balanced JSON object or array, ignoring braces in strings. */
export function extractJson(text: string): unknown {
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch !== "{" && ch !== "[") continue;
    const open = ch;
    const close = ch === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < text.length; j += 1) {
      const c = text[j];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (c === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (c === open) depth += 1;
      else if (c === close) {
        depth -= 1;
        if (depth === 0) {
          const slice = text.slice(i, j + 1);
          try {
            return JSON.parse(slice);
          } catch {
            break;
          }
        }
      }
    }
  }
  return undefined;
}

export function getByPath(root: unknown, path: string): unknown {
  const parts = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((p) => p.trim())
    .filter(Boolean);
  let cur: unknown = root;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(part);
      if (!Number.isInteger(idx)) return undefined;
      cur = cur[idx];
      continue;
    }
    if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[part];
      continue;
    }
    return undefined;
  }
  return cur;
}

export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(NUMBER_PATTERN)) {
    const n = Number(m[0]);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export function totalWeight(assertions: readonly Assertion[]): number {
  let sum = 0;
  for (const a of assertions) {
    const w = Number(a.weight);
    if (Number.isFinite(w) && w > 0) sum += w;
  }
  return sum;
}

/** Decide one assertion against one completion. Never throws. */
export function evaluateAssertion(
  assertion: Assertion,
  completion: string,
): { passed: boolean | null; evidence: string } {
  if (isJudgeKind(assertion.kind)) {
    return {
      passed: null,
      evidence: assertion.rubric
        ? `judge rubric, not decided on this server: "${fold(assertion.rubric).slice(0, 120)}"`
        : "judge rubric, not decided on this server: no rubric recorded",
    };
  }

  switch (assertion.kind) {
    case "regex": {
      if (!assertion.pattern) return { passed: false, evidence: "no pattern recorded" };
      const re = safeRegex(assertion.pattern);
      if (!re) return { passed: false, evidence: `invalid pattern: ${assertion.pattern}` };
      const m = re.exec(completion);
      if (!m) return { passed: false, evidence: `no match for /${assertion.pattern}/i` };
      return { passed: true, evidence: `matched "${m[0].slice(0, 120)}" at ${m.index}` };
    }
    case "contains": {
      if (!assertion.needle) return { passed: false, evidence: "no needle recorded" };
      const hay = fold(completion);
      const needle = fold(assertion.needle);
      const at = hay.indexOf(needle);
      if (at < 0) return { passed: false, evidence: `absent: "${needle.slice(0, 80)}"` };
      return { passed: true, evidence: `present at ${at}: "${needle.slice(0, 80)}"` };
    }
    case "not_contains": {
      if (!assertion.needle) return { passed: false, evidence: "no needle recorded" };
      const hay = fold(completion);
      const needle = fold(assertion.needle);
      const at = hay.indexOf(needle);
      if (at >= 0) return { passed: false, evidence: `leaked at ${at}: "${needle.slice(0, 80)}"` };
      return { passed: true, evidence: `absent as required: "${needle.slice(0, 80)}"` };
    }
    case "json_path_equals": {
      if (!assertion.path) return { passed: false, evidence: "no path recorded" };
      const doc = extractJson(completion);
      if (doc === undefined) {
        return { passed: false, evidence: "no parsable JSON object or array in the completion" };
      }
      const actual = getByPath(doc, assertion.path);
      if (actual === undefined) {
        return { passed: false, evidence: `path ${assertion.path} absent from the parsed document` };
      }
      const expected =
        assertion.jsonExpected === undefined ? "" : fold(assertion.jsonExpected);
      const actualText =
        typeof actual === "string" ? fold(actual) : JSON.stringify(actual) ?? "null";
      if (actualText === expected) {
        return { passed: true, evidence: `${assertion.path} = ${actualText.slice(0, 120)}` };
      }
      return {
        passed: false,
        evidence: `${assertion.path} = ${actualText.slice(0, 80)}, expected ${expected.slice(0, 80)}`,
      };
    }
    case "number_between": {
      const min = assertion.min;
      const max = assertion.max;
      // Number.isFinite does not narrow, so the typeof guards have to be explicit.
      if (
        typeof min !== "number" ||
        typeof max !== "number" ||
        !Number.isFinite(min) ||
        !Number.isFinite(max)
      ) {
        return { passed: false, evidence: "number_between needs both min and max" };
      }
      const lo = Math.min(min, max);
      const hi = Math.max(min, max);
      const nums = extractNumbers(completion);
      if (nums.length === 0) return { passed: false, evidence: "no number found in the completion" };
      const inside = nums.filter((n) => n >= lo && n <= hi);
      if (inside.length > 0) {
        return { passed: true, evidence: `${inside[0]} lies in [${lo}, ${hi}]` };
      }
      const closest = nums.reduce((best, n) =>
        Math.abs(n - lo) < Math.abs(best - lo) ? n : best,
      );
      return {
        passed: false,
        evidence: `no number in [${lo}, ${hi}]; nearest was ${closest}`,
      };
    }
    default:
      return { passed: false, evidence: `unknown assertion kind` };
  }
}

/* ------------------------------------------------------------------ *
 * Grading one transcript
 * ------------------------------------------------------------------ */

export function gradeTranscript(
  task: Pick<BenchmarkTask, "id" | "assertions">,
  transcript: Transcript,
): TranscriptGrade {
  const outcomes: AssertionOutcome[] = [];
  let deterministicWeight = 0;
  let deterministicPassed = 0;
  let total = 0;

  for (const assertion of task.assertions) {
    const w = Number.isFinite(assertion.weight) && assertion.weight > 0 ? assertion.weight : 0;
    total += w;
    const { passed, evidence } = evaluateAssertion(assertion, transcript.completion);
    outcomes.push({
      assertionId: assertion.id,
      kind: assertion.kind,
      label: assertion.label,
      passed,
      weight: round(w, 4),
      evidence,
      deterministic: !isJudgeKind(assertion.kind),
    });
    if (!isJudgeKind(assertion.kind)) {
      deterministicWeight += w;
      if (passed === true) deterministicPassed += w;
    }
  }

  const determinism = total > 0 ? round(deterministicWeight / total, 4) : 0;
  const decodable = deterministicWeight > 0;

  // Judge assertions are never decided here. The field stays null so no caller
  // can mistake a missing judgement for a passing one.
  const judgeScore: number | null = null;

  return {
    transcriptId: transcript.id,
    modelId: transcript.modelId,
    modelLabel: transcript.modelLabel,
    score: decodable ? round(deterministicPassed / deterministicWeight, 4) : 0,
    judgeScore,
    determinism,
    outcomes,
    latencyMs: transcript.latencyMs,
    tokensOut: transcript.tokensOut,
    engineVersion: `${GRADER_VERSION}`,
  };
}

/* ------------------------------------------------------------------ *
 * Statistics over the whole task
 * ------------------------------------------------------------------ */

export function stdev(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Statistics over every recorded transcript. `gradeTask` is built on this. */
export function gradeStats(task: BenchmarkTask): TaskGrade {
  return gradeStatsInternal(task);
}

/* ------------------------------------------------------------------ *
 * Engine
 * ------------------------------------------------------------------ */

export const GRADE_BANDS: readonly GradeBand[] = [
  {
    id: "unusable",
    min: 0,
    max: 20,
    label: "Unusable",
    meaning:
      "Too little is decided deterministically to report a number a reader could trust.",
    action: "Do not publish. Add deterministic assertions before anything else.",
  },
  {
    id: "non_discriminating",
    min: 20,
    max: 40,
    label: "Non-discriminating",
    meaning:
      "The recorded models score almost alike. Right now the task measures agreement, not capability.",
    action: "Add a near-miss fixture so a plausible wrong answer starts to cost points.",
  },
  {
    id: "judge_bound",
    min: 40,
    max: 60,
    label: "Judge-bound",
    meaning:
      "Too much of the grade depends on a language model in the loop, so two runs of the same suite can disagree.",
    action: "Convert the highest-weighted judge rubric into an exact assertion.",
  },
  {
    id: "needs_hardening",
    min: 60,
    max: 80,
    label: "Needs hardening",
    meaning:
      "The logic is sound but something still drifts: a pin is missing, or the assertions lean on loose string matching.",
    action: "Pin the loose input and tighten the lowest-weighted substring assertion.",
  },
  {
    id: "publishable",
    min: 80,
    max: 100,
    label: "Publishable",
    meaning:
      "The grade is decided by exact assertions, the recorded models do not score alike, and the inputs are pinned.",
    action: "Ship it. Push the task and run it on the Kaggle model proxy.",
  },
] as const;

export function bandFor(score: number): GradeBand {
  const s = clamp(score, 0, 100);
  const found = GRADE_BANDS.find((b) => s >= b.min && (s < b.max || b.max === 100));
  return found ?? GRADE_BANDS[GRADE_BANDS.length - 1];
}

const FACTOR_LABELS: Readonly<Record<GradeFactorId, string>> = {
  determinism: "Determinism",
  discrimination: "Discrimination",
  fixture_seal: "Fixture seal",
  assertion_specificity: "Assertion specificity",
  reproduction: "Reproduction",
  cost_fit: "Cost fit",
};

function pinValue(task: BenchmarkTask): number {
  let v = 0;
  if (task.targetRevision && task.targetRevision.trim().length > 0) v += 0.3;
  if (task.seed !== null && Number.isFinite(task.seed)) v += 0.25;
  if (task.targetTemp !== null && Number.isFinite(task.targetTemp)) v += 0.25;
  if (task.sealedFixtures.length > 0) v += 0.2;
  return v;
}

function specificityOf(task: BenchmarkTask): number {
  const total = totalWeight(task.assertions);
  if (total <= 0) return 0;
  let acc = 0;
  for (const a of task.assertions) {
    const w = Number.isFinite(a.weight) && a.weight > 0 ? a.weight : 0;
    acc += w * (ASSERTION_SPECIFICITY[a.kind] ?? 0);
  }
  return acc / total;
}

function reproductionOf(task: BenchmarkTask, facts: ModelFacts | null): { value: number; note: string } {
  let v = 0;
  const parts: string[] = [];
  if (task.targetModel && task.targetModel.trim().length > 0) {
    v += 0.35;
    parts.push("target model named");
  } else {
    parts.push("no target model");
  }
  if (task.targetRevision && task.targetRevision.trim().length > 0) {
    v += 0.3;
    parts.push("revision pinned");
  } else {
    parts.push("revision unpinned");
  }
  if (task.seed !== null && Number.isFinite(task.seed)) {
    v += 0.15;
    parts.push("seed pinned");
  } else {
    parts.push("seed unpinned");
  }
  if (task.targetTemp !== null && Number.isFinite(task.targetTemp)) {
    v += 0.2;
    parts.push("temperature pinned");
  } else {
    parts.push("temperature unpinned");
  }

  let note = parts.join(", ");
  if (facts && facts.found) {
    if (facts.gated === true) {
      v *= 0.6;
      note += "; Hub reports the weights are gated, so a third party cannot reproduce this locally";
    }
    if (
      task.targetRevision &&
      facts.revision &&
      task.targetRevision !== facts.revision
    ) {
      v *= 0.8;
      note += `; pinned revision ${task.targetRevision.slice(0, 12)} no longer matches Hub head ${facts.revision.slice(0, 12)}`;
    }
  }
  return { value: clamp01(v), note };
}

function costFitOf(
  task: BenchmarkTask,
  meanTokensOut: number,
  transcriptCount: number,
): { value: number; note: string } {
  const budget = Number(task.tokenBudget);
  if (transcriptCount === 0) {
    // No runs means no measurement. Reporting a full score here would let an
    // empty task look affordable.
    return { value: 0, note: "no transcript recorded, so cost cannot be measured" };
  }
  if (!Number.isFinite(budget) || budget <= 0) {
    return { value: 0, note: "no token budget declared, so cost cannot be checked" };
  }
  if (meanTokensOut <= budget) {
    return {
      value: 1,
      note: `mean completion ${round(meanTokensOut, 1)} tokens is inside the ${budget} budget`,
    };
  }
  const over = (meanTokensOut - budget) / (2 * budget);
  return {
    value: clamp01(1 - over),
    note: `mean completion ${round(meanTokensOut, 1)} tokens overruns the ${budget} budget by ${round(over * 100, 0)}% of tolerance`,
  };
}

const LEVERS: Readonly<Record<GradeFactorId, string[]>> = {
  determinism: [
    "Rewrite the highest-weighted judge_rubric as a regex or a JSON path",
    "Drop the rubric that contributes least and re-measure",
  ],
  discrimination: [
    "Record a transcript from a deliberately weaker model",
    "Add a near-miss fixture that a plausible wrong answer fails",
    "Tighten the assertion everything currently passes",
  ],
  fixture_seal: [
    "Pin the model revision",
    "Record a seed and a temperature",
    "Hash and declare each immutable input as name=hash",
  ],
  assertion_specificity: [
    "Replace a contains assertion with a regex",
    "Replace a contains assertion with a json_path_equals",
    "Delete assertions that exist only as documentation",
  ],
  reproduction: [
    "Name the target model explicitly",
    "Pin the upstream revision rather than tracking a moving head",
    "Choose an ungated model so third parties can rerun the suite",
  ],
  cost_fit: [
    "Raise the declared token budget if the task genuinely needs it",
    "Shorten the prompt or cap the completion length",
    "Drop the most verbose transcript from the recorded set",
  ],
};

const RECOMMENDATIONS: Readonly<Record<GradeFactorId, string>> = {
  determinism:
    "Convert the highest-weighted judge rubric into an exact assertion before this task is worth publishing.",
  discrimination:
    "Your recorded models score alike. Record a weaker model or add a near-miss fixture so the task can tell them apart.",
  fixture_seal:
    "Pin what drifts: the model revision, the seed and the temperature, then declare each input as name=hash.",
  assertion_specificity:
    "Your assertions mostly match substrings. Convert the heaviest ones to a regex or a JSON path.",
  reproduction:
    "Name the target model and pin its revision; an unpinned task cannot be reproduced by the person reading it.",
  cost_fit:
    "The recorded runs overrun the declared token budget. Shorten the prompt or raise the budget to the real figure.",
};

export type GradeOptions = {
  /** Live Hub facts for the target model. Omit for a neutral, offline verdict. */
  modelFacts?: ModelFacts | null;
  /** Injected so tests and exports can pin the timestamp. */
  computedAt?: string;
};

/**
 * The one scoring function. The task detail page, the REST endpoint, the agent
 * tool and the dossier export all call this. Nothing recomputes a score.
 */
export function gradeTask(
  task: BenchmarkTask,
  options: GradeOptions = {},
): { verdict: EngineVerdict; grade: TaskGrade } {
  const grade = gradeStatsInternal(task);
  const facts = options.modelFacts ?? null;

  const det = grade.determinism;
  const discr =
    grade.grades.length < 2
      ? 0
      : clamp01(stdev(grade.grades.map((g) => g.score)) / DISCRIMINATION_TARGET_SIGMA);
  const seal = pinValue(task);
  const spec = specificityOf(task);
  const repro = reproductionOf(task, facts);
  const cost = costFitOf(task, grade.meanTokensOut, grade.grades.length);

  const discriminCount = grade.grades.length;
  const discrNote =
    discriminCount < 2
      ? `only ${discriminCount} transcript${discriminCount === 1 ? "" : "s"} recorded, so separation cannot be measured`
      : `population sigma ${grade.spread} over ${discriminCount} recorded models against a target of ${DISCRIMINATION_TARGET_SIGMA}`;

  const detNote =
    task.assertions.length === 0
      ? "no assertions recorded, so nothing is decided deterministically"
      : `${deterministicWeightOf(task)} of ${round(totalWeight(task.assertions), 3)} assertion weight is decided without a model`;

  const raw: { id: GradeFactorId; value: number; evidence: string }[] = [
    { id: "determinism", value: det, evidence: detNote },
    { id: "discrimination", value: discr, evidence: discrNote },
    {
      id: "fixture_seal",
      value: seal,
      evidence: sealNote(task),
    },
    {
      id: "assertion_specificity",
      value: spec,
      evidence:
        task.assertions.length === 0
          ? "no assertions recorded"
          : `weight-averaged specificity ${round(spec, 3)} over ${task.assertions.length} assertions`,
    },
    { id: "reproduction", value: repro.value, evidence: repro.note },
    { id: "cost_fit", value: cost.value, evidence: cost.note },
  ];

  const factors: GradeFactor[] = raw.map((f) => ({
    id: f.id,
    label: FACTOR_LABELS[f.id],
    weight: GRADE_WEIGHTS[f.id],
    value: round(clamp01(f.value), 4),
    contribution: round(GRADE_WEIGHTS[f.id] * clamp01(f.value), 4),
    evidence: f.evidence,
    levers: LEVERS[f.id],
  }));

  const total = factors.reduce((acc, f) => acc + f.contribution, 0);
  const score = round(total * 100, 1);

  /**
   * Ties break toward the heavier-weighted factor. Two factors reading zero is
   * a common case (a judge-only task is both non-deterministic and
   * non-discriminating) and the operator should be told to fix the one that
   * moves the score most. Sorting by weight and taking a strict improvement
   * makes that choice deterministic instead of dependent on declaration order.
   */
  const byImpact = [...factors].sort(
    (a, b) => b.weight - a.weight || a.id.localeCompare(b.id),
  );
  let weakest = byImpact[0];
  for (const f of byImpact) {
    if (f.value < weakest.value) weakest = f;
  }

  const degraded = det < 1 || grade.grades.length === 0;
  const degradationNote = degraded
    ? det < 1
      ? `${round((1 - det) * 100, 1)}% of the assertion weight needs a language-model judge, so part of this score is a claim, not a measurement.`
      : "No transcript is recorded for this task, so discrimination and cost fit are unmeasured."
    : null;

  return {
    verdict: {
      engineVersion: ENGINE_VERSION,
      taskId: task.id,
      score,
      factors,
      band: bandFor(score),
      recommendation: RECOMMENDATIONS[weakest.id],
      weakestFactor: weakest.id,
      degraded,
      degradationNote,
      modelFactsApplied: facts !== null && facts.found,
      computedAt: options.computedAt ?? new Date().toISOString(),
    },
    grade,
  };
}

function deterministicWeightOf(task: BenchmarkTask): number {
  return round(
    task.assertions
      .filter((a) => !isJudgeKind(a.kind))
      .reduce((acc, a) => acc + (Number.isFinite(a.weight) && a.weight > 0 ? a.weight : 0), 0),
    3,
  );
}

function sealNote(task: BenchmarkTask): string {
  const missing: string[] = [];
  if (!task.targetRevision) missing.push("revision");
  if (task.seed === null || !Number.isFinite(task.seed)) missing.push("seed");
  if (task.targetTemp === null || !Number.isFinite(task.targetTemp)) missing.push("temperature");
  if (task.sealedFixtures.length === 0) missing.push("declared inputs");
  if (missing.length === 0) {
    return "revision, seed, temperature and every declared input are pinned";
  }
  return `not pinned: ${missing.join(", ")}`;
}

/** Internal: the statistics half, split out so the engine reads as one idea. */
function gradeStatsInternal(task: BenchmarkTask): TaskGrade {
  const grades = task.transcripts.map((t) => gradeTranscript(task, t));
  const scores = grades.map((g) => g.score);
  const meanScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const spread = scores.length > 1 ? stdev(scores) : 0;
  const determinism = (() => {
    const total = totalWeight(task.assertions);
    if (total <= 0) return 0;
    const det = task.assertions
      .filter((a) => !isJudgeKind(a.kind))
      .reduce((acc, a) => acc + (Number.isFinite(a.weight) && a.weight > 0 ? a.weight : 0), 0);
    return det / total;
  })();
  const meanTokensOut =
    grades.length > 0 ? grades.reduce((acc, g) => acc + g.tokensOut, 0) / grades.length : 0;

  return {
    taskId: task.id,
    grades,
    meanScore: round(meanScore, 4),
    spread: round(spread, 4),
    minScore: scores.length > 0 ? round(Math.min(...scores), 4) : 0,
    maxScore: scores.length > 0 ? round(Math.max(...scores), 4) : 0,
    determinism: round(determinism, 4),
    meanTokensOut: round(meanTokensOut, 2),
    graderVersion: GRADER_VERSION,
    engineVersion: ENGINE_VERSION,
    determinable: grades.some((g) => g.outcomes.some((o) => o.deterministic && o.weight > 0)),
  };
}