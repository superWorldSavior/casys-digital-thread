export type RuntimePermissionDecision =
  | "allow_once"
  | "allow_always"
  | "reject_once"
  | "reject_always"
  | "cancel";

export interface RuntimePermissionRequest {
  readonly sessionId: string;
  readonly inferredKind?: string;
  readonly raw: {
    readonly toolCall: {
      readonly toolCallId: string;
      readonly title?: string | null;
      readonly kind?: string | null;
    };
    readonly options: readonly {
      readonly name: string;
      readonly kind: string;
    }[];
  };
}

export interface RuntimeElicitationContext {
  readonly requestId: string | number;
  readonly signal: AbortSignal;
}

export interface RuntimeElicitationRequest {
  readonly mode: string;
  readonly message: string;
  readonly sessionId: string;
  readonly requestId?: string;
  readonly toolCallId?: string | null;
  readonly elicitationId?: string;
  readonly url?: string;
  readonly requestedSchema?: unknown;
}

export type RuntimeElicitationResponse =
  | {
    readonly action: "accept";
    readonly content?: Readonly<Record<string, string | number | boolean | string[]>>;
  }
  | { readonly action: "decline" }
  | { readonly action: "cancel" };

export interface RuntimeHandle {
  readonly sessionKey: string;
  readonly backend: string;
  readonly runtimeSessionName: string;
  readonly backendSessionId?: string;
  readonly agentSessionId?: string;
}

export type RuntimeEvent =
  | {
    readonly type: "text_delta";
    readonly text: string;
    readonly stream?: "output" | "thought";
  }
  | {
    readonly type: "status";
    readonly text: string;
  }
  | {
    readonly type: "tool_call";
    readonly text: string;
    readonly title?: string;
    readonly status?: string;
    readonly kind?: string;
    readonly toolCallId?: string;
    /**
     * Exact MCP tool input/output forwarded by the agent runtime when the
     * adapter populates them (`{server, tool, arguments}` /
     * `{result, error}`). The coordinator validates before retaining.
     */
    readonly rawInput?: unknown;
    readonly rawOutput?: unknown;
  };

export type RuntimeTurnResult =
  | { readonly status: "completed"; readonly stopReason?: string }
  | { readonly status: "cancelled"; readonly stopReason?: string }
  | {
    readonly status: "failed";
    readonly error: { readonly message: string; readonly retryable?: boolean };
  };

export interface RuntimeTurn {
  readonly events: AsyncIterable<RuntimeEvent>;
  readonly result: Promise<RuntimeTurnResult>;
  /**
   * Resolves at confirmed prompt submission. Runtimes that submit
   * asynchronously (the pinned acpx runtime) MUST expose it; runtimes whose
   * startTurn submits synchronously omit it. Rejects when the turn dies
   * before submission (notably on cancel), in which case nothing the caller
   * passed was transmitted. Callers MUST read it exactly once: the pinned
   * runtime implements it as a getter returning a new promise per access,
   * and an abandoned read rejects without a handler.
   */
  readonly promptStarted?: Promise<void>;
  cancel(input?: { reason?: string }): Promise<void>;
  closeStream(input?: { reason?: string }): Promise<void>;
}

export interface ChatRuntimePort {
  ensureSession(input: {
    readonly sessionKey: string;
    readonly agent: string;
    readonly mode: "persistent";
    readonly cwd: string;
    readonly sessionOptions: {
      readonly systemPrompt: string;
    };
  }): Promise<RuntimeHandle>;
  startTurn(input: {
    readonly handle: RuntimeHandle;
    readonly text: string;
    readonly mode: "prompt";
    readonly requestId: string;
    readonly signal: AbortSignal;
    readonly onElicitation: (
      request: RuntimeElicitationRequest,
      context: RuntimeElicitationContext,
    ) => Promise<RuntimeElicitationResponse>;
  }): RuntimeTurn;
  cancel(
    input: { readonly handle: RuntimeHandle; readonly reason?: string },
  ): Promise<void>;
  close(input: {
    readonly handle: RuntimeHandle;
    readonly reason: string;
    readonly discardPersistentState?: boolean;
  }): Promise<void>;
}

export interface RuntimeInteractionSink {
  requestPermission(
    request: RuntimePermissionRequest,
    signal: AbortSignal,
  ): Promise<{ readonly outcome: RuntimePermissionDecision } | undefined>;
}

export interface ChatRuntimeAdapter {
  readonly runtime: ChatRuntimePort;
  /**
   * Captured MCP sessions use a fresh, revocable transport scope per turn.
   * Close their live handle after each turn, preserving the native session
   * record so the next ensure resumes history with a new scope.
   */
  readonly refreshSessionPerTurn?: boolean;
  setInteractionSink(sink: RuntimeInteractionSink): void;
  close(): Promise<void>;
}

/**
 * Host-side MCP server a standalone conversation can attach. Connection
 * ownership, endpoints, and credentials never leave the host: the renderer
 * only sees the advertised identity subset.
 */
export interface ChatMcpServerConfig {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly transport: "streamable-http";
  readonly mcpUrl: string;
  readonly healthUrl: string;
  readonly expectedTools: readonly string[];
  /**
   * Exact `ui://` App views the fleet manifest admits for this server.
   * Empty when the manifest declares none: attachment still works, but
   * no viewer App opens and no viewer resource reads are authorized.
   */
  readonly expectedViews: readonly string[];
}

export type ChatMcpProbeOutcome =
  | { readonly ok: true; readonly tools: readonly string[] }
  | { readonly ok: false; readonly error: string };

/**
 * Runtime pool key. MCP servers are fixed when an ACP runtime is created,
 * so each MCP set owns its runtime: project conversations keep the fixed
 * Digital Thread server, standalone conversations start with zero MCPs and
 * switch runtime when an MCP is enabled or disabled.
 */
export function chatRuntimeKey(
  kind: "project" | "standalone",
  mcpId?: string,
): string {
  if (kind === "project") return "project";
  return mcpId === undefined ? "standalone" : `standalone+mcp:${mcpId}`;
}
