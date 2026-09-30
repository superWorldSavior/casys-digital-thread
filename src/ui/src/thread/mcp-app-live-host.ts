import type {
  ChatViewerJson,
  ChatViewerResourceDto,
} from "../../../presentation/desktop/chat/contracts.ts";
import type { ThreadViewerReadResource } from "../../../presentation/workbench/thread/viewer-sessions.ts";
import {
  isMcpAppHostResourcePortOffer,
  isMcpAppHostResourceReadRequest,
  type McpAppHostResourceFetch,
  readMcpAppHostResource,
} from "./mcp-app-resource-bridge.ts";
import type {
  McpAppHostMessageEvent,
  McpAppHostPostTarget,
  McpAppHostPresentationContext,
  McpAppInlineHostContext,
} from "./mcp-app-read-only-host.ts";

/**
 * Live MCP Apps host for one desktop-chat viewer session (#50).
 *
 * Unlike the recorded Thread host, this host delivers the exact live tool
 * result of the owning MCP session and delegates provider interactions
 * back through that session: `tools/call` to the pinned tool names,
 * `resources/read` to in-scope URIs, and fingerprint port-bridge reads to
 * the exact result's registered artifacts. It is deliberately not a
 * generic MCP proxy: sampling, messages, links, model context, and
 * listing stay unimplemented and advertised as absent.
 *
 * Wire protocol observed on the pinned Build123d 0.7.1 viewers
 * (`ui://mcp-build123d/*`): ext-apps `2026-01-26` initialize handshake,
 * `ui/notifications/tool-result` for the exact result, and the Casys
 * fingerprint port bridge for artifact bytes.
 */
export const MCP_APP_LIVE_HOST_PROTOCOL_VERSION = "2026-01-26" as const;
export const MCP_APP_LIVE_HOST_VERSION = "1.0.0" as const;
export const MCP_APP_LIVE_HOST_NAME =
  "casys-desktop-chat-live-app-host" as const;

export interface McpAppLiveHostSession {
  /** Owning standalone conversation; the host never serves another. */
  readonly conversationId: string;
  readonly toolCallId: string;
  readonly server: string;
  readonly tool: string;
  readonly toolInput: Readonly<Record<string, ChatViewerJson>>;
  /** Exact captured MCP tool result, delivered verbatim, never re-executed. */
  readonly toolResult: ChatViewerJson;
  /** Probed tools of the owning session; the only names the App may call. */
  readonly serverTools: readonly string[];
  /**
   * Artifact registrations derived from the exact result. The App requests
   * by fingerprint; URIs stay host-side and bytes are attested before
   * release.
   */
  readonly readResources: readonly ThreadViewerReadResource[];
}

export interface McpAppLiveHostDelegates {
  /**
   * Call one pinned provider tool through the owning session backend.
   * Rejections surface to the App as JSON-RPC errors, never as results.
   */
  readonly callTool: (name: string, args: unknown) => Promise<unknown>;
  /**
   * Read one in-scope resource through the owning session backend.
   * Served back as an MCP blob so bytes stay lossless whatever the
   * media type; rejections surface as JSON-RPC errors.
   */
  readonly readResource: (uri: string) => Promise<ChatViewerResourceDto>;
}

export type McpAppLiveHostReadiness =
  | { readonly kind: "tool-result-delivered" }
  | {
    readonly kind: "frame-size";
    readonly width: number;
    readonly height: number;
  }
  | {
    readonly kind: "resource-read";
    readonly status: "available" | "unavailable";
    readonly reason?:
      | "not-registered"
      | "fetch-failed"
      | "identity-mismatch"
      | "too-large";
  }
  | {
    readonly kind: "tool-called";
    readonly name: string;
    readonly ok: boolean;
  };

export interface McpAppLiveHost {
  /** Accept one source-locked message. Returns false when it was ignored. */
  handleMessage(event: McpAppHostMessageEvent): boolean;
  /** Update only host-owned presentation, preserving this App document and session. */
  updateHostContext(context: McpAppHostPresentationContext): void;
  /** Permanently closes this document generation and drops pending reads. */
  invalidate(): void;
}

export interface McpAppLiveHostOptions {
  readonly target: McpAppHostPostTarget;
  readonly session: McpAppLiveHostSession;
  readonly hostContext: McpAppInlineHostContext;
  readonly delegates: McpAppLiveHostDelegates;
  readonly fetcher?: McpAppHostResourceFetch;
  readonly onReadiness?: (event: McpAppLiveHostReadiness) => void;
}

const BUILD123D_EXPORT_ARTIFACT_SCHEMA =
  "build123d-export-artifact/1.0" as const;
