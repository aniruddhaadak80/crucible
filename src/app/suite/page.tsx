import Link from "next/link";

import { Empty, Seal, Stage, StatusTag, heatOf } from "@/components/parts";
import { listTaskViews } from "@/lib/service.ts";
import { getScope } from "@/lib/session.ts";
import { SEED_SCOPE } from "@/lib/seed.ts";
import type { TaskSummary } from "@/lib/service.ts";
import { TASK_STATUSES, type TaskStatus } from "@/lib/types.ts";

export const dynamic = "force-dynamic";

/**
 * The suite.
 *
 * Two lists, deliberately separate: the bundled reference tasks (read-only,
 * owned by the seed scope) and the visitor's own session. Mixing them would
 * imply the reference tasks are the visitor's work.
 */
export default async function SuitePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const scope = await getScope();

  const requested = typeof query.status === "string" ? query.status : null;
  const status = TASK_STATUSES.includes(requested as TaskStatus)
    ? (requested as TaskStatus)
    : null;

  const [mine, reference] = await Promise.all([
    listTaskViews(scope, {
      limit: 50,
      before: typeof query.before === "string" ? query.before : null,
      status,
      includeRetired: query.retired === "true",
    }),
    listTaskViews(SEED_SCOPE, { limit: 10, status }),
  ]);

  return (
    <div className="pour">
      <Stage label="Suite — your session">
        <div
          className="cluster"
          style={{ justifyContent: "space-between", alignItems: "baseline" }}
        >
          <div>
            <h1 className="display" style={{ fontSize: "clamp(2.4rem,6vw,4rem)", margin: 0 }}>
              The suite
            </h1>
            <p className="muted" style={{ fontSize: 14, maxWidth: "62ch" }}>
              Everything below belongs to this browser session. There are no
              accounts; a scope cookie owns the rows and nothing else can read
              them.
            </p>
          </div>
          <Link className="btn btn-primary" href="/forge">
            Forge a task
          </Link>
        </div>

        {/* Filter state lives in the URL so a filtered view can be shared or
            reloaded without losing it. */}
        <nav className="cluster" style={{ marginTop: 20 }} aria-label="Filter by status">
          <Link
            className={`btn ${status === null ? "btn-primary" : "btn-ghost"}`}
            href="/suite"
            scroll={false}
          >
            All
          </Link>
          {TASK_STATUSES.map((s) => (
            <Link
              key={s}
              className={`btn ${status === s ? "btn-primary" : "btn-ghost"}`}
              href={`/suite?status=${s}`}
              scroll={false}
            >
              {s}
            </Link>
          ))}
          <Link
            className={`btn ${query.retired === "true" ? "btn-primary" : "btn-ghost"}`}
            href={`/suite?retired=${query.retired === "true" ? "false" : "true"}`}
            scroll={false}
          >
            {query.retired === "true" ? "Hide tombstones" : "Show tombstones"}
          </Link>
        </nav>

        <div style={{ marginTop: 24 }}>
          {mine.tasks.length === 0 ? (
            <Empty
              title="Nothing forged in this session yet"
              body="A task is a failure you have seen, a prompt that provokes it, and assertions that decide it without asking a model whether the answer was good. Forge the first one and it is written to the database immediately."
              action={
                <Link className="btn btn-primary" href="/forge">
                  Open the forge
                </Link>
              }
            />
          ) : (
            <TaskTable tasks={mine.tasks} total={mine.total} />
          )}
        </div>
      </Stage>

      <Stage label="Reference — bundled, read-only">
        <p className="muted" style={{ maxWidth: "68ch", marginTop: 0 }}>
          These three ship with the app so the engine is legible before you write
          anything. Their transcripts are <strong style={{ color: "var(--color-bone-dim)" }}>
          bundled reference material, not live model runs</strong>, and between them they
          produce a publishable verdict, a judge-bound verdict and a
          non-discriminating one.
        </p>

        <div style={{ marginTop: 20 }}>
          {reference.tasks.length === 0 ? (
            <Empty
              title="Reference tasks unavailable"
              body="The bundled reference set could not be read from the database. If this persists on a deployed instance the store is unhealthy; /api/health reports the round trip."
            />
          ) : (
            <TaskTable tasks={reference.tasks} total={reference.total} />
          )}
        </div>
      </Stage>
    </div>
  );
}

function TaskTable({ tasks, total }: { tasks: TaskSummary[]; total: number }) {
  return (
    <div className="scroll-x"><table className="rows">
      <caption className="sr-only">
        Benchmark tasks with their engine verdict. {tasks.length} shown of {total}.
      </caption>
      <thead>
        <tr>
          <th scope="col">Task</th>
          <th scope="col">Grade</th>
          <th scope="col">Band</th>
          <th scope="col">Pins</th>
          <th scope="col">Decision</th>
          <th scope="col">Seal</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => {
          const pins =
            (task.verdict.factors.find((f) => f.id === "fixture_seal")?.value ?? 0) >= 0.99;
          return (
            <tr key={task.id}>
              <td>
                <Link
                  href={`/task/${task.id}`}
                  style={{ color: "var(--color-bone)", textDecoration: "none" }}
                >
                  <strong>{task.name}</strong>
                </Link>
                <br />
                <span className="muted" style={{ fontSize: 12.5 }}>
                  {task.failureMode.slice(0, 96)}
                  {task.failureMode.length > 96 ? "…" : ""}
                </span>
                <br />
                <span className="cluster" style={{ gap: 6, marginTop: 4 }}>
                  {task.sealedReference ? <span className="tag">reference</span> : null}
                  {task.deletedAt ? <span className="tag tag-fault">tombstone</span> : null}
                  <span className="tag">
                    {task.assertionCount} assertion{task.assertionCount === 1 ? "" : "s"}
                  </span>
                  <span className="tag">
                    {task.transcriptCount} transcript{task.transcriptCount === 1 ? "" : "s"}
                  </span>
                  {task.verdict.degraded ? <StatusTag tone="fault">degraded</StatusTag> : null}
                </span>
              </td>
              <td>
                <span
                  className="data"
                  style={{ fontSize: 22, color: "var(--accent)" }}
                >
                  {task.verdict.score.toFixed(1)}
                </span>
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                <span className="data" style={{ fontSize: 12 }}>
                  {task.verdict.band.label}
                </span>
                <br />
                <span className="muted" style={{ fontSize: 11 }}>
                  heat {(heatOf(task.verdict) * 100).toFixed(0)}%
                </span>
              </td>
              <td>{pins ? <span className="tag tag-live">pinned</span> : <span className="tag">loose</span>}</td>
              <td style={{ fontSize: 13 }}>
                {task.decision ? (
                  <>
                    <strong>{task.decision.verdict}</strong>
                    <br />
                    <span className="muted" style={{ fontSize: 12 }}>
                      {task.decision.note.slice(0, 48)}
                    </span>
                  </>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td>
                <Seal value={task.seal} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table></div>
  );
}