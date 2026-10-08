import {
  type ChatCommandResponse,
  type ChatConversationDto,
  type ChatSaveFileResponse,
  type ChatSnapshotDto,
  type ChatViewerAppFetchResponse,
  DESKTOP_CHAT_PROTOCOL,
  parseChatCommandRequest,
  parseChatSaveFileRequest,
  parseChatSnapshotRequest,
  parseChatViewerAppFetchRequest,
  parseDesktopChatBindingCommandRequest,
} from "../../../src/presentation/desktop/chat/contracts.ts";
import { DEFAULT_AGENT_PROFILE_ID } from "./agent-profiles.ts";
import type { ExternalUrlOpener } from "./external-url.ts";
import { decodeSaveFileBytes, type DesktopChatFileSaver } from "./file-saver.ts";
import { type ChatViewerBackend, encodeViewerBytes } from "./viewer-backend.ts";

export const CHAT_SNAPSHOT_BINDING = "casysChatSnapshot" as const;
export const CHAT_COMMAND_BINDING = "casysChatCommand" as const;
export const CHAT_VIEWER_APP_BINDING = "casysChatViewerApp" as const;
export const CHAT_SAVE_FILE_BINDING = "casysChatSaveFile" as const;

export interface DesktopChatBindingHost {
  snapshot(
    input: ReturnType<typeof parseChatSnapshotRequest>,
  ): Promise<ChatSnapshotDto>;
  command(
    input: ReturnType<typeof parseChatCommandRequest>,
  ): Promise<ChatCommandResponse>;
}

export interface BrowserWindowBindingPort {
  bind(name: string, handler: (input: unknown) => unknown): void;
}

export interface DesktopChatProjectFocusAuthority {
  /** Current durable Workbench project, or undefined on any unavailable state. */
  currentProjectId(): Promise<string | undefined>;
}

