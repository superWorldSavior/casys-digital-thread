/**
 * Pure chat-store codec shared by the Deno file store and the packaged
 * Node store (#51). No Deno or Node APIs here: both runtimes validate
 * identical bytes, so a standalone conversation saved by one loads in the
 * other with kind, MCP attachment, tool results, and work archive intact.
 */
import type {
  StoredConversation,
  StoredToolResult,
  StoredWorkArtifact,
} from "./store.ts";
import {
  type ChatCanvasLayoutDto,
  type ChatMessageDto,
  parseChatCanvasLayout,
  parseChatViewerArguments,
  parseChatViewerJson,
} from "../../../src/presentation/desktop/chat/contracts.ts";

export const CHAT_STORE_SCHEMA = "casys-desktop-chat-store/1.0" as const;
export const CHAT_TRANSCRIPT_SCHEMA = "casys-desktop-chat-transcript/1.0" as const;
export const CONVERSATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
export const ARTIFACT_SHA_PATTERN = /^[a-f0-9]{64}$/;
export const ARTIFACT_FILE_SUFFIX = ".bin" as const;

/** Store-level MCP tool budget: tamper guard, not the renderer contract. */
export const STORE_MCP_TOOLS_MAX = 256;

export function isArtifactSha(value: unknown): value is string {
  return typeof value === "string" && ARTIFACT_SHA_PATTERN.test(value);
}

export function artifactFileName(sha256: string): string {
  if (!isArtifactSha(sha256)) throw new TypeError("artifact digest is invalid");
  return `${sha256}${ARTIFACT_FILE_SUFFIX}`;
}

/** Digests referenced by retained conversations; everything else prunes. */
export function referencedArtifactDigests(
  conversations: readonly StoredConversation[],
): ReadonlySet<string> {
  const digests = new Set<string>();
  for (const conversation of conversations) {
    for (const result of conversation.toolResults ?? []) {
      for (const artifact of result.artifacts ?? []) {
        if (artifact.state === "saved" && isArtifactSha(artifact.sha256)) {
          digests.add(artifact.sha256);
        }
      }
    }
  }
  return digests;
}

export function readConversationIndex(value: unknown): {
  readonly schemaVersion: typeof CHAT_STORE_SCHEMA;
  readonly conversations: readonly Omit<StoredConversation, "messages">[];
} {
  const record = object(value, "chat index");
  if (
    record.schemaVersion !== CHAT_STORE_SCHEMA ||
    !Array.isArray(record.conversations)
  ) {
    throw new TypeError("chat index has an unsupported schema");
  }
  return {
    schemaVersion: CHAT_STORE_SCHEMA,
    conversations: record.conversations.map(readConversationMetadata),
  };
}

export function readTranscriptData(
  value: unknown,
  id: string,
): {
  readonly schemaVersion: typeof CHAT_TRANSCRIPT_SCHEMA;
  readonly conversationId: string;
  readonly messages: readonly ChatMessageDto[];
} {
  const record = object(value, "chat transcript");
  if (
    record.schemaVersion !== CHAT_TRANSCRIPT_SCHEMA ||
    record.conversationId !== id || !Array.isArray(record.messages)
  ) {
    throw new TypeError("chat transcript has an unsupported schema");
  }
  return {
    schemaVersion: CHAT_TRANSCRIPT_SCHEMA,
    conversationId: id,
    messages: record.messages.map(readChatMessage),
  };
}

