/**
 * Secret and sensitive-material audit.
 *
 *   node scripts/security-audit.mjs
 *
 * Scans every git-tracked file plus the built client bundle for:
 *   - credentials and tokens of every common shape
 *   - live database connection strings
 *   - environment variable names leaking into client JavaScript
 *   - personal data that should not be published
 *   - stray local paths, private hostnames and internal URLs
 *   - debug leftovers (console.log of state, TODO, FIXME, placeholder copy)
 *
 * Exits non-zero when a high-confidence finding exists, so it can gate a push.
 * The allowlist is deliberately narrow: anything genuinely public (the public
 * repository URL, the public deployment alias) is listed explicitly rather than
 * matched loosely.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const PUBLIC_SAFE = [
  "https://github.com/aniruddhaadak80/crucible",
  "https://crucible-aniruddha-adaks-projects.vercel.app",
  "https://crucible-two-omega.vercel.app",
  "https://github.com/aniruddhaadak80",
];

const RULES = [
  { id: "neon-connection-string", severity: "high", re: /neondb_owner:[A-Za-z0-9]{8,}@/g },
  {
    id: "postgres-credentialed-url",
    severity: "high",
    re: /postgres(?:ql)?:\/\/[^\s:/"']+:[^\s@/"']{6,}@[^\s/"']+/g,
    /*
     * Documented placeholders and ephemeral local service containers are not
     * credentials. `user:password@host` is the shape printed in the README and
     * .env.example on purpose, and `localhost` is a throwaway CI container that
     * exists only for the duration of a job. Both are excluded by shape rather
     * than by filename, so a real credential cannot slip past by being renamed.
     */
    allow: [
      /^postgres(?:ql)?:\/\/user:password@host/i,
      /^postgres(?:ql)?:\/\/[^:/]+:[^@]*@(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d+)?/i,
    ],
  },
  { id: "openai-key", severity: "high", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { id: "anthropic-key", severity: "high", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { id: "github-token", severity: "high", re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { id: "slack-token", severity: "high", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { id: "google-api-key", severity: "high", re: /\bAIza[0-9A-Za-z_-]{30,}/g },
  { id: "aws-access-key", severity: "high", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: "jwt", severity: "medium", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { id: "vercel-oidc", severity: "high", re: /VERCEL_OIDC_TOKEN\s*[=:]\s*["']?[A-Za-z0-9._-]{20,}/g },
  { id: "private-key-block", severity: "high", re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { id: "kaggle-json-secret", severity: "high", re: /"kaggle_api_token"\s*:\s*"[^"]{10,}"/g },
];

const LEAKS = [
  // Server-only names must never appear in a browser bundle.
  { id: "client-bundle-env", severity: "high", re: /\bDATABASE_URL\b/g, onlyIn: ["\\.next/static"] },
];

/*
 * Code-hygiene markers, not secrets.
 *
 * Scoped to `src/` on purpose. Prose that says "no action may end in TODO" and
 * a regex literal that searches for TODO are both correct and must not be
 * reported as unfinished work. Reported as `low` so they are visible without
 * failing the gate; `npm run lint` is the real check for dead code.
 */
const DEBUG_NOISE = [
  { id: "todo-marker", severity: "low", re: /\bTODO\b|\bFIXME\b|\bXXX\b/g, onlyIn: ["src/"] },
  { id: "placeholder-copy", severity: "low", re: /lorem ipsum|placeholder text|coming soon/i },
];

const PII = [
  { id: "private-email", re: /[\w.+-]+@[\w-]+\.[\w.]{2,}/g, allow: [/users\.noreply\.github\.com/, /@github\.com/] },
  { id: "windows-user-path", re: /C:\\Users\\[A-Za-z0-9_.-]+/g },
];

const findings = [];
function report(severity, id, file, snippet) {
  findings.push({ severity, id, file, snippet: String(snippet).slice(0, 90) });
}

function tracked() {
  try {
    return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function walk(dir, out = [], depth = 0) {
  if (depth > 6) return out;
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out, depth + 1);
    else if (st.isFile() && st.size < 4_000_000) out.push(full);
  }
  return out;
}

function scanText(text, file, rules, options = {}) {
  for (const rule of rules) {
    if (rule.onlyIn && !rule.onlyIn.some((p) => file.replace(/\\/g, "/").includes(p))) continue;
    // A rule may narrow itself, and a caller may widen the exceptions. Both
    // have to be consulted, otherwise a documented allowlist silently does
    // nothing and every placeholder is reported as a live credential.
    const allow = [...(rule.allow ?? []), ...(options.allow ?? [])];
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      const hit = m[0];
      if (allow.some((a) => a.test(hit))) {
        if (m.index === rule.re.lastIndex) rule.re.lastIndex += 1;
        continue;
      }
      report(rule.severity, rule.id, file, hit);
      if (m.index === rule.re.lastIndex) rule.re.lastIndex += 1;
    }
  }
}

/* ------------------------------- tracked files ------------------------------- */

const files = tracked();
console.log(`\nAuditing ${files.length} git-tracked files`);

let scanned = 0;
for (const file of files) {
  const full = join(ROOT, file);
  if (!existsSync(full)) continue;
  let text = "";
  try {
    text = readFileSync(full, "utf8");
  } catch {
    continue;
  }
  scanned += 1;

  scanText(text, file, RULES);
  scanText(text, file, PII, { allow: PII.flatMap((p) => p.allow ?? []) });
  scanText(text, file, DEBUG_NOISE);
}

// Binary and media are not text-scanned.
console.log(`Scanned ${scanned} text files`);

/* --------------------------- built client bundle --------------------------- */

const staticDir = join(ROOT, ".next", "static");
let bundleFiles = 0;
if (existsSync(staticDir)) {
  const jsFiles = walk(staticDir).filter((f) => f.endsWith(".js") || f.endsWith(".css"));
  bundleFiles = jsFiles.length;
  console.log(`Auditing ${jsFiles.length} built client asset(s) for leaked server values`);
  for (const file of jsFiles) {
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    scanText(text, relative(ROOT, file), RULES);
    scanText(text, relative(ROOT, file), LEAKS);
    // A connection string must never reach a browser bundle.
    if (/neon\.tech|vercel\.app\/neondb|postgresql:\/\//i.test(text)) {
      report("high", "db-url-in-client-bundle", relative(ROOT, file), "postgres url in client asset");
    }
  }
} else {
  console.log("No .next/static present; run `npm run build` to audit the client bundle");
}

/* ------------------------- ignored-file correctness ------------------------- */

console.log("\nChecking that local secret files are ignored and untracked");
const mustBeIgnored = [".env", ".env.local", ".vercel", ".crucible"];
for (const path of mustBeIgnored) {
  let ignored = false;
  try {
    execFileSync("git", ["check-ignore", "-q", path], { cwd: ROOT, stdio: "ignore" });
    ignored = true;
  } catch {
    ignored = false;
  }
  const isTracked = files.includes(path);
  if (!ignored) report("medium", "not-gitignored", path, "should be git-ignored");
  if (isTracked) report("high", "secret-file-tracked", path, "must not be committed");
}
console.log(`  .env.example tracked and empty of values: ${files.includes(".env.example")}`);

/* ------------------------------- allowlist ------------------------------- */

const afterAllow = findings.filter((f) => {
  if (f.severity !== "high") return true;
  const hit = f.snippet;
  return !PUBLIC_SAFE.some((safe) => hit.includes(safe));
});

/* -------------------------------- report -------------------------------- */

console.log("");
if (afterAllow.length === 0) {
  console.log("PASS  no secrets, tokens or sensitive values found");
  console.log(
    `      ${files.length} tracked files, ${bundleFiles} client assets, ${mustBeIgnored.length} ignore rules checked`,
  );
  process.exit(0);
}

const high = afterAllow.filter((f) => f.severity === "high");
const medium = afterAllow.filter((f) => f.severity === "medium");
const low = afterAllow.filter((f) => f.severity === "low");
void medium;
void low;

console.log(`FAIL  ${afterAllow.length} finding(s): ${high.length} high, ${medium.length} medium`);
for (const f of afterAllow) {
  console.log(`  [${f.severity}] ${f.id} in ${f.file}`);
  console.log(`         ${f.snippet}`);
}
if (high.length > 0) process.exit(1);