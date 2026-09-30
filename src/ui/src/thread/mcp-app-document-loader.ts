import {
  MCP_APP_HOST_MAX_RESOURCE_BYTES,
  type ThreadViewerSession,
} from "../../../presentation/workbench/thread/viewer-sessions.ts";

export const MCP_APP_SCRIPT_NONCE_META_NAME =
  "casys-mcp-app-script-nonce" as const;
export const MCP_APP_DOCUMENT_MIME_TYPE = "text/html;profile=mcp-app" as const;

/**
 * The inherited Workbench policy admits one exact nonce-bearing bootstrap
 * module while parsing. This later meta policy is parsed before that deferred
 * module executes and closes every subsequent script or network load.
 */
export const MCP_APP_CHILD_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'none'",
  "script-src-attr 'none'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "media-src 'none'",
  "worker-src 'none'",
  "child-src 'none'",
  "webrtc 'none'",
].join("; ");

export type McpAppDocumentFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface McpAppObjectUrlFactory {
  create(blob: Blob): string;
  revoke(url: string): void;
}

export interface LoadedMcpAppDocument {
  readonly url: string;
  /** Idempotently revokes the transformed document URL. */
  revoke(): void;
}

export interface McpAppDocumentLoaderOptions {
  readonly signal?: AbortSignal;
  readonly fetcher?: McpAppDocumentFetch;
  readonly objectUrls?: McpAppObjectUrlFactory;
}

export interface McpAppHostNonceMetaRoot {
  querySelectorAll(selector: string): ArrayLike<{
    getAttribute(name: string): string | null;
  }>;
}

interface McpAppDocumentPlan {
  readonly htmlWithoutScript: string;
  readonly headOffset: number;
  readonly scriptSource: string;
  readonly crossOrigin: boolean;
}

/**
 * Read the one host-owned, document-scoped input. It authorizes only the exact
 * parser-inserted bootstrap module. It is never granted by the closing child
 * CSP, so reading it cannot authorize a later dynamic or external script.
 */
export function readMcpAppHostScriptNonce(
  root?: McpAppHostNonceMetaRoot,
): string {
  const resolvedRoot = root ??
    (globalThis as unknown as { document?: McpAppHostNonceMetaRoot }).document;
  if (!resolvedRoot) {
    throw new TypeError("The Workbench MCP App host nonce is unavailable.");
  }
  const metas = resolvedRoot.querySelectorAll(
    `meta[name="${MCP_APP_SCRIPT_NONCE_META_NAME}"]`,
  );
  if (metas.length !== 1) {
    throw new TypeError("The Workbench MCP App host nonce is unavailable.");
  }
  const nonce = metas[0]?.getAttribute("content") ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(nonce)) {
    throw new TypeError("The Workbench MCP App host nonce is invalid.");
  }
  return nonce;
}

/**
 * Fetch, attest and wrap one exact registered whole App.
 *
 * Raw response bytes are bounded and matched against the projected MIME,
 * byte count and SHA-256 before UTF-8 decoding or HTML transformation.
 */
export async function loadVerifiedMcpAppDocument(
  session: ThreadViewerSession,
  hostScriptNonce: string,
  options: McpAppDocumentLoaderOptions = {},
): Promise<LoadedMcpAppDocument> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(hostScriptNonce)) {
    throw new TypeError("The Workbench MCP App host nonce is invalid.");
  }
  if (
    session.resource.mimeType !== MCP_APP_DOCUMENT_MIME_TYPE ||
    !Number.isSafeInteger(session.resource.bytes) ||
    session.resource.bytes < 0 ||
    session.resource.bytes > MCP_APP_HOST_MAX_RESOURCE_BYTES
  ) {
    throw new TypeError("The registered MCP App document identity is invalid.");
  }
  throwIfAborted(options.signal);
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const response = await fetcher(session.launchUri, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
    headers: { Accept: MCP_APP_DOCUMENT_MIME_TYPE },
    signal: options.signal,
  });
  throwIfAborted(options.signal);
  if (response.status !== 200 || response.redirected) {
    throw new Error("The registered MCP App document is unavailable.");
  }
  if (response.headers.get("Content-Type") !== session.resource.mimeType) {
    throw new Error("The registered MCP App document MIME type changed.");
  }
  if (response.headers.has("Content-Encoding")) {
    throw new Error("Encoded MCP App document responses are not admitted.");
  }
  const contentLength = response.headers.get("Content-Length");
  if (
    contentLength !== null &&
    (!/^(?:0|[1-9][0-9]*)$/.test(contentLength) ||
      Number(contentLength) !== session.resource.bytes)
  ) {
    throw new Error("The registered MCP App document byte count changed.");
  }

  const bytes = await readExactBytes(
    response,
    session.resource.bytes,
    options.signal,
  );
  const fingerprint = await sha256Fingerprint(bytes);
  if (fingerprint !== session.resource.fingerprint) {
    throw new Error("The registered MCP App document fingerprint changed.");
  }
  throwIfAborted(options.signal);

  let html: string;
  try {
    html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("The registered MCP App document is not valid UTF-8.");
  }
  const plan = planMcpAppDocument(html);
  const objectUrls = options.objectUrls ?? browserObjectUrls();
  const createdUrls: string[] = [];
  let revoked = false;
  const revokeAll = (): void => {
    if (revoked) return;
    revoked = true;
    for (const url of createdUrls.toReversed()) objectUrls.revoke(url);
    createdUrls.length = 0;
  };

  try {
    const transformed = materializeMcpAppDocument(plan, hostScriptNonce);
    throwIfAborted(options.signal);
    const url = objectUrls.create(
      new Blob([transformed], { type: "text/html;charset=utf-8" }),
    );
    createdUrls.push(url);
    assertBlobUrl(url);
    throwIfAborted(options.signal);
    return { url, revoke: revokeAll };
  } catch (error) {
    revokeAll();
    throw error;
  }
}