export function readConversationMetadata(
  value: unknown,
): Omit<StoredConversation, "messages"> {
  const entry = object(value, "conversation metadata");
  const status = entry.status;
  if (
    status !== "idle" && status !== "queued" && status !== "running" &&
    status !== "failed" && status !== "closed"
  ) throw new TypeError("conversation status is invalid");
  const kind = entry.kind;
  if (kind !== undefined && kind !== "project" && kind !== "standalone") {
    throw new TypeError("conversation kind is invalid");
  }
  const projectId = entry.projectId === undefined
    ? undefined
    : requiredString(entry.projectId, "project id");
  const mcpId = entry.mcpId === undefined
    ? undefined
    : requiredString(entry.mcpId, "conversation MCP id");
  const agentProfileId = entry.agentProfileId === undefined
    ? undefined
    : profileId(entry.agentProfileId, "conversation agent profile id");
  const mcpStatus = entry.mcpStatus;
  if (mcpStatus !== undefined && mcpStatus !== "connected" && mcpStatus !== "failed") {
    throw new TypeError("conversation MCP status is invalid");
  }
  const mcpTools = entry.mcpTools === undefined ? undefined : readStringList(
    entry.mcpTools,
    "conversation MCP tools",
    STORE_MCP_TOOLS_MAX,
    128,
  );
  const knownMessageIdsByKey = entry.knownMessageIdsByKey === undefined
    ? undefined
    : readKnownByKey(entry.knownMessageIdsByKey);
  const toolResults = entry.toolResults === undefined
    ? undefined
    : readToolResults(entry.toolResults);
  const canvasLayout = readCanvasLayout(entry.canvasLayout);
  return {
    id: requiredString(entry.id, "conversation id"),
    ...(kind === undefined ? {} : { kind }),
    ...(projectId === undefined ? {} : { projectId }),
    ...(mcpId === undefined ? {} : { mcpId }),
    ...(agentProfileId === undefined ? {} : { agentProfileId }),
    ...(mcpStatus === undefined ? {} : { mcpStatus }),
    ...(mcpTools === undefined ? {} : { mcpTools }),
    ...(knownMessageIdsByKey === undefined ? {} : { knownMessageIdsByKey }),
    ...(toolResults === undefined ? {} : { toolResults }),
    ...(canvasLayout === undefined ? {} : { canvasLayout }),
    sessionKey: requiredString(entry.sessionKey, "session key"),
    title: requiredString(entry.title, "conversation title"),
    status,
    createdAt: requiredDate(entry.createdAt, "createdAt"),
    updatedAt: requiredDate(entry.updatedAt, "updatedAt"),
  };
}

/**
 * Presentation layout (#55): absent before Canvas existed, and a corrupt
 * entry degrades to absent instead of rejecting the conversation.
 */
function readCanvasLayout(value: unknown): ChatCanvasLayoutDto | undefined {
  if (value === undefined) return undefined;
  try {
    return parseChatCanvasLayout(value);
  } catch {
    return undefined;
  }
}

export function readChatMessage(value: unknown): ChatMessageDto {
  const message = object(value, "chat message");
  const role = message.role;
  const kind = message.kind;
  if (role !== "user" && role !== "assistant" && role !== "system") {
    throw new TypeError("chat message role is invalid");
  }
  if (
    kind !== "text" && kind !== "thought" && kind !== "tool" &&
    kind !== "status" && kind !== "error"
  ) {
    throw new TypeError("chat message kind is invalid");
  }
  const agent = message.agent === undefined
    ? undefined
    : profileId(message.agent, "message agent");
  return Object.freeze({
    id: requiredString(message.id, "message id"),
    role,
    kind,
    text: requiredString(message.text, "message text"),
    createdAt: requiredDate(message.createdAt, "message createdAt"),
    ...(agent === undefined ? {} : { agent }),
  });
}

/** Same rule as the chat contract's agent profile id; absent stays absent. */
const PROFILE_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

function profileId(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length > 48 || !PROFILE_ID.test(value)) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value === "") {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

function requiredDate(value: unknown, name: string): string {
  const text = requiredString(value, name);
  if (!Number.isFinite(Date.parse(text))) throw new TypeError(`${name} is invalid`);
  return text;
}

function readStringList(
  value: unknown,
  name: string,
  maxItems: number,
  maxLength: number,
): readonly string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new TypeError(`${name} is invalid`);
  }
  return Object.freeze(value.map((entry) => {
    if (typeof entry !== "string" || entry === "" || entry.length > maxLength) {
      throw new TypeError(`${name} is invalid`);
    }
    return entry;
  }));
}

function readKnownByKey(value: unknown): Record<string, readonly string[]> {
  const record = object(value, "known message ids by key");
  const entries = Object.entries(record);
  if (entries.length > 16) throw new TypeError("known message ids by key is invalid");
  const parsed: Record<string, readonly string[]> = {};
  for (const [key, ids] of entries) {
    if (key === "" || key.length > 200) {
      throw new TypeError("known message ids by key is invalid");
    }
    parsed[key] = readStringList(ids, "known message ids", 400, 128);
  }
  return Object.freeze(parsed);
}

