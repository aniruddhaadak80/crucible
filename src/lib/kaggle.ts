/**
 * Kaggle Benchmarks bundle generator.
 *
 * Produces a runnable `kaggle_benchmarks` task from a stored Crucible task,
 * plus the exact CLI commands to push, run and download it.
 *
 * Deliberate scope limit: the generated file uses only `@kbench.task` and
 * `llm.prompt`, the two entry points documented by Kaggle, and implements every
 * assertion itself in plain Python. Inventing SDK assertion names I cannot
 * verify against the published reference would produce a file that looks right
 * and fails on first run, which is worse than no file at all.
 */

import { ENGINE_VERSION, GRADER_VERSION, type BenchmarkTask, type EngineVerdict } from "./types.ts";
import { SITE } from "./site.ts";

/** JSON string literals are valid Python string literals. */
function py(value: string): string {
  return JSON.stringify(value);
}

/**
 * Serialise a JavaScript value as a Python literal.
 *
 * `JSON.stringify` cannot be used for structured data here: it emits `true`,
 * `false` and `null`, which are *syntactically* valid Python (they parse as
 * identifiers, so `ast.parse` accepts them) but raise `NameError` on first
 * execution. This emits `True`, `False` and `None`.
 */
function pyValue(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  const padInner = " ".repeat(indent + 4);

  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "None";
  if (typeof value === "string") return py(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((v) => `${padInner}${pyValue(v, indent + 4)}`);
    return `[\n${items.join(",\n")},\n${pad}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const body = entries.map(
      ([key, v]) => `${padInner}${py(key)}: ${pyValue(v, indent + 4)}`,
    );
    return `{\n${body.join(",\n")},\n${pad}}`;
  }

  return "None";
}

function pyNumber(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "None" : String(value);
}

/** Python identifiers cannot contain '-', so transliterate defensively. */
function ident(value: string, fallback: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `${fallback}_${cleaned}`;
}

export type KaggleBundle = {
  taskSlug: string;
  files: { path: string; language: "python" | "bash" | "markdown"; content: string }[];
  commands: string[];
  notes: string[];
};

const HELPER_SOURCE = `import json
import re


def fold(text):
    """Collapse whitespace so a needle spanning a line break still matches."""
    return re.sub(r"\\s+", " ", text).strip()


def first_json_document(text):
    """Return the first balanced JSON object or array, ignoring braces in strings."""
    for start, char in enumerate(text):
        if char not in "{[":
            continue
        closer = "}" if char == "{" else "]"
        depth = 0
        in_string = False
        escaped = False
        for index in range(start, len(text)):
            current = text[index]
            if escaped:
                escaped = False
                continue
            if current == "\\\\":
                escaped = True
                continue
            if current == '"':
                in_string = not in_string
                continue
            if in_string:
                continue
            if current == char:
                depth += 1
            elif current == closer:
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:index + 1])
                    except ValueError:
                        break
    return None


def get_by_path(document, path):
    parts = [p for p in re.sub(r"\\[(\\d+)\\]", r".\\1", path).split(".") if p]
    current = document
    for part in parts:
        if current is None:
            return None
        if isinstance(current, list):
            if not part.lstrip("-").isdigit():
                return None
            index = int(part)
            if index < -len(current) or index >= len(current):
                return None
            current = current[index]
        elif isinstance(current, dict):
            if part not in current:
                return None
            current = current[part]
        else:
            return None
    return current


def check(assertion, completion):
    """Decide one assertion. Returns (passed, evidence) with passed=None for judges."""
    kind = assertion["kind"]
    if kind == "judge_rubric":
        return None, "judge rubric, not decided on this runner"

    haystack = fold(completion)

    if kind == "regex":
        pattern = assertion.get("pattern") or ""
        try:
            compiled = re.compile(pattern, re.IGNORECASE)
        except re.error:
            return False, "invalid pattern: " + pattern
        match = compiled.search(completion)
        if not match:
            return False, "no match for /" + pattern + "/i"
        return True, "matched " + repr(match.group(0)[:120])

    if kind == "contains":
        needle = fold(assertion.get("needle") or "")
        return (needle in haystack, ("present" if needle in haystack else "absent"))

    if kind == "not_contains":
        needle = fold(assertion.get("needle") or "")
        return (needle not in haystack, ("absent as required" if needle not in haystack else "leaked"))

    if kind == "json_path_equals":
        document = first_json_document(completion)
        if document is None:
            return False, "no parsable JSON object or array in the completion"
        actual = get_by_path(document, assertion.get("path") or "")
        if actual is None:
            return False, "path " + str(assertion.get("path")) + " absent from the parsed document"
        rendered = fold(actual) if isinstance(actual, str) else json.dumps(actual, separators=(",", ":"))
        expected = fold(str(assertion.get("jsonExpected") or ""))
        return (rendered == expected, rendered[:120])

    if kind == "number_between":
        low = assertion.get("min")
        high = assertion.get("max")
        if not isinstance(low, (int, float)) or not isinstance(high, (int, float)):
            return False, "number_between needs both min and max"
        low, high = min(low, high), max(low, high)
        numbers = [float(n) for n in re.findall(r"-?\\d+(?:\\.\\d+)?", completion)]
        if not numbers:
            return False, "no number found in the completion"
        inside = [n for n in numbers if low <= n <= high]
        return (bool(inside), (str(inside[0]) if inside else "no number in range"))

    return False, "unknown assertion kind"
