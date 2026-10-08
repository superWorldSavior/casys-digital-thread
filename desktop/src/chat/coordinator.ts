import {
  CHAT_CANVAS_LAYOUT_VERSION,
  CHAT_PROJECT_VIEWERS_MAX,
  type ChatCanvasLayoutDto,
  type ChatCommandRequest,
  type ChatCommandResponse,
  type ChatConnectableMcpDto,
  type ChatConversationDto,
  type ChatConversationKind,
  type ChatConversationMcpDto,
  type ChatConversationStatus,
  type ChatMessageDto,
  type ChatPendingInteractionDto,
  type ChatProjectViewerDto,
  type ChatSnapshotDto,
  type ChatToolViewerDto,
  type ChatViewerArtifactRecord,
  type ChatViewerJson,
  type ChatViewerSessionDto,
  DESKTOP_CHAT_PROTOCOL,
  extractViewerArtifactRecords,
  isChatOpaqueId,
  isChatViewerToolName,
  isChatViewerUiUri,
  parseCasysProjectId,
  parseChatViewerArguments,
  parseChatViewerJson,
} from "../../../src/presentation/desktop/chat/contracts.ts";
import {
  type ChatMcpProbeOutcome,
  type ChatMcpServerConfig,
  type ChatRuntimeAdapter,
  chatRuntimeKey,
  type RuntimeElicitationContext,
  type RuntimeElicitationRequest,
  type RuntimeElicitationResponse,
  type RuntimeEvent,
  type RuntimeHandle,
  type RuntimeInteractionSink,
  type RuntimePermissionDecision,
  type RuntimePermissionRequest,
  type RuntimeTurn,
} from "./runtime-port.ts";
import {
  sanitizeElicitationRequest,
  sanitizePermissionRequest,
  validateElicitationContent,
} from "./sanitize.ts";
import type {
  ChatConversationStore,
  StoredConversation,
  StoredWorkArtifact,
} from "./store.ts";
import {
  type AgentProfileDefinition,
  type AgentProfileHost,
  isAgentAuthFailure,
  LEGACY_AGENT_PROFILE_ID,
  profileRuntimeKey,
  profileSessionKey,
} from "./agent-profiles.ts";
import { STORE_MCP_TOOLS_MAX } from "./store-codec.ts";
import { canonicalJson, type McpTapQuery, type McpTapRecord } from "./mcp-tap.ts";
import {
  type ChatViewerBackend,
  createRefusingViewerBackend,
  viewerResourceScope,
} from "./viewer-backend.ts";

const SESSION_PREFIX = "casys-desktop-exclusive";
const TOOL_RESULTS_MAX = 20;
const TOOL_RESULT_JSON_MAX = 262_144;
/**
 * Synthetic bex pseudo-tool titles (`reminderChild: ...`) are adapter
 * session housekeeping, never user tools: MCP tool names cannot contain
 * `:`, so the prefix cannot collide with a real namespaced call. Dropped
 * before transcript and capture; if bex renames them the noise returns
 * visibly instead of silently eating a real tool.
 */
const BEX_PSEUDO_TOOL_PREFIX = "reminderChild:";

/** ACP title form for MCP tools via bex (`mcp__<server>__<tool>`). DEV tap key only. */
const MCP_NAMESPACED_TITLE =
  /^mcp__([A-Za-z0-9][A-Za-z0-9_-]*)__([A-Za-z0-9][A-Za-z0-9_.-]*)$/;
/**
 * Viewer resource bytes must fit the 1M-char chat IPC line after base64
 * (x4/3) plus the JSON envelope. Whole App documents never cross IPC:
 * `viewer.open` pins identity and the renderer fetches bytes separately.
 */
const VIEWER_RESOURCE_IPC_MAX_BYTES = 524_288;
/**
 * Retained-bytes policy (#51): an artifact larger than this is recorded as
 * missing with an explicit reason instead of archived. Same value as the
 * IPC cap so every saved byte stays servable and exportable.
 */
const WORK_ARCHIVE_MAX_BYTES = 524_288;
const WORK_ARCHIVE_MAX_ARTIFACTS = 8;

/** Empty session Canvas layout (#55); shared frozen default. */
const EMPTY_CANVAS_LAYOUT: ChatCanvasLayoutDto = Object.freeze({
  version: CHAT_CANVAS_LAYOUT_VERSION,
  nodes: Object.freeze([]),
  groups: Object.freeze([]),
});

interface ConversationState {
  readonly id: string;
  readonly kind: ChatConversationKind;
  readonly projectId?: string;
  workspaceProjectId?: string;
  /** Active agent profile; explicit per conversation, never inherited. */
  agentProfileId: string;
  sessionKey: string;
  /** Standalone MCP attachment; status failed keeps the zero-MCP runtime. */
  mcpId?: string;
  mcpStatus?: "connected" | "failed";
  mcpTools: readonly string[];
  /**
   * Per agent-session-key transcript message ids that session already holds.
   * A persistent ACP session resumes its own history by key, so the
   * coordinator seeds only the ids a key has never seen.
   */
  knownByKey: Map<string, Set<string>>;
  /**
   * Exact MCP tool results captured from runtime events, newest last.
   * Only results of the attached server carrying an App URI are retained.
   */
  toolResults: CapturedToolResult[];
  /** Session Canvas presentation layout (#55); empty until arranged. */
  canvasLayout: ChatCanvasLayoutDto;
  readonly title: string;
  readonly createdAt: string;
  updatedAt: string;
  status: ChatConversationStatus;
  messages: ChatMessageDto[];
  handle?: RuntimeHandle;
  activeTurn?: RuntimeTurn;
  activeAbort?: AbortController;
  /** Epoch ms of the running turn start; scopes DEV tap attribution. */
  turnStartedAt?: number;
  /** Fresh identity per turn; native ACP call ids may repeat later. */
  captureTurnId?: string;
  pending?: PendingInteraction;
  queueTail: Promise<void>;
  /**
   * Bumped by turn.cancel; a chained turn whose captured epoch no longer
   * matches was cancelled while queued and must not execute.
   */
  queueEpoch: number;
}

interface PendingInteraction {
  readonly dto: ChatPendingInteractionDto;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  readonly abort: () => void;
}

interface CapturedToolResult {
  readonly viewerId: string;
  readonly toolCallId: string;
  readonly originAgentProfileId?: string;
  readonly originSessionKey?: string;
  readonly originAgentSessionId?: string;
  readonly originTurnId?: string;
  readonly server: string;
  readonly tool: string;
  readonly messageId: string;
  readonly appUri: string;
  readonly failed: boolean;
  readonly input: Readonly<Record<string, ChatViewerJson>>;
  readonly result: ChatViewerJson;
  readonly capturedAt: string;
  /** Per-conversation revision and digest; absent before saving existed. */
  readonly revision?: number;
  readonly resultDigest?: string;
  readonly artifacts?: readonly StoredWorkArtifact[];
}

/** Fetched export: verified bytes or a missing-with-reason outcome. */
interface ArchivePayload {
  readonly record: ChatViewerArtifactRecord;
  readonly bytes?: Uint8Array;
  readonly reason?: string;
}

