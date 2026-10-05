import { Dialog as ArkDialog } from "@ark-ui/react/dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, JSX } from "react";
import { Badge, type BadgeProps } from "../ui/badge.tsx";
import { Button, buttonVariants } from "../ui/button.tsx";
import { cn } from "../lib/utils.ts";
import { Notice } from "../ui/notice.tsx";
import {
  type ChatAgentProfileDto,
  type ChatCommandResponse,
  type ChatConnectableMcpDto,
  type ChatConversationDto,
  type ChatFormFieldDto,
  type ChatPendingInteractionDto,
  type ChatRetentionDto,
  type ChatSaveFileResponse,
  type ChatSnapshotDto,
  type ChatViewerAppBytesDto,
  type ChatViewerAppFetchResponse,
  type ChatViewerJson,
  type ChatViewerResourceDto,
  type ChatViewerSessionDto,
  DESKTOP_CHAT_PROTOCOL,
  type DesktopChatBindingCommandRequest,
  parseChatCommandResponse,
  parseChatSaveFileResponse,
  parseChatSnapshotDto,
  parseChatViewerAppFetchResponse,
  parseChatViewerArguments,
} from "../../../presentation/desktop/chat/contracts.ts";
import { type ChatViewerDispatch, ChatViewerPanel } from "./chat-viewer-panel.tsx";
import { ChatSessionWorkList } from "./chat-session-work.tsx";
import {
  type CatalogueCommandResponse,
  type CatalogueEntryDto,
  type CatalogueSnapshotDto,
  DESKTOP_CATALOGUE_PROTOCOL,
  parseCatalogueCommandResponse,
  parseCatalogueSnapshotDto,
} from "../../../presentation/desktop/catalogue/contracts.ts";

interface DesktopBindings {
  casysChatSnapshot(input: {
    readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
    readonly conversationId?: string;
  }): Promise<ChatSnapshotDto>;
  casysChatCommand(
    input: DesktopChatBindingCommandRequest,
  ): Promise<ChatCommandResponse>;
  casysChatViewerApp(input: {
    readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
    readonly requestId: string;
    readonly server: string;
    readonly uri: string;
    readonly fingerprint: string;
  }): Promise<ChatViewerAppFetchResponse>;
  casysChatSaveFile(input: {
    readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
    readonly requestId: string;
    readonly fileName: string;
    readonly data: string;
  }): Promise<ChatSaveFileResponse>;
  casysCatalogueSnapshot(input: {
    readonly protocol: typeof DESKTOP_CATALOGUE_PROTOCOL;
  }): Promise<CatalogueSnapshotDto>;
  casysCatalogueCommand(input: {
    readonly protocol: typeof DESKTOP_CATALOGUE_PROTOCOL;
    readonly requestId: string;
    readonly command: string;
    readonly entryId?: string;
    readonly ids?: readonly string[];
  }): Promise<CatalogueCommandResponse>;
}

declare global {
  // Deno Desktop injects this Proxy only inside its webview realm.
  // Browser previews intentionally have no simulated binding.
  var bindings: DesktopBindings | undefined;
}

