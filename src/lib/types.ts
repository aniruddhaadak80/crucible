/**
 * Normalized domain types.
 *
 * Every external source is normalised into the shapes below so the rest of the
 * app never sees a raw upstream payload. Attribution, fetch time and status are
 * part of the type, not an afterthought, which is what makes the
 * live-versus-fallback distinction impossible to lose in transit.
 */

export const ENGINE_VERSION = "crucible-grade-v1.0.0";
export const GRADER_VERSION = "crucible-grader-v1.0.0";

/* ------------------------------------------------------------------ *
 * Grader primitives
 * ------------------------------------------------------------------ */

/**
 * Assertion kinds split into two families.
 *
 * `DETERMINISTIC_KINDS` are decided by exact string, regex or numeric
 * comparison against the recorded completion. They replay identically forever.
 *
 * `JUDGE_KINDS` need a language model in the loop. They are recorded, weighted
 * and reported, but they are explicitly *not* determinism, and the engine
 * charges the task for every one of them.
 */
export const DETERMINISTIC_ASSERTION_KINDS = [
  "regex",
  "contains",
  "not_contains",
  "json_path_equals",
  "number_between",
] as const;

export const JUDGE_ASSERTION_KINDS = ["judge_rubric"] as const;

export const ASSERTION_KINDS = [
  ...DETERMINISTIC_ASSERTION_KINDS,
  ...JUDGE_ASSERTION_KINDS,
] as const;

export type DeterministicAssertionKind = (typeof DETERMINISTIC_ASSERTION_KINDS)[number];
export type JudgeAssertionKind = (typeof JUDGE_ASSERTION_KINDS)[number];
export type AssertionKind = (typeof ASSERTION_KINDS)[number];

export function isJudgeKind(kind: AssertionKind): kind is JudgeAssertionKind {
  return (JUDGE_ASSERTION_KINDS as readonly string[]).includes(kind);
}

/**
 * How precisely an assertion can pin a completion. This is a published
 * constant, not a judgement call: a substring match cannot distinguish
 * "mentions the number" from "computes the number", and the engine says so.
 */
export const ASSERTION_SPECIFICITY: Readonly<Record<AssertionKind, number>> = {
  regex: 1,
  json_path_equals: 1,
  number_between: 1,
  not_contains: 0.7,
  contains: 0.6,
  judge_rubric: 0.2,
};

export type Assertion = {
  id: string;
  kind: AssertionKind;
  /** Human label shown on the tape. Never used for grading. */
  label: string;
  /** Relative weight within the task. Normalised at grade time. */
  weight: number;
  required: boolean;
  /** regex */
  pattern?: string;
  /** contains / not_contains */
  needle?: string;
  /** json_path_equals, dot separated */
  path?: string;
  jsonExpected?: string;
  /** number_between */
  min?: number;
  max?: number;
  /** judge_rubric */
  rubric?: string;
};

export type Transcript = {
  id: string;
  /** Canonical model id as recorded at capture time. */
  modelId: string;
  modelLabel: string;
  prompt: string;
  completion: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  /** Where this transcript came from. Sealed fixtures are labelled as such. */
  origin: "recorded" | "seeded";
};

/* ------------------------------------------------------------------ *
 * Core entity
 * ------------------------------------------------------------------ */