export interface ChatCoordinatorOptions {
  /** One adapter per MCP set, keyed by chatRuntimeKey. */
  readonly runtimes: ReadonlyMap<string, ChatRuntimeAdapter>;
  /** Host-owned agent profiles, default, and runtime factory. */
  readonly agents: AgentProfileHost;
  /** Host-side connectable MCP registry (standalone only). */
  readonly mcpServers: readonly ChatMcpServerConfig[];
  /** Direct endpoint probe; distinguishes connection from execution failure. */
  readonly probeMcp: (server: ChatMcpServerConfig) => Promise<ChatMcpProbeOutcome>;
  /**
   * Current runtime endpoint per MCP id (#57). When present, attach
   * requires an assigned endpoint: probes never fall back to a stale
   * historical address.
   */
  readonly resolveMcpEndpoint?: (
    mcpId: string,
  ) => { readonly mcpUrl: string; readonly healthUrl: string } | undefined;
  /**
   * DEV-ONLY tap lookup (#59): attributes a relay-recorded provider
   * response to an output-less tool event. Absent in production.
   */
  readonly findMcpTapCall?: (
    mcpId: string,
    query: McpTapQuery,
  ) => McpTapRecord | undefined;
  readonly store: ChatConversationStore;
  /** Private host path. It is never copied into a renderer DTO. */
  readonly workspaceRoot: string;
  /** Owning-session MCP backend for live viewer Apps. Refuses when absent. */
  readonly viewerBackend?: ChatViewerBackend;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export class ChatCoordinator implements RuntimeInteractionSink {
  readonly #agents: AgentProfileHost;
  readonly #runtimes: Map<string, ChatRuntimeAdapter>;
  readonly #mcpServers: readonly ChatMcpServerConfig[];
  readonly #probeMcp: (
    server: ChatMcpServerConfig,
  ) => Promise<ChatMcpProbeOutcome>;
  readonly #resolveMcpEndpoint?: (
    mcpId: string,
  ) => { readonly mcpUrl: string; readonly healthUrl: string } | undefined;
  readonly #findMcpTapCall?: (
    mcpId: string,
    query: McpTapQuery,
  ) => McpTapRecord | undefined;
  readonly #store: ChatConversationStore;
  readonly #workspaceRoot: string;
  readonly #viewerBackend: ChatViewerBackend;
  readonly #now: () => Date;
  readonly #newId: () => string;
  readonly #conversations = new Map<string, ConversationState>();
  readonly #sessionOwners = new Map<string, string>();
  #host: "ready" | "shutting-down" = "ready";
  #persistTail: Promise<void> = Promise.resolve();
  #projectAttachmentGate?: Promise<void>;
  #profileReloading = false;
  #stopPromise?: Promise<void>;

  private constructor(options: ChatCoordinatorOptions) {
    this.#agents = options.agents;
    this.#runtimes = new Map(options.runtimes);
    this.#mcpServers = options.mcpServers;
    this.#probeMcp = options.probeMcp;
    this.#resolveMcpEndpoint = options.resolveMcpEndpoint;
    this.#findMcpTapCall = options.findMcpTapCall;
    this.#store = options.store;
    this.#workspaceRoot = options.workspaceRoot;
    this.#viewerBackend = options.viewerBackend ??
      createRefusingViewerBackend("Live viewer Apps are unavailable.");
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => crypto.randomUUID());
    for (const adapter of options.runtimes.values()) {
      adapter.setInteractionSink(this);
    }
  }

  static async create(options: ChatCoordinatorOptions): Promise<ChatCoordinator> {
    const coordinator = new ChatCoordinator(options);
    let remapped = false;
    for (const stored of await options.store.load()) {
      remapped = coordinator.#restore(stored) || remapped;
    }
    if (remapped) await coordinator.#persist();
    return coordinator;
  }

  /**
   * Adds a lazily created runtime (#57). The coordinator owns the sink
   * wiring, so late runtimes behave exactly like startup ones.
   */
  registerRuntime(key: string, adapter: ChatRuntimeAdapter): void {
    adapter.setInteractionSink(this);
    this.#runtimes.set(key, adapter);
  }

  /**
   * Drops a runtime whose provider was released. Call only when no
   * conversation holds a handle on it (zero demand): live handles are not
   * migrated.
   */
  unregisterRuntime(key: string): void {
    this.#runtimes.delete(key);
  }

  snapshot(conversationId?: string): ChatSnapshotDto {
    const ordered = [...this.#conversations.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
    const selected =
      conversationId !== undefined && this.#conversations.has(conversationId)
        ? conversationId
        : ordered[0]?.id;
    const conversations = ordered.map((entry) =>
      this.#toDto(entry, selected === entry.id)
    );
    const retention = this.#store.retention();
    return Object.freeze({
      protocol: DESKTOP_CHAT_PROTOCOL,
      host: this.#host,
      conversations: Object.freeze(conversations),
      projectViewers: this.#projectViewers(ordered),
      connectableMcps: Object.freeze(
        this.#mcpServers.map((server): ChatConnectableMcpDto =>
          Object.freeze({
            id: server.id,
            displayName: server.displayName,
            description: server.description,
            transport: server.transport,
          })
        ),
      ),
      ...(selected === undefined ? {} : { selectedConversationId: selected }),
      ...(retention === undefined ? {} : {
        retention: Object.freeze({
          ...retention,
          maxVersions: TOOL_RESULTS_MAX,
        }),
      }),
      agentProfiles: Object.freeze(
        this.#agents.definitions.map((definition) => {
          const status = this.#agents.statusOf(definition.id);
          return Object.freeze({
            id: definition.id,
            displayName: definition.displayName,
            available: status.available,
            ...(status.version === undefined ? {} : { version: status.version }),
            ...(status.missingReason === undefined
              ? {}
              : { missingReason: status.missingReason }),
            modelsExposed: definition.modelsExposed,
          });
        }),
      ),
      defaultAgentProfileId: this.#agents.defaultProfileId(),
    });
  }

  async command(request: ChatCommandRequest): Promise<ChatCommandResponse> {
    try {
      if (this.#host !== "ready") throw new Error("Chat Host is shutting down");
      if (this.#profileReloading) throw new Error("Agent profiles are reloading");
      let conversationId: string;
      switch (request.command) {
        case "conversation.create":
          conversationId = await this.#createConversation(
            request.projectId,
            request.title,
            request.workspaceProjectId,
          );
          break;
        case "conversation.attach-project":
          conversationId = request.conversationId;
          await this.#attachConversationProject(
            conversationId,
            request.workspaceProjectId,
          );
          break;
        case "message.send":
          conversationId = request.conversationId;
          await this.#enqueueMessage(conversationId, request.text, request.requestId);
          break;
        case "turn.cancel":
          conversationId = request.conversationId;
          await this.#cancelTurn(conversationId, "cancelled by user");
          break;
        case "conversation.close":
          conversationId = request.conversationId;
          await this.#closeConversation(conversationId);
          break;
        case "permission.resolve":
          conversationId = request.conversationId;
          this.#resolvePermission(
            conversationId,
            request.correlationId,
            request.decision,
          );
          break;
        case "elicitation.resolve":
          conversationId = request.conversationId;
          this.#resolveElicitation(
            conversationId,
            request.correlationId,
            request.action,
            request.content,
          );
          break;
        case "mcp.enable":
          conversationId = request.conversationId;
          await this.#enableMcp(conversationId, request.mcpId);
          break;
        case "mcp.disable":
          conversationId = request.conversationId;
          await this.#disableMcp(conversationId);
          break;
        case "agent.select":
          conversationId = request.conversationId;
          await this.#selectAgent(conversationId, request.profileId);
          break;
        case "agent.set-default": {
          const known = this.#agents.definitions.some(
            (entry) => entry.id === request.profileId,
          );
          if (!known) throw new Error("agent profile is unknown");
          await this.#agents.saveDefault(request.profileId);
          return Object.freeze({
            protocol: DESKTOP_CHAT_PROTOCOL,
            requestId: request.requestId,
            ok: true,
          });
        }
        case "agent.reload-profiles": {
          for (const entry of this.#conversations.values()) {
            if (
              entry.activeTurn !== undefined || entry.status === "running" ||
              entry.status === "queued" || entry.pending !== undefined
            ) {
              throw new Error(
                "complete or cancel active turns before reloading agent profiles",
              );
            }
          }
          this.#profileReloading = true;
          try {
            const reloaded = await this.#agents.reload();
            if (!reloaded.ok) throw new Error(reloaded.error);
            const invalidated = new Set(reloaded.invalidatedRuntimeKeys);
            for (const entry of this.#conversations.values()) {
              if (!invalidated.has(this.#profiledRuntimeKey(entry))) continue;
              await this.#detachHandle(entry, "Agent profile changed");
              // Do not resume an ACP session created with the old launch
              // definition under the same key after a profile file edit.
              if (
                this.#agents.definitions.some((profile) =>
                  profile.id === entry.agentProfileId
                )
              ) {
                entry.sessionKey = `${
                  profileSessionKey(
                    this.#baseSessionKey(entry),
                    entry.agentProfileId,
                  )
                }/reload/${this.#newId()}`;
                this.#append(
                  entry,
                  "system",
                  "status",
                  "Agent profile reloaded. The next turn starts a fresh session.",
                );
              }
            }
            for (const key of invalidated) {
              const adapter = this.#runtimes.get(key);
              if (adapter === undefined) continue;
              this.unregisterRuntime(key);
              await adapter.close().catch(() => undefined);
            }
            if (await this.#remapUnknownProfiles() || invalidated.size > 0) {
              await this.#persist();
            }
          } finally {
            this.#profileReloading = false;
          }
          return Object.freeze({
            protocol: DESKTOP_CHAT_PROTOCOL,
            requestId: request.requestId,
            ok: true,
          });
        }
        case "viewer.open": {
          conversationId = request.conversationId;
          const viewer = await this.#openViewer(conversationId, request.toolCallId);
          return Object.freeze({
            protocol: DESKTOP_CHAT_PROTOCOL,
            requestId: request.requestId,
            ok: true,
            conversationId,
            viewer,
          });
        }
        case "viewer.archive-read": {
          conversationId = request.conversationId;
          const conversation = this.#viewerConversation(conversationId);
          const entry = this.#viewerEntry(conversation, request.viewerId);
          return Object.freeze({
            protocol: DESKTOP_CHAT_PROTOCOL,
            requestId: request.requestId,
            ok: true,
            conversationId,
            viewerCapture: Object.freeze({
              viewerId: entry.viewerId,
              toolCallId: entry.toolCallId,
              tool: entry.tool,
              server: entry.server,
              toolInput: entry.input,
              toolResult: entry.result,
            }),
          });
        }
        case "viewer.tool-call": {
          conversationId = request.conversationId;
          const viewerResult = await this.#viewerToolCall(
            conversationId,
            request.toolCallId,
            request.name,
            request.arguments,
          );
          return Object.freeze({
            protocol: DESKTOP_CHAT_PROTOCOL,
            requestId: request.requestId,
            ok: true,
            conversationId,
            viewerResult,
          });
        }
        case "viewer.resource-read": {
          conversationId = request.conversationId;
          const viewerResource = await this.#viewerResourceRead(
            conversationId,
            request.toolCallId,
            request.uri,
          );
          return Object.freeze({
            protocol: DESKTOP_CHAT_PROTOCOL,
            requestId: request.requestId,
            ok: true,
            conversationId,
            viewerResource,
          });
        }
        case "canvas.get-layout": {
          conversationId = request.conversationId;
          return Object.freeze({
            protocol: DESKTOP_CHAT_PROTOCOL,
            requestId: request.requestId,
            ok: true,
            conversationId,
            layout: this.#canvasLayout(conversationId),
          });
        }
        case "canvas.set-layout": {
          conversationId = request.conversationId;
          await this.#setCanvasLayout(conversationId, request.layout);
          return Object.freeze({
            protocol: DESKTOP_CHAT_PROTOCOL,
            requestId: request.requestId,
            ok: true,
            conversationId,
          });
        }
      }
      return Object.freeze({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: request.requestId,
        ok: true,
        conversationId,
      });
    } catch (error) {
      return Object.freeze({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: request.requestId,
        ok: false,
        error: safeError(error),
      });
    }
  }

  async requestPermission(
    request: RuntimePermissionRequest,
    signal: AbortSignal,
  ): Promise<{ readonly outcome: RuntimePermissionDecision } | undefined> {
    const conversation = this.#findPermissionOwner(request.sessionId);
    if (
      conversation === undefined || signal.aborted || conversation.pending !== undefined
    ) {
      return undefined;
    }
    const correlationId = `permission:${this.#newId()}`;
    let dto: ChatPendingInteractionDto;
    try {
      dto = sanitizePermissionRequest(request, correlationId);
    } catch {
      return undefined;
    }
    return await this.#waitForInteraction<
      { readonly outcome: RuntimePermissionDecision } | undefined
    >(conversation, dto, signal, undefined);
  }

  stop(): Promise<void> {
    this.#stopPromise ??= this.#stop();
    return this.#stopPromise;
  }

  async #createConversation(
    projectId?: string,
    title?: string,
    workspaceProjectId?: string,
  ): Promise<string> {
    if (workspaceProjectId !== undefined) {
      workspaceProjectId = parseCasysProjectId(workspaceProjectId);
      if (projectId !== undefined) {
        throw new Error("projectId and workspaceProjectId are mutually exclusive");
      }
    }
    const id = `conversation:${this.#newId()}`;
    const now = this.#now().toISOString();
    const kind: ChatConversationKind = projectId === undefined
      ? "standalone"
      : "project";
    const agentProfileId = this.#agents.defaultProfileId();
    const baseKey = kind === "project"
      ? `${SESSION_PREFIX}/${projectId}/${id}`
      : `${SESSION_PREFIX}/standalone/${id}`;
    this.#conversations.set(id, {
      id,
      kind,
      ...(projectId === undefined ? {} : { projectId }),
      ...(workspaceProjectId === undefined ? {} : { workspaceProjectId }),
      agentProfileId,
      sessionKey: profileSessionKey(baseKey, agentProfileId),
      mcpTools: [],
      knownByKey: new Map(),
      toolResults: [],
      canvasLayout: EMPTY_CANVAS_LAYOUT,
      title: title ?? (kind === "project" ? `Project ${projectId}` : "Standalone chat"),
      status: "idle",
      createdAt: now,
      updatedAt: now,
      messages: [],
      queueTail: Promise.resolve(),
      queueEpoch: 0,
    });
    await this.#persist();
    return id;
  }

  async #attachConversationProject(
    conversationId: string,
    workspaceProjectId: string,
  ): Promise<void> {
    workspaceProjectId = parseCasysProjectId(workspaceProjectId);
    while (this.#projectAttachmentGate !== undefined) {
      await this.#projectAttachmentGate;
    }
    const conversation = this.#conversation(conversationId);
    if (conversation.kind !== "standalone") {
      throw new Error("whiteboard membership requires a standalone conversation");
    }
    if (conversation.status === "closed") throw new Error("conversation is closed");
    if (conversation.workspaceProjectId === workspaceProjectId) {
      await this.#persist();
      return;
    }
    if (conversation.workspaceProjectId !== undefined) {
      throw new Error("conversation already belongs to another project whiteboard");
    }
    const updatedAt = this.#now().toISOString();
    const completion = Promise.withResolvers<void>();
    this.#projectAttachmentGate = completion.promise;
    try {
      // Keep the live conversation unattached until its store snapshot commits.
      // Other persistence waits for this result before capturing its snapshot.
      await this.#persistSnapshot({ conversationId, workspaceProjectId, updatedAt });
      conversation.workspaceProjectId = workspaceProjectId;
      if (conversation.updatedAt < updatedAt) conversation.updatedAt = updatedAt;
    } finally {
      this.#projectAttachmentGate = undefined;
      completion.resolve();
    }
  }

  async #enqueueMessage(
    conversationId: string,
    text: string,
    requestId: string,
  ): Promise<void> {
    const conversation = this.#conversation(conversationId);
    if (conversation.status === "closed") throw new Error("conversation is closed");
    const userMessageId = this.#append(conversation, "user", "text", text);
    conversation.status = "queued";
    const epoch = conversation.queueEpoch;
    await this.#persist();
    const queued = conversation.queueTail.then(() =>
      this.#runTurn(conversation, text, requestId, epoch, userMessageId)
    );
    conversation.queueTail = queued.catch(() => undefined);
  }

  async #runTurn(
    conversation: ConversationState,
    text: string,
    requestId: string,
    epoch: number,
    userMessageId: string | undefined,
  ): Promise<void> {
    if (conversation.status === "closed" || this.#host !== "ready") return;
    if (epoch !== conversation.queueEpoch) {
      if (conversation.status === "queued") {
        conversation.status = "idle";
        conversation.updatedAt = this.#now().toISOString();
        this.#append(conversation, "system", "status", "Turn cancelled.");
        await this.#persist();
      }
      return;
    }
    try {
      conversation.status = "running";
      conversation.captureTurnId = `turn:${this.#newId()}`;
      conversation.updatedAt = this.#now().toISOString();
      await this.#ensureRuntimeFor(conversation);
      const runtime = this.#adapterFor(conversation).runtime;
      const seed = conversation.handle === undefined
        ? seedContextFor(conversation, conversation.sessionKey, userMessageId)
        : undefined;
      const handle = conversation.handle ??
        await runtime.ensureSession({
          sessionKey: conversation.sessionKey,
          agent: this.#profileFor(conversation).agentName,
          mode: "persistent",
          cwd: this.#workspaceRoot,
          sessionOptions: { systemPrompt: systemPromptFor(conversation) },
        });
      conversation.handle = handle;
      this.#claimSessionIds(conversation, handle);
      const abort = new AbortController();
      conversation.activeAbort = abort;
      // The pinned codex adapter drops session _meta.systemPrompt, so restored
      // context rides the first turn text: the only channel proven to reach it.
      const turnText = seed === undefined
        ? turnTextFor(conversation, text)
        : `${seed.block}\n\n${turnTextFor(conversation, text)}`;
      const turn = runtime.startTurn({
        handle,
        text: turnText,
        mode: "prompt",
        requestId,
        signal: abort.signal,
        onElicitation: (elicitation, context) =>
          this.#requestElicitation(conversation, elicitation, context),
      });
      conversation.activeTurn = turn;
      conversation.turnStartedAt = this.#now().getTime();
      // Single read: the pinned runtime exposes promptStarted as a getter
      // returning a new promise per access. A second read would orphan the
      // first promise, whose rejection then kills the host (unhandled).
      const promptStarted = turn.promptStarted;
      if (promptStarted !== undefined) {
        try {
          await promptStarted;
        } catch (error) {
          // Pre-submission death: nothing was transmitted. Keep the seed
          // and current ids unmarked so the retry reseeds, and drop the
          // handle so it re-ensures, mirroring the sync startTurn failure.
          this.#releaseSessionIds(conversation);
          conversation.handle = undefined;
          if (abort.signal.aborted) {
            conversation.status = "idle";
            this.#append(conversation, "system", "status", "Turn cancelled.");
          } else {
            conversation.status = "failed";
            this.#appendTurnFailure(conversation, error);
          }
          return;
        }
      }
      if (seed !== undefined) {
        markKnown(conversation, conversation.sessionKey, seed.ids);
      }
      if (userMessageId !== undefined) {
        markKnown(conversation, conversation.sessionKey, [userMessageId]);
      }
      await this.#persist();
      const consumedIds = await this.#consumeEvents(conversation, turn.events);
      markKnown(conversation, conversation.sessionKey, consumedIds);
      const result = await turn.result;
      if (result.status === "failed") {
        conversation.status = "failed";
        this.#appendTurnFailure(conversation, result.error.message);
      } else {
        conversation.status = "idle";
        if (result.status === "cancelled") {
          this.#append(conversation, "system", "status", "Turn cancelled.");
        }
      }
    } catch (error) {
      conversation.status = "failed";
      this.#appendTurnFailure(conversation, error);
      if (conversation.activeTurn === undefined) {
        // ensure/claim/startTurn never produced a turn: drop the pinned
        // handle so the retry re-ensures and recomputes the unmarked seed.
        this.#releaseSessionIds(conversation);
        conversation.handle = undefined;
      }
    } finally {
      this.#abortPending(conversation);
      conversation.activeTurn = undefined;
      conversation.activeAbort = undefined;
      conversation.captureTurnId = undefined;
      const adapter = this.#runtimes.get(this.#profiledRuntimeKey(conversation));
      if (
        adapter?.refreshSessionPerTurn === true && conversation.handle !== undefined
      ) {
        const handle = conversation.handle;
        try {
          await adapter.runtime.close({
            handle,
            reason: "turn capture scope ended",
            discardPersistentState: false,
          });
        } catch (error) {
          this.#append(
            conversation,
            "system",
            "error",
            `Agent session close failed: ${safeError(error)}`,
          );
        } finally {
          this.#releaseSessionIds(conversation);
          conversation.handle = undefined;
        }
      }
      conversation.updatedAt = this.#now().toISOString();
      await this.#persist();
    }
  }

  async #consumeEvents(
    conversation: ConversationState,
    events: AsyncIterable<RuntimeEvent>,
  ): Promise<readonly string[]> {
    const touched: string[] = [];
    for await (const event of events) {
      if (conversation.status === "closed" || this.#host !== "ready") break;
      if (event.type === "text_delta") {
        const id = this.#appendDelta(
          conversation,
          event.stream === "thought" ? "thought" : "text",
          event.text,
        );
        if (id !== undefined) touched.push(id);
      } else if (event.type === "tool_call") {
        if ((event.title ?? "").startsWith(BEX_PSEUDO_TOOL_PREFIX)) continue;
        const title = clean(event.title ?? event.text, 500);
        const suffix = event.status === undefined
          ? ""
          : ` — ${clean(event.status, 80)}`;
        const id = this.#append(conversation, "assistant", "tool", `${title}${suffix}`);
        if (id !== undefined) {
          const captured = await this.#captureToolResult(conversation, event, id);
          if (captured === false) {
            conversation.messages = conversation.messages.filter((message) =>
              message.id !== id
            );
          } else touched.push(id);
        }
      } else {
        const id = this.#append(
          conversation,
          "assistant",
          "status",
          clean(event.text, 1_000),
        );
        if (id !== undefined) touched.push(id);
      }
      await this.#persist();
    }
    return touched;
  }

  /**
   * Retain the exact MCP tool result for the live viewer. Only results of
   * the attached server carrying a server-scoped App URI are kept; anything
   * else (missing ids, foreign server, oversize, unparsable) is ignored so
   * the transcript stays the source of truth. Retained entries also archive
   * their export bytes eagerly (#51): provider-side exports are
   * process-local and would not survive a provider restart otherwise.
   */
  async #captureToolResult(
    conversation: ConversationState,
    event: Extract<RuntimeEvent, { type: "tool_call" }>,
    messageId: string,
  ): Promise<boolean | undefined> {
    const mcpId = conversation.mcpId;
    const toolCallId = event.toolCallId;
    if (
      conversation.kind !== "standalone" || mcpId === undefined ||
      conversation.mcpStatus !== "connected" || toolCallId === undefined
    ) return;
    const input = parseMcpRawInput(event.rawInput);
    if (input !== undefined && input.server === mcpId) {
      const output = parseMcpRawOutput(event.rawOutput);
      if (output === undefined) return;
      return await this.#retainToolResult(conversation, messageId, {
        mcpId,
        server: input.server,
        tool: input.tool,
        toolCallId,
        args: input.arguments ?? {},
        result: output.result,
        error: output.error,
      });
    }
    const claude = parseClaudeStyleToolResult(event, mcpId);
    if (claude !== undefined) {
      return await this.#retainToolResult(conversation, messageId, {
        mcpId,
        server: mcpId,
        tool: claude.tool,
        toolCallId,
        args: claude.args,
        result: claude.result,
        error: event.status === "failed" ? claude.result : undefined,
      });
    }
    return await this.#captureFromTap(
      conversation,
      event,
      messageId,
      mcpId,
      toolCallId,
    );
  }

  /**
   * DEV-ONLY fallback (#59): attributes a tap-recorded provider response
   * to an output-less ACP tool event. The namespaced title is only a
   * lookup key into our own exact records; bytes always come from the
   * relay tap, never from the event. No-op without a tap lookup.
   */
  async #captureFromTap(
    conversation: ConversationState,
    event: Extract<RuntimeEvent, { type: "tool_call" }>,
    messageId: string,
    mcpId: string,
    toolCallId: string,
  ): Promise<boolean | undefined> {
    const lookup = this.#findMcpTapCall;
    const since = conversation.turnStartedAt;
    if (lookup === undefined || since === undefined) return;
    if (typeof event.title !== "string") return;
    const namespaced = MCP_NAMESPACED_TITLE.exec(event.title);
    if (namespaced === null) return;
    const [, server, tool] = namespaced;
    if (server !== mcpId || !isChatViewerToolName(tool)) return;
    if (typeof event.rawInput !== "object" || event.rawInput === null) return;
    const record = lookup(mcpId, {
      tool,
      argsJson: canonicalJson(event.rawInput),
      since,
    });
    if (record === undefined) return;
    let result: unknown;
    try {
      result = JSON.parse(record.resultJson);
    } catch {
      return;
    }
    return await this.#retainToolResult(conversation, messageId, {
      mcpId,
      server,
      tool,
      toolCallId,
      args: event.rawInput,
      result,
      error: record.failed ? result : undefined,
    });
  }

  async #retainToolResult(
    conversation: ConversationState,
    messageId: string,
    resolved: {
      readonly mcpId: string;
      readonly server: string;
      readonly tool: string;
      readonly toolCallId: string;
      readonly args: unknown;
      readonly result: unknown;
      readonly error: unknown;
    },
  ): Promise<boolean | undefined> {
    const appUri = viewerAppUri(
      resolved.result,
      this.#mcpExpectedViews(resolved.mcpId),
    );
    if (appUri === undefined) return;
    let parsedInput: Readonly<Record<string, ChatViewerJson>>;
    let parsedResult: ChatViewerJson;
    try {
      parsedInput = parseChatViewerArguments(resolved.args ?? {});
      parsedResult = parseChatViewerJson(resolved.result);
      if (
        JSON.stringify(parsedInput).length > TOOL_RESULT_JSON_MAX ||
        JSON.stringify(parsedResult).length > TOOL_RESULT_JSON_MAX
      ) return;
    } catch {
      return;
    }
    const resultDigest = `sha256:${await sha256Hex(
      new TextEncoder().encode(JSON.stringify(parsedResult)),
    )}`;
    const originAgentProfileId = conversation.agentProfileId;
    const originSessionKey = conversation.sessionKey;
    const originAgentSessionId = conversation.handle?.agentSessionId ??
      conversation.handle?.backendSessionId ??
      conversation.handle?.runtimeSessionName ?? originSessionKey;
    const originTurnId = conversation.captureTurnId;
    // A redelivery is idempotent only when it is the same call in the same
    // agent session with the same exact input, outcome, and result. A reused
    // native call id in another session (or with different bytes) is a new
    // retained version, never a replacement of historical work.
    if (
      conversation.toolResults.some((entry) =>
        entry.toolCallId === resolved.toolCallId &&
        entry.originAgentProfileId === originAgentProfileId &&
        entry.originSessionKey === originSessionKey &&
        entry.originAgentSessionId === originAgentSessionId &&
        entry.originTurnId === originTurnId &&
        entry.server === resolved.server && entry.tool === resolved.tool &&
        entry.appUri === appUri && entry.resultDigest === resultDigest &&
        entry.failed === (resolved.error !== null && resolved.error !== undefined) &&
        JSON.stringify(entry.input) === JSON.stringify(parsedInput)
      )
    ) return false;
    const revision = maxToolRevision(conversation.toolResults) + 1;
    const payloads = await this.#fetchArchivePayloads(resolved.server, parsedResult);
    const artifacts = payloads.map((payload) =>
      Object.freeze({
        uri: payload.record.uri,
        fileName: archiveFileName(
          payload.record.uri,
          resolved.tool,
          revision,
          payload.record.mimeType,
        ),
        mimeType: payload.record.mimeType,
        bytes: payload.record.bytes,
        sha256: payload.record.sha256,
        ...(payload.bytes === undefined
          ? { state: "missing" as const, reason: payload.reason }
          : {
            state: "saved" as const,
            savedAt: this.#now().toISOString(),
          }),
      })
    );
    // Append the entry and queue its bytes with no await between: any persist
    // snapshotting from here on references the manifest, and the tail runs
    // the byte writes before the manifest persist below. A stale snapshot
    // queued earlier runs before the bytes exist, so prune can never eat
    // bytes ahead of their manifest.
    const appended = [
      ...conversation.toolResults,
      {
        viewerId: messageId,
        toolCallId: resolved.toolCallId,
        originAgentProfileId,
        originSessionKey,
        originAgentSessionId,
        ...(originTurnId === undefined ? {} : { originTurnId }),
        server: resolved.server,
        tool: resolved.tool,
        messageId,
        appUri,
        failed: resolved.error !== null && resolved.error !== undefined,
        input: parsedInput,
        result: parsedResult,
        capturedAt: this.#now().toISOString(),
        revision,
        resultDigest,
        artifacts: Object.freeze(artifacts),
      },
    ];
    const retired = appended.slice(
      0,
      Math.max(0, appended.length - TOOL_RESULTS_MAX),
    );
    conversation.toolResults = appended.slice(-TOOL_RESULTS_MAX);
    if (retired.length > 0) {
      // Version retirement is user-visible: the evicted revisions are
      // named in the transcript before their bytes prune on persist.
      const names = retired.map((entry) =>
        entry.revision === undefined ? entry.toolCallId : `v${entry.revision}`
      ).join(", ");
      this.#append(
        conversation,
        "system",
        "status",
        `Retired ${names}: this conversation keeps the last ${TOOL_RESULTS_MAX} tool versions.`,
      );
    }
    const writes = payloads.flatMap((payload) =>
      payload.bytes === undefined ? [] : [payload]
    ).map((payload) =>
      this.#afterPersistTail(() =>
        this.#store.saveArtifact(
          payload.record.sha256,
          payload.bytes as Uint8Array,
        )
      ).then(
        () => ({ sha256: payload.record.sha256, saved: true as const }),
        () => ({ sha256: payload.record.sha256, saved: false as const }),
      )
    );
    const outcomes = await Promise.all(writes);
    const failed = new Set(
      outcomes.filter((outcome) => !outcome.saved).map((outcome) => outcome.sha256),
    );
    if (failed.size > 0) {
      conversation.toolResults = conversation.toolResults.map((entry) =>
        entry.viewerId === messageId
          ? {
            ...entry,
            artifacts: (entry.artifacts ?? []).map((artifact) =>
              artifact.state === "saved" && failed.has(artifact.sha256)
                ? {
                  ...artifact,
                  state: "missing" as const,
                  reason: "The retained bytes could not be written.",
                }
                : artifact
            ),
          }
          : entry
      );
    }
    await this.#persist();
    return true;
  }

  /**
   * Best-effort eager fetch of the result's export records. Every record
   * resolves to verified bytes or a missing-with-reason outcome; archival
   * never fails the turn. Byte writes commit separately through the persist
   * tail (see capture).
   */
  async #fetchArchivePayloads(
    server: string,
    result: ChatViewerJson,
  ): Promise<readonly ArchivePayload[]> {
    const records = extractViewerArtifactRecords(result).slice(
      0,
      WORK_ARCHIVE_MAX_ARTIFACTS,
    );
    const payloads: ArchivePayload[] = [];
    for (const record of records) {
      if (record.bytes > WORK_ARCHIVE_MAX_BYTES) {
        payloads.push({
          record,
          reason: "The export exceeds the 512 KiB retained-bytes cap.",
        });
        continue;
      }
      try {
        // Transport failures keep the generic read-failed reason; only
        // shape failures unwrap to their own accurate message.
        const raw = await this.#viewerBackend.readResource(server, record.uri);
        let payload: ReturnType<typeof parseViewerResourcePayload>;
        try {
          payload = parseViewerResourcePayload(record.uri, raw, "live");
        } catch (error) {
          throw new ArchiveMismatchError(
            error instanceof Error
              ? error.message
              : "The provider read failed before the bytes were retained.",
          );
        }
        const bytes = base64ToBytes(payload.data);
        if (bytes.byteLength !== record.bytes) {
          throw new ArchiveMismatchError(
            "The provider's export changed size before it was retained.",
          );
        }
        if ((await sha256Hex(bytes)) !== record.sha256) {
          throw new ArchiveMismatchError(
            "The provider's export failed the digest check.",
          );
        }
        payloads.push({ record, bytes });
      } catch (error) {
        payloads.push({
          record,
          reason: error instanceof ArchiveMismatchError
            ? error.message
            : "The provider read failed before the bytes were retained.",
        });
      }
    }
    return payloads;
  }

  #viewerConversation(conversationId: string): ConversationState {
    const conversation = this.#conversation(conversationId);
    if (conversation.kind !== "standalone") throw new Error("Unknown viewer session.");
    if (conversation.status === "closed") throw new Error("conversation is closed");
    return conversation;
  }

  #viewerEntry(
    conversation: ConversationState,
    viewerId: string,
  ): CapturedToolResult {
    const exact = conversation.toolResults.find((candidate) =>
      candidate.viewerId === viewerId
    );
    const legacy = exact === undefined
      ? conversation.toolResults.filter((candidate) =>
        candidate.toolCallId === viewerId
      )
      : [];
    const entry = exact ?? (legacy.length === 1 ? legacy[0] : undefined);
    if (entry === undefined) {
      throw new Error("Unknown viewer session for this conversation.");
    }
    return entry;
  }

  #requireLiveViewer(conversation: ConversationState, entry: CapturedToolResult): void {
    if (conversation.mcpStatus !== "connected" || conversation.mcpId !== entry.server) {
      throw new Error("The live viewer requires its owning connected MCP session.");
    }
  }

  /**
   * Session Canvas layout (#55), reconciled with retained results: viewer
   * nodes whose tool result is gone are dropped, notes and groups persist
   * verbatim. Presentation only, never evidence.
   */
  #canvasLayout(conversationId: string): ChatCanvasLayoutDto {
    const conversation = this.#conversation(conversationId);
    const retained = new Set(conversation.toolResults.map((entry) => entry.viewerId));
    const nodes = conversation.canvasLayout.nodes.flatMap((node) => {
      if (node.kind !== "viewer") return [node];
      if (node.viewerId !== undefined) {
        return retained.has(node.viewerId) ? [node] : [];
      }
      // Old layouts named only the native tool id. Migrate only when it
      // denotes one retained version; a collision must never rebind a node.
      const matches = conversation.toolResults.filter((entry) =>
        entry.toolCallId === node.toolCallId
      );
      if (matches.length !== 1) return [];
      const { toolCallId: _legacy, ...rest } = node;
      return [{ ...rest, viewerId: matches[0].viewerId }];
    });
    const layout = Object.freeze({
      version: CHAT_CANVAS_LAYOUT_VERSION,
      nodes: Object.freeze([...nodes]),
      groups: conversation.canvasLayout.groups,
    });
    conversation.canvasLayout = layout;
    return layout;
  }

  async #setCanvasLayout(
    conversationId: string,
    layout: ChatCanvasLayoutDto,
  ): Promise<void> {
    const conversation = this.#conversation(conversationId);
    if (conversation.status === "closed") throw new Error("conversation is closed");
    conversation.canvasLayout = layout;
    this.#canvasLayout(conversationId);
    conversation.updatedAt = new Date().toISOString();
    await this.#persist();
  }

  async #openViewer(
    conversationId: string,
    toolCallId: string,
  ): Promise<ChatViewerSessionDto> {
    const conversation = this.#viewerConversation(conversationId);
    const entry = this.#viewerEntry(conversation, toolCallId);
    this.#requireLiveViewer(conversation, entry);
    if (!this.#mcpExpectedViews(entry.server).includes(entry.appUri)) {
      throw new Error("Unknown viewer session for this conversation.");
    }
    const app = await this.#viewerBackend.resolveApp(entry.server, entry.appUri);
    return Object.freeze({
      viewerId: entry.viewerId,
      toolCallId: entry.toolCallId,
      tool: entry.tool,
      server: entry.server,
      appUri: entry.appUri,
      app: Object.freeze({
        uri: app.uri,
        mimeType: app.mimeType,
        bytes: app.bytes.byteLength,
        fingerprint: app.fingerprint,
      }),
      toolInput: entry.input,
      toolResult: entry.result,
      // Renderer contract: regex names, at most 64. Authorization still
      // checks the full conversation list by exact name.
      serverTools: Object.freeze(
        conversation.mcpTools.filter(isChatViewerToolName).slice(0, 64),
      ),
    });
  }

  async #viewerToolCall(
    conversationId: string,
    toolCallId: string,
    name: string,
    args: Readonly<Record<string, ChatViewerJson>>,
  ): Promise<ChatViewerJson> {
    const conversation = this.#viewerConversation(conversationId);
    const entry = this.#viewerEntry(conversation, toolCallId);
    this.#requireLiveViewer(conversation, entry);
    if (!conversation.mcpTools.includes(name)) {
      throw new Error("The session cannot authorize this tool.");
    }
    const result = await this.#viewerBackend.callTool(entry.server, name, args);
    const parsed = parseChatViewerJson(result);
    if (JSON.stringify(parsed).length > TOOL_RESULT_JSON_MAX) {
      throw new Error("Viewer tool result is too large for the chat IPC line.");
    }
    return parsed;
  }

  async #viewerResourceRead(conversationId: string, toolCallId: string, uri: string) {
    const conversation = this.#viewerConversation(conversationId);
    const entry = this.#viewerEntry(conversation, toolCallId);
    // Retained artifact bytes win over a live read: the archive is the
    // exact saved result, while provider-side exports may have moved on or
    // vanished with a provider restart. View-scope resources always read
    // live; they are never archived.
    const manifest = entry.artifacts?.find((artifact) => artifact.uri === uri);
    const archived = manifest !== undefined && manifest.state === "saved"
      ? manifest
      : undefined;
    if (archived !== undefined) {
      const bytes = await this.#store.loadArtifact(archived.sha256);
      if (
        bytes !== undefined && bytes.byteLength === archived.bytes &&
        (await sha256Hex(bytes)) === archived.sha256
      ) {
        return Object.freeze({
          uri,
          mimeType: archived.mimeType,
          bytes: bytes.byteLength,
          encoding: "base64",
          data: bytesToBase64(bytes),
          source: "saved",
        });
      }
      // Stale manifest (pruned or tampered bytes): mark missing honestly
      // and fall through to a live read instead of failing the viewer.
      conversation.toolResults = conversation.toolResults.map((candidate) =>
        candidate.viewerId === entry.viewerId
          ? {
            ...candidate,
            artifacts: (candidate.artifacts ?? []).map((artifact) =>
              artifact.sha256 === archived.sha256
                ? {
                  ...artifact,
                  state: "missing" as const,
                  reason: "The retained bytes are no longer stored.",
                }
                : artifact
            ),
          }
          : candidate
      );
      void this.#persist();
    }
    this.#requireLiveViewer(conversation, entry);
    const admitted = this.#mcpExpectedViews(entry.server);
    const scope = viewerResourceScope(admitted);
    const inViewScope = admitted.includes(uri) ||
      (scope !== undefined && uri.startsWith(scope));
    const inArtifactScope = uri.startsWith(`casys://${entry.server}/`);
    if (!inViewScope && !inArtifactScope) {
      throw new Error("The session cannot authorize this resource.");
    }
    const result = await this.#viewerBackend.readResource(entry.server, uri);
    const payload = parseViewerResourcePayload(uri, result, "live");
    if (manifest !== undefined) {
      // A versioned artifact read must serve the version's bytes: live
      // bytes that diverge from the manifest are refused before any
      // display or export, mirroring the capture-time digest check.
      const raw = base64ToBytes(payload.data);
      if (raw.byteLength !== manifest.bytes) {
        throw new ArchiveMismatchError(
          "The live resource changed size against the saved version.",
        );
      }
      if ((await sha256Hex(raw)) !== manifest.sha256) {
        throw new ArchiveMismatchError(
          "The live resource failed the saved version digest check.",
        );
      }
    }
    return payload;
  }

  async #requestElicitation(
    conversation: ConversationState,
    request: RuntimeElicitationRequest,
    context: RuntimeElicitationContext,
  ): Promise<RuntimeElicitationResponse> {
    const handle = conversation.handle;
    if (
      context.signal.aborted || conversation.pending !== undefined ||
      handle === undefined ||
      (request.sessionId !== handle.backendSessionId &&
        request.sessionId !== handle.agentSessionId)
    ) {
      return { action: "cancel" };
    }
    const correlationId = `elicitation:${String(context.requestId)}:${this.#newId()}`;
    let dto: ChatPendingInteractionDto;
    try {
      dto = sanitizeElicitationRequest(request, correlationId);
    } catch {
      return { action: "cancel" };
    }
    return await this.#waitForInteraction<RuntimeElicitationResponse>(
      conversation,
      dto,
      context.signal,
      { action: "cancel" },
    );
  }

  #waitForInteraction<T>(
    conversation: ConversationState,
    dto: ChatPendingInteractionDto,
    signal: AbortSignal,
    abortedValue: T,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        signal.removeEventListener("abort", onAbort);
        if (conversation.pending?.dto.correlationId !== dto.correlationId) return;
        conversation.pending = undefined;
        resolve(abortedValue);
        void this.#persist();
      };
      conversation.pending = {
        dto,
        resolve: (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value as T);
        },
        reject,
        abort: onAbort,
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
      void this.#persist();
    });
  }

  #resolvePermission(
    conversationId: string,
    correlationId: string,
    decision: RuntimePermissionDecision,
  ): void {
    const conversation = this.#conversation(conversationId);
    const pending = this.#takePending(conversation, correlationId, "permission");
    if (pending.dto.type !== "permission") {
      pending.resolve(undefined);
      throw new Error("interaction type changed while resolving permission");
    }
    if (
      decision !== "cancel" &&
      !pending.dto.options.some((option) => option.decision === decision)
    ) {
      pending.resolve(undefined);
      throw new Error("permission option is not available");
    }
    pending.resolve(decision === "cancel" ? undefined : { outcome: decision });
    void this.#persist();
  }

  #resolveElicitation(
    conversationId: string,
    correlationId: string,
    action: "accept" | "decline" | "cancel",
    content?: Readonly<Record<string, string | number | boolean | string[]>>,
  ): void {
    const conversation = this.#conversation(conversationId);
    const pending = this.#takePending(conversation, correlationId, "elicitation");
    if (pending.dto.type === "permission") {
      pending.resolve({ action: "cancel" });
      throw new Error("interaction type changed while resolving elicitation");
    }
    if (action !== "accept") {
      pending.resolve({ action });
    } else if (pending.dto.type === "elicitation-url") {
      if (content !== undefined) {
        pending.resolve({ action: "cancel" });
        throw new Error("URL elicitation cannot include form content");
      }
      pending.resolve({ action: "accept" });
    } else {
      try {
        pending.resolve({
          action: "accept",
          content: validateElicitationContent(pending.dto, content ?? {}),
        });
      } catch (error) {
        pending.resolve({ action: "cancel" });
        throw error;
      }
    }
    void this.#persist();
  }

  #takePending(
    conversation: ConversationState,
    correlationId: string,
    kind: "permission" | "elicitation",
  ): PendingInteraction & { dto: ChatPendingInteractionDto } {
    const pending = conversation.pending;
    const matchesKind = kind === "permission"
      ? pending?.dto.type === "permission"
      : pending?.dto.type === "elicitation-form" ||
        pending?.dto.type === "elicitation-url";
    if (
      pending === undefined || pending.dto.correlationId !== correlationId ||
      !matchesKind
    ) {
      throw new Error("interaction is stale or does not belong to this conversation");
    }
    conversation.pending = undefined;
    return pending;
  }

  async #cancelTurn(conversationId: string, reason: string): Promise<void> {
    const conversation = this.#conversation(conversationId);
    this.#abortPending(conversation);
    conversation.queueEpoch += 1;
    conversation.activeAbort?.abort(reason);
    if (conversation.activeTurn !== undefined) {
      await conversation.activeTurn.cancel({ reason });
    } else if (conversation.handle !== undefined) {
      await this.#adapterFor(conversation).runtime.cancel({
        handle: conversation.handle,
        reason,
      });
    }
  }

  async #closeConversation(conversationId: string): Promise<void> {
    const conversation = this.#conversation(conversationId);
    await this.#cancelTurn(conversationId, "conversation closed");
    conversation.status = "closed";
    if (conversation.handle !== undefined) {
      await this.#adapterFor(conversation).runtime.close({
        handle: conversation.handle,
        reason: "conversation closed",
        discardPersistentState: false,
      });
      this.#releaseSessionIds(conversation);
      conversation.handle = undefined;
    }
    await this.#maybeReleaseRuntime(this.#profiledRuntimeKey(conversation));
    await this.#persist();
  }

  /**
   * Attaches an MCP to a standalone conversation. The endpoint is probed
   * directly first: a connection failure is reported as such and never as
   * a tool execution failure. On success the ACP session restarts on the
   * MCP runtime; the transcript is preserved. Re-enabling re-probes, so
   * enable doubles as the reconnect path.
   */
  async #enableMcp(conversationId: string, mcpId: string): Promise<void> {
    const conversation = this.#conversation(conversationId);
    if (conversation.kind !== "standalone") {
      throw new Error("project conversations keep their fixed MCP");
    }
    if (conversation.status === "closed") throw new Error("conversation is closed");
    this.#requireSettledForMcpSwitch(conversation);
    const registered = this.#mcpServers.find((entry) => entry.id === mcpId);
    if (registered === undefined) throw new Error("MCP is not connectable");
    let server = registered;
    if (this.#resolveMcpEndpoint !== undefined) {
      const endpoint = this.#resolveMcpEndpoint(mcpId);
      if (endpoint === undefined) {
        throw new Error("MCP has no assigned provider endpoint");
      }
      server = {
        ...registered,
        mcpUrl: endpoint.mcpUrl,
        healthUrl: endpoint.healthUrl,
      };
    }
    let probe: ChatMcpProbeOutcome;
    try {
      probe = await this.#probeMcp(server);
    } catch (error) {
      probe = { ok: false, error: safeError(error) };
    }
    if (!probe.ok) {
      if (conversation.mcpStatus === "connected") {
        const releasedKey = this.#profiledRuntimeKey(conversation);
        await this.#detachHandle(conversation, "MCP connection failed");
        conversation.sessionKey = profileSessionKey(
          standaloneSessionKey(conversation.id),
          conversation.agentProfileId,
        );
        await this.#maybeReleaseRuntime(releasedKey);
      }
      conversation.mcpId = server.id;
      conversation.mcpStatus = "failed";
      conversation.mcpTools = [];
      this.#append(
        conversation,
        "system",
        "error",
        `MCP connection failed (${server.displayName}): ${probe.error} The agent keeps running without it.`,
      );
      await this.#persist();
      throw new Error(`MCP connection failed (${server.displayName}): ${probe.error}`);
    }
    await this.#ensureKey(
      conversation.agentProfileId,
      chatRuntimeKey("standalone", server.id),
    );
    const releasedKey = this.#profiledRuntimeKey(conversation);
    await this.#detachHandle(conversation, "MCP attachment changed");
    conversation.mcpId = server.id;
    conversation.mcpStatus = "connected";
    conversation.mcpTools = sanitizeMcpTools(probe.tools);
    conversation.sessionKey = profileSessionKey(
      standaloneSessionKey(conversation.id, server.id),
      conversation.agentProfileId,
    );
    this.#append(
      conversation,
      "system",
      "status",
      `${server.displayName} connected (${conversation.mcpTools.length} tools). The agent session restarts with it.`,
    );
    await this.#maybeReleaseRuntime(releasedKey);
    await this.#persist();
  }

  async #disableMcp(conversationId: string): Promise<void> {
    const conversation = this.#conversation(conversationId);
    if (conversation.kind !== "standalone") {
      throw new Error("project conversations keep their fixed MCP");
    }
    if (conversation.status === "closed") throw new Error("conversation is closed");
    this.#requireSettledForMcpSwitch(conversation);
    if (conversation.mcpId === undefined) return;
    const displayName = this.#mcpDisplayName(conversation.mcpId);
    const releasedKey = this.#profiledRuntimeKey(conversation);
    await this.#detachHandle(conversation, "MCP detached");
    conversation.mcpId = undefined;
    conversation.mcpStatus = undefined;
    conversation.mcpTools = [];
    conversation.sessionKey = profileSessionKey(
      standaloneSessionKey(conversation.id),
      conversation.agentProfileId,
    );
    this.#append(
      conversation,
      "system",
      "status",
      `${displayName} detached. The agent session restarts without it.`,
    );
    await this.#maybeReleaseRuntime(releasedKey);
    await this.#persist();
  }

  #requireSettledForAgentSwitch(conversation: ConversationState): void {
    if (
      conversation.activeTurn !== undefined || conversation.status === "running" ||
      conversation.status === "queued" || conversation.pending !== undefined
    ) {
      throw new Error("complete or cancel the active turn before switching agent");
    }
  }

  /**
   * Switches a conversation to another agent profile. History, sources,
   * results, viewer references, and MCP attachments are preserved; only
   * the agent session changes. The target runtime is created before any
   * mutation, so a failed switch leaves an explicit recoverable state on
   * the original profile and never falls back silently.
   */
  async #selectAgent(conversationId: string, profileId: string): Promise<void> {
    const conversation = this.#conversation(conversationId);
    if (conversation.status === "closed") throw new Error("conversation is closed");
    const definition = this.#agents.definitions.find((entry) => entry.id === profileId);
    if (definition === undefined) throw new Error("agent profile is unknown");
    if (profileId === conversation.agentProfileId) return;
    this.#requireSettledForAgentSwitch(conversation);
    try {
      await this.#ensureKey(profileId, this.#baseRuntimeKey(conversation));
    } catch (error) {
      const current = this.#profileFor(conversation).displayName;
      this.#append(
        conversation,
        "system",
        "error",
        `Agent switch to ${definition.displayName} failed: ${
          safeError(error)
        } The conversation keeps running on ${current}.`,
      );
      await this.#persist();
      throw error;
    }
    const releasedKey = this.#profiledRuntimeKey(conversation);
    await this.#detachHandle(conversation, "Agent switched");
    conversation.agentProfileId = profileId;
    conversation.sessionKey = profileSessionKey(
      this.#baseSessionKey(conversation),
      profileId,
    );
    this.#append(
      conversation,
      "system",
      "status",
      `Switched to ${definition.displayName}. History, tools, and viewers are preserved; the agent session starts fresh.`,
    );
    await this.#maybeReleaseRuntime(releasedKey);
    await this.#persist();
  }

  /** Bare session key for the conversation's kind + MCP state, without profile scoping. */
  #baseSessionKey(conversation: ConversationState): string {
    if (conversation.kind === "project") {
      return `${SESSION_PREFIX}/${conversation.projectId}/${conversation.id}`;
    }
    return standaloneSessionKey(
      conversation.id,
      conversation.mcpStatus === "connected" ? conversation.mcpId : undefined,
    );
  }

  #requireSettledForMcpSwitch(conversation: ConversationState): void {
    if (
      conversation.activeTurn !== undefined || conversation.status === "running" ||
      conversation.status === "queued" || conversation.pending !== undefined
    ) {
      throw new Error("stop the active turn before changing the MCP attachment");
    }
  }

  async #detachHandle(conversation: ConversationState, reason: string): Promise<void> {
    if (conversation.handle === undefined) return;
    await this.#adapterFor(conversation).runtime.close({
      handle: conversation.handle,
      reason,
      discardPersistentState: false,
    });
    this.#releaseSessionIds(conversation);
    conversation.handle = undefined;
  }

  #baseRuntimeKey(conversation: ConversationState): string {
    return chatRuntimeKey(
      conversation.kind,
      conversation.mcpStatus === "connected" ? conversation.mcpId : undefined,
    );
  }

  #profiledRuntimeKey(conversation: ConversationState): string {
    return profileRuntimeKey(
      this.#baseRuntimeKey(conversation),
      conversation.agentProfileId,
    );
  }

  #profileFor(conversation: ConversationState): AgentProfileDefinition {
    const definition = this.#agents.definitions.find(
      (entry) => entry.id === conversation.agentProfileId,
    );
    if (definition === undefined) throw new Error("agent profile is unknown");
    return definition;
  }

  #adapterFor(conversation: ConversationState): ChatRuntimeAdapter {
    const adapter = this.#runtimes.get(this.#profiledRuntimeKey(conversation));
    if (adapter === undefined) throw new Error("chat runtime is not configured");
    return adapter;
  }

  /**
   * Lazily creates the conversation's profiled runtime through the host
   * factory. Failures reject with the host's explicit reason; the caller
   * never falls back to another profile.
   */
  async #ensureRuntimeFor(conversation: ConversationState): Promise<void> {
    await this.#ensureKey(
      conversation.agentProfileId,
      this.#baseRuntimeKey(conversation),
    );
  }

  async #ensureKey(profileId: string, baseKey: string): Promise<void> {
    const key = profileRuntimeKey(baseKey, profileId);
    if (this.#runtimes.has(key)) return;
    const adapter = await this.#agents.ensureRuntime(profileId, baseKey);
    this.registerRuntime(key, adapter);
  }

  /**
   * Closes an MCP-scoped runtime nobody uses anymore. Closed conversations
   * hold no handle, so only live users pin a runtime. Base runtimes are
   * process singletons and are never released; agent processes themselves
   * close per session via detach, and relays via attachment release. A
   * close failure is ignored: idle agent hosts expire on their own side
   * within a minute.
   */
  async #maybeReleaseRuntime(key: string): Promise<void> {
    if (!key.includes("+mcp:")) return;
    for (const entry of this.#conversations.values()) {
      if (entry.status !== "closed" && this.#profiledRuntimeKey(entry) === key) return;
    }
    const adapter = this.#runtimes.get(key);
    if (adapter === undefined) return;
    this.unregisterRuntime(key);
    await adapter.close().catch(() => undefined);
  }

  #mcpDisplayName(mcpId: string): string {
    return this.#mcpServers.find((entry) => entry.id === mcpId)?.displayName ?? mcpId;
  }

  #mcpExpectedViews(mcpId: string): readonly string[] {
    return this.#mcpServers.find((entry) => entry.id === mcpId)?.expectedViews ?? [];
  }

  async #stop(): Promise<void> {
    this.#host = "shutting-down";
    for (const conversation of this.#conversations.values()) {
      this.#abortPending(conversation);
      conversation.activeAbort?.abort("Chat Host shutting down");
      if (conversation.activeTurn !== undefined) {
        await conversation.activeTurn.cancel({ reason: "Chat Host shutting down" })
          .catch(
            () => undefined,
          );
      }
    }
    await Promise.allSettled(
      [...this.#conversations.values()].map((conversation) => conversation.queueTail),
    );
    for (const conversation of this.#conversations.values()) {
      if (conversation.handle === undefined) continue;
      try {
        await this.#adapterFor(conversation).runtime.close({
          handle: conversation.handle,
          reason: "Chat Host shutting down",
          discardPersistentState: false,
        });
      } catch {
        // Shutdown closes every runtime below regardless.
      }
      this.#releaseSessionIds(conversation);
      conversation.handle = undefined;
    }
    await Promise.allSettled(
      [...this.#runtimes.values()].map((adapter) => adapter.close()),
    );
    await this.#persistTail;
  }

  #findPermissionOwner(sessionId: string): ConversationState | undefined {
    const owner = this.#sessionOwners.get(sessionId);
    return owner === undefined ? undefined : this.#conversations.get(owner);
  }

  #claimSessionIds(conversation: ConversationState, handle: RuntimeHandle): void {
    for (const id of [handle.backendSessionId, handle.agentSessionId]) {
      if (id === undefined) continue;
      const existing = this.#sessionOwners.get(id);
      if (existing !== undefined && existing !== conversation.id) {
        throw new Error("ACP session is already owned by another Desktop conversation");
      }
      this.#sessionOwners.set(id, conversation.id);
    }
  }

  #releaseSessionIds(conversation: ConversationState): void {
    for (const [id, owner] of this.#sessionOwners) {
      if (owner === conversation.id) this.#sessionOwners.delete(id);
    }
  }

  #abortPending(conversation: ConversationState): void {
    const pending = conversation.pending;
    if (pending === undefined) return;
    pending.abort();
    if (conversation.pending === pending) conversation.pending = undefined;
  }

  #conversation(id: string): ConversationState {
    const conversation = this.#conversations.get(id);
    if (conversation === undefined) throw new Error("conversation does not exist");
    return conversation;
  }

  #append(
    conversation: ConversationState,
    role: ChatMessageDto["role"],
    kind: ChatMessageDto["kind"],
    text: string,
  ): string | undefined {
    const sanitized = clean(text, 32_000);
    if (sanitized === "") return undefined;
    const id = `message:${this.#newId()}`;
    conversation.messages.push(Object.freeze({
      id,
      role,
      kind,
      text: sanitized,
      createdAt: this.#now().toISOString(),
      // Provenance: user messages are the human's; every other message is
      // produced under the active profile. Absent on legacy content.
      ...(role === "user" ? {} : { agent: conversation.agentProfileId }),
    }));
    conversation.updatedAt = this.#now().toISOString();
    return id;
  }

  #appendTurnFailure(conversation: ConversationState, error: unknown): void {
    const message = safeError(error);
    this.#append(conversation, "system", "error", message);
    if (isAgentAuthFailure(message)) {
      this.#append(
        conversation,
        "system",
        "status",
        this.#profileFor(conversation).authRecovery,
      );
    }
  }

  #appendDelta(
    conversation: ConversationState,
    kind: "text" | "thought",
    text: string,
  ): string | undefined {
    const delta = clean(text, 16_000);
    if (delta === "") return undefined;
    const last = conversation.messages.at(-1);
    if (last?.role === "assistant" && last.kind === kind) {
      conversation.messages[conversation.messages.length - 1] = Object.freeze({
        ...last,
        text: clean(`${last.text}${delta}`, 32_000),
      });
      conversation.updatedAt = this.#now().toISOString();
      return last.id;
    }
    return this.#append(conversation, "assistant", kind, delta);
  }

  #toDto(
    conversation: ConversationState,
    includeMessages: boolean,
  ): ChatConversationDto {
    let mcp: ChatConversationMcpDto | undefined;
    if (conversation.mcpId !== undefined && conversation.mcpStatus !== undefined) {
      mcp = Object.freeze({
        id: conversation.mcpId,
        displayName: this.#mcpDisplayName(conversation.mcpId),
        status: conversation.mcpStatus,
        // Renderer contract caps the conversation tool list at 64 names;
        // authorization still checks the full conversation list by name.
        tools: Object.freeze(conversation.mcpTools.slice(0, 64)),
      });
    }
    // Saved work remains visible across MCP switches and provider removal.
    // Live App/tool commands separately require the owning connection.
    const viewers: ChatToolViewerDto[] = includeMessages
      ? conversation.toolResults.map((entry) =>
        Object.freeze({
          ...toolViewerIdentity(entry),
          ...(entry.revision === undefined || entry.resultDigest === undefined ? {} : {
            archive: Object.freeze({
              revision: entry.revision,
              resultDigest: entry.resultDigest,
              server: entry.server,
              capturedAt: entry.capturedAt,
              failed: entry.failed,
              artifacts: Object.freeze(
                (entry.artifacts ?? []).map((artifact) =>
                  Object.freeze({
                    uri: artifact.uri,
                    fileName: artifact.fileName,
                    mimeType: artifact.mimeType,
                    bytes: artifact.bytes,
                    sha256: artifact.sha256,
                    state: artifact.state,
                    ...(artifact.reason === undefined
                      ? {}
                      : { reason: artifact.reason }),
                  })
                ),
              ),
            }),
          }),
        })
      )
      : [];
    return Object.freeze({
      id: conversation.id,
      kind: conversation.kind,
      ...(conversation.projectId === undefined
        ? {}
        : { projectId: conversation.projectId }),
      ...(conversation.workspaceProjectId === undefined
        ? {}
        : { workspaceProjectId: conversation.workspaceProjectId }),
      title: conversation.title,
      status: conversation.status,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      agentProfileId: conversation.agentProfileId,
      messages: Object.freeze(includeMessages ? [...conversation.messages] : []),
      ...(mcp === undefined ? {} : { mcp }),
      ...(conversation.pending === undefined
        ? {}
        : { pendingInteraction: conversation.pending.dto }),
      viewers: Object.freeze(viewers),
    });
  }

  #projectViewers(
    conversations: readonly ConversationState[],
  ): readonly ChatProjectViewerDto[] {
    const retained = conversations.flatMap((conversation) => {
      const workspaceProjectId = conversation.workspaceProjectId;
      return conversation.kind === "standalone" && workspaceProjectId !== undefined
        ? conversation.toolResults.map((result) => ({
          conversation,
          workspaceProjectId,
          result,
        }))
        : [];
    }).sort((a, b) =>
      a.result.capturedAt.localeCompare(b.result.capturedAt) ||
      a.conversation.id.localeCompare(b.conversation.id) ||
      a.result.viewerId.localeCompare(b.result.viewerId)
    ).slice(-CHAT_PROJECT_VIEWERS_MAX);
    return Object.freeze(
      retained.map(({ conversation, workspaceProjectId, result }) =>
        Object.freeze({
          workspaceProjectId,
          owningConversationId: conversation.id,
          viewer: toolViewerIdentity(result),
        })
      ),
    );
  }

  #restore(stored: StoredConversation): boolean {
    const kind: ChatConversationKind = stored.kind ??
      (stored.projectId !== undefined ? "project" : "standalone");
    if (kind === "project") {
      if (
        stored.projectId === undefined ||
        stored.workspaceProjectId !== undefined ||
        !stored.sessionKey.startsWith(`${SESSION_PREFIX}/${stored.projectId}/`)
      ) return false;
    } else {
      if (
        stored.projectId !== undefined ||
        !stored.sessionKey.startsWith(`${SESSION_PREFIX}/standalone/`)
      ) return false;
      if (stored.workspaceProjectId !== undefined) {
        try {
          parseCasysProjectId(stored.workspaceProjectId);
        } catch {
          return false;
        }
      }
    }
    // Absent profile reads as legacy Codex and keeps the stored key
    // verbatim: pre-profile conversations resume identical sessions and
    // are never relabelled. An unknown stored id (deleted custom) remaps
    // to legacy with one explicit note, never silently.
    const knownIds = new Set(this.#agents.definitions.map((entry) => entry.id));
    const storedProfileId = stored.agentProfileId ?? LEGACY_AGENT_PROFILE_ID;
    const remapped = !knownIds.has(storedProfileId);
    const agentProfileId = remapped ? LEGACY_AGENT_PROFILE_ID : storedProfileId;
    const mcpId = kind === "standalone" ? stored.mcpId : undefined;
    const mcpStatus = kind === "standalone" ? stored.mcpStatus : undefined;
    const mcpAttached = mcpId !== undefined && mcpStatus !== undefined;
    this.#conversations.set(stored.id, {
      id: stored.id,
      kind,
      ...(stored.projectId === undefined ? {} : { projectId: stored.projectId }),
      ...(stored.workspaceProjectId === undefined
        ? {}
        : { workspaceProjectId: stored.workspaceProjectId }),
      agentProfileId,
      sessionKey: stored.sessionKey,
      ...(mcpAttached ? { mcpId } : {}),
      ...(mcpAttached ? { mcpStatus } : {}),
      mcpTools: mcpAttached ? sanitizeMcpTools(stored.mcpTools) : [],
      knownByKey: restoreKnownByKey(stored),
      toolResults: restoreToolResults(stored),
      canvasLayout: stored.canvasLayout ?? EMPTY_CANVAS_LAYOUT,
      title: stored.title,
      status: stored.status === "running" || stored.status === "queued"
        ? "idle"
        : stored.status,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      messages: [...stored.messages],
      queueTail: Promise.resolve(),
      queueEpoch: 0,
    });
    if (remapped) {
      const conversation = this.#conversations.get(stored.id)!;
      // Restored conversations hold no handle; the suffixed native session
      // is orphaned on disk while the bare key starts fresh with a full
      // bounded reseed on the next turn.
      conversation.sessionKey = this.#baseSessionKey(conversation);
      this.#noteProfileRemap(conversation, storedProfileId);
    }
    return remapped;
  }

  /**
   * Remaps live conversations whose profile disappeared from the registry
   * (custom removed by reload) to legacy with one explicit note each.
   * Handles detach first so no turn can land on the orphaned runtime;
   * the bare key starts fresh with a full bounded reseed on the next
   * turn. Returns whether any conversation moved.
   */
  async #remapUnknownProfiles(): Promise<boolean> {
    const knownIds = new Set(this.#agents.definitions.map((entry) => entry.id));
    let remapped = false;
    for (const conversation of this.#conversations.values()) {
      if (knownIds.has(conversation.agentProfileId)) continue;
      const storedProfileId = conversation.agentProfileId;
      const releasedKey = this.#profiledRuntimeKey(conversation);
      await this.#detachHandle(conversation, "Agent profile removed");
      conversation.agentProfileId = LEGACY_AGENT_PROFILE_ID;
      conversation.sessionKey = this.#baseSessionKey(conversation);
      this.#noteProfileRemap(conversation, storedProfileId);
      await this.#maybeReleaseRuntime(releasedKey);
      remapped = true;
    }
    return remapped;
  }

  #noteProfileRemap(conversation: ConversationState, storedProfileId: string): void {
    this.#append(
      conversation,
      "system",
      "status",
      `The previously selected agent '${storedProfileId}' is no longer available; Codex is active.`,
    );
  }

  #persist(): Promise<void> {
    const gate = this.#projectAttachmentGate;
    return gate === undefined
      ? this.#persistSnapshot()
      : gate.then(() => this.#persist());
  }

  #persistSnapshot(
    membership?: {
      readonly conversationId: string;
      readonly workspaceProjectId: string;
      readonly updatedAt: string;
    },
  ): Promise<void> {
    const snapshot = [...this.#conversations.values()].map((entry) =>
      Object.freeze({
        id: entry.id,
        kind: entry.kind,
        ...(entry.projectId === undefined ? {} : { projectId: entry.projectId }),
        ...(membership?.conversationId === entry.id
          ? { workspaceProjectId: membership.workspaceProjectId }
          : entry.workspaceProjectId === undefined
          ? {}
          : { workspaceProjectId: entry.workspaceProjectId }),
        agentProfileId: entry.agentProfileId,
        ...(entry.mcpId === undefined ? {} : { mcpId: entry.mcpId }),
        ...(entry.mcpStatus === undefined ? {} : { mcpStatus: entry.mcpStatus }),
        // The store cannot hold more names than its tamper-guard budget;
        // the session keeps the full authorization list.
        mcpTools: Object.freeze(entry.mcpTools.slice(0, STORE_MCP_TOOLS_MAX)),
        knownMessageIdsByKey: serializeKnownByKey(entry),
        toolResults: Object.freeze(entry.toolResults.map((result) =>
          Object.freeze({
            viewerId: result.viewerId,
            toolCallId: result.toolCallId,
            ...(result.originAgentProfileId === undefined
              ? {}
              : { originAgentProfileId: result.originAgentProfileId }),
            ...(result.originSessionKey === undefined
              ? {}
              : { originSessionKey: result.originSessionKey }),
            ...(result.originAgentSessionId === undefined
              ? {}
              : { originAgentSessionId: result.originAgentSessionId }),
            ...(result.originTurnId === undefined
              ? {}
              : { originTurnId: result.originTurnId }),
            server: result.server,
            tool: result.tool,
            messageId: result.messageId,
            appUri: result.appUri,
            failed: result.failed,
            input: result.input,
            result: result.result,
            capturedAt: result.capturedAt,
            ...(result.revision === undefined ? {} : { revision: result.revision }),
            ...(result.resultDigest === undefined
              ? {}
              : { resultDigest: result.resultDigest }),
            ...(result.artifacts === undefined ? {} : {
              artifacts: Object.freeze(
                result.artifacts.map((artifact) => Object.freeze({ ...artifact })),
              ),
            }),
          })
        )),
        sessionKey: entry.sessionKey,
        title: entry.title,
        status: entry.status,
        createdAt: entry.createdAt,
        updatedAt: membership?.conversationId === entry.id
          ? membership.updatedAt
          : entry.updatedAt,
        messages: Object.freeze([...entry.messages]),
        canvasLayout: entry.canvasLayout,
      })
    );
    return this.#afterPersistTail(() => this.#store.save(snapshot));
  }

  /**
   * Serialize store commits in call order. The tail survives individual
   * failures (each caller still observes its own) so one failed write can
   * never brick later persistence. Artifact bytes commit through the same
   * tail so a stale snapshot can never prune bytes ahead of their manifest.
   */
  #afterPersistTail<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#persistTail.then(task, task);
    this.#persistTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

