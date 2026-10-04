import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

type LayoutProps = { children: ReactNode };

import localFont from "next/font/local";

import { Footer } from "@/components/Footer";
import { Rail } from "@/components/Rail";
import { LIVE_URL, SITE, absoluteUrl } from "@/lib/site";

import "./globals.css";

/*
 * Self-hosted variable fonts.
 *
 * Fetching these from Google at build time made the build depend on an external
 * service being up, which is exactly the kind of fragility that turns a green
 * pipeline red for no reason. The woff2 files are committed, latin subset, so
 * `npm run build` is hermetic.
 */
const display = localFont({
  src: "./fonts/big-shoulders-display.woff2",
  variable: "--font-big-shoulders",
  weight: "100 900",
  display: "swap",
  fallback: ["Arial Narrow", "Impact", "sans-serif"],
});

const mono = localFont({
  src: "./fonts/martian-mono.woff2",
  variable: "--font-martian-mono",
  weight: "100 800",
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "monospace"],
});

const body = localFont({
  src: "./fonts/instrument-sans.woff2",
  variable: "--font-instrument-sans",
  weight: "400 700",
  display: "swap",
  fallback: ["system-ui", "Segoe UI", "sans-serif"],
});

const title = `${SITE.name} — ${SITE.outcome}`;

export const metadata: Metadata = {
  metadataBase: new URL(LIVE_URL),
  title: {
    default: title,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: [
    "llm benchmark",
    "benchmark authoring",
    "eval harness",
    "model evaluation",
    "deterministic grading",
    "kaggle benchmarks",
    "mcp agent tools",
    "reproducible research",
  ],
  authors: [{ name: "Aniruddha Adak", url: "https://github.com/aniruddhaadak80" }],
  creator: "Aniruddha Adak",
  alternates: {
    canonical: absoluteUrl("/"),
  },
  openGraph: {
    type: "website",
    url: absoluteUrl("/"),
    siteName: SITE.name,
    title,
    description: SITE.description,
    locale: "en_US",
    images: [
      {
        url: absoluteUrl("/opengraph-image"),
        width: 1200,
        height: 630,
        alt: `${SITE.name}: ${SITE.outcome}`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description: SITE.description,
    images: [absoluteUrl("/opengraph-image")],
    creator: "@aniruddhaadak80",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  category: "technology",
  other: {
    "mcp-endpoint": SITE.agentEndpoint,
    "source-repository": SITE.repoUrl,
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0908",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${mono.variable} ${body.variable}`}
    >
      <body>
        {/* --heat is the default until a page sets its own measured value. */}
        <div className="forge-ground" style={{ ["--heat" as string]: 0.28 }}>
          <a href="#main" className="sr-only">
            Skip to content
          </a>
          <div className="shell">
            <Rail />
            <div className="column">
              <main id="main">{children}</main>
              <Footer />
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
