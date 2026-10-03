"use client";

import { useCallback, useMemo, useState, useTransition } from "react";

import { Verdict } from "@/components/parts";
import type { Assertion, EngineVerdict, TaskGrade } from "@/lib/types";

type Props = {
  taskId: string;
  initialAssertions: Assertion[];
  initialVerdict: EngineVerdict;
  initialGrade: TaskGrade;
  readOnly: boolean;
};

/**
 * The heat dial.
 *
 * This is the one control in the product that changes what the engine measures.
 * It sets the total assertion weight given to language-model judges: at zero the
 * grade is entirely deterministic and the panel is cold; at maximum the grade is
 * a claim rather than a measurement and the panel glows.
 *
 * Moving it PATCHes the task, which appends to the audit chain and returns a
 * freshly computed verdict from the same `gradeTask` the API and the agent
 * tools use. Nothing here recomputes a score locally.
 */
export function HeatDial({
  taskId,
  initialAssertions,
  initialVerdict,
  initialGrade,
  readOnly,
}: Props) {
  const judgeAssertions = useMemo(
    () => initialAssertions.filter((a) => a.kind === "judge_rubric"),
    [initialAssertions],
  );

  const initialJudgeWeight = useMemo(
    () => judgeAssertions.reduce((acc, a) => acc + (Number(a.weight) || 0), 0),
    [judgeAssertions],
  );

  const [value, setValue] = useState(initialJudgeWeight);
  const [verdict, setVerdict] = useState(initialVerdict);
  const [grade, setGrade] = useState(initialGrade);
  const [seal, setSeal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const detFactor = verdict.factors.find((f) => f.id === "determinism");
  const determinism = detFactor?.value ?? 0;

  const persist = useCallback(
    async (nextValue: number) => {
      setError(null);
      try {
        // Scale the judge weights to the requested total, keeping their
        // relative proportions. Deterministic weights are untouched.
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            assertions: initialAssertions.map((a) => {
              if (a.kind !== "judge_rubric") return a;
              const total = judgeAssertions.reduce(
                (acc, j) => acc + (Number(j.weight) || 0),
                0,
              );
              const share = total > 0 ? (Number(a.weight) || 0) / total : 0;
              return { ...a, weight: Number((share * nextValue).toFixed(4)) };
            }),
          }),
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          setError(body?.error?.message ?? `The suite rejected this change (${res.status}).`);
          return;
        }

        const view = (await res.json()) as {
          verdict: EngineVerdict;
          grade: TaskGrade;
          task: { seal: string };
        };
        setVerdict(view.verdict);
        setGrade(view.grade);
        setSeal(view.task.seal);
      } catch {
        setError("The change could not be saved. Check your connection and try again.");
      }
    },
    [taskId, initialAssertions, judgeAssertions],
  );

  function onRelease(next: number) {
    startTransition(async () => {
      await persist(next);
    });
  }

  async function sealGrade() {
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/grade`, { method: "POST" });
      if (!res.ok) {
        setError(`The engine could not be run (${res.status}).`);
        return;
      }
      const body = (await res.json()) as {
        verdict: EngineVerdict;
        grade: TaskGrade;
        seal: string;
      };
      setVerdict(body.verdict);
      setGrade(body.grade);
      setSeal(body.seal);
    } catch {
      setError("The engine could not be reached.");
    }
  }

  return (
    <div
      className="stack"
      style={{ ["--heat" as string]: (1 - determinism).toFixed(3), gap: 18 }}
    >
      <div className="cluster" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <strong style={{ fontSize: 17 }}>How much does a judge decide?</strong>
          <p className="muted" style={{ fontSize: 13, margin: "4px 0 0", maxWidth: "54ch" }}>
            Total assertion weight handed to language-model judges. At{" "}
            <strong>0</strong> every point of the grade is decided by exact
            comparison and the task is cold. As it rises, more of the number is an
            opinion and the panel heats up.
          </p>
        </div>
        <span className="readout" style={{ fontSize: "clamp(2rem,5vw,3rem)" }}>
          {(determinism * 100).toFixed(0)}
          <span style={{ fontSize: "0.42em" }}>%</span>
        </span>
      </div>

      <div>
        <label className="data" style={{ fontSize: 11, color: "var(--color-ash)", letterSpacing: "0.14em", textTransform: "uppercase" }}>
          Judge weight {value.toFixed(2)}
        </label>
        <input
          className="dial"
          type="range"
          min={0}
          max={6}
          step={0.25}
          value={value}
          disabled={readOnly || judgeAssertions.length === 0 || pending}
          aria-label="Total assertion weight given to language-model judges"
          aria-valuetext={`${value.toFixed(2)} judge weight, ${(determinism * 100).toFixed(0)} percent deterministic`}
          onChange={(e) => setValue(Number(e.target.value))}
          onPointerUp={(e) => onRelease(Number((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => onRelease(Number((e.target as HTMLInputElement).value))}
          onBlur={(e) => onRelease(Number((e.target as HTMLInputElement).value))}
        />
        <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
          {judgeAssertions.length === 0 ? (
            <>This task has no judge rubric, so there is nothing to heat. Add a{" "}
              <code className="data">judge_rubric</code> assertion to see the effect.</>
          ) : readOnly ? (
            <>Bundled reference tasks are read-only. Forge your own to move the dial.</>
          ) : (
            <>
              {judgeAssertions.length} judge rubric{judgeAssertions.length === 1 ? "" : "s"}:
              {" "}
              {judgeAssertions.map((a) => a.label).join(", ")}
            </>
          )}
        </p>
      </div>

      {error ? (
        <p className="notice notice-fault" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}

      <Verdict verdict={verdict} />

      <div className="cluster" style={{ justifyContent: "space-between" }}>
        <span className="data muted" style={{ fontSize: 11 }}>
          {pending
            ? "saving…"
            : seal
              ? `saved · seal ${seal.slice(0, 16)}…`
              : `spread ${grade.spread.toFixed(4)} · mean ${grade.meanScore.toFixed(4)}`}
        </span>
        {!readOnly ? (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={sealGrade}
            disabled={pending}
          >
            Re-grade and seal
          </button>
        ) : null}
      </div>
    </div>
  );
}