function toolViewerIdentity(entry: CapturedToolResult): ChatToolViewerDto {
  return Object.freeze({
    viewerId: entry.viewerId,
    toolCallId: entry.toolCallId,
    messageId: entry.messageId,
    tool: entry.tool,
    appUri: entry.appUri,
  });
}

function projectSystemPrompt(projectId: string): string {
  return [
    "You are embedded in Casys Digital Thread Desktop.",
    `This ACP session is exclusively bound to projectId ${projectId}.`,
    "Use only registered Casys project tools and always pass that exact projectId.",
    "Never choose providers, operation arguments, or runtime versions; the server owns them.",
    "MRTR engineering decisions require the server elicitation and explicit human acceptance.",
    "Agent permission prompts are operational permissions and never substitute for MRTR.",
    "Thread/CAS is authoritative; this chat transcript is presentation history only.",
  ].join("\n");
}

function standaloneSystemPrompt(conversation: ConversationState): string {
  const lines = [
    "You are embedded in Casys Digital Thread Desktop.",
    "This is a standalone conversation: no Casys project, brief, SysML model, or Thread baseline is attached.",
  ];
  if (conversation.mcpStatus === "connected" && conversation.mcpId !== undefined) {
    lines.push(
      `An MCP server is connected. Its own tool contracts determine supported inputs and results; no Casys admitted-language subset applies to ordinary calls.`,
    );
  } else {
    lines.push(
      "No engineering MCP is connected. Answer directly, and offer to connect a tool when the task needs one.",
    );
  }
  lines.push(
    "Never choose providers, operation arguments, or runtime versions.",
    "This chat transcript is presentation history only.",
  );
  return lines.join("\n");
}

