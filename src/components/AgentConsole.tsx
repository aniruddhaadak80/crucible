"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

type Preset = {
  tool: string;
  title: string;
  kind: "read" | "analysis" | "write";
  blurb: string;
  /** Arguments with `{{taskId}}` substituted at send time. */
  args: (taskId: string) => Record<string, unknown>;
  mutating: boolean;
};

const PRESETS: Preset[] = [
  {
    tool: "list_tasks",
    title: "List tasks",
    kind: "read",
    blurb: "Everything in this session, newest first, each with its verdict.",
    mutating: false,
    args: () => ({ limit: 10 }),
  },
  {
    tool: "rank_lineup",
    title: "Rank the lineup",
    kind: "analysis",
    blurb: "Re-grade every recorded transcript and rank the models.",
    mutating: false,
    args: (id) => ({ id }),
  },
  {
    tool: "grade_task",
    title: "Run the engine",
    kind: "analysis",
    blurb: "Re-grade with live Hub facts and seal the verdict into the chain.",
    mutating: true,
    args: (id) => ({ id }),
  },
  {
    tool: "verify_integrity",
    title: "Replay the chain",
    kind: "read",
    blurb: "Recompute every seal and report the first broken link.",
    mutating: false,
    args: (id) => ({ id }),
  },
  {
    tool: "export_bundle",
    title: "Export the Kaggle bundle",
    kind: "read",
    blurb: "A runnable task file plus the commands to push and run it.",
    mutating: false,
    args: (id) => ({ id }),
  },
  {
    tool: "live_signals",
    title: "Read live signals",
    kind: "read",
    blurb: "Hub facts per model plus the newest arXiv evaluation papers.",
    mutating: false,
    args: () => ({ paperLimit: 4 }),
  },
  {
    tool: "record_decision",
    title: "Record a decision",
    kind: "write",
    blurb: "Files adopt/iterate/discard. Idempotent on the supplied key.",
    mutating: true,
    args: (id) => ({
      id,
      verdict: "iterate",
      note: "Tighten the substring assertions before publishing.",
      idempotencyKey: "console-demo-decision",
    }),
  },
  {
    tool: "retire_task",
    title: "Retire as tombstone",
    kind: "write",
    blurb: "Soft delete. The tombstone is kept so the chain still replays.",
    mutating: true,
    args: (id) => ({ id }),
  },
];

