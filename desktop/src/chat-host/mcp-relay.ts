/**
 * Loopback MCP relay for agent-facing MCP servers (#49).
 *
 * Casys providers fail closed on the strict convention (every request must
 * carry the `mcp-protocol-version` header and the full
 * `io.modelcontextprotocol/*` `_meta`). Stock MCP clients such as the
 * pinned codex rmcp client do not send them, so the agent handshake fails
 * while the host's own conformant client succeeds. The relay adapts the
 * stock client: it accepts plain JSON-RPC over loopback HTTP, injects the
 * exact convention headers and `_meta`, forwards to the fixed upstream,
 * and pipes the JSON response back.
 *
 * Boundaries: binds 127.0.0.1 on an ephemeral port, forwards POST /mcp
 * only to one fixed registry upstream, forces JSON responses (no SSE
 * passthrough), carries no credentials, and never surfaces its URL to
 * the renderer. Runs inside the Chat Host process; closing the host
 * closes the relay.
 */
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { MCP_PROTOCOL_VERSION } from "../control-plane/contracts.ts";
import { CHAT_HOST_COMPONENT_VERSION } from "../../../src/presentation/desktop/chat/contracts.ts";
import { canonicalJson, type McpCallTap } from "../chat/mcp-tap.ts";

export interface McpRelayOptions {
  /** Fixed registry upstream. The caller owns loopback validation. */
  readonly upstreamMcpUrl: string;
  readonly timeoutMs?: number;
  /**
   * DEV-ONLY correlation tap (#59). When present the relay records exact
   * tools/call pairs; absent in production, where nothing is recorded.
   */
  readonly tap?: McpCallTap;
}

export interface McpRelay {
  /** Local relay endpoint handed to the agent runtime, never the renderer. */
  readonly url: string;
  /**
   * Retargets the fixed upstream without rebinding: the relay URL stays
   * stable while the provider binding changes underneath (#57).
   */
  setUpstream(upstreamMcpUrl: string): void;
  close(): Promise<void>;
  /** Echoes the options tap so the host can scope lookups per relay. */
  readonly tap?: McpCallTap;
}

const MAX_BODY_BYTES = 8 * 1024 * 1024;
/** Tap records above this never match a capturable viewer result anyway. */
const TAP_RESULT_MAX_BYTES = 262_144;

function relayMeta(): Record<string, unknown> {
  return {
    "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/clientInfo": {
      name: "casys-desktop-chat-relay",
      version: CHAT_HOST_COMPONENT_VERSION,
    },
  };
}

export async function startMcpRelay(options: McpRelayOptions): Promise<McpRelay> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("timeoutMs must be a positive integer");
  }
  let currentUpstream = checkedUpstream(options.upstreamMcpUrl);

  const server: Server = createServer((request, response) => {
    void handleRelayRequest(request, response, currentUpstream, timeoutMs, options.tap)
      .catch((error: unknown) => {
        if (response.headersSent) {
          response.destroy();
          return;
        }
        response.writeHead(502, { "content-type": "application/json" });
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32000, message: `MCP relay failed: ${safeMessage(error)}` },
        }));
      });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    await closeServer(server);
    throw new Error("MCP relay did not bind a loopback port");
  }
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    setUpstream: (upstreamMcpUrl: string) => {
      currentUpstream = checkedUpstream(upstreamMcpUrl);
    },
    close: () => closeServer(server),
    ...(options.tap === undefined ? {} : { tap: options.tap }),
  };
}

function checkedUpstream(upstreamMcpUrl: string): string {
  if (upstreamMcpUrl.trim() === "") {
    throw new TypeError("upstreamMcpUrl must be a non-empty URL");
  }
  const upstream = new URL(upstreamMcpUrl);
  if (
    (upstream.protocol !== "http:" && upstream.protocol !== "https:") ||
    (upstream.hostname !== "127.0.0.1" && upstream.hostname !== "localhost")
  ) {
    throw new TypeError("upstreamMcpUrl must be loopback HTTP(S)");
  }
  return upstreamMcpUrl;
}

