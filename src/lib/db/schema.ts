/**
 * Schema, expressed as SQL text rather than a .sql file so the bundler never
 * has to resolve a raw-loader import. Every statement is idempotent, so
 * `ensureSchema` is safe to call on every cold start.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tasks (
  id              text PRIMARY KEY,
  slug            text NOT NULL,
  name            text NOT NULL,
  failure_mode    text NOT NULL,
  prompt          text NOT NULL,
  sealed_fixtures jsonb NOT NULL DEFAULT '[]'::jsonb,
  assertions      jsonb NOT NULL DEFAULT '[]'::jsonb,
  transcripts     jsonb NOT NULL DEFAULT '[]'::jsonb,
  seed            integer,
  target_model    text,
  target_temp     double precision,
  target_revision text,
  token_budget    integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'forging',
  decision        jsonb,
  scope           text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  seal            text NOT NULL,
  CONSTRAINT tasks_status_check CHECK (status IN ('forging','poured','retired'))
);

-- The only listing query: one scope, newest first, excluding tombstones.
CREATE INDEX IF NOT EXISTS tasks_scope_live_idx
  ON tasks (scope, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS tasks_scope_all_idx ON tasks (scope, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  task_id   text NOT NULL,
  seq       integer NOT NULL,
  action    text NOT NULL,
  at        timestamptz NOT NULL DEFAULT now(),
  scope     text NOT NULL,
  detail    text NOT NULL,
  actor     text NOT NULL,
  score     double precision,
  snapshot  jsonb NOT NULL,
  prev_seal text NOT NULL,
  seal      text NOT NULL,
  PRIMARY KEY (task_id, seq),
  CONSTRAINT audit_action_check CHECK (action IN ('create','update','grade','decision','delete','retire'))
);

CREATE INDEX IF NOT EXISTS audit_scope_idx ON audit_events (scope, at DESC);

-- Agent mutation replay: the same idempotency key must never mutate twice.
CREATE TABLE IF NOT EXISTS idempotency (
  key        text PRIMARY KEY,
  scope      text NOT NULL,
  tool       text NOT NULL,
  result     jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idempotency_scope_idx ON idempotency (scope, created_at DESC);

CREATE TABLE IF NOT EXISTS scope_settings (
  scope      text PRIMARY KEY,
  body       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;