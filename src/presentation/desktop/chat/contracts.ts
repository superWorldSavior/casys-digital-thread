/**
 * Closed `casys-desktop-chat/1.0` presentation contract.
 *
 * Desktop host and Workbench UI reconstruct these DTOs. Host process, bindings,
 * and chat-runtime stay in `desktop/`.
 */

export const DESKTOP_CHAT_PROTOCOL = "casys-desktop-chat/1.0" as const;
export const CHAT_HOST_COMPONENT_ID = "chat-host" as const;
export const CHAT_HOST_COMPONENT_VERSION = "0.6.0" as const;

export type ChatConversationStatus =
  | "idle"
  | "queued"
  | "running"
  | "failed"
  | "closed";

export type ChatMessageKind = "text" | "thought" | "tool" | "status" | "error";

export interface ChatMessageDto {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly kind: ChatMessageKind;
  readonly text: string;
  readonly createdAt: string;
  /**
   * Producing agent profile, present on agent-produced messages written
   * after profiles existed. Absent on user messages (human provenance) and
   * on legacy content (Codex era).
   */
  readonly agent?: string;
}

export interface ChatPermissionOptionDto {
  readonly decision:
    | "allow_once"
    | "allow_always"
    | "reject_once"
    | "reject_always";
  readonly label: string;
}

