# Contributing

Thanks for looking. This project is small and has one rule worth stating early:
**claims require evidence.** A change is not done when it compiles, it is done
when something checks that it does what it claims.

## Getting set up

```bash
git clone https://github.com/aniruddhaadak80/crucible.git
cd crucible
npm ci
npm run dev
```

Node 22+. No API keys and no database installation: local development uses an
embedded Postgres and the public Hugging Face and arXiv APIs.

## Before you open a pull request

```bash
npm run gate
```

That runs typecheck, lint, the unit tests, the production build, the store checks
and the bundle parity check. If you touched grading, the audit chain, canonical
JSON, or the exported Python grader, those checks are the ones that matter and
they are the ones most likely to catch you.

## Where things live

| If you are changing | Look at |
| --- | --- |
| A score, a factor, an assertion | `src/lib/grade.ts` |
| The hash chain or canonical JSON | `src/lib/canonical.ts` |
| Normalised types or external shapes | `src/lib/types.ts` |
| Queries, schema, ownership | `src/lib/db/` |
| Live data and fallbacks | `src/lib/live/` |
| Anything the UI, REST and agent share | `src/lib/service.ts` |
| Agent tools | `src/lib/mcp.ts` |
| Visual identity | `src/app/globals.css` |

`src/lib/grade.ts` and `src/lib/canonical.ts` are deliberately dependency-free.
That is what lets `node --test` load them directly and what keeps grading
testable without a database.

## Things that are easy to get wrong

**Never recompute a score outside `gradeTask`.** The task page, the REST route,
the agent tool and the dossier export must all show the same number. If you add
a display that needs a score, call the engine.

**Never report an undecided judge as a pass.** If an assertion needs a language
model in the loop, it is `passed: null` and the verdict is `degraded`. This is
the central honesty property of the product. Do not soften it for a nicer demo.

**Never present fallback data as live.** Every feed carries `status`, `fetchedAt`
and a reason. A sealed snapshot is always rendered with its capture date.

**Never add a dead control.** Every button, form action, refresh and export must
call real application logic and show a truthful loading, success, empty and
failure state. `npm run journey` and `npm run browser` will catch handlers that
do not fire.

**Adding a route means adding it to `src/lib/site.ts`.** Navigation, the footer
and the agent manifest read from there, and a test asserts every entry points at
a route that exists. This is not bureaucracy: the nav once pointed at a
`/leaderboard` that had been renamed to `/lineup`, and typecheck could not see
it.

## Adding an assertion kind

1. Add it to `ASSERTION_KINDS` in `src/lib/types.ts`.
2. Add a specificity value in `ASSERTION_SPECIFICITY`, and decide honestly how
   precise it is. A loose assertion that claims high specificity is a bug.
3. Handle it in `evaluateAssertion` in `src/lib/grade.ts`. It must never throw:
   malformed input is a failed assertion with evidence, not an exception.
4. Validate it in `src/lib/validate.ts`, including a length cap if it accepts a
   pattern.
5. Add cases to `src/lib/__tests__/grade.test.ts` for normal, boundary, empty,
   malformed and repeat-determinism behaviour.
6. Mirror it in the Python grader in `src/lib/kaggle.ts`, then run
   `npm run verify:bundle`, which diffs the Python scores against the TypeScript
   engine transcript by transcript.

## Style

Match the file you are in. Comments should explain **why**, especially where the
obvious approach is wrong — the production-store guard, the canonical JSON rules
and the `ast.parse` gotcha in the Python generator all exist because the naive
version failed.

Do not add lint suppressions. Fix the code.

## Reporting security issues

Privately, via
[GitHub Security Advisories](https://github.com/aniruddhaadak80/crucible/security/advisories/new).
Not a public issue. See [SECURITY.md](SECURITY.md) for the threat model and for
which limits are genuinely enforced and which are best-effort.

## Licence

MIT. See [LICENSE](LICENSE).