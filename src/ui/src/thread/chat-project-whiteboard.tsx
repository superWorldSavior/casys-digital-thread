import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX, PointerEvent } from "react";
import { createPortal } from "react-dom";
import type { ChatProjectViewerDto } from "../../../presentation/desktop/chat/contracts.ts";
import { Button } from "../ui/button.tsx";
import {
  type ProjectWhiteboardHost,
  projectWhiteboardHost,
  requestProjectWhiteboard,
  subscribeProjectWhiteboardHost,
} from "../ui/project-whiteboard-host.ts";
import { whiteboardViewer, whiteboardViewerPart } from "../ui/whiteboard.ts";
import {
  expandProjectMcpWindow,
  loadProjectMcpWindows,
  moveProjectMcpWindow,
  openProjectMcpWindow,
  type ProjectMcpWindow,
  projectViewerKey,
  reconcileProjectMcpWindows,
  removeProjectMcpWindow,
  resizeProjectMcpWindow,
  restoreProjectMcpWindow,
  saveProjectMcpWindows,
} from "./chat-project-whiteboard-model.ts";
import {
  type ChatViewerDispatch,
  ChatViewerPanel,
} from "./chat-viewer-panel.tsx";

interface ViewerRequest {
  readonly owningConversationId: string;
  readonly viewerId: string;
  readonly sequence: number;
}

function projectWindowStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function arrowDelta(
  key: string,
  step: number,
): readonly [number, number] | undefined {
  const directions: Readonly<Record<string, readonly [number, number]>> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  return directions[key];
}