export interface ChatFormOptionDto {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

interface ChatFormFieldBaseDto {
  readonly name: string;
  readonly label: string;
  readonly description?: string;
  readonly required: boolean;
}

export type ChatFormFieldDto =
  | (ChatFormFieldBaseDto & {
    readonly type: "text";
    readonly format?: "email" | "uri" | "date" | "date-time";
    readonly minLength?: number;
    readonly maxLength?: number;
    readonly pattern?: string;
    readonly defaultValue?: string;
  })
  | (ChatFormFieldBaseDto & {
    readonly type: "number";
    readonly minimum?: number;
    readonly maximum?: number;
    readonly defaultValue?: number;
  })
  | (ChatFormFieldBaseDto & {
    readonly type: "integer";
    readonly minimum?: number;
    readonly maximum?: number;
    readonly defaultValue?: number;
  })
  | (ChatFormFieldBaseDto & {
    readonly type: "boolean";
    readonly defaultValue?: boolean;
  })
  | (ChatFormFieldBaseDto & {
    readonly type: "select";
    readonly options: readonly ChatFormOptionDto[];
    readonly defaultValue?: string;
  })
  | (ChatFormFieldBaseDto & {
    readonly type: "multiselect";
    readonly options: readonly ChatFormOptionDto[];
    readonly minItems?: number;
    readonly maxItems?: number;
    readonly defaultValue?: readonly string[];
  });

export type ChatPendingInteractionDto =
  | {
    readonly type: "permission";
    readonly correlationId: string;
    readonly title: string;
    readonly detail: string;
    readonly options: readonly ChatPermissionOptionDto[];
  }
  | {
    readonly type: "elicitation-form";
    readonly correlationId: string;
    readonly message: string;
    readonly title?: string;
    readonly description?: string;
    readonly fields: readonly ChatFormFieldDto[];
  }
  | {
    readonly type: "elicitation-url";
    readonly correlationId: string;
    readonly message: string;
    readonly url: string;
  };

export type ChatConversationKind = "project" | "standalone";

export type ChatConversationMcpStatus = "connected" | "failed";

/**
 * Active MCP attachment of a standalone conversation. Identity and state
 * only: connection ownership, endpoints, and credentials stay host-side.
 */
export interface ChatConversationMcpDto {
  readonly id: string;
  readonly displayName: string;
  readonly status: ChatConversationMcpStatus;
  readonly tools: readonly string[];
}

/**
 * MCP the host can attach to a standalone conversation. Advertised for
 * explicit enablement; the catalogue (#54) owns discovery beyond this list.
 */
export interface ChatConnectableMcpDto {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly transport: "streamable-http";
}

export interface ChatConversationDto {
  readonly id: string;
  readonly kind: ChatConversationKind;
  readonly projectId?: string;
  readonly title: string;
  readonly status: ChatConversationStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Active agent profile; explicit per conversation, never inherited. */
  readonly agentProfileId: string;
  readonly messages: readonly ChatMessageDto[];
  readonly mcp?: ChatConversationMcpDto;
  readonly pendingInteraction?: ChatPendingInteractionDto;
  readonly viewers: readonly ChatToolViewerDto[];
}

/** One selectable agent profile with live availability. */
export interface ChatAgentProfileDto {
  readonly id: string;
  readonly displayName: string;
  readonly available: boolean;
  readonly version?: string;
  readonly missingReason?: string;
  readonly modelsExposed: boolean;
}

/**
 * One captured MCP tool result viewable as a live MCP App. Identity only:
 * the exact result bytes cross only through `viewer.open`.
 */
export interface ChatToolViewerDto {
  readonly toolCallId: string;
  readonly messageId: string;
  readonly tool: string;
  readonly appUri: string;
  /**
   * Saved-work summary (#51). Absent on entries captured before saving
   * existed or whose archive record was dropped: the renderer shows those
   * as explicitly unsaved, never as saved.
   */
  readonly archive?: ChatViewerArchiveDto;
}

/** One saved artifact file: identity plus its retention state. */
export interface ChatViewerArtifactDto {
  readonly uri: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly state: "saved" | "missing";
  readonly reason?: string;
}

/** Saved-work summary for one result version: source, receipt, exports. */
export interface ChatViewerArchiveDto {
  readonly revision: number;
  readonly resultDigest: string;
  readonly server: string;
  readonly capturedAt: string;
  readonly failed: boolean;
  readonly artifacts: readonly ChatViewerArtifactDto[];
}

/** Store retention policy backing the session work list, when bounded. */
export interface ChatRetentionDto {
  readonly days: number;
  readonly maxConversations: number;
  /** Tool versions kept per conversation; absent on hosts predating it. */
  readonly maxVersions?: number;
}

/** Bounded JSON carried between the viewer backend and the renderer. */
export type ChatViewerJson =
  | null
  | boolean
  | number
  | string
  | readonly ChatViewerJson[]
  | { readonly [key: string]: ChatViewerJson };

export interface ChatViewerAppDto {
  readonly uri: string;
  readonly mimeType: string;
  readonly bytes: number;
  /**
   * Fingerprint pinned by the owning session at open time. The renderer
   * fetches the bytes from the Desktop viewer route and attests them
   * against this fingerprint before framing: App documents exceed the
   * chat-host IPC line budget and never cross it.
   */
  readonly fingerprint: string;
}

export interface ChatViewerSessionDto {
  readonly toolCallId: string;
  readonly tool: string;
  readonly server: string;
  readonly appUri: string;
  readonly app: ChatViewerAppDto;
  readonly toolInput: Readonly<Record<string, ChatViewerJson>>;
  /** The exact captured tool result, delivered so the App never re-executes. */
  readonly toolResult: ChatViewerJson;
  /** Probed tools of the owning session; the only names the App may call. */
  readonly serverTools: readonly string[];
}

export interface ChatViewerResourceDto {
  readonly uri: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly encoding: "base64";
  readonly data: string;
  /** Byte origin: retained archive bytes or a live provider read. */
  readonly source: "saved" | "live";
}

/**
 * Session Canvas layout (#55): presentation-only, keyed by conversation.
 *
 * Like the project whiteboard, this schema is never Thread evidence, a
 * viewer-capability source, or a provider input. The conversation snapshot
 * (retained tool results, workspace files) stays the sole authority;
 * persisted entries are admitted only after exact reconciliation with it.
 */
export const CHAT_CANVAS_LAYOUT_VERSION = 1;
const CHAT_CANVAS_MAX_NODES = 200;
const CHAT_CANVAS_MAX_GROUPS = 50;
const CHAT_CANVAS_MAX_TEXT = 2_000;
const CHAT_CANVAS_MAX_COORDINATE = 100_000;
const CHAT_CANVAS_MAX_Z = 1_000_000;

export interface ChatCanvasNodeDto {
  readonly id: string;
  readonly kind: "viewer" | "note";
  /** Optional display title; defaults to the tool name or "Note". */
  readonly title?: string;
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
  readonly z: number;
  /** Retained tool result identity; viewer nodes only. */
  readonly toolCallId?: string;
  /** Lightweight note text; note nodes only. */
  readonly text?: string;
  /** Todo checkbox; note nodes only. */
  readonly done?: boolean;
  readonly groupId?: string;
}

export interface ChatCanvasGroupDto {
  readonly id: string;
  readonly title: string;
}

export interface ChatCanvasLayoutDto {
  readonly version: typeof CHAT_CANVAS_LAYOUT_VERSION;
  readonly nodes: readonly ChatCanvasNodeDto[];
  readonly groups: readonly ChatCanvasGroupDto[];
}

export interface ChatSnapshotRequest {
  readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
  readonly conversationId?: string;
}

export interface ChatSnapshotDto {
  readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
  readonly host: "ready" | "unavailable" | "shutting-down";
  readonly conversations: readonly ChatConversationDto[];
  readonly connectableMcps: readonly ChatConnectableMcpDto[];
  readonly selectedConversationId?: string;
  readonly error?: string;
  /** Store retention backing saved work; absent when unbounded. */
  readonly retention?: ChatRetentionDto;
  /** Selectable agent profiles; always present so the selector renders before auth. */
  readonly agentProfiles: readonly ChatAgentProfileDto[];
  readonly defaultAgentProfileId: string;
}

export type ChatCommandRequest =
  | {
    readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
    readonly requestId: string;
    readonly command: "conversation.create";
    /** Present for a project conversation, absent for a standalone chat. */
    readonly projectId?: string;
    readonly title?: string;
  }
  | {
    readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
    readonly requestId: string;
    readonly command: "mcp.enable";
    readonly conversationId: string;
    readonly mcpId: string;
  }
  | {
    readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
    readonly requestId: string;
    readonly command: "mcp.disable";
    readonly conversationId: string;
  }
  | {
    readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
    readonly requestId: string;
    readonly command: "message.send";
    readonly conversationId: string;
    readonly text: string;
  }
  | {
    readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
    readonly requestId: string;
    readonly command: "turn.cancel" | "conversation.close";
    readonly conversationId: string;
  }
  | {
    readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
    readonly requestId: string;
    readonly command: "permission.resolve";
    readonly conversationId: string;
    readonly correlationId: string;
    readonly decision:
      | "allow_once"
      | "allow_always"
      | "reject_once"
      | "reject_always"
      | "cancel";
  }
  | {
    readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
    readonly requestId: string;
    readonly command: "elicitation.resolve";
    readonly conversationId: string;
    readonly correlationId: string;
    readonly action: "accept" | "decline" | "cancel";
    readonly content?: Readonly<
      Record<string, string | number | boolean | string[]>
    >;
  }
  | {
    readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
    readonly requestId: string;
    readonly command: "viewer.open";
    readonly conversationId: string;
    readonly toolCallId: string;
  }
  | {
    readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
    readonly requestId: string;
    readonly command: "viewer.tool-call";
    readonly conversationId: string;
    readonly toolCallId: string;
    readonly name: string;
    readonly arguments: Readonly<Record<string, ChatViewerJson>>;
  }
  | {
    readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
    readonly requestId: string;
    readonly command: "viewer.resource-read";
    readonly conversationId: string;
    readonly toolCallId: string;
    readonly uri: string;
  }
  | {
    readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
    readonly requestId: string;
    readonly command: "agent.select";
    readonly conversationId: string;
    readonly profileId: string;
  }
  | {
    readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
    readonly requestId: string;
    readonly command: "agent.set-default";
    readonly profileId: string;
  }
  | {
    readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
    readonly requestId: string;
    readonly command: "agent.reload-profiles";
  }
  | {
    readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
    readonly requestId: string;
    readonly command: "canvas.get-layout";
    readonly conversationId: string;
  }
  | {
    readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
    readonly requestId: string;
    readonly command: "canvas.set-layout";
    readonly conversationId: string;
    readonly layout: ChatCanvasLayoutDto;
  };

export interface ChatCommandResponse {
  readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
  readonly requestId: string;
  readonly ok: boolean;
  readonly conversationId?: string;
  readonly error?: string;
  readonly viewer?: ChatViewerSessionDto;
  readonly viewerResult?: ChatViewerJson;
  readonly viewerResource?: ChatViewerResourceDto;
  readonly layout?: ChatCanvasLayoutDto;
}

export type DesktopChatBindingCommandRequest = ChatCommandRequest | {
  readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
  readonly requestId: string;
  readonly command: "external.open";
  readonly url: string;
};

/**
 * Whole App document fetch, served desktop-side outside the chat-host IPC
 * line budget. App bytes are the provider's static shell: they carry no
 * session data, so the owning session is proven by `viewer.open` (which
 * pins `fingerprint`) rather than by this fetch. The desktop refuses
 * before shipping megabytes when the fetched bytes no longer match the
 * pinned fingerprint.
 */
export interface ChatViewerAppFetchRequest {
  readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
  readonly requestId: string;
  readonly server: string;
  readonly uri: string;
  readonly fingerprint: string;
}

export interface ChatViewerAppBytesDto {
  readonly uri: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly fingerprint: string;
  readonly encoding: "base64";
  readonly data: string;
}

export interface ChatViewerAppFetchResponse {
  readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
  readonly requestId: string;
  readonly ok: boolean;
  readonly app?: ChatViewerAppBytesDto;
  readonly error?: string;
}

const PROJECT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const OPAQUE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
const AGENT_PROFILE_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

export function parseChatSnapshotRequest(value: unknown): ChatSnapshotRequest {
  const input = record(value, "snapshot request");
  protocol(input.protocol);
  const conversationId = optionalOpaqueId(
    input.conversationId,
    "conversationId",
  );
  return Object.freeze({
    protocol: DESKTOP_CHAT_PROTOCOL,
    ...(conversationId === undefined ? {} : { conversationId }),
  });
}

export function parseChatCommandRequest(value: unknown): ChatCommandRequest {
  const input = record(value, "chat command");
  protocol(input.protocol);
  const requestId = opaqueId(input.requestId, "requestId");
  const command = text(input.command, "command", 64);

  if (command === "conversation.create") {
    const projectId = input.projectId === undefined
      ? undefined
      : parseCasysProjectId(input.projectId);
    const title = optionalText(input.title, "title", 120);
    return Object.freeze({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId,
      command,
      ...(projectId === undefined ? {} : { projectId }),
      ...(title === undefined ? {} : { title }),
    });
  }

  if (command === "agent.set-default") {
    return Object.freeze({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId,
      command,
      profileId: agentProfileId(input.profileId, "profileId"),
    });
  }
  if (command === "agent.reload-profiles") {
    return Object.freeze({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId,
      command,
    });
  }
  const conversationId = opaqueId(input.conversationId, "conversationId");
  if (command === "agent.select") {
    return Object.freeze({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId,
      command,
      conversationId,
      profileId: agentProfileId(input.profileId, "profileId"),
    });
  }
  if (command === "mcp.enable") {
    return Object.freeze({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId,
      command,
      conversationId,
      mcpId: opaqueId(input.mcpId, "mcpId"),
    });
  }
  if (command === "mcp.disable") {
    return Object.freeze({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId,
      command,
      conversationId,
    });
  }
  if (command === "message.send") {
    return Object.freeze({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId,
      command,
      conversationId,
      text: text(input.text, "text", 32_000),
    });
  }
  if (command === "turn.cancel" || command === "conversation.close") {
    return Object.freeze({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId,
      command,
      conversationId,
    });
  }
  if (
    command === "viewer.open" || command === "viewer.tool-call" ||
    command === "viewer.resource-read"
  ) {
    const toolCallId = opaqueId(input.toolCallId, "toolCallId");
    if (command === "viewer.open") {
      return Object.freeze({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId,
        command,
        conversationId,
        toolCallId,
      });
    }
    if (command === "viewer.tool-call") {
      return Object.freeze({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId,
        command,
        conversationId,
        toolCallId,
        name: viewerToolName(input.name),
        arguments: viewerArguments(input.arguments),
      });
    }
    return Object.freeze({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId,
      command,
      conversationId,
      toolCallId,
      uri: viewerResourceUri(input.uri),
    });
  }
  if (command === "canvas.get-layout") {
    return Object.freeze({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId,
      command,
      conversationId,
    });
  }
  if (command === "canvas.set-layout") {
    return Object.freeze({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId,
      command,
      conversationId,
      layout: parseChatCanvasLayout(input.layout),
    });
  }
  const correlationId = opaqueId(input.correlationId, "correlationId");
  if (command === "permission.resolve") {
    const decision = input.decision;
    if (
      decision !== "allow_once" && decision !== "allow_always" &&
      decision !== "reject_once" && decision !== "reject_always" &&
      decision !== "cancel"
    ) {
      throw new TypeError("permission decision is invalid");
    }
    return Object.freeze({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId,
      command,
      conversationId,
      correlationId,
      decision,
    });
  }
  if (command === "elicitation.resolve") {
    const action = input.action;
    if (action !== "accept" && action !== "decline" && action !== "cancel") {
      throw new TypeError("elicitation action is invalid");
    }
    const content = input.content === undefined
      ? undefined
      : elicitationContent(input.content);
    return Object.freeze({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId,
      command,
      conversationId,
      correlationId,
      action,
      ...(content === undefined ? {} : { content }),
    });
  }
  throw new TypeError("chat command is not supported");
}

/** Shared closed project identity contract for renderer commands and host focus. */
export function parseCasysProjectId(value: unknown): string {
  const projectId = text(value, "projectId", 128);
  if (!PROJECT_ID.test(projectId)) {
    throw new TypeError(
      "projectId must be an explicit Casys project identifier",
    );
  }
  return projectId;
}

export function parseDesktopChatBindingCommandRequest(
  value: unknown,
): DesktopChatBindingCommandRequest {
  const input = record(value, "desktop chat binding command");
  if (input.command !== "external.open") return parseChatCommandRequest(value);
  protocol(input.protocol);
  return Object.freeze({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: opaqueId(input.requestId, "requestId"),
    command: "external.open",
    url: validateExternalHttpsUrl(input.url),
  });
}

export function parseChatViewerAppFetchRequest(
  value: unknown,
): ChatViewerAppFetchRequest {
  const input = record(value, "viewer App fetch request");
  protocol(input.protocol);
  return Object.freeze({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: opaqueId(input.requestId, "requestId"),
    server: opaqueId(input.server, "viewer App server"),
    uri: viewerUiUri(input.uri),
    fingerprint: viewerFingerprint(input.fingerprint),
  });
}

/** Reconstructs the renderer DTO and drops every unregistered sidecar field. */
export function parseChatViewerAppFetchResponse(
  value: unknown,
): ChatViewerAppFetchResponse {
  const input = record(value, "viewer App fetch response");
  protocol(input.protocol);
  const requestId = opaqueId(input.requestId, "requestId");
  if (typeof input.ok !== "boolean") {
    throw new TypeError("viewer App fetch response state is invalid");
  }
  if (!input.ok) {
    return Object.freeze({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId,
      ok: false,
      error: text(
        input.error ?? "Viewer App fetch failed.",
        "viewer App error",
        500,
      ),
    });
  }
  return Object.freeze({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId,
    ok: true,
    app: parseViewerAppBytesDto(input.app),
  });
}

export interface ChatSaveFileRequest {
  readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
  readonly requestId: string;
  readonly fileName: string;
  readonly data: string;
}

export interface ChatSaveFileResponse {
  readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
  readonly requestId: string;
  readonly ok: boolean;
  readonly path?: string;
  readonly bytes?: number;
  readonly error?: string;
}

/**
 * Renderer→Desktop file export (#51). The Desktop host re-sanitizes the
 * name, writes outside the chat data root, and reports the exact path.
 */
export function parseChatSaveFileRequest(value: unknown): ChatSaveFileRequest {
  const input = record(value, "save file request");
  protocol(input.protocol);
  return Object.freeze({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: opaqueId(input.requestId, "requestId"),
    fileName: viewerFileName(input.fileName),
    data: viewerBase64(input.data, "save file data"),
  });
}

export function parseChatSaveFileResponse(value: unknown): ChatSaveFileResponse {
  const input = record(value, "save file response");
  protocol(input.protocol);
  const requestId = opaqueId(input.requestId, "requestId");
  if (typeof input.ok !== "boolean") {
    throw new TypeError("save file response state is invalid");
  }
  if (!input.ok) {
    return Object.freeze({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId,
      ok: false,
      error: text(input.error ?? "File export failed.", "save file error", 500),
    });
  }
  const bytes = input.bytes;
  if (!Number.isSafeInteger(bytes) || (bytes as number) < 0) {
    throw new TypeError("save file bytes are invalid");
  }
  return Object.freeze({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId,
    ok: true,
    path: text(input.path, "save file path", 1_024),
    bytes: bytes as number,
  });
}

/** Versioned export artifact record carried inside an exact tool result. */
export interface ChatViewerArtifactRecord {
  readonly uri: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly sha256: string;
}

const VIEWER_EXPORT_ARTIFACT_SCHEMA = "build123d-export-artifact/1.0";

/**
 * Artifact records the host retains bytes for. Mirrors the renderer's
 * `liveHostReadResources` admission shape; the renderer keeps its own
 * fingerprint-bound registration for blob-URL serving.
 */
export function extractViewerArtifactRecords(
  result: ChatViewerJson,
): readonly ChatViewerArtifactRecord[] {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return [];
  }
  const structured = (result as Record<string, ChatViewerJson>).structuredContent;
  if (
    typeof structured !== "object" || structured === null || Array.isArray(structured)
  ) {
    return [];
  }
  const files = (structured as Record<string, ChatViewerJson>).files;
  if (!Array.isArray(files)) return [];
  const records: ChatViewerArtifactRecord[] = [];
  const seen = new Set<string>();
  for (const file of files.slice(0, 8)) {
    if (typeof file !== "object" || file === null || Array.isArray(file)) continue;
    const artifact = (file as Record<string, ChatViewerJson>).artifact;
    if (typeof artifact !== "object" || artifact === null || Array.isArray(artifact)) {
      continue;
    }
    const fields = artifact as Record<string, ChatViewerJson>;
    if (fields.schemaVersion !== VIEWER_EXPORT_ARTIFACT_SCHEMA) continue;
    const uri = fields.uri;
    if (
      typeof uri !== "string" ||
      (!uri.startsWith("casys://") && !uri.startsWith("ui://"))
    ) continue;
    const mimeType = fields.mimeType;
    if (
      typeof mimeType !== "string" || mimeType === "" || mimeType.length > 200
    ) continue;
    const bytes = fields.bytes;
    if (
      typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 1 ||
      bytes > 33_554_432
    ) continue;
    const sha256 = fields.sha256;
    // Dedupe by locator, not content: the same bytes under two URIs still
    // need one manifest record per URI so each reopens from the archive.
    const locator = `${sha256}\0${uri}`;
    if (
      typeof sha256 !== "string" || !VIEWER_ARTIFACT_DIGEST.test(sha256) ||
      seen.has(locator)
    ) continue;
    seen.add(locator);
    records.push({ uri, mimeType, bytes, sha256 });
  }
  return Object.freeze(records);
}

