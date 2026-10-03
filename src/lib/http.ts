/**
 * HTTP conventions.
 *
 * Every failure in this product leaves through `toErrorResponse`, so a client
 * never has to guess whether a 500 body contains a stack trace, an env var or
 * a sentence a human wrote.
 */

import { NextResponse } from "next/server";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "./db/repository.ts";
import { ProductionStoreMissingError } from "./db/client.ts";
import type { ApiErrorBody } from "./types.ts";

export type ErrorCode =
  | "bad_request"
  | "validation_error"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "store_unavailable"
  | "method_not_allowed"
  | "internal_error";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_error: 422,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  store_unavailable: 503,
  method_not_allowed: 405,
  internal_error: 500,
};

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function jsonError(
  code: ErrorCode,
  message: string,
  details?: { path: string; message: string }[],
): NextResponse {
  const body: ApiErrorBody = { error: { code, message } };
  if (details && details.length > 0) body.error.details = details;
  return NextResponse.json(body, { status: STATUS[code] });
}

/** Map a thrown value onto a stable envelope. Never leaks a stack trace. */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof ValidationError) {
    return jsonError("validation_error", error.message, error.details);
  }
  if (error instanceof NotFoundError) {
    return jsonError("not_found", error.message);
  }
  if (error instanceof ConflictError) {
    return jsonError("conflict", error.message);
  }
  if (error instanceof ProductionStoreMissingError) {
    return jsonError("store_unavailable", error.message);
  }
  // Message is deliberately generic. The real cause is logged server-side only.
  console.error("[crucible] unhandled route failure", error);
  return jsonError("internal_error", "The request could not be completed.");
}

/**
 * Wrap a handler so no throw escapes as a raw 500.
 *
 * Typed against `Response` rather than `NextResponse` because download routes
 * legitimately return a plain `Response` with a Content-Disposition header.
 */
export async function guard(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    return toErrorResponse(error);
  }
}

const MAX_BODY_BYTES = 256 * 1024;

export async function readJsonBody(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > MAX_BODY_BYTES) {
    throw new ValidationError([
      { path: "body", message: `Request body exceeds ${MAX_BODY_BYTES} bytes.` },
    ]);
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new ValidationError([
      { path: "body", message: `Request body exceeds ${MAX_BODY_BYTES} bytes.` },
    ]);
  }
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ValidationError([{ path: "body", message: "Body is not valid JSON." }]);
  }
}

export function queryString(request: Request, key: string): string | null {
  const value = new URL(request.url).searchParams.get(key);
  return value === null || value.trim() === "" ? null : value.trim();
}

/**
 * Best-effort anonymous write throttle.
 *
 * Serverless isolates are ephemeral, so this is per-container and resets on a
 * cold start. It is a floor against a single runaway client, not a security
 * boundary. A production deployment that cares should put a hosted rate limiter
 * in front of these routes; see SECURITY.md.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfter: number; remaining: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return { ok: true, retryAfter: 0, remaining: limit - 1 };
  }
  bucket.count += 1;
  const ok = bucket.count <= limit;
  return {
    ok,
    retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    remaining: Math.max(0, limit - bucket.count),
  };
}