export function registerDesktopChatBindings(
  window: BrowserWindowBindingPort,
  host?: DesktopChatBindingHost,
  externalUrl?: ExternalUrlOpener,
  projectFocus?: DesktopChatProjectFocusAuthority,
  viewerApp?: ChatViewerBackend,
  fileSaver?: DesktopChatFileSaver,
): void {
  // Presentation scope per chat; undefined marks an unattached standalone chat.
  const conversationProjects = new Map<string, string | undefined>();
  window.bind(CHAT_SNAPSHOT_BINDING, async (value: unknown) => {
    const input = parseChatSnapshotRequest(value);
    if (host === undefined) {
      return Object.freeze({
        protocol: DESKTOP_CHAT_PROTOCOL,
        host: "unavailable",
        conversations: Object.freeze([]),
        connectableMcps: Object.freeze([]),
        error: "The packaged Chat Host is unavailable.",
        agentProfiles: Object.freeze([]),
        defaultAgentProfileId: DEFAULT_AGENT_PROFILE_ID,
      }) satisfies ChatSnapshotDto;
    }
    return await focusedSnapshot(
      input,
      host,
      projectFocus,
      conversationProjects,
    );
  });
  window.bind(CHAT_COMMAND_BINDING, async (value: unknown) => {
    const input = parseDesktopChatBindingCommandRequest(value);
    if (input.command === "external.open") {
      if (externalUrl === undefined) {
        return Object.freeze({
          protocol: DESKTOP_CHAT_PROTOCOL,
          requestId: input.requestId,
          ok: false,
          error: "The external browser capability is unavailable for this target.",
        }) satisfies ChatCommandResponse;
      }
      await externalUrl.open(input.url);
      return Object.freeze({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: input.requestId,
        ok: true,
      }) satisfies ChatCommandResponse;
    }
    if (host === undefined) {
      return Object.freeze({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: input.requestId,
        ok: false,
        error: "The packaged Chat Host is unavailable.",
      }) satisfies ChatCommandResponse;
    }
    const authorizationError = await authorizeProjectCommand(
      input,
      host,
      projectFocus,
    );
    if (authorizationError !== undefined) {
      return Object.freeze({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: input.requestId,
        ok: false,
        error: authorizationError,
      }) satisfies ChatCommandResponse;
    }
    const response = await host.command(input);
    if (
      input.command === "conversation.create" && response.ok &&
      response.conversationId !== undefined
    ) {
      conversationProjects.set(
        response.conversationId,
        input.projectId ?? input.workspaceProjectId,
      );
    }
    if (input.command === "conversation.attach-project" && response.ok) {
      conversationProjects.set(input.conversationId, input.workspaceProjectId);
    }
    return response;
  });
  window.bind(CHAT_VIEWER_APP_BINDING, async (value: unknown) => {
    let input: ReturnType<typeof parseChatViewerAppFetchRequest>;
    try {
      input = parseChatViewerAppFetchRequest(value);
    } catch {
      return Object.freeze({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: "invalid",
        ok: false,
        error: "Viewer App fetch request is invalid.",
      }) satisfies ChatViewerAppFetchResponse;
    }
    if (viewerApp === undefined) {
      return Object.freeze({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: input.requestId,
        ok: false,
        error: "Live viewer Apps are unavailable on this Desktop target.",
      }) satisfies ChatViewerAppFetchResponse;
    }
    try {
      const app = await viewerApp.resolveApp(input.server, input.uri);
      if (app.fingerprint !== input.fingerprint) {
        return Object.freeze({
          protocol: DESKTOP_CHAT_PROTOCOL,
          requestId: input.requestId,
          ok: false,
          error: "Viewer App bytes no longer match the pinned fingerprint.",
        }) satisfies ChatViewerAppFetchResponse;
      }
      return Object.freeze({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: input.requestId,
        ok: true,
        app: Object.freeze({
          uri: app.uri,
          mimeType: app.mimeType,
          bytes: app.bytes.byteLength,
          fingerprint: app.fingerprint,
          encoding: "base64",
          data: encodeViewerBytes(app.bytes),
        }),
      }) satisfies ChatViewerAppFetchResponse;
    } catch (error) {
      return Object.freeze({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: input.requestId,
        ok: false,
        error: error instanceof Error ? error.message : "Viewer App fetch failed.",
      }) satisfies ChatViewerAppFetchResponse;
    }
  });
  window.bind(CHAT_SAVE_FILE_BINDING, async (value: unknown) => {
    let input: ReturnType<typeof parseChatSaveFileRequest>;
    try {
      input = parseChatSaveFileRequest(value);
    } catch {
      return Object.freeze({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: "invalid",
        ok: false,
        error: "File export request is invalid.",
      }) satisfies ChatSaveFileResponse;
    }
    if (fileSaver === undefined) {
      return Object.freeze({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: input.requestId,
        ok: false,
        error: "File export is unavailable on this Desktop target.",
      }) satisfies ChatSaveFileResponse;
    }
    let bytes: Uint8Array;
    try {
      bytes = decodeSaveFileBytes(input.data);
    } catch {
      return Object.freeze({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: input.requestId,
        ok: false,
        error: "File export data is invalid.",
      }) satisfies ChatSaveFileResponse;
    }
    try {
      const saved = await fileSaver.saveFile(input.fileName, bytes);
      return Object.freeze({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: input.requestId,
        ok: true,
        path: saved.path,
        bytes: saved.bytes,
      }) satisfies ChatSaveFileResponse;
    } catch (error) {
      return Object.freeze({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: input.requestId,
        ok: false,
        error: error instanceof Error ? error.message : "File export failed.",
      }) satisfies ChatSaveFileResponse;
    }
  });
}

