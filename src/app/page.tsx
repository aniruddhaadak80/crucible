import Link from "next/link";

import { GitHubMark } from "@/components/GitHubMark";
import { SourceTag, Stage, Verdict, heatOf } from "@/components/parts";
import { gradeTask } from "@/lib/grade.ts";
import { ARXIV_QUERY, arxivFeed, hubLineup } from "@/lib/live/index.ts";
import { DEFAULT_LINEUP } from "@/lib/mcp.ts";
import { listTasks } from "@/lib/db/repository.ts";
import { GRADE_BANDS, GRADE_WEIGHTS, WEIGHT_SUM } from "@/lib/grade.ts";
import { SEALED_HUB } from "@/lib/live/fallback.ts";
import { GITHUB_URL, SITE } from "@/lib/site";
import { ENGINE_VERSION } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  // The reference tasks are stored rows, so the numbers on this page are
  // produced by the same engine the API and the agent tools run.
  const reference = (await listTasks("seed", { limit: 3 })).tasks;
  const verdicts = reference.map((task) => ({ task, verdict: gradeTask(task).verdict }));

  const [hub, papers] = await Promise.all([
    hubLineup([...DEFAULT_LINEUP]).catch(() => null),
    arxivFeed(ARXIV_QUERY, 4).catch(() => null),
  ]);

  const hubShown = hub ?? {
    status: "fallback" as const,
    fetchedAt: SEALED_HUB[0]?.lastModified ?? new Date(0).toISOString(),
    attribution: "",
    degradedReason: "The Hub was unreachable.",
    items: SEALED_HUB,
  };

  const gated = hubShown.items.filter((m) => m.gated === true).length;
  const pinnable = hubShown.items.filter((m) => Boolean(m.revision)).length;

  return (
    <div className="pour">
      {/* ---------------- CHARGE ---------------- */}
      <Stage label="Charge">
        <p className="display hero" style={{ margin: "0 0 20px" }}>
          Charge the failure.
          <br />
          <span style={{ color: "var(--accent)" }}>Pour the task.</span>
        </p>

        <p className="lede" style={{ marginBottom: 22 }}>
          {SITE.lede}
        </p>

        <div className="cluster" style={{ gap: 12 }}>
          <Link className="btn btn-primary" href="/forge">
            Forge a task
          </Link>
          <Link className="btn btn-ghost" href="/suite">
            Open the suite
          </Link>
          <a
            className="btn btn-ghost"
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            <GitHubMark size={15} />
            View source
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>

        <div className="split" style={{ marginTop: 34 }}>
          <div className="stack" style={{ gap: 10 }}>
            <span className="data muted" style={{ fontSize: 11 }}>ENGINE</span>
            <span className="data" style={{ fontSize: 14 }}>{ENGINE_VERSION}</span>
            <span className="muted" style={{ fontSize: 13 }}>
              Six weighted factors summing to {WEIGHT_SUM.toFixed(2)}, each produced
              from a measured quantity with the sentence that produced it attached.
            </span>
          </div>
          <div className="stack" style={{ gap: 10 }}>
            <span className="data muted" style={{ fontSize: 11 }}>GRADER</span>
            <span className="data" style={{ fontSize: 14 }}>exact assertions only</span>
            <span className="muted" style={{ fontSize: 13 }}>
              String, regex, JSON-path and numeric-range comparison against the
              recorded completion. No language model is asked whether an answer is
              good, so a score can be replayed.
            </span>
          </div>
        </div>
      </Stage>

      {/* ---------------- MOULD ---------------- */}
      <Stage label="Mould — three reference tasks, three verdicts">
        <p className="muted" style={{ maxWidth: "66ch", marginTop: 0 }}>
          The three tasks below ship with the app. Their transcripts are{" "}
          <strong style={{ color: "var(--color-bone-dim)" }}>bundled reference
          material, not live model runs</strong> — but the grades are computed live by
          the real engine every time this page renders.
        </p>

        <div className="split" style={{ marginTop: 22 }}>
          {verdicts.map(({ task, verdict }) => (
            <div
              key={task.id}
              // The ground hue of each panel is that task's measured model
              // dependence. A judge-bound task genuinely glows hotter.
              style={{
                ["--heat" as string]: heatOf(verdict).toFixed(3),
                border: "1px solid var(--rule)",
                padding: 18,
              }}
            >
              <div className="cluster" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                <strong style={{ fontSize: 16 }}>{task.name}</strong>
                <span className="tag">{verdict.band.id}</span>
              </div>
              <p className="muted" style={{ fontSize: 13, marginTop: 0, minHeight: "5.5em" }}>
                {task.failureMode}
              </p>
              <Verdict verdict={verdict} compact />
              <p style={{ margin: "14px 0 0" }}>
                <Link className="btn btn-ghost" href={`/task/${task.id}`}>
                  Inspect
                </Link>
              </p>
            </div>
          ))}
        </div>
      </Stage>

      {/* ---------------- TAP ---------------- */}
      <Stage label="Tap — what a grade actually measures">
        <div className="split">
          <div>
            <div className="scroll-x"><table className="rows">
              <caption className="sr-only">
                Published factor weights and what each one measures
              </caption>
              <thead>
                <tr>
                  <th scope="col">Factor</th>
                  <th scope="col">Weight</th>
                  <th scope="col">What it measures</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(GRADE_WEIGHTS).map(([id, weight]) => (
                  <tr key={id}>
                    <td className="data" style={{ fontSize: 12 }}>
                      {id.replace(/_/g, " ")}
                    </td>
                    <td className="data">{weight.toFixed(2)}</td>
                    <td className="muted">{FACTOR_MEANING[id]}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>

          <div className="stack" style={{ gap: 14 }}>
            <div>
              <p className="stage-label" style={{ marginBottom: 8 }}>Bands</p>
              <div className="scroll-x"><table className="rows">
                <tbody>
                  {GRADE_BANDS.map((band) => (
                    <tr key={band.id}>
                      <td className="data" style={{ whiteSpace: "nowrap", width: 110 }}>
                        {band.min}–{band.max}
                      </td>
                      <td>
                        <strong style={{ fontSize: 14 }}>{band.label}</strong>
                        <br />
                        <span className="muted" style={{ fontSize: 12.5 }}>
                          {band.action}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          </div>
        </div>
      </Stage>

      {/* ---------------- INGOT ---------------- */}
      <Stage label="Ingot — live signals behind the suite">
        <div className="split">
          <div className="stack" style={{ gap: 12 }}>
            <div className="cluster" style={{ justifyContent: "space-between" }}>
              <strong style={{ fontSize: 16 }}>
                <a
                  href="https://huggingface.co"
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  style={{ color: "inherit" }}
                >
                  Hugging Face Hub
                </a>{" "}
                model facts
              </strong>
              <SourceTag
                status={hubShown.status}
                fetchedAt={hubShown.fetchedAt}
                reason={hubShown.degradedReason}
              />
            </div>
            <p className="muted" style={{ fontSize: 13.5, marginTop: 0 }}>
              {pinnable} of {hubShown.items.length} lineup models expose a pinnable
              revision. {gated} are gated. The rest publish no public repository at
              all — which means <strong>nobody outside the provider can reproduce a
              pinned run against them</strong>, whatever a leaderboard claims.
            </p>
            <div className="scroll-x"><table className="rows">
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col">Gated</th>
                  <th scope="col">Revision</th>
                  <th scope="col">Downloads</th>
                </tr>
              </thead>
              <tbody>
                {hubShown.items.slice(0, 5).map((m) => (
                  <tr key={m.modelId}>
                    <td className="data" style={{ fontSize: 11.5 }}>{m.modelId}</td>
                    <td>
                      {m.gated === true ? (
                        <span className="tag tag-fault">gated</span>
                      ) : (
                        <span className="tag">open</span>
                      )}
                    </td>
                    <td className="data muted" style={{ fontSize: 11 }}>
                      {m.revision ? `${m.revision.slice(0, 10)}…` : "none"}
                    </td>
                    <td className="data">{m.downloads?.toLocaleString() ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            {hubShown.degradedReason ? (
              <p className="notice" style={{ margin: 0 }}>
                {hubShown.degradedReason}
              </p>
            ) : null}
            <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>
              {hubShown.attribution}
            </p>
          </div>

          <div className="stack" style={{ gap: 12 }}>
            <div className="cluster" style={{ justifyContent: "space-between" }}>
              <strong style={{ fontSize: 16 }}>
                <a
                  href="https://arxiv.org/list/cs.CL/recent"
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  style={{ color: "inherit" }}
                >
                  arXiv
                </a>{" "}
                cs.CL evaluation papers
              </strong>
              <SourceTag
                status={papers?.status ?? "fallback"}
                fetchedAt={papers?.fetchedAt ?? new Date(0).toISOString()}
                reason={papers?.degradedReason}
              />
            </div>
            <div className="scroll-x"><table className="rows">
              <tbody>
                {(papers?.items ?? []).map((p) => (
                  <tr key={p.id}>
                    <td>
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        style={{ color: "var(--color-bone)", textDecoration: "none" }}
                      >
                        {p.title}
                      </a>
                      <br />
                      <span className="data muted" style={{ fontSize: 11 }}>
                        {p.publishedAt.slice(0, 10)}
                        {p.mentionedModels.length > 0
                          ? ` · names ${p.mentionedModels.join(", ")}`
                          : ""}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            {papers && papers.items.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>
                No papers returned for this query.
              </p>
            ) : null}
          </div>
        </div>
      </Stage>

      {/* ---------------- COOL ---------------- */}
      <Stage label="Cool — take it with you">
        <div className="split">
          <div className="stack" style={{ gap: 12 }}>
            <strong style={{ fontSize: 18 }}>What a visitor can actually do</strong>
            <ol className="stack" style={{ gap: 10, paddingLeft: 18, margin: 0 }}>
              <li>
                <strong>Forge.</strong> Paste a failure mode, write assertions, record
                transcripts. Every row is written to the production database.
              </li>
              <li>
                <strong>Inspect.</strong> Read the assertion tape: every outcome with
                the exact span or value that decided it.
              </li>
              <li>
                <strong>Turn the dial.</strong> Move model dependence and watch the
                engine re-grade and the ground hue shift.
              </li>
              <li>
                <strong>Export.</strong> Download a Markdown, JSON or CSV dossier with
                the seal chain attached, or the Kaggle bundle that grades identically.
              </li>
            </ol>
            <p className="cluster" style={{ gap: 10 }}>
              <Link className="btn btn-primary" href="/forge">
                Start forging
              </Link>
              <Link className="btn btn-ghost" href="/agent">
                Agent console
              </Link>
              <a
                className="btn btn-ghost"
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                <GitHubMark size={15} />
                Star on GitHub
              </a>
            </p>
          </div>

          <div className="stack" style={{ gap: 12 }}>
            <p className="notice" style={{ margin: 0 }}>
              <strong>What this is not.</strong> Crucible does not score models and
              does not predict capability. A high grade means the <em>task</em> is
              worth publishing. Where a grade would need a language-model judge, the
              weight is reported as undecided instead of being quietly counted as a
              pass.
            </p>
            <p className="muted" style={{ fontSize: 12.5 }}>
              {SITE.name} is MIT licensed. Engine {ENGINE_VERSION}. The engine, the
              grader, the audit chain and the agent tools are all in the repository.
            </p>
          </div>
        </div>
      </Stage>
    </div>
  );
}

const FACTOR_MEANING: Record<string, string> = {
  determinism: "How much of the grade survives without a model in the loop.",
  discrimination: "Measured separation between recorded models. A task everything passes measures nothing.",
  fixture_seal: "Whether the revision, seed, temperature and inputs are pinned.",
  assertion_specificity: "Regex and JSON paths outrank substring matching.",
  reproduction: "Whether a third party can rerun this at all.",
  cost_fit: "Whether recorded runs fit the declared token budget.",
};