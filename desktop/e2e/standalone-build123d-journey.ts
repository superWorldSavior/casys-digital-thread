/**
 * Packaged #53 headless journey, run manually with Deno permissions after a
 * fresh package. This uses the actual app helper and the ambient Codex login.
 * It cannot prove native WebView pixels or first-install behaviour.
 *
 * The probe retains its temporary data root for inspection. It never logs
 * credentials, provider URLs, MCP relay tokens, or raw model responses.
 */
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ChatHostClient } from "../src/chat-host/client.ts";
import { ToolRuntimeHost } from "../src/tool-runtime/backend.ts";
import {
  synchronizeStartupDemand,
  withToolRuntimeDemand,
} from "../src/tool-runtime/chat-demand.ts";
import {
  MANAGED_TOOL_IDS,
  ToolRuntimeLifecycle,
} from "../src/tool-runtime/lifecycle.ts";
import type {
  ChatCommandRequest,
  ChatConversationDto,
  ChatToolViewerDto,
} from "../../src/presentation/desktop/chat/contracts.ts";

const APP = fileURLToPath(new URL("../dist/CasysDigitalThread.app", import.meta.url));
const HELPER = `${APP}/Contents/Helpers/casys-chat-host`;
const PROTOCOL = "casys-desktop-chat/1.0" as const;
const PROFILE = "casys-codex";
const TOOL = "build123d";
const root = await Deno.makeTempDir({
  dir: "/tmp",
  prefix: "casys-sep30-codex-",
});
const chatData = `${root}/chat-data`;
const runtimeData = `${root}/tool-runtime`;
const isolatedCodexHome = `${root}/codex-auth`;
let isolatedAuthReady = false;
const started = Date.now();
const marks: Record<string, number> = {};
const say = (phase: string, detail: string) =>
  console.log(`[journey] ${phase}: ${detail}`);
function assert(value: unknown, detail: string): asserts value {
  if (!value) throw new Error(detail);
}
const mark = (phase: string) => marks[phase] = Date.now() - started;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let nonce = 0;
let permissionPrompts = 0;
let formPrompts = 0;
const req = () => `journey-${++nonce}`;
type Host = Pick<ChatHostClient, "snapshot" | "command">;
type WithoutEnvelope<T> = T extends unknown ? Omit<T, "protocol" | "requestId">
  : never;
type CommandInput = WithoutEnvelope<ChatCommandRequest>;

function ambientAgentEnv(): Record<string, string> {
  const keys = [
    "HOME",
    "CODEX_HOME",
    "PATH",
    "USER",
    "LOGNAME",
    "SHELL",
    "LANG",
    "TMPDIR",
    "XDG_CONFIG_HOME",
    "SSL_CERT_FILE",
    "NODE_EXTRA_CA_CERTS",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
  ];
  const env: Record<string, string> = {};
  for (const key of keys) {
    const value = Deno.env.get(key);
    if (value !== undefined) env[key] = value;
  }
  assert(env.HOME && env.PATH, "ambient HOME/PATH unavailable");
  if (isolatedAuthReady) env.CODEX_HOME = isolatedCodexHome;
  return env;
}

async function prepareIsolatedCodexAuth(): Promise<void> {
  const home = Deno.env.get("HOME");
  const candidates = [Deno.env.get("CODEX_HOME"), home && `${home}/.codex`]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  let source: string | undefined;
  for (const candidate of candidates) {
    try {
      if ((await Deno.stat(`${candidate}/auth.json`)).isFile) {
        source = `${candidate}/auth.json`;
        break;
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw new Error("Could not inspect ambient Codex authentication file");
      }
    }
  }
  if (!source) {
    throw new Error(
      "Isolated Codex authentication unavailable; ambient config is incompatible with the packaged CLI",
    );
  }
  await Deno.mkdir(isolatedCodexHome, { mode: 0o700 });
  await Deno.chmod(isolatedCodexHome, 0o700);
  try {
    await Deno.copyFile(source, `${isolatedCodexHome}/auth.json`);
    await Deno.chmod(`${isolatedCodexHome}/auth.json`, 0o600);
  } catch {
    throw new Error("Could not prepare isolated Codex authentication file");
  }
  isolatedAuthReady = true;
  say(
    "auth",
    "using isolated copy of existing Codex login; ambient config excluded",
  );
}

async function dockerIds(): Promise<Set<string>> {
  const output = await new Deno.Command("docker", {
    args: ["ps", "--format", "{{.ID}} {{.Names}}"],
    stdout: "piped",
    stderr: "null",
  }).output();
  assert(output.success, "Docker inventory unavailable");
  return new Set(
    new TextDecoder().decode(output.stdout).split("\n")
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts.length === 2)
      .map((parts) => parts[0]),
  );
}

