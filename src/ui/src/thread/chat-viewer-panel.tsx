import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { Button } from "../ui/button.tsx";
import type {
  ChatToolViewerDto,
  ChatViewerAppBytesDto,
  ChatViewerJson,
  ChatViewerResourceDto,
  ChatViewerSessionDto,
} from "../../../presentation/desktop/chat/contracts.ts";
import { ChatMcpAppViewer } from "./chat-mcp-app-viewer.tsx";
import {
  liveHostReadResources,
  type McpAppLiveHostSession,
} from "./mcp-app-live-host.ts";

/** Quiet owning-session dispatch; failures throw instead of touching chat UI state. */
export interface ChatViewerDispatch {
  readonly openViewer: (
    conversationId: string,
    viewerId: string,
  ) => Promise<ChatViewerSessionDto>;
  readonly callViewerTool: (
    conversationId: string,
    viewerId: string,
    name: string,
    args: unknown,
  ) => Promise<ChatViewerJson>;
  readonly readViewerResource: (
    conversationId: string,
    viewerId: string,
    uri: string,
  ) => Promise<ChatViewerResourceDto>;
  readonly fetchApp: (
    server: string,
    uri: string,
    fingerprint: string,
  ) => Promise<ChatViewerAppBytesDto>;
  readonly saveFile: (
    fileName: string,
    data: string,
  ) => Promise<{ readonly path: string; readonly bytes: number }>;
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export interface ChatViewerPanelProps {
  readonly conversationId: string;
  readonly viewers: readonly ChatToolViewerDto[];
  readonly messageId: string;
  readonly dispatch: ChatViewerDispatch;
}

type ViewerState =
  | { readonly phase: "idle" }
  | { readonly phase: "opening" }
  | {
    readonly phase: "live";
    readonly app: ChatViewerAppBytesDto;
    readonly session: McpAppLiveHostSession;
    readonly generation: number;
  }
  | { readonly phase: "error"; readonly error: string };

/**
 * Per-message live viewer affordance for one standalone conversation.
 *
 * Each captured tool result opens its expected App with the exact result;
 * the opened generation is bound to this conversation and tool call, so
 * switching conversations (which remounts the parent) can never show
 * another session's data.
 */
export function ChatViewerPanel({
  conversationId,
  viewers,
  messageId,
  dispatch,
}: ChatViewerPanelProps): JSX.Element | null {
  const entries = viewers.filter((viewer) => viewer.messageId === messageId);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [state, setState] = useState<ViewerState>({ phase: "idle" });
  // Monotonic open token: only the latest open() may publish its session.
  // Buttons disable while opening, but only after re-render; two rapid
  // invocations can interleave and a stale finish must never mount session
  // A with delegates pinned to tool call B.
  const openToken = useRef(0);
  const live = selected !== undefined
    ? entries.find((entry) => entry.viewerId === selected)
    : undefined;

  const open = useCallback(async (viewerId: string) => {
    openToken.current += 1;
    const token = openToken.current;
    setSelected(viewerId);
    setState({ phase: "opening" });
    try {
      const opened = await dispatch.openViewer(conversationId, viewerId);
      // Never mount session data under a different retained-result identity than
      // the delegates and frame key bind: fail the open instead of mixing.
      if (opened.viewerId !== viewerId) {
        throw new Error("Viewer session identity changed during open.");
      }
      const app = await dispatch.fetchApp(
        opened.server,
        opened.app.uri,
        opened.app.fingerprint,
      );
      if (openToken.current !== token) return;
      setState({
        phase: "live",
        app,
        session: {
          conversationId,
          toolCallId: opened.toolCallId,
          server: opened.server,
          tool: opened.tool,
          toolInput: opened.toolInput,
          toolResult: opened.toolResult,
          serverTools: opened.serverTools,
          readResources: liveHostReadResources(opened.toolResult),
        },
        generation: 0,
      });
    } catch (cause) {
      if (openToken.current !== token) return;
      setState({
        phase: "error",
        error: cause instanceof Error
          ? cause.message
          : "Viewer failed to open.",
      });
    }
  }, [conversationId, dispatch]);

  useEffect(() => {
    // Invalidate any open() still in flight from the previous conversation.
    openToken.current += 1;
    setSelected(undefined);
    setState({ phase: "idle" });
  }, [conversationId]);

  if (entries.length === 0) return null;
  return (
    <div className="desktop-chat-viewers">
      {entries.map((entry) => (
        <Button
          key={entry.viewerId}
          type="button"
          variant="outline"
          size="sm"
          disabled={state.phase === "opening"}
          onClick={() => void open(entry.viewerId)}
        >
          {state.phase !== "idle" && selected === entry.viewerId
            ? "Reload result viewer"
            : `View ${entry.tool} result`}
        </Button>
      ))}
      {state.phase === "opening" && (
        <p className="desktop-chat-viewer-status" role="status">
          Opening the provider viewer with the exact result…
        </p>
      )}
      {state.phase === "error" && (
        <p className="desktop-chat-error" role="alert">
          {state.error} {live && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void open(live.viewerId)}
            >
              Retry
            </Button>
          )}
        </p>
      )}
      {state.phase === "live" && live && (
        <>
          <ChatMcpAppViewer
            key={`${conversationId}:${live.viewerId}:${state.generation}`}
            app={state.app}
            session={state.session}
            callTool={(name, args) =>
              dispatch.callViewerTool(
                conversationId,
                live.viewerId,
                name,
                args,
              )}
            readResource={(uri) =>
              dispatch.readViewerResource(conversationId, live.viewerId, uri)}
            title={`${live.tool} result viewer`}
            onClose={() => {
              setSelected(undefined);
              setState({ phase: "idle" });
            }}
            onRetry={() =>
              setState((current) =>
                current.phase === "live"
                  ? { ...current, generation: current.generation + 1 }
                  : current
              )}
          />
          <ViewerExports
            conversationId={conversationId}
            viewer={live}
            session={state.session}
            dispatch={dispatch}
          />
        </>
      )}
    </div>
  );
}

