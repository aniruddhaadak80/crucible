## What this changes

<!-- One paragraph. What is different after this is merged. -->

## Why

<!-- Link the issue if there is one. -->

## Evidence

<!-- Required. This project treats claims as needing proof. -->

- [ ] `npm run gate` passes
- [ ] New or updated tests, and what they cover
- [ ] If grading, the audit chain or canonical JSON changed: known-vector tests updated
- [ ] If the exported Python grader changed: `npm run verify:bundle` passes and the
      TypeScript/Python scores still agree transcript by transcript

## Honesty check

<!-- The properties this project must not lose. -->

- [ ] No undecided judge weight is reported as a pass
- [ ] No fallback data is presented as live
- [ ] No score is computed anywhere except `gradeTask`
- [ ] No new control ends in `TODO`, a `console.log`, or a fake delay
- [ ] Cross-scope reads still return `404`

## Screenshots

<!-- For anything visual. Mobile too. -->