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
import {
  addCanvasGroup,
  addCanvasNote,
  applyNodeGroup,
  applyNodeMove,
  placeViewerNode,
  removeCanvasNode,
  resolveCanvasNodes,
} from "./chat-canvas-model.ts";

export interface ChatCanvasProps {
  readonly conversationId: string;
  readonly viewers: readonly ChatToolViewerDto[];
  readonly dispatch: ChatViewerDispatch | undefined;
  readonly command: (
    request: DesktopChatBindingCommandRequest,
  ) => Promise<ChatCommandResponse | undefined>;
  readonly onClose: () => void;
}

const SAVE_DELAY_MS = 500;

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
  dispatch,
  command,
  onClose,
}: ChatCanvasProps): JSX.Element {
  const [layout, setLayout] = useState<ChatCanvasLayoutDto | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [groupTitle, setGroupTitle] = useState("");
  const [noteText, setNoteText] = useState("");
  const saveTimer = useRef<number | undefined>(undefined);
  const layoutRef = useRef<ChatCanvasLayoutDto | undefined>(undefined);
  layoutRef.current = layout;

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
        setLayout(response.layout);
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
  }, [command, conversationId]);

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  const save = useCallback((next: ChatCanvasLayoutDto) => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void command({
        protocol: protocol(),
        requestId: requestId(),
        command: "canvas.set-layout",
        conversationId,
        layout: layoutRef.current ?? next,
      }).then((response) => {
        if (!response?.ok) {
          setError(response?.error ?? "Canvas layout failed to save.");
        }
      }).catch((cause: unknown) => {
        setError(
          cause instanceof Error
            ? cause.message
            : "Canvas layout failed to save.",
        );
      });
    }, SAVE_DELAY_MS);
  }, [command, conversationId]);

  const update = useCallback((next: ChatCanvasLayoutDto) => {
    setLayout(next);
    save(next);
  }, [save]);

  const resolved = useMemo(
    () =>
      layout === undefined ? undefined : resolveCanvasNodes(layout, viewers),
    [layout, viewers],
  );

  if (error !== undefined) {
    return (
      <section className="desktop-chat-canvas" aria-label="Session canvas">
        <p className="desktop-chat-error" role="alert">{error}</p>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
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
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Back to chat
        </Button>
      </div>
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
              key={viewer.toolCallId}
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                update(placeViewerNode(layout, {
                  id: `node:${crypto.randomUUID()}`,
                  toolCallId: viewer.toolCallId,
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
  onRemove,
}: {
  readonly conversationId: string;
  readonly node: ChatCanvasNodeDto;
  readonly viewer: ChatToolViewerDto | undefined;
  readonly groups: readonly { readonly id: string; readonly title: string }[];
  readonly dispatch: ChatViewerDispatch | undefined;
  readonly onMove: (x: number, y: number) => void;
  readonly onGroup: (groupId: string | undefined) => void;
  readonly onRemove: () => void;
}): JSX.Element {
  const drag = useRef<{ readonly dx: number; readonly dy: number } | undefined>(
    undefined,
  );
  return (
    <article
      className="desktop-chat-canvas-node"
      style={{ left: node.x, top: node.y, zIndex: node.z }}
      aria-label={node.kind === "viewer"
        ? `Viewer ${viewer?.tool ?? ""}`
        : "Note"}
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
        <span>
          {node.kind === "viewer" ? (viewer?.tool ?? "Viewer") : "Note"}
        </span>
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
      {node.kind === "note" && <p>{node.text}</p>}
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
