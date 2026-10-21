import test from "node:test";
import assert from "node:assert/strict";

import { parseTaskInput, parseDecision, VALIDATION_LIMITS } from "../validate.ts";
import { ValidationError } from "../db/repository.ts";

/**
 * The validator is the boundary between "what the caller asked for" and
 * "what reaches the database". A field that is silently dropped on the way
 * through is a field the caller was told was updated but never was.
 */
test("an explicit empty assertions array is applied, not dropped", () => {
  const patch = parseTaskInput({ assertions: [] }, "update");
  assert.deepEqual(patch.assertions, []);
  assert.equal("assertions" in patch, true);
});

test("every list field treats an empty array as an instruction", () => {
  // The three list fields must behave the same way: an empty array means
  // "clear this", not "leave it alone".
  const patch = parseTaskInput(
    { assertions: [], transcripts: [], sealedFixtures: [] },
    "update",
  );
  assert.deepEqual(patch.assertions, []);
  assert.deepEqual(patch.transcripts, []);
  assert.deepEqual(patch.sealedFixtures, []);
});

test("an omitted field stays omitted", () => {
  const patch = parseTaskInput({ name: "A renamed task" }, "update");
  assert.equal("assertions" in patch, false);
  assert.equal("transcripts" in patch, false);
  assert.equal("sealedFixtures" in patch, false);
});

test("a populated assertions array is parsed and kept", () => {
  const patch = parseTaskInput(
    {
      assertions: [
        { id: "a1", kind: "regex", label: "opens with a bracket", weight: 1, pattern: "^\\s*\\[" },
      ],
    },
    "update",
  );
  assert.equal(patch.assertions?.length, 1);
  assert.equal(patch.assertions?.[0].kind, "regex");
  assert.equal(patch.assertions?.[0].pattern, "^\\s*\\[");
});

test("an invalid assertion is reported and the whole patch is rejected", () => {
  assert.throws(
    () => parseTaskInput({ assertions: [{ kind: "regex" }] }, "update"),
    (error: unknown) => error instanceof ValidationError,
  );
});

test("a non-array assertions field is rejected", () => {
  assert.throws(
    () => parseTaskInput({ assertions: "nope" }, "update"),
    (error: unknown) => error instanceof ValidationError,
  );
});

test("too many assertions is rejected", () => {
  const many = Array.from({ length: VALIDATION_LIMITS.assertions + 1 }, () => ({
    kind: "contains",
    needle: "x",
  }));
  assert.throws(
    () => parseTaskInput({ assertions: many }, "update"),
    (error: unknown) => error instanceof ValidationError,
  );
});

test("create still requires the three mandatory fields", () => {
  assert.throws(
    () => parseTaskInput({ assertions: [] }, "create"),
    (error: unknown) => error instanceof ValidationError,
  );
});

test("a decision needs a known verdict and a note", () => {
  assert.deepEqual(parseDecision({ verdict: "adopt", note: "ship it" }), {
    verdict: "adopt",
    note: "ship it",
  });
  assert.throws(
    () => parseDecision({ verdict: "maybe", note: "ship it" }),
    (error: unknown) => error instanceof ValidationError,
  );
  assert.throws(
    () => parseDecision({ verdict: "adopt", note: "" }),
    (error: unknown) => error instanceof ValidationError,
  );
});
