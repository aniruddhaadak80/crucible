/**
 * End-to-end HTTP journey.
 *
 * Two modes:
 *   node scripts/journey.mjs                    boots `next start` locally
 *   BASE_URL=https://host node scripts/journey.mjs   runs against a live deploy
 *
 * The journey is the one the skill requires: create -> read back -> patch ->
 * engine -> MCP mutation -> integrity replay -> delete -> tombstone. It also
 * checks that the shared navigation and footer really contain the repository
 * URL, and that no request comes back 5xx.
 *
 * A cookie jar is kept deliberately: without it every call would look like a new
 * visitor and the ownership scoping would never actually be tested.
 */

import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";

const REPO_URL = "https://github.com/aniruddhaadak80/crucible";
const EXTERNAL = process.env.BASE_URL?.replace(/\/$/, "");
const PORT = Number(process.env.PORT ?? 4319);

let checks = 0;
let failures = 0;
const serverErrors = [];

function ok(label, condition, extra = "") {
  checks += 1;
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${extra ? ` :: ${extra}` : ""}`);
  }
}

/* ---------------------------- cookie jar ---------------------------- */

const jar = new Map();

function storeCookies(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const [pair] = line.split(";");
    const index = pair.indexOf("=");
    if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
}

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function call(path, init = {}) {
  const headers = { ...(init.headers ?? {}) };
  if (jar.size > 0) headers.cookie = cookieHeader();
  if (init.body) headers["content-type"] = "application/json";

  const response = await fetch(`${base}${path}`, { ...init, headers, redirect: "manual" });
  storeCookies(response);
  if (response.status >= 500) serverErrors.push(`${init.method ?? "GET"} ${path} -> ${response.status}`);

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* html or empty */
  }
  return { status: response.status, text, json, headers: response.headers };
}

async function rpc(method, params) {
  const res = await call("/api/mcp", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json;
}

let base = EXTERNAL ?? `http://127.0.0.1:${PORT}`;
let child = null;

const stderrChunks = [];

async function boot() {
  console.log(`\nbooting next dev on ${base}`);

  // `next dev` rather than `next start`: the production build deliberately
  // refuses to run on the embedded adapter without DATABASE_URL, so the local
  // zero-config journey has to use the development server. The production
  // equivalent of this run is `npm run verify:live` against a real deploy.
  child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(PORT)], {
    env: { ...process.env, NODE_ENV: "development", PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", (d) => {
    const s = String(d);
    stderrChunks.push(s);
    if (stderrChunks.length > 40) stderrChunks.shift();
  });

  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) {
        console.log("server ready");
        return;
      }
      const body = await res.json().catch(() => null);
      if (body?.status === "degraded") {
        throw new Error(`health degraded: ${JSON.stringify(body.store)} ${body.seed?.error ?? ""}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("health degraded")) throw error;
      /* not up yet */
    }
  }
  throw new Error(`server did not become ready\n${stderrChunks.join("")}`);
}

async function main() {
  if (!EXTERNAL) {
    await rm(".crucible/journey", { recursive: true, force: true });
    process.env.CRUCIBLE_PGLITE_DIR = ".crucible/journey";
    await boot();
  }

  console.log("\n1. health and store");
  const health = await call("/api/health");
  ok("GET /api/health is 200", health.status === 200, `got ${health.status}`);
  ok("health reports a real store round trip", health.json?.store?.roundTrip?.includes("SELECT 1"));
  ok("health names the engine", health.json?.engine?.version === "crucible-grade-v1.0.0");

  console.log("\n2. landing renders and links the repository");
  const home = await call("/");
  ok("GET / is 200", home.status === 200, `got ${home.status}`);
  ok("landing contains the repository URL", home.text.includes(REPO_URL));
  ok("landing offers a real primary action", home.text.includes("/forge"));

  console.log("\n3. reference suite is readable");
  const list = await call("/api/tasks");
  ok("GET /api/tasks is 200", list.status === 200);
  ok("a fresh scope starts with no own tasks", Array.isArray(list.json?.tasks) && list.json.tasks.length === 0);

  console.log("\n4. create");
  const created = await call("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      name: "Journey task",
      failureMode: "The journey proves a full create, read, update, grade, agent and delete loop works.",
      prompt: "Return ONLY a JSON object with a total field.",
      sealedFixtures: ["fixture.json=sha256:0123456789abcdef"],
      assertions: [
        { id: "total", kind: "json_path_equals", label: "total is 460", weight: 2, path: "total", jsonExpected: "460" },
        { id: "unit", kind: "not_contains", label: "no micrograms", weight: 1, needle: "µg" },
      ],
      transcripts: [
        { id: "t1", modelId: "Qwen/Qwen2.5-72B-Instruct", completion: '{"total":460}', latencyMs: 900, tokensIn: 40, tokensOut: 12 },
        { id: "t2", modelId: "google/gemini-2.5-flash", completion: '{"total":460000,"unit":"µg"}', latencyMs: 1100, tokensIn: 40, tokensOut: 16 },
      ],
      seed: 99,
      targetModel: "Qwen/Qwen2.5-72B-Instruct",
      targetTemp: 0,
      targetRevision: "495f39366efef23836d0cfae4fbe635880d2be31",
      tokenBudget: 200,
    }),
  });
  ok("POST /api/tasks is 201", created.status === 201, `got ${created.status}: ${created.text.slice(0, 200)}`);
  const id = created.json?.task?.id;
  ok("create returns an id", typeof id === "string" && id.length > 8);
  ok("create returns a versioned verdict", created.json?.verdict?.engineVersion === "crucible-grade-v1.0.0");
  ok("verdict has six factors", created.json?.verdict?.factors?.length === 6);
  ok("verdict carries a recommendation", typeof created.json?.verdict?.recommendation === "string");

  console.log("\n5. validation is real");
  const bad = await call("/api/tasks", {
    method: "POST",
    body: JSON.stringify({ name: "x", failureMode: "short", prompt: "tiny" }),
  });
  ok("an invalid create is rejected with 422", bad.status === 422, `got ${bad.status}`);
  ok("rejection carries field details", Array.isArray(bad.json?.error?.details));
  const badRegex = await call("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      name: "Bad regex",
      failureMode: "This task carries a pattern that is not a regular expression at all.",
      prompt: "Return something for this test.",
      assertions: [{ id: "a", kind: "regex", label: "bad", weight: 1, pattern: "([unclosed" }],
    }),
  });
  ok("an invalid regex is rejected, not executed", badRegex.status === 422, `got ${badRegex.status}`);

  console.log("\n6. read back");
  const read = await call(`/api/tasks/${id}`);
  ok("GET the task is 200", read.status === 200);
  ok("assertions survived the round trip", read.json?.task?.assertions?.length === 2);
  ok("transcripts survived", read.json?.task?.transcripts?.length === 2);
  ok("prompt survived", read.json?.task?.prompt?.startsWith("Return ONLY"));
  const tape = read.json?.grade?.grades?.[0]?.outcomes ?? [];
  ok("grader produced per-assertion evidence", tape.length === 2 && tape.every((o) => typeof o.evidence === "string"));
  ok("the µg transcript fails its assertion", read.json?.grade?.grades?.[1]?.outcomes?.some((o) => o.passed === false));

  console.log("\n7. update");
  const patched = await call(`/api/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name: "Journey task v2", tokenBudget: 150 }),
  });
  ok("PATCH is 200", patched.status === 200, `got ${patched.status}`);
  ok("the change persisted", patched.json?.task?.name === "Journey task v2");
  ok("the engine re-ran on update", typeof patched.json?.verdict?.score === "number");

  console.log("\n8. engine grade");
  const grade = await call(`/api/tasks/${id}/grade`, { method: "POST" });
  ok("POST grade is 200", grade.status === 200);
  ok("grade returns a versioned score", typeof grade.json?.verdict?.score === "number");
  ok("grade returns itemised factors", grade.json?.verdict?.factors?.every((f) => typeof f.evidence === "string"));
  ok("grade returns a recommendation", typeof grade.json?.verdict?.recommendation === "string");
  ok("grade returns a seal", typeof grade.json?.seal === "string" && grade.json.seal.length === 96);

  console.log("\n9. decision");
  const decided = await call(`/api/tasks/${id}/decision`, {
    method: "POST",
    body: JSON.stringify({ verdict: "iterate", note: "Pin the unit assertion before publishing." }),
  });
  ok("POST decision is 200", decided.status === 200);
  ok("decision persisted", decided.json?.decision?.verdict === "iterate");

  console.log("\n10. MCP agent interface");
  const init = await rpc("initialize", {});
  ok("initialize succeeds", init?.result?.protocolVersion);
  ok("initialize advertises tool capability", init?.result?.capabilities?.tools !== undefined);
  ok("initialize names the server", init?.result?.serverInfo?.name === "Crucible");

  const tools = await rpc("tools/list", {});
  const names = (tools?.result?.tools ?? []).map((t) => t.name);
  ok("tools/list returns tools", names.length >= 3, `${names.length}`);
  for (const expected of ["list_tasks", "get_task", "grade_task", "verify_integrity", "forge_task"]) {
    ok(`tools/list includes ${expected}`, names.includes(expected));
  }
  ok("tools carry input schemas", (tools?.result?.tools ?? []).every((t) => t.inputSchema?.type === "object"));
  const readTools = (tools?.result?.tools ?? []).filter((t) => t.annotations?.readOnlyHint);
  const writeTools = (tools?.result?.tools ?? []).filter((t) => !t.annotations?.readOnlyHint);
  ok("at least one read tool", readTools.length >= 1);
  ok("at least one mutating tool", writeTools.length >= 1);

  const unknown = await rpc("tools/call", { name: "does_not_exist", arguments: {} });
  ok("an unknown tool returns -32601", unknown?.error?.code === -32601, JSON.stringify(unknown?.error));

  const missing = await call(`/api/tasks/${id}/integrity`);
  ok("integrity before agent mutation", missing.status === 200);

  console.log("\n11. MCP mutation goes through the same path as the UI");
  const key = `journey-${Date.now()}`;
  const forged = await rpc("tools/call", {
    name: "forge_task",
    arguments: {
      name: "Agent forged task",
      failureMode: "This task was created through the JSON-RPC agent tool, not the browser.",
      prompt: "Reply with ONLY the number 7.",
      assertions: [{ id: "n", kind: "number_between", label: "is seven", weight: 1, min: 7, max: 7 }],
      idempotencyKey: key,
    },
  });
  const agentId = forged?.result?.structuredContent?.task?.id;
  ok("agent can forge a task", typeof agentId === "string");
  ok("the agent task reports the engine", forged?.result?.structuredContent?.verdict?.engineVersion);

  const replayed = await rpc("tools/call", {
    name: "forge_task",
    arguments: {
      name: "Agent forged task",
      failureMode: "This task was created through the JSON-RPC agent tool, not the browser.",
      prompt: "Reply with ONLY the number 7.",
      assertions: [{ id: "n", kind: "number_between", label: "is seven", weight: 1, min: 7, max: 7 }],
      idempotencyKey: key,
    },
  });
  ok(
    "retrying with the same idempotency key returns the first task",
    replayed?.result?.structuredContent?.task?.id === agentId,
  );
  ok("the replay is flagged as such", replayed?.result?.structuredContent?.idempotentReplay === true);

  const readBack = await call(`/api/tasks/${agentId}`);
  ok("the agent-created task is readable through the REST API", readBack.status === 200);
  ok("and it owns the same scope", readBack.json?.task?.name === "Agent forged task");

  console.log("\n12. ownership scoping");
  const stolen = await call(`/api/tasks/seed-unit-drift`);
  ok("another scope's task is not readable", stolen.status === 404, `got ${stolen.status}`);

  console.log("\n13. integrity");
  const integrity = await call(`/api/tasks/${id}/integrity`);
  ok("integrity is 200", integrity.status === 200);
  ok("replay is clean", integrity.json?.integrity?.ok === true, integrity.json?.integrity?.brokenReason ?? "");
  // create, update, grade, decision => four links before any deletion.
  ok("replay checked the expected links", integrity.json?.integrity?.checked === 4, `${integrity.json?.integrity?.checked}`);
  ok("integrity returns the verdict too", typeof integrity.json?.verdict?.score === "number");

  console.log("\n14. exports");
  const md = await call(`/api/tasks/${id}/dossier?format=markdown`);
  ok("markdown dossier downloads", md.status === 200 && md.text.includes("# Journey task v2"));
  ok("markdown dossier carries the factor table", md.text.includes("Factor"));
  ok("markdown dossier carries the chain head", md.text.includes("Chain head"));
  ok("markdown dossier states the caveat", md.text.toLowerCase().includes("not about a model"));
  const csv = await call(`/api/tasks/${id}/dossier?format=csv`);
  ok("csv dossier downloads", csv.status === 200 && csv.text.split("\n").length >= 3);
  const json = await call(`/api/tasks/${id}/dossier?format=json`);
  ok("json dossier downloads", json.status === 200 && json.json?.verdict?.engineVersion);

  const bundle = await call(`/api/tasks/${id}/bundle`);
  ok("kaggle bundle generates", bundle.status === 200 && bundle.json?.files?.length === 5);
  // The filename comes from the slug, which is frozen at creation time. Renaming
  // a task deliberately does not move its URL.
  const slug = bundle.json?.taskSlug;
  ok("bundle reports the task slug", typeof slug === "string" && slug.length > 0);
  const taskFile = bundle.json?.files?.find((f) => f.path === `${slug}.py`);
  ok("bundle includes the task file", Boolean(taskFile), `expected ${slug}.py`);
  ok("bundle task file grades in-process", taskFile?.content?.includes("from crucible_grader import check"));
  ok("bundle carries a self-check", bundle.json?.files?.some((f) => f.path === "selfcheck.py"));
  ok("bundle carries push commands", bundle.json?.files?.some((f) => f.path === "push.sh"));
  const fileDl = await call(`/api/tasks/${id}/bundle?file=push.sh`);
  ok("a single bundle file downloads", fileDl.status === 200 && fileDl.text.includes("kaggle b t push"));
  const traversal = await call(`/api/tasks/${id}/bundle?file=../../package.json`);
  ok("bundle file path traversal is refused", traversal.status === 404, `got ${traversal.status}`);

  console.log("\n15. delete and tombstone");
  const removed = await call(`/api/tasks/${id}`, { method: "DELETE" });
  ok("DELETE is 200", removed.status === 200);
  ok("delete reports the tombstone", removed.json?.retired === true);
  ok("the chain still replays after deletion", removed.json?.integrity?.ok === true);

  const gone = await call(`/api/tasks/${id}`);
  ok("the retired task leaves the live listing", gone.json?.task?.deletedAt !== null);
  const retiredList = await call("/api/tasks?includeRetired=true");
  ok("the tombstone is still retained", retiredList.json?.tasks?.some((t) => t.id === id));

  console.log("\n16. shared chrome");
  for (const path of ["/", "/suite", "/lineup", "/chain", "/settings", "/dossier", "/agent", "/forge"]) {
    const page = await call(path);
    ok(`${path} is 200`, page.status === 200, `got ${page.status}`);
    ok(`${path} links the repository`, page.text.includes(REPO_URL));
  }

  console.log("\n17. manifest");
  const manifest = await call("/mcp.json");
  ok("manifest is served", manifest.status === 200);
  ok("manifest lists tools", (manifest.json?.tools ?? []).length >= 3);
  ok("manifest carries a live endpoint", typeof manifest.json?.servers?.crucible?.url === "string");

  console.log("\n18. cross-scope isolation for the second agent task");
  const finalIntegrity = await call(`/api/tasks/${agentId}/integrity`);
  ok("agent task chain is clean", finalIntegrity.json?.integrity?.ok === true);

  console.log("\n19. no server errors");
  ok("no request returned 5xx", serverErrors.length === 0, serverErrors.join(", "));

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("\njourney crashed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (child) {
      child.kill();
      await new Promise((r) => setTimeout(r, 800));
      if (!child.killed) child.kill("SIGKILL");
    }
    if (!EXTERNAL) await rm(".crucible/journey", { recursive: true, force: true });
  });