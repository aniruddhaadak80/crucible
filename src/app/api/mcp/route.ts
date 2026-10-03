import { RPC, TOOLS, handleRpc, type RpcRequest, type RpcResponse } from "@/lib/mcp.ts";
import { readJsonBody } from "@/lib/http.ts";

export const dynamic = "force-dynamic";

/**
 * JSON-RPC 2.0 endpoint for the agent interface.
 *
 * Accepts a single request or a batch, matching the JSON-RPC spec. A batch is
 * answered with an array; a single request is answered with an object, so a
 * plain `curl` works without ceremony.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;

  try {
    body = await readJsonBody(request);
  } catch {
    const response: RpcResponse = {
      jsonrpc: "2.0",
      id: null,
      error: { code: RPC.parse, message: "Request body is not valid JSON." },
    };
    return Response.json(response, { status: 400 });
  }

  if (Array.isArray(body)) {
    if (body.length === 0) {
      return Response.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: RPC.invalidRequest, message: "Batch must not be empty." },
        },
        { status: 400 },
      );
    }
    const responses = await Promise.all(
      body.map((entry) => handleRpc(entry as RpcRequest)),
    );
    return Response.json(
      responses.filter((r) => r !== null),
      { headers: { "cache-control": "no-store" } },
    );
  }

  const response = await handleRpc(body as RpcRequest);
  return Response.json(response, { headers: { "cache-control": "no-store" } });
}

/** A GET here is a discovery aid, not a mutation. */
export async function GET(): Promise<Response> {
  return Response.json({
    protocol: "jsonrpc-2.0",
    endpoint: "/api/mcp",
    transport: "POST",
    methods: ["initialize", "tools/list", "tools/call", "ping"],
    tools: TOOLS.map((t) => ({
      name: t.name,
      kind: t.kind,
      mutates: t.mutates,
      idempotent: t.idempotent,
      title: t.title,
    })),
    manifest: "/mcp.json",
  });
}