function parseViewerAppBytesDto(value: unknown): ChatViewerAppBytesDto {
  const input = record(value, "viewer App bytes");
  if (input.encoding !== "base64") {
    throw new TypeError("viewer App bytes encoding is invalid");
  }
  return Object.freeze({
    uri: viewerUiUri(input.uri),
    mimeType: text(input.mimeType, "viewer App media type", 200),
    bytes: viewerByteCount(input.bytes, "viewer App bytes"),
    fingerprint: viewerFingerprint(input.fingerprint),
    encoding: "base64",
    data: viewerBase64(input.data, "viewer App data"),
  });
}

export function validateExternalHttpsUrl(value: unknown): string {
  const input = text(value, "external URL", 4_000);
  const url = new URL(input);
  if (
    url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
    url.hostname === ""
  ) {
    throw new TypeError(
      "external URL must be an HTTPS URL without credentials",
    );
  }
  return url.toString();
}

export function validateSafeRegexPattern(value: unknown): string {
  if (typeof value !== "string" || value.length > 200) {
    throw new TypeError("pattern is outside the safe renderer subset");
  }
  if (
    /\\[1-9]|\(\?/.test(value) ||
    /(?:\*|\+|\{\d*,?\d*\})\s*(?:\*|\+|\{)/.test(value) ||
    /\([^)]*\)\s*(?:\*|\+|\{)/.test(value)
  ) throw new TypeError("pattern is outside the safe renderer subset");
  try {
    new RegExp(value);
  } catch {
    throw new TypeError("pattern is not a valid regular expression");
  }
  return value;
}

/** Reconstructs the renderer DTO and drops every unregistered sidecar field. */
export function parseChatSnapshotDto(value: unknown): ChatSnapshotDto {
  const input = record(value, "chat snapshot");
  protocol(input.protocol);
  const host = input.host;
  if (host !== "ready" && host !== "unavailable" && host !== "shutting-down") {
    throw new TypeError("chat host state is invalid");
  }
  if (!Array.isArray(input.conversations) || input.conversations.length > 100) {
    throw new TypeError("chat conversation list is invalid");
  }
  const conversations = Object.freeze(
    input.conversations.map(parseConversationDto),
  );
  if (
    !Array.isArray(input.connectableMcps) || input.connectableMcps.length > 32
  ) {
    throw new TypeError("chat connectable MCP list is invalid");
  }
  const connectableMcps = Object.freeze(
    input.connectableMcps.map(parseConnectableMcpDto),
  );
  const selectedConversationId = optionalOpaqueId(
    input.selectedConversationId,
    "selectedConversationId",
  );
  const error = optionalText(input.error, "error", 1_000);
  const retention = input.retention === undefined
    ? undefined
    : parseRetentionDto(input.retention);
  if (!Array.isArray(input.agentProfiles) || input.agentProfiles.length > 10) {
    throw new TypeError("chat agent profile list is invalid");
  }
  const agentProfiles = Object.freeze(input.agentProfiles.map(parseAgentProfileDto));
  return Object.freeze({
    protocol: DESKTOP_CHAT_PROTOCOL,
    host,
    conversations,
    connectableMcps,
    ...(selectedConversationId === undefined ? {} : { selectedConversationId }),
    ...(error === undefined ? {} : { error }),
    ...(retention === undefined ? {} : { retention }),
    agentProfiles,
    defaultAgentProfileId: agentProfileId(
      input.defaultAgentProfileId,
      "defaultAgentProfileId",
    ),
  });
}

function parseAgentProfileDto(value: unknown): ChatAgentProfileDto {
  const input = record(value, "agent profile");
  if (typeof input.available !== "boolean") {
    throw new TypeError("agent profile availability is invalid");
  }
  if (typeof input.modelsExposed !== "boolean") {
    throw new TypeError("agent profile models flag is invalid");
  }
  const version = optionalText(input.version, "version", 64);
  const missingReason = optionalText(input.missingReason, "missingReason", 500);
  if (input.available && missingReason !== undefined) {
    throw new TypeError("available agent profile must not carry a missing reason");
  }
  return Object.freeze({
    id: agentProfileId(input.id, "agent profile id"),
    displayName: text(input.displayName, "displayName", 64),
    available: input.available,
    ...(version === undefined ? {} : { version }),
    ...(missingReason === undefined ? {} : { missingReason }),
    modelsExposed: input.modelsExposed,
  });
}

function parseRetentionDto(value: unknown): ChatRetentionDto {
  const input = record(value, "chat retention");
  const days = input.days;
  const maxConversations = input.maxConversations;
  const maxVersions = input.maxVersions;
  if (
    !Number.isSafeInteger(days) || (days as number) < 1 ||
    (days as number) > 3_650 ||
    !Number.isSafeInteger(maxConversations) || (maxConversations as number) < 1 ||
    (maxConversations as number) > 10_000 ||
    (maxVersions !== undefined &&
      (!Number.isSafeInteger(maxVersions) || (maxVersions as number) < 1 ||
        (maxVersions as number) > 10_000))
  ) {
    throw new TypeError("chat retention is invalid");
  }
  return Object.freeze({
    days: days as number,
    maxConversations: maxConversations as number,
    ...(maxVersions === undefined ? {} : { maxVersions: maxVersions as number }),
  });
}

export function parseChatCommandResponse(value: unknown): ChatCommandResponse {
  const input = record(value, "chat command response");
  protocol(input.protocol);
  const requestId = opaqueId(input.requestId, "requestId");
  if (typeof input.ok !== "boolean") {
    throw new TypeError("command response ok is invalid");
  }
  const conversationId = optionalOpaqueId(
    input.conversationId,
    "conversationId",
  );
  const error = optionalText(input.error, "error", 1_000);
  const viewer = input.viewer === undefined
    ? undefined
    : parseViewerSessionDto(input.viewer);
  const viewerResult = input.viewerResult === undefined
    ? undefined
    : viewerJson(input.viewerResult, "viewer result");
  const viewerResource = input.viewerResource === undefined
    ? undefined
    : parseViewerResourceDto(input.viewerResource);
  const layout = input.layout === undefined
    ? undefined
    : parseChatCanvasLayout(input.layout);
  return Object.freeze({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId,
    ok: input.ok,
    ...(conversationId === undefined ? {} : { conversationId }),
    ...(error === undefined ? {} : { error }),
    ...(viewer === undefined ? {} : { viewer }),
    ...(viewerResult === undefined ? {} : { viewerResult }),
    ...(viewerResource === undefined ? {} : { viewerResource }),
    ...(layout === undefined ? {} : { layout }),
  });
}

function parseConversationDto(value: unknown): ChatConversationDto {
  const input = record(value, "chat conversation");
  const status = input.status;
  if (
    status !== "idle" && status !== "queued" && status !== "running" &&
    status !== "failed" && status !== "closed"
  ) {
    throw new TypeError("conversation status is invalid");
  }
  const kind = input.kind;
  if (kind !== "project" && kind !== "standalone") {
    throw new TypeError("conversation kind is invalid");
  }
  const projectId = input.projectId === undefined
    ? undefined
    : parseCasysProjectId(input.projectId);
  if (kind === "project" && projectId === undefined) {
    throw new TypeError("project conversation requires a projectId");
  }
  if (kind === "standalone" && projectId !== undefined) {
    throw new TypeError("standalone conversation must not have a projectId");
  }
  if (!Array.isArray(input.messages) || input.messages.length > 400) {
    throw new TypeError("conversation messages are invalid");
  }
  const mcp = input.mcp === undefined ? undefined : parseConversationMcpDto(input.mcp);
  if (mcp !== undefined && kind !== "standalone") {
    throw new TypeError("MCP attachment requires a standalone conversation");
  }
  const pendingInteraction = input.pendingInteraction === undefined
    ? undefined
    : parsePendingInteractionDto(input.pendingInteraction);
  if (!Array.isArray(input.viewers) || input.viewers.length > 20) {
    throw new TypeError("conversation viewers are invalid");
  }
  return Object.freeze({
    id: opaqueId(input.id, "conversation id"),
    kind,
    ...(projectId === undefined ? {} : { projectId }),
    title: text(input.title, "conversation title", 120),
    status,
    createdAt: isoDate(input.createdAt, "createdAt"),
    updatedAt: isoDate(input.updatedAt, "updatedAt"),
    agentProfileId: agentProfileId(input.agentProfileId, "agentProfileId"),
    messages: Object.freeze(input.messages.map(parseMessageDto)),
    ...(mcp === undefined ? {} : { mcp }),
    ...(pendingInteraction === undefined ? {} : { pendingInteraction }),
    viewers: Object.freeze(input.viewers.map(parseToolViewerDto)),
  });
}

function parseToolViewerDto(value: unknown): ChatToolViewerDto {
  const input = record(value, "tool viewer");
  const archive = input.archive === undefined
    ? undefined
    : parseViewerArchiveDto(input.archive);
  return Object.freeze({
    toolCallId: opaqueId(input.toolCallId, "viewer toolCallId"),
    messageId: opaqueId(input.messageId, "viewer messageId"),
    tool: viewerToolName(input.tool),
    appUri: viewerUiUri(input.appUri),
    ...(archive === undefined ? {} : { archive }),
  });
}

function parseViewerArchiveDto(value: unknown): ChatViewerArchiveDto {
  const input = record(value, "viewer archive");
  const revision = input.revision;
  if (
    !Number.isSafeInteger(revision) || (revision as number) < 1 ||
    (revision as number) > 1_000_000
  ) {
    throw new TypeError("viewer archive revision is invalid");
  }
  if (!Array.isArray(input.artifacts) || input.artifacts.length > 8) {
    throw new TypeError("viewer archive artifacts are invalid");
  }
  if (typeof input.failed !== "boolean") {
    throw new TypeError("viewer archive state is invalid");
  }
  return Object.freeze({
    revision: revision as number,
    resultDigest: viewerFingerprint(input.resultDigest),
    server: opaqueId(input.server, "viewer archive server"),
    capturedAt: isoDate(input.capturedAt, "viewer archive capturedAt"),
    failed: input.failed,
    artifacts: Object.freeze(
      input.artifacts.map(parseViewerArtifactDto),
    ),
  });
}

function parseViewerArtifactDto(value: unknown): ChatViewerArtifactDto {
  const input = record(value, "viewer artifact");
  const state = input.state;
  if (state !== "saved" && state !== "missing") {
    throw new TypeError("viewer artifact state is invalid");
  }
  return Object.freeze({
    uri: viewerResourceUri(input.uri),
    fileName: viewerFileName(input.fileName),
    mimeType: text(input.mimeType, "viewer artifact media type", 200),
    bytes: viewerDeclaredBytes(input.bytes, "viewer artifact bytes"),
    sha256: viewerArtifactDigest(input.sha256),
    state,
    ...(input.reason === undefined
      ? {}
      : { reason: text(input.reason, "viewer artifact reason", 200) }),
  });
}

function parseViewerSessionDto(value: unknown): ChatViewerSessionDto {
  const input = record(value, "viewer session");
  if (!Array.isArray(input.serverTools) || input.serverTools.length > 64) {
    throw new TypeError("viewer server tools are invalid");
  }
  return Object.freeze({
    toolCallId: opaqueId(input.toolCallId, "viewer toolCallId"),
    tool: viewerToolName(input.tool),
    server: opaqueId(input.server, "viewer server"),
    appUri: viewerUiUri(input.appUri),
    app: parseViewerAppDto(input.app),
    toolInput: viewerArguments(input.toolInput),
    toolResult: viewerJson(input.toolResult, "viewer tool result"),
    serverTools: Object.freeze(
      input.serverTools.map((entry) => viewerToolName(entry)),
    ),
  });
}

function parseViewerAppDto(value: unknown): ChatViewerAppDto {
  const input = record(value, "viewer app");
  return Object.freeze({
    uri: viewerUiUri(input.uri),
    mimeType: text(input.mimeType, "viewer app media type", 200),
    bytes: viewerByteCount(input.bytes, "viewer app bytes"),
    fingerprint: viewerFingerprint(input.fingerprint),
  });
}

function parseViewerResourceDto(value: unknown): ChatViewerResourceDto {
  const input = record(value, "viewer resource");
  if (input.encoding !== "base64") {
    throw new TypeError("viewer resource encoding is invalid");
  }
  const source = input.source;
  if (source !== "saved" && source !== "live") {
    throw new TypeError("viewer resource source is invalid");
  }
  return Object.freeze({
    uri: viewerResourceUri(input.uri),
    mimeType: text(input.mimeType, "viewer resource media type", 200),
    bytes: viewerByteCount(input.bytes, "viewer resource bytes"),
    encoding: "base64",
    data: viewerBase64(input.data, "viewer resource data"),
    source,
  });
}

export function parseChatCanvasLayout(value: unknown): ChatCanvasLayoutDto {
  const input = record(value, "canvas layout");
  if (input.version !== CHAT_CANVAS_LAYOUT_VERSION) {
    throw new TypeError("canvas layout version is invalid");
  }
  if (!Array.isArray(input.nodes) || input.nodes.length > CHAT_CANVAS_MAX_NODES) {
    throw new TypeError("canvas layout nodes are invalid");
  }
  if (!Array.isArray(input.groups) || input.groups.length > CHAT_CANVAS_MAX_GROUPS) {
    throw new TypeError("canvas layout groups are invalid");
  }
  const groups = input.groups.map((entry) => parseChatCanvasGroup(entry));
  const groupIds = new Set(groups.map((entry) => entry.id));
  if (groupIds.size !== groups.length) {
    throw new TypeError("canvas layout group ids must be unique");
  }
  const nodes = input.nodes.map((entry) => parseChatCanvasNode(entry, groupIds));
  const nodeIds = new Set(nodes.map((entry) => entry.id));
  if (nodeIds.size !== nodes.length) {
    throw new TypeError("canvas layout node ids must be unique");
  }
  return Object.freeze({ version: CHAT_CANVAS_LAYOUT_VERSION, nodes, groups });
}

function parseChatCanvasGroup(value: unknown): ChatCanvasGroupDto {
  const input = record(value, "canvas group");
  return Object.freeze({
    id: opaqueId(input.id, "canvas group id"),
    title: text(input.title, "canvas group title", 200),
  });
}

function parseChatCanvasNode(
  value: unknown,
  groupIds: ReadonlySet<string>,
): ChatCanvasNodeDto {
  const input = record(value, "canvas node");
  const kind = input.kind;
  if (kind !== "viewer" && kind !== "note") {
    throw new TypeError("canvas node kind is invalid");
  }
  const groupId = input.groupId === undefined
    ? undefined
    : opaqueId(input.groupId, "canvas node group");
  if (groupId !== undefined && !groupIds.has(groupId)) {
    throw new TypeError("canvas node group is unknown");
  }
  const title = input.title === undefined
    ? undefined
    : text(input.title, "canvas node title", 200);
  const base = {
    id: opaqueId(input.id, "canvas node id"),
    kind,
    ...(title === undefined ? {} : { title }),
    x: canvasCoordinate(input.x, "canvas node x"),
    y: canvasCoordinate(input.y, "canvas node y"),
    ...optionalCanvasSize(input.width, "width", "canvas node width"),
    ...optionalCanvasSize(input.height, "height", "canvas node height"),
    z: canvasZ(input.z),
    ...(groupId === undefined ? {} : { groupId }),
  };
  if (kind === "viewer") {
    if (input.text !== undefined || input.done !== undefined) {
      throw new TypeError("canvas viewer nodes carry no text");
    }
    return Object.freeze({
      ...base,
      kind: "viewer",
      toolCallId: opaqueId(input.toolCallId, "canvas node tool"),
    });
  }
  if (input.toolCallId !== undefined) {
    throw new TypeError("canvas note nodes carry no tool result");
  }
  const done = input.done === undefined ? undefined : optionalDone(input.done);
  return Object.freeze({
    ...base,
    kind: "note",
    text: boundedText(input.text, "canvas note text", CHAT_CANVAS_MAX_TEXT),
    ...(done === undefined ? {} : { done }),
  });
}

function optionalDone(value: unknown): boolean {
  if (typeof value !== "boolean") throw new TypeError("canvas note done is invalid");
  return value;
}

function canvasCoordinate(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} is invalid`);
  }
  if (Math.abs(value) > CHAT_CANVAS_MAX_COORDINATE) {
    throw new TypeError(`${name} is out of range`);
  }
  return value;
}

function optionalCanvasSize(
  value: unknown,
  key: string,
  name: string,
): Record<string, number> {
  if (value === undefined) return {};
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} is invalid`);
  }
  if (value > CHAT_CANVAS_MAX_COORDINATE) {
    throw new TypeError(`${name} is out of range`);
  }
  return { [key]: value };
}

