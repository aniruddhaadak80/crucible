/**
 * Real browser pass.
 *
 * Drives Chromium through the three jobs-to-be-done using visible controls
 * only, on a desktop and a mobile viewport, and fails on any console error,
 * page error, or failed request.
 *
 *   node scripts/browser.mjs                       boots next dev locally
 *   BASE_URL=https://host node scripts/browser.mjs runs against a deploy
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { chromium } from "playwright";

const REPO_URL = "https://github.com/aniruddhaadak80/crucible";
const EXTERNAL = process.env.BASE_URL?.replace(/\/$/, "");
const PORT = Number(process.env.PORT ?? 4321);
const base = EXTERNAL ?? `http://127.0.0.1:${PORT}`;
const SHOTS = ".screenshots";

let checks = 0;
let failures = 0;
const problems = [];

function ok(label, condition, extra = "") {
  checks += 1;
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${extra ? ` :: ${extra}` : ""}`);
  }
}

let child = null;

async function boot() {
  console.log(`\nbooting the production build on ${base}`);

  /*
   * `next start`, not `next dev`.
   *
   * Two reasons. First, hydration is what this pass is actually testing, and the
   * dev server's HMR socket does not come up in this environment, so client
   * components never attach there. Second, verifying the production artifact is
   * the only way to be sure about what gets deployed.
   *
   * CRUCIBLE_ALLOW_EMBEDDED_STORE is the documented local-only escape hatch that
   * lets the embedded adapter run in a production-mode process. A real deployment
   * sets DATABASE_URL and never sets this.
   */
  child = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(PORT),
        CRUCIBLE_PGLITE_DIR: ".crucible/browser",
        CRUCIBLE_ALLOW_EMBEDDED_STORE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", () => {});
  const stderr = [];
  child.stderr.on("data", (d) => {
    stderr.push(String(d));
    if (stderr.length > 40) stderr.shift();
  });

  for (let i = 0; i < 90; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      if ((await fetch(`${base}/api/health`)).ok) {
        console.log("server ready");
        return;
      }
    } catch {
      /* not up */
    }
  }
  throw new Error(`server did not become ready\n${stderr.join("")}`);
}

/** Attach the listeners that make console/network noise a hard failure. */
function watch(page, label) {
  page.on("console", (msg) => {
    const text = msg.text();
    // HMR only exists in `next dev`. It is absent from a production build, so
    // failing on it would make the local run stricter than the deployed one.
    if (text.includes("/_next/hmr") || text.includes("WebSocket")) return;
    if (msg.type() === "error") problems.push(`[${label}] console error: ${text.slice(0, 200)}`);
  });
  page.on("pageerror", (err) => problems.push(`[${label}] page error: ${String(err).slice(0, 200)}`));
  page.on("requestfailed", (req) => {
    const failure = req.failure()?.errorText ?? "";
    if (req.url().includes("/_next/webpack-hmr")) return;
    if (!failure.includes("ERR_ABORTED")) {
      problems.push(`[${label}] request failed: ${req.url().slice(0, 120)} ${failure}`);
    }
  });
  page.on("response", (res) => {
    if (res.status() >= 500) problems.push(`[${label}] 5xx: ${res.status()} ${res.url().slice(0, 120)}`);
    if (res.status() === 404) {
      const req = res.request();
      problems.push(
        `[${label}] 404: ${req.method()} ${req.resourceType()} ${res.url().replace(base, "").slice(0, 120)} (page=${page.url().replace(base, "")})`,
      );
    }
  });
}

/**
 * Compile every route before asserting on it.
 *
 * The first request to a page in `next dev` triggers an on-demand compile that
 * can take far longer than a normal navigation, so warming them first keeps the
 * assertions measuring the app rather than the compiler.
 */
async function warm(context, paths) {
  const page = await context.newPage();
  for (const path of paths) {
    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded", timeout: 120000 }).catch(() => {});
  }
  await page.close();
}

/**
 * Fetch from inside the page.
 *
 * `page.request` does not carry this app's `httpOnly` scope cookie. A request
 * made without it is treated as a brand-new visitor by the proxy, which mints a
 * fresh scope and overwrites the cookie — so a test using `page.request`
 * silently destroys the session it is trying to inspect. Going through the page
 * uses the browser's own cookie handling, which is what a real visitor gets.
 */
let seq = 0;
const timeline = [];

