import type {
  ChatCanvasLayoutDto,
  ChatConversationStatus,
  ChatMessageDto,
  ChatViewerJson,
} from "../../../src/presentation/desktop/chat/contracts.ts";

/** Retained export file: manifest entry plus its sidecar-byte state. */
export interface StoredWorkArtifact {
  readonly uri: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly state: "saved" | "missing";
  readonly reason?: string;
  readonly savedAt?: string;
}

export interface StoredToolResult {
  /** Stable capture identity; absent on legacy entries, where toolCallId is used. */
  readonly viewerId?: string;
  readonly toolCallId: string;
  /** Exact agent session that produced this result; absent on legacy entries. */
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
  /** Per-conversation result revision, 1-based; absent before saving existed. */
  readonly revision?: number;
  /** `sha256:<hex>` over the canonical exact result JSON. */
  readonly resultDigest?: string;
  /** Retained export bytes; absent when nothing was archived. */
  readonly artifacts?: readonly StoredWorkArtifact[];
}

export interface StoredConversation {
  readonly id: string;
  /**
   * Absent on entries written before standalone chat existed; readers
   * treat a missing kind with a projectId as a project conversation.
   */
  readonly kind?: "project" | "standalone";
  readonly projectId?: string;
  /** Standalone chat's shared whiteboard membership, never engineering authority. */
  readonly workspaceProjectId?: string;
  /**
   * Active agent profile. Absent on entries written before profiles
   * existed; readers treat a missing id as the legacy Codex profile.
   */
  readonly agentProfileId?: string;
  /** Active standalone MCP attachment, if any. */
  readonly mcpId?: string;
  readonly mcpStatus?: "connected" | "failed";
  readonly mcpTools?: readonly string[];
  /**
   * Per agent-session-key transcript message ids that session already holds.
   * Absent on entries written before context seeding existed; readers treat
   * a missing map as "no session holds anything yet".
   */
  readonly knownMessageIdsByKey?: Record<string, readonly string[]>;
  /** Exact MCP tool results retained for live viewer Apps, newest last. */
  readonly toolResults?: readonly StoredToolResult[];
  /**
   * Session Canvas presentation layout (#55). Absent before Canvas
   * existed; readers treat a missing or invalid layout as empty.
   */
  readonly canvasLayout?: ChatCanvasLayoutDto;
  readonly sessionKey: string;
  readonly title: string;
  readonly status: ChatConversationStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages: readonly ChatMessageDto[];
}