function readToolResults(value: unknown): readonly StoredToolResult[] {
  if (!Array.isArray(value) || value.length > 20) {
    throw new TypeError("tool results are invalid");
  }
  return Object.freeze(value.map((entry) => {
    const candidate = object(entry, "tool result");
    const toolCallId = requiredString(candidate.toolCallId, "tool result id");
    const server = requiredString(candidate.server, "tool result server");
    const tool = requiredString(candidate.tool, "tool result tool");
    const messageId = requiredString(candidate.messageId, "tool result message");
    const appUri = requiredString(candidate.appUri, "tool result App URI");
    if (
      toolCallId.length > 160 || server.length > 160 || tool.length > 128 ||
      messageId.length > 160 || !appUri.startsWith("ui://") || appUri.length > 500
    ) {
      throw new TypeError("tool result is invalid");
    }
    if (typeof candidate.failed !== "boolean") {
      throw new TypeError("tool result is invalid");
    }
    let archive: ReturnType<typeof readWorkArchive>;
    try {
      archive = readWorkArchive(candidate);
    } catch {
      // An invalid archive degrades to unsaved: the viewer survives on
      // its core fields while the bad manifest — never its paths — is
      // dropped, so one tampered entry cannot brick the durable store.
      archive = {};
    }
    return Object.freeze({
      toolCallId,
      server,
      tool,
      messageId,
      appUri,
      failed: candidate.failed,
      input: parseChatViewerArguments(candidate.input ?? {}),
      result: parseChatViewerJson(candidate.result),
      capturedAt: requiredDate(candidate.capturedAt, "tool result capturedAt"),
      ...archive,
    });
  }));
}

function readWorkArchive(candidate: Record<string, unknown>): {
  readonly revision?: number;
  readonly resultDigest?: string;
  readonly artifacts?: readonly StoredWorkArtifact[];
} {
  const revision = candidate.revision === undefined
    ? undefined
    : readRevision(candidate.revision);
  const resultDigest = candidate.resultDigest === undefined
    ? undefined
    : readResultDigest(candidate.resultDigest);
  const artifacts = candidate.artifacts === undefined
    ? undefined
    : readWorkArtifacts(candidate.artifacts);
  return {
    ...(revision === undefined ? {} : { revision }),
    ...(resultDigest === undefined ? {} : { resultDigest }),
    ...(artifacts === undefined ? {} : { artifacts }),
  };
}

function readRevision(value: unknown): number {
  if (
    !Number.isSafeInteger(value) || (value as number) < 1 ||
    (value as number) > 1_000_000
  ) {
    throw new TypeError("tool result revision is invalid");
  }
  return value as number;
}

function readResultDigest(value: unknown): string {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new TypeError("tool result digest is invalid");
  }
  return value;
}

function readWorkArtifacts(value: unknown): readonly StoredWorkArtifact[] {
  if (!Array.isArray(value) || value.length > 8) {
    throw new TypeError("tool result artifacts are invalid");
  }
  return Object.freeze(value.map((entry) => {
    const candidate = object(entry, "tool result artifact");
    const uri = requiredString(candidate.uri, "artifact URI");
    if (
      (!uri.startsWith("ui://") && !uri.startsWith("casys://")) || uri.length > 500
    ) {
      throw new TypeError("artifact URI is invalid");
    }
    const fileName = requiredString(candidate.fileName, "artifact file name");
    if (
      fileName.length > 128 || fileName.includes("/") || fileName.includes("\\")
    ) {
      throw new TypeError("artifact file name is invalid");
    }
    const mimeType = requiredString(candidate.mimeType, "artifact media type");
    if (mimeType.length > 200) {
      throw new TypeError("artifact media type is invalid");
    }
    const bytes = candidate.bytes;
    if (
      !Number.isSafeInteger(bytes) || (bytes as number) < 0 ||
      (bytes as number) > 33_554_432
    ) {
      throw new TypeError("artifact bytes are invalid");
    }
    const sha256 = requiredString(candidate.sha256, "artifact digest");
    if (!isArtifactSha(sha256)) {
      throw new TypeError("artifact digest is invalid");
    }
    const state = candidate.state;
    if (state !== "saved" && state !== "missing") {
      throw new TypeError("artifact state is invalid");
    }
    const reason = candidate.reason === undefined
      ? undefined
      : requiredString(candidate.reason, "artifact reason");
    if (reason !== undefined && reason.length > 200) {
      throw new TypeError("artifact reason is invalid");
    }
    const savedAt = candidate.savedAt === undefined
      ? undefined
      : requiredDate(candidate.savedAt, "artifact savedAt");
    return Object.freeze({
      uri,
      fileName,
      mimeType,
      bytes: bytes as number,
      sha256,
      state,
      ...(reason === undefined ? {} : { reason }),
      ...(savedAt === undefined ? {} : { savedAt }),
    });
  }));
}