function canvasZ(value: unknown): number {
  if (!Number.isSafeInteger(value)) throw new TypeError("canvas node z is invalid");
  if (Math.abs(value as number) > CHAT_CANVAS_MAX_Z) {
    throw new TypeError("canvas node z is out of range");
  }
  return value as number;
}

function parseConversationMcpDto(value: unknown): ChatConversationMcpDto {
  const input = record(value, "conversation MCP");
  const status = input.status;
  if (status !== "connected" && status !== "failed") {
    throw new TypeError("conversation MCP status is invalid");
  }
  if (!Array.isArray(input.tools) || input.tools.length > 64) {
    throw new TypeError("conversation MCP tools are invalid");
  }
  return Object.freeze({
    id: opaqueId(input.id, "conversation MCP id"),
    displayName: text(input.displayName, "conversation MCP displayName", 120),
    status,
    tools: Object.freeze(
      input.tools.map((entry) => text(entry, "conversation MCP tool", 128)),
    ),
  });
}

function parseConnectableMcpDto(value: unknown): ChatConnectableMcpDto {
  const input = record(value, "connectable MCP");
  if (input.transport !== "streamable-http") {
    throw new TypeError("connectable MCP transport is invalid");
  }
  return Object.freeze({
    id: opaqueId(input.id, "connectable MCP id"),
    displayName: text(input.displayName, "connectable MCP displayName", 120),
    description: text(input.description, "connectable MCP description", 500),
    transport: "streamable-http",
  });
}