async function ownedRunningCount(): Promise<number> {
  const output = await new Deno.Command("docker", {
    args: ["ps", "--format", "{{.Names}}"],
    stdout: "piped",
    stderr: "null",
  }).output();
  assert(output.success, "Docker inventory unavailable");
  return new TextDecoder().decode(output.stdout).split("\n")
    .filter((name) => name.includes("casys-host-build123d")).length;
}

let activeHost: ChatHostClient | undefined;
const lifecycle = new ToolRuntimeLifecycle({
  backend: new ToolRuntimeHost({ dataDirectory: runtimeData }),
  dataDirectory: runtimeData,
  idleDelayMs: 180_000,
  onProviderStopped: (toolId) => {
    void activeHost?.mcpRelease(toolId).catch(() => undefined);
  },
});

async function startHost(tag: string): Promise<ChatHostClient> {
  const cwd = `${root}/${tag}`;
  await Deno.mkdir(cwd, { recursive: true });
  return await ChatHostClient.start({
    paths: { executable: HELPER, target: "darwin-arm64" },
    dataRoot: chatData,
    launchCwd: cwd,
    env: ambientAgentEnv(),
    platform: "macOS",
    timeouts: { readyMs: 60_000, requestMs: 180_000 },
  });
}

async function command(host: Host, input: CommandInput) {
  const result = await host.command(
    { protocol: PROTOCOL, requestId: req(), ...input } as ChatCommandRequest,
  );
  assert(
    result.ok,
    `${input.command} failed: ${result.error ?? "unknown error"}`,
  );
  return result;
}

async function conversation(
  host: Host,
  id: string,
): Promise<ChatConversationDto> {
  const snapshot = await host.snapshot({
    protocol: PROTOCOL,
    conversationId: id,
  });
  const found = snapshot.conversations.find((entry) => entry.id === id);
  assert(found, "conversation missing");
  return found;
}

async function waitForTurn(
  host: Host,
  id: string,
  priorMessages: number,
  phase: string,
) {
  const deadline = Date.now() + 420_000;
  while (Date.now() < deadline) {
    const current = await conversation(host, id);
    const pending = current.pendingInteraction;
    if (pending?.type === "permission") {
      permissionPrompts++;
      await command(host, {
        command: "permission.resolve",
        conversationId: id,
        correlationId: pending.correlationId,
        decision: "allow_once",
      });
    } else if (pending?.type === "elicitation-form") {
      formPrompts++;
      await command(host, {
        command: "elicitation.resolve",
        conversationId: id,
        correlationId: pending.correlationId,
        action: "accept",
        content: { persist: "once" },
      });
    } else if (pending) {
      throw new Error(`${phase}: unsupported interaction ${pending.type}`);
    }
    if (current.status === "failed") throw new Error(`${phase}: turn failed`);
    if (current.status === "idle" && current.messages.length > priorMessages) {
      return current;
    }
    await pause(1_000);
  }
  throw new Error(`${phase}: turn timeout`);
}

async function waitForArchive(
  host: Host,
  id: string,
  since: number,
  artifactCount: number,
  phase: string,
): Promise<ChatToolViewerDto> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const current = await conversation(host, id);
    const viewer = current.viewers.slice(since).find((entry) =>
      entry.archive && entry.archive.artifacts.length >= artifactCount &&
      entry.archive.artifacts.every((artifact) => artifact.state === "saved")
    );
    if (viewer) return viewer;
    await pause(500);
  }
  throw new Error(`${phase}: saved viewer archive unavailable`);
}

async function sendTurn(
  host: Host,
  id: string,
  text: string,
  phase: string,
  artifactCount: number,
) {
  const before = await conversation(host, id);
  await command(host, { command: "message.send", conversationId: id, text });
  const settled = await waitForTurn(host, id, before.messages.length, phase);
  const viewer = await waitForArchive(
    host,
    id,
    before.viewers.length,
    artifactCount,
    phase,
  );
  return { settled, viewer };
}

async function savedBytes(host: Host, id: string, viewer: ChatToolViewerDto) {
  const archive = viewer.archive;
  assert(archive, "viewer archive absent");
  const captures = [];
  for (const artifact of archive.artifacts) {
    assert(artifact.state === "saved", "artifact not saved");
    const result = await command(host, {
      command: "viewer.resource-read",
      conversationId: id,
      toolCallId: viewer.viewerId,
      uri: artifact.uri,
    });
    const resource = result.viewerResource;
    assert(
      resource && resource.source === "saved",
      "artifact did not load from saved bytes",
    );
    const bytes = Uint8Array.from(
      atob(resource.data),
      (char) => char.charCodeAt(0),
    );
    const digest = createHash("sha256").update(bytes).digest("hex");
    assert(
      digest === artifact.sha256 && bytes.length === artifact.bytes,
      "saved artifact digest or size differs",
    );
    captures.push({
      uri: artifact.uri,
      digest,
      bytes: bytes.length,
      mimeType: artifact.mimeType,
    });
  }
  return captures;
}

