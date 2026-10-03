/**
 * Dossier generation.
 *
 * The takeaway artefact: a file a reader can keep. It carries the factor table,
 * the per-transcript grades, the live-source attribution, the engine version and
 * the head of the audit chain, so a reader can check the claim rather than take
 * it on trust.
 */

import { SITE } from "./site.ts";
import { SEAL_ALGORITHM } from "./canonical.ts";
import type {
  BenchmarkTask,
  EngineVerdict,
  ReplayResult,
  TaskGrade,
} from "./types.ts";

export type DossierInput = {
  task: BenchmarkTask;
  verdict: EngineVerdict;
  grade: TaskGrade;
  integrity: ReplayResult;
  attribution: { sourceName: string; sourceUrl: string; fetchedAt: string; status: string } | null;
};

function table(headers: string[], rows: (string | number)[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const rule = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.map((c) => String(c).replace(/\|/g, "\\|")).join(" | ")} |`);
  return [head, rule, ...body].join("\n");
}

export function toMarkdown(input: DossierInput): string {
  const { task, verdict, grade, integrity, attribution } = input;

  const factors = table(
    ["Factor", "Weight", "Value", "Contribution", "Evidence"],
    verdict.factors.map((f) => [
      f.label,
      f.weight.toFixed(2),
      f.value.toFixed(3),
      f.contribution.toFixed(4),
      f.evidence,
    ]),
  );

  const transcripts = table(
    ["Model", "Score", "Determinism", "Latency (ms)", "Tokens out"],
    grade.grades.map((g) => [
      g.modelLabel,
      g.score.toFixed(4),
      g.determinism.toFixed(2),
      g.latencyMs,
      g.tokensOut,
    ]),
  );

  const assertions = table(
    ["Kind", "Label", "Weight", "Required"],
    task.assertions.map((a) => [a.kind, a.label, a.weight, a.required ? "yes" : "no"]),
  );

  const decision = task.decision
    ? `**${task.decision.verdict}** — ${task.decision.note} (recorded ${task.decision.recordedAt}, engine score ${task.decision.scoreAtDecision})`
    : "No decision recorded.";

  const attributionBlock = attribution
    ? [
        `- Source: ${attribution.sourceName} (${attribution.status})`,
        `- Retrieved: ${attribution.fetchedAt}`,
        `- Upstream: ${attribution.sourceUrl}`,
      ].join("\n")
    : "- No live source was used for this dossier.";

  return `# ${task.name}

> ${SITE.outcome}

- **Suite grade:** ${verdict.score} / 100 — ${verdict.band.label}
- **Engine:** \`${verdict.engineVersion}\` · **Grader:** \`${grade.graderVersion}\`
- **Forge record:** ${SITE.liveUrl}/task/${task.id}
- **Exported:** ${new Date().toISOString()}

## The failure this task was built from

${task.failureMode}

## Prompt under test

\`\`\`text
${task.prompt}
\`\`\`

## What the grade actually means

${verdict.band.meaning}

**Required action:** ${verdict.band.action}

**Weakest factor:** ${verdict.weakestFactor} — ${verdict.recommendation}

${verdict.degraded ? `> **Degraded.** ${verdict.degradationNote}\n` : ""}
## Factor table

${factors}

Recorded model separation: mean ${grade.meanScore.toFixed(4)}, population sigma ${grade.spread.toFixed(4)}, range ${grade.minScore.toFixed(4)}–${grade.maxScore.toFixed(4)}.

## Per-transcript grades

${transcripts}

## Assertions

${assertions}

## Decision

${decision}

## Integrity

- Algorithm: ${SEAL_ALGORITHM} over canonical JSON
- Genesis: \`${integrity.genesis}\`
- Links checked: ${integrity.checked}
- Chain head: \`${integrity.head.slice(0, 32)}…\`
- Replay: ${integrity.ok ? "intact, no broken link" : `BROKEN at seq ${integrity.brokenAtSeq}: ${integrity.brokenReason}`}

Recompute it yourself:

\`\`\`bash
curl ${SITE.apiBase}/tasks/${task.id}/integrity
\`\`\`

## Sealed inputs

${
  task.sealedFixtures.length > 0
    ? task.sealedFixtures.map((f) => `- \`${f}\``).join("\n")
    : "- None declared. A task with no declared inputs cannot be replayed byte-for-byte."
}

Pinned: revision \`${task.targetRevision ?? "not pinned"}\`, seed \`${task.seed ?? "not pinned"}\`, temperature \`${task.targetTemp ?? "not pinned"}\`, target model \`${task.targetModel ?? "not pinned"}\`.

## Data provenance

${attributionBlock}

Transcript origin: ${Array.from(new Set(task.transcripts.map((t) => t.origin))).join(", ") || "none"}.
${
  task.transcripts.some((t) => t.origin === "seeded")
    ? "\n> Transcripts marked `seeded` are bundled reference material, not a live model run.\n"
    : ""
}
## Caveats

- A grade is a statement about a **task**, not about a model. A high score means
  the task is worth publishing; it says nothing about any model's ability.
- Scores here are produced by exact assertions. Any assertion that needs a
  language-model judge is reported as \`null\`, never as a pass.
- Reproducing a run needs the pinned revision above. A model with no public
  revision cannot be reproduced by a third party, whatever this dossier says.
`;
}

export function toJson(input: DossierInput): string {
  const { task, verdict, grade, integrity, attribution } = input;
  return JSON.stringify(
    {
      generator: `${SITE.name} ${SITE.version}`,
      engine: verdict.engineVersion,
      grader: grade.graderVersion,
      exportedAt: new Date().toISOString(),
      task,
      verdict,
      grade,
      integrity,
      provenance: attribution,
    },
    null,
    2,
  );
}

/** Flat per-transcript CSV so the numbers drop into a spreadsheet. */
export function toCsv(input: DossierInput): string {
  const { task, verdict, grade } = input;
  const rows: (string | number)[][] = [
    [
      "task_slug",
      "task_name",
      "engine",
      "task_score",
      "band",
      "model_id",
      "model_label",
      "transcript_score",
      "determinism",
      "latency_ms",
      "tokens_in",
      "tokens_out",
      "transcript_origin",
    ],
  ];

  const gradesById = new Map(grade.grades.map((g) => [g.transcriptId, g]));
  for (const t of task.transcripts) {
    const g = gradesById.get(t.id);
    rows.push([
      task.slug,
      task.name,
      verdict.engineVersion,
      verdict.score,
      verdict.band.id,
      t.modelId,
      t.modelLabel,
      g ? g.score : "",
      g ? g.determinism : "",
      t.latencyMs,
      t.tokensIn,
      t.tokensOut,
      t.origin,
    ]);
  }

  return rows
    .map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(","))
    .join("\n");
}

export function filenameFor(task: BenchmarkTask, extension: string): string {
  const base = task.slug.replace(/[^a-z0-9-]/gi, "") || "task";
  return `crucible-${base}.${extension}`;
}