async function focusedSnapshot(
  input: ReturnType<typeof parseChatSnapshotRequest>,
  host: DesktopChatBindingHost,
  projectFocus: DesktopChatProjectFocusAuthority | undefined,
  conversationProjects: Map<string, string | undefined>,
): Promise<ChatSnapshotDto> {
  const focusedProjectId = await readCurrentProjectFocus(projectFocus);
  if (
    input.conversationId !== undefined &&
    !(await conversationVisibleFromBinding(
      input.conversationId,
      focusedProjectId,
      host,
      conversationProjects,
    ))
  ) {
    return emptyFocusedSnapshot(
      "ready",
      "The requested conversation is unavailable for the current Workbench project focus.",
    );
  }

  let snapshot: ChatSnapshotDto;
  try {
    snapshot = await host.snapshot(input);
  } catch {
    return emptyFocusedSnapshot(
      "unavailable",
      "The packaged Chat Host snapshot is unavailable.",
    );
  }
  if (await readCurrentProjectFocus(projectFocus) !== focusedProjectId) {
    return emptyFocusedSnapshot(
      snapshot.host,
      "Workbench project focus changed while the Chat snapshot was loading.",
    );
  }

  if (input.conversationId === undefined) {
    conversationProjects.clear();
    for (const conversation of snapshot.conversations) {
      conversationProjects.set(conversation.id, conversationProjectScope(conversation));
    }
  }
  // Unattached standalone chats remain global. Both project membership types
  // stay confined to the current focus without changing runtime authority.
  const selected = input.conversationId ?? snapshot.selectedConversationId;
  const conversations = Object.freeze(
    snapshot.conversations.filter((conversation) =>
      conversationVisibleAtFocus(conversation, focusedProjectId)
    ).map((conversation) =>
      conversation.id === selected ? conversation : Object.freeze({
        ...conversation,
        messages: Object.freeze([]),
        viewers: Object.freeze([]),
      })
    ),
  );
  const owners = new Map(
    snapshot.conversations.map((conversation) => [conversation.id, conversation]),
  );
  const projectViewers = snapshot.projectViewers === undefined
    ? undefined
    : Object.freeze(snapshot.projectViewers.filter((entry) => {
      const owner = owners.get(entry.owningConversationId);
      return focusedProjectId !== undefined &&
        entry.workspaceProjectId === focusedProjectId &&
        owner?.kind === "standalone" && owner.workspaceProjectId === focusedProjectId;
    }));
  const selectedConversationId = selected !== undefined &&
      conversations.some((conversation) => conversation.id === selected)
    ? selected
    : undefined;
  return Object.freeze({
    protocol: DESKTOP_CHAT_PROTOCOL,
    host: snapshot.host,
    conversations,
    ...(projectViewers === undefined ? {} : { projectViewers }),
    ...(snapshot.retention === undefined ? {} : { retention: snapshot.retention }),
    connectableMcps: snapshot.connectableMcps,
    ...(selectedConversationId === undefined ? {} : { selectedConversationId }),
    ...(snapshot.error === undefined ? {} : { error: snapshot.error }),
    agentProfiles: snapshot.agentProfiles,
    defaultAgentProfileId: snapshot.defaultAgentProfileId,
  });
}

/**
 * Decides whether one conversation id may be selected through the binding.
 * Unattached standalone chats pass; project members must match the focus.
 * Unknown ids are verified against the host so a first call cannot peek
 * across the project focus.
 */
async function conversationVisibleFromBinding(
  conversationId: string,
  focusedProjectId: string | undefined,
  host: DesktopChatBindingHost,
  conversationProjects: Map<string, string | undefined>,
): Promise<boolean> {
  if (conversationProjects.has(conversationId)) {
    const owner = conversationProjects.get(conversationId);
    return owner === undefined || owner === focusedProjectId;
  }
  let snapshot: ChatSnapshotDto;
  try {
    snapshot = await host.snapshot({
      protocol: DESKTOP_CHAT_PROTOCOL,
      conversationId,
    });
  } catch {
    return false;
  }
  const conversation = snapshot.conversations.find((candidate) =>
    candidate.id === conversationId
  );
  if (conversation === undefined) return false;
  conversationProjects.set(conversationId, conversationProjectScope(conversation));
  return conversationVisibleAtFocus(conversation, focusedProjectId);
}