function systemPromptFor(conversation: ConversationState): string {
  if (conversation.kind === "standalone") return standaloneSystemPrompt(conversation);
  if (conversation.projectId === undefined) {
    throw new Error("project conversation is missing its projectId");
  }
  return projectSystemPrompt(conversation.projectId);
}

function markKnown(
  conversation: ConversationState,
  sessionKey: string,
  ids: readonly string[],
): void {
  if (ids.length === 0) return;
  let known = conversation.knownByKey.get(sessionKey);
  if (known === undefined) {
    known = new Set();
    conversation.knownByKey.set(sessionKey, known);
  }
  for (const id of ids) known.add(id);
}

function restoreKnownByKey(stored: StoredConversation): Map<string, Set<string>> {
  const known = new Map<string, Set<string>>();
  // Absent map (pre-seeding entries): reseed everything once. Duplicating
  // history into a resumed session is fail-safe; assuming knowledge could
  // silently lose it if the agent-side store diverged.
  const record = stored.knownMessageIdsByKey;
  if (record === undefined || typeof record !== "object" || record === null) {
    return known;
  }
  const live = new Set(stored.messages.map((message) => message.id));
  for (const [key, ids] of Object.entries(record)) {
    if (typeof key !== "string" || !Array.isArray(ids)) continue;
    const pruned = ids.filter((id): id is string =>
      typeof id === "string" && live.has(id)
    );
    if (pruned.length > 0) known.set(key, new Set(pruned));
  }
  return known;
}