export function ChatProjectWhiteboard({
  projectId,
  viewers,
  dispatch,
  requestedViewer,
}: {
  readonly projectId: string;
  readonly viewers: readonly ChatProjectViewerDto[] | undefined;
  readonly dispatch: ChatViewerDispatch;
  readonly requestedViewer?: ViewerRequest;
}): JSX.Element | null {
  const [host, setHost] = useState(() => projectWhiteboardHost(projectId));
  const [storage] = useState(projectWindowStorage);
  const [windows, setWindows] = useState<readonly ProjectMcpWindow[]>(() =>
    storage === undefined ? [] : loadProjectMcpWindows(storage, projectId) ?? []
  );
  const currentWindows = useRef(windows);
  const [activeId, setActiveId] = useState<string>();
  const [saveFailed, setSaveFailed] = useState(false);
  const requestedSequence = useRef<number>();
  const pendingOpen = useRef<ChatProjectViewerDto>();
  useEffect(() => subscribeProjectWhiteboardHost(projectId, setHost), [
    projectId,
  ]);

  const update = useCallback((next: readonly ProjectMcpWindow[]) => {
    if (next === currentWindows.current) return;
    currentWindows.current = next;
    setWindows(next);
    setSaveFailed(
      storage === undefined || !saveProjectMcpWindows(storage, projectId, next),
    );
  }, [projectId, storage]);

  const open = useCallback((reference: ChatProjectViewerDto) => {
    if (reference.workspaceProjectId !== projectId) return;
    if (host === undefined) {
      pendingOpen.current = reference;
      requestProjectWhiteboard(projectId);
      return;
    }
    const geometry = host === undefined ? undefined : {
      x: (24 - host.transform.x) / host.transform.k,
      y: (56 - host.transform.y) / host.transform.k,
      width: Math.min(760, Math.max(320, host.viewport.clientWidth - 48)) /
        host.transform.k,
      height: Math.min(600, Math.max(220, host.viewport.clientHeight - 88)) /
        host.transform.k,
    };
    const next = openProjectMcpWindow(
      projectId,
      currentWindows.current,
      reference,
      geometry,
    );
    update(next);
    setActiveId(
      projectViewerKey(
        reference.owningConversationId,
        reference.viewer.viewerId,
      ),
    );
    requestProjectWhiteboard(projectId);
    const selected = next.find((window) =>
      window.id ===
        projectViewerKey(
          reference.owningConversationId,
          reference.viewer.viewerId,
        )
    );
    if (selected !== undefined) host.reveal?.(selected);
  }, [host, projectId, update]);

  useEffect(() => {
    if (
      host === undefined || pendingOpen.current === undefined ||
      viewers === undefined
    ) return;
    const pending = pendingOpen.current;
    pendingOpen.current = undefined;
    const exact = viewers.find((entry) =>
      entry.workspaceProjectId === projectId &&
      entry.owningConversationId === pending.owningConversationId &&
      entry.viewer.viewerId === pending.viewer.viewerId
    );
    if (exact !== undefined) open(exact);
  }, [host, viewers, projectId, open]);

  // New results join the list without changing the current view or inspector.
  // Only an explicit result request or list action opens and focuses a window.

  useEffect(() => {
    if (
      !requestedViewer ||
      requestedSequence.current === requestedViewer.sequence ||
      viewers === undefined
    ) return;
    const exact = viewers.find((entry) =>
      entry.workspaceProjectId === projectId &&
      entry.owningConversationId === requestedViewer.owningConversationId &&
      entry.viewer.viewerId === requestedViewer.viewerId
    );
    if (exact === undefined) return;
    requestedSequence.current = requestedViewer.sequence;
    open(exact);
  }, [requestedViewer, viewers, projectId, open]);

  if (!host) return null;
  const resolved = reconcileProjectMcpWindows(
    projectId,
    windows,
    viewers ?? [],
  );
  const entries =
    viewers?.filter((entry) => entry.workspaceProjectId === projectId) ?? [];
  const anchor = {
    left: (host.viewport.clientWidth - 12 - host.transform.x) /
      host.transform.k,
    top: (host.viewport.clientHeight - 12 - host.transform.y) /
      host.transform.k,
    transform: `scale(${1 / host.transform.k}) translate(-100%, -100%)`,
    transformOrigin: "top left",
  };
  return createPortal(
    <>
      <details className="desktop-chat-project-results" style={anchor}>
        <summary>Conversation results · {entries.length}</summary>
        {viewers === undefined
          ? <p role="status">Project results are unavailable.</p>
          : entries.length === 0
          ? (
            <p>
              Results from this project's tool conversations will appear here.
            </p>
          )
          : (
            <div>
              {entries.map((entry) => (
                <Button
                  key={projectViewerKey(
                    entry.owningConversationId,
                    entry.viewer.viewerId,
                  )}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => open(entry)}
                >
                  {entry.viewer.tool}
                </Button>
              ))}
            </div>
          )}
      </details>
      {saveFailed && (
        <div
          role="alert"
          className="desktop-chat-project-notice"
          style={{
            ...anchor,
            top: (host.viewport.clientHeight - 56 - host.transform.y) /
              host.transform.k,
          }}
        >
          <p>Window positions could not be saved. They remain visible here.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setSaveFailed(
                storage === undefined ||
                  !saveProjectMcpWindows(
                    storage,
                    projectId,
                    currentWindows.current,
                  ),
              )}
          >
            Retry saving
          </Button>
        </div>
      )}
      {resolved.map(({ window, reference, status }) => (
        <ProjectWindow
          key={window.id}
          window={window}
          host={host}
          reference={reference}
          available={viewers !== undefined && status === "available"}
          active={activeId === window.id}
          dispatch={dispatch}
          onActivate={() => reference !== undefined && open(reference)}
          onClose={() => {
            update(removeProjectMcpWindow(currentWindows.current, window.id));
            if (activeId === window.id) setActiveId(undefined);
          }}
          onMove={(x, y) =>
            update(
              moveProjectMcpWindow(currentWindows.current, window.id, x, y),
            )}
          onResize={(width, height) =>
            update(
              resizeProjectMcpWindow(
                currentWindows.current,
                window.id,
                width,
                height,
              ),
            )}
          onExpand={() => {
            if (window.expanded) {
              update(
                restoreProjectMcpWindow(currentWindows.current, window.id),
              );
            } else {update(
                expandProjectMcpWindow(currentWindows.current, window.id, {
                  x: (12 - host.transform.x) / host.transform.k,
                  y: (12 - host.transform.y) / host.transform.k,
                  width: (host.viewport.clientWidth - 24) / host.transform.k,
                  height: (host.viewport.clientHeight - 24) / host.transform.k,
                }),
              );}
          }}
        />
      ))}
    </>,
    host.element,
  );
}

