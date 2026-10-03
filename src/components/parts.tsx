import type { ReactNode } from "react";

import type {
  AssertionOutcome,
  EngineVerdict,
  GradeFactor,
  SourceStatus,
} from "@/lib/types";

/* ------------------------------------------------------------------ *
 * Structure
 * ------------------------------------------------------------------ */

export function Stage({
  label,
  children,
  id,
}: {
  label: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="stage" id={id} aria-label={label}>
      <p className="stage-label">{label}</p>
      {children}
    </section>
  );
}

export function SourceTag({
  status,
  fetchedAt,
  reason,
}: {
  status: SourceStatus;
  fetchedAt: string;
  reason?: string | null;
}) {
  const live = status === "live";
  return (
    <span
      className={`tag ${live ? "tag-live" : ""}`}
      title={reason ?? undefined}
    >
      {live ? "live" : "sealed"} · {fetchedAt.slice(0, 10)}
    </span>
  );
}

export function StatusTag({
  tone,
  children,
}: {
  tone: "live" | "fault" | "plain";
  children: ReactNode;
}) {
  const cls = tone === "live" ? "tag tag-live" : tone === "fault" ? "tag tag-fault" : "tag";
  return <span className={cls}>{children}</span>;
}

/* ------------------------------------------------------------------ *
 * The verdict
 * ------------------------------------------------------------------ */

/** The measured share of a grade that needs a model in the loop, 0..1. */
export function heatOf(verdict: EngineVerdict): number {
  const factor = verdict.factors.find((f) => f.id === "determinism");
  return factor ? 1 - factor.value : 0;
}

export function Verdict({
  verdict,
  compact = false,
}: {
  verdict: EngineVerdict;
  compact?: boolean;
}) {
  const factors = [...verdict.factors].sort((a, b) => b.weight - a.weight);

  return (
    <div className="stack" style={{ gap: compact ? 12 : 20 }}>
      <div className="cluster" style={{ alignItems: "baseline", gap: 18 }}>
        <span className="readout">{verdict.score.toFixed(1)}</span>
        <div className="stack" style={{ gap: 6 }}>
          <strong style={{ fontSize: 17 }}>{verdict.band.label}</strong>
          <span className="data muted" style={{ fontSize: 11 }}>
            {verdict.engineVersion}
          </span>
        </div>
        <span className="tag">{verdict.factors.length} factors</span>
        {verdict.degraded ? <StatusTag tone="fault">degraded</StatusTag> : null}
      </div>

      {!compact ? <p className="muted" style={{ fontSize: 14, margin: 0 }}>{verdict.band.meaning}</p> : null}

      {verdict.degraded && verdict.degradationNote ? (
        <p className="notice notice-fault" style={{ margin: 0 }}>
          {verdict.degradationNote}
        </p>
      ) : null}

      <div className="stack" style={{ gap: 12 }}>
        {factors.map((f) => (
          <FactorRow key={f.id} factor={f} />
        ))}
      </div>

      <p className="notice" style={{ margin: 0 }}>
        <strong>Weakest factor: {f(verdict.weakestFactor)}.</strong> {verdict.recommendation}
      </p>
    </div>
  );
}

function f(id: string): string {
  return id.replace(/_/g, " ");
}

function FactorRow({ factor }: { factor: GradeFactor }) {
  return (
    <div>
      <div
        className="cluster"
        style={{ justifyContent: "space-between", marginBottom: 5 }}
      >
        <span className="data" style={{ fontSize: 12 }}>
          {factor.label}
        </span>
        <span className="data muted" style={{ fontSize: 11 }}>
          ×{factor.weight.toFixed(2)} → {factor.contribution.toFixed(4)}
        </span>
      </div>
      {/* Width is the factor's real contribution, so the bars sum to the score. */}
      <div
        className="bar"
        role="img"
        aria-label={`${factor.label} contributes ${factor.contribution.toFixed(4)} of the score`}
      >
        <span style={{ width: `${Math.round(factor.value * 100)}%` }} />
      </div>
      <p className="muted" style={{ fontSize: 12.5, margin: "6px 0 0" }}>
        {factor.evidence}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The tape
 * ------------------------------------------------------------------ */

export function Tape({ outcomes }: { outcomes: AssertionOutcome[] }) {
  if (outcomes.length === 0) {
    return (
      <p className="muted" style={{ fontSize: 14, margin: 0 }}>
        No assertions recorded. Nothing here can be decided, so the grader has
        no verdict to give.
      </p>
    );
  }

  return (
    <div className="tape">
      {outcomes.map((o) => (
        <div className="tape-row" key={o.assertionId}>
          <span
            className={`tick ${o.passed === true ? "tick-pass" : o.passed === false ? "tick-fail" : "tick-null"}`}
          >
            {o.passed === true ? "PASS" : o.passed === false ? "FAIL" : "OPEN"} w{o.weight}
          </span>
          <span>
            <span style={{ fontSize: 14 }}>{o.label}</span>{" "}
            <span className="data muted" style={{ fontSize: 11 }}>
              {o.kind}
            </span>
            <br />
            <span className="muted" style={{ fontSize: 12.5, fontFamily: "var(--font-data)" }}>
              {o.evidence}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Small pieces
 * ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="stack" style={{ gap: 6 }}>
      <span className="data" style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-ash)" }}>
        {label}
      </span>
      {children}
      {hint ? (
        <span className="muted" style={{ fontSize: 12 }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="stack" style={{ gap: 12, padding: "28px 0" }}>
      <strong style={{ fontSize: 19 }}>{title}</strong>
      <p className="muted" style={{ maxWidth: "56ch", margin: 0 }}>
        {body}
      </p>
      {action}
    </div>
  );
}

export function ErrorNote({ message, detail }: { message: string; detail?: string }) {
  return (
    <div className="notice notice-fault" role="alert">
      <strong>{message}</strong>
      {detail ? (
        <>
          <br />
          <span className="data" style={{ fontSize: 12 }}>
            {detail}
          </span>
        </>
      ) : null}
    </div>
  );
}

export function Seal({ value, label = "seal" }: { value: string; label?: string }) {
  return (
    <span className="data muted" style={{ fontSize: 11, wordBreak: "break-all" }}>
      {label} {value.slice(0, 24)}…
    </span>
  );
}