/**
 * Strictly validate the accepted single-file HTML form without parsing it in a
 * live document. The admitted bundle may contain inline styles and exactly one
 * inline `<script type="module">` (optionally boolean `crossorigin`). Original
 * external/additional scripts, link-based module loading and ambiguous script
 * syntax fail closed.
 */
export function planMcpAppDocument(html: string): McpAppDocumentPlan {
  if (html.includes("\0")) {
    throw new Error("The MCP App document contains an ambiguous null byte.");
  }
  const headMatches = [...html.matchAll(/<head[\t\n\f\r ]*>/gi)];
  if (headMatches.length !== 1 || headMatches[0]?.index === undefined) {
    throw new Error(
      "The MCP App document requires one explicit empty-form head tag.",
    );
  }
  const safePrefix = new RegExp(
    "^[\\t\\n\\f\\r ]*<!doctype[\\t\\n\\f\\r ]+html[\\t\\n\\f\\r ]*>" +
      "[\\t\\n\\f\\r ]*<html(?:[\\t\\n\\f\\r ]+lang=(?:\"[A-Za-z0-9-]+\"|'[A-Za-z0-9-]+'))?" +
      "[\\t\\n\\f\\r ]*>[\\t\\n\\f\\r ]*<head[\\t\\n\\f\\r ]*>",
    "i",
  ).exec(html);
  if (
    !safePrefix || safePrefix[0].length !==
      headMatches[0].index + headMatches[0][0].length
  ) {
    throw new Error(
      "The MCP App document must begin with doctype, html and head before any content.",
    );
  }
  if (/<link(?=[\t\n\f\r />])/i.test(withoutHtmlComments(html))) {
    throw new Error("External or module-preload links are not admitted.");
  }

  // ASCII-only case fold: String.toLowerCase() can change string length
  // (e.g. U+0130 folds to two code units), which would shift every index
  // used to slice `html`. Script tokens only need ASCII insensitivity.
  const lower = html.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  let scan = 0;
  let scriptStart = -1;
  let scriptEnd = -1;
  let scriptSource = "";
  let crossOrigin = false;
  while (scan < html.length) {
    const comment = html.indexOf("<!--", scan);
    const script = findScriptToken(lower, scan);
    if (comment >= 0 && (script < 0 || comment < script)) {
      const end = html.indexOf("-->", comment + 4);
      if (end < 0) {
        throw new Error(
          "The MCP App document contains an unterminated comment.",
        );
      }
      scan = end + 3;
      continue;
    }
    if (script < 0) break;
    if (lower.startsWith("</script", script)) {
      throw new Error(
        "The MCP App document contains an unmatched script close tag.",
      );
    }
    if (scriptStart >= 0) {
      throw new Error("Exactly one MCP App bootstrap module is admitted.");
    }
    const opening = exactBootstrapOpening(html.slice(script));
    if (!opening) {
      throw new Error(
        "Only exact inline module scripts are admitted in an MCP App document.",
      );
    }
    const sourceStart = script + opening.text.length;
    const close = findScriptToken(lower, sourceStart);
    if (close < 0 || lower.slice(close, close + 9) !== "</script>") {
      throw new Error(
        "The MCP App document contains an ambiguous script close tag.",
      );
    }
    scriptStart = script;
    scriptEnd = close + 9;
    scriptSource = html.slice(sourceStart, close);
    crossOrigin = opening.crossOrigin;
    scan = scriptEnd;
  }
  if (scriptStart < 0) {
    throw new Error("Exactly one MCP App bootstrap module is required.");
  }

  const headEnd = headMatches[0].index + headMatches[0][0].length;
  if (headEnd > scriptStart) {
    throw new Error("The MCP App head must precede its bootstrap module.");
  }
  return {
    htmlWithoutScript: html.slice(0, scriptStart) + html.slice(scriptEnd),
    headOffset: headEnd,
    scriptSource,
    crossOrigin,
  };
}