export function AgentConsole({ taskId, tools }: { taskId: string | null; tools: { name: string; kind: string; mutates: boolean; title: string; description: string }[] }) {
  const [preset, setPreset] = useState(PRESETS[1]);
  const [rawArgs, setRawArgs] = useState<string>(JSON.stringify(PRESETS[1].args(taskId ?? "TASK_ID"), null, 2));
  const [request, setRequest] = useState<string>("");
  const [response, setResponse] = useState<string>("");
  const [resultLinks, setResultLinks] = useState<{ label: string; href: string }[]>([]);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(p: Preset) {
    setPreset(p);
    setRawArgs(JSON.stringify(p.args(taskId ?? "TASK_ID"), null, 2));
    setResultLinks([]);
    setRpcError(null);
  }

  /** Pull navigable links out of whatever the tool returned. */
  function linksFrom(payload: unknown): { label: string; href: string }[] {
    const out: { label: string; href: string }[] = [];
    const visit = (node: unknown, depth: number) => {
      if (depth > 4 || node === null || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach((n) => visit(n, depth + 1));
        return;
      }
      const record = node as Record<string, unknown>;
      // MCP wraps tool output in structuredContent.
      const task = record.task as Record<string, unknown> | undefined;
      if (task && typeof task.id === "string") {
        out.push({ label: `Open task ${String(task.name ?? task.id)}`, href: `/task/${task.id}` });
      }
      const tasks = record.tasks as unknown;
      if (Array.isArray(tasks)) {
        for (const t of tasks.slice(0, 6)) {
          const row = t as Record<string, unknown>;
          if (typeof row.id === "string") {
            out.push({ label: String(row.name ?? row.id), href: `/task/${row.id}` });
          }
        }
      }
      Object.values(record).forEach((v) => visit(v, depth + 1));
    };
    visit(payload, 0);
    const seen = new Set<string>();
    return out.filter((l) => (seen.has(l.href) ? false : (seen.add(l.href), true))).slice(0, 8);
  }

  function send() {
    setRpcError(null);
    setResultLinks([]);

    let args: unknown;
    try {
      args = rawArgs.trim() === "" ? {} : JSON.parse(rawArgs);
    } catch {
      setRpcError("Arguments must be valid JSON. The request was not sent.");
      return;
    }

    const payload = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: preset.tool, arguments: args },
    };
    setRequest(JSON.stringify(payload, null, 2));

    startTransition(async () => {
      try {
        const res = await fetch("/api/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = (await res.json().catch(() => null)) as
          | { result?: { structuredContent?: unknown }; error?: { code: number; message: string; data?: unknown } }
          | null;

        setResponse(JSON.stringify(body, null, 2));

        if (body?.error) {
          setRpcError(`JSON-RPC ${body.error.code}: ${body.error.message}`);
          return;
        }
        if (body?.result?.structuredContent) {
          setResultLinks(linksFrom(body.result.structuredContent));
        }
      } catch {
        setResponse("");
        setRpcError("The endpoint could not be reached. The request was not processed.");
      }
    });
  }

  async function initialize() {
    setRpcError(null);
    const payload = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} };
    setRequest(JSON.stringify(payload, null, 2));
    try {
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      setResponse(JSON.stringify(await res.json(), null, 2));
    } catch {
      setRpcError("The endpoint could not be reached.");
    }
  }

  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="cluster">
        <button type="button" className="btn btn-ghost" onClick={initialize}>
          initialize
        </button>
        <span className="muted" style={{ fontSize: 12.5 }}>
          {tools.length} tools registered. Every mutating tool calls the same
          service layer these buttons do.
        </span>
      </div>

      <div className="cluster" style={{ gap: 8 }} role="group" aria-label="Choose a tool">
        {PRESETS.map((p) => (
          <button
            key={p.tool}
            type="button"
            className={`btn ${preset.tool === p.tool ? "btn-primary" : "btn-ghost"}`}
            style={{ fontSize: 12, padding: "8px 12px" }}
            aria-pressed={preset.tool === p.tool}
            onClick={() => choose(p)}
          >
            {p.tool}
          </button>
        ))}
      </div>

      <div className="split">
        <div className="stack" style={{ gap: 10 }}>
          <div>
            <strong style={{ fontSize: 16 }}>{preset.title}</strong>
            <p className="muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
              {preset.blurb}
            </p>
          </div>
          <label className="stack" style={{ gap: 6 }}>
            <span className="data" style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-ash)" }}>
              Arguments
            </span>
            <textarea
              className="field"
              rows={8}
              value={rawArgs}
              onChange={(e) => setRawArgs(e.target.value)}
              spellCheck={false}
            />
          </label>
          {preset.mutating ? (
            <p className="notice" style={{ margin: 0 }}>
              This tool writes to the database and extends the audit chain. It is
              idempotent on <code className="data">idempotencyKey</code>, so retrying
              with the same key does not mutate twice.
            </p>
          ) : null}
          <div>
            <button type="button" className="btn btn-primary" onClick={send} disabled={pending}>
              {pending ? "calling…" : "Call tool"}
            </button>
          </div>
          {rpcError ? (
            <p className="notice notice-fault" role="alert" style={{ margin: 0 }}>
              {rpcError}
            </p>
          ) : null}
          {resultLinks.length > 0 ? (
            <div className="cluster">
              {resultLinks.map((l) => (
                <Link key={l.href} className="btn btn-ghost" style={{ fontSize: 12 }} href={l.href}>
                  {l.label}
                </Link>
              ))}
            </div>
          ) : null}
        </div>

        <div className="stack" style={{ gap: 10 }}>
          <div>
            <p className="data" style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-ash)", margin: "0 0 6px" }}>
              Request
            </p>
            <pre className="code">{request || "—"}</pre>
          </div>
          <div>
            <p className="data" style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-ash)", margin: "0 0 6px" }}>
              Response
            </p>
            <pre className="code">{response || "—"}</pre>
          </div>
        </div>
      </div>

      <div>
        <p className="stage-label" style={{ marginBottom: 10 }}>Registered tools</p>
        <div className="scroll-x"><table className="rows">
          <thead>
            <tr>
              <th scope="col">Tool</th>
              <th scope="col">Kind</th>
              <th scope="col">Purpose</th>
            </tr>
          </thead>
          <tbody>
            {tools.map((t) => (
              <tr key={t.name}>
                <td className="data" style={{ fontSize: 12 }}>{t.name}</td>
                <td>
                  <span className={`tag ${t.mutates ? "" : "tag-live"}`}>{t.kind}</span>
                </td>
                <td className="muted" style={{ fontSize: 12.5 }}>{t.title}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}