/** Provider tool names the conversation DTO admits: non-empty text ≤128. */
function sanitizeMcpTools(names: unknown): string[] {
  if (!Array.isArray(names)) return [];
  return names.filter((name): name is string =>
    typeof name === "string" && name.trim() !== "" && name.length <= 128
  );
}

function restoreToolResults(stored: StoredConversation): CapturedToolResult[] {
  const results = stored.toolResults;
  if (!Array.isArray(results)) return [];
  const restored: CapturedToolResult[] = [];
  const seenViewerIds = new Set<string>();
  for (const entry of results.slice(-TOOL_RESULTS_MAX)) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const candidate = entry as Record<string, unknown>;
    // Restore only entries the renderer contract admits; a tampered store
    // must degrade to fewer viewers, never to an unparsable snapshot.
    if (
      !isChatOpaqueId(candidate.toolCallId) ||
      typeof candidate.server !== "string" || candidate.server === "" ||
      !isChatViewerToolName(candidate.tool) ||
      !isChatOpaqueId(candidate.messageId) ||
      !isChatViewerUiUri(candidate.appUri) ||
      typeof candidate.failed !== "boolean" ||
      typeof candidate.capturedAt !== "string" ||
      !Number.isFinite(Date.parse(candidate.capturedAt))
    ) continue;
    const viewerId = candidate.viewerId === undefined
      ? candidate.toolCallId
      : candidate.viewerId;
    if (!isChatOpaqueId(viewerId) || seenViewerIds.has(viewerId)) continue;
    let input: Readonly<Record<string, ChatViewerJson>>;
    let result: ChatViewerJson;
    try {
      input = parseChatViewerArguments(candidate.input ?? {});
      result = parseChatViewerJson(candidate.result);
      if (
        JSON.stringify(input).length > TOOL_RESULT_JSON_MAX ||
        JSON.stringify(result).length > TOOL_RESULT_JSON_MAX
      ) continue;
    } catch {
      continue;
    }
    // Archive fields degrade to unsaved on any shape violation: a tampered
    // manifest must never brick the viewer itself.
    const revision = Number.isSafeInteger(candidate.revision) &&
        (candidate.revision as number) >= 1
      ? candidate.revision as number
      : undefined;
    const resultDigest = typeof candidate.resultDigest === "string" &&
        /^sha256:[a-f0-9]{64}$/.test(candidate.resultDigest)
      ? candidate.resultDigest
      : undefined;
    const artifacts = readRestoredArtifacts(candidate.artifacts);
    const archived = revision !== undefined && resultDigest !== undefined &&
      artifacts !== undefined;
    seenViewerIds.add(viewerId);
    restored.push({
      viewerId,
      toolCallId: candidate.toolCallId,
      ...(typeof candidate.originAgentProfileId === "string" &&
          /^[a-z0-9][a-z0-9-]{0,47}$/.test(candidate.originAgentProfileId) &&
          typeof candidate.originSessionKey === "string" &&
          candidate.originSessionKey.length > 0 &&
          candidate.originSessionKey.length <= 500 &&
          typeof candidate.originAgentSessionId === "string" &&
          candidate.originAgentSessionId.length > 0 &&
          candidate.originAgentSessionId.length <= 200
        ? {
          originAgentProfileId: candidate.originAgentProfileId,
          originSessionKey: candidate.originSessionKey,
          originAgentSessionId: candidate.originAgentSessionId,
          ...(typeof candidate.originTurnId === "string" &&
              candidate.originTurnId.length > 0 &&
              candidate.originTurnId.length <= 160
            ? { originTurnId: candidate.originTurnId }
            : {}),
        }
        : {}),
      server: candidate.server,
      tool: candidate.tool,
      messageId: candidate.messageId,
      appUri: candidate.appUri,
      failed: candidate.failed,
      input,
      result,
      capturedAt: candidate.capturedAt,
      ...(archived
        ? {
          revision: revision as number,
          resultDigest: resultDigest as string,
          artifacts: artifacts as readonly StoredWorkArtifact[],
        }
        : {}),
    });
  }
  return restored;
}