`;

export function kaggleBundle(
  task: BenchmarkTask,
  verdict: EngineVerdict,
): KaggleBundle {
  const slug = task.slug || "crucible-task";
  const fnName = ident(slug, "task");

  const assertionTable = task.assertions.map((a) => ({
    id: a.id,
    kind: a.kind,
    weight: a.weight,
    required: a.required,
    pattern: a.pattern ?? null,
    needle: a.needle ?? null,
    path: a.path ?? null,
    jsonExpected: a.jsonExpected ?? null,
    min: a.min ?? null,
    max: a.max ?? null,
    rubric: a.rubric ?? null,
  }));

  const python = `"""${task.name}

Forged with ${SITE.name} using ${ENGINE_VERSION}.
Seeded from the record at ${SITE.liveUrl}/task/${task.id}

Failure mode under test:
${task.failureMode}

Deterministic assertion weight: ${verdict.factors.find((f) => f.id === "determinism")?.value ?? 0}
Suite grade when forged: ${verdict.score} (${verdict.band.label})
"""

import kaggle_benchmarks as kbench

from crucible_grader import check

ASSERTIONS = ${pyValue(assertionTable)}

PROMPT = ${py(task.prompt)}

SEED = ${pyNumber(task.seed)}
TEMPERATURE = ${pyNumber(task.targetTemp)}
TARGET_REVISION = ${py(task.targetRevision ?? "")}


@kbench.task(name=${py(slug)})
def ${fnName}(llm):
    """Ask the model, then decide the answer with exact assertions only.

    No language model is used as a judge, so two runs of this task on the same
    recorded completion always produce the same score.
    """
    completion = llm.prompt(PROMPT)

    deterministic_weight = 0.0
    earned = 0.0
    report = []

    for assertion in ASSERTIONS:
        weight = float(assertion.get("weight") or 0)
        if assertion["kind"] == "judge_rubric":
            report.append({"id": assertion["id"], "kind": assertion["kind"], "passed": None,
                           "weight": weight, "evidence": "not decided on this runner"})
            continue
        deterministic_weight += weight
        passed, evidence = check(assertion, completion)
        if passed:
            earned += weight
        report.append({"id": assertion["id"], "kind": assertion["kind"], "passed": passed,
                       "weight": weight, "evidence": evidence})

    score = (earned / deterministic_weight) if deterministic_weight > 0 else 0.0

    return {
        "score": score,
        "determinism": 1.0 if deterministic_weight > 0 else 0.0,
        "passed": sum(1 for r in report if r["passed"] is True),
        "total": len(report),
        "assertions": report,
        "completion": completion,
        "metadata": {
            "engine": ${py(ENGINE_VERSION)},
            "grader": ${py(GRADER_VERSION)},
            "seed": SEED,
            "temperature": TEMPERATURE,
            "target_revision": TARGET_REVISION,
        },
    }
