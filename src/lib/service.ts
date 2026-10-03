/**
 * Service layer.
 *
 * Everything that mutates a task goes through here. The REST routes, the MCP
 * tools and the agent console all call these functions, so "the agent mutated
 * it" and "I clicked the button" are the same code path by construction rather
 * than by discipline.
 */

import { GRADE_WEIGHTS, gradeTask } from "./grade.ts";
import { lookupModel } from "./live/index.ts";
import { kaggleBundle } from "./kaggle.ts";
import {
  appendAudit,
  createTask,
  getSettings,
  getTask,
  listTasks,
  putSettings,
  recordDecision,
  replayTask,
  requireTask,
  retireTask,
  updateTask,
  type ListOptions,
} from "./db/repository.ts";
import { readIdempotent, writeIdempotent } from "./db/repository.ts";
import type {
  BenchmarkTask,
  BenchmarkTaskInput,
  Decision,
  EngineVerdict,
  ModelFacts,
  TaskGrade,
  TaskStatus,
} from "./types.ts";

export type TaskView = {
  task: BenchmarkTask;
  verdict: EngineVerdict;
  grade: TaskGrade;
  modelFacts: ModelFacts | null;
};

/** Live Hub facts for the target model, or null when it publishes no repo. */
async function factsFor(task: BenchmarkTask): Promise<ModelFacts | null> {
  if (!task.targetModel) return null;
  const facts = await lookupModel(task.targetModel);
  return facts.found ? facts : null;
}

export async function viewTask(scope: string, id: string): Promise<TaskView> {
  const task = await requireTask(scope, id);
  const modelFacts = await factsFor(task);
  const { verdict, grade } = gradeTask(task, { modelFacts });
  return { task, verdict, grade, modelFacts };
}

/** Engine-only projection for list rows: no transcript payloads. */
export type TaskSummary = {
  id: string;
  slug: string;
  name: string;
  failureMode: string;
  status: TaskStatus;
  decision: Decision | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  seal: string;
  sealedReference: boolean;
  assertionCount: number;
  transcriptCount: number;
  modelIds: string[];
  verdict: EngineVerdict;
};

export async function listTaskViews(
  scope: string,
  options: ListOptions,
): Promise<{ tasks: TaskSummary[]; nextBefore: string | null; total: number }> {
  const page = await listTasks(scope, options);

  const tasks = page.tasks.map((task) => {
    // No live call per row: a list of 20 tasks must not cost 20 upstream polls.
    const { verdict } = gradeTask(task, { modelFacts: null });
    return {
      id: task.id,
      slug: task.slug,
      name: task.name,
      failureMode: task.failureMode,
      status: task.status,
      decision: task.decision,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      deletedAt: task.deletedAt,
      seal: task.seal,
      sealedReference: task.scope === "seed",
      assertionCount: task.assertions.length,
      transcriptCount: task.transcripts.length,
      modelIds: Array.from(new Set(task.transcripts.map((t) => t.modelId))),
      verdict,
    } satisfies TaskSummary;
  });

  return { tasks, nextBefore: page.nextBefore, total: page.total };
}

export async function createTaskView(
  scope: string,
  input: BenchmarkTaskInput & { name: string; failureMode: string; prompt: string },
  actor: string,
): Promise<TaskView> {
  const task = await createTask(scope, input, actor);
  return viewTask(scope, task.id);
}

export async function updateTaskView(
  scope: string,
  id: string,
  patch: BenchmarkTaskInput,
  actor: string,
): Promise<TaskView> {
  const task = await requireTask(scope, id);

  // Grade first so the score recorded on the audit event is the score of the
  // state the operator was looking at when they pressed save.
  const before = gradeTask(task, { modelFacts: null }).verdict;

  await updateTask(scope, id, patch, actor, before.score);
  return viewTask(scope, id);
}

export async function decideTaskView(
  scope: string,
  id: string,
  verdictValue: Decision["verdict"],
  note: string,
  actor: string,
): Promise<TaskView> {
  const task = await requireTask(scope, id);
  const { verdict } = gradeTask(task, { modelFacts: null });
  await recordDecision(scope, id, verdictValue, note, actor, verdict.score);
  return viewTask(scope, id);
}

export async function retireTaskView(
  scope: string,
  id: string,
  actor: string,
): Promise<{ task: BenchmarkTask; integrity: Awaited<ReturnType<typeof replayTask>> }> {
  const task = await retireTask(scope, id, actor);
  const integrity = await replayTask(scope, id);
  return { task, integrity };
}

/**
 * Re-run the engine and append the result to the chain.
 *
 * Grading is a pure function, so grading alone is not a mutation. Recording
 * that a grade was taken *is*, and that is what this records.
 */
export async function gradeTaskView(
  scope: string,
  id: string,
  actor: string,
): Promise<TaskView & { seal: string }> {
  const task = await requireTask(scope, id);
  const modelFacts = await factsFor(task);
  const { verdict, grade } = gradeTask(task, { modelFacts });
  const seal = await appendAudit(
    task,
    "grade",
    `Graded with ${verdict.engineVersion}: ${verdict.score} (${verdict.band.label})`,
    actor,
    verdict.score,
  );
  const fresh = await requireTask(scope, id);
  return { task: fresh, verdict, grade, modelFacts, seal };
}

export async function integrityView(scope: string, id: string) {
  const task = await requireTask(scope, id);
  const replay = await replayTask(scope, id);
  const verdict = gradeTask(task, { modelFacts: null }).verdict;
  return { integrity: replay, verdict, seal: replay.head };
}

export { kaggleBundle };
export { getTask, getSettings, putSettings };

/**
 * Durable idempotency wrapper.
 *
 * An agent retrying `forge_task` with the same key must not produce a second
 * task. The stored result is returned verbatim so the retry is a true no-op.
 */
export async function withIdempotency<T>(
  scope: string,
  key: string | null,
  tool: string,
  run: () => Promise<T>,
): Promise<{ value: T; replayed: boolean }> {
  if (!key) return { value: await run(), replayed: false };

  const existing = await readIdempotent(scope, key);
  if (existing) return { value: existing.result as T, replayed: true };

  const value = await run();
  await writeIdempotent(scope, key, tool, value);
  return { value, replayed: false };
}

export const ENGINE_METADATA = {
  engineVersion: "crucible-grade-v1.0.0",
  graderVersion: "crucible-grader-v1.0.0",
  weights: GRADE_WEIGHTS,
};