import type { CSSProperties, JSX } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import type {
  ChatViewerAppBytesDto,
  ChatViewerJson,
  ChatViewerResourceDto,
} from "../../../presentation/desktop/chat/contracts.ts";
import {
  createMcpAppLiveHost,
  type McpAppLiveHostSession,
} from "./mcp-app-live-host.ts";
import {
  materializeMcpAppDocument,
  MCP_APP_DOCUMENT_MIME_TYPE,
  planMcpAppDocument,
  readMcpAppHostScriptNonce,
} from "./mcp-app-document-loader.ts";
import {
  advanceMcpAppFrameStatus,
  type McpAppFrameStatus,
  mcpAppFrameStatusAllowsRetry,
  mcpAppFrameStatusCoversFrame,
  mcpAppFrameStatusLabel,
} from "./mcp-app-frame-status.ts";
import { resolveMcpAppTheme } from "./mcp-app-frame-theme.ts";

export interface ChatMcpAppViewerProps {
  /** Whole App bytes fetched desktop-side, attested here before framing. */
  readonly app: ChatViewerAppBytesDto;
  /** Owning-session viewer session from `viewer.open`. */
  readonly session: McpAppLiveHostSession;
  readonly callTool: (
    name: string,
    args: unknown,
  ) => Promise<ChatViewerJson>;
  readonly readResource: (uri: string) => Promise<ChatViewerResourceDto>;
  readonly title: string;
  readonly onClose: () => void;
  readonly onRetry: () => void;
}

/**
 * Live MCP App window for one desktop-chat viewer session.
 *
 * One document generation: the pinned bytes are attested (length, MIME,
 * SHA-256, single-file form) before an opaque-origin blob frame is armed,
 * then the exact tool result is delivered once and artifact reads resolve
 * through the owning session. A later child navigation quarantines the
 * generation instead of inheriting its session.
 */