async function handleRelayRequest(
  request: IncomingMessage,
  response: ServerResponse,
  upstreamMcpUrl: string,
  timeoutMs: number,
  tap: McpCallTap | undefined,
): Promise<void> {
  const path = (request.url ?? "").split("?")[0];
  if (path !== "/mcp") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32601, message: "MCP relay forwards /mcp only" },
    }));
    return;
  }
  if (request.method !== "POST") {
    response.writeHead(405, { "content-type": "application/json" });
    response.end(JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "MCP relay accepts POST only" },
    }));
    return;
  }
  const raw = await readBody(request, response);
  if (raw === undefined) return;
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "MCP relay requires a JSON-RPC body" },
    }));
    return;
  }
  if (Array.isArray(payload)) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32600,
        message: "MCP relay accepts a single JSON-RPC object",
      },
    }));
    return;
  }
  if (typeof payload !== "object" || payload === null) {
    failInvalid(response, payload);
    return;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.method !== "string" || record.method.trim() === "") {
    failInvalid(response, payload);
    return;
  }
  const method = record.method;
  const params = record.params;
  if (params !== undefined && (typeof params !== "object" || params === null)) {
    failInvalid(response, payload);
    return;
  }
  const incomingMeta = (params as Record<string, unknown> | undefined)?._meta;
  record.params = {
    ...((typeof params === "object" && params !== null ? params : {}) as Record<
      string,
      unknown
    >),
    _meta: {
      ...(typeof incomingMeta === "object" && incomingMeta !== null
        ? incomingMeta as Record<string, unknown>
        : {}),
      ...relayMeta(),
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const upstreamHeaders: Record<string, string> = {
    "content-type": "application/json",
    "accept": "application/json",
    "mcp-protocol-version": MCP_PROTOCOL_VERSION,
    "mcp-method": method,
  };
  // Named calls mirror the provider-required Mcp-Name header that stock
  // clients do not send: tools/call mirrors params.name and resources/read
  // mirrors params.uri, matching the host transport convention.
  const namedParams = record.params as Record<string, unknown> | undefined;
  if (
    method === "tools/call" && typeof namedParams?.name === "string" &&
    namedParams.name.trim() !== ""
  ) {
    upstreamHeaders["mcp-name"] = namedParams.name;
  } else if (
    method === "resources/read" && typeof namedParams?.uri === "string" &&
    namedParams.uri.trim() !== ""
  ) {
    upstreamHeaders["mcp-name"] = namedParams.uri;
  }
  let upstream: Response;
  try {
    upstream = await fetch(upstreamMcpUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify(payload),
      redirect: "error",
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    failUpstream(response, payload, error);
    return;
  } finally {
    clearTimeout(timer);
  }
  const body = new Uint8Array(await upstream.arrayBuffer());
  const headers: Record<string, string> = {
    "content-type": upstream.headers.get("content-type") ?? "application/json",
  };
  const version = upstream.headers.get("mcp-protocol-version");
  if (version !== null) headers["mcp-protocol-version"] = version;
  response.writeHead(upstream.status, headers);
  response.end(body);
  recordTap(tap, method, namedParams, body);
}

/**
 * Records one exact tools/call pair for dev correlation. Skips silently
 * on any shape surprise or oversize payload: the tap never breaks the
 * relay, and unrecorded calls simply capture nothing downstream.
 */
function recordTap(
  tap: McpCallTap | undefined,
  method: string,
  params: Record<string, unknown> | undefined,
  body: Uint8Array,
): void {
  if (tap === undefined || method !== "tools/call") return;
  const name = params?.name;
  if (typeof name !== "string" || name.trim() === "") return;
  if (body.byteLength > TAP_RESULT_MAX_BYTES) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
  const record = parsed as Record<string, unknown>;
  const failed = "error" in record;
  if (!failed && !("result" in record)) return;
  let argsJson: string;
  let resultJson: string;
  try {
    argsJson = canonicalJson(params?.arguments ?? {});
    resultJson = canonicalJson(failed ? record.error : record.result);
  } catch {
    return;
  }
  tap.record({ tool: name, argsJson, resultJson, failed, at: Date.now() });
}

function failInvalid(
  response: ServerResponse,
  element: unknown,
): void {
  const id = typeof element === "object" && element !== null
    ? (element as Record<string, unknown>).id ?? null
    : null;
  response.writeHead(400, { "content-type": "application/json" });
  response.end(JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32600,
      message: "MCP relay requires JSON-RPC objects with a method",
    },
  }));
}

function failUpstream(
  response: ServerResponse,
  payload: unknown,
  error: unknown,
): void {
  const elements = Array.isArray(payload) ? payload : [payload];
  const id = elements.length === 1 && typeof elements[0] === "object" &&
      elements[0] !== null
    ? (elements[0] as Record<string, unknown>).id ?? null
    : null;
  response.writeHead(502, { "content-type": "application/json" });
  response.end(JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: { code: -32000, message: `MCP upstream unreachable: ${safeMessage(error)}` },
  }));
}

async function readBody(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<string | undefined> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = typeof chunk === "string"
      ? new TextEncoder().encode(chunk)
      : chunk as Uint8Array;
    total += bytes.byteLength;
    if (total > MAX_BODY_BYTES) {
      response.writeHead(413, { "content-type": "application/json" });
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "MCP relay body exceeds 8 MiB" },
      }));
      return undefined;
    }
    chunks.push(bytes);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function safeMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 300);
  return String(error).slice(0, 300);
}
