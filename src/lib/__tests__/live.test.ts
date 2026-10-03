import test from "node:test";
import assert from "node:assert/strict";

import { detectModels, isValidHubId } from "../live/index.ts";
import { SEALED_HUB, CLOSED_MODEL_NOTES } from "../live/fallback.ts";
import { ALLOWED_HOSTS, isAllowedUrl } from "../live/upstream.ts";

test("hub ids are constrained to owner/name so a model id cannot walk the path", () => {
  assert.equal(isValidHubId("Qwen/Qwen2.5-72B-Instruct"), true);
  assert.equal(isValidHubId("meta-llama/Llama-3.1-70B-Instruct"), true);

  assert.equal(isValidHubId("../../etc/passwd"), false);
  assert.equal(isValidHubId("Qwen"), false, "a bare name is not a repo id");
  assert.equal(isValidHubId("a/b/c"), false);
  assert.equal(isValidHubId("Qwen/"), false);
  assert.equal(isValidHubId("/Qwen"), false);
  assert.equal(isValidHubId("Qwen/Qwen?x=1"), false);
  assert.equal(isValidHubId(""), false);
  assert.equal(isValidHubId("a".repeat(200) + "/b"), false);
});

test("model detection uses a fixed vocabulary and never invents a name", () => {
  assert.deepEqual(detectModels("we compare GPT-4 and Claude against Gemini"), [
    "claude",
    "gemini",
    "gpt-4",
  ]);
  assert.deepEqual(detectModels("Llama 3.1 70B versus Qwen2.5"), ["llama", "qwen"]);
  // Nothing recognisable means nothing reported, rather than a guess.
  assert.deepEqual(detectModels("a study of retrieval augmented generation"), []);
  assert.deepEqual(detectModels(""), []);
  assert.deepEqual(detectModels("DeepSeek and Mistral and Grok"), [
    "deepseek",
    "grok",
    "mistral",
  ]);
});

test("model detection is idempotent and deduplicates", () => {
  const text = "gemini gemini GEMINI Gemini";
  assert.deepEqual(detectModels(text), ["gemini"]);
});

test("upstream URLs are restricted to the allowlisted hosts", () => {
  for (const host of ALLOWED_HOSTS) {
    assert.equal(isAllowedUrl(`https://${host}/anything`), true);
  }
  assert.equal(isAllowedUrl("https://evil.example.com/steal"), false);
  assert.equal(isAllowedUrl("http://169.254.169.254/latest/meta-data"), false);
  assert.equal(isAllowedUrl("file:///etc/passwd"), false);
  assert.equal(isAllowedUrl("not a url"), false);
});

test("the sealed snapshot is real recorded data, not a placeholder", () => {
  assert.ok(SEALED_HUB.length >= 4);
  for (const facts of SEALED_HUB) {
    assert.match(facts.modelId, /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/);
    assert.ok(facts.revision && /^[0-9a-f]{40}$/.test(facts.revision), `${facts.modelId} needs a 40-hex revision`);
    assert.equal(typeof facts.downloads, "number");
    assert.equal(typeof facts.likes, "number");
  }
  // Llama is recorded as gated, which is the fact the engine charges for.
  const llama = SEALED_HUB.find((f) => f.modelId.includes("Llama"));
  assert.equal(llama?.gated, true);
});

test("closed models carry a stated reason rather than a silent absence", () => {
  for (const [modelId, note] of Object.entries(CLOSED_MODEL_NOTES)) {
    assert.match(modelId, /\//);
    assert.match(note, /no public revision to pin/i);
  }
});