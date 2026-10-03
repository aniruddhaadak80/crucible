import { AgentConsole } from "@/components/AgentConsole";
import { Stage } from "@/components/parts";
import { TOOLS } from "@/lib/mcp.ts";
import { listTasks } from "@/lib/db/repository.ts";
import { getScope } from "@/lib/session.ts";
import { SITE } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Agent console",
  description:
    "A live JSON-RPC 2.0 console over eleven typed tools, including mutating tools that go through the same service layer as the UI.",
};

export default async function AgentPage() {
  const scope = await getScope();
  const tasks = await listTasks(scope, { limit: 1 });
  const taskId = tasks.tasks[0]?.id ?? null;

  const tools = TOOLS.map((t) => ({
    name: t.name,
    kind: t.kind,
    mutates: t.mutates,
    title: t.title,
    description: t.description,
  }));

  return (
    <div className="pour">
      <Stage label="Agent console — JSON-RPC 2.0 over HTTP">
        <h1 className="display" style={{ fontSize: "clamp(2.4rem,6vw,4rem)", margin: "0 0 12px" }}>
          The agent console
        </h1>
        <p className="lede">
          Eleven typed tools over one service layer. An agent calling{" "}
          <code className="data">forge_task</code> takes exactly the same path as the
          button on the forge page, so the two cannot drift apart.
        </p>

        <p className="cluster" style={{ marginTop: 16, gap: 8 }}>
          <span className="tag">POST {SITE.agentEndpoint}</span>
          <span className="tag">protocol {SITE.mcpProtocol}</span>
          <a className="tag" href="/mcp.json">manifest /mcp.json</a>
          <a className="tag" href="/api/mcp">tool list</a>
        </p>

        <div style={{ marginTop: 26 }}>
          <AgentConsole taskId={taskId} tools={tools} />
        </div>
      </Stage>

      <Stage label="Point your own client at it">
        <p className="muted" style={{ maxWidth: "70ch", marginTop: 0 }}>
          The endpoint speaks plain JSON-RPC 2.0, so any MCP client that can talk
          HTTP can use it. There is no session header to set: a scope cookie is
          issued on first request and owns everything the agent creates.
        </p>
        <pre className="code" style={{ marginTop: 14 }}>{`curl -sX POST ${SITE.agentEndpoint} \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Forge a task through the agent path, idempotently.
curl -sX POST ${SITE.agentEndpoint} \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{
        "name":"forge_task",
        "arguments":{
          "name":"nested envelope collapse",
          "failureMode":"The model wraps a tool payload in a second envelope and the caller parses data: null.",
          "prompt":"Reply with ONLY the JSON the caller expects.",
          "assertions":[{"id":"top","kind":"json_path_equals","label":"rows at top level","weight":1,"path":"rows","jsonExpected":"[1,2,3]"}],
          "idempotencyKey":"readme-demo"
        }}}'`}</pre>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
          Retrying that request with the same <code className="data">readme-demo</code>{" "}
          key returns the original task instead of forging a second one.
        </p>
      </Stage>
    </div>
  );
}