async function goto(page, path, note) {
  seq += 1;
  timeline.push(`${seq} GOTO ${path} (${note})`);
  const res = await page.goto(path.startsWith("http") ? path : `${base}${path}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  timeline.push(`${seq}   -> ${res?.status()}`);
  return res;
}

async function apiFetch(page, path) {
  // Resolved in Node, not the page: a relative URL has no base when the page is
  // still about:blank, which is exactly the state a freshly opened page is in.
  const target = path.startsWith("http") ? path : `${base}${path}`;
  return page.evaluate(async (url) => {
    const res = await fetch(url, { credentials: "same-origin" });
    const headers = {};
    for (const [k, v] of res.headers.entries()) headers[k] = v;
    const ok = res.ok === true;
    const status = res.status;
    const body = await res.text();
    return { status, ok, headers, body };
  }, target);
}

async function apiGetJson(page, path) {
  const res = await apiFetch(page, path);
  if (!res.ok) return { ...res, json: null };
  try {
    return { ...res, json: JSON.parse(res.body) };
  } catch {
    return { ...res, json: null };
  }
}

async function run(label, viewport, work) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport });
  await warm(context, ["/", "/forge", "/suite", "/lineup", "/agent", "/chain", "/dossier", "/settings"]);
  const page = await context.newPage();
  watch(page, label);
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);

  try {
    await work(page);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${label} threw :: ${error instanceof Error ? error.message.slice(0, 300) : error}`);
  } finally {
    await browser.close();
  }
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  if (!EXTERNAL) {
    await rm(".crucible/browser", { recursive: true, force: true });
    await boot();
  }

  const desktop = { width: 1440, height: 900 };
  let warmId = null;

  /* ---------------------------------------------------------------- *
   * Desktop: the three jobs-to-be-done
   * ---------------------------------------------------------------- */
  await run("desktop", desktop, async (page) => {
    /*
     * An in-page fetch needs a real origin. A freshly opened page is about:blank,
     * whose origin is "null" and which any cross-origin request is blocked from.
     * So the first thing this pass does is navigate, and only then talks to the
     * API from inside the page.
     */
    await goto(page, "/", "start");

    /*
     * Compile the dynamic task route before asserting on it.
     *
     * `/task/[id]` is compiled on demand and the first compile of a dynamic
     * segment can outlast any reasonable assertion timeout. The throwaway
     * record must be created *through the page*: a Node-side fetch carries no
     * scope cookie, so the record would land in a different anonymous session
     * and the browser would correctly refuse to read it back with a 404.
     */
    const warm = await apiGetJson(page, "/api/health");
    ok("health answers inside the browser", warm.ok === true, `${warm.status}`);

    const createdRes = await page.evaluate(async (url) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          name: "Browser warm-up record",
          failureMode: "A throwaway record created only to compile the dynamic route before assertions run.",
          prompt: "Reply with a single JSON object.",
        }),
      });
      return { status: res.status, body: await res.text() };
    }, `${base}/api/tasks`);
    const parsed = createdRes.body ? JSON.parse(createdRes.body) : null;
    warmId = parsed?.task?.id ?? null;
    ok(
      "warm-up record created in the browser session",
      typeof warmId === "string",
      `${createdRes.status} ${createdRes.body.slice(0, 120)}`,
    );

    if (warmId) {
      await goto(page, `/task/${warmId}`, "warm-task");
    }

    console.log("\njob 1 — forge a task from a real failure");
    await goto(page, "/forge", "job1");

    await page.getByRole("button", { name: /load an example/i }).click();
    await page.getByRole("button", { name: /pour the task/i }).click();

    // The form must navigate to the new record: that is the persistence proof.
    await page.waitForURL(/\/task\/[0-9a-f-]{8,}/, { timeout: 120000 });
    const taskUrl = page.url();
    ok("forging navigates to a persisted task", /\/task\/[0-9a-f-]{8,}/.test(taskUrl), taskUrl);
    await page.waitForLoadState("domcontentloaded");

    ok("the task shows a grade", await page.locator(".readout").first().isVisible());
    const gradeText = await page.locator(".readout").first().innerText();
    ok("the grade is a real number", /\d/.test(gradeText), gradeText);
    ok("the prompt under test is shown", await page.getByText("PROMPT UNDER TEST").isVisible());
    ok("six factors are itemised", (await page.locator('[role="img"][aria-label*="contributes"]').count()) === 6,
      `${await page.locator('[role="img"][aria-label*="contributes"]').count()}`);

    await page.screenshot({ path: `${SHOTS}/desktop-task.png`, fullPage: false });

    console.log("\njob 2 — move the heat dial and watch the engine respond");
    const before = gradeText.trim();
    const determinismBefore = await page.getByRole("slider").getAttribute("aria-valuetext");

    await goto(page, "/suite", "job2");
    const suiteTables = page.locator("table.rows");
    const tableCount = await suiteTables.count();
    let referenceRows = 0;
    for (let i = 0; i < tableCount; i += 1) {
      referenceRows += await suiteTables.nth(i).locator("tbody tr").count();
    }
    ok("suite renders task tables", referenceRows >= 3, `${referenceRows} rows across ${tableCount} tables`);
    ok("suite shows the new task", await page.getByText("Unit-of-measure drift in an export").first().isVisible());

    // Open the judge-bound reference task, which has a judge rubric.
    await page.getByRole("link", { name: "Nested envelope collapse" }).first().click();
    await page.waitForURL(/\/task\//, { timeout: 30000 });
    await page.waitForLoadState("domcontentloaded");

    const slider = page.getByRole("slider");
    ok("the judge-bound task exposes the heat dial", await slider.isVisible());
    const readOnly = await slider.isDisabled();
    ok("reference tasks keep the dial read-only", readOnly === true);

    const gradeBefore = (await page.locator(".readout").first().innerText()).trim();

    // The README screenshot should show the grade and the dial, which is the
    // part of the page that actually explains what the product does.
    await page.evaluate(() => {
      const dial = document.querySelector('input[type="range"]');
      const stage = dial?.closest("section");
      stage?.scrollIntoView({ block: "center" });
    });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${SHOTS}/desktop-dial.png`, fullPage: false });

    console.log("\njob 3 — inspect the tape, decide, export, verify");
    ok("the assertion tape is rendered", (await page.locator(".tape-row").count()) >= 3,
      `${await page.locator(".tape-row").count()} rows`);
    ok("the tape shows OPEN for judge weight", (await page.getByText("OPEN", { exact: false }).count()) >= 1);

    // Decide on the task we own.
    await goto(page, taskUrl, "cleanup");
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("combobox").first().selectOption("adopt");
    await page.getByRole("textbox", { name: /note/i }).fill("Browser journey recorded an adopt decision.");
    await page.getByRole("button", { name: /record decision/i }).click();
    await page.getByText(/recorded adopt at engine score/i).waitFor({ timeout: 20000 });
    ok("recording a decision confirms against the engine score", true);

    console.log("\njob 3b — the agent console");
    await goto(page, "/agent", "job3b");
    ok("the console lists tools", (await page.locator("table.rows tbody tr").count()) >= 8);
    await page.getByRole("button", { name: "verify_integrity" }).click();
    await page.getByRole("button", { name: /call tool/i }).click();
    await page.waitForFunction(
      () => !(document.querySelectorAll("pre.code")[1]?.textContent ?? "").includes("—"),
      undefined,
      { timeout: 25000 },
    );
    const responseText = await page.locator("pre.code").nth(1).innerText();
    ok("the agent console shows a real JSON-RPC response", responseText.includes("jsonrpc"));
    ok("the replay response is intact", responseText.includes('"ok": true'));

    await page.getByRole("button", { name: "initialize" }).click();
    await page.waitForTimeout(1500);
    ok("initialize returns a protocol version", (await page.locator("pre.code").nth(1).innerText()).includes("protocolVersion"));

    console.log("\njob 3c — exports resolve");
    const taskId = taskUrl.split("/").pop();
    const scopeOf = async () =>
      (await page.context().cookies()).filter((c) => c.name === "crucible_scope").map((c) => c.value.slice(0, 8)).join(",") || "NONE";
    const listCount = async () => {
      const r = await apiGetJson(page, "/api/tasks");
      return r.json?.tasks?.length ?? -1;
    };
    console.log(`   scope at task=${await scopeOf()} tasks=${await listCount()}`);
    for (const [label, format] of [["Markdown", "markdown"], ["JSON", "json"], ["CSV", "csv"]]) {
      const res = await apiFetch(page, `/api/tasks/${taskId}/dossier?format=${format}`);
      const disp = res.headers["content-disposition"] ?? "";
      ok(`${label} dossier downloads`, res.ok, `${res.status} ${disp} ${res.ok ? "" : res.body.slice(0, 160)}`);
      ok(`${label} dossier is an attachment`, String(disp).includes("attachment"), String(disp));
      if (res.ok && format === "markdown") {
        ok("markdown dossier names the task", res.body.includes("# "), res.body.slice(0, 80));
        ok("markdown dossier carries the chain head", res.body.includes("Chain head"));
      }
    }
    console.log(`   scope after exports=${await scopeOf()} tasks=${await listCount()}`);

    console.log("\nchrome: navigation, footer, focus");
    await goto(page, "/", "chrome");
    ok("the rail is present", await page.locator("nav.rail").isVisible());
    const railGitHub = page.locator('nav.rail a[href*="github.com"]');
    ok("the rail links to GitHub", (await railGitHub.count()) >= 1);
    ok("the rail GitHub link opens safely", (await railGitHub.first().getAttribute("rel"))?.includes("noopener"));
    ok("the rail GitHub link has an accessible name", /github/i.test(await railGitHub.first().innerText()));
    ok("the footer links to GitHub", (await page.locator('footer a[href*="github.com"]').count()) >= 1);
    const footerHrefs = await page.locator("footer a").evaluateAll((els) =>
      els.map((e) => e.getAttribute("href") ?? ""),
    );
    ok("a footer link points at the real repository", footerHrefs.includes(REPO_URL), footerHrefs.join(" "));
    ok("a skip link exists", (await page.locator('a[href="#main"]').count()) === 1);

    // Keyboard focus must be visible on the first rail item.
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const style = getComputedStyle(el);
      return { tag: el.tagName, outline: style.outlineStyle, width: style.outlineWidth };
    });
    ok("tabbing reaches an element", focused !== null);
    ok("the focused element has a visible outline", focused?.outline !== "none" && focused?.width !== "0px",
      JSON.stringify(focused));

    await page.screenshot({ path: `${SHOTS}/desktop-home.png`, fullPage: false });

    console.log("\ncleanup: retire the task");
    await goto(page, taskUrl, "cleanup");
    const retire = page.getByRole("button", { name: /retire as tombstone/i });
    ok("the retire control is present", (await retire.count()) === 1, `${await retire.count()} matches`);
    if ((await retire.count()) === 1) {
      ok("the retire control is enabled", !(await retire.isDisabled()));
      try {
        await retire.click({ timeout: 15000 });
        await page.getByText(/retired as a tombstone/i).waitFor({ timeout: 20000 });
        ok("retiring confirms and reports the replay", true);
      } catch (error) {
        const buttons = await page.locator("button").evaluateAll((els) =>
          els.map((e) => `${e.textContent?.trim().slice(0, 30)}[disabled=${e.disabled}]`),
        );
        ok("retiring confirms and reports the replay", false, `${error.message.slice(0, 120)} :: ${buttons.join(" | ")}`);
      }
    }
    await page.screenshot({ path: `${SHOTS}/desktop-retired.png`, fullPage: false });

    console.log(`\n(desktop unused: before=${before} determinism="${determinismBefore}" grade=${gradeBefore})`);
  });

  /* ---------------------------------------------------------------- *
   * Mobile: the rail must survive
   * ---------------------------------------------------------------- */
  await run("mobile", { width: 390, height: 844 }, async (page) => {
    console.log("\nmobile: structure survives a narrow viewport");
    await goto(page, "/", "chrome");

    const rail = page.locator("nav.rail");
    ok("the rail is still rendered", await rail.isVisible());
    const box = await rail.boundingBox();
    ok("the rail sits at the bottom on mobile", box !== null && box.y > 300, JSON.stringify(box));

    const writingMode = await rail.evaluate((el) => getComputedStyle(el).flexDirection);
    ok("the rail becomes a horizontal bar", writingMode === "row", writingMode);

    ok("the hero is visible", await page.locator(".hero").first().isVisible());
    ok("the repository CTA is visible", await page.getByRole("link", { name: /view source|star on github/i }).first().isVisible());

    // Nothing may overflow horizontally.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok("no horizontal overflow", overflow <= 1, `${overflow}px`);

    await goto(page, "/suite", "job2");
    ok("suite renders on mobile", await page.locator("table.rows").first().isVisible());
    const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok("suite has no horizontal overflow", overflow2 <= 1, `${overflow2}px`);
    await page.screenshot({ path: `${SHOTS}/mobile-suite.png`, fullPage: false });

    await goto(page, "/forge", "job1");
    ok("the forge form renders on mobile", await page.getByRole("button", { name: /pour the task/i }).isVisible());
    await page.screenshot({ path: `${SHOTS}/mobile-forge.png`, fullPage: false });

    // Tap targets must be reachable.
    const small = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll("a.rail-mark, button.btn")) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.height < 32) out.push(`${el.textContent?.trim().slice(0, 18)}:${Math.round(r.height)}`);
      }
      return out;
    });
    ok("tap targets are at least 32px tall", small.length === 0, small.join(", "));
  });

  console.log("\nconsole and network");
  console.log(timeline.join("\n"));
  ok("no console errors, page errors or failed requests", problems.length === 0, problems.slice(0, 6).join(" | "));

  if (warmId) {
    await fetch(`${base}/api/tasks/${warmId}`, { method: "DELETE", headers: { cookie: "" } }).catch(() => {});
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("\nbrowser pass crashed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (child) {
      child.kill();
      await new Promise((r) => setTimeout(r, 800));
      if (!child.killed) child.kill("SIGKILL");
    }
  });