import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import pins from "../../chat-runtime/pins.json" with { type: "json" };
import { MUSE_AGENT_PROFILE_ID } from "../chat/agent-profiles.ts";
import { ChatCoordinator } from "../chat/coordinator.ts";
import { connectableMcpServers, probeChatMcpServer } from "../chat/mcp-servers.ts";
import { createRegistryViewerBackend } from "../chat/viewer-backend.ts";

import {
  CHAT_HOST_COMPONENT_VERSION,
  parseChatCommandRequest,
  parseChatSnapshotRequest,
} from "../../../src/presentation/desktop/chat/contracts.ts";
import { builtinAdapterEntry } from "./agent-host.ts";
import { AgentRuntimeFactory } from "./agent-runtime-factory.ts";
import { createMcpCallTap, type McpTapQuery } from "../chat/mcp-tap.ts";
import {
  McpAttachmentManager,
  parseMcpEnsurePayload,
  parseMcpReleasePayload,
} from "./mcp-attachments.ts";
import { startMcpRelay } from "./mcp-relay.ts";
import { NodeChatConversationStore } from "./node-store.ts";
import { CHAT_HOST_IPC_PROTOCOL } from "./protocol.ts";
import { createPinnedRuntimeAdapter } from "./runtime-adapter.ts";
import { parseImplementedTarget, resolveTargetArtifacts } from "./target.ts";

interface IpcRequest {
  readonly protocol: typeof CHAT_HOST_IPC_PROTOCOL;
  readonly requestId: string;
  readonly method: "snapshot" | "command" | "shutdown" | "mcp.ensure" | "mcp.release";
  readonly payload?: unknown;
}

const dataRoot = readDataRoot(process.argv.slice(2));
const runtimeRoot = dirname(fileURLToPath(import.meta.url));
const bundleManifest = JSON.parse(
  readFileSync(join(runtimeRoot, "bundle-manifest.json"), "utf8"),
) as Record<string, unknown>;
const runtimeTarget = parseImplementedTarget(bundleManifest.target);
const targetArtifacts = resolveTargetArtifacts(runtimeTarget);
const codexAdapterEntry = realpathSync(
  join(runtimeRoot, builtinAdapterEntry("bundled-codex")),
);
const museAdapterEntry = realpathSync(
  join(runtimeRoot, builtinAdapterEntry("bundled-muse")),
);
const acpxPackage = realpathSync(join(runtimeRoot, "acpx"));
assertRuntimePins(acpxPackage, codexAdapterEntry, museAdapterEntry);
await mkdir(join(dataRoot, "workspace"), { recursive: true, mode: 0o700 });

