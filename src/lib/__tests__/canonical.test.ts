import test from "node:test";
import assert from "node:assert/strict";

import {
  GENESIS_SEAL,
  canonicalJson,
  seal,
  verifyChain,
  type ChainLink,
} from "../canonical.ts";

/**
 * Known vectors.
 *
 * These digests were produced by running this module and are pinned
 * deliberately. If canonical JSON ever changes shape these fail and force a
 * conscious version decision, rather than a silent rewrite that silently
 * invalidates every seal already written.
 *
 * V1 canonical payload: {"action":"create","seq":1,"taskId":"t-1"}
 * V2 canonical payload: {"a":1,"b":2}  (passed in as {b:2,a:1} to prove that
 *    input key order cannot change the digest)
 */
const V1 =
  "2257382d9a20b9e353930993c2167648cd8c128af5f934c323b36cdbf8d304d383d8e58bd9f840fe720026be0bcb2d03";
const V2 =
  "68f762efb7344387770454b44a472390a84ddc70b69d1ae5f2159544ef94440cd895b82b0bffcd386febfdeaa2b3a2ec";

test("canonicalJson is stable under key reordering", () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
  assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
});

test("canonicalJson sorts keys recursively", () => {
  const value = { z: { y: 1, x: 2 }, a: [{ q: 1, p: 2 }] };
  assert.equal(canonicalJson(value), '{"a":[{"p":2,"q":1}],"z":{"x":2,"y":1}}');
});

test("seal matches known vector V1", async () => {
  const got = await seal(GENESIS_SEAL, { taskId: "t-1", seq: 1, action: "create" });
  assert.equal(got, V1);
});

test("seal matches known vector V2 and ignores input key order", async () => {
  const got = await seal(GENESIS_SEAL, { b: 2, a: 1 });
  assert.equal(got, V2);
});

test("seal repeats byte-identically for the same input", async () => {
  const a = await seal(GENESIS_SEAL, { x: 1, y: [1, 2, 3] });
  const b = await seal(GENESIS_SEAL, { y: [1, 2, 3], x: 1 });
  assert.equal(a, b);
});

test("canonicalJson drops undefined members but keeps array length", () => {
  assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}');
  assert.equal(canonicalJson([1, undefined, 3]), "[1,null,3]");
});

test("canonicalJson normalises negative zero and serialises Date as ISO", () => {
  assert.equal(canonicalJson({ v: -0 }), '{"v":0}');
  const d = new Date("2026-01-02T03:04:05.000Z");
  assert.equal(canonicalJson({ d }), '{"d":"2026-01-02T03:04:05.000Z"}');
});

test("canonicalJson rejects non-finite numbers instead of silently nulling them", () => {
  assert.throws(() => canonicalJson({ v: Number.NaN }), TypeError);
  assert.throws(() => canonicalJson({ v: Number.POSITIVE_INFINITY }), TypeError);
});

test("canonicalJson honours the omit list at any depth", () => {
  const value = { keep: 1, drop: 2, nested: { keep: 3, drop: 4 } };
  assert.equal(
    canonicalJson(value, { omit: ["drop"] }),
    '{"keep":1,"nested":{"keep":3}}',
  );
});

test("seal actually chains: a different prevSeal yields a different digest", async () => {
  const a = await seal(GENESIS_SEAL, { action: "update" });
  const b = await seal("some-other-prev", { action: "update" });
  assert.notEqual(a, b);
});

test("verifyChain accepts a well-formed chain", async () => {
  const links: ChainLink[] = [];
  let prev = GENESIS_SEAL;
  for (let i = 1; i <= 3; i += 1) {
    const event = { seq: i, action: "update", taskId: "t-1", score: i / 10 };
    const s = await seal(prev, event);
    links.push({ prevSeal: prev, event: { ...event, seal: s } });
    prev = s;
  }
  const res = await verifyChain(links);
  assert.equal(res.ok, true);
  assert.equal(res.brokenAtIndex, null);
});

test("verifyChain names the first link whose payload was edited", async () => {
  const links: ChainLink[] = [];
  let prev = GENESIS_SEAL;
  for (let i = 1; i <= 3; i += 1) {
    const event = { seq: i, action: "update", taskId: "t-1", score: i / 10 };
    const s = await seal(prev, event);
    links.push({ prevSeal: prev, event: { ...event, seal: s } });
    prev = s;
  }
  // Rewrite history at link 2 without recomputing any seal.
  const tampered = links.map((l, i) =>
    i === 1 ? { prevSeal: l.prevSeal, event: { ...(l.event as object), score: 0.99 } } : l,
  );
  const res = await verifyChain(tampered);
  assert.equal(res.ok, false);
  assert.equal(res.brokenAtIndex, 1);
  assert.match(res.reason ?? "", /does not match recomputed/);
});

test("verifyChain detects a spliced prevSeal even when payloads are intact", async () => {
  const links: ChainLink[] = [];
  let prev = GENESIS_SEAL;
  for (let i = 1; i <= 2; i += 1) {
    const event = { seq: i, action: "create", taskId: "t-1" };
    const s = await seal(prev, event);
    links.push({ prevSeal: prev, event: { ...event, seal: s } });
    prev = s;
  }
  const spliced = [links[0], { prevSeal: GENESIS_SEAL, event: links[1].event }];
  const res = await verifyChain(spliced);
  assert.equal(res.ok, false);
  assert.equal(res.brokenAtIndex, 1);
  assert.match(res.reason ?? "", /declares prevSeal/);
});

test("verifyChain rejects an event carrying no seal field", async () => {
  const res = await verifyChain([{ prevSeal: GENESIS_SEAL, event: { seq: 1 } }]);
  assert.equal(res.ok, false);
  assert.match(res.reason ?? "", /no seal field/);
});

test("an empty chain verifies as intact", async () => {
  const res = await verifyChain([]);
  assert.equal(res.ok, true);
  assert.equal(res.brokenAtIndex, null);
});