function conversationProjectScope(
  conversation: ChatConversationDto,
): string | undefined {
  return conversation.kind === "project"
    ? conversation.projectId
    : conversation.workspaceProjectId;
}

function conversationVisibleAtFocus(
  conversation: ChatConversationDto,
  focusedProjectId: string | undefined,
): boolean {
  const scope = conversationProjectScope(conversation);
  return scope === undefined || scope === focusedProjectId;
}

async function readCurrentProjectFocus(
  projectFocus?: DesktopChatProjectFocusAuthority,
): Promise<string | undefined> {
  if (projectFocus === undefined) return undefined;
  try {
    return await projectFocus.currentProjectId();
  } catch {
    return undefined;
  }
}

function emptyFocusedSnapshot(
  host: ChatSnapshotDto["host"],
  error: string,
): ChatSnapshotDto {
  return Object.freeze({
    protocol: DESKTOP_CHAT_PROTOCOL,
    host,
    conversations: Object.freeze([]),
    connectableMcps: Object.freeze([]),
    error,
    agentProfiles: Object.freeze([]),
    defaultAgentProfileId: DEFAULT_AGENT_PROFILE_ID,
  });
}

async function authorizeProjectCommand(
  input: ReturnType<typeof parseChatCommandRequest>,
  host: DesktopChatBindingHost,
  projectFocus?: DesktopChatProjectFocusAuthority,
): Promise<string | undefined> {
  // Standalone creation carries no project and needs no focus.
  if (
    input.command === "conversation.create" && input.projectId === undefined &&
    input.workspaceProjectId === undefined
  ) {
    return undefined;
  }
  // Agent registry commands carry no conversation and need no focus.
  if (
    input.command === "agent.set-default" || input.command === "agent.reload-profiles"
  ) {
    return undefined;
  }
  if (input.command !== "conversation.create") {
    // Look the conversation up before requiring a focus: standalone
    // conversations accept every command without one.
    let snapshot: ChatSnapshotDto;
    try {
      snapshot = await host.snapshot({
        protocol: DESKTOP_CHAT_PROTOCOL,
        conversationId: input.conversationId,
      });
    } catch {
      return unavailableFocus();
    }
    const conversation = snapshot.conversations.find((candidate) =>
      candidate.id === input.conversationId
    );
    if (conversation === undefined) return focusMismatch();
    if (input.command === "conversation.attach-project") {
      if (conversation.kind !== "standalone") {
        return "Whiteboard membership requires a standalone conversation.";
      }
      if (
        conversation.workspaceProjectId !== undefined &&
        conversation.workspaceProjectId !== input.workspaceProjectId
      ) {
        return focusMismatch();
      }
      return await authorizeProjectConversation(input.workspaceProjectId, projectFocus);
    }
    if (
      conversation.kind === "standalone" &&
      conversation.workspaceProjectId === undefined
    ) return undefined;
    return await authorizeProjectConversation(
      conversationProjectScope(conversation),
      projectFocus,
    );
  }
  return await authorizeProjectConversation(
    input.projectId ?? input.workspaceProjectId,
    projectFocus,
  );
}

async function authorizeProjectConversation(
  commandProjectId: string | undefined,
  projectFocus?: DesktopChatProjectFocusAuthority,
): Promise<string | undefined> {
  if (projectFocus === undefined) return unavailableFocus();
  const focusedProjectId = await readCurrentProjectFocus(projectFocus);
  if (focusedProjectId === undefined) return unavailableFocus();
  if (commandProjectId !== focusedProjectId) return focusMismatch();
  try {
    if (await projectFocus.currentProjectId() !== commandProjectId) {
      return focusMismatch();
    }
  } catch {
    return unavailableFocus();
  }
  return undefined;
}

function unavailableFocus(): string {
  return "Chat commands require an available Workbench project focus.";
}

function focusMismatch(): string {
  return "Chat command project does not match the current Workbench project focus.";
}
