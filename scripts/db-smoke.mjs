/**
 * Exercises the real persistence layer against the real embedded adapter.
 *
 * This is a store-level smoke test, not a mock: it creates the schema, seeds,
 * writes, reads back, updates, decides, retires, and replays the hash chain.
 * It runs with zero environment variables.
 *
 *   node scripts/db-smoke.mjs
 */

import { rm } from "node:fs/promises";

const dir = process.env.CRUCIBLE_PGLITE_DIR ?? ".crucible/smoke";
process.env.CRUCIBLE_PGLITE_DIR = dir;

let failures = 0;
let checks = 0;

function check(label, condition, extra = "") {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label} ${extra}`);
  }
}

async function main() {
  await rm(dir, { recursive: true, force: true });

  const { ping, describeAdapter } = await import("../src/lib/db/client.ts");
  const repo = await import("../src/lib/db/repository.ts");
  const { gradeTask } = await import("../src/lib/grade.ts");

  console.log("\nadapter");
  const adapter = describeAdapter();
  check("resolves an adapter", adapter.kind === "pglite", adapter.kind);
  check("reports itself as non-durable", adapter.durable === false);

  console.log("\nhealth round trip");
  const probe = await ping();
  check("SELECT 1 succeeds", probe.ok, probe.detail);

  console.log("\nseed");
  await repo.ensureSeed();
  await repo.ensureSeed(); // must be idempotent
  const seeded = await repo.listTasks("seed", { limit: 50 });
  check("seeds exactly three reference tasks", seeded.tasks.length === 3, `got ${seeded.tasks.length}`);

  console.log("\nownership scoping");
  const owner = "a".repeat(32);
  const stranger = "b".repeat(32);
  const visible = await repo.listTasks(owner, { limit: 10 });
  check("a fresh scope sees none of the seeded rows", visible.tasks.length === 0);
  const stolen = await repo.getTask(stranger, seeded.tasks[0].id);
  check("cross-scope read returns null", stolen === null);
  let threwNotFound = false;
  try {
    await repo.requireTask(stranger, seeded.tasks[0].id);
  } catch (error) {
    threwNotFound = error.name === "NotFoundError";
  }
  check("cross-scope require throws NotFound", threwNotFound);

  console.log("\ncreate -> read back");
  const created = await repo.createTask(
    owner,
    {
      name: "Smoke task",
      failureMode: "the model forgets to close the array",
      prompt: "Return a JSON array of the three ids you were given.",
      sealedFixtures: ["ids.json=sha256:abcdef0123456789"],
      assertions: [
        { id: "a1", kind: "regex", label: "opens with a bracket", weight: 1, required: true, pattern: "^\\s*\\[" },
      ],
      transcripts: [
        {
          id: "t1",
          modelId: "google/gemini-2.5-flash",
          modelLabel: "gemini-2.5-flash",
          prompt: "p",
          completion: "[1,2,3]",
          latencyMs: 900,
          tokensIn: 50,
          tokensOut: 12,
          origin: "recorded",
        },
      ],
      seed: 5,
      targetModel: "google/gemini-2.5-flash",
      targetTemp: 0,
      targetRevision: "rev-abc",
      tokenBudget: 500,
    },
    "ui:smoke",
  );
  check("returns a row with a generated id", typeof created.id === "string" && created.id.length > 10);
  check("derives a slug", created.slug === "smoke-task", created.slug);
  const fetched = await repo.getTask(owner, created.id);
  check("reads back by id", fetched !== null);
  check("prompt survived the round trip", fetched.prompt.startsWith("Return a JSON array"));
  check("assertion survived as jsonb", Array.isArray(fetched.assertions) && fetched.assertions.length === 1);
  check("sealed fixture survived as jsonb", fetched.sealedFixtures[0]?.startsWith("ids.json="));

  console.log("\nupdate + decide");
  const updated = await repo.updateTask(owner, created.id, { name: "Smoke task v2" }, "ui:smoke", 42);
  check("name changed", updated.name === "Smoke task v2");
  const decided = await repo.recordDecision(owner, created.id, "adopt", "good enough", "ui:smoke", 42);
  check("decision recorded", decided.decision?.verdict === "adopt");
  check("decision carries the score at decision time", decided.decision?.scoreAtDecision === 42);

  console.log("\nengine over the persisted row");
  const verdict = gradeTask(updated).verdict;
  check("engine scores the persisted task", typeof verdict.score === "number" && !Number.isNaN(verdict.score));
  check("engine returns six factors", verdict.factors.length === 6);
  check("engine names a band", typeof verdict.band.id === "string");

  console.log("\nidempotency");
  await repo.writeIdempotent(owner, "key-1", "forge_task", { taskId: created.id });
  const again = await repo.readIdempotent(owner, "key-1");
  check("stored result is returned on replay", again?.result?.taskId === created.id);
  const otherScope = await repo.readIdempotent(stranger, "key-1");
  check("idempotency keys are scoped", otherScope === null);

  console.log("\nsettings");
  await repo.putSettings(owner, { heatDial: 0.4 });
  const settings = await repo.getSettings(owner);
  check("settings round trip", settings?.heatDial === 0.4);

  console.log("\nretire + tombstone + replay");
  await repo.retireTask(owner, created.id, "ui:smoke");
  const live = await repo.listTasks(owner, { limit: 10 });
  check("retired task leaves the live listing", live.tasks.length === 0);
  const withRetired = await repo.listTasks(owner, { limit: 10, includeRetired: true });
  check("tombstone is retained and still readable", withRetired.tasks.length === 1);
  check("tombstone records the deletion time", withRetired.tasks[0].deletedAt !== null);

  const replay = await repo.replayTask(owner, created.id);
  check("chain replays clean after deletion", replay.ok, replay.brokenReason ?? "");
  check("replay checked several links", replay.checked >= 4, `checked ${replay.checked}`);
  check("replay head is not the genesis", replay.head !== replay.genesis);

  const events = await repo.listAudit(owner, created.id);
  check("every mutation appended an event", events.length >= 5, `${events.length} events`);
  check("audit is ordered by sequence", events.every((e, i) => e.seq === i + 1));
  check("audit records the actor", events.every((e) => typeof e.actor === "string" && e.actor.length > 0));

  console.log("\ntamper detection");
  const { db } = await import("../src/lib/db/client.ts").then(async (m) => ({ db: await m.ready() }));
  await db.query(
    "UPDATE audit_events SET detail = 'quietly rewritten' WHERE task_id = $1 AND seq = 2",
    [created.id],
  );
  const tampered = await repo.replayTask(owner, created.id);
  check("a rewritten event is detected", tampered.ok === false);
  check("replay names the broken sequence", tampered.brokenAtSeq === 2, `got ${tampered.brokenAtSeq}`);

  await rm(dir, { recursive: true, force: true });

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error("\nsmoke run crashed:", error);
  process.exit(1);
});