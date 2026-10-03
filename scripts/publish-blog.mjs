/**
 * Publish the Crucible post to DEV.to.
 *
 *   node scripts/publish-blog.mjs            publish docs/blog.md
 *   node scripts/publish-blog.mjs --dry-run  validate only, no request
 *
 * Node rather than PowerShell on purpose. PowerShell 5.1's ConvertTo-Json
 * expands a string per character for large payloads, and its default request
 * encoding mangles the non-ASCII characters this post contains. Node writes and
 * sends UTF-8 with no surprises, and it can print dev.to's real error body,
 * which PowerShell swallowed into a bare "400 Bad Request".
 *
 * The API key is read at runtime and never logged, printed or written to disk.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DRY = process.argv.includes("--dry-run");

const TITLE = "I built a tool that grades the benchmark instead of the model";
const DESCRIPTION = "A deterministic grader for LLM benchmark tasks, with a hash chain anyone can replay.";
const TAGS = ["machinelearning", "typescript", "opensource", "llm"];
const COVER = "https://crucible-aniruddha-adaks-projects.vercel.app/opengraph-image";
const SERIES = "Crucible";

const body = readFileSync(join(process.cwd(), "docs", "blog.md"), "utf8");

/* --------------------------- validate before spending --------------------------- */

const problems = [];
if (TITLE.length < 4 || TITLE.length > 128) problems.push(`title ${TITLE.length} not in 4-128`);
if (DESCRIPTION.length > 100) problems.push(`description ${DESCRIPTION.length} exceeds 100`);
if (body.length > 40000) problems.push(`body ${body.length} exceeds 40000`);
if (TAGS.length > 4) problems.push(`${TAGS.length} tags, max 4`);
for (const t of TAGS) if (!/^[a-z0-9]+$/.test(t)) problems.push(`tag "${t}" not lowercase alphanumeric`);

// Belt and braces: a published post is public forever.
const SECRET = /neondb_owner:[A-Za-z0-9]{8,}@|\bsk-[A-Za-z0-9]{20,}|\bghp_[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{16}\b|DATABASE_URL\s*=\s*\S/;
if (SECRET.test(body)) problems.push("body contains something shaped like a credential");
if (!body.includes("github.com/aniruddhaadak80/crucible")) problems.push("body does not link the repository");
if (!body.includes("crucible-aniruddha-adaks-projects.vercel.app")) problems.push("body does not link the live app");

if (problems.length) {
  console.error("ABORT, nothing sent:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`validated  title=${TITLE.length}  description=${DESCRIPTION.length}  body=${body.length}  tags=${TAGS.length}`);
console.log(`           charts=${(body.match(/```mermaid/g) ?? []).length}  bytes=${Buffer.byteLength(body, "utf8")}`);

const payload = JSON.stringify({
  article: {
    title: TITLE,
    description: DESCRIPTION,
    body_markdown: body,
    tags: TAGS,
    main_image: COVER,
    published: true,
    series: SERIES,
  },
});

if (DRY) {
  console.log("\ndry run, nothing posted");
  process.exit(0);
}

/* ---------------------------------- publish ---------------------------------- */

const key = readFileSync(join(homedir(), ".devto", "api-key.txt"), "utf8")
  .trim()
  .split("\n")
  .pop()
  .trim();

if (!key) {
  console.error("ABORT: no API key found");
  process.exit(1);
}

// Auth first, so a revoked key fails before any write is attempted.
const me = await fetch("https://dev.to/api/articles/me?per_page=1", {
  headers: { "api-key": key },
});
if (!me.ok) {
  console.error(`ABORT: auth check returned ${me.status}. Regenerate at dev.to/settings/extensions.`);
  process.exit(1);
}
const profile = await me.json();
console.log(`auth ok, posting as @${profile.username}`);

const response = await fetch("https://dev.to/api/articles", {
  method: "POST",
  headers: { "api-key": key, "content-type": "application/json; charset=utf-8" },
  // Buffer so the body is transmitted as exact UTF-8 bytes.
  body: Buffer.from(payload, "utf8"),
});

const text = await response.text();

if (!response.ok) {
  console.error(`\nPUBLISH FAILED: HTTP ${response.status}`);
  // dev.to returns a JSON error object; print it rather than guessing.
  try {
    const parsed = JSON.parse(text);
    console.error(JSON.stringify(parsed, null, 2).slice(0, 2000));
  } catch {
    console.error(text.slice(0, 2000));
  }
  process.exit(1);
}

const article = JSON.parse(text);
console.log("\nPUBLISHED");
console.log(`  url  ${article.url}`);
console.log(`  id   ${article.id}`);

// Keep a copy of exactly what was published, so the repo never drifts from DEV.
const snapshotPath = join(process.cwd(), "docs", "published.json");
writeFileSync(
  snapshotPath,
  JSON.stringify(
    { id: article.id, url: article.url, title: TITLE, tags: TAGS, publishedAt: new Date().toISOString(), bytes: Buffer.byteLength(body, "utf8") },
    null,
    2,
  ),
  "utf8",
);
console.log(`  snapshot written to docs/published.json`);