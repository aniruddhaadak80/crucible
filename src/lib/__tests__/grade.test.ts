import test from "node:test";
import assert from "node:assert/strict";

import {
  GRADE_BANDS,
  GRADE_WEIGHTS,
  WEIGHT_SUM,
  bandFor,
  evaluateAssertion,
  extractJson,
  extractNumbers,
  getByPath,
  gradeStats,
  gradeTask,
  gradeTranscript,
  stdev,
  clamp01,
  round,
} from "../grade.ts";

import type {
  Assertion,
  BenchmarkTask,
  ModelFacts,
  Transcript,
} from "../types.ts";

/* ------------------------------------------------------------------ *
 * Builders
 * ------------------------------------------------------------------ */

function assertion(partial: Partial<Assertion> & Pick<Assertion, "id" | "kind">): Assertion {
  return {
    label: partial.id,
    weight: 1,
    required: false,
    ...partial,
  } as Assertion;
}

function transcript(partial: Partial<Transcript> & Pick<Transcript, "modelId" | "completion">): Transcript {
  return {
    id: `tr-${partial.modelId}`,
    modelLabel: partial.modelId,
    prompt: "prompt",
    latencyMs: 1000,
    tokensIn: 100,
    tokensOut: 200,
    origin: "recorded",
    ...partial,
  };
}

function task(partial: Partial<BenchmarkTask> = {}): BenchmarkTask {
  return {
    id: "task-1",
    slug: "task-1",
    name: "Nested JSON shape drift",
    failureMode: "the model nests a field instead of returning it flat",
    prompt: "Return JSON.",
    sealedFixtures: ["input.json=sha256:abc123"],
    assertions: [],
    transcripts: [],
    seed: 7,
    targetModel: "google/gemini-2.5-flash",
    targetTemp: 0,
    targetRevision: "rev123",
    tokenBudget: 1000,
    status: "forging",
    decision: null,
    scope: "anon-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    seal: GENESIS,
    ...partial,
  };
}

const GENESIS = "crucible/v1/genesis";

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

test("clamp01 and round handle boundaries and NaN", () => {
  assert.equal(clamp01(-3), 0);
  assert.equal(clamp01(9), 1);
  assert.equal(clamp01(Number.NaN), 0);
  assert.equal(round(-0), 0);
  assert.equal(Object.is(round(-0.00001, 2), 0), true);
  assert.equal(round(1.23456, 2), 1.23);
});

test("stdev is the population form and is zero for one or zero samples", () => {
  assert.equal(stdev([]), 0);
  assert.equal(stdev([0.5]), 0);
  assert.equal(round(stdev([0, 1]), 6), 0.5);
  assert.equal(round(stdev([0, 1, 2, 3, 4]), 6), round(Math.sqrt(2), 6));
});

test("extractJson finds the first balanced document and ignores braces in strings", () => {
  assert.deepEqual(extractJson('noise {"a":{"b":2}} tail'), { a: { b: 2 } });
  assert.deepEqual(extractJson('{"a":"} not a brace"}'), { a: "} not a brace" });
  assert.equal(extractJson("no json here"), undefined);
  assert.equal(extractJson('{"a": broken}'), undefined);
});

test("getByPath walks objects and array indexes and reports absence as undefined", () => {
  const doc = { a: { b: [{ c: 7 }] } };
  assert.equal(getByPath(doc, "a.b[0].c"), 7);
  assert.equal(getByPath(doc, "a.b.0.c"), 7);
  assert.equal(getByPath(doc, "a.missing.c"), undefined);
  assert.equal(getByPath(doc, "a.b[9].c"), undefined);
});

test("extractNumbers pulls signed and decimal numbers out of prose", () => {
  assert.deepEqual(extractNumbers("the answer is -3.5, not 12"), [-3.5, 12]);
  assert.deepEqual(extractNumbers("none"), []);
});

/* ------------------------------------------------------------------ *
 * Assertion evaluation
 * ------------------------------------------------------------------ */

