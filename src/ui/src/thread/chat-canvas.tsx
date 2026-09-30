import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { Button } from "../ui/button.tsx";
import type {
  ChatCanvasLayoutDto,
  ChatCanvasNodeDto,
  ChatCommandResponse,
  ChatToolViewerDto,
  DESKTOP_CHAT_PROTOCOL,
  DesktopChatBindingCommandRequest,
} from "../../../presentation/desktop/chat/contracts.ts";
import {
  type ChatViewerDispatch,
  ChatViewerPanel,
} from "./chat-viewer-panel.tsx";
import { ChatCanvasSaveQueue } from "./chat-canvas-save-queue.ts";
import { ChatSessionWorkList } from "./chat-session-work.tsx";
import type {
  ChatConversationDto,
  ChatRetentionDto,
} from "../../../presentation/desktop/chat/contracts.ts";
import {
  addCanvasGroup,
  addCanvasNote,
  applyNodeGroup,
  applyNodeMove,
  applyNodeTitle,
  applyNoteDone,
  applyNoteText,
  nodeDisplayTitle,
  placeViewerNode,
  removeCanvasNode,
  resolveCanvasNodes,
} from "./chat-canvas-model.ts";

export interface ChatCanvasProps {
  readonly conversationId: string;
  readonly viewers: readonly ChatToolViewerDto[];
  readonly conversation: ChatConversationDto;
  readonly retention: ChatRetentionDto | undefined;
  readonly dispatch: ChatViewerDispatch | undefined;
  readonly saveQueue: ChatCanvasSaveQueue;
  readonly command: (
    request: DesktopChatBindingCommandRequest,
  ) => Promise<ChatCommandResponse | undefined>;
  readonly onClose: () => void;
}

function protocol(): typeof DESKTOP_CHAT_PROTOCOL {
  return "casys-desktop-chat/1.0";
}

function requestId(): string {
  return `ui:${crypto.randomUUID()}`;
}

/**
 * Optional session Canvas (#55): the conversation's retained viewers,
 * notes and groups on a positionable board. Layout persists per
 * conversation; new results arrive as unplaced viewers. Presentation
 * only, never evidence.
 */