function parseMessageDto(value: unknown): ChatMessageDto {
  const input = record(value, "chat message");
  const role = input.role;
  const kind = input.kind;
  if (role !== "user" && role !== "assistant" && role !== "system") {
    throw new TypeError("chat message role is invalid");
  }
  if (
    kind !== "text" && kind !== "thought" && kind !== "tool" &&
    kind !== "status" && kind !== "error"
  ) {
    throw new TypeError("chat message kind is invalid");
  }
  return Object.freeze({
    id: opaqueId(input.id, "message id"),
    role,
    kind,
    text: boundedText(input.text, "message text", 32_000),
    createdAt: isoDate(input.createdAt, "message createdAt"),
    ...(input.agent === undefined
      ? {}
      : { agent: agentProfileId(input.agent, "agent") }),
  });
}

function parsePendingInteractionDto(value: unknown): ChatPendingInteractionDto {
  const input = record(value, "pending interaction");
  const correlationId = opaqueId(input.correlationId, "correlationId");
  if (input.type === "permission") {
    if (!Array.isArray(input.options) || input.options.length > 8) {
      throw new TypeError("permission options are invalid");
    }
    return Object.freeze({
      type: "permission",
      correlationId,
      title: text(input.title, "permission title", 240),
      detail: text(input.detail, "permission detail", 1_000),
      options: Object.freeze(input.options.map((value) => {
        const option = record(value, "permission option");
        const decision = option.decision;
        if (
          decision !== "allow_once" && decision !== "allow_always" &&
          decision !== "reject_once" && decision !== "reject_always"
        ) {
          throw new TypeError("permission option is invalid");
        }
        return Object.freeze({
          decision,
          label: text(option.label, "permission option label", 120),
        });
      })),
    });
  }
  if (input.type === "elicitation-url") {
    const urlText = text(input.url, "elicitation URL", 4_000);
    const url = new URL(urlText);
    if (
      url.protocol !== "https:" || url.username !== "" || url.password !== ""
    ) {
      throw new TypeError("elicitation URL is invalid");
    }
    return Object.freeze({
      type: "elicitation-url",
      correlationId,
      message: text(input.message, "elicitation message", 2_000),
      url: url.toString(),
    });
  }
  if (
    input.type !== "elicitation-form" || !Array.isArray(input.fields) ||
    input.fields.length > 64
  ) {
    throw new TypeError("elicitation form is invalid");
  }
  return Object.freeze({
    type: "elicitation-form",
    correlationId,
    message: text(input.message, "elicitation message", 2_000),
    ...(optionalText(input.title, "elicitation title", 240) === undefined
      ? {}
      : { title: optionalText(input.title, "elicitation title", 240) }),
    ...(optionalText(input.description, "elicitation description", 1_000) ===
        undefined
      ? {}
      : {
        description: optionalText(
          input.description,
          "elicitation description",
          1_000,
        ),
      }),
    fields: Object.freeze(input.fields.map(parseFormFieldDto)),
  });
}