export function DesktopChat(
  { projectId, open, onOpenChange }: {
    readonly projectId?: string;
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
  },
): JSX.Element {
  const bindings = desktopBindings();
  const nativeChatAvailable = bindings !== undefined;
  const fallbackCompactModal = useMediaQuery("(max-width: 899px)");
  const smallProjectModal = useMediaQuery("(max-width: 767px)");
  const wideDesktop = useMediaQuery("(min-width: 1200px)");
  const fixedPanelAvailable = typeof projectId === "string" &&
    projectId.length > 0;
  const fixedProjectPanel = fixedPanelAvailable && wideDesktop;
  const compactModal = fixedPanelAvailable ? smallProjectModal : fallbackCompactModal;
  const projectSheet = fixedPanelAvailable && !wideDesktop && !compactModal;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const previousPresentationRef = useRef({ open, compactModal });
  const [snapshot, setSnapshot] = useState<ChatSnapshotDto>();
  const [selectedId, setSelectedId] = useState<string | null>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [showCatalogue, setShowCatalogue] = useState(false);
  const nativeCatalogueAvailable = bindings !== undefined &&
    typeof bindings.casysCatalogueSnapshot === "function" &&
    typeof bindings.casysCatalogueCommand === "function";

  const refresh = useCallback(async () => {
    if (!bindings) return;
    try {
      const next = parseChatSnapshotDto(
        await bindings.casysChatSnapshot({
          protocol: DESKTOP_CHAT_PROTOCOL,
          ...(typeof selectedId === "string" ? { conversationId: selectedId } : {}),
        }),
      );
      setSnapshot(next);
      setSelectedId((current) => {
        if (current === null) return null;
        if (current !== undefined) return current;
        return next.conversations.find((conversation) =>
          conversation.projectId === projectId
        )?.id;
      });
      setError(next.error);
    } catch (cause) {
      setError(readError(cause));
    }
  }, [bindings, projectId, selectedId]);

  useEffect(() => setSelectedId(undefined), [projectId]);

  useEffect(() => {
    const previous = previousPresentationRef.current;
    previousPresentationRef.current = { open, compactModal };
    if (previous.open && !open && !previous.compactModal) {
      triggerRef.current?.focus();
    }
  }, [compactModal, open]);

  useEffect(() => {
    if (!open || fixedPanelAvailable || compactModal) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    globalThis.addEventListener("keydown", dismiss);
    return () => globalThis.removeEventListener("keydown", dismiss);
  }, [compactModal, fixedPanelAvailable, onOpenChange, open]);

  useEffect(() => {
    if (!bindings || !open) return;
    void refresh();
    const active = snapshot?.conversations.some((conversation) =>
      conversation.status === "running" || conversation.status === "queued" ||
      conversation.pendingInteraction !== undefined
    );
    const timer = globalThis.setInterval(
      () => void refresh(),
      active ? 250 : 1_000,
    );
    return () => globalThis.clearInterval(timer);
  }, [bindings, open, refresh, snapshot?.conversations]);

  const command = useCallback(
    async (request: DesktopChatBindingCommandRequest) => {
      if (!bindings) return undefined;
      setBusy(true);
      setError(undefined);
      try {
        const response = parseChatCommandResponse(
          await bindings.casysChatCommand(request),
        );
        if (!response.ok) {
          throw new Error(response.error ?? "Chat command failed");
        }
        if (response.conversationId) setSelectedId(response.conversationId);
        await refresh();
        return response;
      } catch (cause) {
        setError(readError(cause));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [bindings, refresh],
  );

  // Header attach path: same prepare-then-enable contract as the catalogue
  // card. This surface carries no availability snapshot, so prepare always
  // runs (idempotent reuse when ready) and enable follows only on prepared.
  const connectWithPrepare = useCallback(
    async (conversationId: string, mcpId: string) => {
      if (bindings === undefined) return;
      setBusy(true);
      setError(undefined);
      try {
        const prepared = parseCatalogueCommandResponse(
          await bindings.casysCatalogueCommand({
            protocol: DESKTOP_CATALOGUE_PROTOCOL,
            requestId: requestId(),
            command: "catalogue.prepare",
            entryId: mcpId,
          }),
        );
        if (!prepared.ok) throw new Error(prepared.error ?? "Prepare failed.");
        if (prepared.outcome !== "prepared") {
          const text = [prepared.detail, prepared.recovery]
            .filter((part) => part !== undefined && part !== "")
            .join(" ");
          throw new Error(
            text === "" ? "Tool needs action before use." : text,
          );
        }
        await command({
          protocol: DESKTOP_CHAT_PROTOCOL,
          requestId: requestId(),
          command: "mcp.enable",
          conversationId,
          mcpId,
        });
      } catch (cause) {
        setError(readError(cause));
      } finally {
        setBusy(false);
      }
    },
    [bindings, command],
  );

  const viewerDispatch: ChatViewerDispatch | undefined = bindings === undefined
    ? undefined
    : {
      openViewer: async (
        conversationId: string,
        toolCallId: string,
      ): Promise<ChatViewerSessionDto> => {
        const response = parseChatCommandResponse(
          await bindings.casysChatCommand({
            protocol: DESKTOP_CHAT_PROTOCOL,
            requestId: requestId(),
            command: "viewer.open",
            conversationId,
            toolCallId,
          }),
        );
        if (!response.ok || response.viewer === undefined) {
          throw new Error(response.error ?? "Viewer failed to open.");
        }
        return response.viewer;
      },
      callViewerTool: async (
        conversationId: string,
        toolCallId: string,
        name: string,
        args: unknown,
      ): Promise<ChatViewerJson> => {
        const response = parseChatCommandResponse(
          await bindings.casysChatCommand({
            protocol: DESKTOP_CHAT_PROTOCOL,
            requestId: requestId(),
            command: "viewer.tool-call",
            conversationId,
            toolCallId,
            name,
            arguments: parseChatViewerArguments(args),
          }),
        );
        if (!response.ok || response.viewerResult === undefined) {
          throw new Error(response.error ?? "Viewer tool call failed.");
        }
        return response.viewerResult;
      },
      readViewerResource: async (
        conversationId: string,
        toolCallId: string,
        uri: string,
      ): Promise<ChatViewerResourceDto> => {
        const response = parseChatCommandResponse(
          await bindings.casysChatCommand({
            protocol: DESKTOP_CHAT_PROTOCOL,
            requestId: requestId(),
            command: "viewer.resource-read",
            conversationId,
            toolCallId,
            uri,
          }),
        );
        if (!response.ok || response.viewerResource === undefined) {
          throw new Error(response.error ?? "Viewer resource read failed.");
        }
        return response.viewerResource;
      },
      fetchApp: async (
        server: string,
        uri: string,
        fingerprint: string,
      ): Promise<ChatViewerAppBytesDto> => {
        const response = parseChatViewerAppFetchResponse(
          await bindings.casysChatViewerApp({
            protocol: DESKTOP_CHAT_PROTOCOL,
            requestId: requestId(),
            server,
            uri,
            fingerprint,
          }),
        );
        if (!response.ok || response.app === undefined) {
          throw new Error(response.error ?? "Viewer App fetch failed.");
        }
        return response.app;
      },
      saveFile: async (
        fileName: string,
        data: string,
      ): Promise<{ readonly path: string; readonly bytes: number }> => {
        const response = parseChatSaveFileResponse(
          await bindings.casysChatSaveFile({
            protocol: DESKTOP_CHAT_PROTOCOL,
            requestId: requestId(),
            fileName,
            data,
          }),
        );
        if (
          !response.ok || response.path === undefined ||
          response.bytes === undefined
        ) {
          throw new Error(response.error ?? "File export failed.");
        }
        return { path: response.path, bytes: response.bytes };
      },
    };

  const standaloneConversations =
    snapshot?.conversations.filter((conversation) =>
      conversation.kind === "standalone"
    ) ?? [];
  const projectConversations =
    snapshot?.conversations.filter((conversation) =>
      conversation.kind === "project" && conversation.projectId === projectId
    ) ?? [];
  const selected = selectedConversation(snapshot, selectedId, projectId);
  const panel = (
    <ArkDialog.Content className="desktop-chat-panel">
      <header className="desktop-chat-head">
        <div className="min-w-0">
          <p className="desktop-chat-eyebrow">Agent workspace</p>
          <ArkDialog.Title className="desktop-chat-title">
            Chat
          </ArkDialog.Title>
          <ArkDialog.Description className="desktop-chat-description">
            Standalone and project conversations.
          </ArkDialog.Description>
        </div>
        <div className="desktop-chat-head-actions">
          <AgentSelector
            profiles={snapshot?.agentProfiles ?? []}
            defaultProfileId={snapshot?.defaultAgentProfileId}
            activeProfileId={selected?.agentProfileId}
            conversationId={selected?.id}
            interactive={nativeChatAvailable}
            command={command}
          />
          <Button
            type="button"
            variant={showCatalogue ? "secondary" : "ghost"}
            size="sm"
            className="h-8 px-2"
            aria-pressed={showCatalogue}
            onClick={() => setShowCatalogue((open) => !open)}
          >
            Tools
          </Button>
          <ArkDialog.CloseTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="desktop-chat-close h-8 px-2"
              aria-label="Close chat"
            >
              Close
            </Button>
          </ArkDialog.CloseTrigger>
        </div>
      </header>
      <ConversationRail
        standalone={standaloneConversations}
        project={projectConversations}
        projectId={projectId}
        selectedId={selected?.id}
        onSelect={setSelectedId}
        interactive={nativeChatAvailable}
      />
      {!nativeChatAvailable
        ? <BrowserPreviewUnavailable projectId={projectId} />
        : showCatalogue && bindings !== undefined
        ? (
          <CatalogueView
            bindings={bindings}
            catalogueAvailable={nativeCatalogueAvailable}
            conversation={selected}
            busy={busy}
            command={command}
            onClose={() => setShowCatalogue(false)}
          />
        )
        : selected
        ? (
          <Conversation
            key={selected.id}
            conversation={selected}
            connectableMcps={snapshot?.connectableMcps ?? []}
            busy={busy}
            command={command}
            onConnect={connectWithPrepare}
            viewerDispatch={viewerDispatch}
            retention={snapshot?.retention}
          />
        )
        : (
          <NewConversation
            projectId={projectId}
            busy={busy}
            command={command}
          />
        )}
      {error && <p className="desktop-chat-error" role="alert">{error}</p>}
      <footer className="desktop-chat-foot">
        Transcript history is separate from authoritative Thread/CAS evidence.
      </footer>
    </ArkDialog.Content>
  );
  return (
    // Zag installs modal effects only when its open state is entered. Remount
    // when the responsive presentation changes so those effects are rebuilt.
    <ArkDialog.Root
      key={compactModal ? "modal" : "panel"}
      open={open}
      onOpenChange={(details) => onOpenChange(details.open)}
      ids={{
        content: "desktop-chat-panel",
        title: "desktop-chat-title",
        description: "desktop-chat-description",
      }}
      modal={compactModal}
      trapFocus={compactModal}
      preventScroll={compactModal}
      closeOnInteractOutside={compactModal}
      closeOnEscape={!fixedPanelAvailable || compactModal}
    >
      <aside
        className={`desktop-chat${open ? " is-open" : ""}${
          nativeChatAvailable ? "" : " is-unavailable"
        }`}
        aria-label="Agent chat"
        data-chat-runtime={nativeChatAvailable ? "native" : "browser-preview"}
        data-chat-presentation={fixedProjectPanel
          ? "project-panel"
          : projectSheet
          ? "project-sheet"
          : compactModal
          ? "modal"
          : "panel"}
      >
        <ArkDialog.Trigger
          ref={triggerRef}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "desktop-chat-toggle h-10 rounded-lg bg-background px-3 shadow-lg",
          )}
          aria-expanded={open}
          aria-controls="desktop-chat-panel"
        >
          <span>Chat</span>
          {!nativeChatAvailable && (
            <Badge
              variant="warning"
              className="desktop-chat-availability font-mono text-[9px] uppercase tracking-[0.08em]"
            >
              preview
            </Badge>
          )}
          {selected?.status === "running" && (
            <Badge
              variant="success"
              className="desktop-chat-live font-mono text-[9px] uppercase tracking-[0.08em]"
            >
              live
            </Badge>
          )}
        </ArkDialog.Trigger>
        <ArkDialog.Backdrop className="desktop-chat-backdrop" />
        <ArkDialog.Positioner className="desktop-chat-positioner">
          {panel}
        </ArkDialog.Positioner>
      </aside>
    </ArkDialog.Root>
  );
}

