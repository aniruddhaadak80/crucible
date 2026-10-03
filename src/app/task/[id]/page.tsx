import Link from "next/link";
import { notFound } from "next/navigation";

import { HeatDial } from "@/components/HeatDial";
import { TaskConsole } from "@/components/TaskConsole";
import { SourceTag, Stage, StatusTag, heatOf } from "@/components/parts";
import { listAudit, getTask } from "@/lib/db/repository.ts";
import { closedModelNote } from "@/lib/live/index.ts";
import { SEED_SCOPE } from "@/lib/seed.ts";
import { integrityView, viewTask } from "@/lib/service.ts";
import { getScope } from "@/lib/session.ts";
import { SEAL_ALGORITHM } from "@/lib/canonical.ts";
import type { ModelFacts } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await getScope();

  // The three bundled reference tasks live in their own scope, so a visitor's
  // own tasks and the examples stay separable. Ownership is resolved with a
  // read rather than by catching an exception, so a store fault cannot
  // masquerade as a 404.
  const owner = (await getTask(scope, id))
    ? scope
    : (await getTask(SEED_SCOPE, id))
      ? SEED_SCOPE
      : null;
  if (!owner) notFound();
  const readOnly = owner === SEED_SCOPE;

  const [view, audit, integrity] = await Promise.all([
    viewTask(owner, id),
    listAudit(owner, id),
    integrityView(owner, id),
  ]);

  const { task, verdict, grade, modelFacts } = view;
  const heat = heatOf(verdict);
  const closedNote = task.targetModel ? closedModelNote(task.targetModel) : null;

  return (
    <div
      className="pour"
      style={{ ["--heat" as string]: heat.toFixed(3) }}
    >
      <Stage label={readOnly ? "Reference task · read-only" : `Task · ${task.status}`}>
        <div
          className="cluster"
          style={{ justifyContent: "space-between", alignItems: "baseline" }}
        >
          <div>
            <h1 className="display" style={{ fontSize: "clamp(2.2rem,5.5vw,3.6rem)", margin: 0 }}>
              {task.name}
            </h1>
            <p className="cluster" style={{ gap: 6, marginTop: 10 }}>
              {readOnly ? <span className="tag">reference</span> : null}
              {task.deletedAt ? <StatusTag tone="fault">tombstone</StatusTag> : null}
              <span className="tag">{task.assertions.length} assertions</span>
              <span className="tag">{task.transcripts.length} transcripts</span>
              <span className="tag">heat {(heat * 100).toFixed(0)}%</span>
              {verdict.degraded ? <StatusTag tone="fault">degraded</StatusTag> : null}
            </p>
          </div>
          <Link className="btn btn-ghost" href="/suite">
            Back to suite
          </Link>
        </div>

        <p className="lede" style={{ marginTop: 18, fontSize: "1.08rem" }}>
          {task.failureMode}
        </p>

        <div className="split" style={{ marginTop: 22 }}>
          <div className="stack" style={{ gap: 8 }}>
            <span className="data muted" style={{ fontSize: 11 }}>PROMPT UNDER TEST</span>
            <pre className="code">{task.prompt}</pre>
          </div>

          <div className="stack" style={{ gap: 12 }}>
            <span className="data muted" style={{ fontSize: 11 }}>PINS</span>
            <div className="scroll-x"><table className="rows">
              <tbody>
                <Pin label="Target model" value={task.targetModel ?? "not pinned"} />
                <Pin label="Revision" value={task.targetRevision ?? "not pinned"} />
                <Pin label="Seed" value={task.seed === null ? "not pinned" : String(task.seed)} />
                <Pin
                  label="Temperature"
                  value={task.targetTemp === null ? "not pinned" : String(task.targetTemp)}
                />
                <Pin label="Token budget" value={String(task.tokenBudget)} />
                <Pin
                  label="Declared inputs"
                  value={
                    task.sealedFixtures.length > 0
                      ? `${task.sealedFixtures.length} sealed`
                      : "none declared"
                  }
                />
              </tbody>
            </table></div>

            {task.sealedFixtures.length > 0 ? (
              <ul className="stack" style={{ gap: 3, margin: 0, paddingLeft: 16 }}>
                {task.sealedFixtures.map((f) => (
                  <li key={f} className="data muted" style={{ fontSize: 11, wordBreak: "break-all" }}>
                    {f}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="notice" style={{ margin: 0 }}>
                No inputs are declared, so a reader cannot replay this task
                byte-for-byte. The engine charges for that in <strong>fixture seal</strong>.
              </p>
            )}

            {closedNote ? (
              <p className="notice" style={{ margin: 0 }}>
                <strong>{task.targetModel}</strong> — {closedNote}
              </p>
            ) : null}

            {modelFacts ? <HubFacts facts={modelFacts} /> : null}
          </div>
        </div>
      </Stage>

      <Stage label="Tap — the grade, and the dial that changes it">
        <HeatDial
          taskId={task.id}
          initialAssertions={task.assertions}
          initialVerdict={verdict}
          initialGrade={grade}
          readOnly={readOnly}
        />
      </Stage>

      <TaskConsole
        task={task}
        grade={grade}
        audit={audit}
        integrity={integrity.integrity}
        readOnly={readOnly}
      />

      <Stage label="Ingot — take it with you">
        <div className="split">
          <div className="stack" style={{ gap: 12 }}>
            <strong style={{ fontSize: 17 }}>Dossier</strong>
            <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
              A file you can keep: the factor table, every transcript grade, the
              sealed inputs, the provenance and the head of the chain.
            </p>
            <div className="cluster">
              <a className="btn btn-ghost" href={`/api/tasks/${task.id}/dossier?format=markdown`}>
                Markdown
              </a>
              <a className="btn btn-ghost" href={`/api/tasks/${task.id}/dossier?format=json`}>
                JSON
              </a>
              <a className="btn btn-ghost" href={`/api/tasks/${task.id}/dossier?format=csv`}>
                CSV
              </a>
            </div>

            <p className="cluster" style={{ marginTop: 10 }}>
              <a className="btn btn-primary" href={`/api/tasks/${task.id}/bundle`}>
                Kaggle bundle
              </a>
              <Link className="btn btn-ghost" href="/dossier">
                Suite dossier
              </Link>
            </p>
          </div>

          <div className="stack" style={{ gap: 12 }}>
            <strong style={{ fontSize: 17 }}>Integrity</strong>
            <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
              {SEAL_ALGORITHM} over canonical JSON, one chain per task, chained from a
              fixed genesis. Recompute it yourself — this endpoint returns the first
              broken link if there is one.
            </p>
            <div className="scroll-x"><table className="rows">
              <tbody>
                <tr>
                  <td>Links checked</td>
                  <td className="data">{integrity.integrity.checked}</td>
                </tr>
                <tr>
                  <td>Replay</td>
                  <td>
                    {integrity.integrity.ok ? (
                      <StatusTag tone="live">intact</StatusTag>
                    ) : (
                      <StatusTag tone="fault">
                        broken at seq {integrity.integrity.brokenAtSeq}
                      </StatusTag>
                    )}
                  </td>
                </tr>
                <tr>
                  <td>Head</td>
                  <td className="data" style={{ fontSize: 11, wordBreak: "break-all" }}>
                    {integrity.integrity.head.slice(0, 40)}…
                  </td>
                </tr>
              </tbody>
            </table></div>
            <a className="btn btn-ghost" href={`/api/tasks/${task.id}/integrity`}>
              Replay via API
            </a>
          </div>
        </div>
      </Stage>
    </div>
  );
}

function Pin({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td className="muted" style={{ whiteSpace: "nowrap" }}>{label}</td>
      <td className="data" style={{ fontSize: 12, wordBreak: "break-all" }}>{value}</td>
    </tr>
  );
}

function HubFacts({ facts }: { facts: ModelFacts }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="cluster" style={{ justifyContent: "space-between" }}>
        <span className="data muted" style={{ fontSize: 11 }}>HUB · {facts.modelId}</span>
        <SourceTag status="live" fetchedAt={facts.fetchedAt} />
      </div>
      <p className="cluster" style={{ gap: 6 }}>
        {facts.gated === true ? <StatusTag tone="fault">gated</StatusTag> : <StatusTag tone="live">open</StatusTag>}
        {facts.revision ? (
          <span className="tag">rev {facts.revision.slice(0, 10)}…</span>
        ) : (
          <span className="tag">no revision</span>
        )}
        {facts.license ? <span className="tag">{facts.license}</span> : null}
      </p>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        Live from the Hugging Face Hub. This is what a third party would find when
        trying to reproduce the run.
      </p>
    </div>
  );
}