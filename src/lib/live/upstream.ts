/**
 * Bounded upstream fetching.
 *
 * Three properties matter here and each one is enforced rather than hoped for:
 *
 *  - **Time bound.** Every request has an abort deadline. A slow upstream must
 *    not hold a serverless invocation open until the platform kills it.
 *  - **Retry bounded.** Two attempts, not twenty. A retry storm against a
 *    public API is rude and makes our own latency worse.
 *  - **Never fatal.** Callers get `null` on failure and fall back to the sealed
 *    snapshot. A build must never depend on someone else's uptime.
 */

export type UpstreamResult<T> =
  | { ok: true; value: T; bytes: number }
  | { ok: false; reason: string; status?: number };

const DEFAULT_TIMEOUT_MS = 6000;
const DEFAULT_RETRIES = 2;
const USER_AGENT = "crucible/0.1 (+https://github.com/aniruddhaadak80/crucible)";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch text with a deadline and bounded retries.
 *
 * `revalidate` is passed through to the Next.js data cache so a live poll
 * costs one upstream request per window rather than one per visitor.
 */
export async function fetchText(
  url: string,
  options: { timeoutMs?: number; retries?: number; revalidate?: number } = {},
): Promise<UpstreamResult<string>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  let lastReason = "unknown";

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "user-agent": USER_AGENT, accept: "application/json, text/xml, */*" },
        ...(options.revalidate === undefined
          ? { cache: "no-store" as const }
          : { next: { revalidate: options.revalidate } }),
      });

      if (!response.ok) {
        // 4xx will not fix itself on retry. 429 and 5xx might.
        lastReason = `HTTP ${response.status}`;
        if (response.status < 500 && response.status !== 429) {
          return { ok: false, reason: lastReason, status: response.status };
        }
      } else {
        const text = await response.text();
        return { ok: true, value: text, bytes: text.length };
      }
    } catch (error) {
      lastReason =
        error instanceof Error
          ? error.name === "TimeoutError" || error.name === "AbortError"
            ? `timed out after ${timeoutMs}ms`
            : error.message
          : "network failure";
    }

    if (attempt < retries) await wait(250 * (attempt + 1));
  }

  return { ok: false, reason: lastReason };
}

export async function fetchJson<T>(
  url: string,
  options: { timeoutMs?: number; retries?: number; revalidate?: number } = {},
): Promise<UpstreamResult<T>> {
  const result = await fetchText(url, options);
  if (!result.ok) return result;
  try {
    return { ok: true, value: JSON.parse(result.value) as T, bytes: result.bytes };
  } catch {
    return { ok: false, reason: "response was not valid JSON" };
  }
}

/** Upstream hosts this app is allowed to contact. Anything else is a bug. */
export const ALLOWED_HOSTS = ["huggingface.co", "export.arxiv.org", "arxiv.org"] as const;

export function isAllowedUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    return (ALLOWED_HOSTS as readonly string[]).includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}