`;

  const graderModule = HELPER_SOURCE;

  const commands = [
    "pip install kaggle kaggle-benchmarks",
    "kaggle auth login",
    `python -c "import ast,sys; ast.parse(open('${slug}.py').read()); print('task parses')"`,
    `python selfcheck.py`,
    `kaggle b t push ${slug} -f ${slug}.py --wait`,
    `kaggle b t run ${slug} -m google/gemini-2.5-flash -m anthropic/claude-sonnet-4 --wait`,
    `kaggle b t download ${slug} -o ./${slug}-results`,
  ];

  /**
   * A self-check that re-runs the shipped Python grader over the same recorded
   * completions Crucible graded, and prints the per-transcript scores as JSON.
   *
   * This exists so the claim "the exported file grades identically" is
   * checkable rather than asserted. `npm test` runs it and diffs the numbers
   * against the TypeScript engine.
   */
  const selfcheck = `"""Re-run the shipped grader over Crucible's recorded completions.

    Run with:  python selfcheck.py
    Prints:    {"grader": ..., "grades": [{"transcriptId", "score"}]}

    If these scores match the ones Crucible reported, the exported file is a
    faithful re-implementation rather than a loose port.
"""

import json

from crucible_grader import check

TRANSCRIPTS = ${pyValue(
    task.transcripts.map((t) => ({ id: t.id, modelId: t.modelId, completion: t.completion })),
  )}

ASSERTIONS = ${pyValue(assertionTable)}


def grade(completion):
    deterministic_weight = 0.0
    earned = 0.0
    for assertion in ASSERTIONS:
        weight = float(assertion.get("weight") or 0)
        if assertion["kind"] == "judge_rubric":
            continue
        deterministic_weight += weight
        passed, _ = check(assertion, completion)
        if passed:
            earned += weight
    if deterministic_weight <= 0:
        return 0.0
    return round(earned / deterministic_weight, 4)


if __name__ == "__main__":
    print(
        json.dumps(
            {
                "grader": ${py(GRADER_VERSION)},
                "grades": [
                    {"transcriptId": t["id"], "score": grade(t["completion"])}
                    for t in TRANSCRIPTS
                ],
            },
            indent=2,
        )
    )
`;

  const readme = `# ${task.name}

Generated by ${SITE.name} (${ENGINE_VERSION}) from the record
\`${SITE.liveUrl}/task/${task.id}\`.

## Files

| File | Purpose |
| --- | --- |
| \`${slug}.py\` | The benchmark task. Uses \`@kbench.task\` and \`llm.prompt\`, then grades with exact assertions. |
| \`crucible_grader.py\` | The assertion evaluator. Plain Python, no SDK dependency. |
| \`push.sh\` | The exact CLI sequence to push, run and download. |

## Why grading is in this file

The grade is decided by string, regex, JSON-path and numeric-range comparison
against the recorded completion. No language model is asked whether the answer
is good. That is deliberate: an eval whose score depends on a judge cannot be
replayed, so a reader cannot check it.

Judge-style assertions are preserved in the payload as \`passed: null\` rather
than being silently dropped, so the weight that remains undecided is visible
instead of hidden.

## Caveats

- A benchmark (the collection of tasks) must be created in the Kaggle web UI;
  the CLI manages tasks, not collections.
- \`SEED\`, \`TEMPERATURE\` and \`TARGET_REVISION\` are carried through from the
  Crucible record. Set the temperature on the runner if your proxy does not
  accept it from the task.
`;

  const pushScript = `#!/usr/bin/env bash
# Push, run and download this task with the Kaggle CLI.
# Requires: pip install kaggle kaggle-benchmarks && kaggle auth login
set -euo pipefail

SLUG=${slug}

python -c "import ast; ast.parse(open('\${SLUG}.py').read()); print('task parses')"

kaggle b t push "\${SLUG}" -f "\${SLUG}.py" --wait
kaggle b t run "\${SLUG}" -m google/gemini-2.5-flash -m anthropic/claude-sonnet-4 --wait
kaggle b t download "\${SLUG}" -o "./\${SLUG}-results"

echo "Results in ./\${SLUG}-results"
`;

  const notes = [
    `Forged grade at export time: ${verdict.score} (${verdict.band.label}).`,
    verdict.degraded
      ? `This task is degraded: ${verdict.degradationNote ?? "part of the grade is undecided."}`
      : "Every assertion weight is decided without a language model in the loop.",
    "The CLI manages tasks. Grouping them into a benchmark happens in the Kaggle web UI.",
    "This bundle was produced locally and uploaded with your own Kaggle credentials; Crucible never sees them.",
  ];

  return {
    taskSlug: slug,
    files: [
      { path: `${slug}.py`, language: "python", content: python },
      { path: "crucible_grader.py", language: "python", content: graderModule },
      { path: "selfcheck.py", language: "python", content: selfcheck },
      { path: "push.sh", language: "bash", content: pushScript },
      { path: "README.md", language: "markdown", content: readme },
    ],
    commands,
    notes,
  };
}