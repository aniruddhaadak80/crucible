import { TOOLS, MCP_PROTOCOL_VERSION } from "@/lib/mcp.ts";
import { SITE } from "@/lib/site.ts";

export const dynamic = "force-static";

/**
 * MCP server manifest.
 *
 * A real, usable configuration file: the live endpoint is written from the same
 * site configuration the rest of the app uses, so it can never point at a stale
 * host after a deploy.
 */
const manifest = {
  $schema: "https://static.modelcontextprotocol.io/schemas/2025-06-18/server.schema.json",
  name: "io.github.aniruddhaadak80.crucible",
  description: SITE.description,
  version: SITE.version,
  websiteUrl: SITE.liveUrl,
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
      url: SITE.agentEndpoint,
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

export function GET(): Response {
  return Response.json(manifest, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}