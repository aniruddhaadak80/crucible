import Link from "next/link";

import { SourceTag, Stage, StatusTag } from "@/components/parts";
import { DEFAULT_LINEUP } from "@/lib/mcp.ts";
import { listTasks } from "@/lib/db/repository.ts";
import { gradeTask } from "@/lib/grade.ts";
import { closedModelNote, hubLineup } from "@/lib/live/index.ts";
import { SEALED_HUB } from "@/lib/live/fallback.ts";
import { getScope } from "@/lib/session.ts";
import { SEED_SCOPE } from "@/lib/seed.ts";
import { GRADER_VERSION } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Lineup",
  description:
    "Recorded model transcripts re-scored by the deterministic grader, beside live Hugging Face Hub facts about whether each model can be reproduced at all.",
};

/**
 * The lineup.
 *
 * Two questions, kept adjacent on purpose: *how did the models score* and *could
 * a stranger reproduce that score*. A leaderboard that answers only the first is
 * the thing this product exists to argue with.
 */
export default async function LineupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const scope = await getScope();
  const requested = typeof query.task === "string" ? query.task : null;

  const [mine, reference] = await Promise.all([
    listTasks(scope, { limit: 50 }),
    listTasks(SEED_SCOPE, { limit: 10 }),
  ]);

  const all = [...reference.tasks, ...mine.tasks];
  const selected =
    all.find((t) => t.id === requested) ??
    all.find((t) => t.transcripts.length > 0) ??
    all[0] ??
    null;

  const hub = await hubLineup([...DEFAULT_LINEUP]).catch(() => null);
  const hubItems = hub?.items ?? SEALED_HUB;
  const hubStatus = hub?.status ?? "fallback";
  const hubFetched = hub?.fetchedAt ?? SEALED_HUB[0]?.lastModified ?? new Date(0).toISOString();

  return (
    <div className="pour">
      <Stage label="Lineup — recorded transcripts, re-scored">
        <h1 className="display" style={{ fontSize: "clamp(2.4rem,6vw,4rem)", margin: "0 0 12px" }}>
          The lineup
        </h1>
        <p className="muted" style={{ maxWidth: "66ch" }}>
          Every row below was produced by <code className="data">{GRADER_VERSION}</code>,
          the same function the API and the agent tools call. Nothing is inherited
          from a leaderboard elsewhere.
        </p>

        {all.length === 0 ? (
          <p className="notice" style={{ marginTop: 20 }}>
            No tasks exist yet, so there is nothing to rank.{" "}
            <Link href="/forge" style={{ color: "var(--accent)" }}>
              Forge one
            </Link>
            .
          </p>
        ) : null}

        <nav className="cluster" style={{ marginTop: 20 }} aria-label="Choose a task to rank">
          {all
            .filter((t) => t.transcripts.length > 0)
            .map((t) => (
              <Link
                key={t.id}
                className={`btn ${selected?.id === t.id ? "btn-primary" : "btn-ghost"}`}
                style={{ fontSize: 12, padding: "8px 12px" }}
                href={`/lineup?task=${t.id}`}
                scroll={false}
              >
                {t.name}
              </Link>
            ))}
        </nav>

        {selected && selected.transcripts.length > 0 ? (
          <RankingTable taskId={selected.id} taskName={selected.name} task={selected} />
        ) : null}
      </Stage>

      <Stage label="Can anyone reproduce this?">
        <div className="cluster" style={{ justifyContent: "space-between" }}>
          <p className="muted" style={{ fontSize: 13.5, maxWidth: "62ch", margin: 0 }}>
            A score you cannot rerun is a rumour. These are live facts from the
            Hugging Face Hub about the models above: whether the weights are gated,
            and whether a pinnable revision exists at all.
          </p>
          <SourceTag status={hubStatus} fetchedAt={hubFetched} reason={hub?.degradedReason} />
        </div>

        <table className="rows" style={{ marginTop: 18 }}>
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Reproducible?</th>
              <th scope="col">Revision</th>
              <th scope="col">License</th>
              <th scope="col">Downloads</th>
            </tr>
          </thead>
          <tbody>
            {DEFAULT_LINEUP.map((modelId) => {
              const facts = hubItems.find((m) => m.modelId === modelId);
              const note = closedModelNote(modelId);
              return (
                <tr key={modelId}>
                  <td className="data" style={{ fontSize: 11.5 }}>{modelId}</td>
                  <td>
                    {!facts ? (
                      <StatusTag tone="fault">no public repo</StatusTag>
                    ) : facts.gated === true ? (
                      <StatusTag tone="fault">gated</StatusTag>
                    ) : facts.revision ? (
                      <StatusTag tone="live">pinnable</StatusTag>
                    ) : (
                      <StatusTag tone="fault">no revision</StatusTag>
                    )}
                    {note ? (
                      <>
                        <br />
                        <span className="muted" style={{ fontSize: 11.5 }}>
                          {note}
                        </span>
                      </>
                    ) : null}
                  </td>
                  <td className="data muted" style={{ fontSize: 11 }}>
                    {facts?.revision ? `${facts.revision.slice(0, 12)}…` : "—"}
                  </td>
                  <td className="data" style={{ fontSize: 11 }}>{facts?.license ?? "—"}</td>
                  <td className="data">
                    {facts?.downloads ? facts.downloads.toLocaleString() : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <p className="muted" style={{ fontSize: 11.5, marginTop: 12 }}>
          {hub?.attribution ??
            "Model metadata from the Hugging Face Hub public API."}{" "}
          Counter values are Hub totals, not usage telemetry.
        </p>
      </Stage>
    </div>
  );
}

function RankingTable({
  taskId,
  taskName,
  task,
}: {
  taskId: string;
  taskName: string;
  task: Parameters<typeof gradeTask>[0];
}) {
  const { grade, verdict } = gradeTask(task);
  const ranked = [...grade.grades].sort((a, b) => b.score - a.score || a.modelId.localeCompare(b.modelId));

  return (
    <div style={{ marginTop: 26 }}>
      <div className="cluster" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <strong style={{ fontSize: 17 }}>{taskName}</strong>
        <span className="cluster" style={{ gap: 6 }}>
          <span className="tag">sigma {grade.spread.toFixed(4)}</span>
          <span className="tag">mean {grade.meanScore.toFixed(4)}</span>
          {grade.spread === 0 ? <StatusTag tone="fault">cannot discriminate</StatusTag> : null}
        </span>
      </div>

      <div className="scroll-x"><table className="rows">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Model</th>
            <th scope="col">Score</th>
            <th scope="col">Pass / fail / open</th>
            <th scope="col">Latency</th>
            <th scope="col">Tokens</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((g, i) => (
            <tr key={g.transcriptId}>
              <td className="data">{i + 1}</td>
              <td>
                <span className="data" style={{ fontSize: 12 }}>{g.modelId}</span>
                <div className="bar" style={{ marginTop: 6, maxWidth: 180 }}>
                  <span style={{ width: `${Math.round(g.score * 100)}%` }} />
                </div>
              </td>
              <td className="data" style={{ fontSize: 18 }}>{g.score.toFixed(4)}</td>
              <td className="data" style={{ fontSize: 12 }}>
                {g.outcomes.filter((o) => o.passed === true).length} /{" "}
                {g.outcomes.filter((o) => o.passed === false).length} /{" "}
                <span style={{ color: "var(--color-ash)" }}>
                  {g.outcomes.filter((o) => o.passed === null).length}
                </span>
              </td>
              <td className="data">{g.latencyMs} ms</td>
              <td className="data">{g.tokensOut}</td>
            </tr>
          ))}
        </tbody>
      </table></div>

      <p className="muted" style={{ fontSize: 12.5, marginTop: 14, maxWidth: "70ch" }}>
        Ranked by {verdict.engineVersion}. If every row above is identical, the task
        is measuring agreement rather than capability — the engine charges that as{" "}
        <strong>discrimination</strong> and the verdict says so.
      </p>

      <p className="cluster" style={{ marginTop: 12 }}>
        <Link className="btn btn-ghost" href={`/task/${taskId}`}>
          Open the task
        </Link>
      </p>
    </div>
  );
}