export function ChatCanvas({
  conversationId,
  viewers,
  conversation,
  retention,
  dispatch,
  saveQueue,
  command,
  onClose,
}: ChatCanvasProps): JSX.Element {
  const [layout, setLayout] = useState<ChatCanvasLayoutDto | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [groupTitle, setGroupTitle] = useState("");
  const [noteText, setNoteText] = useState("");
  useEffect(() => saveQueue.subscribe(setSaveError), [saveQueue]);
  useEffect(() => {
    let cancelled = false;
    setLayout(undefined);
    setError(undefined);
    void command({
      protocol: protocol(),
      requestId: requestId(),
      command: "canvas.get-layout",
      conversationId,
    }).then((response) => {
      if (cancelled) return;
      if (response?.ok && response.layout !== undefined) {
        setLayout(saveQueue.layout ?? response.layout);
      } else {
        setError(response?.error ?? "Canvas layout is unavailable.");
      }
    }).catch((cause: unknown) => {
      if (!cancelled) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Canvas layout failed to load.",
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [command, conversationId, saveQueue]);

  // The parent owns this queue across Canvas, chat, and conversation switches.
  useEffect(() => () => {
    void saveQueue.flush();
  }, [saveQueue]);

  const close = useCallback(() => {
    void saveQueue.flush().then((saved) => {
      if (saved) onClose();
      else setSaveError(saveQueue.error ?? "Canvas layout failed to save.");
    });
  }, [onClose, saveQueue]);

  const update = useCallback((next: ChatCanvasLayoutDto) => {
    setLayout(next);
    setSaveError(undefined);
    saveQueue.schedule(next);
  }, [saveQueue]);

  const resolved = useMemo(
    () =>
      layout === undefined ? undefined : resolveCanvasNodes(layout, viewers),
    [layout, viewers],
  );

  if (error !== undefined) {
    return (
      <section className="desktop-chat-canvas" aria-label="Session canvas">
        <p className="desktop-chat-error" role="alert">{error}</p>
        <Button type="button" variant="outline" size="sm" onClick={close}>
          Back to chat
        </Button>
      </section>
    );
  }
  if (layout === undefined || resolved === undefined) {
    return (
      <section className="desktop-chat-canvas" aria-label="Session canvas">
        <p className="desktop-chat-viewer-status" role="status">
          Loading canvas…
        </p>
      </section>
    );
  }
  const visible = groupFilter === "all"
    ? resolved.placed
    : resolved.placed.filter((entry) => entry.node.groupId === groupFilter);
  return (
    <section className="desktop-chat-canvas" aria-label="Session canvas">
      <div className="desktop-chat-project-line">
        <span>Canvas</span>
        <strong>Session board — not Thread evidence</strong>
        <Button type="button" variant="outline" size="sm" onClick={close}>
          Back to chat
        </Button>
      </div>
      {saveError !== undefined && (
        <p className="desktop-chat-error" role="alert">
          {saveError} Your edits remain here; retry Back to chat to save them.
        </p>
      )}
      {conversation.kind === "standalone" && (
        <ChatSessionWorkList
          conversation={conversation}
          retention={retention}
          dispatch={dispatch}
          command={command}
          sendMessage={(text) => {
            void command({
              protocol: protocol(),
              requestId: requestId(),
              command: "message.send",
              conversationId,
              text,
            });
          }}
        />
      )}
      <div className="desktop-chat-canvas-toolbar">
        <label>
          Group
          <select
            value={groupFilter}
            onChange={(event) => setGroupFilter(event.currentTarget.value)}
          >
            <option value="all">All</option>
            {resolved.groups.map((group) => (
              <option key={group.id} value={group.id}>{group.title}</option>
            ))}
          </select>
        </label>
        <input
          value={groupTitle}
          maxLength={200}
          onChange={(event) => setGroupTitle(event.currentTarget.value)}
          placeholder="New group title"
          aria-label="New group title"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={groupTitle.trim() === ""}
          onClick={() => {
            update(addCanvasGroup(layout, {
              id: `group:${crypto.randomUUID()}`,
              title: groupTitle.trim(),
            }));
            setGroupTitle("");
          }}
        >
          Add group
        </Button>
        <input
          value={noteText}
          maxLength={2000}
          onChange={(event) => setNoteText(event.currentTarget.value)}
          placeholder="New note"
          aria-label="New note text"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={noteText.trim() === ""}
          onClick={() => {
            update(addCanvasNote(layout, {
              id: `note:${crypto.randomUUID()}`,
              text: noteText.trim(),
              x: 24,
              y: 24,
            }));
            setNoteText("");
          }}
        >
          Add note
        </Button>
      </div>
      {resolved.unplaced.length > 0 && (
        <div className="desktop-chat-canvas-unplaced">
          <span>New results:</span>
          {resolved.unplaced.map((viewer) => (
            <Button
              key={viewer.viewerId}
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                update(placeViewerNode(layout, {
                  id: `node:${crypto.randomUUID()}`,
                  viewerId: viewer.viewerId,
                }))}
            >
              Place {viewer.tool}
            </Button>
          ))}
        </div>
      )}
      {visible.length === 0 && resolved.unplaced.length === 0 && (
        <p className="desktop-chat-viewer-status">
          Empty canvas. Run a tool to place its viewer, or add a note.
        </p>
      )}
      <div className="desktop-chat-canvas-board">
        {visible.map(({ node, viewer }) => (
          <CanvasNode
            key={node.id}
            conversationId={conversationId}
            node={node}
            viewer={viewer}
            groups={resolved.groups}
            dispatch={dispatch}
            onMove={(x, y) => update(applyNodeMove(layout, node.id, x, y))}
            onGroup={(groupId) =>
              update(applyNodeGroup(layout, node.id, groupId))}
            onTitle={(title) => update(applyNodeTitle(layout, node.id, title))}
            onText={(text) => update(applyNoteText(layout, node.id, text))}
            onDone={(done) => update(applyNoteDone(layout, node.id, done))}
            onRemove={() => update(removeCanvasNode(layout, node.id))}
          />
        ))}
      </div>
    </section>
  );
}

function CanvasNode({
  conversationId,
  node,
  viewer,
  groups,
  dispatch,
  onMove,
  onGroup,
  onTitle,
  onText,
  onDone,
  onRemove,
}: {
  readonly conversationId: string;
  readonly node: ChatCanvasNodeDto;
  readonly viewer: ChatToolViewerDto | undefined;
  readonly groups: readonly { readonly id: string; readonly title: string }[];
  readonly dispatch: ChatViewerDispatch | undefined;
  readonly onMove: (x: number, y: number) => void;
  readonly onGroup: (groupId: string | undefined) => void;
  readonly onTitle: (title: string | undefined) => void;
  readonly onText: (text: string) => void;
  readonly onDone: (done: boolean) => void;
  readonly onRemove: () => void;
}): JSX.Element {
  const drag = useRef<{ readonly dx: number; readonly dy: number } | undefined>(
    undefined,
  );
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingText, setEditingText] = useState(false);
  const [draftTitle, setDraftTitle] = useState(node.title ?? "");
  const [draftText, setDraftText] = useState(node.text ?? "");
  const title = nodeDisplayTitle(node, viewer?.tool);
  return (
    <article
      className="desktop-chat-canvas-node"
      style={{ left: node.x, top: node.y, zIndex: node.z }}
      aria-label={node.kind === "viewer" ? `Viewer ${title}` : "Note"}
    >
      <header
        className="desktop-chat-canvas-node-header"
        onPointerDown={(event) => {
          const board = event.currentTarget.closest(
            ".desktop-chat-canvas-board",
          )
            ?.getBoundingClientRect();
          if (board === undefined) return;
          drag.current = {
            dx: event.clientX - board.left - node.x,
            dy: event.clientY - board.top - node.y,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current === undefined) return;
          const board = event.currentTarget.closest(
            ".desktop-chat-canvas-board",
          )
            ?.getBoundingClientRect();
          if (board === undefined) return;
          onMove(
            Math.round(event.clientX - board.left - drag.current.dx),
            Math.round(event.clientY - board.top - drag.current.dy),
          );
        }}
        onPointerUp={() => {
          drag.current = undefined;
        }}
      >
        {node.kind === "note" && (
          <input
            type="checkbox"
            checked={node.done ?? false}
            aria-label="Note done"
            onChange={(event) => onDone(event.currentTarget.checked)}
          />
        )}
        {editingTitle
          ? (
            <input
              value={draftTitle}
              maxLength={200}
              aria-label="Node title"
              autoFocus
              onChange={(event) => setDraftTitle(event.currentTarget.value)}
              onBlur={() => {
                onTitle(
                  draftTitle.trim() === "" ? undefined : draftTitle.trim(),
                );
                setEditingTitle(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  (event.target as HTMLInputElement)
                    .blur();
                }
                if (event.key === "Escape") {
                  setDraftTitle(node.title ?? "");
                  setEditingTitle(false);
                }
              }}
            />
          )
          : <span>{title}</span>}
        {!editingTitle && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Rename node"
            onClick={() => {
              setDraftTitle(node.title ?? "");
              setEditingTitle(true);
            }}
          >
            ✎
          </Button>
        )}
        <select
          value={node.groupId ?? ""}
          aria-label="Node group"
          onChange={(event) =>
            onGroup(
              event.currentTarget.value === ""
                ? undefined
                : event.currentTarget.value,
            )}
        >
          <option value="">No group</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>{group.title}</option>
          ))}
        </select>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          aria-label="Remove node"
        >
          ×
        </Button>
      </header>
      {node.kind === "note" &&
        (editingText
          ? (
            <textarea
              value={draftText}
              maxLength={2000}
              rows={4}
              aria-label="Note text"
              autoFocus
              onChange={(event) => setDraftText(event.currentTarget.value)}
              onBlur={() => {
                if (draftText.trim() !== "") onText(draftText);
                else setDraftText(node.text ?? "");
                setEditingText(false);
              }}
            />
          )
          : (
            <p
              onDblClick={() => {
                setDraftText(node.text ?? "");
                setEditingText(true);
              }}
              title="Double-click to edit"
            >
              {node.text}
            </p>
          ))}
      {node.kind === "viewer" && viewer !== undefined &&
        dispatch !== undefined && (
        <ChatViewerPanel
          conversationId={conversationId}
          viewers={[viewer]}
          messageId={viewer.messageId}
          dispatch={dispatch}
        />
      )}
    </article>
  );
}
