import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import {
  type ChatCommandRequest,
  type ChatCommandResponse,
  type ChatSnapshotDto,
  DESKTOP_CHAT_PROTOCOL,
} from "../../../src/presentation/desktop/chat/contracts.ts";
import {
  type DemandChatHost,
  type DemandLifecycle,
  synchronizeStartupDemand,
  withToolRuntimeDemand,
} from "./chat-demand.ts";
import type { LifecycleEnsureOutcome } from "./lifecycle.ts";

const ENDPOINT = {
  mcpUrl: "http://127.0.0.1:45678/mcp",
  healthUrl: "http://127.0.0.1:45678/health",
};

const READY: LifecycleEnsureOutcome = {
  status: "ready",
  binding: {
    schema: "desktop-tool-runtime-binding/1.0",
    toolId: "build123d",
    hostPort: 45678,
    ...ENDPOINT,
    updatedAt: "2026-09-28T00:00:00.000Z",
  },
};

function ok(requestId: string, conversationId = "c1"): ChatCommandResponse {
  return { protocol: DESKTOP_CHAT_PROTOCOL, requestId, ok: true, conversationId };
}

function failed(requestId: string, error: string): ChatCommandResponse {
  return { protocol: DESKTOP_CHAT_PROTOCOL, requestId, ok: false, error };
}

interface Harness {
  decorated: DemandChatHost;
  ensured: string[];
  acquired: [string, string][];
  released: [string, string][];
  attached: { mcpId: string; mcpUrl: string; healthUrl: string }[];
  commands: string[];
}

function harness(options: {
  ensure?: LifecycleEnsureOutcome;
  endpoint?: typeof ENDPOINT | undefined;
  attachThrows?: boolean;
  command?: (request: ChatCommandRequest) => ChatCommandResponse;
} = {}): Harness {
  const ensured: string[] = [];
  const acquired: [string, string][] = [];
  const released: [string, string][] = [];
  const attached: Harness["attached"] = [];
  const commands: string[] = [];
  const synced: [string, readonly string[]][] = [];
  const lifecycle: DemandLifecycle = {
    ensure: (toolId) => {
      ensured.push(toolId);
      return Promise.resolve(options.ensure ?? READY);
    },
    acquire: (toolId, holder) => void acquired.push([toolId, holder]),
    release: (toolId, holder) => void released.push([toolId, holder]),
    syncDemand: (toolId, holders) => void synced.push([toolId, holders]),
    resolveEndpoint: () => ("endpoint" in options ? options.endpoint : ENDPOINT),
  };
  const host: DemandChatHost = {
    snapshot: () => Promise.reject(new Error("not implemented")),
    command: (request) => {
      commands.push(request.command);
      return Promise.resolve(
        options.command?.(request) ??
          ok(
            request.requestId,
            "conversationId" in request ? request.conversationId : "c1",
          ),
      );
    },
    mcpEnsure: (input) => {
      if (options.attachThrows) return Promise.reject(new Error("host refused"));
      attached.push({ ...input });
      return Promise.resolve({ attached: true });
    },
    mcpRelease: () => Promise.resolve({ released: true }),
  };
  return {
    decorated: withToolRuntimeDemand(host, lifecycle),
    ensured,
    acquired,
    released,
    attached,
    commands,
  };
}

function enable(conversationId = "c1", mcpId = "build123d"): ChatCommandRequest {
  return {
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId,
  };
}

Deno.test("enable ensures, assigns, then holds demand on success", async () => {
  const { decorated, ensured, acquired, released, attached, commands } = harness();
  const response = await decorated.command(enable());
  assertEquals(response.ok, true);
  assertEquals(ensured, ["build123d"]);
  assertEquals(attached, [{ mcpId: "build123d", ...ENDPOINT }]);
  assertEquals(acquired, [["build123d", "chat:c1"]]);
  assertEquals(released, []);
  assertEquals(commands, ["mcp.enable"]);
});

Deno.test("enable releases demand when the host attach fails", async () => {
  const { decorated, acquired, released } = harness({
    command: (request) => failed(request.requestId, "probe failed"),
  });
  const response = await decorated.command(enable());
  assertEquals(response.ok, false);
  assertEquals(acquired, [["build123d", "chat:c1"]]);
  assertEquals(released, [["build123d", "chat:c1"]]);
});

