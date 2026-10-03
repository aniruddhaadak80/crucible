<div align="center">

# Crucible

### Turn a real model failure into a deterministic, publishable benchmark task.

[![Live app](https://img.shields.io/badge/live-verified-34d399?style=flat-square&labelColor=0a0908)](https://crucible-aniruddha-adaks-projects.vercel.app)
[![Engine](https://img.shields.io/badge/engine-crucible--grade--v1.0.0-a78bfa?style=flat-square&labelColor=0a0908)](https://crucible-aniruddha-adaks-projects.vercel.app/settings)
[![Agent tools](https://img.shields.io/badge/MCP-11%20tools-22d3ee?style=flat-square&labelColor=0a0908)](https://crucible-aniruddha-adaks-projects.vercel.app/agent)
[![License MIT](https://img.shields.io/badge/license-MIT-fbbf24?style=flat-square&labelColor=0a0908)](LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-94a3b8?style=flat-square&labelColor=0a0908)](https://nextjs.org)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-94a3b8?style=flat-square&labelColor=0a0908)](tsconfig.json)
[![Live feeds](https://img.shields.io/badge/feeds-Hugging%20Face%20%2B%20arXiv-22d3ee?style=flat-square&labelColor=0a0908)](https://crucible-aniruddha-adaks-projects.vercel.app/lineup)

**[Live app](https://crucible-aniruddha-adaks-projects.vercel.app)** · **[GitHub](https://github.com/aniruddhaadak80/crucible)** · **[API](https://crucible-aniruddha-adaks-projects.vercel.app/api/health)** · **[Agent](https://crucible-aniruddha-adaks-projects.vercel.app/agent)** · **[Issues](https://github.com/aniruddhaadak80/crucible/issues)**

</div>

---

A benchmark that cannot be re-run is a rumour. Most evals are graded either by a
language model asking whether an answer "looks right", or by a substring match
so loose that a model can pass without doing the work.

Crucible grades a task with **exact assertions** — regex, JSON paths, numeric
ranges — and then scores **the task itself**: is it deterministic, can it
actually tell two models apart, are its inputs pinned, can a stranger reproduce
it? Six weighted factors, every one produced from a measured quantity, each
carrying the sentence that produced it.

<div align="center">
  <img src="docs/screenshot.png" alt="A forged benchmark task showing its six-factor grade, the heat dial and the assertion tape" width="900" />
</div>

<sub>Real output: a task forged through the UI, graded by `crucible-grade-v1.0.0`.
Captured from the deployed app by `npm run browser`.</sub>

---

## ✨ Features

- **Forge a task from a failure you actually saw.** Name the failure, write the
  prompt that provokes it, write assertions that decide the answer. It is
  written to a real database immediately.
- **Grade with exact assertions only.** Five deterministic kinds (regex,
  contains, not_contains, json_path_equals, number_between) and one explicit
  judge kind. Every outcome shows the exact span or value that decided it.
- **A grade for the task, not the model.** Six factors, weights published in
  every API response, every export and the UI. A high score means the *task* is
  worth publishing.
- **The heat dial.** Set how much of the grade a language-model judge decides.
  Watch the determinism factor, the score, the model ranking and the colour of
  the page respond — and the change is persisted and sealed.
- **Reproducibility, checked against reality.** Live Hugging Face Hub facts tell
  you whether a model's weights are gated and whether a pinnable revision exists
  at all. Closed models publish no repository, so nobody outside the provider
  can reproduce a run against them — and the app says so.
- **A tamper-evident audit trail.** Every create, update, grade, decision and
  delete appends to a per-task SHA-384 chain over canonical JSON. A replay
  endpoint recomputes it and names the first broken link.
- **A real agent interface.** Eleven typed tools over JSON-RPC 2.0. Mutating
  tools call the same service layer the buttons call, and are idempotent on a key.
- **A Kaggle bundle that grades identically.** Export a runnable
  `kaggle_benchmarks` task, a self-contained Python grader and the CLI commands.
  The test suite proves the Python port scores the same as the TypeScript engine.
- **Dossiers you can keep.** Markdown, JSON or CSV with the factor table, every
  transcript grade, provenance and the chain head.

---

## 🚀 Quickstart

Requires **Node 22+**. No API keys. No database to install.

```bash
git clone https://github.com/aniruddhaadak80/crucible.git
cd crucible
npm ci
npm run dev          # http://localhost:3000
```

Local development uses an **embedded Postgres** (PGlite — real Postgres compiled
to WebAssembly) stored under `./.crucible`. It is created on first run and needs
no configuration.

### Quality commands

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit`, TypeScript strict |
| `npm run lint` | ESLint, no suppressions |
| `npm run test` | 62 unit tests via `node --test` |
| `npm run build` | Production build |
| `npm run verify:db` | Exercises the real store: schema, seed, CRUD, audit, replay, tamper detection |
| `npm run verify:bundle` | Generates a Kaggle bundle and proves the Python grader matches the engine |
| `npm run journey` | Boots the app and walks the whole HTTP journey |
| `npm run browser` | Real Chromium pass on desktop and mobile |
| `npm run verify:live` | Full proof against a deployed URL |
| `npm run gate` | Everything above that does not need a browser |

### Production environment variables

See [`.env.example`](.env.example). Only one is required:

```bash
DATABASE_URL=postgresql://user:password@host/db?sslmode=require
NEXT_PUBLIC_SITE_URL=https://your-alias.vercel.app
```

Crucible **refuses to start a production-mode process without a hosted
`DATABASE_URL`.** It will not fall back to the embedded adapter, because a
serverless filesystem is not a durable store.

---

## 📐 Architecture

```mermaid
graph TB
  subgraph client["Browser"]
    UI["Pour column UI"]
    DIAL["Heat dial"]
  end
  subgraph server["Next.js 16 · App Router"]
    PROXY["proxy.ts · scope cookie"]
    PAGES["Server components"]
    API["REST route handlers"]
    MCP["JSON-RPC 2.0 endpoint"]
    SVC["Service layer"]
  end
  subgraph core["Deterministic core"]
    GRADER["crucible-grader"]
    ENGINE["crucible-grade"]
    CHAIN["SHA-384 chain"]
  end
  UI --> PAGES
  DIAL --> API
  PAGES --> SVC
  API --> SVC
  MCP --> SVC
  SVC --> GRADER
  GRADER --> ENGINE
  SVC --> CHAIN
  SVC --> DB[("Postgres")]
  SVC --> LIVE["Live feeds"]

  classDef live fill:#22d3ee,color:#08080a,stroke:#22d3ee
  classDef engine fill:#a78bfa,color:#08080a,stroke:#a78bfa
  classDef agent fill:#34d399,color:#08080a,stroke:#34d399
  classDef infra fill:#94a3b8,color:#08080a,stroke:#94a3b8
  classDef external fill:#fbbf24,color:#08080a,stroke:#fbbf24
  class UI,DIAL,PAGES live
  class GRADER,ENGINE,CHAIN engine
  class MCP agent
  class PROXY,API,SVC,DB infra
  class LIVE external
```

### Data pipeline and honest fallback

```mermaid
graph LR
  REQ["Route handler"] --> TIMEOUT["AbortSignal timeout"]
  TIMEOUT --> RETRY["2 bounded retries"]
  RETRY --> HUB["Hugging Face Hub API"]
  RETRY --> AX["arXiv API"]
  HUB --> NORM["Normalise to src/lib/types.ts"]
  AX --> NORM
  NORM --> ENV["FeedEnvelope · live | fallback"]
  NORM -.-> SEALED["Sealed dated snapshot"]
  ENV --> UI["Rendered with status tag"]

  classDef live fill:#22d3ee,color:#08080a,stroke:#22d3ee
  classDef external fill:#fbbf24,color:#08080a,stroke:#fbbf24
  classDef risk fill:#fb7185,color:#08080a,stroke:#fb7185
  class REQ,NORM,UI live
  class HUB,AX external
  class SEALED risk
```

Every feed returns `status: "live" | "fallback"`, the time it was produced, the
upstream identity and — when degraded — the reason. A sealed snapshot is always
rendered with its capture date. It is never presented as current.

### The deterministic engine

```mermaid
graph TB
  TASK["Benchmark task"] --> GRADE["gradeTask"]
  TX["Recorded transcripts"] --> GRADE
  GRADE --> DET["determinism · 0.26"]
  GRADE --> DISC["discrimination · 0.22"]
  GRADE --> SEALF["fixture seal · 0.18"]
  GRADE --> SPEC["assertion specificity · 0.16"]
  GRADE --> REPRO["reproduction · 0.10"]
  GRADE --> COST["cost fit · 0.08"]
  DET --> SUM["Weighted sum · 0-100"]
  DISC --> SUM
  SEALF --> SUM
  SPEC --> SUM
  REPRO --> SUM
  COST --> SUM
  SUM --> VERDICT["Verdict + band + weakest factor"]

  classDef engine fill:#a78bfa,color:#08080a,stroke:#a78bfa
  classDef live fill:#22d3ee,color:#08080a,stroke:#22d3ee
  classDef risk fill:#fb7185,color:#08080a,stroke:#fb7185
  class GRADE,DET,DISC,SEALF,SPEC,REPRO,COST,SUM engine
  class TASK,TX live
  class VERDICT risk
```

`gradeTask` is the only scoring function. The task page, the REST endpoint, the
agent tools and the dossier export all call it. Weights sum to exactly `1.00` and
a test asserts it.

**Discrimination is measured, not asserted.** It is the population standard
deviation of recorded scores against a target of `0.22`. A task every model
passes scores `0` on it, and the verdict says so.

### Agent sequence

```mermaid
graph LR
  CLIENT["MCP client"] --> INIT["initialize"]
  INIT --> LIST["tools/list"]
  LIST --> CALL["tools/call"]
  CALL --> VALID["Validate arguments"]
  VALID --> IDEM["Check idempotency key"]
  IDEM -->|seen| RETURN["Return stored result"]
  IDEM -->|new| SVC["Service layer"]
  SVC --> MUTATE["Create / update / decide / retire"]
  MUTATE --> SEAL["Append audit event"]
  SEAL --> RESULT["Result + seal"]

  classDef agent fill:#34d399,color:#08080a,stroke:#34d399
  classDef engine fill:#a78bfa,color:#08080a,stroke:#a78bfa
  classDef infra fill:#94a3b8,color:#08080a,stroke:#94a3b8
  classDef risk fill:#fb7185,color:#08080a,stroke:#fb7185
  class CLIENT,INIT,LIST,CALL,RESULT agent
  class VALID,IDEM,SVC,MUTATE engine
  class SEAL infra
  class RETURN risk
```

### Integrity and seal replay

```mermaid
graph TB
  GEN["Genesis constant"] --> E1["seal 1 = SHA-384(prev || canonical(event))"]
  E1 --> E2["seal 2"]
  E2 --> E3["seal n"]
  CANON["Canonical JSON<br/>sorted keys · stable arrays<br/>no silent NaN"] --> E1
  TMB["Tombstone retained<br/>on delete"] --> E3
  E3 --> REPLAY["Replay recomputes every seal"]
  REPLAY --> OK["Intact"]
  REPLAY --> BROKEN["First broken sequence named"]

  classDef engine fill:#a78bfa,color:#08080a,stroke:#a78bfa
  classDef agent fill:#34d399,color:#08080a,stroke:#34d399
  classDef risk fill:#fb7185,color:#08080a,stroke:#fb7185
  class GEN,CANON,E1,E2,E3 engine
  class OK,TMB agent
  class BROKEN risk
```

Two known digest vectors are pinned in the test suite, so a change to canonical
form cannot pass silently. The smoke test also edits a stored event directly in
the database and asserts that replay reports the correct sequence number.

### Deployment

```mermaid
graph LR
  PUSH["git push main"] --> CI["GitHub Actions<br/>typecheck · lint · test · build"]
  CI --> VERCEL["Vercel production build"]
  ENV["DATABASE_URL · SITE_URL"] --> VERCEL
  VERCEL --> ALIAS["Production alias"]
  ALIAS --> HEALTH["/api/health round trip"]
  ALIAS --> LIVE["verify:live 12-point proof"]
  LIVE --> HISTORY["Build history recorded"]

  classDef infra fill:#94a3b8,color:#08080a,stroke:#94a3b8
  classDef live fill:#22d3ee,color:#08080a,stroke:#22d3ee
  classDef agent fill:#34d399,color:#08080a,stroke:#34d399
  classDef external fill:#fbbf24,color:#08080a,stroke:#fbbf24
  class PUSH,CI,VERCEL,ALIAS infra
  class HEALTH,LIVE live
  class HISTORY agent
  class ENV external
```

---

## 🔌 API

All endpoints are scoped to an anonymous HTTP-only session cookie. Cross-scope
reads return `404`, indistinguishable from not-found.

### Health

```bash
curl -s https://crucible-aniruddha-adaks-projects.vercel.app/api/health | jq
```

```json
{
  "status": "ok",
  "store": { "kind": "neon-postgres", "durable": true, "roundTrip": "SELECT 1 returned 1", "ok": true },
  "seed": { "applied": true, "rows": 3, "error": null },
  "engine": { "version": "crucible-grade-v1.0.0", "grader": "crucible-grader-v1.0.0" }
}
```

This is a real round trip, not a static object. It returns `503` when the store
is unhealthy.

### Create, read back, update, delete

```bash
# Create
curl -sX POST https://crucible-aniruddha-adaks-projects.vercel.app/api/tasks \
  -H 'content-type: application/json' \
  -d '{
    "name": "Unit-of-measure drift",
    "failureMode": "The model returns micrograms where the schema demands milligrams.",
    "prompt": "Return ONLY JSON of the form {\"meta\":{\"units\":\"mg\"}}.",
    "sealedFixtures": ["export.csv=sha256:6f1a2c9d4e8b73a5"],
    "assertions": [
      {"id":"u","kind":"json_path_equals","label":"units are mg","weight":3,"path":"meta.units","jsonExpected":"mg"},
      {"id":"n","kind":"not_contains","label":"no micrograms","weight":2,"needle":"µg"}
    ],
    "transcripts": [
      {"modelId":"Qwen/Qwen2.5-72B-Instruct","completion":"{\"meta\":{\"units\":\"mg\"}}","latencyMs":1840,"tokensOut":96},
      {"modelId":"google/gemini-2.5-flash","completion":"{\"meta\":{\"units\":\"µg\"}}","latencyMs":2100,"tokensOut":101}
    ],
    "seed": 20260923, "targetTemp": 0, "tokenBudget": 400
  }' | jq '.verdict.score, .verdict.factors[0]'

# Read back
curl -s https://crucible-aniruddha-adaks-projects.vercel.app/api/tasks/<id> | jq '.task.name, .grade.grades[0].outcomes'

# Update
curl -sX PATCH https://crucible-aniruddha-adaks-projects.vercel.app/api/tasks/<id> \
  -H 'content-type: application/json' -d '{"name":"Unit-of-measure drift (v2)"}' | jq '.task.name'

# Delete — soft, and the tombstone keeps the chain replayable
curl -sX DELETE https://crucible-aniruddha-adaks-projects.vercel.app/api/tasks/<id> | jq '.retired, .integrity.ok'
```

### Run the engine

```bash
curl -sX POST https://crucible-aniruddha-adaks-projects.vercel.app/api/tasks/<id>/grade | jq '{score:.verdict.score, band:.verdict.band.id, seal:.seal}'
```

### Verify integrity

```bash
curl -s https://crucible-aniruddha-adaks-projects.vercel.app/api/tasks/<id>/integrity | jq '.integrity'
```

### Export

```bash
curl -s "https://crucible-aniruddha-adaks-projects.vercel.app/api/tasks/<id>/dossier?format=markdown" -o crucible-task.md
curl -s https://crucible-aniruddha-adaks-projects.vercel.app/api/tasks/<id>/bundle | jq '.files[].path'
```

### Errors

Every failure returns the same envelope, with no stack traces or environment values:

```json
{ "error": { "code": "validation_error", "message": "The task failed validation.",
  "details": [{ "path": "assertions[0].pattern", "message": "pattern is not a valid regular expression" }] } }
```

`400` bad request · `404` not found · `409` conflict or broken chain · `422`
validation · `429` rate limited · `503` store unavailable

---

## 🔌 Agent interface

JSON-RPC 2.0 over HTTP POST at `https://crucible-aniruddha-adaks-projects.vercel.app/api/mcp`.
Manifest: [`/mcp.json`](https://crucible-aniruddha-adaks-projects.vercel.app/mcp.json).

```bash
curl -sX POST https://crucible-aniruddha-adaks-projects.vercel.app/api/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools[].name'
```

| Tool | Kind | Purpose |
| --- | --- | --- |
| `list_tasks` | read | Every task in the session, with verdicts |
| `get_task` | read | Full record, per-assertion evidence, chain head |
| `rank_lineup` | analysis | Re-grade and rank recorded models, with separation |
| `grade_task` | analysis | Run the engine with live Hub facts, seal the verdict |
| `verify_integrity` | read | Replay the chain, name the first broken link |
| `live_signals` | read | Hub facts per model + newest arXiv papers |
| `export_bundle` | read | Generate the Kaggle Benchmarks bundle |
| `forge_task` | write | Create a task (idempotent) |
| `revise_task` | write | Patch a task (idempotent) |
| `record_decision` | write | File adopt / iterate / discard (idempotent) |
| `retire_task` | write | Soft delete, tombstone retained (idempotent) |

Retrying a mutating call with the same `idempotencyKey` returns the original
result and performs **no second mutation**:

```bash
curl -sX POST https://crucible-aniruddha-adaks-projects.vercel.app/api/mcp -H 'content-type: application/json' -d '{
  "jsonrpc":"2.0","id":2,"method":"tools/call","params":{
    "name":"forge_task",
    "arguments":{
      "name":"nested envelope collapse",
      "failureMode":"The model wraps a tool payload in a second envelope and the caller parses data: null.",
      "prompt":"Reply with ONLY the JSON the caller expects.",
      "idempotencyKey":"readme-demo"
    }}}'
```

Point any MCP client at it:

```json
{
  "mcpServers": {
    "crucible": { "type": "http", "url": "https://crucible-aniruddha-adaks-projects.vercel.app/api/mcp" }
  }
}
```

---

## 📁 Project map

| Route | User goal | Methods | Notes |
| --- | --- | --- | --- |
| `/` | Understand the product, see real grades | `GET` | Live verdicts from the reference tasks |
| `/suite` | Browse everything you own | `GET` | Filter state lives in the URL |
| `/forge` | Create a task | `POST` | Dynamic assertion builder, live determinism |
| `/task/[id]` | Inspect, decide, export, retire | `GET` `PATCH` `DELETE` | Heat dial, assertion tape, chain replay |
| `/lineup` | Rank recorded models | `GET` | Next to live Hub reproducibility facts |
| `/agent` | Drive the agent interface | `POST` | One-click calls, visible request/response |
| `/dossier` | Export the suite | `GET` | Markdown / JSON / CSV |
| `/chain` | Replay every chain | `GET` | Reports the first broken link |
| `/settings` | Store health, weights, feeds | `GET` `PUT` | Includes a real store round trip |

| API route | Purpose |
| --- | --- |
| `GET /api/health` | Real store round trip, engine versions |
| `GET/POST /api/tasks` | List (paginated) and create |
| `GET/PATCH/DELETE /api/tasks/[id]` | Read, revise, retire |
| `POST /api/tasks/[id]/decision` | File a decision |
| `POST /api/tasks/[id]/grade` | Run the engine, append a grade event |
| `GET /api/tasks/[id]/integrity` | Replay the chain |
| `GET /api/tasks/[id]/audit` | Append-only history |
| `GET /api/tasks/[id]/dossier` | Download Markdown / JSON / CSV |
| `GET /api/tasks/[id]/bundle` | Kaggle bundle, or one file with `?file=` |
| `GET /api/feed` | Normalised live data envelopes |
| `GET/PUT /api/settings` | Per-scope preferences |
| `POST /api/mcp` | JSON-RPC 2.0 agent endpoint |
| `GET /mcp.json` | Agent manifest |

### Module map

| Path | Responsibility |
| --- | --- |
| `src/lib/grade.ts` | The grader and the six-factor engine. No dependencies. |
| `src/lib/canonical.ts` | Canonical JSON, SHA-384 sealing, chain verification |
| `src/lib/types.ts` | Normalised domain types, including every external source |
| `src/lib/db/` | Schema, adapter selection, typed repository, audit chain |
| `src/lib/live/` | Bounded fetching, Hub and arXiv normalisers, sealed fallbacks |
| `src/lib/service.ts` | The one layer REST, MCP and the UI all call |
| `src/lib/mcp.ts` | Tool catalogue and JSON-RPC dispatch |
| `src/lib/kaggle.ts` | Kaggle bundle generator |
| `src/lib/dossier.ts` | Markdown / JSON / CSV export |

---

## 🎛 Every control, and what it actually does

The skill this project was built against forbids dead controls. Every one:

| Control | Route | Request | Effect |
| --- | --- | --- | --- |
| Forge a task | `/forge` | `POST /api/tasks` | Row written, audit event appended |
| Load an example | `/forge` | — | Fills the form from a worked example |
| Add / remove assertion | `/forge` | — | Recomputes determinism live |
| Heat dial | `/task/[id]` | `PATCH /api/tasks/[id]` | Re-grades, persists, seals |
| Re-grade and seal | `/task/[id]` | `POST …/grade` | Appends a grade event, returns a new seal |
| Transcript selector | `/task/[id]` | — | Switches the assertion tape |
| Record decision | `/task/[id]` | `POST …/decision` | Decision stored with the score at that moment |
| Retire as tombstone | `/task/[id]` | `DELETE /api/tasks/[id]` | Soft delete, replay returned as proof |
| Dossier downloads | `/task/[id]`, `/dossier` | `GET …/dossier` | Downloads a real file |
| Kaggle bundle | `/task/[id]` | `GET …/bundle` | Generates runnable Python |
| Suite filters | `/suite` | — | Filter state in the URL, shareable |
| Lineup task picker | `/lineup` | — | Selection in the URL |
| Tool buttons | `/agent` | `POST /api/mcp` | Real JSON-RPC call, response shown |
| `initialize` | `/agent` | `POST /api/mcp` | Real handshake |
| Save settings | `/settings` | `PUT /api/settings` | Persisted per scope |

---

## 🔐 Security model

- **No accounts.** A visitor's work belongs to an unguessable 128-bit scope id in
  an HTTP-only cookie, set in `proxy.ts` before the first render. Client script
  cannot read it.
- **Cross-scope reads are `404`**, not `403`, so the API cannot be used to
  discover that a task exists.
- **All input is validated** before it reaches the database: string and collection
  limits, enum membership, regex compilation (an invalid pattern is rejected,
  never executed), JSON-path character classes and 500-character pattern cap.
- **All SQL is parameterised.** Identifiers are never interpolated.
- **Deletes are soft.** The tombstone is retained so the chain still replays.
- **Upstream hosts are allowlisted** (`huggingface.co`, `export.arxiv.org`) and
  model ids are constrained to `owner/name`, so a stored value cannot be turned
  into a request to another host.
- **No secrets anywhere.** The core product needs no API key. `DATABASE_URL` is
  read server-side only and never reaches a client bundle.
- **Rate limiting is best-effort.** Anonymous write limits are per-container and
  reset on a cold start. That is a floor against a runaway client, not a
  boundary — see [SECURITY.md](SECURITY.md).

---

## 📊 Data provenance

| Source | Used for | Failure behaviour |
| --- | --- | --- |
| [Hugging Face Hub API](https://huggingface.co) | Gating, licensing, pinnable revisions, download counters | Sealed snapshot dated 2026-10-03 |
| [arXiv API](https://arxiv.org) | Newest cs.CL capability-evaluation papers | Sealed snapshot dated 2026-10-03 |

Model metadata is the Hugging Face Hub's own record. Download and like counts
are Hub counters, not usage telemetry. Preprint metadata is the author's own
arXiv submission.

The three bundled reference tasks ship with **seeded** transcripts. They are
labelled as bundled reference material everywhere they appear and are never
presented as a live model run. User-created data is never replaced by fallback
data.

---

## ⚠️ What this is not

**Crucible does not score models and does not predict capability.** A high grade
means the *task* is worth publishing. It says nothing about how good any model
is.

Specifically:

- Where a grade would need a language-model judge, the weight is reported as
  **undecided** and the verdict is marked `degraded`. It is never counted as a
  pass.
- Discrimination is a property of the recorded models. A task with two similar
  models recorded cannot be shown to separate them.
- The Hub's absence of a repository is reported as *unreproducible*, not as a
  quality judgement about the model.
- An audit chain detects **rewriting history**. It cannot stop somebody with
  write access from recomputing the whole log from genesis; that needs the head
  published somewhere append-only and independent.

---

## 🗺️ Roadmap

### Now

Shipped and verified in this repository.

```mermaid
graph TB
  A["Exact-assertion grader"] --> B["Six-factor engine"]
  B --> C["Hash-chained audit"]
  C --> D["MCP agent tools"]
  D --> E["Kaggle bundle export"]
  E --> F["Dossier exports"]

  classDef engine fill:#a78bfa,color:#08080a,stroke:#a78bfa
  classDef agent fill:#34d399,color:#08080a,stroke:#34d399
  classDef live fill:#22d3ee,color:#08080a,stroke:#22d3ee
  class A,B engine
  class C,D agent
  class E,F live
```

### Next

- **Published chain heads.** Anchor each task's chain head to an append-only
  external log, so a whole-log rewrite becomes detectable rather than merely
  possible. Outcome: a reader can verify a task has not been rewritten since a
  date.
- **Suite-level runs.** Record several tasks as one suite and report a suite
  verdict, so a whole benchmark can be graded rather than one task at a time.
  Outcome: a single export describing a benchmark, not a task.
- **Assertion diffing.** When a task is revised, show which assertions changed
  and re-score every historical transcript against both versions. Outcome: you
  can see what a revision actually did to the numbers.
- **Partial-credit reporting.** Export per-assertion pass rates as a matrix.
  Outcome: you can see which assertion every model fails, which is usually the
  interesting one.

```mermaid
graph LR
  HEAD["Published heads"] --> SUITE["Suite runs"]
  SUITE --> DIFF["Assertion diffing"]
  DIFF --> MATRIX["Pass-rate matrix"]

  classDef live fill:#22d3ee,color:#08080a,stroke:#22d3ee
  classDef agent fill:#34d399,color:#08080a,stroke:#34d399
  class HEAD,SUITE live
  class DIFF,MATRIX agent
```

### Later

- **Model-proxy passthrough.** Run the exported task against a live proxy from
  the app and import the results, so the loop does not leave the browser.
  Outcome: a task can be measured against real models without hand-editing files.
- **Grader plugins.** Let a project ship its own assertion kinds behind the same
  determinism accounting. Outcome: domain-specific assertions stay measurable
  without losing the guarantee.
- **Signed bundles.** Sign a generated bundle so a reader can verify it came from
  a specific task record. Outcome: a shared task file is verifiably untampered.

```mermaid
graph TB
  PROXY["Model-proxy passthrough"] --> PLUG["Grader plugins"]
  PLUG --> SIGN["Signed bundles"]

  classDef external fill:#fbbf24,color:#08080a,stroke:#fbbf24
  classDef engine fill:#a78bfa,color:#08080a,stroke:#a78bfa
  classDef risk fill:#fb7185,color:#08080a,stroke:#fb7185
  class PROXY external
  class PLUG engine
  class SIGN risk
```

---

## 🤝 Contributing

Issues and pull requests are welcome, especially ones that find a case where a
score is unearned.

```bash
npm ci
npm run gate     # typecheck, lint, tests, build, store checks, bundle checks
```

If your change affects grading, add a test in `src/lib/__tests__/` — the engine
is a pure module with no dependencies, so it is cheap to test. If it affects the
audit chain, the canonical form or the exported Python grader, the known-vector
and TypeScript-to-Python parity checks are the ones that matter.

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## 📄 License

[MIT](LICENSE) © Aniruddha Adak

Built with [Next.js 16](https://nextjs.org), React 19, Tailwind CSS v4,
PGlite, the Neon serverless driver, and Framer Motion.