const mcpServers = connectableMcpServers();
// Agent-facing MCP servers go through the loopback relay: the pinned
// stock MCP client does not speak the strict Casys convention, so direct
// wiring fails the provider handshake. Relay URLs stay host-side.
// The project relay keeps its fixed control-plane upstream; standalone
// relays and MCP runtimes start lazily when Desktop assigns a provider
// endpoint (#57), never for unused catalogue entries.
const projectRelay = await startMcpRelay({
  upstreamMcpUrl: "http://127.0.0.1:3020/mcp",
});
// DEV-ONLY (#59): relay correlation taps attribute provider responses to
// output-less tool events. Production never sets this variable, so the
// packaged app records nothing and the limitation stands there.
const devRelayTap = process.env.CASYS_DEV_RELAY_TAP === "1";
if (devRelayTap) console.error("[chat-host] DEV relay tap enabled");
// One runtime per agent profile x MCP set: the factory creates them
// lazily; the legacy Codex profile keeps the historical session stores
// so native sessions resume, every other profile is namespaced (#58).
const { factory: agentFactory, profilesError } = await AgentRuntimeFactory.create({
  dataRoot,
  workspaceRoot: join(dataRoot, "workspace"),
  runtimeRoot,
  nodeExecutable: process.execPath,
  acpxRuntimeUrl: pathToFileURL(join(acpxPackage, "dist", "runtime.js")).href,
  codexVersion: pins.adapter.codexPackageVersion,
  projectRelayUrl: projectRelay.url,
  appEnv: process.env,
  mcpDisplayName: (mcpId) =>
    mcpServers.find((server) => server.id === mcpId)?.displayName ?? mcpId,
  relayUrl: (mcpId) => attachments.relayUrl(mcpId),
  createAdapter: (options) => createPinnedRuntimeAdapter(options),
});
if (profilesError !== undefined) {
  console.error(`[chat-host] custom agent profiles ignored: ${profilesError}`);
}
{
  const muse = agentFactory.statusOf(MUSE_AGENT_PROFILE_ID);
  console.error(
    muse.available
      ? `[chat-host] muse resolved: ${muse.version ?? "unknown version"}`
      : `[chat-host] muse unresolved: ${muse.missingReason ?? "unknown reason"}`,
  );
}
const coordinator = await ChatCoordinator.create({
  agents: agentFactory,
  runtimes: new Map(),
  mcpServers,
  probeMcp: (server) => probeChatMcpServer(server),
  resolveMcpEndpoint: (mcpId) => attachments.resolve(mcpId),
  ...(devRelayTap
    ? {
      findMcpTapCall: (mcpId: string, query: McpTapQuery) =>
        attachments.relayTap(mcpId)?.takeMatch(query),
    }
    : {}),
  viewerBackend: createRegistryViewerBackend({
    servers: mcpServers,
    resolveEndpoint: (server) => attachments.resolve(server),
  }),
  store: new NodeChatConversationStore(join(dataRoot, "chat")),
  workspaceRoot: join(dataRoot, "workspace"),
});
const attachments = new McpAttachmentManager({
  connectableIds: mcpServers.map((server) => server.id),
  startRelay: (upstreamMcpUrl) =>
    startMcpRelay({
      upstreamMcpUrl,
      ...(devRelayTap ? { tap: createMcpCallTap() } : {}),
    }),
  releaseRuntimes: (mcpId) => {
    void agentFactory.releaseStandalone(mcpId).then((keys) => {
      for (const key of keys) coordinator.unregisterRuntime(key);
    });
  },
});

write({
  protocol: CHAT_HOST_IPC_PROTOCOL,
  type: "ready",
  pid: process.pid,
  chatHostVersion: CHAT_HOST_COMPONENT_VERSION,
  acpxCommit: pins.acpx.commit,
  adapterVersion: pins.adapter.version,
  museAdapterVersion: pins.adapterMuse.version,
  nodeVersion: process.versions.node,
  target: runtimeTarget,
});

let stopping = false;
process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (line.length > 1_000_000) {
    writeError("oversize", "IPC request is too large");
    continue;
  }
  let request: IpcRequest;
  try {
    request = parseIpcRequest(JSON.parse(line));
  } catch (error) {
    writeError("invalid", safeError(error));
    continue;
  }
  try {
    if (request.method === "snapshot") {
      const input = parseChatSnapshotRequest(request.payload);
      writeResponse(request.requestId, coordinator.snapshot(input.conversationId));
    } else if (request.method === "command") {
      const input = parseChatCommandRequest(request.payload);
      writeResponse(request.requestId, await coordinator.command(input));
    } else if (request.method === "mcp.ensure") {
      const input = parseMcpEnsurePayload(request.payload);
      await attachments.ensure(input.mcpId, {
        mcpUrl: input.mcpUrl,
        healthUrl: input.healthUrl,
      });
      writeResponse(request.requestId, { attached: true });
    } else if (request.method === "mcp.release") {
      const input = parseMcpReleasePayload(request.payload);
      const outcome = await attachments.release(input.mcpId);
      writeResponse(request.requestId, { released: outcome === "released" });
    } else {
      writeResponse(request.requestId, { stopped: true });
      await stop();
      break;
    }
  } catch (error) {
    writeError(request.requestId, safeError(error));
  }
}
await stop();

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await coordinator.stop();
  await attachments.closeAll();
  await projectRelay.close().catch(() => undefined);
}

