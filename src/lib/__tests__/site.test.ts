import test from "node:test";
import assert from "node:assert/strict";

import { FOOTER_LINKS, GITHUB_URL, NAV, REPO_SLUG, SITE } from "../site.ts";

/**
 * Every user route this app actually ships.
 *
 * Kept as a literal rather than derived from the filesystem on purpose: if it
 * were derived, renaming a page and forgetting the nav would still pass. The
 * browser pass caught exactly that bug once already — `/leaderboard` had been
 * renamed to `/lineup` while the rail still pointed at the old path.
 */
const ROUTES = [
  "/",
  "/suite",
  "/forge",
  "/lineup",
  "/agent",
  "/dossier",
  "/chain",
  "/settings",
  "/task/[id]",
];

/** The footer additionally points at two machine-readable endpoints. */
const FOOTER_EXTRA = ["/api/health", "/mcp.json"];

test("every navigation entry points at a route that exists", () => {
  for (const item of NAV) {
    assert.ok(
      ROUTES.includes(item.href),
      `nav item ${item.label} points at ${item.href}, which is not a shipped route`,
    );
  }
});

test("every footer link points at a route that exists", () => {
  for (const link of FOOTER_LINKS) {
    assert.ok(
      [...ROUTES, ...FOOTER_EXTRA].includes(link.href),
      `footer link ${link.label} points at ${link.href}, which is not a shipped route`,
    );
  }
});

test("navigation covers every functional route", () => {
  const hrefs = new Set(NAV.map((n) => n.href));
  for (const route of ["/suite", "/forge", "/lineup", "/agent", "/dossier", "/chain", "/settings"]) {
    assert.ok(hrefs.has(route), `${route} is not reachable from the navigation`);
  }
});

test("the nav has no duplicate hrefs", () => {
  const hrefs = NAV.map((n) => n.href);
  assert.equal(new Set(hrefs).size, hrefs.length);
});

test("every nav entry has a label, a rotated mark and a blurb", () => {
  for (const item of NAV) {
    assert.ok(item.label.length > 0, `${item.href} label`);
    assert.match(item.mark, /^[A-Z]+$/, `${item.href} mark must be uppercase for the rotated rail`);
    assert.ok(item.blurb.length > 10, `${item.href} blurb`);
  }
});

test("the site config carries the real repository and no stray URLs", () => {
  assert.equal(SITE.repoUrl, GITHUB_URL);
  assert.match(GITHUB_URL, new RegExp(`^https://github\\.com/aniruddhaadak80/${REPO_SLUG}$`));
  assert.ok(SITE.liveUrl.startsWith("https://"), "the live URL must be https");
  assert.equal(SITE.liveUrl.endsWith("/"), false, "the live URL must not carry a trailing slash");
  assert.equal(SITE.apiBase, `${SITE.liveUrl}/api`);
  assert.equal(SITE.agentEndpoint, `${SITE.liveUrl}/api/mcp`);
});

test("the product identity is stated once and consistently", () => {
  assert.ok(SITE.name.length > 0);
  assert.ok(SITE.outcome.length > 20);
  assert.ok(SITE.description.length > 40);
  assert.match(SITE.engine, /^crucible-grade-v/);
  assert.match(SITE.grader, /^crucible-grader-v/);
  assert.equal(SITE.license, "MIT");
});