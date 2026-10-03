"use client";

import { useState, useTransition } from "react";

import { ErrorNote } from "@/components/parts";

type Settings = { defaultTokenBudget?: number; showClosedModels?: boolean };

export function SettingsForm({ initial }: { initial: Settings }) {
  const [budget, setBudget] = useState(String(initial.defaultTokenBudget ?? 500));
  const [closed, setClosed] = useState(initial.showClosedModels ?? true);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setMessage(null);
    const value = Number(budget);
    if (!Number.isFinite(value) || value < 0 || value > 10_000_000) {
      setMessage({ tone: "bad", text: "Token budget must be a number between 0 and 10000000." });
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch("/api/settings", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ defaultTokenBudget: Math.trunc(value), showClosedModels: closed }),
        });
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!res.ok) {
          setMessage({ tone: "bad", text: body?.error?.message ?? `Rejected (${res.status}).` });
          return;
        }
        setMessage({ tone: "ok", text: "Saved to this session's scope." });
      } catch {
        setMessage({ tone: "bad", text: "The settings could not be saved." });
      }
    });
  }

  return (
    <div className="stack" style={{ gap: 16, maxWidth: "52ch" }}>
      <label className="stack" style={{ gap: 6 }}>
        <span className="data" style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-ash)" }}>
          Default token budget for new tasks
        </span>
        <input
          className="field"
          inputMode="numeric"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
        />
        <span className="muted" style={{ fontSize: 12 }}>
          The engine&apos;s cost-fit factor compares recorded runs against this number.
          Set it to what a run genuinely costs you, not to what you hope it costs.
        </span>
      </label>

      <label className="cluster" style={{ gap: 10 }}>
        <input
          type="checkbox"
          checked={closed}
          onChange={(e) => setClosed(e.target.checked)}
          style={{ width: 18, height: 18, accentColor: "var(--accent)" }}
        />
        <span style={{ fontSize: 14 }}>
          Show models that publish no public repository
        </span>
      </label>
      <p className="muted" style={{ fontSize: 12, marginTop: -8 }}>
        Those rows are the interesting ones: a closed model has no pinnable revision,
        so a third party cannot reproduce a run against it.
      </p>

      <div>
        <button type="button" className="btn btn-primary" onClick={save} disabled={pending}>
          {pending ? "saving…" : "Save settings"}
        </button>
      </div>

      {message ? (
        message.tone === "ok" ? (
          <p className="notice" style={{ margin: 0 }} role="status">
            {message.text}
          </p>
        ) : (
          <ErrorNote message={message.text} />
        )
      ) : null}
    </div>
  );
}