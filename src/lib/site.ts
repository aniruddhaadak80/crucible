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
 * Production host. Set NEXT_PUBLIC_SITE_URL on the deployment; the fallback is
 * only used for local development and for the first deploy before the real
 * alias is known.
 */
export const LIVE_URL = trimSlash(
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://crucible.vercel.app",
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