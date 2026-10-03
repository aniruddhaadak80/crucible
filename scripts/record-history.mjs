/**
 * Appends the Crucible build to the shared wow-repo history.
 *
 * Only ever run after the live gates pass: the skill requires a completed build
 * to be recorded, and abandoned candidates not to be. Existing entries are
 * preserved untouched.
 *
 *   node scripts/record-history.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HISTORY = join(homedir(), ".wow-repo-history.json");
const LIVE = "https://crucible-aniruddha-adaks-projects.vercel.app";

const entry = {
  repository: "aniruddhaadak80/crucible",
  concept:
    "A benchmark forge that grades a task with exact assertions instead of a model-as-judge, then scores whether the task itself is worth publishing",
  persona:
    "ML or eval engineer who keeps hitting one unexplained model failure and needs a reproducible benchmark out of it",
  coreEntity: "Benchmark task (prompt + sealed fixtures + deterministic grader + recorded transcripts)",
  decisiveAction:
    "Forge a real failure into a scored task, turn the model-dependence dial, watch the grader re-rank recorded transcripts, export a sealed dossier or a Kaggle bundle, then retire it as a tombstone",
  routeTopology: [
    "/",
    "/suite",
    "/forge",
    "/task/[id]",
    "/lineup",
    "/agent",
    "/dossier",
    "/chain",
    "/settings",
  ],
  liveDataSource:
    "Hugging Face Hub model API (gating, license, pinnable revision) and arXiv cs.CL, both key-free, with dated sealed snapshots",
  persistenceModel:
    "Neon Postgres in production via DATABASE_URL; embedded PGlite for zero-config local dev and CI; production refuses to start without a hosted URL unless the documented CRUCIBLE_ALLOW_EMBEDDED_STORE escape hatch is set",
  engine:
    "crucible-grade-v1.0.0: six weighted factors summing to exactly 1 (determinism 0.26, discrimination 0.22, fixture seal 0.18, assertion specificity 0.16, reproduction 0.10, cost fit 0.08). Discrimination is the measured population sigma of recorded scores against a 0.22 target, so a task every model passes scores zero on it",
  agentWorkflow:
    "MCP JSON-RPC 2.0 with eleven typed tools (4 read, 2 analysis, 4 write plus export); all mutations share one service layer with the UI and are idempotent on an explicit key",
  visualMetaphor:
    "Foundry floor: a single vertical pour column, a rotated-label rail, and a page ground whose hue is the computed model-dependence",
  palette:
    "Soot and iron with a five-stop steel temperature ramp (quench indigo, deep ember, orange, straw, white heat) and lime reserved solely for verified-live",
  typographyLayout:
    "Big Shoulders Display condensed signage with Martian Mono data plates, self-hosted; no top navigation and no card grid",
  motionModel:
    "Stage wipes and a heat-tinted ground that shifts with the computed value, reduced-motion aware",
  signatureInteraction:
    "The heat dial: setting the total weight given to language-model judges re-runs the shared engine, re-scores every recorded transcript, persists the change and re-tints the whole page",
  repoUrl: "https://github.com/aniruddhaadak80/crucible",
  liveUrl: LIVE,
  completionDate: "2026-10-03",
  devPostUrl: null,
  signature: {
    problemDomain: "LLM benchmark task authoring and grader quality",
    primaryPersona:
      "ML or eval engineer who keeps hitting one unexplained model failure and needs a reproducible benchmark out of it",
    coreEntity: "Benchmark task",
    decisiveUserAction: "Forge, turn the dial, decide, export, retire",
    routeAndInformationTopology:
      "Vertical pour column with charge, mould, tap and ingot stages; rotated-label rail; nine user routes",
    liveDataSource: "Hugging Face Hub and arXiv, both key-free, with dated sealed fallbacks",
    deterministicDecisionModel:
      "Six weighted explainable factors with measured discrimination and a degraded flag when judge weight is undecided",
    agentWorkflow:
      "Eleven JSON-RPC tools over one service layer, idempotent mutations, durable idempotency keys",
    visualMetaphor: "Foundry floor, pour column and cooling curve",
    paletteAndContrast:
      "Soot and iron with a computed steel temperature ramp; lime only for verified-live",
    typographyAndLayoutRhythm:
      "Big Shoulders Display with Martian Mono, self-hosted; rotated rail labels, no card grid",
    signatureInteractionOrMotionBehavior:
      "The heat dial re-grades real transcripts and re-tints the ground from the computed value",
  },
  verification: {
    typecheck: "pass",
    lint: "pass, no suppressions",
    unitTests: "62 passed across 4 files via node --test",
    build: "pass",
    storeChecks: "33 of 33 passed against the real embedded adapter, including tamper detection naming the correct sequence",
    bundleParity:
      "36 of 36 passed; the exported Python grader scores every seeded transcript identically to the TypeScript engine",
    journey: "97 of 97 passed over HTTP, including cross-scope isolation and bundle path-traversal refusal",
    browserLocal: "49 of 49 passed on desktop 1440x900 and mobile 390x844, zero console errors, zero failed requests",
    liveVerifier: "105 of 105 passed against the production alias",
    browserProduction: "49 of 49 passed against the production alias",
    persistence:
      "neon-postgres confirmed by /api/health with a real SELECT 1 round trip and durable true",
    feed:
      "Hugging Face Hub and arXiv confirmed live with source attribution; sealed snapshots dated 2026-10-03 used on failure",
    mcp:
      "initialize, tools/list with eleven annotated schemas, mutating tool with durable idempotent replay, read-back over REST",
    integrity:
      "SHA-384 chain replays clean; tombstones retained; two hand-verified known digest vectors pinned; a directly edited event is detected and reported at the correct sequence",
    exports: "Markdown, JSON and CSV dossiers download as attachments with factor table, provenance and chain head",
    repository: "https://github.com/aniruddhaadak80/crucible returns 200 and is public with the verified homepage set",
    notableBugsFoundAndFixed: [
      "PGlite calls mkdirSync non-recursively, so the first local run died with a bare ENOENT until the adapter created its own directory",
      "PGlite rejects multi-statement DDL, so the schema had to be split and applied one statement at a time",
      "Postgres timestamptz::text does not round-trip byte-identically to the ISO string that was hashed, so every stored seal disagreed with its own recomputation until reads were normalised through to_char",
      "The exported Python grader emitted JSON true/false/null, which parses as identifiers but throws NameError on first run; ast.parse passed, so syntax checking alone was not sufficient evidence",
      "Python json.dumps inserts spaces after commas while JSON.stringify does not, so a JSON assertion scored differently in the exported bundle than in the engine",
      "The primary navigation pointed at /leaderboard after the route was renamed to /lineup, a dead link invisible to typecheck; a unit test now asserts every nav and footer entry names a real route",
      "Retiring a task swapped the whole stage for a tombstone notice and hid the success message the user was waiting for",
      "A Math.random() assertion id in client state made the server and client render different markup and broke hydration of the entire forge form",
      "The agent manifest advertised crucible.vercel.app, a hostname owned by an unrelated project, because absolute URLs were baked at build time; it is now derived from the request",
      "verify-live and the browser pass initially used a Node-side fetch with no cookie, which minted a second anonymous scope and made records appear to vanish; the scoping was working correctly and the harness was wrong",
    ],
  },
};

const raw = readFileSync(HISTORY, "utf8");
const history = JSON.parse(raw);

const existing = history.builds.findIndex((b) => b.repository === entry.repository);
if (existing >= 0) {
  history.builds[existing] = entry;
  console.log("replaced existing entry for", entry.repository);
} else {
  history.builds.push(entry);
  console.log("appended", entry.repository);
}

writeFileSync(HISTORY, `${JSON.stringify(history, null, 2)}\n`, "utf8");
console.log(`builds recorded: ${history.builds.length}`);