/**
 * Typed repository.
 *
 * Every read is filtered by `scope`. A scope is an anonymous browser session
 * (an unguessable id in an HTTP-only cookie) or an account. There is no code
 * path that returns a row the caller does not own: cross-scope reads are
 * indistinguishable from not-found, so the API cannot be used to enumerate
 * other people's work.
 *
 * Every mutation appends to that task's hash chain. The append is guarded by
 * an optimistic `WHERE seal = $previous` so two concurrent writers cannot both
 * extend the chain from the same head.
 */

import { GENESIS_SEAL, canonicalJson, seal, verifyChain } from "../canonical.ts";
import { SEED_SCOPE, SEED_TASKS } from "../seed.ts";
import type {
  Assertion,
  AuditAction,
  AuditEvent,
  BenchmarkTask,
  BenchmarkTaskInput,
  Decision,
  ReplayResult,
  TaskStatus,
  Transcript,
} from "../types.ts";
import { ready } from "./client.ts";

export class NotFoundError extends Error {
  constructor() {
    super("No such task in this session.");
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  constructor(message = "The task changed while you were editing it. Reload and try again.") {
    super(message);
    this.name = "ConflictError";
  }
}

export class ValidationError extends Error {
  details: { path: string; message: string }[];
  constructor(details: { path: string; message: string }[]) {
    super("The task failed validation.");
    this.name = "ValidationError";
    this.details = details;
  }
}

/**
 * Timestamps are hashed, so they must round-trip byte-identically.
 *
 * `timestamptz::text` renders as `2026-10-03 07:20:31.123456+00`, while the
 * string that was sealed was `toISOString()`'s `2026-10-03T07:20:31.123Z`.
 * Reading the column back through this expression guarantees the value read
 * from Postgres is character-for-character the value that was hashed.
 */
const ISO_UTC = (column: string): string =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

const TASK_COLUMNS = `
  id, slug, name, failure_mode, prompt,
  sealed_fixtures, assertions, transcripts,
  seed, target_model, target_temp, target_revision,
  token_budget, status, decision, scope,
  ${ISO_UTC("created_at")} AS created_at,
  ${ISO_UTC("updated_at")} AS updated_at,
  ${ISO_UTC("deleted_at")} AS deleted_at,
  seal
`;

type TaskRow = {
  id: string;
  slug: string;
  name: string;
  failure_mode: string;
  prompt: string;
  sealed_fixtures: unknown;
  assertions: unknown;
  transcripts: unknown;
  seed: number | null;
  target_model: string | null;
  target_temp: number | null;
  target_revision: string | null;
  token_budget: number;
  status: string;
  decision: unknown;
  scope: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  seal: string;
};

function asArray<T>(value: unknown, fallback: T[]): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function asObject<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return value as T;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return null;
}

function mapRow(row: TaskRow): BenchmarkTask {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    failureMode: row.failure_mode,
    prompt: row.prompt,
    sealedFixtures: asArray<string>(row.sealed_fixtures, []),
    assertions: asArray<Assertion>(row.assertions, []),
    transcripts: asArray<Transcript>(row.transcripts, []),
    seed: row.seed === null ? null : Number(row.seed),
    targetModel: row.target_model,
    targetTemp: row.target_temp === null ? null : Number(row.target_temp),
    targetRevision: row.target_revision,
    tokenBudget: Number(row.token_budget ?? 0),
    status: row.status as TaskStatus,
    decision: asObject<Decision>(row.decision),
    scope: row.scope,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    seal: row.seal,
  };
}

/* ------------------------------------------------------------------ *
 * Seeding
 * ------------------------------------------------------------------ */

/**
 * Idempotent first-run seed. Seed rows live under their own scope with fixed
 * ids, so they can never collide with a row a visitor created and re-running
 * this never duplicates anything.
 */
