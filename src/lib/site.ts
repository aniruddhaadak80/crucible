/**
 * Single source of truth for product identity, navigation and outbound URLs.
 *
 * Nothing else in the codebase is allowed to hard-code the repository or the
 * production host. The shared rail, the mobile bar, the landing CTA, the
 * footer, the OpenGraph metadata, the sitemap and public/mcp.json all read
 * from here so a deploy alias change is a one-line edit.
 */

function trimSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/** Repository slug. Used to derive the GitHub URL and the Vercel project name. */
export const REPO_SLUG = "crucible";

export const GITHUB_OWNER = "aniruddhaadak80";

export const GITHUB_URL = `https://github.com/${GITHUB_OWNER}/${REPO_SLUG}`;

export const GITHUB_API_TREE = `${GITHUB_URL}/tree/main`;

/**
 * Production host. Set NEXT_PUBLIC_SITE_URL on the deployment.
 *
 * The fallback is the real Vercel production alias, not `crucible.vercel.app`:
 * that hostname is already taken by an unrelated project and 307-redirects to
 * someone else's site, so defaulting to it would have pointed every canonical
 * URL, export and agent manifest at a stranger's product.
 */
export const LIVE_URL = trimSlash(
  process.env.NEXT_PUBLIC_SITE_URL ??
    "https://crucible-cwhs1gr1j-aniruddha-adaks-projects.vercel.app",
);

export const SITE = {
  name: "Crucible",
  /** One line, used verbatim in metadata, the README title and the footer. */
  outcome: "Turn a real model failure into a deterministic, publishable benchmark task.",
  description:
    "Crucible is a benchmark forge. Paste a model failure, forge it into a scored evaluation task, re-run the deterministic grader across recorded transcripts, and publish a suite anyone can reproduce.",
  /** Longer form for the landing column. */
  lede:
    "A benchmark that cannot be re-run is a rumour. Crucible grades a task with exact assertions instead of a vibes-based judge, measures whether that task can actually tell two models apart, and files every edit into a hash chain you can replay.",
  version: "0.1.0",
  engine: "crucible-grade-v1.0.0",
  grader: "crucible-grader-v1.0.0",
  mcpProtocol: "2025-06-18",
  license: "MIT",
  repoUrl: GITHUB_URL,
  liveUrl: LIVE_URL,
  apiBase: `${LIVE_URL}/api`,
  agentEndpoint: `${LIVE_URL}/api/mcp`,
} as const;

export type NavItem = {
  href: string;
  label: string;
  /** Rotated-rail caption. Short, uppercase, no punctuation. */
  mark: string;
  blurb: string;
};

/**
 * The rail is a single ordered list. Order is the product's process order:
 * charge the metal, shape it, tap it, read the ingot.
 */
export const NAV: readonly NavItem[] = [
  {
    href: "/suite",
    label: "Suite",
    mark: "SUITE",
    blurb: "Every task on the floor, with its grade and its seal.",
  },
  {
    href: "/forge",
    label: "Forge",
    mark: "FORGE",
    blurb: "Charge a failure, shape the assertions, pour the task.",
  },
  {
    href: "/lineup",
    label: "Lineup",
    mark: "LINEUP",
    blurb: "Recorded transcripts re-scored, plus live Hub facts per model.",
  },
  {
    href: "/agent",
    label: "Agent",
    mark: "AGENT",
    blurb: "JSON-RPC console over the same service layer the UI uses.",
  },
  {
    href: "/dossier",
    label: "Dossier",
    mark: "DOSSIER",
    blurb: "Export the suite as Markdown, JSON or CSV with the seal chain.",
  },
  {
    href: "/chain",
    label: "Chain",
    mark: "CHAIN",
    blurb: "Replay every append and find the first broken link.",
  },
  {
    href: "/settings",
    label: "Settings",
    mark: "SETUP",
    blurb: "Store health, engine weights, feed status and session scope.",
  },
];

export const FOOTER_LINKS = [
  { href: "/suite", label: "Suite" },
  { href: "/forge", label: "Forge" },
  { href: "/lineup", label: "Lineup" },
  { href: "/agent", label: "Agent console" },
  { href: "/dossier", label: "Dossier export" },
  { href: "/chain", label: "Integrity replay" },
  { href: "/settings", label: "Settings" },
  { href: "/api/health", label: "Health" },
  { href: "/mcp.json", label: "mcp.json" },
] as const;

export function absoluteUrl(path = "/"): string {
  return `${LIVE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Resolve the public origin for a specific request.
 *
 * A manifest that advertises an absolute URL has to be right, and baking it at
 * build time makes it wrong the moment an alias changes — the first version of
 * /mcp.json pointed at `crucible.vercel.app`, which belongs to an unrelated
 * project. Deriving it from the request that is being served means the manifest
 * can only ever name the host the caller actually reached.
 */
export function originFor(request: Request): string {
  const url = new URL(request.url);
  // A forwarded host is the public one behind the platform proxy.
  const forwarded = request.headers.get("x-forwarded-host");
  const host = forwarded?.split(",")[0]?.trim() || url.host;
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  return `${proto}://${host}`;
}