test("regex assertion passes with the matched span as evidence", () => {
  const a = assertion({ id: "r", kind: "regex", pattern: "total\"?:\\s*(\\d+)" });
  const r = evaluateAssertion(a, '{"total": 412}');
  assert.equal(r.passed, true);
  assert.match(r.evidence, /matched "total": 412"/);
});

test("an invalid regex is a failed assertion, not a thrown error", () => {
  const a = assertion({ id: "r", kind: "regex", pattern: "([unclosed" });
  const r = evaluateAssertion(a, "anything");
  assert.equal(r.passed, false);
  assert.match(r.evidence, /invalid pattern/);
});

test("contains matches across collapsed whitespace and reports the offset", () => {
  const a = assertion({ id: "c", kind: "contains", needle: "retry after" });
  assert.equal(evaluateAssertion(a, "please   retry\n after 30s").passed, true);
  assert.equal(evaluateAssertion(a, "do nothing").passed, false);
});

test("not_contains fails when the forbidden token leaks", () => {
  const a = assertion({ id: "n", kind: "not_contains", needle: "internal_trace_id" });
  assert.equal(evaluateAssertion(a, "clean answer").passed, true);
  assert.equal(evaluateAssertion(a, "id=internal_trace_id").passed, false);
});

test("json_path_equals compares a nested value and explains a mismatch", () => {
  const a = assertion({
    id: "j",
    kind: "json_path_equals",
    path: "meta.status",
    jsonExpected: "ok",
  });
  assert.equal(evaluateAssertion(a, 'x {"meta":{"status":"ok"}} y').passed, true);
  const miss = evaluateAssertion(a, '{"meta":{"status":"degraded"}}');
  assert.equal(miss.passed, false);
  assert.match(miss.evidence, /expected ok/);
});

test("json_path_equals fails cleanly on unparsable output and on an absent path", () => {
  const a = assertion({ id: "j", kind: "json_path_equals", path: "a", jsonExpected: "1" });
  assert.match(evaluateAssertion(a, "no braces").evidence, /no parsable JSON/);
  assert.match(evaluateAssertion(a, '{"b":2}').evidence, /path a absent/);
});

test("number_between accepts any in-range number and rejects an out-of-range set", () => {
  const a = assertion({ id: "b", kind: "number_between", min: 440, max: 460 });
  assert.equal(evaluateAssertion(a, "440").passed, true);
  assert.equal(evaluateAssertion(a, "costs 450 in total").passed, true);
  assert.equal(evaluateAssertion(a, "the answer is 999").passed, false);
  assert.match(evaluateAssertion(a, "the answer is 999").evidence, /no number in/);
});

test("number_between tolerates reversed bounds and rejects a missing range", () => {
  const rev = assertion({ id: "b", kind: "number_between", min: 460, max: 440 });
  assert.equal(evaluateAssertion(rev, "450").passed, true);
  const broken = assertion({ id: "b", kind: "number_between", min: 1 });
  assert.equal(evaluateAssertion(broken, "1").passed, false);
});

test("judge assertions are never decided on this server", () => {
  const a = assertion({ id: "r", kind: "judge_rubric", rubric: "Is the tone appropriate?" });
  const r = evaluateAssertion(a, "any output at all");
  assert.equal(r.passed, null);
  assert.match(r.evidence, /judge rubric/);
});

/* ------------------------------------------------------------------ *
 * Grading a transcript
 * ------------------------------------------------------------------ */

const MIXED_ASSERTIONS: Assertion[] = [
  assertion({ id: "j", kind: "json_path_equals", path: "total", jsonExpected: "460", weight: 2 }),
  assertion({ id: "r", kind: "regex", pattern: "currency", weight: 1 }),
  assertion({ id: "rub", kind: "judge_rubric", weight: 1 }),
];

test("gradeTranscript weights assertions and reports the judge share as determinism", () => {
  const t = task({ assertions: MIXED_ASSERTIONS });
  const g = gradeTranscript(t, transcript({ modelId: "m1", completion: '{"total":460} currency USD' }));
  assert.equal(g.score, 1);
  assert.equal(g.determinism, 0.75);
  assert.equal(g.judgeScore, null);
  const judge = g.outcomes.find((o) => o.assertionId === "rub");
  assert.equal(judge?.passed, null);
  assert.equal(judge?.deterministic, false);
});

test("gradeTranscript scores a partial pass proportionally", () => {
  const t = task({ assertions: MIXED_ASSERTIONS });
  const g = gradeTranscript(t, transcript({ modelId: "m1", completion: '{"total":460}' }));
  // 2 of 3 deterministic weight passed (j=2/2, r=0/1) => 2/3
  assert.equal(round(g.score, 4), round(2 / 3, 4));
});

test("a task with only judge assertions reports determinism zero rather than one", () => {
  const t = task({
    assertions: [assertion({ id: "r", kind: "judge_rubric" })],
  });
  const g = gradeTranscript(t, transcript({ modelId: "m1", completion: "x" }));
  assert.equal(g.determinism, 0);
  assert.equal(g.score, 0);
});

test("a task with no assertions produces an empty, non-NaN grade", () => {
  const t = task({ assertions: [] });
  const g = gradeTranscript(t, transcript({ modelId: "m1", completion: "x" }));
  assert.equal(g.score, 0);
  assert.equal(g.determinism, 0);
  assert.equal(g.outcomes.length, 0);
});

/* ------------------------------------------------------------------ *
 * Statistics
 * ------------------------------------------------------------------ */

test("gradeStats measures mean, spread and determinism across recorded models", () => {
  const t = task({
    assertions: [assertion({ id: "n", kind: "number_between", min: 0, max: 10 })],
    transcripts: [
      transcript({ modelId: "strong", completion: "5", tokensOut: 100 }),
      transcript({ modelId: "mid", completion: "5", tokensOut: 100 }),
      transcript({ modelId: "weak", completion: "99", tokensOut: 100 }),
    ],
  });
  const s = gradeStats(t);
  assert.equal(s.grades.length, 3);
  assert.equal(round(s.meanScore, 4), round(2 / 3, 4));
  assert.equal(s.maxScore, 1);
  assert.equal(s.minScore, 0);
  assert.ok(s.spread > 0);
  assert.equal(s.determinism, 1);
  assert.equal(s.meanTokensOut, 100);
});

test("gradeStats on an empty task is all zeroes and does not divide by zero", () => {
  const s = gradeStats(task());
  assert.equal(s.meanScore, 0);
  assert.equal(s.spread, 0);
  assert.equal(s.determinism, 0);
  assert.equal(s.meanTokensOut, 0);
  assert.equal(s.grades.length, 0);
});

/* ------------------------------------------------------------------ *
 * Engine
 * ------------------------------------------------------------------ */

test("the six published weights sum to exactly one", () => {
  assert.equal(round(WEIGHT_SUM, 10), 1);
  assert.equal(Object.keys(GRADE_WEIGHTS).length, 6);
});

test("a fully pinned, discriminating, deterministic task scores publishable", () => {
  const t = task({
    assertions: [
      assertion({ id: "a", kind: "json_path_equals", path: "total", jsonExpected: "460", weight: 3 }),
      assertion({ id: "b", kind: "regex", pattern: "USD", weight: 1 }),
    ],
    transcripts: [
      transcript({ modelId: "a-strong", completion: '{"total":460} USD', tokensOut: 80 }),
      transcript({ modelId: "b-mid", completion: '{"total":459} USD', tokensOut: 80 }),
      transcript({ modelId: "c-weak", completion: '{"total":44} dollars', tokensOut: 80 }),
    ],
  });
  const { verdict } = gradeTask(t, { computedAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(verdict.engineVersion, "crucible-grade-v1.0.0");
  assert.equal(verdict.factors.length, 6);
  assert.ok(verdict.score >= 80, `expected >= 80, got ${verdict.score}`);
  assert.equal(verdict.band.id, "publishable");
  assert.equal(verdict.degraded, false);
  assert.equal(verdict.degradationNote, null);

  // Contributions must reconstruct the score exactly.
  const sum = verdict.factors.reduce((a, f) => a + f.contribution, 0);
  assert.equal(round(sum * 100, 1), verdict.score);
  assert.ok(verdict.score <= 100);
});

test("a judge-only task is flagged degraded and charged for the judge share", () => {
  const t = task({
    assertions: [assertion({ id: "r", kind: "judge_rubric", weight: 4 })],
    transcripts: [transcript({ modelId: "m", completion: "anything" })],
  });
  const { verdict } = gradeTask(t);
  assert.equal(verdict.degraded, true);
  assert.match(verdict.degradationNote ?? "", /judge/);
  assert.equal(verdict.weakestFactor, "determinism");
  assert.match(verdict.recommendation, /exact assertion/i);
});

test("an unpinned, assertion-less, transcript-less task scores zero", () => {
  const { verdict } = gradeTask(
    task({
      sealedFixtures: [],
      seed: null,
      targetModel: null,
      targetTemp: null,
      targetRevision: null,
      tokenBudget: 0,
    }),
  );
  assert.equal(verdict.score, 0);
  assert.equal(verdict.band.id, "unusable");
  assert.equal(verdict.degraded, true);
  for (const f of verdict.factors) {
    assert.equal(f.value, 0, `${f.id} should be 0 on a bare task`);
  }
});

test("a well-pinned but empty task is honest: not publishable, and the unmeasured factors read zero", () => {
  const { verdict } = gradeTask(task());
  assert.equal(verdict.degraded, true);
  assert.ok(verdict.score < 60, `a task with no assertions must not score publishable, got ${verdict.score}`);
  assert.notEqual(verdict.band.id, "publishable");
  const byId = (id: string) => verdict.factors.find((f) => f.id === id)?.value;
  assert.equal(byId("determinism"), 0);
  assert.equal(byId("discrimination"), 0);
  assert.equal(byId("assertion_specificity"), 0);
  // Nothing was run, so cost cannot be measured rather than being "free".
  assert.equal(byId("cost_fit"), 0);
  assert.match(
    verdict.factors.find((f) => f.id === "cost_fit")?.evidence ?? "",
    /no transcript recorded/,
  );
  // The pins really are all set, and that is reflected rather than hidden.
  assert.equal(byId("fixture_seal"), 1);
  assert.equal(byId("reproduction"), 1);
});

test("identical recorded scores produce zero discrimination", () => {
  const t = task({
    assertions: [assertion({ id: "n", kind: "number_between", min: 0, max: 10 })],
    transcripts: [
      transcript({ modelId: "a", completion: "5" }),
      transcript({ modelId: "b", completion: "5" }),
      transcript({ modelId: "c", completion: "5" }),
    ],
  });
  const { verdict } = gradeTask(t);
  const disc = verdict.factors.find((f) => f.id === "discrimination");
  assert.equal(disc?.value, 0);
  assert.equal(verdict.weakestFactor, "discrimination");
});

test("one recorded transcript reports discrimination as unmeasured, not as zero spread noise", () => {
  const t = task({
    assertions: [assertion({ id: "n", kind: "number_between", min: 0, max: 10 })],
    transcripts: [transcript({ modelId: "only", completion: "5" })],
  });
  const disc = gradeTask(t).verdict.factors.find((f) => f.id === "discrimination");
  assert.match(disc?.evidence ?? "", /cannot be measured/);
});

test("substring-only assertions score lower specificity than exact ones", () => {
  const loose = task({
    assertions: [assertion({ id: "c", kind: "contains", needle: "460" })],
    transcripts: [transcript({ modelId: "a", completion: "460" })],
  });
  const tight = task({
    assertions: [
      assertion({ id: "j", kind: "json_path_equals", path: "total", jsonExpected: "460" }),
    ],
    transcripts: [transcript({ modelId: "a", completion: '{"total":460}' })],
  });
  const looseSpec = gradeTask(loose).verdict.factors.find((f) => f.id === "assertion_specificity");
  const tightSpec = gradeTask(tight).verdict.factors.find((f) => f.id === "assertion_specificity");
  assert.equal(looseSpec?.value, 0.6);
  assert.equal(tightSpec?.value, 1);
});

test("cost fit is full inside the budget and decays above it", () => {
  const base = {
    assertions: [assertion({ id: "n", kind: "number_between", min: 0, max: 10 })],
    seed: 1,
    targetModel: "m",
    targetTemp: 0,
    targetRevision: "r",
  };
  const inside = gradeTask(
    task({ ...base, tokenBudget: 1000, transcripts: [transcript({ modelId: "a", completion: "5", tokensOut: 100 })] }),
  ).verdict.factors.find((f) => f.id === "cost_fit");
  assert.equal(inside?.value, 1);

  const farOver = gradeTask(
    task({ ...base, tokenBudget: 100, transcripts: [transcript({ modelId: "a", completion: "5", tokensOut: 400 })] }),
  ).verdict.factors.find((f) => f.id === "cost_fit");
  assert.equal(farOver?.value, 0);

  const noBudget = gradeTask(
    task({ ...base, tokenBudget: 0, transcripts: [transcript({ modelId: "a", completion: "5", tokensOut: 10 })] }),
  ).verdict.factors.find((f) => f.id === "cost_fit");
  assert.equal(noBudget?.value, 0);
});

test("a gated model from the live Hub lowers reproduction and says why", () => {
  const t = task({
    assertions: [assertion({ id: "n", kind: "number_between", min: 0, max: 10 })],
    transcripts: [transcript({ modelId: "a", completion: "5" })],
  });
  const facts: ModelFacts = {
    modelId: "google/gemini-2.5-flash",
    found: true,
    gated: true,
    license: "gated",
    downloads30d: 10,
    likes: 1,
    revision: "other",
    pipelineTag: "text-generation",
    source: "huggingface",
    fetchedAt: "2026-01-01T00:00:00.000Z",
  };
  const withFacts = gradeTask(t, { modelFacts: facts });
  assert.equal(withFacts.verdict.modelFactsApplied, true);
  const repro = withFacts.verdict.factors.find((f) => f.id === "reproduction");
  assert.match(repro?.evidence ?? "", /gated/);

  const without = gradeTask(t);
  assert.equal(without.verdict.modelFactsApplied, false);
  assert.ok(
    (without.verdict.factors.find((f) => f.id === "reproduction")?.value ?? 0) >
      (repro?.value ?? 0),
    "live gated facts must reduce the reproduction factor",
  );
});

test("every factor carries published weight, evidence and at least one lever", () => {
  const { verdict } = gradeTask(
    task({
      assertions: [assertion({ id: "n", kind: "number_between", min: 0, max: 10 })],
      transcripts: [transcript({ modelId: "a", completion: "5" })],
    }),
  );
  for (const f of verdict.factors) {
    assert.ok(f.weight > 0, `${f.id} weight`);
    assert.ok(f.evidence.length > 0, `${f.id} evidence`);
    assert.ok(f.levers.length > 0, `${f.id} levers`);
    assert.ok(f.value >= 0 && f.value <= 1, `${f.id} value out of range: ${f.value}`);
    assert.ok(!Number.isNaN(f.contribution), `${f.id} contribution NaN`);
  }
});

test("bands tile the 0..100 range without gaps and map monotonically", () => {
  let previousMax = 0;
  GRADE_BANDS.forEach((b, i) => {
    assert.equal(b.min, i === 0 ? 0 : previousMax, `band ${b.id} does not start where the last ended`);
    assert.ok(b.max > b.min, `band ${b.id} is empty`);
    assert.equal(b.max - b.min, 20, `band ${b.id} is not 20 points wide`);
    previousMax = b.max;
  });
  assert.equal(previousMax, 100);
  assert.equal(bandFor(0).id, "unusable");
  assert.equal(bandFor(100).id, "publishable");
  assert.equal(bandFor(-10).id, "unusable");
  assert.equal(bandFor(1e9).id, "publishable");
  // The boundaries themselves must resolve upward, never to a gap.
  assert.equal(bandFor(19.9).id, "unusable");
  assert.equal(bandFor(20).id, "non_discriminating");
  assert.equal(bandFor(80).id, "publishable");
});

test("the engine is byte-stable across repeated runs of the same task", () => {
  const t = task({
    assertions: MIXED_ASSERTIONS,
    transcripts: [
      transcript({ modelId: "a", completion: '{"total":460} USD' }),
      transcript({ modelId: "b", completion: '{"total":1}' }),
    ],
  });
  const opts = { computedAt: "2026-01-01T00:00:00.000Z" };
  assert.equal(
    JSON.stringify(gradeTask(t, opts).verdict),
    JSON.stringify(gradeTask(t, opts).verdict),
  );
});

test("malformed assertion records cannot produce NaN anywhere in the verdict", () => {
  const t = task({
    seed: null,
    targetTemp: null,
    targetRevision: "",
    tokenBudget: Number.NaN,
    sealedFixtures: [],
    assertions: [
      { id: "x", kind: "regex", label: "x", weight: -3, required: false, pattern: "([bad" } as Assertion,
      { id: "y", kind: "number_between", label: "y", weight: 1, required: false } as Assertion,
      { id: "z", kind: "contains", label: "z", weight: 1, required: false } as Assertion,
    ],
    transcripts: [transcript({ modelId: "a", completion: "" })],
  });
  const { verdict } = gradeTask(t, { computedAt: "2026-01-01T00:00:00.000Z" });
  assert.ok(!Number.isNaN(verdict.score));
  for (const f of verdict.factors) {
    assert.ok(!Number.isNaN(f.value), `${f.id} is NaN`);
  }
  const sealFactor = verdict.factors.find((f) => f.id === "fixture_seal");
  assert.equal(sealFactor?.value, 0);
  assert.match(sealFactor?.evidence ?? "", /not pinned: revision, seed, temperature, declared inputs/);
});