async function archiveInputResult(
  host: Host,
  id: string,
  viewer: ChatToolViewerDto,
) {
  const result = await command(host, {
    command: "viewer.archive-read",
    conversationId: id,
    viewerId: viewer.viewerId,
  });
  const capture = result.viewerCapture;
  assert(
    capture && capture.viewerId === viewer.viewerId,
    "retained input/result unavailable",
  );
  assert(
    Object.keys(capture.toolInput).length > 0,
    "retained tool input empty",
  );
  assert(capture.toolResult !== null, "retained tool result empty");
  assert(
    /Box\(10,\s*10,\s*20\)/.test(JSON.stringify(capture.toolInput)),
    "retained export input did not contain the edited box",
  );
  for (const artifact of viewer.archive?.artifacts ?? []) {
    assert(
      JSON.stringify(capture.toolResult).includes(artifact.uri),
      "retained export result did not name a saved artifact",
    );
  }
  return createHash("sha256").update(JSON.stringify(capture)).digest("hex");
}

const unrelatedBefore = await dockerIds();
let conversationId = "";
const archived: ChatToolViewerDto[] = [];
let exportBytes: Awaited<ReturnType<typeof savedBytes>> = [];
let captureDigest = "";
try {
  await Deno.stat(HELPER);
  await prepareIsolatedCodexAuth();
  const reconciled = await lifecycle.reconcile(TOOL);
  assert(
    reconciled.priorUnresolved === undefined ||
      reconciled.priorUnresolved.length === 0,
    "prior provider shutdown unresolved",
  );
  activeHost = await startHost("first-boot");
  const attached = withToolRuntimeDemand(activeHost, lifecycle);
  await synchronizeStartupDemand(activeHost, lifecycle, [...MANAGED_TOOL_IDS]);
  const initial = await attached.snapshot({ protocol: PROTOCOL });
  const selected = initial.agentProfiles.find((profile) => profile.id === PROFILE);
  assert(
    selected?.available,
    `Codex ACP profile unavailable: ${selected?.missingReason ?? "unknown"}`,
  );
  await command(attached, { command: "agent.set-default", profileId: PROFILE });
  assert(
    (await attached.snapshot({ protocol: PROTOCOL })).defaultAgentProfileId ===
      PROFILE,
    "Codex default did not persist in current host",
  );
  await command(attached, {
    command: "conversation.create",
    title: "Build123d packaged journey",
  });
  const created = await attached.snapshot({ protocol: PROTOCOL });
  conversationId = created.selectedConversationId ?? "";
  assert(conversationId, "new standalone conversation missing");
  assert(
    (await conversation(attached, conversationId)).agentProfileId === PROFILE,
    "new conversation did not inherit Codex profile",
  );
  await command(attached, {
    command: "mcp.enable",
    conversationId,
    mcpId: TOOL,
  });
  assert(
    (await ownedRunningCount()) === 1,
    "expected one owned Build123d provider",
  );
  mark("setup");

  const box1 = await sendTurn(
    attached,
    conversationId,
    "Use build123d_execute with exactly this Python script:\nfrom build123d import *\nresult = Box(10, 10, 10)\nReport its volume in mm^3.",
    "create",
    0,
  );
  assert(
    /(?:^|\D)1[ ,]?000(?:\D|$)/.test(
      box1.settled.messages.map((m) => m.text).join("\n"),
    ),
    "first box volume 1000 absent",
  );
  archived.push(box1.viewer);
  mark("create");

  const box2 = await sendTurn(
    attached,
    conversationId,
    "Edit the box by using build123d_execute with exactly this Python script:\nfrom build123d import *\nresult = Box(10, 10, 20)\nReport its new volume in mm^3.",
    "edit",
    0,
  );
  assert(
    /(?:^|\D)2[ ,]?000(?:\D|$)/.test(
      box2.settled.messages.map((m) => m.text).join("\n"),
    ),
    "edited box volume 2000 absent",
  );
  archived.push(box2.viewer);
  mark("edit");

  const exported = await sendTurn(
    attached,
    conversationId,
    "Use one build123d_export call with exactly this Python script, unchanged:\nfrom build123d import *\nresult = Box(10, 10, 20)\nSet base name sep30-codex-box and formats STEP, STL, glTF. Do not change the dimensions. Report the volume 2000 mm^3.",
    "export",
    3,
  );
  assert(
    exported.viewer.tool === "build123d_export",
    "three-file viewer is not build123d_export",
  );
  archived.push(exported.viewer);
  exportBytes = await savedBytes(attached, conversationId, exported.viewer);
  assert(
    exportBytes.length === 3,
    "expected exactly three retained export files",
  );
  const media = exportBytes.map((file) => file.mimeType.toLowerCase()).join(
    " ",
  );
  assert(
    media.includes("step") && media.includes("stl") &&
      (media.includes("gltf") || media.includes("glb")),
    "STEP/STL/glTF media are incomplete",
  );
  captureDigest = await archiveInputResult(
    attached,
    conversationId,
    exported.viewer,
  );
  const app = await command(attached, {
    command: "viewer.open",
    conversationId,
    toolCallId: exported.viewer.viewerId,
  });
  assert(app.viewer?.app.fingerprint, "live MCP App document did not open");
  await command(attached, {
    command: "canvas.set-layout",
    conversationId,
    layout: {
      version: 1,
      nodes: archived.map((viewer, index) => ({
        id: `viewer-${index}`,
        kind: "viewer",
        viewerId: viewer.viewerId,
        title: index === 2 ? "Export" : `Box ${index + 1}`,
        x: index * 320,
        y: 0,
        z: index,
      })),
      groups: [],
    },
  });
  mark("export");

  await command(attached, { command: "mcp.disable", conversationId });
  const drained = await lifecycle.drain();
  assert(drained.unresolved.length === 0, "provider drain unresolved");
  assert(
    (await ownedRunningCount()) === 0,
    "owned Build123d provider still running",
  );
  const stop = await activeHost.stop();
  assert(stop.status === "stopped", "first host did not stop cleanly");
  activeHost = undefined;
  mark("quit");

  activeHost = await startHost("reopen-offline");
  const snapshot = await activeHost.snapshot({
    protocol: PROTOCOL,
    conversationId,
  });
  assert(
    snapshot.defaultAgentProfileId === PROFILE,
    "reopened default profile changed",
  );
  const reopened = snapshot.conversations.find((entry) => entry.id === conversationId);
  assert(
    reopened?.agentProfileId === PROFILE,
    "reopened conversation profile changed",
  );
  assert(
    reopened.mcp === undefined,
    "reopened conversation unexpectedly attached provider",
  );
  assert(
    archived.every((old) =>
      reopened.viewers.some((now) => now.viewerId === old.viewerId)
    ),
    "retained viewer versions missing after restart",
  );
  const layout = await command(activeHost, {
    command: "canvas.get-layout",
    conversationId,
  });
  assert(
    layout.layout?.nodes.length === 3,
    "Canvas layout missing after restart",
  );
  assert(
    layout.layout.nodes.every((node, index) =>
      node.viewerId === archived[index].viewerId
    ),
    "Canvas viewer references changed",
  );
  const reread = await savedBytes(activeHost, conversationId, archived[2]);
  assert(
    JSON.stringify(reread) === JSON.stringify(exportBytes),
    "offline artifact bytes changed",
  );
  assert(
    await archiveInputResult(activeHost, conversationId, archived[2]) ===
      captureDigest,
    "offline input/result changed",
  );
  assert((await ownedRunningCount()) === 0, "offline read restarted provider");
  mark("reopen");

  const unrelatedAfter = await dockerIds();
  assert(
    [...unrelatedBefore].every((id) => unrelatedAfter.has(id)),
    "unrelated running Docker container stopped",
  );
  say(
    "PASS",
    `data=${root} conversation=${conversationId} viewers=${archived.length} files=${exportBytes.length}`,
  );
  say(
    "evidence",
    `saved sha256=${
      exportBytes.map((file) => file.digest).join(",")
    } input-result sha256=${captureDigest}`,
  );
  say("elapsed-ms", JSON.stringify(marks));
  say(
    "interaction-counts",
    JSON.stringify({
      agentTurns: 3,
      permissionPrompts,
      formPrompts,
      terminalDriverLaunches: 1,
      uiSteps: "unmeasured",
    }),
  );
} finally {
  if (activeHost) await activeHost.stop().catch(() => undefined);
  const drained = await lifecycle.drain().catch(() => undefined);
  if (drained?.unresolved.length) {
    say("cleanup", "provider shutdown unresolved; inspect retained temp root");
  }
  await Deno.remove(isolatedCodexHome, { recursive: true }).catch(() => {
    say("cleanup", "isolated Codex authentication removal failed");
  });
  say("retained", root);
}