export async function ensureSeed(): Promise<void> {
  const db = await ready();
  const existing = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM tasks WHERE scope = $1",
    [SEED_SCOPE],
  );
  if (Number(existing.rows[0]?.n ?? 0) > 0) return;

  for (const task of SEED_TASKS) {
    await db.query(
      `INSERT INTO tasks (
         id, slug, name, failure_mode, prompt, sealed_fixtures, assertions,
         transcripts, seed, target_model, target_temp, target_revision,
         token_budget, status, decision, scope, seal
       ) VALUES (
         $1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17
       )
       ON CONFLICT (id) DO NOTHING`,
      [
        task.id,
        task.slug,
        task.name,
        task.failureMode,
        task.prompt,
        JSON.stringify(task.sealedFixtures),
        JSON.stringify(task.assertions),
        JSON.stringify(task.transcripts),
        task.seed,
        task.targetModel,
        task.targetTemp,
        task.targetRevision,
        task.tokenBudget,
        task.status,
        task.decision ? JSON.stringify(task.decision) : null,
        task.scope,
        task.seal,
      ],
    );
  }
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export type ListOptions = {
  limit: number;
  /** Return rows strictly older than this ISO timestamp. */
  before?: string | null;
  status?: TaskStatus | null;
  /** Include soft-deleted tombstones. */
  includeRetired?: boolean;
};

export type ListResult = {
  tasks: BenchmarkTask[];
  nextBefore: string | null;
  total: number;
};