function ProjectWindow(
  {
    window,
    host,
    reference,
    available,
    active,
    dispatch,
    onActivate,
    onClose,
    onMove,
    onResize,
    onExpand,
  }: {
    readonly window: ProjectMcpWindow;
    readonly host: ProjectWhiteboardHost;
    readonly reference: ChatProjectViewerDto | undefined;
    readonly available: boolean;
    readonly active: boolean;
    readonly dispatch: ChatViewerDispatch;
    readonly onActivate: () => void;
    readonly onClose: () => void;
    readonly onMove: (x: number, y: number) => void;
    readonly onResize: (width: number, height: number) => void;
    readonly onExpand: () => void;
  },
): JSX.Element {
  const gesture = useRef<{
    mode: "move" | "resize";
    pointerId: number;
    x: number;
    y: number;
    start: ProjectMcpWindow;
    scale: number;
  }>();
  const title = reference?.viewer.tool ?? "Unavailable result";
  const start = (event: PointerEvent<HTMLElement>, mode: "move" | "resize") => {
    if (event.button !== 0 || window.expanded) return;
    if (
      mode === "move" &&
      (event.target as HTMLElement).closest(
        "button, input, select, textarea, a",
      )
    ) return;
    event.preventDefault();
    event.stopPropagation();
    gesture.current = {
      mode,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      start: window,
      scale: host.transform.k,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const state = gesture.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = (event.clientX - state.x) / state.scale;
    const dy = (event.clientY - state.y) / state.scale;
    if (state.mode === "move") onMove(state.start.x + dx, state.start.y + dy);
    else onResize(state.start.width + dx, state.start.height + dy);
  };
  const end = () => {
    gesture.current = undefined;
  };
  return (
    <article
      className={`${
        whiteboardViewer({ expanded: window.expanded === true })
      } desktop-chat-project-window${active ? " is-active" : ""}`}
      style={{
        position: "absolute",
        left: window.x,
        top: window.y,
        width: window.width,
        height: window.height,
        zIndex: window.z,
      }}
      aria-label={`${title} on project whiteboard`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <header
        className={`${
          whiteboardViewerPart({ part: "handle" })
        } desktop-chat-project-window-header`}
        tabIndex={0}
        onPointerDown={(event) => start(event, "move")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 32 : 8;
          const delta = arrowDelta(event.key, step);
          if (
            !delta || event.target !== event.currentTarget || window.expanded
          ) return;
          event.preventDefault();
          onMove(window.x + delta[0], window.y + delta[1]);
        }}
      >
        <span className={whiteboardViewerPart({ part: "title" })}>{title}</span>
        <div className={whiteboardViewerPart({ part: "actions" })}>
          {available && !active && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onActivate}
            >
              Open
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={onExpand}>
            {window.expanded ? "Restore" : "Enlarge"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label={`Close ${title}`}
          >
            ×
          </Button>
        </div>
      </header>
      <div
        className="desktop-chat-project-window-body"
        onWheel={(event) => event.stopPropagation()}
      >
        {available && reference !== undefined && active
          ? (
            <ChatViewerPanel
              key={projectViewerKey(
                reference.owningConversationId,
                reference.viewer.viewerId,
              )}
              conversationId={reference.owningConversationId}
              viewers={[reference.viewer]}
              messageId={reference.viewer.messageId}
              dispatch={dispatch}
              autoOpenViewerId={reference.viewer.viewerId}
            />
          )
          : (
            <p>
              {available
                ? "Open this result to work with its app."
                : "This result is no longer available from its original conversation."}
            </p>
          )}
      </div>
      {!window.expanded && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="desktop-chat-project-window-resize"
          aria-label={`Resize ${title}`}
          onPointerDown={(event) => start(event, "resize")}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onLostPointerCapture={end}
          onKeyDown={(event) => {
            const delta = arrowDelta(event.key, 16);
            if (!delta) return;
            event.preventDefault();
            onResize(window.width + delta[0], window.height + delta[1]);
          }}
        >
          ↘
        </Button>
      )}
    </article>
  );
}