function AgentSelector({
  profiles,
  defaultProfileId,
  activeProfileId,
  conversationId,
  interactive,
  command,
}: {
  readonly profiles: readonly ChatAgentProfileDto[];
  readonly defaultProfileId?: string;
  readonly activeProfileId?: string;
  readonly conversationId?: string;
  readonly interactive: boolean;
  readonly command: (
    request: DesktopChatBindingCommandRequest,
  ) => Promise<ChatCommandResponse | undefined>;
}): JSX.Element | null {
  if (profiles.length === 0) return null;
  const value = activeProfileId ?? defaultProfileId ?? "";
  return (
    <label className="desktop-chat-agent" title="Agent for this conversation (default when none is open)">
      Agent
      <select
        aria-label="Agent"
        disabled={!interactive}
        value={value}
        onChange={(event) => {
          const profileId = event.currentTarget.value;
          if (profileId === "" || profileId === activeProfileId) return;
          if (conversationId !== undefined) {
            void command({
              protocol: DESKTOP_CHAT_PROTOCOL,
              requestId: requestId(),
              command: "agent.select",
              conversationId,
              profileId,
            });
          } else if (profileId !== defaultProfileId) {
            void command({
              protocol: DESKTOP_CHAT_PROTOCOL,
              requestId: requestId(),
              command: "agent.set-default",
              profileId,
            });
          }
        }}
      >
        {profiles.map((profile) => (
          <option
            key={profile.id}
            value={profile.id}
            disabled={!profile.available}
            title={profile.available
              ? (profile.version ? `Version ${profile.version}` : profile.displayName)
              : (profile.missingReason ?? "Unavailable")}
          >
            {profile.displayName}
            {profile.available && profile.version ? ` ${profile.version}` : ""}
            {!profile.available ? " (unavailable)" : ""}
            {profile.id === defaultProfileId ? " • default" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function ConversationRail({
  standalone,
  project,
  projectId,
  selectedId,
  onSelect,
  interactive,
}: {
  readonly standalone: readonly ChatConversationDto[];
  readonly project: readonly ChatConversationDto[];
  readonly projectId?: string;
  readonly selectedId?: string;
  readonly onSelect: (id: string | null) => void;
  readonly interactive: boolean;
}): JSX.Element {
  return (
    <nav className="desktop-chat-rail" aria-label="Chat conversations">
      <Button
        variant={!selectedId ? "secondary" : "ghost"}
        size="sm"
        className="desktop-chat-rail-button"
        disabled={!interactive}
        aria-pressed={!selectedId}
        onClick={() => onSelect(null)}
      >
        + New
      </Button>
      <p className="desktop-chat-interaction-kind">Standalone</p>
      {standalone.map((conversation) => (
        <RailButton
          key={conversation.id}
          conversation={conversation}
          selectedId={selectedId}
          onSelect={onSelect}
          interactive={interactive}
        />
      ))}
      {projectId !== undefined && (
        <>
          <p className="desktop-chat-interaction-kind">Project</p>
          {project.map((conversation) => (
            <RailButton
              key={conversation.id}
              conversation={conversation}
              selectedId={selectedId}
              onSelect={onSelect}
              interactive={interactive}
            />
          ))}
        </>
      )}
    </nav>
  );
}

function RailButton({
  conversation,
  selectedId,
  onSelect,
  interactive,
}: {
  readonly conversation: ChatConversationDto;
  readonly selectedId?: string;
  readonly onSelect: (id: string | null) => void;
  readonly interactive: boolean;
}): JSX.Element {
  const label = conversation.kind === "standalone"
    ? conversation.title
    : conversation.projectId ?? conversation.title;
  return (
    <Button
      variant={conversation.id === selectedId ? "secondary" : "ghost"}
      size="sm"
      className="desktop-chat-rail-button"
      disabled={!interactive}
      aria-pressed={conversation.id === selectedId}
      onClick={() => onSelect(conversation.id)}
      title={`${label} · ${conversation.status}`}
    >
      {label}
    </Button>
  );
}

function BrowserPreviewUnavailable(
  { projectId }: { readonly projectId?: string },
): JSX.Element {
  return (
    <div className="desktop-chat-preview" tabIndex={-1} data-autofocus>
      <p className="desktop-chat-interaction-kind">
        Browser preview · non-native
      </p>
      <Notice title="Native Chat is unavailable here">
        <p>
          This Workbench preview does not expose the Deno Desktop binding. No
          conversation is loaded and no command can be sent from this panel.
        </p>
        {projectId && (
          <p className="desktop-chat-unavailable-focus">
            Projected project <strong>{projectId}</strong>
          </p>
        )}
      </Notice>
      <p className="desktop-chat-preview-guidance">
        Open the dashboard in the packaged Desktop app to use project chat.
      </p>
    </div>
  );
}

function NewConversation({
  projectId,
  busy,
  command,
}: CommandProps & { readonly projectId?: string }): JSX.Element {
  if (projectId === undefined) {
    return <CreateConversationForm busy={busy} command={command} />;
  }
  return (
    <>
      <CreateConversationForm
        projectId={projectId}
        busy={busy}
        command={command}
      />
      <CreateConversationForm busy={busy} command={command} />
    </>
  );
}

function CreateConversationForm({
  projectId,
  busy,
  command,
}: CommandProps & { readonly projectId?: string }): JSX.Element {
  const standalone = projectId === undefined;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void command({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: requestId(),
      command: "conversation.create",
      ...(projectId === undefined ? {} : { projectId }),
    });
  };
  return (
    <form
      className="desktop-chat-new rounded-lg border border-dashed border-border bg-card p-4 shadow-sm"
      onSubmit={submit}
    >
      {standalone
        ? (
          <>
            <p className="desktop-chat-interaction-kind">No project attached</p>
            <p>
              A normal conversation with the configured agent. No brief, model, or
              project is required; connect a tool when the task needs one.
            </p>
            <Button
              type="submit"
              size="sm"
              className="bg-brand text-white hover:bg-brand-strong"
              disabled={busy}
              data-autofocus
            >
              Start standalone conversation
            </Button>
          </>
        )
        : (
          <>
            <p className="desktop-chat-interaction-kind">
              Current projected project
            </p>
            <strong>{projectId}</strong>
            <p>
              This server-projected project is fixed for the new conversation.
            </p>
            <Button
              type="submit"
              size="sm"
              className="bg-brand text-white hover:bg-brand-strong"
              disabled={busy}
              data-autofocus
            >
              Start project conversation
            </Button>
          </>
        )}
    </form>
  );
}

interface CommandProps {
  readonly busy: boolean;
  readonly command: (
    request: DesktopChatBindingCommandRequest,
  ) => Promise<ChatCommandResponse | undefined>;
}

function Conversation({
  conversation,
  connectableMcps,
  busy,
  command,
  onConnect,
  viewerDispatch,
  retention,
}: CommandProps & {
  readonly conversation: ChatConversationDto;
  readonly connectableMcps: readonly ChatConnectableMcpDto[];
  readonly onConnect: (conversationId: string, mcpId: string) => void;
  readonly viewerDispatch: ChatViewerDispatch | undefined;
  readonly retention: ChatRetentionDto | undefined;
}): JSX.Element {
  const [text, setText] = useState("");
  const standalone = conversation.kind === "standalone";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const message = text.trim();
    if (!message) return;
    setText("");
    void command({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: requestId(),
      command: "message.send",
      conversationId: conversation.id,
      text: message,
    });
  };
  return (
    <div className="desktop-chat-conversation">
      <div className="desktop-chat-project-line">
        <span>{standalone ? "Standalone" : "Project"}</span>
        <strong>
          {standalone ? conversation.title : conversation.projectId}
        </strong>
        <Badge
          variant={conversationStatusVariant(conversation.status)}
          className="desktop-chat-state font-mono text-[9px] uppercase tracking-[0.08em]"
        >
          {conversation.status}
        </Badge>
      </div>
      {standalone && (
        <McpAttachment
          conversation={conversation}
          connectableMcps={connectableMcps}
          busy={busy}
          command={command}
          onConnect={onConnect}
        />
      )}
      {standalone && (
        <ChatSessionWorkList
          conversation={conversation}
          retention={retention}
          sendMessage={(text) =>
            void command({
              protocol: DESKTOP_CHAT_PROTOCOL,
              requestId: requestId(),
              command: "message.send",
              conversationId: conversation.id,
              text,
            })}
        />
      )}
      <ol className="desktop-chat-messages" aria-live="polite">
        {conversation.messages.length === 0 && (
          <li className="desktop-chat-empty">
            {standalone
              ? "Ask anything. Connect a tool below when the task needs one."
              : "Ask about project intent, evidence, or a registered operation."}
          </li>
        )}
        {conversation.messages.map((message) => (
          <li
            key={message.id}
            className={`is-${message.role} is-${message.kind}`}
          >
            <span>
              {message.role === "user"
                ? "You"
                : message.role === "assistant"
                ? "Agent"
                : "Host"}
            </span>
            <p>{message.text}</p>
            {viewerDispatch !== undefined && (
              <ChatViewerPanel
                conversationId={conversation.id}
                viewers={conversation.viewers}
                messageId={message.id}
                dispatch={viewerDispatch}
              />
            )}
          </li>
        ))}
      </ol>
      {conversation.pendingInteraction && (
        <Interaction
          conversationId={conversation.id}
          interaction={conversation.pendingInteraction}
          busy={busy}
          command={command}
        />
      )}
      <form className="desktop-chat-composer" onSubmit={submit}>
        <label htmlFor="desktop-chat-message">Message</label>
        <textarea
          id="desktop-chat-message"
          value={text}
          maxLength={32_000}
          disabled={conversation.status === "closed"}
          onChange={(event) => setText(event.currentTarget.value)}
          placeholder={standalone
            ? "Ask the agent anything…"
            : "Ask the agent to review the current project…"}
          rows={3}
          data-autofocus
        />
        <div>
          <Button
            type="submit"
            size="sm"
            className="bg-brand text-white hover:bg-brand-strong"
            disabled={busy || !text.trim() || conversation.status === "closed"}
          >
            Send
          </Button>
          {(conversation.status === "running" ||
            conversation.status === "queued") && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                void command({
                  protocol: DESKTOP_CHAT_PROTOCOL,
                  requestId: requestId(),
                  command: "turn.cancel",
                  conversationId: conversation.id,
                })}
            >
              Cancel turn
            </Button>
          )}
          {conversation.status !== "closed" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                void command({
                  protocol: DESKTOP_CHAT_PROTOCOL,
                  requestId: requestId(),
                  command: "conversation.close",
                  conversationId: conversation.id,
                })}
            >
              Close conversation
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function Interaction({
  conversationId,
  interaction,
  busy,
  command,
}: CommandProps & {
  readonly conversationId: string;
  readonly interaction: ChatPendingInteractionDto;
}): JSX.Element {
  if (interaction.type === "permission") {
    return (
      <section className="desktop-chat-interaction is-permission rounded-lg border border-warning/25 border-l-4 border-l-warning bg-warning/5 p-3">
        <p className="desktop-chat-interaction-kind">
          Agent permission · Not MRTR
        </p>
        <h3>{interaction.title}</h3>
        <p>{interaction.detail}</p>
        <div className="desktop-chat-actions">
          {interaction.options.map((option) => (
            <Button
              type="button"
              variant={option.decision.startsWith("allow") ? "default" : "outline"}
              size="sm"
              key={option.decision}
              disabled={busy}
              className={option.decision.startsWith("allow")
                ? "bg-brand text-white hover:bg-brand-strong"
                : undefined}
              onClick={() =>
                void command({
                  protocol: DESKTOP_CHAT_PROTOCOL,
                  requestId: requestId(),
                  command: "permission.resolve",
                  conversationId,
                  correlationId: interaction.correlationId,
                  decision: option.decision,
                })}
            >
              {option.label}
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              void command({
                protocol: DESKTOP_CHAT_PROTOCOL,
                requestId: requestId(),
                command: "permission.resolve",
                conversationId,
                correlationId: interaction.correlationId,
                decision: "cancel",
              })}
          >
            Cancel
          </Button>
        </div>
      </section>
    );
  }
  if (interaction.type === "elicitation-url") {
    return (
      <section className="desktop-chat-interaction is-elicitation rounded-lg border border-lane-req/25 border-l-4 border-l-lane-req bg-lane-req/5 p-3">
        <p className="desktop-chat-interaction-kind">External input request</p>
        <h3>{interaction.message}</h3>
        <p>Open the exact HTTPS destination, complete it, then return here.</p>
        <div className="desktop-chat-actions">
          <Button
            type="button"
            size="sm"
            className="bg-brand text-white hover:bg-brand-strong"
            disabled={busy}
            onClick={() =>
              void command({
                protocol: DESKTOP_CHAT_PROTOCOL,
                requestId: requestId(),
                command: "external.open",
                url: interaction.url,
              })}
          >
            Open in external browser
          </Button>
          <ResolveButton
            label="I returned — continue"
            action="accept"
            conversationId={conversationId}
            interaction={interaction}
            busy={busy}
            command={command}
          />
          <ResolveButton
            label="Decline"
            action="decline"
            conversationId={conversationId}
            interaction={interaction}
            busy={busy}
            command={command}
          />
          <ResolveButton
            label="Cancel"
            action="cancel"
            conversationId={conversationId}
            interaction={interaction}
            busy={busy}
            command={command}
          />
        </div>
      </section>
    );
  }
  return (
    <ElicitationForm
      conversationId={conversationId}
      interaction={interaction}
      busy={busy}
      command={command}
    />
  );
}

function ElicitationForm({
  conversationId,
  interaction,
  busy,
  command,
}: CommandProps & {
  readonly conversationId: string;
  readonly interaction: Extract<
    ChatPendingInteractionDto,
    { type: "elicitation-form" }
  >;
}): JSX.Element {
  const [values, setValues] = useState<
    Record<string, string | number | boolean | string[]>
  >(
    () => {
      const initial: Record<string, string | number | boolean | string[]> = {};
      for (const field of interaction.fields) {
        const value = field.defaultValue;
        if (value === undefined) continue;
        initial[field.name] = Array.isArray(value)
          ? Array.from(value as readonly string[])
          : value as string | number | boolean;
      }
      return initial;
    },
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const content = Object.fromEntries(interaction.fields.flatMap((field) => {
      const value = values[field.name];
      if (value === undefined || value === "") return [];
      if (
        (field.type === "number" || field.type === "integer") &&
        typeof value === "string"
      ) {
        return [[field.name, Number(value)]];
      }
      return [[field.name, value]];
    })) as Record<string, string | number | boolean | string[]>;
    void command({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: requestId(),
      command: "elicitation.resolve",
      conversationId,
      correlationId: interaction.correlationId,
      action: "accept",
      content,
    });
  };
  return (
    <form
      className="desktop-chat-interaction is-elicitation rounded-lg border border-lane-req/25 border-l-4 border-l-lane-req bg-lane-req/5 p-3"
      onSubmit={submit}
    >
      <p className="desktop-chat-interaction-kind">
        Server input request · may be MRTR
      </p>
      <h3>{interaction.title ?? interaction.message}</h3>
      {interaction.title && <p>{interaction.message}</p>}
      {interaction.description && <p>{interaction.description}</p>}
      <div className="desktop-chat-fields">
        {interaction.fields.map((field) => (
          <ChatField
            key={field.name}
            field={field}
            value={values[field.name]}
            onChange={(value) =>
              setValues((current) => ({ ...current, [field.name]: value }))}
          />
        ))}
      </div>
      <div className="desktop-chat-actions">
        <Button
          type="submit"
          size="sm"
          className="bg-brand text-white hover:bg-brand-strong"
          disabled={busy}
        >
          Accept and continue
        </Button>
        {(["decline", "cancel"] as const).map((action) => (
          <Button
            key={action}
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void command({
                protocol: DESKTOP_CHAT_PROTOCOL,
                requestId: requestId(),
                command: "elicitation.resolve",
                conversationId,
                correlationId: interaction.correlationId,
                action,
              })}
          >
            {action === "decline" ? "Decline" : "Cancel"}
          </Button>
        ))}
      </div>
    </form>
  );
}

function ChatField({
  field,
  value,
  onChange,
}: {
  readonly field: ChatFormFieldDto;
  readonly value?: string | number | boolean | readonly string[];
  readonly onChange: (value: string | number | boolean | string[]) => void;
}): JSX.Element {
  const id = `chat-field-${field.name}`;
  if (field.type === "boolean") {
    return (
      <label className="desktop-chat-checkbox" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span>
          <strong>{field.label}</strong>
          {field.description && <small>{field.description}</small>}
        </span>
      </label>
    );
  }
  if (field.type === "select") {
    return (
      <label htmlFor={id}>
        {field.label}
        <select
          id={id}
          required={field.required}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          <option value="">Select…</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {field.description && <small>{field.description}</small>}
      </label>
    );
  }
  if (field.type === "multiselect") {
    const selected = new Set(Array.isArray(value) ? value : []);
    return (
      <fieldset>
        <legend>{field.label}</legend>
        {field.options.map((option) => (
          <label className="desktop-chat-checkbox" key={option.value}>
            <input
              type="checkbox"
              checked={selected.has(option.value)}
              onChange={(event) => {
                const next = new Set(selected);
                if (event.currentTarget.checked) {
                  next.add(option.value);
                } else next.delete(option.value);
                onChange([...next]);
              }}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>
    );
  }
  const inputType = field.type === "text"
    ? field.format === "uri" ? "url" : field.format ?? "text"
    : "number";
  return (
    <label htmlFor={id}>
      {field.label}
      <input
        id={id}
        type={inputType}
        required={field.required}
        value={typeof value === "string" || typeof value === "number" ? value : ""}
        min={field.type === "number" || field.type === "integer"
          ? field.minimum
          : undefined}
        max={field.type === "number" || field.type === "integer"
          ? field.maximum
          : undefined}
        step={field.type === "integer"
          ? 1
          : field.type === "number"
          ? "any"
          : undefined}
        minLength={field.type === "text" ? field.minLength : undefined}
        maxLength={field.type === "text" ? field.maxLength : undefined}
        pattern={field.type === "text" ? field.pattern : undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {field.description && <small>{field.description}</small>}
    </label>
  );
}

function ResolveButton({
  label,
  action,
  conversationId,
  interaction,
  busy,
  command,
}: CommandProps & {
  readonly label: string;
  readonly action: "accept" | "decline" | "cancel";
  readonly conversationId: string;
  readonly interaction: Extract<
    ChatPendingInteractionDto,
    { type: "elicitation-url" }
  >;
}): JSX.Element {
  return (
    <Button
      type="button"
      variant={action === "accept" ? "default" : "outline"}
      size="sm"
      disabled={busy}
      className={action === "accept"
        ? "bg-brand text-white hover:bg-brand-strong"
        : undefined}
      onClick={() =>
        void command({
          protocol: DESKTOP_CHAT_PROTOCOL,
          requestId: requestId(),
          command: "elicitation.resolve",
          conversationId,
          correlationId: interaction.correlationId,
          action,
        })}
    >
      {label}
    </Button>
  );
}

function CatalogueView({
  bindings,
  catalogueAvailable,
  conversation,
  busy,
  command,
  onClose,
}: CommandProps & {
  readonly bindings: DesktopBindings;
  readonly catalogueAvailable: boolean;
  readonly conversation: ChatConversationDto | undefined;
  readonly onClose: () => void;
}): JSX.Element {
  const [snapshot, setSnapshot] = useState<CatalogueSnapshotDto>();
  const [error, setError] = useState<string>();
  const [acting, setActing] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Readonly<Record<string, string>>>(
    {},
  );

  const refresh = useCallback(async () => {
    if (!catalogueAvailable) return;
    try {
      setSnapshot(
        parseCatalogueSnapshotDto(
          await bindings.casysCatalogueSnapshot({
            protocol: DESKTOP_CATALOGUE_PROTOCOL,
          }),
        ),
      );
      setError(undefined);
    } catch (cause) {
      setError(readError(cause));
    }
  }, [bindings, catalogueAvailable]);

  useEffect(() => {
    void refresh();
    const timer = globalThis.setInterval(() => void refresh(), 5_000);
    return () => globalThis.clearInterval(timer);
  }, [refresh]);

  const runCommand = async (
    entryId: string,
    label: string,
    payload:
      | { readonly command: "catalogue.prepare"; readonly entryId: string }
      | { readonly command: "catalogue.probe"; readonly entryId: string }
      | { readonly command: "catalogue.runtime.stop"; readonly entryId: string }
      | { readonly command: "catalogue.runtime.restart"; readonly entryId: string }
      | {
        readonly command: "catalogue.defaults.set";
        readonly ids: readonly string[];
      },
  ): Promise<CatalogueCommandResponse | null> => {
    setActing(`${label}:${entryId}`);
    try {
      const response = parseCatalogueCommandResponse(
        await bindings.casysCatalogueCommand({
          protocol: DESKTOP_CATALOGUE_PROTOCOL,
          requestId: requestId(),
          ...payload,
        }),
      );
      if (!response.ok) {
        setOutcomes((current) => ({
          ...current,
          [entryId]: response.error ?? `${label} failed.`,
        }));
      } else {
        const text = [response.detail, response.recovery]
          .filter((part) => part !== undefined && part !== "")
          .join(" ");
        setOutcomes((current) => ({
          ...current,
          [entryId]: label === "Default"
            ? "Default updated."
            : text === ""
            ? `${label} done.`
            : text,
        }));
      }
      return response;
    } catch (cause) {
      setOutcomes((current) => ({ ...current, [entryId]: readError(cause) }));
      return null;
    } finally {
      setActing(null);
      await refresh();
    }
  };

  // Primary attach path: prepare the chosen tool first unless it is
  // already prepared, running, and capable, then enable it in the
  // conversation that was current when the action started. Never
  // enables on needs-action or failure; progress and recovery stay on
  // the card outcome line.
  const enableWithPrepare = async (entry: CatalogueEntryDto): Promise<void> => {
    const target = conversation === undefined
      ? undefined
      : { id: conversation.id, kind: conversation.kind };
    if (target?.kind !== "standalone") return;
    const ready = entry.availability.prepared && entry.availability.running &&
      entry.availability.capable;
    if (!ready) {
      const prepared = await runCommand(entry.id, "Prepare", {
        command: "catalogue.prepare",
        entryId: entry.id,
      });
      if (prepared?.ok !== true || prepared.outcome !== "prepared") return;
    }
    setActing(`Enable:${entry.id}`);
    try {
      const attached = await command({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: requestId(),
        command: "mcp.enable",
        conversationId: target.id,
        mcpId: entry.id,
      });
      if (attached === undefined) {
        setOutcomes((current) => ({
          ...current,
          [entry.id]: "Enable failed.",
        }));
      }
    } catch (cause) {
      setOutcomes((current) => ({ ...current, [entry.id]: readError(cause) }));
    } finally {
      setActing(null);
      await refresh();
    }
  };

  if (!catalogueAvailable) {
    return (
      <div className="desktop-chat-catalogue">
        <Notice tone="warning">
          The curated tool catalogue is unavailable in this preview.
        </Notice>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Back to chat
        </Button>
      </div>
    );
  }
  const defaults =
    snapshot?.entries.filter((entry) => entry.isDefault).map((entry) => entry.id) ??
      [];
  return (
    <div className="desktop-chat-catalogue">
      <div className="desktop-chat-project-line">
        <span>Curated engineering tools</span>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Back to chat
        </Button>
      </div>
      {error && <p className="desktop-chat-error" role="alert">{error}</p>}
      {snapshot?.error && (
        <p className="desktop-chat-error" role="alert">{snapshot.error}</p>
      )}
      {(snapshot?.entries ?? []).map((entry) => (
        <CatalogueEntryCard
          key={entry.id}
          entry={entry}
          conversation={conversation}
          busy={busy}
          acting={acting}
          outcome={outcomes[entry.id]}
          command={command}
          onPrepare={() =>
            void runCommand(entry.id, "Prepare", {
              command: "catalogue.prepare",
              entryId: entry.id,
            })}
          onProbe={() =>
            void runCommand(entry.id, "Check", {
              command: "catalogue.probe",
              entryId: entry.id,
            })}
          onStop={() =>
            void runCommand(entry.id, "Stop", {
              command: "catalogue.runtime.stop",
              entryId: entry.id,
            })}
          onRestart={() =>
            void runCommand(entry.id, "Restart", {
              command: "catalogue.runtime.restart",
              entryId: entry.id,
            })}
          onToggleDefault={() => {
            const next = entry.isDefault
              ? defaults.filter((id) => id !== entry.id)
              : [...defaults, entry.id];
            void runCommand(entry.id, "Default", {
              command: "catalogue.defaults.set",
              ids: next,
            });
          }}
          onEnable={() => void enableWithPrepare(entry)}
        />
      ))}
    </div>
  );
}

function CatalogueEntryCard({
  entry,
  conversation,
  busy,
  acting,
  outcome,
  command,
  onPrepare,
  onProbe,
  onStop,
  onRestart,
  onToggleDefault,
  onEnable,
}: CommandProps & {
  readonly entry: CatalogueEntryDto;
  readonly conversation: ChatConversationDto | undefined;
  readonly acting: string | null;
  readonly outcome?: string;
  readonly onPrepare: () => void;
  readonly onProbe: () => void;
  readonly onStop: () => void;
  readonly onRestart: () => void;
  readonly onToggleDefault: () => void;
  readonly onEnable: () => void;
}): JSX.Element {
  const attached = conversation?.kind === "standalone" ? conversation.mcp : undefined;
  const attachedMine = attached?.id === entry.id;
  const busyTurn = conversation?.status === "running" ||
    conversation?.status === "queued";
  const busyActing = busy || busyTurn || acting !== null;
  const enableLabel = (base: string): string => {
    if (acting === `Prepare:${entry.id}`) return "Preparing…";
    if (acting === `Enable:${entry.id}`) return "Enabling…";
    return base;
  };
  const disable = () =>
    conversation !== undefined &&
    void command({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: requestId(),
      command: "mcp.disable",
      conversationId: conversation.id,
    });
  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="desktop-chat-project-line">
        <strong>{entry.displayName}</strong>
        <span>{entry.tagline}</span>
      </div>
      <div className="desktop-chat-project-line">
        <StateBadge label="Prepared" on={entry.availability.prepared} />
        <StateBadge label="Running" on={entry.availability.running} />
        <StateBadge label="Capable" on={entry.availability.capable} />
        <Badge
          variant={entry.availability.runtime === "error" ? "destructive" : "secondary"}
          className="desktop-chat-state font-mono text-[9px] uppercase tracking-[0.08em]"
        >
          {entry.availability.runtime}
        </Badge>
        <Badge
          variant={entry.availability.engine === "ready" ? "success" : "warning"}
          className="desktop-chat-state font-mono text-[9px] uppercase tracking-[0.08em]"
        >
          engine {entry.availability.engine}
        </Badge>
        {entry.isDefault && (
          <Badge
            variant="secondary"
            className="desktop-chat-state font-mono text-[9px] uppercase tracking-[0.08em]"
          >
            default
          </Badge>
        )}
      </div>
      <p>{entry.description}</p>
      <p className="desktop-chat-interaction-kind">Tools</p>
      <ul>
        {entry.tools.map((tool) => (
          <li key={tool.name}>
            <code>{tool.name}</code> — {tool.summary} In: {tool.inputs} Out:{" "}
            {tool.results}
          </li>
        ))}
      </ul>
      <p className="desktop-chat-interaction-kind">Examples</p>
      <ul>
        {entry.examples.map((example) => (
          <li key={example.title}>
            <strong>{example.title}.</strong> {example.summary}
          </li>
        ))}
      </ul>
      <p className="desktop-chat-interaction-kind">Viewers</p>
      <ul>
        {entry.viewers.map((viewer) => (
          <li key={viewer.uri}>
            {viewer.label} (<code>{viewer.uri}</code>) —{" "}
            {viewer.hostSupport === "available" ? "available in Casys" : "planned"}
            {viewer.note ? `: ${viewer.note}` : ""}
          </li>
        ))}
      </ul>
      <p className="desktop-chat-interaction-kind">Tested distribution</p>
      <p>
        {entry.distribution.version} ({entry.distribution.release}), revision{" "}
        <code>{entry.distribution.revision}</code>
      </p>
      <p className="desktop-chat-interaction-kind">Platforms</p>
      <ul>
        {entry.platforms.map((platform) => (
          <li key={platform.id}>
            {platform.id} — {platform.status}: {platform.note}
          </li>
        ))}
      </ul>
      <p>{entry.guidance}</p>
      <p>
        <small>{entry.availability.detail}</small>
      </p>
      <div className="desktop-chat-project-line">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || acting !== null}
          onClick={onPrepare}
        >
          {acting === `Prepare:${entry.id}` ? "Preparing…" : "Prepare"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy || acting !== null}
          onClick={onProbe}
        >
          Check
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy || acting !== null || entry.availability.runtime === "stopped"}
          onClick={onStop}
        >
          {acting === `Stop:${entry.id}` ? "Stopping…" : "Stop"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy || acting !== null}
          onClick={onRestart}
        >
          {acting === `Restart:${entry.id}` ? "Restarting…" : "Restart"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy || acting !== null}
          aria-pressed={entry.isDefault}
          onClick={onToggleDefault}
        >
          {entry.isDefault ? "Default ✓" : "Set default"}
        </Button>
      </div>
      <div className="desktop-chat-project-line">
        <span>This chat</span>
        {conversation === undefined && (
          <span>Select or start a standalone chat to enable.</span>
        )}
        {conversation?.kind === "project" && (
          <span>Project chats keep their fixed tool.</span>
        )}
        {conversation?.kind === "standalone" &&
          (attached === undefined || !attachedMine) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busyActing}
            onClick={onEnable}
          >
            {enableLabel(
              attached === undefined ? "Enable in this chat" : "Switch to this tool",
            )}
          </Button>
        )}
        {conversation?.kind === "standalone" &&
          attached !== undefined &&
          !attachedMine &&
          attached.status === "connected" && (
          <span>Attached: {attached.displayName}.</span>
        )}
        {conversation?.kind === "standalone" &&
          attachedMine &&
          attached?.status === "connected" && (
          <>
            <Badge
              variant="success"
              className="desktop-chat-state font-mono text-[9px] uppercase tracking-[0.08em]"
            >
              enabled · {attached.displayName} · {attached.tools.length} tools
            </Badge>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busyActing}
              onClick={disable}
            >
              Disconnect
            </Button>
          </>
        )}
        {conversation?.kind === "standalone" &&
          attachedMine &&
          attached?.status === "failed" && (
          <>
            <Badge
              variant="destructive"
              className="desktop-chat-state font-mono text-[9px] uppercase tracking-[0.08em]"
            >
              connection failed
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busyActing}
              onClick={onEnable}
            >
              {enableLabel("Retry")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busyActing}
              onClick={disable}
            >
              Disconnect
            </Button>
          </>
        )}
      </div>
      {outcome && <p role="status">{outcome}</p>}
    </section>
  );
}

function StateBadge(
  { label, on }: { readonly label: string; readonly on: boolean },
): JSX.Element {
  return (
    <Badge
      variant={on ? "success" : "secondary"}
      className="desktop-chat-state font-mono text-[9px] uppercase tracking-[0.08em]"
    >
      {label} {on ? "yes" : "no"}
    </Badge>
  );
}

function selectedConversation(
  snapshot: ChatSnapshotDto | undefined,
  selectedId: string | null | undefined,
  projectId: string | undefined,
): ChatConversationDto | undefined {
  if (selectedId === null || selectedId === undefined) return undefined;
  return snapshot?.conversations.find((conversation) =>
    conversation.id === selectedId &&
    (conversation.kind === "standalone" || conversation.projectId === projectId)
  );
}

function McpAttachment({
  conversation,
  connectableMcps,
  busy,
  command,
  onConnect,
}: CommandProps & {
  readonly conversation: ChatConversationDto;
  readonly connectableMcps: readonly ChatConnectableMcpDto[];
  readonly onConnect: (conversationId: string, mcpId: string) => void;
}): JSX.Element {
  const attached = conversation.mcp;
  const busyTurn = conversation.status === "running" ||
    conversation.status === "queued";
  const enable = (mcpId: string) => onConnect(conversation.id, mcpId);
  const disable = () =>
    void command({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: requestId(),
      command: "mcp.disable",
      conversationId: conversation.id,
    });
  return (
    <div className="desktop-chat-project-line">
      <span>Tool</span>
      {attached === undefined && (
        <>
          <span>None connected</span>
          {connectableMcps.map((server) => (
            <Button
              key={server.id}
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || busyTurn}
              title={server.description}
              onClick={() => enable(server.id)}
            >
              Connect {server.displayName}
            </Button>
          ))}
        </>
      )}
      {attached !== undefined && attached.status === "connected" && (
        <>
          <Badge
            variant="success"
            className="desktop-chat-state font-mono text-[9px] uppercase tracking-[0.08em]"
          >
            {attached.displayName} · {attached.tools.length} tools
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy || busyTurn}
            onClick={disable}
          >
            Disconnect
          </Button>
        </>
      )}
      {attached !== undefined && attached.status === "failed" && (
        <>
          <Badge
            variant="destructive"
            className="desktop-chat-state font-mono text-[9px] uppercase tracking-[0.08em]"
          >
            {attached.displayName} · connection failed
          </Badge>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || busyTurn}
            onClick={() => enable(attached.id)}
          >
            Retry
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy || busyTurn}
            onClick={disable}
          >
            Disconnect
          </Button>
        </>
      )}
    </div>
  );
}

function conversationStatusVariant(
  status: ChatConversationDto["status"],
): NonNullable<BadgeProps["variant"]> {
  switch (status) {
    case "running":
      return "success";
    case "queued":
      return "warning";
    case "failed":
      return "destructive";
    default:
      return "secondary";
  }
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia(query).matches
  );

  useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return;
    const media = globalThis.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

export function desktopChatRuntimeAvailable(): boolean {
  return desktopBindings() !== undefined;
}

function desktopBindings(): DesktopBindings | undefined {
  const candidate = globalThis.bindings;
  if (
    typeof candidate !== "object" || candidate === null ||
    typeof candidate.casysChatSnapshot !== "function" ||
    typeof candidate.casysChatCommand !== "function"
  ) return undefined;
  return candidate;
}

function requestId(): string {
  return `ui:${crypto.randomUUID()}`;
}

function readError(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Desktop Chat is unavailable.";
}