function readRestoredArtifacts(
  value: unknown,
): readonly StoredWorkArtifact[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const artifacts: StoredWorkArtifact[] = [];
  for (const entry of value.slice(0, WORK_ARCHIVE_MAX_ARTIFACTS)) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return undefined;
    }
    const candidate = entry as Record<string, unknown>;
    if (
      typeof candidate.uri !== "string" ||
      (!candidate.uri.startsWith("ui://") && !candidate.uri.startsWith("casys://")) ||
      candidate.uri.length > 500 ||
      typeof candidate.fileName !== "string" || candidate.fileName === "" ||
      candidate.fileName.length > 128 || candidate.fileName.includes("/") ||
      candidate.fileName.includes("\\") ||
      typeof candidate.mimeType !== "string" || candidate.mimeType === "" ||
      candidate.mimeType.length > 200 ||
      !Number.isSafeInteger(candidate.bytes) || (candidate.bytes as number) < 0 ||
      (candidate.bytes as number) > 33_554_432 ||
      typeof candidate.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(candidate.sha256) ||
      (candidate.state !== "saved" && candidate.state !== "missing") ||
      (candidate.reason !== undefined &&
        (typeof candidate.reason !== "string" || candidate.reason.length > 200)) ||
      (candidate.savedAt !== undefined &&
        (typeof candidate.savedAt !== "string" ||
          !Number.isFinite(Date.parse(candidate.savedAt))))
    ) {
      return undefined;
    }
    artifacts.push({
      uri: candidate.uri,
      fileName: candidate.fileName,
      mimeType: candidate.mimeType,
      bytes: candidate.bytes as number,
      sha256: candidate.sha256,
      state: candidate.state,
      ...(candidate.reason === undefined ? {} : { reason: candidate.reason as string }),
      ...(candidate.savedAt === undefined
        ? {}
        : { savedAt: candidate.savedAt as string }),
    });
  }
  return artifacts;
}

