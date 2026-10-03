import Link from "next/link";

import { GitHubMark } from "./GitHubMark";
import { FOOTER_LINKS, GITHUB_URL, SITE } from "@/lib/site";

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="footer">
      <div className="pour">
        <div className="foot-grid">
          <div>
            <p className="display" style={{ fontSize: 30, margin: "0 0 10px" }}>
              {SITE.name}
            </p>
            <p className="muted" style={{ fontSize: 14, maxWidth: "42ch", margin: 0 }}>
              {SITE.outcome}
            </p>

            <p className="cluster" style={{ marginTop: 18 }}>
              <a
                className="btn btn-ghost"
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                <GitHubMark size={15} />
                Star on GitHub
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              <Link className="btn btn-ghost" href="/agent">
                Agent console
              </Link>
            </p>
          </div>

          <div>
            <p className="stage-label" style={{ marginBottom: 10 }}>
              Product
            </p>
            {FOOTER_LINKS.slice(0, 5).map((link) => (
              <Link key={link.href} className="foot-link" href={link.href}>
                {link.label}
              </Link>
            ))}
          </div>

          <div>
            <p className="stage-label" style={{ marginBottom: 10 }}>
              Reference
            </p>
            {FOOTER_LINKS.slice(5).map((link) => (
              <Link key={link.href} className="foot-link" href={link.href}>
                {link.label}
              </Link>
            ))}
            <a
              className="foot-link"
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Source repository
            </a>
            <a
              className="foot-link"
              href={`${GITHUB_URL}/issues`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Issues
            </a>
          </div>

          <div>
            <p className="stage-label" style={{ marginBottom: 10 }}>
              Build
            </p>
            <p className="data muted" style={{ fontSize: 11, lineHeight: 1.9, margin: 0 }}>
              engine {SITE.engine}
              <br />
              grader {SITE.grader}
              <br />
              v{SITE.version} · MIT
              <br />
              © {year}
            </p>
          </div>
        </div>

        <div className="stage" style={{ paddingBottom: 0 }}>
          <p className="muted" style={{ fontSize: 13, maxWidth: "78ch", margin: 0 }}>
            <strong style={{ color: "var(--color-bone-dim)" }}>Read the caveats.</strong>{" "}
            A Crucible grade is a statement about a <em>task</em>, never about a
            model&rsquo;s ability. Assertions that would need a language-model judge are
            reported as undecided rather than counted as passes. Reproducing a run
            requires the pinned model revision; where a model publishes no public
            revision, a third party cannot reproduce it regardless of what a dossier
            claims. Data is attributed at the point of display and labelled live or
            sealed.
          </p>
        </div>
      </div>
    </footer>
  );
}