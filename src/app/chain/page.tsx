import Link from "next/link";

import { Empty, Seal, Stage, StatusTag } from "@/components/parts";
import { listTasks } from "@/lib/db/repository.ts";
import { replayTask } from "@/lib/db/repository.ts";
import { getScope } from "@/lib/session.ts";
import { SEED_SCOPE } from "@/lib/seed.ts";
import { GENESIS_SEAL } from "@/lib/canonical.ts";
import { ENGINE_VERSION } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Integrity chain",
  description:
    "Replay every audit chain in the session and find the first broken link. Each task is an independent SHA-384 chain over canonical JSON.",
};

/**
 * Integrity.
 *
 * Every create, update, grade, decision and delete appends to a per-task chain.
 * This page recomputes every seal from genesis and names the first link that does
 * not match, which is the only claim worth making about an append-only log.
 */
export default async function ChainPage() {
  const scope = await getScope();
  const [mine, reference] = await Promise.all([
    listTasks(scope, { limit: 50, includeRetired: true }),
    listTasks(SEED_SCOPE, { limit: 10, includeRetired: true }),
  ]);

  const rows = await Promise.all(
    [...reference.tasks, ...mine.tasks].map(async (task) => {
      const owner = task.scope === SEED_SCOPE ? SEED_SCOPE : scope;
      try {
        const replay = await replayTask(owner, task.id);
        return { task, replay, owner };
      } catch {
        return { task, replay: null, owner };
      }
    }),
  );

  const broken = rows.filter((r) => r.replay && !r.replay.ok).length;
  const checked = rows.reduce((acc, r) => acc + (r.replay?.checked ?? 0), 0);

  return (
    <div className="pour">
      <Stage label="Chain — replay every link">
        <div className="cluster" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <div>
            <h1 className="display" style={{ fontSize: "clamp(2.4rem,6vw,4rem)", margin: 0 }}>
              Integrity
            </h1>
            <p className="muted" style={{ fontSize: 14, maxWidth: "62ch" }}>
              One independent chain per task, chained from a fixed genesis value and
              recomputed from scratch on every render.
            </p>
          </div>
          <div className="cluster" style={{ gap: 8 }}>
            <span className="tag">{checked} links checked</span>
            {broken === 0 ? (
              <StatusTag tone="live">all intact</StatusTag>
            ) : (
              <StatusTag tone="fault">{broken} broken</StatusTag>
            )}
          </div>
        </div>

        <div className="split" style={{ marginTop: 24 }}>
          <div className="stack" style={{ gap: 12 }}>
            <p className="stage-label" style={{ margin: 0 }}>How a seal is computed</p>
            <pre className="code">{`seal_n = SHA-384( UTF-8(prevSeal) || canonicalJson(event_n) )

canonicalJson:
  - object keys sorted by UTF-16 code unit, recursively
  - array order preserved
  - undefined members dropped
  - non-finite numbers rejected, not coerced to null
  - -0 normalised to 0

genesis = "${GENESIS_SEAL}"`}</pre>
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              The previous seal is prefixed as raw bytes, not as text, so there is no
              ambiguity about where a hash ends and its payload begins. Two known
              digest vectors are pinned in the test suite, so a change to canonical
              form cannot pass silently.
            </p>
          </div>

          <div className="stack" style={{ gap: 12 }}>
            <p className="stage-label" style={{ margin: 0 }}>What this proves</p>
            <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
              A chain like this detects <em>rewriting history</em>. It does not stop
              somebody with write access from rewriting the whole log and
              recomputing every hash from genesis. For that you would need the head
              published somewhere append-only and independent — a transparency log,
              or periodic publication of{" "}
              <code className="data">{ENGINE_VERSION}</code> heads.
            </p>
            <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
              Deletions keep a tombstone, so retiring a task never breaks the chain
              it was part of.
            </p>
          </div>
        </div>
      </Stage>

      <Stage label="Replay">
        {rows.length === 0 ? (
          <Empty
            title="Nothing to replay"
            body="No task exists in this session yet, so there is no chain to verify."
            action={
              <Link className="btn btn-primary" href="/forge">
                Forge a task
              </Link>
            }
          />
        ) : (
          <div className="scroll-x"><table className="rows">
            <thead>
              <tr>
                <th scope="col">Task</th>
                <th scope="col">Links</th>
                <th scope="col">Replay</th>
                <th scope="col">Head</th>
                <th scope="col">API</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ task, replay, owner }) => (
                <tr key={`${task.id}-${owner}`}>
                  <td>
                    <Link
                      href={`/task/${task.id}`}
                      style={{ color: "var(--color-bone)", textDecoration: "none" }}
                    >
                      <strong>{task.name}</strong>
                    </Link>
                    <br />
                    <span className="muted" style={{ fontSize: 12 }}>
                      {task.scope === SEED_SCOPE ? "reference" : "this session"}
                      {task.deletedAt ? " · tombstone" : ""}
                    </span>
                  </td>
                  <td className="data">{replay?.checked ?? 0}</td>
                  <td>
                    {!replay ? (
                      <StatusTag tone="fault">unreadable</StatusTag>
                    ) : replay.ok ? (
                      <StatusTag tone="live">intact</StatusTag>
                    ) : (
                      <>
                        <StatusTag tone="fault">broken at {replay.brokenAtSeq}</StatusTag>
                        <br />
                        <span className="muted" style={{ fontSize: 11.5 }}>
                          {replay.brokenReason}
                        </span>
                      </>
                    )}
                  </td>
                  <td>
                    <Seal value={replay?.head ?? task.seal} />
                  </td>
                  <td>
                    <a
                      className="data"
                      style={{ fontSize: 11.5, color: "var(--accent)" }}
                      href={`/api/tasks/${task.id}/integrity`}
                    >
                      replay
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Stage>
    </div>
  );
}