import { TOOLS, MCP_PROTOCOL_VERSION } from "@/lib/mcp.ts";
import { LIVE_URL, SITE, originFor } from "@/lib/site";

/**
 * MCP server manifest.
 *
 * Served per request rather than prerendered, and every absolute URL is derived
 * from the host the caller actually reached. A manifest is a machine-readable
 * instruction to send data somewhere, so a stale hostname in it is a security
 * problem, not a cosmetic one: the first prerendered version of this file
 * advertised `crucible.vercel.app`, which belongs to an unrelated project.
 */
export function GET(request: Request): Response {
  const origin = originFor(request);
  const endpoint = `${origin}/api/mcp`;

  const manifest = {
    $schema: "https://static.modelcontextprotocol.io/schemas/2025-06-18/server.schema.json",
    name: "io.github.aniruddhaadak80.crucible",
    description: SITE.description,
    version: SITE.version,
    websiteUrl: origin,
    repository: {
      url: SITE.repoUrl,
      source: "github",
    },
    capabilities: {
      tools: { listChanged: false },
    },
    servers: {
      crucible: {
        type: "http",
        url: endpoint,
        headers: {},
      },
    },
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: {
        readOnlyHint: !tool.mutates,
        destructiveHint: tool.name === "retire_task",
        idempotentHint: tool.idempotent,
      },
    })),
    protocolVersion: MCP_PROTOCOL_VERSION,
    engine: {
      version: SITE.engine,
      grader: SITE.grader,
    },
  };

  return Response.json(manifest, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

/** Used only to document the configured host in build logs; never served. */
export const CONFIGURED_ORIGIN = LIVE_URL;