Deno.test("enable releases demand when the host command rejects", async () => {
  const host: DemandChatHost = {
    snapshot: () => Promise.reject(new Error("not implemented")),
    command: () => Promise.reject(new Error("IPC request timed out")),
    mcpEnsure: () => Promise.resolve({ attached: true }),
    mcpRelease: () => Promise.resolve({ released: true }),
  };
  const released: [string, string][] = [];
  const lifecycle: DemandLifecycle = {
    ensure: () => Promise.resolve(READY),
    acquire: () => undefined,
    release: (toolId, holder) => void released.push([toolId, holder]),
    syncDemand: () => undefined,
    resolveEndpoint: () => ENDPOINT,
  };
  const decorated = withToolRuntimeDemand(host, lifecycle);
  await assertRejects(() => decorated.command(enable()), Error, "timed out");
  assertEquals(released, [["build123d", "chat:c1"]]);
});

Deno.test("enable fails before the host when ensure or assign fails", async () => {
  const refused = harness({
    ensure: {
      status: "needs-action",
      code: "engine-unavailable",
      detail: "Engine is down.",
      recovery: "Start it.",
    },
  });
  const ensureFailed = await refused.decorated.command(enable());
  assertEquals(ensureFailed.ok, false);
  assert((ensureFailed.error ?? "").includes("Engine is down."));
  assertEquals(refused.commands, []);
  assertEquals(refused.acquired, []);
  const unassigned = harness({ endpoint: undefined });
  const assignFailed = await unassigned.decorated.command(enable());
  assertEquals(assignFailed.ok, false);
  assertEquals(unassigned.commands, []);
  const attachFailed = harness({ attachThrows: true });
  const attachRefused = await attachFailed.decorated.command(enable());
  assertEquals(attachRefused.ok, false);
  assert((attachRefused.error ?? "").includes("host refused"));
  assertEquals(attachFailed.acquired, []);
});

Deno.test("disable and close release the chat holder on success only", async () => {
  const { decorated, released } = harness();
  const disabled = await decorated.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "disable-1",
    command: "mcp.disable",
    conversationId: "c1",
  });
  assertEquals(disabled.ok, true);
  assertEquals(released, [["build123d", "chat:c1"]]);
  const closed = await decorated.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "close-1",
    command: "conversation.close",
    conversationId: "c1",
  });
  assertEquals(closed.ok, true);
  assertEquals(released.length, 2);
  const failing = harness({ command: (request) => failed(request.requestId, "busy") });
  await failing.decorated.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "disable-2",
    command: "mcp.disable",
    conversationId: "c1",
  });
  assertEquals(failing.released, []);
});

Deno.test("viewer operations hold an op claim without ensuring", async () => {
  const seen: [string, string][][] = [];
  const { decorated, ensured, acquired, released } = harness({
    command: (request) => {
      seen.push([...acquired]);
      return ok(
        request.requestId,
        "conversationId" in request ? request.conversationId : "c1",
      );
    },
  });
  const response = await decorated.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "op-1",
    command: "viewer.tool-call",
    conversationId: "c1",
    toolCallId: "t1",
    name: "build123d_execute",
    arguments: {},
  });
  assertEquals(response.ok, true);
  assertEquals(ensured, []);
  assertEquals(seen, [[["build123d", "op:op-1"]]]);
  assertEquals(released, [["build123d", "op:op-1"]]);
});