export const TASK_STATUSES = ["forging", "poured", "retired"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export type Decision = {
  /** adopt / iterate / discard */
  verdict: "adopt" | "iterate" | "discard";
  note: string;
  recordedAt: string;
  /** Engine score at the moment of the decision. */
  scoreAtDecision: number;
};

export type BenchmarkTask = {
  id: string;
  slug: string;
  name: string;
  /** The itch. One sentence, in the operator's words. */
  failureMode: string;
  prompt: string;
  /** Declared immutable inputs, each a `name=hash` pair. */
  sealedFixtures: string[];
  assertions: Assertion[];
  transcripts: Transcript[];
  seed: number | null;
  targetModel: string | null;
  targetTemp: number | null;
  /** Pinned upstream revision, when the operator pinned one. */
  targetRevision: string | null;
  /** Token budget for one run of one model across the task. */
  tokenBudget: number;
  status: TaskStatus;
  decision: Decision | null;
  /** Anonymous session or account scope that owns the row. */
  scope: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** Head of this task's audit hash chain. */
  seal: string;
};

/**
 * Shape accepted by create/update. Everything else is server-derived.
 *
 * `name`, `failureMode` and `prompt` are optional because a PATCH does not have
 * to resend them. Validation enforces presence on create.
 */
export type BenchmarkTaskInput = {
  name?: string;
  failureMode?: string;
  prompt?: string;
  sealedFixtures?: string[];
  assertions?: Assertion[];
  transcripts?: Transcript[];
  seed?: number | null;
  targetModel?: string | null;
  targetTemp?: number | null;
  targetRevision?: string | null;
  tokenBudget?: number;
  status?: TaskStatus;
  decision?: Decision | null;
};

/* ------------------------------------------------------------------ *
 * Grader output
 * ------------------------------------------------------------------ */

export type AssertionOutcome = {
  assertionId: string;
  kind: AssertionKind;
  label: string;
  /** null means "requires a judge and was not decided on this server". */
  passed: boolean | null;
  weight: number;
  /** The exact span or value that decided the assertion. */
  evidence: string;
  deterministic: boolean;
};

export type TranscriptGrade = {
  transcriptId: string;
  modelId: string;
  modelLabel: string;
  /** Weighted pass fraction over deterministic assertions, 0..1. */
  score: number;
  /** Weighted pass fraction over judge assertions, 0..1, or null if none. */
  judgeScore: number | null;
  /** Fraction of total weight decided without a model, 0..1. */
  determinism: number;
  outcomes: AssertionOutcome[];
  latencyMs: number;
  tokensOut: number;
  engineVersion: string;
};

export type TaskGrade = {
  taskId: string;
  grades: TranscriptGrade[];
  /** Mean deterministic score across recorded transcripts. */
  meanScore: number;
  /** Population standard deviation across recorded transcripts. */
  spread: number;
  minScore: number;
  maxScore: number;
  determinism: number;
  meanTokensOut: number;
  /** True when at least one weighted assertion is decided without a model. */
  determinable: boolean;
  graderVersion: string;
  engineVersion: string;
};

/* ------------------------------------------------------------------ *
 * Engine output
 * ------------------------------------------------------------------ */

export const GRADE_FACTOR_IDS = [
  "determinism",
  "discrimination",
  "fixture_seal",
  "assertion_specificity",
  "reproduction",
  "cost_fit",
] as const;
export type GradeFactorId = (typeof GRADE_FACTOR_IDS)[number];

export type GradeFactor = {
  id: GradeFactorId;
  label: string;
  /** Published weight. The six weights sum to exactly 1. */
  weight: number;
  /** Normalised 0..1 value after clamping and boundary handling. */
  value: number;
  /** weight * value */
  contribution: number;
  /** The sentence that produced `value`. */
  evidence: string;
  /** Concrete things the operator can change to move this factor. */
  levers: string[];
};

export type GradeBand = {
  id: string;
  min: number;
  max: number;
  label: string;
  meaning: string;
  action: string;
};

export type ModelFacts = {
  modelId: string;
  /** Present when the live Hub lookup succeeded. */
  found: boolean;
  gated: boolean | null;
  license: string | null;
  downloads30d: number | null;
  likes: number | null;
  /** Immutable commit sha on the Hub, when the repo exposes one. */
  revision: string | null;
  pipelineTag: string | null;
  source: "huggingface" | "unavailable";
  fetchedAt: string;
};

export type EngineVerdict = {
  engineVersion: string;
  taskId: string;
  /** 0..100, rounded to one decimal. */
  score: number;
  factors: GradeFactor[];
  band: GradeBand;
  /** One actionable sentence. */
  recommendation: string;
  /** The single biggest lever, resolved from the factors. */
  weakestFactor: GradeFactorId;
  /** True when the model-dependence made the grade only partly decidable. */
  degraded: boolean;
  degradationNote: string | null;
  modelFactsApplied: boolean;
  computedAt: string;
};

/* ------------------------------------------------------------------ *
 * Integrity
 * ------------------------------------------------------------------ */

export const AUDIT_ACTIONS = [
  "create",
  "update",
  "grade",
  "decision",
  "delete",
  "retire",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditEvent = {
  seq: number;
  taskId: string;
  action: AuditAction;
  /** ISO-8601 UTC. Part of the hashed payload. */
  at: string;
  scope: string;
  /** Short human summary. Part of the hashed payload. */
  detail: string;
  /** Actor label, e.g. `ui:aniruddhaadak80` or `agent:list_tasks`. */
  actor: string;
  /** Engine score carried by the event, when the action produced one. */
  score: number | null;
  /** Canonical JSON of the entity snapshot at this point. */
  snapshot: unknown;
  prevSeal: string;
  seal: string;
};

export type ReplayResult = {
  taskId: string;
  ok: boolean;
  checked: number;
  head: string;
  /** null when the chain is intact. */
  brokenAtSeq: number | null;
  brokenReason: string | null;
  genesis: string;
};

/* ------------------------------------------------------------------ *
 * Live external data
 * ------------------------------------------------------------------ */

export type SourceStatus = "live" | "fallback";

export type FeedEnvelope<T> = {
  status: SourceStatus;
  /** ISO-8601. When the payload was produced, live or not. */
  fetchedAt: string;
  /** Upstream identity for the payload actually shown. */
  sourceName: string;
  sourceUrl: string;
  /** Human attribution string, always rendered next to the data. */
  attribution: string;
  /** Why fallback was used, null when live. */
  degradedReason: string | null;
  items: T[];
};

export type HubModelFacts = {
  modelId: string;
  likes: number | null;
  downloads: number | null;
  gated: boolean | null;
  license: string | null;
  pipelineTag: string | null;
  revision: string | null;
  createdAt: string | null;
  lastModified: string | null;
};

export type ArxivPaper = {
  id: string;
  title: string;
  summary: string;
  publishedAt: string;
  updatedAt: string;
  authors: string[];
  categories: string[];
  url: string;
  /** Model names detected in the title/abstract, lowercased. */
  mentionedModels: string[];
};

/* ------------------------------------------------------------------ *
 * Agent protocol
 * ------------------------------------------------------------------ */

export type ToolKind = "read" | "analysis" | "write";

export type ToolDescriptor = {
  name: string;
  kind: ToolKind;
  title: string;
  description: string;
  /** JSON Schema, draft 2020-12. */
  inputSchema: Record<string, unknown>;
  mutates: boolean;
  idempotent: boolean;
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    /** Field-level validation detail when present. */
    details?: { path: string; message: string }[];
    requestId?: string;
  };
};