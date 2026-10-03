import { SettingsForm } from "@/components/SettingsForm";
import { Stage, StatusTag } from "@/components/parts";
import { describeAdapter, ping } from "@/lib/db/client.ts";
import { getSettings } from "@/lib/db/repository.ts";
import { hubLineup } from "@/lib/live/index.ts";
import { getScope } from "@/lib/session.ts";
import { GRADE_BANDS, GRADE_WEIGHTS, WEIGHT_SUM } from "@/lib/grade.ts";
import { SEALED_HUB } from "@/lib/live/fallback.ts";
import { SITE } from "@/lib/site";
import type { ScopeSettings } from "@/app/api/settings/route";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Settings and diagnostics",
  description:
    "Store health with a real round trip, the published engine weights and bands, live feed status, and per-session preferences.",
};

/**
 * Settings and diagnostics.
 *
 * The store line reports an actual round trip and which adapter answered, so an
 * operator can tell a hosted database from the embedded development one before
 * trusting anything written.
 */
export default async function SettingsPage() {
  const scope = await getScope();
  const [probe, saved, hub] = await Promise.all([
    ping(),
    getSettings(scope),
    hubLineup([
      "Qwen/Qwen2.5-72B-Instruct",
      "meta-llama/Llama-3.1-70B-Instruct",
    ]).catch(() => null),
  ]);

  const adapter = describeAdapter();
  const settings = (saved ?? {}) as ScopeSettings;

  return (
    <div className="pour">
      <Stage label="Store">
        <h1 className="display" style={{ fontSize: "clamp(2.4rem,6vw,4rem)", margin: "0 0 12px" }}>
          Setup
        </h1>

        <div className="scroll-x"><table className="rows">
          <tbody>
            <tr>
              <td>Adapter</td>
              <td className="data">{probe.kind}</td>
            </tr>
            <tr>
              <td>Round trip</td>
              <td>
                <span className="cluster" style={{ gap: 8 }}>
                  {probe.ok ? (
                    <StatusTag tone="live">SELECT 1 returned 1</StatusTag>
                  ) : (
                    <StatusTag tone="fault">failed</StatusTag>
                  )}
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {probe.detail}
                  </span>
                </span>
              </td>
            </tr>
            <tr>
              <td>Durable</td>
              <td>
                {adapter.durable ? (
                  <StatusTag tone="live">survives redeploy</StatusTag>
                ) : (
                  <StatusTag tone="fault">development only</StatusTag>
                )}
              </td>
            </tr>
            <tr>
              <td>Scope</td>
              <td className="data">{scope.slice(0, 8)}…</td>
            </tr>
          </tbody>
        </table></div>

        <p className="notice" style={{ marginTop: 16 }}>
          {adapter.note} Local development uses an embedded Postgres under{" "}
          <code className="data">./.crucible</code> with zero environment variables.
          Production refuses to start without a hosted{" "}
          <code className="data">DATABASE_URL</code>, because a serverless filesystem
          is not a database.
        </p>
      </Stage>

      <Stage label="Engine">
        <div className="split">
          <div>
            <div className="scroll-x"><table className="rows">
              <thead>
                <tr>
                  <th scope="col">Factor</th>
                  <th scope="col">Weight</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(GRADE_WEIGHTS).map(([id, w]) => (
                  <tr key={id}>
                    <td className="data" style={{ fontSize: 12 }}>{id.replace(/_/g, " ")}</td>
                    <td className="data">{w.toFixed(2)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="data">sum</td>
                  <td className="data">{WEIGHT_SUM.toFixed(2)}</td>
                </tr>
              </tbody>
            </table></div>
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              engine {SITE.engine} · grader {SITE.grader}
            </p>
          </div>

          <div>
            <div className="scroll-x"><table className="rows">
              <thead>
                <tr>
                  <th scope="col">Band</th>
                  <th scope="col">Range</th>
                  <th scope="col">Required action</th>
                </tr>
              </thead>
              <tbody>
                {GRADE_BANDS.map((b) => (
                  <tr key={b.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{b.label}</td>
                    <td className="data">{b.min}–{b.max}</td>
                    <td className="muted" style={{ fontSize: 12.5 }}>{b.action}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </div>
      </Stage>

      <Stage label="Feeds">
        <div className="scroll-x"><table className="rows">
          <tbody>
            <tr>
              <td>Hugging Face Hub</td>
              <td>
                <span className="cluster" style={{ gap: 8 }}>
                  {hub ? (
                    hub.status === "live" ? (
                      <StatusTag tone="live">live</StatusTag>
                    ) : (
                      <StatusTag tone="fault">sealed</StatusTag>
                    )
                  ) : (
                    <StatusTag tone="fault">unreachable</StatusTag>
                  )}
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {hub?.degradedReason ??
                      `fetched ${(hub?.fetchedAt ?? "").slice(0, 19).replace("T", " ")} UTC`}
                  </span>
                </span>
              </td>
            </tr>
            <tr>
              <td>Sealed snapshot</td>
              <td className="muted" style={{ fontSize: 13 }}>
                {SEALED_HUB.length} model records recorded{" "}
                {SEALED_HUB[0]?.lastModified?.slice(0, 10) ?? "on 2026-10-03"} and shown
                with that date whenever the live lookup fails. A sealed row is never
                presented as current.
              </td>
            </tr>
            <tr>
              <td>arXiv</td>
              <td className="muted" style={{ fontSize: 13 }}>
                cs.CL capability-evaluation papers, newest first, queried per request
                with a bounded retry and a timeout.
              </td>
            </tr>
          </tbody>
        </table></div>
      </Stage>

      <Stage label="Preferences">
        <p className="muted" style={{ maxWidth: "64ch", marginTop: 0 }}>
          Stored against this session&apos;s scope in the database, not in browser
          storage. Clearing the cookie loses them, which is the honest behaviour for
          a product with no accounts.
        </p>
        <div style={{ marginTop: 18 }}>
          <SettingsForm initial={settings} />
        </div>
      </Stage>

      <Stage label="Endpoints">
        <div className="scroll-x"><table className="rows">
          <tbody>
            <tr>
              <td>Health</td>
              <td>
                <a className="data" style={{ color: "var(--accent)", fontSize: 12 }} href="/api/health">
                  {SITE.apiBase}/health
                </a>
              </td>
            </tr>
            <tr>
              <td>Agent</td>
              <td>
                <a className="data" style={{ color: "var(--accent)", fontSize: 12 }} href="/api/mcp">
                  {SITE.agentEndpoint}
                </a>
              </td>
            </tr>
            <tr>
              <td>Manifest</td>
              <td>
                <a className="data" style={{ color: "var(--accent)", fontSize: 12 }} href="/mcp.json">
                  {SITE.liveUrl}/mcp.json
                </a>
              </td>
            </tr>
            <tr>
              <td>Source</td>
              <td>
                <a
                  className="data"
                  style={{ color: "var(--accent)", fontSize: 12 }}
                  href={SITE.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {SITE.repoUrl}
                </a>
              </td>
            </tr>
          </tbody>
        </table></div>
      </Stage>
    </div>
  );
}

