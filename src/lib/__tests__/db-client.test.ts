import test from "node:test";
import assert from "node:assert/strict";

import { isAcceptableProductionUrl, isNeonHost } from "../db/client.ts";

/**
 * Driver selection decides whether a hosted DATABASE_URL can be reached at all.
 *
 * The Neon serverless client speaks HTTP, so it only works against Neon's own
 * edge. Handed any other Postgres -- a container, a VPS, another provider --
 * it issues an HTTPS request to a TCP port and dies with an opaque
 * `TypeError: fetch failed`. That is what kept the `journey` CI job red against
 * its own `postgres:16-alpine` service: the job pointed DATABASE_URL at a real
 * Postgres, and the only hosted adapter available could not speak to it.
 */
test("Neon hostnames use the HTTP driver", () => {
  assert.equal(isNeonHost("postgresql://u:p@ep-cool-name-123456.us-east-2.aws.neon.tech/db"), true);
  assert.equal(isNeonHost("postgresql://u:p@ep-foo.us-west-2.aws.neon.build/db?sslmode=require"), true);
});

test("any other Postgres uses the TCP driver", () => {
  assert.equal(isNeonHost("postgresql://crucible:crucible@localhost:5432/crucible"), false);
  assert.equal(isNeonHost("postgresql://u:p@db.example.com:5432/app"), false);
  assert.equal(isNeonHost("postgresql://u:p@xyz.supabase.co:5432/postgres"), false);
});

test("a lookalike host is not mistaken for Neon", () => {
  // Ends with the suffix only as a substring of a longer label.
  assert.equal(isNeonHost("postgresql://u:p@evil-neon.tech.example.com/db"), false);
  assert.equal(isNeonHost("postgresql://u:p@neon.tech.evil.com/db"), false);
});

test("an unparseable URL does not throw", () => {
  assert.equal(isNeonHost("not a url"), false);
  assert.equal(isNeonHost(""), false);
});

/**
 * The production guard is a separate concern from driver selection: it decides
 * whether a URL is a durable hosted store at all. A local or ephemeral target is
 * rejected so a half-configured deploy fails loudly instead of writing rows
 * that vanish on redeploy.
 */
test("production rejects ephemeral targets", () => {
  assert.equal(isAcceptableProductionUrl("postgresql://u:p@localhost:5432/db"), false);
  assert.equal(isAcceptableProductionUrl("postgresql://u:p@127.0.0.1:5432/db"), false);
  assert.equal(isAcceptableProductionUrl("postgresql://u:p@0.0.0.0:5432/db"), false);
  assert.equal(isAcceptableProductionUrl("mysql://u:p@db.example.com/db"), false);
});

test("production accepts a real hosted store", () => {
  assert.equal(
    isAcceptableProductionUrl("postgresql://u:p@ep-x.us-east-2.aws.neon.tech/db?sslmode=require"),
    true,
  );
  assert.equal(isAcceptableProductionUrl("postgresql://u:p@db.example.com:5432/app"), true);
});