Deno.test("startup sync reattaches persisted connections and sets demand", async () => {
  const ensured: string[] = [];
  const pushed: string[] = [];
  const synced: [string, readonly string[]][] = [];
  const lifecycle: DemandLifecycle = {
    ensure: (toolId) => {
      ensured.push(toolId);
      return Promise.resolve(READY);
    },
    acquire: () => undefined,
    release: () => undefined,
    syncDemand: (toolId, holders) => void synced.push([toolId, holders]),
    resolveEndpoint: () => ENDPOINT,
  };
  const host: DemandChatHost = {
    snapshot: () =>
      Promise.resolve({
        protocol: DESKTOP_CHAT_PROTOCOL,
        host: "ready" as const,
        conversations: [
          {
            id: "c1",
            kind: "standalone" as const,
            mcp: {
              id: "build123d",
              displayName: "B",
              status: "connected" as const,
              tools: [],
            },
          },
          {
            id: "c2",
            kind: "standalone" as const,
            mcp: {
              id: "build123d",
              displayName: "B",
              status: "failed" as const,
              tools: [],
            },
          },
          {
            id: "closed",
            kind: "standalone" as const,
            status: "closed" as const,
            mcp: {
              id: "build123d",
              displayName: "B",
              status: "connected" as const,
              tools: [],
            },
          },
          { id: "c3", kind: "standalone" as const },
        ] as unknown as ChatSnapshotDto["conversations"],
        connectableMcps: [],
        agentProfiles: [],
        defaultAgentProfileId: "casys-muse",
      }),
    command: () => Promise.reject(new Error("not implemented")),
    mcpEnsure: (input) => {
      pushed.push(input.mcpId);
      return Promise.resolve({ attached: true });
    },
    mcpRelease: () => Promise.resolve({ released: true }),
  };
  await synchronizeStartupDemand(host, lifecycle, ["build123d"]);
  assertEquals(ensured, ["build123d"]);
  assertEquals(pushed, ["build123d"]);
  assertEquals(synced, [["build123d", ["chat:c1"]]]);
});

Deno.test("startup sync leaves a closed attached chat without provider demand", async () => {
  const calls: string[] = [];
  const lifecycle: DemandLifecycle = {
    ensure: () => {
      calls.push("ensure");
      return Promise.resolve(READY);
    },
    acquire: () => undefined,
    release: () => undefined,
    syncDemand: (_toolId, holders) => void calls.push(`holders:${holders.join(",")}`),
    resolveEndpoint: () => ENDPOINT,
  };
  const host: DemandChatHost = {
    snapshot: () =>
      Promise.resolve({
        protocol: DESKTOP_CHAT_PROTOCOL,
        host: "ready",
        conversations: [{
          id: "closed",
          kind: "standalone",
          status: "closed",
          mcp: { id: "build123d", displayName: "B", status: "connected", tools: [] },
        }] as unknown as ChatSnapshotDto["conversations"],
        connectableMcps: [],
        agentProfiles: [],
        defaultAgentProfileId: "casys-muse",
      }),
    command: () => Promise.reject(new Error("not implemented")),
    mcpEnsure: () => {
      calls.push("relay");
      return Promise.resolve({ attached: true });
    },
    mcpRelease: () => Promise.resolve({ released: false }),
  };
  await synchronizeStartupDemand(host, lifecycle, ["build123d"]);
  assertEquals(calls, ["holders:"]);
});

Deno.test("startup sync without a readable host sets empty demand", async () => {
  const synced: [string, readonly string[]][] = [];
  let ensures = 0;
  const lifecycle: DemandLifecycle = {
    ensure: () => {
      ensures++;
      return Promise.resolve(READY);
    },
    acquire: () => undefined,
    release: () => undefined,
    syncDemand: (toolId, holders) => void synced.push([toolId, holders]),
    resolveEndpoint: () => ENDPOINT,
  };
  await synchronizeStartupDemand(undefined, lifecycle, ["build123d"]);
  assertEquals(ensures, 0);
  assertEquals(synced, [["build123d", []]]);
  const failing: DemandChatHost = {
    snapshot: () => Promise.reject(new Error("host down")),
    command: () => Promise.reject(new Error("not implemented")),
    mcpEnsure: () => Promise.resolve({ attached: true }),
    mcpRelease: () => Promise.resolve({ released: true }),
  };
  await synchronizeStartupDemand(failing, lifecycle, ["build123d", "other"]);
  assertEquals(ensures, 0);
  assertEquals(synced.slice(1), [["build123d", []], ["other", []]]);
});

Deno.test("foreign MCP ids pass through untouched", async () => {
  const { decorated, ensured, acquired, commands } = harness();
  const response = await decorated.command(enable("c1", "external"));
  assertEquals(response.ok, true);
  assertEquals(ensured, []);
  assertEquals(acquired, []);
  assertEquals(commands, ["mcp.enable"]);
});
