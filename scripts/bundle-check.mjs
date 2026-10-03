/**
 * Proves the exported Kaggle bundle is a faithful port of the TypeScript
 * grader, not a loose approximation.
 *
 * For each seeded reference task this script:
 *   1. generates the bundle in-process,
 *   2. writes it to a temp directory,
 *   3. checks every generated Python file parses,
 *   4. runs the shipped `selfcheck.py`,
 *   5. diffs the Python scores against `gradeTranscript` from the engine.
 *
 *   node scripts/bundle-check.mjs
 */

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const { SEED_TASKS } = await import("../src/lib/seed.ts");
const { gradeTask, gradeTranscript } = await import("../src/lib/grade.ts");
const { kaggleBundle } = await import("../src/lib/kaggle.ts");

let failures = 0;
let checks = 0;

function check(label, ok, extra = "") {
  checks += 1;
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label} ${extra}`);
  }
}

const dir = mkdtempSync(join(tmpdir(), "crucible-bundle-"));

try {
  for (const task of SEED_TASKS) {
    console.log(`\n${task.slug}`);
    const verdict = gradeTask(task, { computedAt: "2026-10-03T00:00:00.000Z" }).verdict;
    const bundle = kaggleBundle(task, verdict);

    check("emits four files plus the self-check", bundle.files.length === 5, `${bundle.files.length}`);

    for (const file of bundle.files) {
      writeFileSync(join(dir, file.path), file.content, "utf8");
    }

    // 1. Syntax. A bundle that does not parse is worthless.
    const pyFiles = bundle.files.filter((f) => f.language === "python").map((f) => f.path);
    for (const name of pyFiles) {
      let parsed = true;
      let message = "";
      try {
        execFileSync("python", ["-c", `import ast,sys; ast.parse(open(sys.argv[1],encoding='utf-8').read())`, name], {
          cwd: dir,
          stdio: "pipe",
        });
      } catch (error) {
        parsed = false;
        message = String(error.stderr ?? error.message).slice(0, 300);
      }
      check(`${name} parses as Python`, parsed, message);
    }

    // 2. The shipped grader must agree with the engine, transcript by transcript.
    let pythonGrades = [];
    try {
      const stdout = execFileSync("python", ["selfcheck.py"], { cwd: dir, encoding: "utf8" });
      pythonGrades = JSON.parse(stdout).grades;
    } catch (error) {
      check("selfcheck.py runs", false, String(error.stderr ?? error.message).slice(0, 300));
    }

    if (pythonGrades.length > 0) {
      check("self-check reports one grade per transcript", pythonGrades.length === task.transcripts.length);

      for (const transcript of task.transcripts) {
        const ts = gradeTranscript(task, transcript).score;
        const pyRow = pythonGrades.find((g) => g.transcriptId === transcript.id);
        const pyScore = pyRow ? pyRow.score : Number.NaN;
        check(
          `${transcript.modelId.split("/").pop()} scores identically in TS and Python`,
          Math.abs(ts - pyScore) < 1e-6,
          `ts=${ts} py=${pyScore}`,
        );
      }
    }

    // 3. The bundle must not leak a placeholder or an empty assertion table.
    const taskFile = bundle.files.find((f) => f.path.endsWith(".py") && f.path !== "crucible_grader.py" && f.path !== "selfcheck.py");
    check("task file embeds the assertions", /^ASSERTIONS = \[/m.test(taskFile.content));
    check("task file carries the prompt", taskFile.content.includes("PROMPT = "));
    check("task file imports the shipped grader", taskFile.content.includes("from crucible_grader import check"));
    check("bundle never contains a TODO", !bundle.files.some((f) => /TODO|FIXME|placeholder/i.test(f.content)));
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}