function parseFormFieldDto(value: unknown): ChatFormFieldDto {
  const input = record(value, "elicitation field");
  const base = {
    name: text(input.name, "field name", 128),
    label: text(input.label, "field label", 160),
    ...(optionalText(input.description, "field description", 600) === undefined ? {} : {
      description: optionalText(input.description, "field description", 600),
    }),
    required: input.required === true,
  };
  if (input.type === "text") {
    const format = input.format;
    if (
      format !== undefined && format !== "email" && format !== "uri" &&
      format !== "date" && format !== "date-time"
    ) {
      throw new TypeError("text field format is invalid");
    }
    return Object.freeze({
      ...base,
      type: "text",
      ...(format === undefined ? {} : { format }),
      ...optionalNonNegativeInteger(input.minLength, "minLength"),
      ...optionalNonNegativeInteger(input.maxLength, "maxLength"),
      ...(input.pattern === undefined
        ? {}
        : { pattern: validateSafeRegexPattern(input.pattern) }),
      ...(typeof input.defaultValue === "string"
        ? { defaultValue: input.defaultValue.slice(0, 8_000) }
        : {}),
    });
  }
  if (input.type === "number" || input.type === "integer") {
    return Object.freeze({
      ...base,
      type: input.type,
      ...optionalFiniteNumber(input.minimum, "minimum"),
      ...optionalFiniteNumber(input.maximum, "maximum"),
      ...optionalFiniteNumber(input.defaultValue, "defaultValue"),
    });
  }
  if (input.type === "boolean") {
    return Object.freeze({
      ...base,
      type: "boolean",
      ...(typeof input.defaultValue === "boolean"
        ? { defaultValue: input.defaultValue }
        : {}),
    });
  }
  if (input.type !== "select" && input.type !== "multiselect") {
    throw new TypeError("elicitation field type is invalid");
  }
  if (!Array.isArray(input.options) || input.options.length > 128) {
    throw new TypeError("elicitation field options are invalid");
  }
  const options = Object.freeze(input.options.map((value) => {
    const option = record(value, "form option");
    return Object.freeze({
      value: text(option.value, "option value", 1_000),
      label: text(option.label, "option label", 160),
      ...(optionalText(option.description, "option description", 600) ===
          undefined
        ? {}
        : {
          description: optionalText(
            option.description,
            "option description",
            600,
          ),
        }),
    });
  }));
  if (input.type === "select") {
    return Object.freeze({
      ...base,
      type: "select",
      options,
      ...(typeof input.defaultValue === "string"
        ? { defaultValue: input.defaultValue.slice(0, 1_000) }
        : {}),
    });
  }
  return Object.freeze({
    ...base,
    type: "multiselect",
    options,
    ...optionalNonNegativeInteger(input.minItems, "minItems"),
    ...optionalNonNegativeInteger(input.maxItems, "maxItems"),
    ...(Array.isArray(input.defaultValue) &&
        input.defaultValue.every((entry) => typeof entry === "string")
      ? { defaultValue: Object.freeze([...input.defaultValue] as string[]) }
      : {}),
  });
}

