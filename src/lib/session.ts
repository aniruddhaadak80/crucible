/**
 * Anonymous session ownership.
 *
 * There are no accounts. A visitor's work belongs to an opaque scope id kept
 * in an HTTP-only cookie that the browser script cannot read. That id is the
 * only thing standing between one visitor and another's records, so it is
 * generated with a CSPRNG, never derived from anything guessable, and it is
 * set in `proxy.ts` so it exists before the first render.
 *
 * The cookie is intentionally readable by nothing on the client. Sharing a
 * task therefore goes through an explicit, revocable dossier token rather than
 * by handing over the session.
 */

import { cookies } from "next/headers";

export const SCOPE_COOKIE = "crucible_scope";

const YEAR_SECONDS = 60 * 60 * 24 * 365;

/** 128 bits of entropy, hex encoded. */
export function newScope(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function scopeCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: YEAR_SECONDS,
  };
}

/** Read the caller's scope. Never creates one: creation belongs to proxy.ts. */
export async function getScope(): Promise<string> {
  const store = await cookies();
  const value = store.get(SCOPE_COOKIE)?.value;
  if (value && /^[0-9a-f]{32}$/.test(value)) return value;
  // The proxy should have set this. Falling back to a per-request scope keeps
  // a direct API call working; it simply owns nothing that already exists.
  return newScope();
}

/** Actor label written into the audit chain, so a reader can tell UI from agent. */
export async function getActor(source: string): Promise<string> {
  return `${source}:${(await getScope()).slice(0, 8)}`;
}