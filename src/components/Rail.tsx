"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { GITHUB_URL, NAV, SITE } from "@/lib/site";

/**
 * The rail is the only navigation in the product.
 *
 * Desktop: a full-height left column with rotated labels, reading top to bottom
 * in the order the metal moves through the shop. Mobile: the same items become a
 * horizontally scrolling bottom bar, so the structure survives a narrow screen
 * instead of collapsing into a hamburger.
 */
export function Rail() {
  const pathname = usePathname();

  return (
    <nav className="rail" aria-label="Primary">
      <Link href="/" className="rail-mark rail-brand" aria-label={`${SITE.name} home`}>
        {SITE.name}
      </Link>

      {NAV.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="rail-mark"
            aria-current={active ? "page" : undefined}
            title={item.blurb}
          >
            {item.mark}
          </Link>
        );
      })}

      <a
        className="rail-mark"
        href={GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="Source repository on GitHub"
      >
        GitHub
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </nav>
  );
}