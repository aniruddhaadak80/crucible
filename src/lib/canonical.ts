/**
 * Canonical JSON and the SHA-384 seal chain.
 *
 * A hash chain is only worth anything if every participant agrees on the bytes
 * being hashed. `JSON.stringify` does not: object key order follows insertion
 * order, `undefined` vanishes silently, and `NaN` becomes `null` by accident.
 *
 * This module is deliberately dependency-free so `node --test` can load it
 * without an import map, and so the same code runs in a route handler, in a
 * worker and in a test.
 */

/** Per-entity chain origin. Chaining to a constant genesis makes the first
 *  seal a function of the first event alone. */
export const GENESIS_SEAL = "crucible/v1/genesis";

export const SEAL_ALGORITHM = "SHA-384";

export type CanonicaliseOptions = {
  /** Keys dropped from every object at any depth. Used to keep volatile
   *  server fields (request ids, durations) out of the hashed payload. */
  omit?: readonly string[];
};

function canonicalise(value: unknown, omit: ReadonlySet<string>): unknown {
  if (value === null) return null;

  const t = typeof value;

  if (t === "number") {
    if (!Number.isFinite(value as number)) {
      throw new TypeError(`canonicalJson: non-finite number at ${String(value)}`);
    }
    // -0 and 0 must hash identically.
    return (value as number) === 0 ? 0 : value;
  }

  if (t === "string" || t === "boolean") return value;
  if (t === "bigint") return (value as bigint).toString();
  if (t === "undefined" || t === "function" || t === "symbol") return undefined;

  if (Array.isArray(value)) {
    // Array order is semantic. A null marks an unsupported member so the shape
    // of the array survives; dropping it would change its length.
    return value.map((item) => {
      const c = canonicalise(item, omit);
      return c === undefined ? null : c;
    });
  }

  if (value instanceof Date) return value.toISOString();

  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  // Sort by UTF-16 code unit so the order does not depend on host locale.
  for (const key of Object.keys(source).sort()) {
    if (omit.has(key)) continue;
    const c = canonicalise(source[key], omit);
    if (c === undefined) continue;
    out[key] = c;
  }
  return out;
}

/**
 * Deterministic JSON text. Two structurally equal values always produce
 * identical strings, regardless of key insertion order.
 */
export function canonicalJson(value: unknown, options: CanonicaliseOptions = {}): string {
  const omit = new Set(options.omit ?? []);
  const c = canonicalise(value, omit);
  return JSON.stringify(c === undefined ? null : c);
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function bytesToUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * seal_n = SHA-384( UTF-8(prevSeal) || canonicalJson(event_n) )
 *
 * The previous seal is prefixed as raw bytes rather than being concatenated as
 * a string, which removes any theoretical ambiguity about where the previous
 * hash ends and the payload begins.
 */
export async function seal(
  prevSeal: string,
  event: unknown,
  options: CanonicaliseOptions = {},
): Promise<string> {
  const payload = canonicalJson(event, options);
  const prev = bytesToUtf8(prevSeal);
  const body = bytesToUtf8(payload);
  const joined = new Uint8Array(prev.length + body.length);
  joined.set(prev, 0);
  joined.set(body, prev.length);

  const digest = await globalThis.crypto.subtle.digest("SHA-384", joined);
  return toHex(digest);
}

export type ChainLink = { prevSeal: string; event: unknown };

/**
 * Walk a chain and recompute every seal. Returns the first index whose stored
 * seal does not match, or null when the chain is intact.
 *
 * The `seal` field is excluded from the hashed payload: a link cannot be the
 * input to its own digest.
 */
export async function verifyChain(
  links: readonly ChainLink[],
  options: CanonicaliseOptions = {},
): Promise<{ ok: boolean; brokenAtIndex: number | null; reason: string | null }> {
  const omit = new Set([...(options.omit ?? []), "seal"]);
  let prev = GENESIS_SEAL;
  for (let i = 0; i < links.length; i += 1) {
    const link = links[i];
    if (link.prevSeal !== prev) {
      return {
        ok: false,
        brokenAtIndex: i,
        reason: `link ${i} declares prevSeal ${short(link.prevSeal)} but the chain head was ${short(prev)}`,
      };
    }
    const stored = (link.event as { seal?: unknown } | null)?.seal;
    if (typeof stored !== "string") {
      return { ok: false, brokenAtIndex: i, reason: `link ${i} carries no seal field` };
    }
    const computed = await seal(prev, link.event, { ...options, omit: [...omit] });
    if (computed !== stored) {
      return {
        ok: false,
        brokenAtIndex: i,
        reason: `link ${i} seal ${short(stored)} does not match recomputed ${short(computed)}`,
      };
    }
    prev = stored;
  }
  return { ok: true, brokenAtIndex: null, reason: null };
}

function short(value: string): string {
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}