const ARTIFACT_SHA256 = /^[a-f0-9]{64}$/;
const ARTIFACT_URI_MAX = 500;
const ARTIFACT_MIME_MAX = 200;
const ARTIFACT_BYTES_MAX = 32 * 1024 * 1024;

/**
 * Artifact registrations derived from the exact tool result, and only from
 * it. Accepts versioned `build123d-export-artifact/1.0` records with a
 * digest, media type, byte count, and URI; every other shape is ignored so
 * unknown provider data never becomes a fetchable registration. The App
 * then reads by fingerprint through the attesting resource bridge.
 */
export function liveHostReadResources(
  toolResult: unknown,
): readonly ThreadViewerReadResource[] {
  if (!isRecord(toolResult)) return [];
  const structured = toolResult.structuredContent;
  if (!isRecord(structured)) return [];
  const files = structured.files;
  if (!Array.isArray(files)) return [];
  const seen = new Set<string>();
  const resources: ThreadViewerReadResource[] = [];
  for (const file of files) {
    const artifact = isRecord(file) ? file.artifact : undefined;
    if (!isRecord(artifact)) continue;
    if (artifact.schemaVersion !== BUILD123D_EXPORT_ARTIFACT_SCHEMA) continue;
    const uri = artifact.uri;
    const mimeType = artifact.mimeType;
    const bytes = artifact.bytes;
    const sha256 = artifact.sha256;
    if (
      typeof uri !== "string" || uri.length === 0 ||
      uri.length > ARTIFACT_URI_MAX || /\s/.test(uri) ||
      (!uri.startsWith("casys://") && !uri.startsWith("ui://"))
    ) continue;
    if (
      typeof mimeType !== "string" || mimeType.length === 0 ||
      mimeType.length > ARTIFACT_MIME_MAX
    ) continue;
    if (
      !Number.isSafeInteger(bytes) || (bytes as number) < 1 ||
      (bytes as number) > ARTIFACT_BYTES_MAX
    ) continue;
    if (typeof sha256 !== "string" || !ARTIFACT_SHA256.test(sha256)) continue;
    const fingerprint = `sha256:${sha256}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    resources.push({ uri, mimeType, bytes: bytes as number, fingerprint });
  }
  return resources;
}

const UNSUPPORTED_METHODS = new Set([
  "tools/list",
  "resources/list",
  "sampling/createMessage",
  "ui/message",
  "ui/open-link",
  "ui/update-model-context",
  "ui/compose/event",
]);

export function createMcpAppLiveHost(
  options: McpAppLiveHostOptions,
): McpAppLiveHost {
  let active = true;
  let initializedResponseSent = false;
  let resultDelivered = false;
  let pendingGeneration = 0;
  let resourcePort: MessagePort | undefined;
  let resourcePortOffersSealed = false;
  let hostContext: McpAppInlineHostContext = {
    ...presentationContext(options.hostContext),
    displayMode: "inline",
    availableDisplayModes: ["inline"],
  };
  let sentPresentation: McpAppHostPresentationContext | undefined;

  const post = (message: unknown): void => {
    if (!active) return;
    // `allow-scripts` without `allow-same-origin` gives the child an opaque
    // origin, so a more specific outgoing target origin is impossible.
    options.target.postMessage(message, "*");
  };

  const sendHostContextChanges = (): void => {
    if (!active || !resultDelivered || !sentPresentation) return;
    const changes = {
      ...(hostContext.theme !== sentPresentation.theme
        ? { theme: hostContext.theme }
        : {}),
      ...(hostContext.locale !== sentPresentation.locale
        ? { locale: hostContext.locale }
        : {}),
    };
    if (Object.keys(changes).length === 0) return;
    sentPresentation = presentationContext(hostContext);
    post({
      jsonrpc: "2.0",
      method: "ui/notifications/host-context-changed",
      params: changes,
    });
  };

  const closeResourcePort = (): void => {
    const port = resourcePort;
    resourcePort = undefined;
    pendingGeneration += 1;
    if (!port) return;
    port.onmessage = null;
    port.close();
  };

  const bindResourcePort = (ports: readonly MessagePort[]): void => {
    if (resourcePortOffersSealed || resourcePort || ports.length !== 1) {
      for (const port of ports) port.close();
      return;
    }
    const port = ports[0];
    if (!port) return;
    resourcePort = port;
    const generation = pendingGeneration;
    port.onmessage = (event: MessageEvent<unknown>): void => {
      if (
        !active || !resultDelivered || resourcePort !== port ||
        !isMcpAppHostResourceReadRequest(event.data)
      ) return;
      void readMcpAppHostResource(
        options.session.readResources,
        event.data,
        options.fetcher,
      ).then((result) => {
        if (
          !active || resourcePort !== port || generation !== pendingGeneration
        ) return;
        port.postMessage(result);
        options.onReadiness?.(
          result.status === "available"
            ? { kind: "resource-read", status: "available" }
            : {
              kind: "resource-read",
              status: "unavailable",
              reason: result.reason,
            },
        );
      });
    };
    port.start();
  };

  const handleToolCall = (
    message: JsonRpcMessage & { readonly id: string | number },
  ): void => {
    const params = isRecord(message.params) ? message.params : undefined;
    const name = params?.name;
    if (typeof name !== "string" || name.length === 0) {
      postJsonRpcError(post, message.id, -32602, "Tool call name is invalid.");
      return;
    }
    if (!options.session.serverTools.includes(name)) {
      postJsonRpcError(
        post,
        message.id,
        -32602,
        "The owning session cannot authorize this tool.",
      );
      return;
    }
    const args = params?.arguments ?? {};
    if (typeof args !== "object" || args === null || Array.isArray(args)) {
      postJsonRpcError(
        post,
        message.id,
        -32602,
        "Tool call arguments are invalid.",
      );
      return;
    }
    const generation = pendingGeneration;
    void options.delegates.callTool(name, args).then(
      (result) => {
        if (!active || generation !== pendingGeneration) return;
        post({ jsonrpc: "2.0", id: message.id, result });
        options.onReadiness?.({ kind: "tool-called", name, ok: true });
      },
      (error) => {
        if (!active || generation !== pendingGeneration) return;
        postJsonRpcError(
          post,
          message.id,
          -32603,
          error instanceof Error ? error.message : "Tool call failed.",
        );
        options.onReadiness?.({ kind: "tool-called", name, ok: false });
      },
    );
  };

  const handleResourceRead = (
    message: JsonRpcMessage & { readonly id: string | number },
  ): void => {
    const params = isRecord(message.params) ? message.params : undefined;
    const uri = params?.uri;
    if (typeof uri !== "string" || uri.length === 0) {
      postJsonRpcError(post, message.id, -32602, "Resource URI is invalid.");
      return;
    }
    const generation = pendingGeneration;
    void options.delegates.readResource(uri).then(
      (resource) => {
        if (!active || generation !== pendingGeneration) return;
        post({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            contents: [{
              uri: resource.uri,
              mimeType: resource.mimeType,
              blob: resource.data,
            }],
          },
        });
        options.onReadiness?.({ kind: "resource-read", status: "available" });
      },
      (error) => {
        if (!active || generation !== pendingGeneration) return;
        postJsonRpcError(
          post,
          message.id,
          -32603,
          error instanceof Error ? error.message : "Resource read failed.",
        );
        options.onReadiness?.({
          kind: "resource-read",
          status: "unavailable",
          reason: "fetch-failed",
        });
      },
    );
  };

  const handleMessage = (event: McpAppHostMessageEvent): boolean => {
    if (
      !active || event.source !== options.target || event.origin !== "null"
    ) return false;

    if (isMcpAppHostResourcePortOffer(event.data)) {
      bindResourcePort(event.ports ?? []);
      return true;
    }

    if (!isJsonRpcMessage(event.data)) return false;
    const message = event.data;

    if (message.method === "ui/initialize") {
      if (!hasRequestId(message)) return false;
      if (initializedResponseSent) {
        postJsonRpcError(
          post,
          message.id,
          -32600,
          "App document is already initialized.",
        );
        return true;
      }
      if (!matchesLiveHandshake(message.params)) {
        postJsonRpcError(
          post,
          message.id,
          -32602,
          "App handshake is outside the live host protocol.",
        );
        return true;
      }
      // The App posts its one-shot port offer before connect/initialize.
      // Messages from that child are delivered FIFO, so accepting the exact
      // initialize request closes the bootstrap window without racing the
      // browser's earlier iframe load event.
      resourcePortOffersSealed = true;
      post({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: MCP_APP_LIVE_HOST_PROTOCOL_VERSION,
          hostInfo: {
            name: MCP_APP_LIVE_HOST_NAME,
            version: MCP_APP_LIVE_HOST_VERSION,
          },
          // Absence is authoritative: no sampling, message, link, model
          // context, or tool-listing capability exists in this host.
          // `tools/call` works by convention for pinned names only.
          hostCapabilities: {},
          hostContext: { ...hostContext },
        },
      });
      sentPresentation = presentationContext(hostContext);
      initializedResponseSent = true;
      return true;
    }

    if (message.method === "ui/notifications/initialized") {
      if (!initializedResponseSent) return false;
      if (hasRequestId(message)) {
        post({ jsonrpc: "2.0", id: message.id, result: {} });
      }
      if (!resultDelivered) {
        resultDelivered = true;
        // Presentation may have changed while the App accepted initialize.
        // Deliver that latest context before the exact call: input first,
        // then result, mirroring a live tool call.
        sendHostContextChanges();
        post({
          jsonrpc: "2.0",
          method: "ui/notifications/tool-input",
          params: { arguments: structuredClone(options.session.toolInput) },
        });
        post({
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params: structuredClone(options.session.toolResult),
        });
        options.onReadiness?.({ kind: "tool-result-delivered" });
      }
      return true;
    }

    if (message.method === "ui/request-display-mode") {
      if (!hasRequestId(message)) return false;
      post({
        jsonrpc: "2.0",
        id: message.id,
        result: { mode: "inline" },
      });
      return true;
    }

    if (message.method === "ui/notifications/size-changed") {
      if (hasRequestId(message)) {
        post({ jsonrpc: "2.0", id: message.id, result: {} });
      }
      const params = isRecord(message.params) ? message.params : undefined;
      const width = params?.width;
      const height = params?.height;
      if (
        typeof width === "number" && Number.isInteger(width) && width > 0 &&
        width <= 4096 && typeof height === "number" &&
        Number.isInteger(height) && height > 0 && height <= 4096
      ) {
        options.onReadiness?.({ kind: "frame-size", width, height });
      }
      return true;
    }

    if (message.method === "tools/call") {
      if (!hasRequestId(message)) return false;
      // Lifecycle order: no delegate invocation before the App accepted
      // initialize. Same pinned authority, but never out of order.
      if (!initializedResponseSent) {
        postJsonRpcError(
          post,
          message.id,
          -32600,
          "The App session is not initialized.",
        );
        return true;
      }
      handleToolCall(message);
      return true;
    }

    if (message.method === "resources/read") {
      if (!hasRequestId(message)) return false;
      if (!initializedResponseSent) {
        postJsonRpcError(
          post,
          message.id,
          -32600,
          "The App session is not initialized.",
        );
        return true;
      }
      handleResourceRead(message);
      return true;
    }

    if (UNSUPPORTED_METHODS.has(message.method)) {
      if (hasRequestId(message)) {
        postJsonRpcError(
          post,
          message.id,
          -32601,
          `Live App host does not implement ${message.method}.`,
        );
      }
      return true;
    }

    if (hasRequestId(message)) {
      postJsonRpcError(
        post,
        message.id,
        -32601,
        `Live App host does not implement ${message.method}.`,
      );
      return true;
    }
    return false;
  };

  return {
    handleMessage,
    updateHostContext(context): void {
      if (!active) return;
      hostContext = { ...hostContext, ...presentationContext(context) };
      sendHostContextChanges();
    },
    invalidate(): void {
      if (!active) return;
      active = false;
      closeResourcePort();
    },
  };
}

/**
 * The framed document is already attested byte-for-byte before framing, so
 * the App proves nothing by naming itself. The host only pins the wire
 * generation it implements and the capabilities record shape.
 */
function matchesLiveHandshake(params: unknown): boolean {
  if (!isRecord(params) || !isRecord(params.appInfo)) return false;
  return params.protocolVersion === MCP_APP_LIVE_HOST_PROTOCOL_VERSION &&
    isRecord(params.appCapabilities);
}

/** Copy an explicit presentation allowlist; never forward capability or session fields. */
function presentationContext(
  value: McpAppHostPresentationContext,
): McpAppHostPresentationContext {
  return {
    ...(value.theme === "light" || value.theme === "dark"
      ? { theme: value.theme }
      : {}),
    ...(typeof value.locale === "string" && value.locale.trim().length > 0
      ? { locale: value.locale.trim() }
      : {}),
  };
}

interface JsonRpcMessage extends Record<string, unknown> {
  readonly jsonrpc: "2.0";
  readonly method: string;
}

function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  return isRecord(value) && value.jsonrpc === "2.0" &&
    typeof value.method === "string" && value.method.length > 0;
}

function hasRequestId(
  message: JsonRpcMessage,
): message is JsonRpcMessage & { readonly id: string | number } {
  return Object.prototype.hasOwnProperty.call(message, "id") &&
    (typeof message.id === "string" ||
      (typeof message.id === "number" && Number.isFinite(message.id)));
}

function postJsonRpcError(
  post: (message: unknown) => void,
  id: string | number,
  code: number,
  message: string,
): void {
  post({ jsonrpc: "2.0", id, error: { code, message } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