function parseIpcRequest(value: unknown): IpcRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("IPC request must be an object");
  }
  const record = value as Record<string, unknown>;
  if (record.protocol !== CHAT_HOST_IPC_PROTOCOL) {
    throw new TypeError("IPC protocol mismatch");
  }
  if (
    typeof record.requestId !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(record.requestId)
  ) {
    throw new TypeError("IPC requestId is invalid");
  }
  if (
    record.method !== "snapshot" && record.method !== "command" &&
    record.method !== "shutdown" && record.method !== "mcp.ensure" &&
    record.method !== "mcp.release"
  ) {
    throw new TypeError("IPC method is invalid");
  }
  return {
    protocol: CHAT_HOST_IPC_PROTOCOL,
    requestId: record.requestId,
    method: record.method,
    payload: record.payload,
  };
}

function readDataRoot(args: readonly string[]): string {
  if (args.length !== 1 || !args[0].startsWith("--data-root=")) {
    throw new TypeError("Chat Host requires one --data-root argument");
  }
  const path = args[0].slice("--data-root=".length);
  if (!isExactAbsolutePath(path, process.platform)) {
    throw new TypeError("Chat Host data root must be an exact absolute path");
  }
  return path;
}

function isExactAbsolutePath(
  path: string,
  platform: NodeJS.Platform,
): boolean {
  if (path === "" || path.includes("\0")) return false;
  if (platform === "win32") {
    const drive = /^[A-Za-z]:\\(?:[^\\]+\\)*[^\\]*$/.test(path);
    const unc = /^\\\\[^\\]+\\[^\\]+(?:\\[^\\]+)*$/.test(path);
    const root = /^[A-Za-z]:\\$/.test(path) || /^\\\\[^\\]+\\[^\\]+\\?$/.test(path);
    return !root && path.trim() === path && (drive || unc) &&
      !path.split("\\").some((part) => part === ".." || part === ".");
  }
  return path.trim() === path && path.startsWith("/") && path !== "/" &&
    !path.endsWith("/") && !path.includes("//") &&
    !path.split("/").some((part) => part === ".." || part === ".");
}

function assertRuntimePins(
  acpxPackage: string,
  adapter: string,
  museAdapter: string,
): void {
  if (process.versions.node !== pins.nodeVersion) {
    throw new Error("packaged Node runtime version mismatch");
  }
  if (fileSha256(process.execPath) !== targetArtifacts.nodeBinarySha256) {
    throw new Error("packaged Node executable digest mismatch");
  }
  const runtimeDigest = fileSha256(join(acpxPackage, "dist", "runtime.js"));
  if (runtimeDigest !== pins.acpx.runtimeSha256) {
    throw new Error("packaged acpx runtime digest mismatch");
  }
  const lifelineDigest = fileSha256(join(acpxPackage, "dist", "native", "lifeline"));
  if (lifelineDigest !== targetArtifacts.acpxLifelineSha256) {
    throw new Error("packaged acpx lifeline digest mismatch");
  }
  if (fileSha256(adapter) !== pins.adapter.entrySha256) {
    throw new Error("packaged ACP adapter digest mismatch");
  }
  if (fileSha256(museAdapter) !== pins.adapterMuse.entrySha256) {
    throw new Error("packaged Muse ACP adapter digest mismatch");
  }
  const codexBinary = join(
    runtimeRoot,
    "adapter",
    "node_modules",
    ...targetArtifacts.codexPackage.split("/"),
    ...targetArtifacts.codexBinaryPath.split("/"),
  );
  if (fileSha256(codexBinary) !== targetArtifacts.codexBinarySha256) {
    throw new Error("packaged Codex executable digest mismatch");
  }
}

function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeResponse(requestId: string, payload: unknown): void {
  write({ protocol: CHAT_HOST_IPC_PROTOCOL, requestId, ok: true, payload });
}

function writeError(requestId: string, error: string): void {
  write({ protocol: CHAT_HOST_IPC_PROTOCOL, requestId, ok: false, error });
}

function write(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Chat Host request failed";
  return [...message].map((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("").slice(0, 1_000);
}
