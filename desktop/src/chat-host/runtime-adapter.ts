import { join } from "node:path";
import type {
  ChatRuntimeAdapter,
  ChatRuntimePort,
  RuntimeEvent,
  RuntimeHandle,
  RuntimeInteractionSink,
  RuntimeTurn,
} from "../chat/runtime-port.ts";
import type { McpObservedCall, McpRelayScope } from "./mcp-relay.ts";

export interface AcpxRuntimeModule {
  createAcpRuntime(options: Record<string, unknown>): ChatRuntimePort;
  createFileSessionStore(options: { readonly stateDir: string }): unknown;
  createAgentRegistry(options: {
    readonly overrides: Readonly<Record<string, readonly string[]>>;
  }): unknown;
}

export interface PinnedMcpServer {
  /** Fleet identity for host-owned result capture; absent on legacy paths. */
  readonly id?: string;
  readonly name: string;
  readonly url: string;
}

export interface PinnedRuntimeOptions {
  readonly dataRoot: string;
  readonly workspaceRoot: string;
  readonly acpxRuntimeUrl: string;
  readonly agentName: string;
  readonly agentArgv: readonly string[];
  readonly mcpServers: readonly PinnedMcpServer[];
  /** Persistent acpx store directory. Scoped runtimes reuse this exact store. */
  readonly sessionStoreDir: string;
  /** Host-owned MCP observation, enabled only for a single attached server. */
  readonly mcpCapture?: {
    readonly openScope: (server: PinnedMcpServer) => McpRelayScope;
  };
}

interface ScopedSession {
  readonly handle: RuntimeHandle;
  readonly runtime: ChatRuntimePort;
  readonly scope: McpRelayScope;
  readonly serverId: string;
  activeEvents?: EventQueue;
  closing?: Promise<void>;
  turnUsed: boolean;
  closed: boolean;
}

const CODEX_CONFIGURATION_MESSAGE =
  "Codex configuration is incompatible with the bundled Codex version. Use a compatible Codex configuration for this profile.";

function safeSessionError(agentName: string, error: unknown): unknown {
  if (agentName !== "casys-codex" || error === null || typeof error !== "object") {
    return error;
  }
  const candidate = error as { name?: unknown; code?: unknown; data?: unknown };
  if (
    candidate.name !== "RequestError" || candidate.code !== -32603 ||
    typeof candidate.data !== "string" ||
    !/configuration/i.test(candidate.data) ||
    !/(?:invalid\s+type|deserializ|pars(?:e|ing))/i.test(candidate.data)
  ) return error;
  // The ACP data contains an absolute user config path and parser details.
  // Keep the original error private; only the fixed diagnosis reaches chat.
  return new Error(CODEX_CONFIGURATION_MESSAGE);
}

/** Loads only the packaged acpx/runtime export. The module is externalized by the Node bundle. */
export async function createPinnedRuntimeAdapter(
  options: PinnedRuntimeOptions,
): Promise<ChatRuntimeAdapter> {
  const acpx = await import(options.acpxRuntimeUrl) as AcpxRuntimeModule;
  return createPinnedRuntimeAdapterWithModule(options, acpx);
}