function optionalNonNegativeInteger(
  value: unknown,
  name: string,
): Record<string, number> {
  if (value === undefined) return {};
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${name} is invalid`);
  }
  return { [name]: value as number };
}

function optionalFiniteNumber(
  value: unknown,
  name: string,
): Record<string, number> {
  if (value === undefined) return {};
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} is invalid`);
  }
  return { [name]: value };
}

function isoDate(value: unknown, name: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${name} must be an ISO date`);
  }
  return value;
}

function protocol(value: unknown): void {
  if (value !== DESKTOP_CHAT_PROTOCOL) {
    throw new TypeError(`protocol must be ${DESKTOP_CHAT_PROTOCOL}`);
  }
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) {
    throw new TypeError(
      `${name} must be non-empty text of at most ${max} characters`,
    );
  }
  return value.trim();
}

function boundedText(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new TypeError(`${name} must contain at most ${max} characters`);
  }
  return value;
}

function optionalText(
  value: unknown,
  name: string,
  max: number,
): string | undefined {
  return value === undefined ? undefined : text(value, name, max);
}

function opaqueId(value: unknown, name: string): string {
  const candidate = text(value, name, 160);
  if (!OPAQUE_ID.test(candidate)) throw new TypeError(`${name} is invalid`);
  return candidate;
}

export function isChatOpaqueId(value: unknown): value is string {
  // Equivalent to opaqueId acceptance: the charset admits no whitespace
  // and requires at least one character, so trim() adds nothing.
  return typeof value === "string" && value.length <= 160 &&
    OPAQUE_ID.test(value);
}

function optionalOpaqueId(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : opaqueId(value, name);
}

function agentProfileId(value: unknown, name: string): string {
  const candidate = text(value, name, 48);
  if (!AGENT_PROFILE_ID.test(candidate)) throw new TypeError(`${name} is invalid`);
  return candidate;
}

const VIEWER_TOOL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const VIEWER_FINGERPRINT = /^sha256:[a-f0-9]{64}$/;
const VIEWER_BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const VIEWER_JSON_MAX_DEPTH = 10;
const VIEWER_JSON_MAX_NODES = 20_000;
const VIEWER_JSON_MAX_STRING = 65_536;
const VIEWER_JSON_MAX_BYTES = 1_048_576;
const VIEWER_DATA_MAX_CHARS = 12_000_000;
const VIEWER_BYTES_MAX = 8_388_608;

function viewerToolName(value: unknown): string {
  if (!isChatViewerToolName(value)) {
    throw new TypeError("viewer tool name is invalid");
  }
  return value;
}

/**
 * Non-throwing renderer-shape predicates. The host filters provider and
 * stored names through these before retaining them, so a hostile tool name
 * can never break whole-snapshot or viewer-session parsing downstream.
 */
export function isChatViewerToolName(value: unknown): value is string {
  return typeof value === "string" && VIEWER_TOOL_NAME.test(value);
}

function viewerUiUri(value: unknown): string {
  if (!isChatViewerUiUri(value)) {
    throw new TypeError("viewer App URI is invalid");
  }
  return value;
}

export function isChatViewerUiUri(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("ui://") &&
    value.length <= 500 && !/\s/.test(value);
}

/**
 * Viewer resource URI: whole-App `ui://` views plus provider-issued
 * `casys://` artifacts scoped to the owning server. Ownership is
 * authorized later against the owning session; this only pins the
 * syntactic shape.
 */
function viewerResourceUri(value: unknown): string {
  if (
    typeof value !== "string" ||
    (!value.startsWith("ui://") && !value.startsWith("casys://")) ||
    value.length > 500 ||
    /\s/.test(value)
  ) {
    throw new TypeError("viewer resource URI is invalid");
  }
  return value;
}

function viewerByteCount(value: unknown, name: string): number {
  if (
    !Number.isSafeInteger(value) || (value as number) < 0 ||
    (value as number) > VIEWER_BYTES_MAX
  ) {
    throw new TypeError(`${name} is invalid`);
  }
  return value as number;
}

const VIEWER_DECLARED_BYTES_MAX = 33_554_432;

/**
 * Provider-declared export sizes (manifest only, never served bytes).
 * Served bytes stay under the IPC and viewer byte caps elsewhere.
 */
function viewerDeclaredBytes(value: unknown, name: string): number {
  if (
    !Number.isSafeInteger(value) || (value as number) < 0 ||
    (value as number) > VIEWER_DECLARED_BYTES_MAX
  ) {
    throw new TypeError(`${name} is invalid`);
  }
  return value as number;
}

function viewerFingerprint(value: unknown): string {
  if (typeof value !== "string" || !VIEWER_FINGERPRINT.test(value)) {
    throw new TypeError("viewer fingerprint is invalid");
  }
  return value;
}

const VIEWER_ARTIFACT_DIGEST = /^[a-f0-9]{64}$/;

function viewerArtifactDigest(value: unknown): string {
  if (typeof value !== "string" || !VIEWER_ARTIFACT_DIGEST.test(value)) {
    throw new TypeError("viewer artifact digest is invalid");
  }
  return value;
}

function viewerFileName(value: unknown): string {
  const name = text(value, "viewer artifact file name", 128);
  if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    throw new TypeError("viewer artifact file name is invalid");
  }
  return name;
}

