import { ImageResponse } from "next/og";

import { SITE } from "@/lib/site";

export const runtime = "nodejs";
export const alt = `${SITE.name}: ${SITE.outcome}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Social card.
 *
 * The colours are the real temperature ramp rather than decoration: the bar at
 * the bottom is the ramp itself, from cold quench to white heat, which is the
 * thing the product measures.
 *
 * Satori cannot load woff2, so the display face is the system bold. The brand
 * type is only a compromise here, and it is not worth shipping an unconverted
 * font binary to fix it.
 */
const FACTORS: [string, string][] = [
  ["determinism", "0.26"],
  ["discrimination", "0.22"],
  ["fixture seal", "0.18"],
  ["assertion specificity", "0.16"],
  ["reproduction", "0.10"],
  ["cost fit", "0.08"],
];

/**
 * Next 16 requires a default export from an image route, not a named GET.
 */
export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0a0908",
          padding: 64,
          fontFamily: "sans-serif",
        }}
      >
        {/* rule */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 22,
              letterSpacing: 6,
              color: "#9c9089",
              textTransform: "uppercase",
            }}
          >
            {SITE.name} · {SITE.engine}
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 28,
              fontSize: 78,
              lineHeight: 1.02,
              fontWeight: 800,
              color: "#f4f1ea",
              letterSpacing: -2,
              maxWidth: 860,
            }}
          >
            Grade the benchmark, not the model
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 22,
              fontSize: 27,
              lineHeight: 1.35,
              color: "#d6cfc4",
              maxWidth: 780,
            }}
          >
            Deterministic assertions instead of a judge. Six weighted factors, and a
            SHA-384 chain anyone can replay.
          </div>
        </div>

        {/* factors + ramp */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 18 }}>
            {FACTORS.map(([name, weight]) => (
              <div
                key={name}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  border: "1px solid #3a3430",
                  padding: "9px 14px",
                }}
              >
                <span style={{ fontSize: 21, color: "#f4f1ea" }}>{name}</span>
                <span style={{ fontSize: 21, color: "#a78bfa" }}>{weight}</span>
              </div>
            ))}
          </div>

          {/* the temperature ramp, which is the product's core idea */}
          <div
            style={{
              display: "flex",
              height: 12,
              marginTop: 30,
              background:
                "linear-gradient(90deg, #5b6cff 0%, #c0341a 28%, #ef6a12 52%, #f7c02b 76%, #fff4dc 100%)",
            }}
          />

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 16,
              fontSize: 20,
              color: "#9c9089",
            }}
          >
            <span>github.com/aniruddhaadak80/crucible</span>
            <span>crucible-grade · no API key needed</span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}