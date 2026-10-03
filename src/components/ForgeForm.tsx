"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ErrorNote } from "@/components/parts";
import type { AssertionKind, Transcript } from "@/lib/types";

type Draft = {
  kind: AssertionKind;
  label: string;
  weight: string;
  pattern: string;
  needle: string;
  path: string;
  jsonExpected: string;
  min: string;
  max: string;
  rubric: string;
};

const KINDS: { value: AssertionKind; label: string; hint: string }[] = [
  { value: "json_path_equals", label: "json_path_equals", hint: "Reads a value out of the first JSON object in the completion." },
  { value: "regex", label: "regex", hint: "Case-insensitive match against the raw completion." },
  { value: "contains", label: "contains", hint: "Substring after collapsing whitespace. The loosest option." },
  { value: "not_contains", label: "not_contains", hint: "Fails when the forbidden token appears." },
  { value: "number_between", label: "number_between", hint: "Passes if any number in the completion falls inside the range." },
  { value: "judge_rubric", label: "judge_rubric", hint: "Needs a model in the loop. The engine charges you for it." },
];

function blank(): Draft {
  // No randomness anywhere in this initial state. A `Math.random()` id here
  // rendered a different value on the server than on the client, which broke
  // hydration for the whole form and left every control dead.
  return {
    kind: "json_path_equals",
    label: "",
    weight: "1",
    pattern: "",
    needle: "",
    path: "",
    jsonExpected: "",
    min: "",
    max: "",
    rubric: "",
  };
}

/** Determinism is the weight share that needs no model. Shown live. */
function determinismOf(rows: Draft[]): number {
  let det = 0;
  let total = 0;
  for (const r of rows) {
    const w = Number(r.weight);
    const weight = Number.isFinite(w) && w > 0 ? w : 0;
    total += weight;
    if (r.kind !== "judge_rubric") det += weight;
  }
  return total > 0 ? det / total : 0;
}

