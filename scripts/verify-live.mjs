/**
 * Live end-to-end proof.
 *
 *   BASE_URL=https://your-alias.vercel.app node scripts/verify-live.mjs
 *
 * Reads the base URL from the environment and embeds no secrets. Every check is
 * a real HTTP request against a real deployment. Nothing is stubbed and nothing
 * is assumed: the store round trip, the live feed status, the persistence
 * read-back, the MCP mutation path and the chain replay are all exercised.
 *
 * Exit code is non-zero if any check fails, so this can gate a deploy.
 */

const BASE = (process.env.BASE_URL ?? "").replace(/\/$/, "");
const REPO_URL = "https://github.com/aniruddhaadak80/crucible";
const REPO_API = "https://api.github.com/repos/aniruddhaadak80/crucible";

if (!BASE) {
  console.error("BASE_URL is required, for example:");
  console.error("  BASE_URL=https://your-alias.vercel.app node scripts/verify-live.mjs");
  process.exit(2);
}

let checks = 0;
let failures = 0;
const notes = [];

function ok(label, condition, extra = "") {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${extra ? ` :: ${extra}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/* ------------------------------ cookie jar ------------------------------ */

const jar = new Map();

function storeCookies(response) {
  for (const line of response.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}

async function get(path) {
  const headers = {};
  if (jar.size > 0) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const res = await fetch(`${BASE}${path}`, { headers, redirect: "manual" });
  storeCookies(res);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* html */
  }
  return { status: res.status, text, json };
}

async function send(path, method, body) {
  const headers = { "content-type": "application/json" };
  if (jar.size > 0) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: JSON.stringify(body ?? {}),
    redirect: "manual",
  });
  storeCookies(res);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, text, json };
}

async function rpc(method, params) {
  const res = await send("/api/mcp", "POST", { jsonrpc: "2.0", id: 1, method, params });
  return res.json;
}

async function main() {
  console.log(`\nVerifying ${BASE}`);

  let taskId = null;

  /* 1 ---------------------------------------------------------------- */
  section("1. landing");
  const home = await get("/");
  ok("GET / is 200", home.status === 200, `got ${home.status}`);
  ok("landing is not a placeholder", home.text.length > 2000, `${home.text.length} bytes`);

  /* 2 ---------------------------------------------------------------- */
  section("2. health and the real production store");
  const health = await get("/api/health");
  ok("GET /api/health is 200", health.status === 200, `got ${health.status}`);
  ok("health reports status ok", health.json?.status === "ok", JSON.stringify(health.json?.status));
  const kind = health.json?.store?.kind ?? "";
  ok("health names the store adapter", typeof kind === "string" && kind.length > 0, kind);
  ok(
    "the store is a hosted adapter in production",
    kind === "neon-postgres",
    `expected neon-postgres, got ${kind}`,
  );
  ok("the store is durable", health.json?.store?.durable === true);
  ok(
    "health performed a real round trip",
    typeof health.json?.store?.roundTrip === "string" && health.json.store.roundTrip.includes("SELECT"),
    health.json?.store?.roundTrip,
  );

  /* 3 ---------------------------------------------------------------- */
  section("3. live data");
  const feed = await get("/api/feed");
  ok("GET /api/feed is 200", feed.status === 200);
  ok("the feed returns items", (feed.json?.hub?.items?.length ?? 0) > 0);
  ok(
    "the feed declares live or fallback",
    ["live", "fallback"].includes(feed.json?.hub?.status),
    feed.json?.hub?.status,
  );
  ok("the feed carries attribution", typeof feed.json?.hub?.attribution === "string");
  ok("the feed carries a fetch time", typeof feed.json?.hub?.fetchedAt === "string");
  if (feed.json?.hub?.status === "fallback") {
    notes.push(`Hub was fallback: ${feed.json.hub.degradedReason}`);
  }
  ok("the reference suite is seeded", (health.json?.seed?.applied === true) === true);

  /* 4 ---------------------------------------------------------------- */
  section("4. create through the public API");
  const stamp = Date.now();
  const created = await send("/api/tasks", "POST", {
    name: `Live verification ${stamp}`,
    failureMode:
      "A throwaway record created by verify-live.mjs to prove the production store is writable and that every later step reflects real persisted state.",
    prompt: "Return ONLY a JSON object with a total field and nothing else.",
    sealedFixtures: ["fixture.json=sha256:0123456789abcdef"],
    assertions: [
      { id: "total", kind: "json_path_equals", label: "total is 460", weight: 2, path: "total", jsonExpected: "460" },
      { id: "clean", kind: "not_contains", label: "no micrograms", weight: 1, needle: "µg" },
    ],
    transcripts: [
      { modelId: "Qwen/Qwen2.5-72B-Instruct", completion: '{"total":460}', latencyMs: 1840, tokensIn: 240, tokensOut: 96 },
      { modelId: "google/gemini-2.5-flash", completion: '{"total":460000,"unit":"µg"}', latencyMs: 2100, tokensIn: 240, tokensOut: 101 },
    ],
    seed: 20260923,
    targetModel: "Qwen/Qwen2.5-72B-Instruct",
    targetTemp: 0,
    targetRevision: "495f39366efef23836d0cfae4fbe635880d2be31",
    tokenBudget: 400,
  });
  ok("POST /api/tasks is 201", created.status === 201, `got ${created.status}: ${created.text.slice(0, 200)}`);
  taskId = created.json?.task?.id ?? null;
  ok("the create returned an id", typeof taskId === "string" && taskId.length > 8);
  ok("the create returned a seal", typeof created.json?.task?.seal === "string");

  /* 5 ---------------------------------------------------------------- */
  section("5. read back through the UI-facing API");
  const read = await get(`/api/tasks/${taskId}`);
  ok("GET the task is 200", read.status === 200, `got ${read.status}`);
  ok("the prompt persisted", String(read.json?.task?.prompt ?? "").startsWith("Return ONLY"));
  ok("both assertions persisted", read.json?.task?.assertions?.length === 2);
  ok("both transcripts persisted", read.json?.task?.transcripts?.length === 2);
  ok("the sealed fixture persisted", read.json?.task?.sealedFixtures?.length === 1);
  ok(
    "the grader produced per-assertion evidence",
    (read.json?.grade?.grades?.[0]?.outcomes ?? []).every((o) => typeof o.evidence === "string"),
  );

  /* 6 ---------------------------------------------------------------- */
  section("6. update and confirm the change stuck");
  const patched = await send(`/api/tasks/${taskId}`, "PATCH", {
    name: `Live verification ${stamp} (revised)`,
    tokenBudget: 250,
  });
  ok("PATCH is 200", patched.status === 200, `got ${patched.status}`);
  const reread = await get(`/api/tasks/${taskId}`);
  ok("the revision is visible on read-back", reread.json?.task?.name?.includes("(revised)"));
  ok("the token budget change persisted", reread.json?.task?.tokenBudget === 250);

  /* 7 ---------------------------------------------------------------- */
  section("7. the engine");
  const grade = await send(`/api/tasks/${taskId}/grade`, "POST");
  ok("POST grade is 200", grade.status === 200, `got ${grade.status}`);
  const verdict = grade.json?.verdict;
  ok("the engine reports its version", verdict?.engineVersion === "crucible-grade-v1.0.0", verdict?.engineVersion);
  ok("the engine returns a score", typeof verdict?.score === "number" && verdict.score >= 0 && verdict.score <= 100, `${verdict?.score}`);
  ok("the engine returns six itemised factors", verdict?.factors?.length === 6);
  ok(
    "every factor carries published weight and evidence",
    verdict?.factors?.every((f) => typeof f.weight === "number" && typeof f.evidence === "string" && f.evidence.length > 0),
  );
  const weightSum = (verdict?.factors ?? []).reduce((a, f) => a + f.weight, 0);
  ok("the factor weights sum to 1", Math.abs(weightSum - 1) < 1e-9, `${weightSum}`);
  ok("the engine returns a recommendation", typeof verdict?.recommendation === "string");
  ok("the engine returns a band", typeof verdict?.band?.id === "string");
  ok("the engine returns a seal reference", typeof grade.json?.seal === "string" && grade.json.seal.length === 96);

  /* 8 ---------------------------------------------------------------- */
  section("8. MCP agent interface");
  const init = await rpc("initialize", {});
  ok("initialize succeeds", init?.result?.protocolVersion, JSON.stringify(init?.error ?? {}));
  ok("initialize advertises tools", init?.result?.capabilities?.tools !== undefined);

  const tools = await rpc("tools/list", {});
  const names = (tools?.result?.tools ?? []).map((t) => t.name);
  ok("tools/list returns tools", names.length >= 3, `${names.length}`);
  for (const expected of ["list_tasks", "get_task", "grade_task", "verify_integrity", "forge_task"]) {
    ok(`tools/list includes ${expected}`, names.includes(expected));
  }
  ok("every tool declares an input schema", (tools?.result?.tools ?? []).every((t) => t.inputSchema?.type === "object"));
  ok(
    "tools are annotated read/write",
    (tools?.result?.tools ?? []).every((t) => typeof t.annotations?.readOnlyHint === "boolean"),
  );

  const badTool = await rpc("tools/call", { name: "nope", arguments: {} });
  ok("an unknown tool returns -32601", badTool?.error?.code === -32601);

  /* 9 ---------------------------------------------------------------- */
  section("9. the agent mutates through the same path as the UI");
  const key = `verify-live-${stamp}`;
  const agentArgs = {
    name: `Agent verification ${stamp}`,
    failureMode:
      "A throwaway record created through the JSON-RPC agent tool to prove the agent and the UI share one service layer.",
    prompt: "Reply with ONLY the number 7.",
    assertions: [{ id: "n", kind: "number_between", label: "is seven", weight: 1, min: 7, max: 7 }],
    idempotencyKey: key,
  };
  const forged = await rpc("tools/call", { name: "forge_task", arguments: agentArgs });
  const agentId = forged?.result?.structuredContent?.task?.id;
  ok("the agent can forge a task", typeof agentId === "string", JSON.stringify(forged?.error ?? {}));
  ok("the agent result carries the engine verdict", forged?.result?.structuredContent?.verdict?.engineVersion);

  const replay = await rpc("tools/call", { name: "forge_task", arguments: agentArgs });
  ok(
    "the same idempotency key returns the original task",
    replay?.result?.structuredContent?.task?.id === agentId,
  );
  ok("the replay is flagged", replay?.result?.structuredContent?.idempotentReplay === true);

  const agentRead = await get(`/api/tasks/${agentId}`);
  ok("the agent-created task reads back over REST", agentRead.status === 200, `got ${agentRead.status}`);
  ok("the agent task has a persisted seal", typeof agentRead.json?.task?.seal === "string");

  /* 10 --------------------------------------------------------------- */
  section("10. integrity replay");
  const integrity = await get(`/api/tasks/${taskId}/integrity`);
  ok("integrity is 200", integrity.status === 200, `got ${integrity.status}`);
  ok("the chain replays clean", integrity.json?.integrity?.ok === true, integrity.json?.integrity?.brokenReason ?? "");
  // create, patch, grade => three links before any deletion.
  ok(
    "links were actually checked",
    (integrity.json?.integrity?.checked ?? 0) >= 3,
    `${integrity.json?.integrity?.checked}`,
  );
  ok("a genesis value is reported", typeof integrity.json?.integrity?.genesis === "string");
  ok("a chain head is reported", typeof integrity.json?.integrity?.head === "string");

  const audit = await get(`/api/tasks/${taskId}/audit`);
  ok("the audit trail is readable", audit.status === 200);
  ok("the audit trail is ordered", (audit.json?.events ?? []).every((e, i) => i === 0 || e.seq > audit.json.events[i - 1].seq));
  ok(
    "every mutation left an event",
    ["create", "update", "grade"].every((action) => (audit.json?.events ?? []).some((e) => e.action === action)),
    (audit.json?.events ?? []).map((e) => e.action).join(","),
  );

  /* 11 --------------------------------------------------------------- */
  section("11. exports and the agent manifest");
  for (const [label, format] of [["markdown", "markdown"], ["json", "json"], ["csv", "csv"]]) {
    const res = await get(`/api/tasks/${taskId}/dossier?format=${format}`);
    ok(`the ${label} dossier downloads`, res.status === 200, `got ${res.status}`);
    ok(`the ${label} dossier is non-trivial`, res.text.length > 200, `${res.text.length} bytes`);
  }
  const md = await get(`/api/tasks/${taskId}/dossier?format=markdown`);
  ok("the dossier names the task", md.text.includes("Live verification"));
  ok("the dossier carries the factor table", md.text.includes("Factor"));
  ok("the dossier carries the chain head", md.text.includes("Chain head"));
  ok("the dossier states the caveat", md.text.toLowerCase().includes("not about a model"));

  const bundle = await get(`/api/tasks/${taskId}/bundle`);
  ok("the Kaggle bundle generates", bundle.status === 200 && bundle.json?.files?.length >= 4);
  ok("the bundle includes a task file", bundle.json?.files?.some((f) => f.path.endsWith(".py") && f.path !== "crucible_grader.py" && f.path !== "selfcheck.py"));
  ok("the bundle includes the Python grader", bundle.json?.files?.some((f) => f.path === "crucible_grader.py"));
  const traversal = await get(`/api/tasks/${taskId}/bundle?file=../../package.json`);
  ok("bundle file traversal is refused", traversal.status === 404, `got ${traversal.status}`);

  const manifest = await get("/mcp.json");
  ok("the manifest is served", manifest.status === 200);
  ok("the manifest lists the tools", (manifest.json?.tools ?? []).length >= 3);
  const endpoint = manifest.json?.servers?.crucible?.url ?? "";
  ok("the manifest points at this host", endpoint.includes(new URL(BASE).host), endpoint);

  /* 12 --------------------------------------------------------------- */
  section("12. shared chrome, routes and the repository");
  const routes = ["/", "/suite", "/forge", "/lineup", "/agent", "/dossier", "/chain", "/settings", `/task/${taskId}`];
  for (const route of routes) {
    const res = await get(route);
    ok(`${route} is 200`, res.status === 200, `got ${res.status}`);
  }

  // Navigation and footer must carry the real repository URL on every page.
  for (const route of ["/", "/suite", "/lineup", "/chain", "/settings", "/dossier", "/agent", "/forge"]) {
    const res = await get(route);
    ok(`${route} links the repository`, res.text.includes(REPO_URL));
  }

  try {
    const repoRes = await fetch(REPO_URL, {
      headers: { "user-agent": "crucible-verify" },
      redirect: "follow",
    });
    ok("the repository URL returns 200", repoRes.status === 200, `got ${repoRes.status}`);
    ok("the repository is public", repoRes.status === 200);
  } catch (error) {
    ok("the repository URL returns 200", false, error.message);
  }

  try {
    const api = await fetch(REPO_API, {
      headers: { "user-agent": "crucible-verify", accept: "application/vnd.github+json" },
    });
    if (api.ok) {
      const meta = await api.json();
      ok("the repository is public and not a fork-only placeholder", meta.private === false);
      ok("the repository has the homepage set", typeof meta.homepage === "string" && meta.homepage.length > 0, meta.homepage);
      ok("the declared homepage is this deployment", String(meta.homepage).includes(new URL(BASE).host), meta.homepage);
    } else {
      notes.push(`GitHub API returned ${api.status}; skipped homepage assertions`);
    }
  } catch (error) {
    notes.push(`GitHub API unreachable: ${error.message}`);
  }

  /* cleanup ---------------------------------------------------------- */
  section("cleanup");
  const removed = await send(`/api/tasks/${taskId}`, "DELETE");
  ok("DELETE is 200", removed.status === 200, `got ${removed.status}`);
  ok("the delete reports a tombstone", removed.json?.retired === true);
  ok("the chain still replays after deletion", removed.json?.integrity?.ok === true, removed.json?.integrity?.brokenReason ?? "");
  const tombstone = await get(`/api/tasks/${taskId}`);
  ok("the tombstone is retained", tombstone.json?.task?.deletedAt !== null);

  const afterDelete = await send(`/api/tasks/${agentId}`, "DELETE");
  ok("the agent-created task is also cleaned up", afterDelete.status === 200, `got ${afterDelete.status}`);

  const live = await get("/api/tasks");
  ok(
    "the live listing no longer contains the deleted tasks",
    !(live.json?.tasks ?? []).some((t) => t.id === taskId || t.id === agentId),
  );

  /* ------------------------------------------------------------------ */
  console.log("\nnote");
  if (notes.length === 0) console.log("  none");
  for (const n of notes) console.log(`  - ${n}`);

  console.log(`\n${checks - failures}/${checks} checks passed against ${BASE}`);
  if (failures > 0) {
    console.log(`\n${failures} FAILED`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("\nverification crashed:", error);
  process.exitCode = 1;
});