function viewerBase64(value: unknown, name: string): string {
  if (
    typeof value !== "string" || value.length > VIEWER_DATA_MAX_CHARS ||
    // Length % 4 == 1 can never decode (atob throws InvalidCharacterError).
    value.length % 4 === 1 ||
    !VIEWER_BASE64.test(value)
  ) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

/** Bounded tool-argument record shared by viewer commands and result capture. */
export function parseChatViewerArguments(
  value: unknown,
): Readonly<Record<string, ChatViewerJson>> {
  return viewerArguments(value);
}

/** Bounded JSON value shared by viewer responses and result capture. */
export function parseChatViewerJson(value: unknown): ChatViewerJson {
  return viewerJson(value, "viewer JSON");
}

function viewerArguments(
  value: unknown,
): Readonly<Record<string, ChatViewerJson>> {
  const parsed = viewerJson(
    record(value, "viewer arguments"),
    "viewer arguments",
  );
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("viewer arguments must be an object");
  }
  return parsed as Readonly<Record<string, ChatViewerJson>>;
}

function viewerJson(value: unknown, name: string): ChatViewerJson {
  const budget = { nodes: 0 };
  const parsed = viewerJsonNode(value, name, 0, budget);
  if (JSON.stringify(parsed).length > VIEWER_JSON_MAX_BYTES) {
    throw new TypeError(`${name} is too large`);
  }
  return parsed;
}

function viewerJsonNode(
  value: unknown,
  name: string,
  depth: number,
  budget: { nodes: number },
): ChatViewerJson {
  if (depth > VIEWER_JSON_MAX_DEPTH) throw new TypeError(`${name} is too deep`);
  budget.nodes += 1;
  if (budget.nodes > VIEWER_JSON_MAX_NODES) {
    throw new TypeError(`${name} has too many nodes`);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${name} is invalid`);
    return value;
  }
  if (typeof value === "string") {
    if (value.length > VIEWER_JSON_MAX_STRING) {
      throw new TypeError(`${name} contains an oversized string`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 1_000) throw new TypeError(`${name} array is too long`);
    return Object.freeze(
      value.map((entry) => viewerJsonNode(entry, name, depth + 1, budget)),
    );
  }
  if (typeof value !== "object") throw new TypeError(`${name} is invalid`);
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 500) throw new TypeError(`${name} object is too large`);
  const output: Record<string, ChatViewerJson> = {};
  for (const [key, entry] of entries) {
    if (key.length === 0 || key.length > 256) {
      throw new TypeError(`${name} contains an invalid key`);
    }
    output[key] = viewerJsonNode(entry, name, depth + 1, budget);
  }
  return Object.freeze(output);
}

function elicitationContent(
  value: unknown,
): Readonly<Record<string, string | number | boolean | string[]>> {
  const input = record(value, "elicitation content");
  const output: Record<string, string | number | boolean | string[]> = {};
  for (const [key, entry] of Object.entries(input)) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(key)) {
      throw new TypeError("elicitation content contains an invalid field name");
    }
    if (typeof entry === "string") {
      if (entry.length > 8_000) {
        throw new TypeError("elicitation text is too long");
      }
      output[key] = entry;
    } else if (typeof entry === "number" && Number.isFinite(entry)) {
      output[key] = entry;
    } else if (typeof entry === "boolean") {
      output[key] = entry;
    } else if (
      Array.isArray(entry) && entry.length <= 128 &&
      entry.every((item) => typeof item === "string" && item.length <= 1_000)
    ) {
      output[key] = [...entry] as string[];
    } else {
      throw new TypeError("elicitation content contains an unsupported value");
    }
  }
  return Object.freeze(output);
}