export async function listTasks(scope: string, options: ListOptions): Promise<ListResult> {
  const db = await ready();
  const where: string[] = ["scope = $1"];
  const params: unknown[] = [scope];

  if (!options.includeRetired) where.push("deleted_at IS NULL");
  if (options.status) {
    params.push(options.status);
    where.push(`status = $${params.length}`);
  }
  if (options.before) {
    params.push(options.before);
    where.push(`created_at < $${params.length}::timestamptz`);
  }

  const clause = where.join(" AND ");
  const rows = await db.query<TaskRow>(
    `SELECT ${TASK_COLUMNS} FROM tasks WHERE ${clause} ORDER BY created_at DESC LIMIT $${params.length + 1}`,
    [...params, options.limit + 1],
  );

  const page = rows.rows.slice(0, options.limit).map(mapRow);
  const hasMore = rows.rows.length > options.limit;
  const last = page[page.length - 1];

  const countRows = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM tasks WHERE ${clause}`,
    params.slice(0, options.before ? params.length - 1 : params.length),
  );

  return {
    tasks: page,
    nextBefore: hasMore && last ? last.createdAt : null,
    total: Number(countRows.rows[0]?.n ?? 0),
  };
}

export async function getTask(scope: string, id: string): Promise<BenchmarkTask | null> {
  const db = await ready();
  const rows = await db.query<TaskRow>(
    `SELECT ${TASK_COLUMNS} FROM tasks WHERE id = $1 AND scope = $2`,
    [id, scope],
  );
  const row = rows.rows[0];
  return row ? mapRow(row) : null;
}

export async function requireTask(scope: string, id: string): Promise<BenchmarkTask> {
  const task = await getTask(scope, id);
  if (!task) throw new NotFoundError();
  return task;
}

/* ------------------------------------------------------------------ *
 * Audit chain
 * ------------------------------------------------------------------ */

function snapshotOf(task: BenchmarkTask): unknown {
  return {
    id: task.id,
    name: task.name,
    failureMode: task.failureMode,
    prompt: task.prompt,
    sealedFixtures: task.sealedFixtures,
    assertions: task.assertions,
    transcripts: task.transcripts,
    seed: task.seed,
    targetModel: task.targetModel,
    targetTemp: task.targetTemp,
    targetRevision: task.targetRevision,
    tokenBudget: task.tokenBudget,
    status: task.status,
    decision: task.decision,
  };
}

/**
 * Append one event and advance the task's seal head.
 *
 * The `WHERE seal = $previous` guard makes this compare-and-swap: if another
 * writer extended the chain first, zero rows are updated and we retry rather
 * than forking the chain.
 */
export async function appendAudit(
  task: BenchmarkTask,
  action: AuditAction,
  detail: string,
  actor: string,
  score: number | null,
): Promise<string> {
  const db = await ready();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await requireTask(task.scope, task.id);

    const rows = await db.query<{ seq: number; seal: string }>(
      "SELECT seq, seal FROM audit_events WHERE task_id = $1 ORDER BY seq DESC LIMIT 1",
      [task.id],
    );
    const lastSeq = Number(rows.rows[0]?.seq ?? 0);
    const prevSeal = rows.rows[0]?.seal ?? current.seal ?? GENESIS_SEAL;
    const seq = lastSeq + 1;
    const at = new Date().toISOString();

    const payload = {
      seq,
      taskId: task.id,
      action,
      at,
      scope: current.scope,
      detail,
      actor,
      score,
      snapshot: snapshotOf(current),
    };

    const eventSeal = await seal(prevSeal, payload);

    await db.query(
      `INSERT INTO audit_events
         (task_id, seq, action, at, scope, detail, actor, score, snapshot, prev_seal, seal)
       VALUES ($1,$2,$3,$4::timestamptz,$5,$6,$7,$8,$9::jsonb,$10,$11)`,
      [
        task.id,
        seq,
        action,
        at,
        current.scope,
        detail,
        actor,
        score,
        JSON.stringify(payload.snapshot),
        prevSeal,
        eventSeal,
      ],
    );

    const updated = await db.query<{ seal: string }>(
      "UPDATE tasks SET seal = $1, updated_at = $2::timestamptz WHERE id = $3 AND seal = $4 RETURNING seal",
      [eventSeal, at, task.id, current.seal],
    );

    if (updated.rows.length > 0) return eventSeal;
    // Lost the race. Roll the sequence back so the retry reuses it.
    await db.query("DELETE FROM audit_events WHERE task_id = $1 AND seq = $2", [task.id, seq]);
  }

  throw new ConflictError("Could not extend the audit chain; five writers collided.");
}

export async function listAudit(scope: string, taskId: string): Promise<AuditEvent[]> {
  const db = await ready();
  const rows = await db.query<{
    task_id: string;
    seq: number;
    action: string;
    at: string;
    scope: string;
    detail: string;
    actor: string;
    score: number | null;
    snapshot: unknown;
    prev_seal: string;
    seal: string;
  }>(
    `SELECT task_id, seq, action, ${ISO_UTC("at")} AS at, scope, detail, actor, score,
            snapshot, prev_seal, seal
       FROM audit_events
      WHERE task_id = $1 AND scope = $2
      ORDER BY seq ASC`,
    [taskId, scope],
  );

  return rows.rows.map((r) => ({
    seq: Number(r.seq),
    taskId: r.task_id,
    action: r.action as AuditAction,
    at: r.at,
    scope: r.scope,
    detail: r.detail,
    actor: r.actor,
    score: r.score === null ? null : Number(r.score),
    snapshot: asObject<Record<string, unknown>>(r.snapshot) ?? {},
    prevSeal: r.prev_seal,
    seal: r.seal,
  }));
}

/** Recompute the whole chain and report the first broken link. */
export async function replayTask(scope: string, taskId: string): Promise<ReplayResult> {
  const db = await ready();
  const task = await getTask(scope, taskId);
  if (!task) throw new NotFoundError();

  const rows = await db.query<{
    seq: number;
    action: string;
    at: string;
    scope: string;
    detail: string;
    actor: string;
    score: number | null;
    snapshot: unknown;
    prev_seal: string;
    seal: string;
  }>(
    `SELECT seq, action, ${ISO_UTC("at")} AS at, scope, detail, actor, score, snapshot, prev_seal, seal
       FROM audit_events WHERE task_id = $1 AND scope = $2 ORDER BY seq ASC`,
    [taskId, scope],
  );

  const links = rows.rows.map((r) => ({
    prevSeal: r.prev_seal,
    event: {
      seq: Number(r.seq),
      taskId,
      action: r.action,
      at: r.at,
      scope: r.scope,
      detail: r.detail,
      actor: r.actor,
      score: r.score === null ? null : Number(r.score),
      snapshot: asObject<Record<string, unknown>>(r.snapshot) ?? {},
      seal: r.seal,
    },
  }));

  const verdict = await verifyChain(links);
  const head = rows.rows.length > 0 ? rows.rows[rows.rows.length - 1].seal : GENESIS_SEAL;

  return {
    taskId,
    ok: verdict.ok,
    checked: links.length,
    head,
    brokenAtSeq: verdict.brokenAtIndex === null ? null : Number(links[verdict.brokenAtIndex].event.seq),
    brokenReason: verdict.reason,
    genesis: GENESIS_SEAL,
  };
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function uniqueSlug(scope: string, name: string, db: Awaited<ReturnType<typeof ready>>): Promise<string> {
  const base = slugify(name) || "task";
  for (let i = 0; i < 40; i += 1) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const found = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM tasks WHERE scope = $1 AND slug = $2",
      [scope, candidate],
    );
    if (Number(found.rows[0]?.n ?? 0) === 0) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function createTask(
  scope: string,
  input: BenchmarkTaskInput & { name: string; failureMode: string; prompt: string },
  actor: string,
): Promise<BenchmarkTask> {
  const db = await ready();
  const id = crypto.randomUUID();
  const slug = await uniqueSlug(scope, input.name, db);
  const now = new Date().toISOString();

  await db.query(
    `INSERT INTO tasks (
       id, slug, name, failure_mode, prompt, sealed_fixtures, assertions,
       transcripts, seed, target_model, target_temp, target_revision,
       token_budget, status, decision, scope, created_at, updated_at, seal
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17::timestamptz,$17::timestamptz,$18)`,
    [
      id,
      slug,
      input.name,
      input.failureMode,
      input.prompt,
      JSON.stringify(input.sealedFixtures ?? []),
      JSON.stringify(input.assertions ?? []),
      JSON.stringify(input.transcripts ?? []),
      input.seed ?? null,
      input.targetModel ?? null,
      input.targetTemp ?? null,
      input.targetRevision ?? null,
      Math.max(0, Math.round(input.tokenBudget ?? 0)),
      input.status ?? "forging",
      input.decision ? JSON.stringify(input.decision) : null,
      scope,
      now,
      GENESIS_SEAL,
    ],
  );

  const task = await requireTask(scope, id);
  await appendAudit(task, "create", `Forged "${task.name}"`, actor, null);
  return requireTask(scope, id);
}

export async function updateTask(
  scope: string,
  id: string,
  patch: Partial<BenchmarkTaskInput>,
  actor: string,
  score: number | null,
): Promise<BenchmarkTask> {
  const db = await ready();
  const existing = await requireTask(scope, id);

  const next = {
    name: patch.name ?? existing.name,
    failureMode: patch.failureMode ?? existing.failureMode,
    prompt: patch.prompt ?? existing.prompt,
    sealedFixtures: patch.sealedFixtures ?? existing.sealedFixtures,
    assertions: patch.assertions ?? existing.assertions,
    transcripts: patch.transcripts ?? existing.transcripts,
    seed: patch.seed === undefined ? existing.seed : patch.seed,
    targetModel: patch.targetModel === undefined ? existing.targetModel : patch.targetModel,
    targetTemp: patch.targetTemp === undefined ? existing.targetTemp : patch.targetTemp,
    targetRevision:
      patch.targetRevision === undefined ? existing.targetRevision : patch.targetRevision,
    tokenBudget:
      patch.tokenBudget === undefined ? existing.tokenBudget : Math.max(0, Math.round(patch.tokenBudget)),
    status: patch.status ?? existing.status,
    decision: patch.decision === undefined ? existing.decision : patch.decision,
  };

  await db.query(
    `UPDATE tasks SET
       name = $1, failure_mode = $2, prompt = $3, sealed_fixtures = $4::jsonb,
       assertions = $5::jsonb, transcripts = $6::jsonb, seed = $7,
       target_model = $8, target_temp = $9, target_revision = $10,
       token_budget = $11, status = $12, decision = $13::jsonb,
       updated_at = now()
     WHERE id = $14 AND scope = $15`,
    [
      next.name,
      next.failureMode,
      next.prompt,
      JSON.stringify(next.sealedFixtures),
      JSON.stringify(next.assertions),
      JSON.stringify(next.transcripts),
      next.seed,
      next.targetModel,
      next.targetTemp,
      next.targetRevision,
      next.tokenBudget,
      next.status,
      next.decision ? JSON.stringify(next.decision) : null,
      id,
      scope,
    ],
  );

  const updated = await requireTask(scope, id);
  await appendAudit(updated, "update", `Revised "${updated.name}"`, actor, score);
  return requireTask(scope, id);
}

export async function recordDecision(
  scope: string,
  id: string,
  verdict: Decision["verdict"],
  note: string,
  actor: string,
  score: number | null,
): Promise<BenchmarkTask> {
  const db = await ready();
  // Existence check. A cross-scope id throws NotFound here, before any write.
  await requireTask(scope, id);
  const decision: Decision = {
    verdict,
    note,
    recordedAt: new Date().toISOString(),
    scoreAtDecision: score ?? 0,
  };

  await db.query(
    "UPDATE tasks SET decision = $1::jsonb, updated_at = now() WHERE id = $2 AND scope = $3",
    [JSON.stringify(decision), id, scope],
  );

  const updated = await requireTask(scope, id);
  await appendAudit(updated, "decision", `Recorded a ${verdict} decision`, actor, score);
  return requireTask(scope, id);
}

/**
 * Soft delete. The row is kept and flagged so the audit chain still replays,
 * and the tombstone itself is an event.
 */
export async function retireTask(scope: string, id: string, actor: string): Promise<BenchmarkTask> {
  const db = await ready();
  const existing = await requireTask(scope, id);

  if (existing.deletedAt) return existing;

  await db.query(
    "UPDATE tasks SET deleted_at = now(), status = 'retired', updated_at = now() WHERE id = $1 AND scope = $2",
    [id, scope],
  );

  const updated = await requireTask(scope, id);
  await appendAudit(updated, "retire", 'Retired as a tombstone', actor, null);
  await appendAudit(updated, "delete", "Deleted; the tombstone is retained so the chain replays", actor, null);
  return requireTask(scope, id);
}

/* ------------------------------------------------------------------ *
 * Settings + idempotency
 * ------------------------------------------------------------------ */

export async function getSettings(scope: string): Promise<Record<string, unknown> | null> {
  const db = await ready();
  const rows = await db.query<{ body: unknown }>(
    "SELECT body FROM scope_settings WHERE scope = $1",
    [scope],
  );
  return rows.rows[0] ? asObject<Record<string, unknown>>(rows.rows[0].body) : null;
}

export async function putSettings(
  scope: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const db = await ready();
  await db.query(
    `INSERT INTO scope_settings (scope, body, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (scope) DO UPDATE SET body = $2::jsonb, updated_at = now()`,
    [scope, JSON.stringify(body)],
  );
  return body;
}

/**
 * Durable idempotency for agent mutations. Returns the stored result when the
 * key has been seen, otherwise null so the caller performs the mutation.
 */
export async function readIdempotent(
  scope: string,
  key: string,
): Promise<{ tool: string; result: unknown } | null> {
  const db = await ready();
  const rows = await db.query<{ tool: string; result: unknown }>(
    "SELECT tool, result FROM idempotency WHERE key = $1 AND scope = $2",
    [key, scope],
  );
  if (!rows.rows[0]) return null;
  return { tool: rows.rows[0].tool, result: asObject<Record<string, unknown>>(rows.rows[0].result) };
}

export async function writeIdempotent(
  scope: string,
  key: string,
  tool: string,
  result: unknown,
): Promise<void> {
  const db = await ready();
  await db.query(
    `INSERT INTO idempotency (key, scope, tool, result) VALUES ($1,$2,$3,$4::jsonb)
     ON CONFLICT (key) DO NOTHING`,
    [key, scope, tool, JSON.stringify(result)],
  );
}

/** Canonical text used by the dossier export so two exports of one task match. */
export function canonicalTaskJson(task: BenchmarkTask): string {
  return canonicalJson(snapshotOf(task));
}