function serializeKnownByKey(
  conversation: ConversationState,
): Record<string, readonly string[]> {
  const order = new Map(
    conversation.messages.map((message, index) => [message.id, index]),
  );
  const record: Record<string, readonly string[]> = {};
  for (const key of [...conversation.knownByKey.keys()].sort()) {
    // Mirror the file-store retention cap in transcript order: only the
    // oldest ids drop, and dropped ids reseed later, which duplicates
    // history instead of bricking the next load.
    const ids = [...(conversation.knownByKey.get(key) ?? [])]
      .filter((id) => order.has(id))
      .sort((a, b) => order.get(a)! - order.get(b)!)
      .slice(-400);
    if (ids.length > 0) record[key] = Object.freeze(ids);
  }
  return Object.freeze(record);
}

function parseMcpRawInput(
  value: unknown,
): { server: string; tool: string; arguments?: unknown } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  if (typeof input.server !== "string" || typeof input.tool !== "string") {
    return undefined;
  }
  // Keep only tool names the renderer contract admits: anything else is
  // ignored so a hostile provider name can never break snapshot parsing.
  if (input.server === "" || !isChatViewerToolName(input.tool)) {
    return undefined;
  }
  return { server: input.server, tool: input.tool, arguments: input.arguments };
}

function parseMcpRawOutput(
  value: unknown,
): { result: unknown; error: unknown } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const output = value as Record<string, unknown>;
  if (!("result" in output)) return undefined;
  return { result: output.result, error: output.error };
}

