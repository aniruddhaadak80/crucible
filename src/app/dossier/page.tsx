import Link from "next/link";

import { Empty, Stage, StatusTag } from "@/components/parts";
import { listTasks } from "@/lib/db/repository.ts";
import { getScope } from "@/lib/session.ts";
import { SEED_SCOPE } from "@/lib/seed.ts";
import { SITE } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dossier export",
  description:
    "Download the suite as Markdown, JSON or CSV with factor tables, per-transcript grades, provenance and the audit chain head attached.",
};

const FORMATS = [
  {
    id: "markdown",
    label: "Markdown",
    blurb: "The readable one. Factor table, per-transcript grades, sealed inputs, provenance, chain head.",
    media: "text/markdown",
  },
  {
    id: "json",
    label: "JSON",
    blurb: "The whole task plus verdict, grade and replay result. This is what a script should read.",
    media: "application/json",
  },
  {
    id: "csv",
    label: "CSV",
    blurb: "One row per recorded transcript, for a spreadsheet. Drops into a leaderboard notebook as-is.",
    media: "text/csv",
  },
] as const;

/**
 * Dossier export.
 *
 * The takeaway artefact. Everything downloadable lives behind one endpoint per
 * task, so an export and the page it was generated from can never disagree.
 */
export default async function DossierPage() {
  const scope = await getScope();
  const [mine, reference] = await Promise.all([
    listTasks(scope, { limit: 50, includeRetired: true }),
    listTasks(SEED_SCOPE, { limit: 10 }),
  ]);

  const all = [...reference.tasks, ...mine.tasks];

  return (
    <div className="pour">
      <Stage label="Dossier — take the suite with you">
        <h1 className="display" style={{ fontSize: "clamp(2.4rem,6vw,4rem)", margin: "0 0 12px" }}>
          The dossier
        </h1>
        <p className="lede">
          Every export carries the six factor weights, the per-transcript grades, the
          sealed inputs, where the data came from, and the head of the audit chain —
          so a reader can check the number instead of trusting it.
        </p>

        {all.length === 0 ? (
          <Empty
            title="Nothing to export yet"
            body="Forge a task and it becomes exportable immediately. The bundled reference tasks are exportable now."
            action={
              <Link className="btn btn-primary" href="/forge">
                Open the forge
              </Link>
            }
          />
        ) : null}
      </Stage>

      <Stage label="Download">
        <div className="scroll-x"><table className="rows">
          <thead>
            <tr>
              <th scope="col">Task</th>
              <th scope="col">State</th>
              {FORMATS.map((f) => (
                <th scope="col" key={f.id}>{f.label}</th>
              ))}
              <th scope="col">Kaggle bundle</th>
            </tr>
          </thead>
          <tbody>
            {all.map((task) => (
              <tr key={`${task.id}-${task.scope}`}>
                <td>
                  <Link
                    href={`/task/${task.id}`}
                    style={{ color: "var(--color-bone)", textDecoration: "none" }}
                  >
                    <strong>{task.name}</strong>
                  </Link>
                  <br />
                  <span className="muted" style={{ fontSize: 12 }}>
                    {task.transcripts.length} transcript
                    {task.transcripts.length === 1 ? "" : "s"} ·{" "}
                    {task.assertions.length} assertion
                    {task.assertions.length === 1 ? "" : "s"}
                  </span>
                </td>
                <td>
                  {task.scope === SEED_SCOPE ? (
                    <span className="tag">reference</span>
                  ) : task.deletedAt ? (
                    <StatusTag tone="fault">tombstone</StatusTag>
                  ) : (
                    <StatusTag tone="live">live</StatusTag>
                  )}
                </td>
                {FORMATS.map((f) => (
                  <td key={f.id}>
                    <a
                      className="btn btn-ghost"
                      style={{ fontSize: 11, padding: "6px 10px", minHeight: 34 }}
                      href={`/api/tasks/${task.id}/dossier?format=${f.id}`}
                    >
                      {f.label}
                    </a>
                  </td>
                ))}
                <td>
                  <a
                    className="btn btn-ghost"
                    style={{ fontSize: 11, padding: "6px 10px", minHeight: 34 }}
                    href={`/api/tasks/${task.id}/bundle`}
                  >
                    files
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>

        <div className="split" style={{ marginTop: 24 }}>
          {FORMATS.map((f) => (
            <div key={f.id} className="stack" style={{ gap: 6 }}>
              <strong style={{ fontSize: 15 }}>{f.label}</strong>
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                {f.blurb}
              </p>
              <span className="data muted" style={{ fontSize: 11 }}>
                {f.media}
              </span>
            </div>
          ))}
        </div>
      </Stage>

      <Stage label="What every export contains">
        <ul className="stack" style={{ gap: 10, paddingLeft: 18, margin: 0, maxWidth: "70ch" }}>
          <li>
            The six published weights and each factor&rsquo;s real contribution, so the
            bars sum to the score.
          </li>
          <li>
            Every assertion outcome with the exact span or value that decided it.
          </li>
          <li>
            Which transcripts are recorded runs and which are bundled reference
            material, labelled individually.
          </li>
          <li>
            Where external data came from, when it was retrieved, and whether it was{" "}
            <code className="data">live</code> or a sealed snapshot.
          </li>
          <li>
            The chain head plus the command to recompute it:{" "}
            <code className="data">curl {SITE.apiBase}/tasks/&lt;id&gt;/integrity</code>
          </li>
        </ul>
        <p className="notice" style={{ marginTop: 18 }}>
          <strong>Caveat carried in every file:</strong> a grade is a statement about a
          task, not about a model. Where a grade would need a language-model judge,
          the weight is reported as undecided rather than counted as a pass.
        </p>
      </Stage>
    </div>
  );
}