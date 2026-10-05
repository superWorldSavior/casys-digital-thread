import { join } from "node:path";
import type {
  ChatRuntimeAdapter,
  ChatRuntimePort,
  RuntimeInteractionSink,
} from "../chat/runtime-port.ts";

interface AcpxRuntimeModule {
  createAcpRuntime(options: Record<string, unknown>): ChatRuntimePort;
  createFileSessionStore(options: { readonly stateDir: string }): unknown;
  createAgentRegistry(options: {
    readonly overrides: Readonly<Record<string, readonly string[]>>;
  }): unknown;
}

export interface PinnedMcpServer {
  readonly name: string;
  readonly url: string;
}

export interface PinnedRuntimeOptions {
  readonly dataRoot: string;
  readonly workspaceRoot: string;
  readonly acpxRuntimeUrl: string;
  /** ACP registry key for this runtime's agent. */
  readonly agentName: string;
  /** Literal adapter argv (command + args); no shell, no lookup. */
  readonly agentArgv: readonly string[];
  /**
   * MCP servers fixed for this runtime instance. Empty for a standalone
   * runtime with zero engineering MCPs; acpx offers no per-session MCP
   * override, so each MCP set owns its runtime and session store.
   */
  readonly mcpServers: readonly PinnedMcpServer[];
  /** Session store directory name below dataRoot; one per runtime. */
  readonly sessionStoreDir: string;
}

/** Loads only the packaged acpx/runtime export. The module is externalized by the Node bundle. */
export async function createPinnedRuntimeAdapter(
  options: PinnedRuntimeOptions,
): Promise<ChatRuntimeAdapter> {
  const acpx = await import(options.acpxRuntimeUrl) as AcpxRuntimeModule;
  let sink: RuntimeInteractionSink | undefined;
  const runtime = acpx.createAcpRuntime({
    cwd: options.workspaceRoot,
    sessionStore: acpx.createFileSessionStore({
      stateDir: join(options.dataRoot, options.sessionStoreDir),
    }),
    agentRegistry: acpx.createAgentRegistry({
      overrides: {
        [options.agentName]: [...options.agentArgv],
      },
    }),
    mcpServers: options.mcpServers.map((server) => ({
      type: "http",
      name: server.name,
      url: server.url,
      headers: [],
    })),
    permissionMode: "deny-all",
    nonInteractivePermissions: "deny",
    elicitationModes: ["form", "url"],
    onPermissionRequest: (request: unknown, context: { signal: AbortSignal }) => {
      if (sink === undefined) return Promise.resolve(undefined);
      return sink.requestPermission(
        request as Parameters<RuntimeInteractionSink["requestPermission"]>[0],
        context.signal,
      );
    },
  });
  return Object.freeze({
    runtime,
    setInteractionSink(next: RuntimeInteractionSink): void {
      sink = next;
    },
    close(): Promise<void> {
      sink = undefined;
      return Promise.resolve();
    },
  });
}
