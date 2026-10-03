"use client";

import { useMemo, useState, useTransition } from "react";

import { ErrorNote, Seal, Stage, StatusTag, Tape } from "@/components/parts";
import type { AuditEvent, BenchmarkTask, Decision, ReplayResult, TaskGrade } from "@/lib/types";

type Props = {
  task: BenchmarkTask;
  grade: TaskGrade;
  audit: AuditEvent[];
  integrity: ReplayResult;
  readOnly: boolean;
};

const VERDICTS: { value: Decision["verdict"]; label: string }[] = [
  { value: "adopt", label: "Adopt — publish this task" },
  { value: "iterate", label: "Iterate — fix the weakest factor first" },
  { value: "discard", label: "Discard — it measures nothing" },
];

export function TaskConsole({ task, grade, audit, integrity, readOnly }: Props) {
  const [active, setActive] = useState(0);
  const [verdict, setVerdict] = useState<Decision["verdict"]>("adopt");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [retired, setRetired] = useState<boolean>(Boolean(task.deletedAt));
  const [pending, startTransition] = useTransition();

  const current = grade.grades[active] ?? null;

  const grouped = useMemo(
    () => [...grade.grades].sort((a, b) => b.score - a.score),
    [grade.grades],
  );

  async function recordDecision() {
    setMessage(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verdict, note }),
      });
      const body = (await res.json().catch(() => null)) as
        | { decision?: Decision; error?: { message?: string } }
        | null;
      if (!res.ok) {
        setMessage({ tone: "bad", text: body?.error?.message ?? `Rejected (${res.status}).` });
        return;
      }
      setMessage({
        tone: "ok",
        text: `Recorded ${body?.decision?.verdict} at engine score ${body?.decision?.scoreAtDecision ?? "—"}. Sealed.`,
      });
      setNote("");
    } catch {
      setMessage({ tone: "bad", text: "The decision could not be saved." });
    }
  }

  async function retire() {
    setMessage(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
        const body = (await res.json().catch(() => null)) as
          | { integrity?: ReplayResult; error?: { message?: string } }
          | null;
        if (!res.ok) {
          setMessage({ tone: "bad", text: body?.error?.message ?? `Rejected (${res.status}).` });
          return;
        }
        setRetired(true);
        const ok = body?.integrity?.ok;
        setMessage({
          tone: "ok",
          text: `Retired as a tombstone. The audit chain ${ok ? "still replays clean" : "FAILED to replay"} across ${body?.integrity?.checked ?? 0} links.`,
        });
      } catch {
        setMessage({ tone: "bad", text: "The task could not be retired." });
      }
    });
  }

  return (
    <>
      <Stage label="Tape — every assertion, with the span that decided it">
        {grade.grades.length === 0 ? (
          <p className="muted" style={{ maxWidth: "60ch" }}>
            No transcript is recorded for this task, so there is nothing to tape.
            Record at least one completion, or move the dial above to add judge
            weight and watch the grade respond.
          </p>
        ) : (
          <div className="split">
            <div>
              <div className="cluster" style={{ marginBottom: 14 }}>
                {grouped.map((g, i) => (
                  <button
                    key={g.transcriptId}
                    type="button"
                    className={`btn ${i === active ? "btn-primary" : "btn-ghost"}`}
                    style={{ fontSize: 12, padding: "8px 12px" }}
                    aria-pressed={i === active}
                    onClick={() => setActive(i)}
                  >
                    {g.modelLabel}
                    <span className="data" style={{ marginLeft: 8, fontSize: 11 }}>
                      {g.score.toFixed(2)}
                    </span>
                  </button>
                ))}
              </div>

              {current ? (
                <>
                  <p className="cluster" style={{ marginBottom: 12 }}>
                    <StatusTag tone="live">rank {active + 1}</StatusTag>
                    <span className="tag">determinism {current.determinism.toFixed(2)}</span>
                    <span className="tag">{current.latencyMs} ms</span>
                    <span className="tag">{current.tokensOut} tokens out</span>
                    {current.outcomes.some((o) => o.passed === null) ? (
                      <StatusTag tone="fault">has undecided weight</StatusTag>
                    ) : null}
                  </p>
                  <Tape outcomes={current.outcomes} />
                </>
              ) : null}
            </div>

            <div className="stack" style={{ gap: 12 }}>
              <p className="stage-label" style={{ marginBottom: 0 }}>Recorded completion</p>
              <pre className="code">
                {current
                  ? (task.transcripts.find((t) => t.id === current.transcriptId)
                      ?.completion ?? "")
                  : ""}
              </pre>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                {(() => {
                  const t = current
                    ? task.transcripts.find((x) => x.id === current.transcriptId)
                    : null;
                  if (!t) return "";
                  return t.origin === "seeded"
                    ? "Bundled reference material, not a live model run."
                    : "Recorded from a real model run.";
                })()}
              </p>
            </div>
          </div>
        )}
      </Stage>

      <Stage label="Decide">
        {/*
          The message is rendered above the branch, not inside it. Retiring sets
          `retired` and swaps this stage for a tombstone notice, which used to
          hide the very confirmation the click was waiting for.
        */}
        {message ? (
          message.tone === "ok" ? (
            <p className="notice" style={{ margin: "0 0 18px" }} role="status">
              {message.text}
            </p>
          ) : (
            <div style={{ marginBottom: 18 }}>
              <ErrorNote message={message.text} />
            </div>
          )
        ) : null}

        {retired ? (
          <p className="notice" style={{ margin: 0 }}>
            This task is a <strong>tombstone</strong>. Its row and audit events are
            retained so the chain still replays, and it no longer appears in the
            live suite listing.
          </p>
        ) : readOnly ? (
          <p className="muted" style={{ maxWidth: "60ch", margin: 0 }}>
            Bundled reference tasks are read-only so the example stays stable.
            Decisions you record live on your own tasks.
          </p>
        ) : (
          <div className="split">
            <div className="stack" style={{ gap: 12 }}>
              <label className="stack" style={{ gap: 6 }}>
                <span className="data" style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-ash)" }}>
                  Verdict
                </span>
                <select
                  className="field"
                  value={verdict}
                  onChange={(e) => setVerdict(e.target.value as Decision["verdict"])}
                >
                  {VERDICTS.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="stack" style={{ gap: 6 }}>
                <span className="data" style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-ash)" }}>
                  Note
                </span>
                <textarea
                  className="field"
                  rows={3}
                  value={note}
                  maxLength={600}
                  placeholder="What would you change before publishing this?"
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>

              <div className="cluster">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={recordDecision}
                  disabled={note.trim().length < 3 || pending}
                >
                  Record decision
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={retire}
                  disabled={pending}
                >
                  Retire as tombstone
                </button>
              </div>
            </div>

            <div className="stack" style={{ gap: 12 }}>
              <p className="stage-label" style={{ marginBottom: 0 }}>
                Chain — {integrity.checked} links,{" "}
                {integrity.ok ? "intact" : `broken at seq ${integrity.brokenAtSeq}`}
              </p>
              <div className="scroll-x"><table className="rows">
                <thead>
                  <tr>
                    <th scope="col">Seq</th>
                    <th scope="col">Action</th>
                    <th scope="col">Detail</th>
                    <th scope="col">Actor</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.slice(-12).reverse().map((e) => (
                    <tr key={e.seq}>
                      <td className="data">{e.seq}</td>
                      <td className="data" style={{ fontSize: 12 }}>{e.action}</td>
                      <td className="muted" style={{ fontSize: 12.5 }}>{e.detail}</td>
                      <td className="data muted" style={{ fontSize: 11 }}>{e.actor}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              <p>
                <Seal value={integrity.head} label="head" />
              </p>
            </div>
          </div>
        )}
      </Stage>
    </>
  );
}