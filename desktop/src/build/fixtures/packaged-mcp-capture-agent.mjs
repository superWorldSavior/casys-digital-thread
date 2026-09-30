/** Deterministic ACP agent: calls the supplied scoped MCP URL, but hides output. */
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Readable, Writable } from "node:stream";

const [acpxRoot, stateRoot] = process.argv.slice(2);
if (!acpxRoot || !stateRoot) {
  throw new Error("fixture needs acpx and state roots");
}
const sdk = await import(
  pathToFileURL(join(
    acpxRoot,
    "node_modules",
    "@agentclientprotocol",
    "sdk",
    "dist",
    "acp.js",
  )).href
);
const SESSION_ID = "packaged-mcp-capture-session";
const sessions = new Map();

function record(entry) {
  appendFileSync(
    join(stateRoot, "agent-events.jsonl"),
    `${JSON.stringify(entry)}\n`,
  );
}

function scopedUrl(params) {
  const servers = params.mcpServers ?? [];
  if (servers.length !== 1 || servers[0].type !== "http") {
    throw new Error("fixture requires exactly one HTTP MCP server");
  }
  const url = new URL(servers[0].url);
  if (
    url.hostname !== "127.0.0.1" || !/^\/mcp\/[0-9a-f-]{36}$/.test(url.pathname)
  ) {
    throw new Error("fixture did not receive a scoped loopback MCP URL");
  }
  return url.href;
}

class FixtureAgent {
  initialize() {
    return {
      protocolVersion: sdk.PROTOCOL_VERSION,
      authMethods: [],
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: {
          image: false,
          audio: false,
          embeddedContext: false,
        },
        sessionCapabilities: { close: {} },
      },
    };
  }

  newSession(params) {
    const url = scopedUrl(params);
    sessions.set(SESSION_ID, url);
    record({ kind: "new", sessionId: SESSION_ID, url });
    return { sessionId: SESSION_ID };
  }

  loadSession(params) {
    if (params.sessionId !== SESSION_ID) {
      throw new Error("wrong session resumed");
    }
    const url = scopedUrl(params);
    sessions.set(SESSION_ID, url);
    record({ kind: "load", sessionId: SESSION_ID, url });
    return {};
  }

  async prompt(params) {
    const url = sessions.get(params.sessionId);
    if (!url) throw new Error("prompt has no active scoped MCP URL");
    const text = (params.prompt ?? []).filter((part) => part.type === "text")
      .map((part) => part.text).join("\n");
    const revision = text.includes("revision-two") ? 2 : 1;
    const args = {
      script: `from build123d import *\nresult = Box(10, 10, ${revision * 10})`,
      formats: ["step"],
      name: `capture-${revision}`,
      revision,
    };
    const callId = `fixture-export-${revision}`;
    await connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: callId,
        title: "mcp__build123d__build123d_export",
        status: "in_progress",
        rawInput: args,
      },
    });
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: revision,
        method: "tools/call",
        params: { name: "build123d_export", arguments: args },
      }),
    });
    const body = await response.json();
    if (!response.ok || body.error || !body.result) {
      throw new Error(`fixture MCP call failed: HTTP ${response.status}`);
    }
    record({ kind: "prompt", sessionId: params.sessionId, url, revision });
    // Muse-like ACP event: human-readable summary only, no rawOutput or URI.
    await connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: callId,
        status: "completed",
        content: [{
          type: "content",
          content: { type: "text", text: "Export complete." },
        }],
      },
    });
    await connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: `revision ${revision} complete` },
      },
    });
    return { stopReason: "end_turn" };
  }

  async cancel() {}

  closeSession(params) {
    sessions.delete(params.sessionId);
    return {};
  }
}

const stream = sdk.ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin),
);
const connection = new sdk.AgentSideConnection(
  () => new FixtureAgent(),
  stream,
);
void connection;
