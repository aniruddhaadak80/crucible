# Security Policy

## Reporting

Please report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/aniruddhaadak80/crucible/security/advisories/new)
rather than opening a public issue. Include the route or tool, the request you
made, and what you observed.

## Threat model

Crucible has **no accounts and no user-supplied credentials**. That shapes the
whole surface:

| Asset | Owned by | Reachable by |
| --- | --- | --- |
| Benchmark tasks, transcripts, decisions | An anonymous scope | Only requests carrying that scope cookie |
| Settings | An anonymous scope | Only that scope |
| The engine, the grader, the audit chain | The repository | Public, and intended to be |
| `DATABASE_URL` | The deployment | Server-side only; never in a client bundle |

An anonymous scope is a 128-bit random id in an HTTP-only cookie. Possessing it
is possessing the data, which is the deliberate trade-off for having no sign-up.
Losing the cookie loses access — there is no recovery path, by design.

### What is deliberately not defended

- **A leaked scope cookie grants full access to that scope's data.** There is no
  second factor. Clearing cookies is the only way to abandon a scope.
- **An audit chain detects rewriting, it does not prevent it.** Anybody with write
  access to the database can recompute an entire chain from genesis. Detecting
  *that* requires the chain head to be published somewhere append-only and
  independent, which is on the roadmap and is not implemented today.
- **A tombstone is still a row.** Retirement removes a task from listings but
  retains it so the chain replays. If you need erasure rather than retirement,
  say so and it will be handled as a deliberate exception.

### Abuse controls, and their honest limits

Anonymous writes are rate limited per scope: forging 20/minute, revising
40/minute, grading 60/minute, retiring 20/minute.

**These limits are per-container and reset when a serverless instance is
recycled.** On Vercel that means they are a floor against a single runaway
client, not a security boundary. A determined attacker rotating source IPs will
not be stopped by them.

If you deploy this somewhere that matters, put a hosted rate limiter in front of
it — Cloudflare, Vercel Firewall, Upstash, or an equivalent — and treat the
in-process limits as a courtesy.

### What is enforced

- Every write is validated and bounded before it reaches the database: string
  lengths, collection sizes, enum membership, numeric ranges.
- Regex patterns are compiled at validation time and capped at 500 characters, so
  a stored pattern cannot be used to hang the grader.
- JSON paths are restricted to a safe character class.
- SQL is parameterised; identifiers are never interpolated from user input.
- Reads are filtered by scope in the repository layer. There is no code path that
  returns another scope's row, and a cross-scope read is `404` rather than `403`
  so the API cannot be used to probe for existence.
- Upstream fetches are allowlisted to two hosts and time-bounded; model ids are
  constrained to `owner/name` so a stored value cannot redirect a request.
- Error responses never include stack traces or environment values.

## Secrets

The core product requires no third-party API key. The only production secret is
`DATABASE_URL`, read server-side only. `.env.example` documents every variable
without values, and `.env*` is git-ignored apart from that file.