/**
 * Claude-style ACP tool result (#59): adapters that forward raw MCP shapes
 * instead of the `{server, tool}` / `{result}` envelopes. The namespaced
 * title carries identity, `rawInput` the exact arguments, and `rawOutput`
 * the provider result as a JSON string (observed) or a single-text content
 * block array (SDK shape). Returns undefined on any surprise so production
 * never retains a misattributed result.
 */
function parseClaudeStyleToolResult(
  event: Extract<RuntimeEvent, { type: "tool_call" }>,
  mcpId: string,
): { tool: string; args: unknown; result: unknown } | undefined {
  if (typeof event.title !== "string") return undefined;
  const namespaced = MCP_NAMESPACED_TITLE.exec(event.title);
  if (namespaced === null) return undefined;
  const [, server, tool] = namespaced;
  if (server !== mcpId || !isChatViewerToolName(tool)) return undefined;
  if (typeof event.rawInput !== "object" || event.rawInput === null) {
    return undefined;
  }
  const result = parseClaudeStyleRawOutput(event.rawOutput);
  if (result === undefined) return undefined;
  return { tool, args: event.rawInput, result };
}

function parseClaudeStyleRawOutput(value: unknown): unknown {
  if (typeof value === "string") return parseJsonObject(value);
  if (Array.isArray(value) && value.length === 1) {
    const block = value[0] as Record<string, unknown> | undefined;
    if (typeof block?.text === "string") return parseJsonObject(block.text);
  }
  return undefined;
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function parseViewerResourcePayload(
  uri: string,
  value: unknown,
  source: "saved" | "live",
) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Resource read returned an unexpected payload.");
  }
  const contents = (value as Record<string, unknown>).contents;
  if (!Array.isArray(contents)) {
    throw new Error("Resource read returned an unexpected payload.");
  }
  if (contents.length !== 1) {
    throw new Error("Resource read returned multiple content blocks.");
  }
  const entry = contents[0] as Record<string, unknown>;
  if (
    entry.uri !== uri || typeof entry.mimeType !== "string" ||
    entry.mimeType === "" || entry.mimeType.length > 200
  ) {
    throw new Error("Resource read returned an unexpected payload.");
  }
  let bytes: Uint8Array;
  if (typeof entry.text === "string") {
    bytes = new TextEncoder().encode(entry.text);
  } else if (typeof entry.blob === "string") {
    try {
      bytes = base64ToBytes(entry.blob);
    } catch {
      throw new Error("Resource read returned an unexpected payload.");
    }
  } else {
    throw new Error("Resource read returned an unexpected payload.");
  }
  if (bytes.byteLength === 0) {
    throw new Error("Resource read returned an invalid size.");
  }
  if (bytes.byteLength > VIEWER_RESOURCE_IPC_MAX_BYTES) {
    throw new Error("Resource read is too large for the chat IPC line.");
  }
  return Object.freeze({
    uri,
    mimeType: entry.mimeType,
    bytes: bytes.byteLength,
    encoding: "base64",
    data: bytesToBase64(bytes),
    source,
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

class ArchiveMismatchError extends Error {}

function maxToolRevision(results: readonly CapturedToolResult[]): number {
  let max = 0;
  for (const entry of results) {
    if (entry.revision !== undefined && entry.revision > max) max = entry.revision;
  }
  return max;
}

function archiveExtension(mimeType: string): string {
  switch (mimeType) {
    case "model/gltf-binary":
      return "glb";
    case "model/step":
      return "step";
    case "model/stl":
      return "stl";
    case "application/pdf":
      return "pdf";
    case "text/plain":
      return "txt";
    case "text/html":
      return "html";
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "application/json":
      return "json";
    default:
      return "bin";
  }
}

/** Export file suggestion: URI leaf sanitized, else tool/revision based. */
function archiveFileName(
  uri: string,
  tool: string,
  revision: number,
  mimeType: string,
): string {
  const leaf = (uri.split("/").pop() ?? "").replace(
    /[^A-Za-z0-9._-]+/g,
    "-",
  ).replace(/^-+|-+$/g, "");
  if (leaf !== "" && leaf !== "." && leaf !== ".." && leaf.includes(".")) {
    return leaf.slice(0, 128);
  }
  return `${tool}-v${revision}.${archiveExtension(mimeType)}`.slice(0, 128);
}

function base64ToBytes(data: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
    throw new Error("Resource read returned an unexpected payload.");
  }
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** App URI named by the exact result, admitted only as an expected view. */
function viewerAppUri(
  result: unknown,
  expectedViews: readonly string[],
): string | undefined {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return undefined;
  }
  const meta = (result as Record<string, unknown>)._meta;
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    return undefined;
  }
  const ui = (meta as Record<string, unknown>).ui;
  if (typeof ui !== "object" || ui === null || Array.isArray(ui)) return undefined;
  const uri = (ui as Record<string, unknown>).resourceUri;
  if (typeof uri !== "string" || !expectedViews.includes(uri)) {
    return undefined;
  }
  return uri;
}

const SEED_MAX_MESSAGES = 30;
const SEED_MAX_CHARS = 12_000;
const SEED_MESSAGE_CHARS = 1_500;

function seedContextFor(
  conversation: ConversationState,
  sessionKey: string,
  excludeId: string | undefined,
): { readonly block: string; readonly ids: readonly string[] } | undefined {
  const known = conversation.knownByKey.get(sessionKey);
  // Only strictly-prior history seeds: a later-queued user message may
  // already sit in the transcript when this turn ensures.
  const boundary = excludeId === undefined
    ? conversation.messages.length
    : conversation.messages.findIndex((message) => message.id === excludeId);
  const eligible = boundary < 0
    ? conversation.messages
    : conversation.messages.slice(0, boundary);
  const fresh = eligible.filter((message) => !known?.has(message.id));
  if (fresh.length === 0) return undefined;
  const tail = fresh.slice(-SEED_MAX_MESSAGES);
  const droppedByCount = fresh.length - tail.length;
  let lines = tail.map((message) => {
    const preview = message.text.slice(0, SEED_MESSAGE_CHARS);
    const marker = message.text.length > SEED_MESSAGE_CHARS ? " …[truncated]" : "";
    return `[${message.role}/${message.kind}] ${preview}${marker}`;
  });
  let text = lines.join("\n");
  let droppedByChars = 0;
  while (text.length > SEED_MAX_CHARS && lines.length > 1) {
    lines = lines.slice(1);
    droppedByChars += 1;
    text = lines.join("\n");
  }
  const skipped = droppedByCount + droppedByChars;
  const block = [
    "Prior conversation context follows (restored after an agent-session switch; it is history only — do not re-execute anything described here):",
    ...(skipped > 0 ? [`…${skipped} earlier message(s) truncated…`] : []),
    text,
  ].join("\n");
  return {
    block,
    ids: tail.slice(droppedByChars).map((message) => message.id),
  };
}

function turnTextFor(conversation: ConversationState, text: string): string {
  if (conversation.kind === "standalone") return text;
  if (conversation.projectId === undefined) {
    throw new Error("project conversation is missing its projectId");
  }
  return boundPrompt(conversation.projectId, text);
}

function standaloneSessionKey(conversationId: string, mcpId?: string): string {
  const base = `${SESSION_PREFIX}/standalone/${conversationId}`;
  return mcpId === undefined ? base : `${base}/mcp/${mcpId}`;
}

function boundPrompt(projectId: string, text: string): string {
  return `Bound Casys projectId: ${projectId}\n\nHuman message:\n${text}`;
}

function safeError(error: unknown): string {
  if (typeof error === "string") return clean(error, 1_000);
  if (error instanceof Error) return clean(error.message, 1_000);
  return "Chat Host operation failed.";
}

function clean(value: string, max: number): string {
  const cleaned = [...value].filter((character) => {
    const code = character.charCodeAt(0);
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
  }).join("");
  return cleaned.slice(0, max);
}
