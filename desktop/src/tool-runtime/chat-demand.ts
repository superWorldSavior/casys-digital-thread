/**
 * Demand-aware Chat Host decorator for app-managed providers (#57).
 *
 * Wraps the Desktop-to-host command proxy: `mcp.enable` on an app-owned id
 * ensures the provider first (allocating its loopback port), assigns the
 * endpoint to the host, and holds a `chat:<conversationId>` demand claim
 * while attached; `mcp.disable` and `conversation.close` release it.
 * In-flight viewer operations hold `op:<requestId>` claims so an armed
 * idle stop never lands mid-call — but viewer operations never start a
 * provider: inspection of detached work fails closed in the host, and the
 * reconnect path (re-enable) restarts transparently.
 *
 * Unknown MCP ids pass through untouched: external providers are
 * disconnected, never stopped or adopted.
 */
import {
  type ChatCommandRequest,
  type ChatCommandResponse,
  type ChatSnapshotDto,
  type ChatSnapshotRequest,
  DESKTOP_CHAT_PROTOCOL,
} from "../../../src/presentation/desktop/chat/contracts.ts";
import { scrubRuntimeIdentity } from "./backend.ts";
import type { LifecycleEnsureOutcome } from "./lifecycle.ts";

export interface DemandChatHost {
  snapshot(request: ChatSnapshotRequest): Promise<ChatSnapshotDto>;
  command(request: ChatCommandRequest): Promise<ChatCommandResponse>;
  mcpEnsure(input: {
    readonly mcpId: string;
    readonly mcpUrl: string;
    readonly healthUrl: string;
  }): Promise<{ attached: boolean }>;
  mcpRelease(mcpId: string): Promise<{ released: boolean }>;
}

export interface DemandLifecycle {
  ensure(toolId: string): Promise<LifecycleEnsureOutcome>;
  acquire(toolId: string, holder: string): void;
  release(toolId: string, holder: string): void;
  syncDemand(toolId: string, holders: readonly string[]): void;
  resolveEndpoint(toolId: string):
    | { readonly mcpUrl: string; readonly healthUrl: string }
    | undefined;
}

export interface ChatDemandOptions {
  /** MCP ids whose providers this app owns. Defaults to Build123d. */
  readonly appOwnedIds?: readonly string[];
}

const VIEWER_OP_COMMANDS = new Set([
  "viewer.open",
  "viewer.tool-call",
  "viewer.resource-read",
]);

export function withToolRuntimeDemand(
  host: DemandChatHost,
  lifecycle: DemandLifecycle,
  options: ChatDemandOptions = {},
): DemandChatHost {
  const owned = new Set(options.appOwnedIds ?? ["build123d"]);
  return {
    snapshot: (request) => host.snapshot(request),
    command: async (request) => {
      if (request.command === "mcp.enable" && owned.has(request.mcpId)) {
        return await enableOwned(host, lifecycle, request);
      }
      if (request.command === "mcp.disable") {
        const response = await host.command(request);
        if (response.ok) {
          // mcp.disable names no tool: release the chat holder on every
          // owned id. Unknown holders are no-ops in the lifecycle.
          for (const toolId of owned) lifecycle.release(toolId, chatHolder(request));
        }
        return response;
      }
      if (request.command === "conversation.close") {
        const response = await host.command(request);
        if (response.ok) {
          for (const toolId of owned) lifecycle.release(toolId, chatHolder(request));
        }
        return response;
      }
      if (VIEWER_OP_COMMANDS.has(request.command)) {
        return await guardedViewerOp(host, lifecycle, owned, request);
      }
      return await host.command(request);
    },
    mcpEnsure: (input) => host.mcpEnsure(input),
    mcpRelease: (mcpId) => host.mcpRelease(mcpId),
  };
}

async function enableOwned(
  host: DemandChatHost,
  lifecycle: DemandLifecycle,
  request: ChatCommandRequest & { command: "mcp.enable" },
): Promise<ChatCommandResponse> {
  const ensured = await lifecycle.ensure(request.mcpId);
  if (ensured.status !== "ready") {
    return refused(request, `${ensured.detail} ${ensured.recovery}`.trim());
  }
  const endpoint = lifecycle.resolveEndpoint(request.mcpId);
  if (endpoint === undefined) {
    return refused(request, "The provider started but its endpoint is not assigned.");
  }
  try {
    await host.mcpEnsure({ mcpId: request.mcpId, ...endpoint });
  } catch (error) {
    return refused(
      request,
      `The provider is running but the chat host refused the attachment: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }
  const holder = chatHolder(request);
  lifecycle.acquire(request.mcpId, holder);
  // host.command can REJECT (IPC write/timeout): release on throw as well,
  // or demand leaks and idle-stop is suppressed forever.
  let response: ChatCommandResponse;
  try {
    response = await host.command(request);
  } catch (error) {
    lifecycle.release(request.mcpId, holder);
    throw error;
  }
  if (!response.ok) lifecycle.release(request.mcpId, holder);
  return response;
}

async function guardedViewerOp(
  host: DemandChatHost,
  lifecycle: DemandLifecycle,
  owned: ReadonlySet<string>,
  request: ChatCommandRequest,
): Promise<ChatCommandResponse> {
  const holder = `op:${request.requestId}`;
  for (const toolId of owned) lifecycle.acquire(toolId, holder);
  try {
    return await host.command(request);
  } finally {
    for (const toolId of owned) lifecycle.release(toolId, holder);
  }
}

function chatHolder(request: { readonly conversationId: string }): string {
  return `chat:${request.conversationId}`;
}

/**
 * Startup synchronization (#57): reads persisted attachments from the
 * host snapshot, ensures one provider per attached tool, pushes the
 * assigned endpoints back to the host (fresh relays and runtimes for
 * conversations that never detached), then sets exact demand. Always
 * runs, even with an unreadable host: zero synced holders lets adopted
 * providers idle-stop instead of leaking.
 */
export async function synchronizeStartupDemand(
  host: DemandChatHost | undefined,
  lifecycle: DemandLifecycle,
  toolIds: readonly string[],
): Promise<void> {
  const managed = new Set(toolIds);
  const holders = new Map<string, string[]>();
  if (host !== undefined) {
    try {
      const snapshot = await host.snapshot({ protocol: DESKTOP_CHAT_PROTOCOL });
      for (const conversation of snapshot.conversations) {
        const attached = conversation.mcp;
        if (
          conversation.status !== "closed" &&
          attached?.status === "connected" && managed.has(attached.id)
        ) {
          const list = holders.get(attached.id) ?? [];
          list.push(`chat:${conversation.id}`);
          holders.set(attached.id, list);
        }
      }
    } catch {
      // Unreadable host: no observable demand, adopt nothing eagerly.
    }
  }
  for (const toolId of toolIds) {
    const demand = holders.get(toolId) ?? [];
    if (host !== undefined && demand.length > 0) {
      const ensured = await lifecycle.ensure(toolId);
      const endpoint = ensured.status === "ready"
        ? lifecycle.resolveEndpoint(toolId)
        : undefined;
      if (endpoint !== undefined) {
        await host.mcpEnsure({ mcpId: toolId, ...endpoint }).catch(() => undefined);
      }
    }
    lifecycle.syncDemand(toolId, demand);
  }
}

function refused(
  request: ChatCommandRequest,
  detail: string,
): ChatCommandResponse {
  return Object.freeze({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: request.requestId,
    ok: false,
    error: scrubRuntimeIdentity(detail).slice(0, 500),
  });
}
