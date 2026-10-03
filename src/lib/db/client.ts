/**
 * Database access.
 *
 * One typed surface, two adapters:
 *
 *  - `neon-postgres`  production. A real hosted Postgres that survives
 *                     redeploys and cold starts. Requires DATABASE_URL.
 *  - `pglite`         local development and the test suite. A real Postgres
 *                     compiled to WASM, stored under ./.crucible. Zero
 *                     environment variables, no install step.
 *
 * Production can never fall back to PGlite. A serverless filesystem is not a
 * database, and silently selecting one would make every visitor's data
 * evaporate on redeploy, so this module throws instead.
 */

import { neon } from "@neondatabase/serverless";
import { SCHEMA_SQL } from "./schema.ts";

export type DbKind = "neon-postgres" | "pglite";

export interface QueryResult<T> {
  rows: T[];
}

export interface Db {
  kind: DbKind;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export class ProductionStoreMissingError extends Error {
  constructor() {
    super(
      "DATABASE_URL is not set. Crucible refuses to start on the embedded PGlite adapter in production because a serverless filesystem is not a durable store.",
    );
    this.name = "ProductionStoreMissingError";
  }
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * A hosted store must be a real connection string. An ephemeral or local
 * target is rejected so a half-configured deploy fails loudly at first request
 * instead of writing rows that vanish.
 */
export function isAcceptableProductionUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return false;
    const host = parsed.hostname.toLowerCase();
    const ephemeral =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "[::1]" ||
      host === "::1";
    return !ephemeral;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Neon
 * ------------------------------------------------------------------ */

function createNeon(url: string): Db {
  const sql = neon(url);
  return {
    kind: "neon-postgres",
    async query<T>(text: string, params: unknown[] = []) {
      const result = (await sql.query(text, params as never[])) as unknown;
      // The HTTP driver has resolved to a bare rows array in some versions and
      // to a full result object in others. Accept both rather than betting the
      // deployment on a driver internal.
      const rows = Array.isArray(result)
        ? (result as T[])
        : ((result as { rows?: T[] } | null)?.rows ?? []);
      return { rows };
    },
  };
}

/* ------------------------------------------------------------------ *
 * PGlite
 * ------------------------------------------------------------------ */

let pglitePromise: Promise<Db> | null = null;

async function createPglite(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  // PGlite calls mkdirSync without `recursive`, so the parent has to exist or
  // the very first local run dies with a bare ENOENT.
  const { mkdirSync } = await import("node:fs");
  const dataDir = process.env.CRUCIBLE_PGLITE_DIR ?? ".crucible/pgdata";
  mkdirSync(dataDir, { recursive: true });
  const client = await PGlite.create({ dataDir });
  return {
    kind: "pglite",
    async query<T>(text: string, params: unknown[] = []) {
      const result = await client.query<T>(text, params as never[]);
      return { rows: result.rows ?? [] };
    },
  };
}

/* ------------------------------------------------------------------ *
 * Resolution
 * ------------------------------------------------------------------ */

type GlobalCache = {
  __crucibleDb?: Promise<Db>;
  __crucibleReady?: Promise<void>;
};

const cache = globalThis as unknown as GlobalCache;

/**
 * The one way to run the embedded adapter in a production-mode process.
 *
 * Deliberately a loud, explicit opt-in rather than a silent fallback. It exists
 * so `next build && next start` can be verified locally against the real
 * production artifact, which is the only way to prove hydration and streaming
 * behaviour rather than a dev approximation. It is never set on a deployment:
 * DATABASE_URL is configured there, and if it is missing the build fails loudly
 * instead of quietly writing rows that vanish.
 */
function embeddedAllowedInProduction(): boolean {
  return process.env.CRUCIBLE_ALLOW_EMBEDDED_STORE === "1";
}

/**
 * The connection is cached on globalThis so Next's dev HMR does not open a new
 * PGlite instance on every edit, and so a single serverless container reuses
 * one Neon client per isolate.
 */
export function getDb(): Promise<Db> {
  if (cache.__crucibleDb) return cache.__crucibleDb;

  const url = process.env.DATABASE_URL?.trim();

  if (url) {
    if (isProduction() && !isAcceptableProductionUrl(url)) {
      cache.__crucibleDb = Promise.reject(
        new Error(
          "DATABASE_URL does not point at a hosted Postgres. Set a neon/Supabase connection string for production deployments.",
        ),
      );
      return cache.__crucibleDb;
    }
    cache.__crucibleDb = Promise.resolve(createNeon(url));
    return cache.__crucibleDb;
  }

  if (isProduction() && !embeddedAllowedInProduction()) {
    cache.__crucibleDb = Promise.reject(new ProductionStoreMissingError());
    return cache.__crucibleDb;
  }

  pglitePromise = pglitePromise ?? createPglite();
  cache.__crucibleDb = pglitePromise;
  return pglitePromise;
}

/**
 * Split a DDL script into single statements.
 *
 * The Neon HTTP driver sends a script as one round trip, but PGlite's `query`
 * accepts exactly one statement per call. Running the statements in order
 * keeps a single schema definition working on both adapters.
 */
export function splitStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Resolve the adapter and guarantee the schema exists. Safe to call on every
 * request: `CREATE ... IF NOT EXISTS` is a no-op once applied.
 */
export async function ready(): Promise<Db> {
  if (cache.__crucibleReady) {
    await cache.__crucibleReady;
    return getDb();
  }
  cache.__crucibleReady = (async () => {
    const db = await getDb();
    for (const statement of splitStatements(SCHEMA_SQL)) {
      await db.query(statement);
    }
  })();
  await cache.__crucibleReady;
  return getDb();
}

/**
 * Health probe used by /api/health. It must exercise the *production* path,
 * not return a static object, so this performs a real round trip.
 */
export async function ping(): Promise<{ ok: boolean; kind: DbKind; detail: string }> {
  try {
    const db = await ready();
    const result = await db.query<{ ok: number }>("SELECT 1 AS ok");
    const value = Number(result.rows[0]?.ok ?? 0);
    return {
      ok: value === 1,
      kind: db.kind,
      detail: `SELECT 1 returned ${value}`,
    };
  } catch (error) {
    return {
      ok: false,
      kind: "neon-postgres",
      detail: error instanceof Error ? error.message : "unknown database failure",
    };
  }
}

/** Reported to the settings page so an operator can see which adapter is live. */
export function describeAdapter(): {
  kind: DbKind;
  production: boolean;
  durable: boolean;
  note: string;
} {
  const url = process.env.DATABASE_URL?.trim();
  const production = isProduction();
  if (url && (production ? isAcceptableProductionUrl(url) : true)) {
    return {
      kind: "neon-postgres",
      production,
      durable: true,
      note: "Hosted Postgres. Rows survive redeploys and cold starts.",
    };
  }
  return {
    kind: "pglite",
    production,
    durable: false,
    note:
      production && embeddedAllowedInProduction()
        ? "Embedded Postgres forced on in production mode by CRUCIBLE_ALLOW_EMBEDDED_STORE=1. This is for local verification of a production build only; a real deployment sets DATABASE_URL."
        : "Embedded Postgres under ./.crucible for local development. Set DATABASE_URL to a hosted store before deploying.",
  };
}