/** Dependency seam for deterministic host tests; production uses the pinned module above. */
export function createPinnedRuntimeAdapterWithModule(
  options: PinnedRuntimeOptions,
  acpx: AcpxRuntimeModule,
): ChatRuntimeAdapter {
  let sink: RuntimeInteractionSink | undefined;
  const createRuntime = (servers: readonly PinnedMcpServer[]): ChatRuntimePort => {
    const native = acpx.createAcpRuntime({
      cwd: options.workspaceRoot,
      sessionStore: acpx.createFileSessionStore({
        stateDir: join(options.dataRoot, options.sessionStoreDir),
      }),
      agentRegistry: acpx.createAgentRegistry({
        overrides: { [options.agentName]: [...options.agentArgv] },
      }),
      mcpServers: servers.map((server) => ({
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
    // AcpxRuntime is a class. Delegate methods explicitly so the legacy and
    // scoped paths both receive the same narrow, safe session diagnosis.
    return {
      async ensureSession(input) {
        try {
          return await native.ensureSession(input);
        } catch (error) {
          throw safeSessionError(options.agentName, error);
        }
      },
      startTurn: (input) => native.startTurn(input),
      cancel: (input) => native.cancel(input),
      close: (input) => native.close(input),
    };
  };

  if (options.mcpCapture === undefined) {
    const runtime = createRuntime(options.mcpServers);
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

  const server = options.mcpServers[0];
  if (options.mcpServers.length !== 1 || server?.id === undefined) {
    throw new Error("MCP capture requires one identified server.");
  }
  const serverId = server.id;
  const capture = options.mcpCapture;
  const bySessionKey = new Map<string, ScopedSession>();
  const closingBySessionKey = new Map<string, Promise<void>>();
  const ensuring = new Set<string>();
  const byHandle = new WeakMap<RuntimeHandle, ScopedSession>();
  const owned = (handle: RuntimeHandle): ScopedSession => {
    const session = byHandle.get(handle);
    if (session === undefined || session.closed) {
      throw new Error("ACP session handle is stale.");
    }
    return session;
  };
  const retire = (
    session: ScopedSession,
    reason: string,
    discardPersistentState = false,
  ): Promise<void> => {
    if (session.closing !== undefined) return session.closing;
    session.closed = true;
    session.scope.close();
    session.activeEvents?.close();
    const key = session.handle.sessionKey;
    const closing = Promise.resolve().then(() =>
      session.runtime.close({
        handle: session.handle,
        reason,
        discardPersistentState,
      })
    ).then(() => {
      if (bySessionKey.get(key) === session) bySessionKey.delete(key);
      if (closingBySessionKey.get(key) === closing) {
        closingBySessionKey.delete(key);
      }
    });
    session.closing = closing;
    closingBySessionKey.set(key, closing);
    return closing;
  };
  const runtime: ChatRuntimePort = {
    async ensureSession(input) {
      // A failed pre-submit turn may have retired its owner without a caller
      // handle. Never create a second ACP owner for the same persistent key
      // until the previous native close has actually completed.
      const closing = closingBySessionKey.get(input.sessionKey);
      if (closing !== undefined) await closing;
      if (bySessionKey.has(input.sessionKey) || ensuring.has(input.sessionKey)) {
        throw new Error("ACP session is already open.");
      }
      ensuring.add(input.sessionKey);
      let scope: McpRelayScope | undefined;
      try {
        scope = capture.openScope(server);
        const inner = createRuntime([{ ...server, url: scope.url }]);
        const handle = await inner.ensureSession(input);
        const session: ScopedSession = {
          handle,
          runtime: inner,
          scope,
          serverId,
          turnUsed: false,
          closed: false,
        };
        bySessionKey.set(input.sessionKey, session);
        byHandle.set(handle, session);
        return handle;
      } catch (error) {
        scope?.close();
        throw error;
      } finally {
        ensuring.delete(input.sessionKey);
      }
    },
    startTurn(input) {
      const session = owned(input.handle);
      if (session.turnUsed) throw new Error("ACP session requires a fresh MCP scope.");
      session.turnUsed = true;
      const events = new EventQueue();
      session.activeEvents = events;
      let settled = false;
      const onResult = (call: McpObservedCall): void => {
        if (settled || session.closed) return;
        events.pushObserved({
          type: "tool_call",
          text: call.tool,
          title: `mcp__${session.serverId}__${call.tool}`,
          toolCallId: call.callId,
          status: call.error === undefined ? "completed" : "failed",
          rawInput: {
            server: session.serverId,
            tool: call.tool,
            arguments: call.args,
          },
          rawOutput: { result: call.result, error: call.error },
        });
      };
      try {
        session.scope.beginTurn(onResult);
        const inner = session.runtime.startTurn(input);
        // The pinned runtime exposes a getter producing a fresh rejecting
        // promise per read. Return this exact promise to the coordinator.
        const nativePromptStarted = inner.promptStarted;
        const promptStarted = nativePromptStarted?.catch(async (error) => {
          await retire(session, "ACP prompt did not start");
          throw error;
        });
        // The native getter was read once above. Observe the derived promise
        // immediately too; the caller may abandon it during shutdown.
        if (promptStarted !== undefined) void promptStarted.catch(() => undefined);
        let streamDone = false;
        const maybeClose = () => {
          if (settled && streamDone) {
            events.close();
            session.activeEvents = undefined;
          }
        };
        void (async () => {
          try {
            for await (const event of inner.events) {
              // Relay observation is the single viewer-result source for
              // scoped sessions. ACP cards remain transcript-only.
              await events.pushNative(
                event.type === "tool_call"
                  ? { ...event, rawInput: undefined, rawOutput: undefined }
                  : event,
              );
            }
          } catch (error) {
            events.fail(error);
          } finally {
            streamDone = true;
            maybeClose();
          }
        })();
        const result = inner.result.finally(() => {
          settled = true;
          session.scope.close();
          maybeClose();
        });
        // A failed promptStarted makes the coordinator return before awaiting
        // result. Observe the rejection now while preserving it for callers.
        void result.catch(() => undefined);
        const turn: RuntimeTurn = {
          events,
          result,
          ...(promptStarted === undefined ? {} : { promptStarted }),
          async cancel(reason) {
            session.scope.close();
            events.close();
            await inner.cancel(reason);
          },
          async closeStream(reason) {
            session.scope.close();
            events.close();
            await inner.closeStream(reason);
          },
        };
        return turn;
      } catch (error) {
        // startTurn is synchronous, so publish the close barrier before
        // rethrowing. ensureSession awaits it on the next attempt.
        void retire(session, "ACP startTurn failed").catch(() => undefined);
        throw error;
      }
    },
    async cancel(input) {
      const session = owned(input.handle);
      session.scope.close();
      // The turn's own cancel path closes its event queue. This handle-level
      // path is used before a turn exists, so there is no queue to release.
      await session.runtime.cancel(input);
    },
    async close(input) {
      const session = byHandle.get(input.handle);
      if (session === undefined) throw new Error("ACP session handle is stale.");
      await retire(
        session,
        input.reason,
        input.discardPersistentState === true,
      );
    },
  };
  return Object.freeze({
    runtime,
    refreshSessionPerTurn: true,
    setInteractionSink(next: RuntimeInteractionSink): void {
      sink = next;
    },
    async close(): Promise<void> {
      sink = undefined;
      const sessions = [...bySessionKey.values()];
      await Promise.allSettled(
        sessions.map((session) =>
          runtime.close({ handle: session.handle, reason: "Chat Host closing" })
        ),
      );
    },
  });
}

/** A single consumer receives native ACP and host-observed tool events. */
class EventQueue implements AsyncIterable<RuntimeEvent> {
  static readonly MAX_PENDING = 64;
  readonly #values: RuntimeEvent[] = [];
  readonly #waiting: Array<() => void> = [];
  readonly #capacityWaiting: Array<() => void> = [];
  #done = false;
  #error: unknown;
  #unretained = 0;

  /** Relay callbacks are synchronous with the provider response. Never block RPC. */
  pushObserved(value: RuntimeEvent): void {
    if (this.#done) return;
    if (this.#values.length >= EventQueue.MAX_PENDING) {
      this.#unretained++;
      this.#wake();
      return;
    }
    this.#values.push(value);
    this.#wake();
  }

  /** Native ACP stream can wait for the coordinator to consume capacity. */
  async pushNative(value: RuntimeEvent): Promise<void> {
    while (!this.#done && this.#values.length >= EventQueue.MAX_PENDING) {
      await new Promise<void>((resolve) => this.#capacityWaiting.push(resolve));
    }
    if (this.#done) return;
    this.#values.push(value);
    this.#wake();
  }

  close(): void {
    this.#done = true;
    this.#wake();
    for (const resolve of this.#capacityWaiting.splice(0)) resolve();
  }

  fail(error: unknown): void {
    this.#error = error;
    this.close();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<RuntimeEvent> {
    while (true) {
      if (this.#values.length > 0) {
        const value = this.#values.shift()!;
        this.#releaseCapacity();
        yield value;
      } else if (this.#unretained > 0) {
        const count = this.#unretained;
        this.#unretained = 0;
        yield {
          type: "status",
          text: `${count} MCP result(s) not retained: the event buffer was full.`,
        };
      } else if (this.#done) {
        if (this.#error !== undefined) throw this.#error;
        return;
      } else {
        await new Promise<void>((resolve) => this.#waiting.push(resolve));
      }
    }
  }

  #wake(): void {
    for (const resolve of this.#waiting.splice(0)) resolve();
  }

  #releaseCapacity(): void {
    if (this.#capacityWaiting.length > 0) this.#capacityWaiting.shift()!();
  }
}