function ViewerExports({
  conversationId,
  viewer,
  session,
  dispatch,
}: {
  readonly conversationId: string;
  readonly viewer: ChatToolViewerDto;
  readonly session: McpAppLiveHostSession;
  readonly dispatch: ChatViewerDispatch;
}): JSX.Element {
  const [note, setNote] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const revision = viewer.archive?.revision;
  const artifacts = viewer.archive?.artifacts ?? [];

  const run = async (task: () => Promise<string>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setNote(undefined);
    try {
      setNote(await task());
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  };

  const exportSource = (): Promise<void> =>
    run(async () => {
      const script = session.toolInput.script;
      const text = typeof script === "string"
        ? script
        : JSON.stringify(session.toolInput, null, 2);
      // No fabricated version for unsaved legacy entries: revision stays
      // out of the name when the manifest never recorded one.
      const tag = revision === undefined ? "source" : `v${revision}`;
      const fileName = typeof script === "string"
        ? `${viewer.tool}-${tag}.py`
        : `${viewer.tool}-${tag}-input.json`;
      const data = base64FromBytes(new TextEncoder().encode(text));
      const saved = await dispatch.saveFile(fileName, data);
      return `Saved ${saved.path} (${saved.bytes} bytes).`;
    });

  const exportArtifact = (uri: string, fileName: string): Promise<void> =>
    run(async () => {
      const resource = await dispatch.readViewerResource(
        conversationId,
        viewer.viewerId,
        uri,
      );
      const saved = await dispatch.saveFile(fileName, resource.data);
      const origin = resource.source === "saved" ? "saved bytes" : "live read";
      return `Saved ${saved.path} (${saved.bytes} bytes, ${origin}).`;
    });

  return (
    <div className="desktop-chat-viewer-exports">
      <span>Exports</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => void exportSource()}
      >
        Export source
      </Button>
      {artifacts.map((artifact) => (
        <span key={artifact.sha256}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            title={artifact.state === "missing"
              ? `Try a live read; retained bytes are missing: ${
                artifact.reason ?? "Bytes were not retained."
              }`
              : `Export ${artifact.fileName}`}
            onClick={() => void exportArtifact(artifact.uri, artifact.fileName)}
          >
            Export {artifact.fileName}
          </Button>
          {artifact.state === "missing" && (
            <span>{artifact.reason ?? "Bytes were not retained."}</span>
          )}
        </span>
      ))}
      {note !== undefined && (
        <p className="desktop-chat-viewer-status" role="status">{note}</p>
      )}
    </div>
  );
}