export function ChatMcpAppViewer({
  app,
  session,
  callTool,
  readResource,
  title,
  onClose,
  onRetry,
}: ChatMcpAppViewerProps): JSX.Element {
  const mount = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<McpAppFrameStatus>({
    kind: "loading",
    stage: "starting",
  });
  const [notice, setNotice] = useState<string | undefined>(undefined);
  // Inline-mode frame height follows the App's size reports, clamped so a
  // runaway document cannot collapse the viewer or blow up the transcript.
  const [frameHeight, setFrameHeight] = useState(560);
  const live = useRef({
    session,
    callTool,
    readResource,
  });
  live.current = { session, callTool, readResource };

  useLayoutEffect(() => {
    const mountNode = mount.current;
    if (!mountNode) return;
    let cancelled = false;
    let status: McpAppFrameStatus = { kind: "loading", stage: "starting" };
    const render = (next: McpAppFrameStatus): void => {
      status = advanceMcpAppFrameStatus(status, next);
      if (!cancelled) setStatus(status);
    };
    render(status);

    const frameNode = document.createElement("iframe");
    frameNode.className = "chat-mcp-app-frame";
    frameNode.title = title;
    frameNode.setAttribute("sandbox", "allow-scripts");
    frameNode.referrerPolicy = "no-referrer";
    frameNode.loading = "eager";
    // Self-sufficient sizing: never depend on host stylesheets for the
    // frame box, or the App lays out in the 300x150 default.
    frameNode.style.border = "0";
    frameNode.style.display = "block";
    frameNode.style.width = "100%";
    frameNode.style.height = "100%";
    mountNode.append(frameNode);

    let phase: "starting" | "loading-app" | "app-loaded" | "invalid" =
      "starting";
    let finished = false;
    let revoked = false;
    let documentUrl: string | undefined;
    const revokeDocument = (): void => {
      if (revoked) return;
      revoked = true;
      if (documentUrl !== undefined) URL.revokeObjectURL(documentUrl);
      documentUrl = undefined;
    };

    const host = createMcpAppLiveHost({
      target: frameNode.contentWindow ?? {
        postMessage: () => {},
      },
      session: live.current.session,
      hostContext: {
        ...resolvedPresentationContext(),
        displayMode: "inline",
        availableDisplayModes: ["inline"],
      },
      delegates: {
        callTool: (name, args) => live.current.callTool(name, args),
        readResource: (uri) => live.current.readResource(uri),
      },
      fetcher: async (input) => {
        const uri = String(input);
        const resource = await live.current.readResource(uri);
        const bytes = base64ToBytes(resource.data);
        const body = new Uint8Array(bytes.byteLength);
        body.set(bytes);
        return new Response(body.buffer as ArrayBuffer, {
          status: 200,
          headers: {
            "content-type": resource.mimeType,
            "content-length": String(resource.bytes),
          },
        });
      },
      onReadiness: (event) => {
        if (cancelled) return;
        if (event.kind === "tool-result-delivered") {
          render({ kind: "session-accepted" });
          return;
        }
        if (event.kind === "frame-size") {
          setFrameHeight(Math.min(720, Math.max(320, event.height)));
          return;
        }
        if (event.kind === "resource-read") {
          render({
            kind: "resource-delivered",
            status: event.status,
            ...(event.status === "unavailable" ? { reason: event.reason } : {}),
          });
          if (event.status === "unavailable") {
            setNotice(`Resource read ${event.reason ?? "failed"}.`);
          }
          return;
        }
        if (!event.ok) {
          setNotice(
            `Tool ${event.name} failed; the provider state is unchanged.`,
          );
        }
      },
    });

    const onMessage = (event: MessageEvent<unknown>): void => {
      host.handleMessage(event);
    };
    globalThis.addEventListener("message", onMessage);

    const advanceLoad = (): void => {
      if (cancelled || phase === "invalid") return;
      if (phase === "loading-app") {
        phase = "app-loaded";
        render({ kind: "loading", stage: "awaiting-session" });
        return;
      }
      if (phase !== "app-loaded") return;
      // A WindowProxy and opaque origin survive a child navigation. Do not
      // let a replacement document inherit the registered session.
      phase = "invalid";
      finished = true;
      revokeDocument();
      host.invalidate();
      render({ kind: "error", reason: "document-replaced" });
    };
    const onFrameError = (): void => {
      if (cancelled || finished) return;
      phase = "invalid";
      finished = true;
      revokeDocument();
      host.invalidate();
      render({ kind: "error", reason: "frame-error" });
    };
    frameNode.addEventListener("load", advanceLoad);
    frameNode.addEventListener("error", onFrameError);

    void (async () => {
      try {
        render({ kind: "loading", stage: "fetching-document" });
        const bytes = base64ToBytes(live.current.session && app.data);
        if (bytes.byteLength !== app.bytes) {
          throw new Error("byte count changed");
        }
        if (app.mimeType !== MCP_APP_DOCUMENT_MIME_TYPE) {
          throw new Error("MIME type changed");
        }
        const fingerprint = await sha256Fingerprint(bytes);
        if (fingerprint !== app.fingerprint) {
          throw new Error("fingerprint changed");
        }
        if (cancelled || phase !== "starting") return;
        let html: string;
        try {
          html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          throw new Error("not valid UTF-8");
        }
        const nonce = readMcpAppHostScriptNonce();
        const transformed = materializeMcpAppDocument(
          planMcpAppDocument(html),
          nonce,
        );
        if (cancelled || phase !== "starting") return;
        documentUrl = URL.createObjectURL(
          new Blob([transformed], { type: "text/html;charset=utf-8" }),
        );
        if (!documentUrl.startsWith("blob:")) {
          throw new Error("object URL is invalid");
        }
        phase = "loading-app";
        render({ kind: "loading", stage: "loading-document" });
        frameNode.src = documentUrl;
      } catch {
        if (cancelled || finished) return;
        phase = "invalid";
        finished = true;
        revokeDocument();
        host.invalidate();
        render({ kind: "unavailable", reason: "document-invalid" });
      }
    })();

    const updatePresentation = (): void => {
      host.updateHostContext(resolvedPresentationContext());
    };
    const presentationObserver = new MutationObserver(updatePresentation);
    presentationObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class", "style", "lang"],
    });
    const themePreference = globalThis.matchMedia?.(
      "(prefers-color-scheme: dark)",
    );
    themePreference?.addEventListener("change", updatePresentation);
    globalThis.addEventListener("languagechange", updatePresentation);

    return () => {
      cancelled = true;
      phase = "invalid";
      presentationObserver.disconnect();
      themePreference?.removeEventListener("change", updatePresentation);
      globalThis.removeEventListener("languagechange", updatePresentation);
      globalThis.removeEventListener("message", onMessage);
      frameNode.removeEventListener("load", advanceLoad);
      frameNode.removeEventListener("error", onFrameError);
      revokeDocument();
      host.invalidate();
      frameNode.remove();
    };
    // One exact document generation per viewer session mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.conversationId, session.toolCallId]);

  const covers = mcpAppFrameStatusCoversFrame(status);
  return (
    <section
      className="chat-mcp-app-viewer"
      aria-label={title}
      data-conversation={session.conversationId}
      data-tool-call={session.toolCallId}
    >
      <header className="chat-mcp-app-viewer-header">
        <div>
          <p className="chat-mcp-app-viewer-title">{title}</p>
          <p className="chat-mcp-app-viewer-identity">
            <code>{session.tool}</code> · {session.server} · live session
          </p>
        </div>
        <button type="button" onClick={onClose}>
          Close viewer
        </button>
      </header>
      <div
        ref={mount}
        className="chat-mcp-app-viewer-mount"
        style={{
          position: "relative",
          display: "grid",
          width: "100%",
          height: frameHeight,
          minHeight: 0,
        } as CSSProperties}
      >
        {covers && (
          <div className="chat-mcp-app-viewer-overlay" role="status">
            <p>{mcpAppFrameStatusLabel(status)}</p>
            {mcpAppFrameStatusAllowsRetry(status) && (
              <button type="button" onClick={onRetry}>
                Retry viewer
              </button>
            )}
          </div>
        )}
      </div>
      {notice && (
        <p className="chat-mcp-app-viewer-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}

function resolvedPresentationContext(): {
  readonly theme: "light" | "dark";
  readonly locale?: string;
} {
  const root = document.documentElement;
  const theme = resolveMcpAppTheme({
    dataTheme: root.dataset.theme,
    darkClass: root.classList.contains("dark"),
    lightClass: root.classList.contains("light"),
    colorScheme: globalThis.getComputedStyle?.(root).colorScheme,
    prefersDark: globalThis.matchMedia?.("(prefers-color-scheme: dark)")
      .matches ?? false,
  });
  const locale = root.lang.trim() || globalThis.navigator?.language;
  return { theme, ...(locale ? { locale } : {}) };
}

function base64ToBytes(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function sha256Fingerprint(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return `sha256:${
    [...new Uint8Array(digest)].map((byte) =>
      byte.toString(16).padStart(2, "0")
    ).join(
      "",
    )
  }`;
}