export function materializeMcpAppDocument(
  plan: McpAppDocumentPlan,
  hostScriptNonce: string,
): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(hostScriptNonce)) {
    throw new TypeError("The Workbench MCP App host nonce is invalid.");
  }
  const bootstrap = `<script type="module"${
    plan.crossOrigin ? " crossorigin" : ""
  } nonce="${hostScriptNonce}">${plan.scriptSource}</script>`;
  const prefix = plan.htmlWithoutScript.slice(0, plan.headOffset);
  const suffix = plan.htmlWithoutScript.slice(plan.headOffset);
  return `${prefix}${bootstrap}${childCspMeta()}${suffix}`;
}

function exactBootstrapOpening(
  html: string,
): { readonly text: string; readonly crossOrigin: boolean } | undefined {
  const whitespace = "[\\t\\n\\f\\r ]";
  const type = `type${whitespace}*=${whitespace}*(?:\"module\"|'module')`;
  const patterns = [
    {
      regex: new RegExp(`^<script${whitespace}+${type}${whitespace}*>`, "i"),
      crossOrigin: false,
    },
    {
      regex: new RegExp(
        `^<script${whitespace}+${type}${whitespace}+crossorigin${whitespace}*>`,
        "i",
      ),
      crossOrigin: true,
    },
    {
      regex: new RegExp(
        `^<script${whitespace}+crossorigin${whitespace}+${type}${whitespace}*>`,
        "i",
      ),
      crossOrigin: true,
    },
  ];
  for (const candidate of patterns) {
    const match = candidate.regex.exec(html);
    if (match) return { text: match[0], crossOrigin: candidate.crossOrigin };
  }
  return undefined;
}

async function readExactBytes(
  response: Response,
  expectedBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const body = response.body;
  if (!body) {
    if (expectedBytes === 0) return new Uint8Array();
    throw new Error("The registered MCP App document has no body.");
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > expectedBytes || total > MCP_APP_HOST_MAX_RESOURCE_BYTES) {
        throw new Error(
          "The registered MCP App document exceeds its byte identity.",
        );
      }
      chunks.push(Uint8Array.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (total !== expectedBytes) {
    throw new Error("The registered MCP App document byte count changed.");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function findScriptToken(lower: string, from: number): number {
  let cursor = from;
  while (cursor < lower.length) {
    const opening = lower.indexOf("<script", cursor);
    const closing = lower.indexOf("</script", cursor);
    const candidate = opening < 0
      ? closing
      : closing < 0
      ? opening
      : Math.min(opening, closing);
    if (candidate < 0) return -1;
    const offset = lower.startsWith("</", candidate) ? 8 : 7;
    const boundary = lower[candidate + offset];
    if (boundary === undefined || /[\t\n\f\r />]/.test(boundary)) {
      return candidate;
    }
    cursor = candidate + offset;
  }
  return -1;
}

function withoutHtmlComments(html: string): string {
  let output = "";
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf("<!--", cursor);
    if (start < 0) return output + html.slice(cursor);
    const end = html.indexOf("-->", start + 4);
    if (end < 0) {
      throw new Error("The MCP App document contains an unterminated comment.");
    }
    output += html.slice(cursor, start);
    cursor = end + 3;
  }
  return output;
}

function childCspMeta(): string {
  return `<meta http-equiv="Content-Security-Policy" content="${
    escapeHtmlAttribute(MCP_APP_CHILD_CONTENT_SECURITY_POLICY)
  }">`;
}

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function assertBlobUrl(url: string): void {
  if (!/^blob:[^\s"'<>]+$/.test(url)) {
    throw new TypeError(
      "The MCP App object URL factory returned a non-Blob URL.",
    );
  }
}

function browserObjectUrls(): McpAppObjectUrlFactory {
  return {
    create: (blob) => URL.createObjectURL(blob),
    revoke: (url) => URL.revokeObjectURL(url),
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
}

async function sha256Fingerprint(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return `sha256:${
    [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  }`;
}