export function ForgeForm() {
  const router = useRouter();
  // Stable across server and client, unlike a random id.
  const uid = useId();
  const [name, setName] = useState("");
  const [failureMode, setFailureMode] = useState("");
  const [prompt, setPrompt] = useState("");
  const [rows, setRows] = useState<Draft[]>([blank()]);
  const [fixtures, setFixtures] = useState("");
  const [targetModel, setTargetModel] = useState("");
  const [targetRevision, setTargetRevision] = useState("");
  const [seed, setSeed] = useState("");
  const [temperature, setTemperature] = useState("");
  const [budget, setBudget] = useState("500");
  const [transcripts, setTranscripts] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const determinism = useMemo(() => determinismOf(rows), [rows]);

  /** Row identity is the index, so server and client render identical markup. */
  const rowId = (index: number) => `${uid}-a${index}`;

  function update(index: number, patch: Partial<Draft>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function loadExample() {
    setName("Unit-of-measure drift in an export");
    setFailureMode(
      "The model returns micrograms where the canonical schema demands milligrams, and the loader silently reads the wrong column.",
    );
    setPrompt(
      "Return ONLY a JSON object of the form {\"rows\":[{\"id\":string,\"amount\":number,\"unit\":\"mg\"}],\"meta\":{\"units\":\"mg\",\"count\":number}}. Convert every amount to milligrams.",
    );
    setRows([
      { ...blank(), kind: "json_path_equals", label: "units are mg", weight: "3", path: "meta.units", jsonExpected: "mg" },
      { ...blank(), kind: "not_contains", label: "no micrograms", weight: "2", needle: "µg" },
      { ...blank(), kind: "number_between", label: "total in range", weight: "2", min: "400", max: "500" },
    ]);
    setFixtures("export_rows.csv=sha256:6f1a2c9d4e8b73a5109fd2c4e7b81a3d6c5f0e2b94d7a1c8e3f5b0d2a6c9e4f7");
    setTargetModel("Qwen/Qwen2.5-72B-Instruct");
    setTargetRevision("495f39366efef23836d0cfae4fbe635880d2be31");
    setSeed("20260923");
    setTemperature("0");
    setBudget("400");
    setTranscripts(
      JSON.stringify(
        [
          {
            modelId: "Qwen/Qwen2.5-72B-Instruct",
            completion:
              '{"rows":[{"id":"a","amount":120,"unit":"mg"}],"meta":{"units":"mg","count":1}}',
            latencyMs: 1840,
            tokensIn: 240,
            tokensOut: 96,
          },
          {
            modelId: "google/gemini-2.5-flash",
            completion: '{"rows":[{"id":"a","amount":120000,"unit":"µg"}],"meta":{"units":"µg","count":1}}',
            latencyMs: 2100,
            tokensIn: 240,
            tokensOut: 101,
          },
        ],
        null,
        2,
      ),
    );
    setError(null);
  }

  function submit() {
    setError(null);

    let parsedTranscripts: Transcript[] = [];
    if (transcripts.trim()) {
      try {
        const raw = JSON.parse(transcripts);
        if (!Array.isArray(raw)) throw new Error("must be a JSON array");
        parsedTranscripts = raw.map((t, i) => ({
          id: `tr${i + 1}`,
          modelId: String(t.modelId ?? ""),
          modelLabel: String(t.modelLabel ?? String(t.modelId ?? "").split("/").pop() ?? ""),
          prompt: String(t.prompt ?? ""),
          completion: String(t.completion ?? ""),
          latencyMs: Number(t.latencyMs ?? 0),
          tokensIn: Number(t.tokensIn ?? 0),
          tokensOut: Number(t.tokensOut ?? 0),
          origin: "recorded" as const,
        }));
      } catch (e) {
        setError(
          `Transcripts must be a JSON array of objects with modelId and completion. ${
            e instanceof Error ? e.message : ""
          }`,
        );
        return;
      }
    }

    const assertions = rows
      .filter((r) => r.label.trim().length > 0)
      .map((r, i) => {
        const base = {
          id: rowId(i),
          kind: r.kind,
          label: r.label.trim(),
          weight: Number(r.weight) || 0,
          required: false,
        };
        switch (r.kind) {
          case "regex":
            return { ...base, pattern: r.pattern };
          case "contains":
          case "not_contains":
            return { ...base, needle: r.needle };
          case "json_path_equals":
            return { ...base, path: r.path, jsonExpected: r.jsonExpected };
          case "number_between":
            return { ...base, min: Number(r.min), max: Number(r.max) };
          case "judge_rubric":
            return { ...base, rubric: r.rubric };
          default:
            return base;
        }
      });

    const body = {
      name: name.trim(),
      failureMode: failureMode.trim(),
      prompt: prompt.trim(),
      assertions,
      transcripts: parsedTranscripts,
      sealedFixtures: fixtures
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      targetModel: targetModel.trim() || null,
      targetRevision: targetRevision.trim() || null,
      seed: seed.trim() === "" ? null : Number(seed),
      targetTemp: temperature.trim() === "" ? null : Number(temperature),
      tokenBudget: Number(budget) || 0,
    };

    startTransition(async () => {
      try {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await res.json().catch(() => null)) as
          | { task?: { id: string }; error?: { message?: string; details?: { path: string; message: string }[] } }
          | null;

        if (!res.ok || !payload?.task) {
          const detail = payload?.error?.details
            ?.map((d) => `${d.path}: ${d.message}`)
            .join(" · ");
          setError(`${payload?.error?.message ?? `Rejected (${res.status}).`}${detail ? ` — ${detail}` : ""}`);
          return;
        }
        router.push(`/task/${payload.task.id}`);
      } catch {
        setError("The task could not be forged. Check your connection and try again.");
      }
    });
  }

  return (
    <div className="stack" style={{ gap: 26 }}>
      <div className="cluster" style={{ justifyContent: "space-between" }}>
        <p className="muted" style={{ fontSize: 13.5, maxWidth: "60ch", margin: 0 }}>
          A task is a failure you have actually seen. Write the prompt that provokes
          it, then write assertions that decide the answer without asking a model
          whether it was good.
        </p>
        <button type="button" className="btn btn-ghost" onClick={loadExample}>
          Load an example
        </button>
      </div>

      <div className="split">
        <div className="stack" style={{ gap: 14 }}>
          <F label="Task name" hint="3–120 characters.">
            <input className="field" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </F>
          <F label="The failure, in your words" hint="What breaks, and what it costs you. 10–600 characters.">
            <textarea className="field" rows={3} value={failureMode} maxLength={600} onChange={(e) => setFailureMode(e.target.value)} />
          </F>
          <F label="Prompt under test" hint="Given to the model verbatim.">
            <textarea className="field" rows={7} value={prompt} maxLength={8000} onChange={(e) => setPrompt(e.target.value)} />
          </F>
          <F label="Sealed inputs" hint="One name=hash per line, for example input.csv=sha256:abc123.">
            <textarea className="field" rows={3} value={fixtures} onChange={(e) => setFixtures(e.target.value)} />
          </F>
        </div>

        <div className="stack" style={{ gap: 14 }}>
          <F label="Target model" hint="A Hugging Face repo id gets a live revision and gating check.">
            <input className="field" value={targetModel} placeholder="Qwen/Qwen2.5-72B-Instruct" onChange={(e) => setTargetModel(e.target.value)} />
          </F>
          <div className="split" style={{ gap: 12 }}>
            <F label="Pinned revision">
              <input className="field" value={targetRevision} onChange={(e) => setTargetRevision(e.target.value)} />
            </F>
            <F label="Seed">
              <input className="field" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value)} />
            </F>
          </div>
          <div className="split" style={{ gap: 12 }}>
            <F label="Temperature">
              <input className="field" inputMode="decimal" value={temperature} onChange={(e) => setTemperature(e.target.value)} />
            </F>
            <F label="Token budget per run">
              <input className="field" inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} />
            </F>
          </div>
        </div>
      </div>

      {/* ---------------- assertions ---------------- */}
      <div className="stack" style={{ gap: 12 }}>
        <div className="cluster" style={{ justifyContent: "space-between" }}>
          <p className="stage-label" style={{ margin: 0 }}>
            Assertions
          </p>
          <span className="tag">
            determinism {(determinism * 100).toFixed(0)}%
          </span>
        </div>

        {rows.map((row, index) => {
          const meta = KINDS.find((k) => k.value === row.kind);
          return (
            <div
              key={rowId(index)}
              style={{ border: "1px solid var(--rule)", padding: 14 }}
            >
              <div className="cluster" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                <span className="data muted" style={{ fontSize: 11 }}>
                  assertion {index + 1}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: 11, padding: "5px 10px", minHeight: 32 }}
                  onClick={() => setRows((p) => p.filter((_, i) => i !== index))}
                  disabled={rows.length === 1}
                >
                  Remove
                </button>
              </div>

              <div className="split" style={{ gap: 12 }}>
                <F label="Kind">
                  <select className="field" value={row.kind} onChange={(e) => update(index, { kind: e.target.value as AssertionKind })}>
                    {KINDS.map((k) => (
                      <option key={k.value} value={k.value}>{k.label}</option>
                    ))}
                  </select>
                </F>
                <F label="Weight">
                  <input className="field" inputMode="decimal" value={row.weight} onChange={(e) => update(index, { weight: e.target.value })} />
                </F>
              </div>

              <div style={{ marginTop: 12 }}>
                <F label="Label" hint={meta?.hint}>
                  <input className="field" value={row.label} onChange={(e) => update(index, { label: e.target.value })} />
                </F>
              </div>

              <div style={{ marginTop: 12 }}>
                {row.kind === "regex" ? (
                  <F label="Pattern" hint="JavaScript/PCRE-ish, matched case-insensitively.">
                    <input className="field" value={row.pattern} onChange={(e) => update(index, { pattern: e.target.value })} />
                  </F>
                ) : row.kind === "contains" || row.kind === "not_contains" ? (
                  <F label="Needle">
                    <input className="field" value={row.needle} onChange={(e) => update(index, { needle: e.target.value })} />
                  </F>
                ) : row.kind === "json_path_equals" ? (
                  <div className="split" style={{ gap: 12 }}>
                    <F label="Path" hint="Dot separated. meta.count or rows[0].id">
                      <input className="field" value={row.path} onChange={(e) => update(index, { path: e.target.value })} />
                    </F>
                    <F label="Expected value">
                      <input className="field" value={row.jsonExpected} onChange={(e) => update(index, { jsonExpected: e.target.value })} />
                    </F>
                  </div>
                ) : row.kind === "number_between" ? (
                  <div className="split" style={{ gap: 12 }}>
                    <F label="Min">
                      <input className="field" inputMode="decimal" value={row.min} onChange={(e) => update(index, { min: e.target.value })} />
                    </F>
                    <F label="Max">
                      <input className="field" inputMode="decimal" value={row.max} onChange={(e) => update(index, { max: e.target.value })} />
                    </F>
                  </div>
                ) : (
                  <F label="Rubric" hint="This weight will be reported as undecided, never as a pass.">
                    <textarea className="field" rows={2} value={row.rubric} maxLength={600} onChange={(e) => update(index, { rubric: e.target.value })} />
                  </F>
                )}
              </div>
            </div>
          );
        })}

        <div>
          <button type="button" className="btn btn-ghost" onClick={() => setRows((p) => [...p, blank()])}>
            Add assertion
          </button>
        </div>
      </div>

      {/* ---------------- transcripts ---------------- */}
      <div className="stack" style={{ gap: 12 }}>
        <F
          label="Recorded transcripts (optional)"
          hint='A JSON array of { modelId, completion, latencyMs?, tokensIn?, tokensOut? }. Two or more separated models are how a task earns its discrimination factor.'
        >
          <textarea className="field" rows={8} value={transcripts} onChange={(e) => setTranscripts(e.target.value)} />
        </F>
      </div>

      {error ? <ErrorNote message={error} /> : null}

      <div className="cluster" style={{ justifyContent: "space-between" }}>
        <span className="data muted" style={{ fontSize: 11 }}>
          {pending ? "writing to the database…" : "every field is validated before it is stored"}
        </span>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={pending}>
          Pour the task
        </button>
      </div>
    </div>
  );
}

function F({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="stack" style={{ gap: 6 }}>
      <span
        className="data"
        style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-ash)" }}
      >
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