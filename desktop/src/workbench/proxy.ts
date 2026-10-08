import { WORKBENCH_ACCESS_HEADER, type WorkbenchSession } from "./contracts.ts";

const EXACT_PATHS = new Set([
  "/",
  "/native-workbench.html",
  "/api/projects",
  "/api/fleet",
  "/api/thread/workbench",
  "/api/thread/workbench/events",
  "/api/thread/viewer-sessions",
  "/api/thread/viewer-sessions/events",
]);

const WORKBENCH_DOCUMENT_CSP =
  "default-src 'none'; base-uri 'none'; form-action 'none'; " +
  // Keep the helper's WebKit-compatible Blob frame policy exactly pinned.
  "frame-ancestors 'self'; object-src 'none'; script-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "font-src 'self'; connect-src 'self'; frame-src blob:; media-src 'none'; " +
  "worker-src 'none'; manifest-src 'none'";

export interface DesktopWorkbenchProxyOptions {
  readonly session: WorkbenchSession;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Host-only reverse proxy. It forwards no renderer header except bounded
 * Accept and Last-Event-ID, injects the private helper token, and exposes no
 * helper origin in the response.
 */
export async function proxyDesktopWorkbenchRequest(
  request: Request,
  options: DesktopWorkbenchProxyOptions,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!isAllowedWorkbenchPath(url.pathname)) return undefined;
  const method = request.method.toUpperCase();
  const isEvents = url.pathname === "/api/thread/workbench/events" ||
    url.pathname === "/api/thread/viewer-sessions/events";
  if (method !== "GET" && (method !== "HEAD" || isEvents)) {
    return new Response("Method not allowed.\n", {
      status: 405,
      headers: secureHeaders({ Allow: isEvents ? "GET" : "GET, HEAD" }),
    });
  }

  const upstream = new URL(url.pathname + url.search, options.session.origin);
  const accept = request.headers.get("accept");
  const lastEventId = request.headers.get("last-event-id");
  const response = await (options.fetchImpl ?? globalThis.fetch)(upstream, {
    method: "GET",
    cache: "no-store",
    redirect: "error",
    signal: request.signal,
    headers: {
      [WORKBENCH_ACCESS_HEADER]: options.session.accessToken,
      ...(accept === null ? {} : { Accept: accept.slice(0, 256) }),
      ...(lastEventId === null ? {} : { "Last-Event-ID": lastEventId.slice(0, 256) }),
    },
  });
  const contentType = response.headers.get("content-type") ??
    "application/octet-stream";
  const headers = secureHeaders({
    "Content-Type": contentType,
    "Cache-Control": response.headers.get("cache-control") ?? "no-store",
    ...(response.headers.get("x-casys-data-source") === null ? {} : {
      "X-Casys-Data-Source": response.headers.get("x-casys-data-source")!,
    }),
    ...(contentType.startsWith("text/html")
      ? {
        "Content-Security-Policy": forwardedWorkbenchDocumentCsp(
          response.headers.get("content-security-policy"),
        ),
      }
      : {}),
    ...(contentType.startsWith("text/event-stream")
      ? { "X-Accel-Buffering": "no" }
      : {}),
  });
  return new Response(method === "HEAD" ? null : response.body, {
    status: response.status,
    headers,
  });
}

function forwardedWorkbenchDocumentCsp(value: string | null): string {
  if (value === WORKBENCH_DOCUMENT_CSP) return value;
  const nonce = value?.match(
    /(?:^|; )script-src 'self' 'nonce-([A-Za-z0-9_-]{43})'(?:;|$)/,
  )?.[1];
  if (!nonce) return WORKBENCH_DOCUMENT_CSP;
  const expected = WORKBENCH_DOCUMENT_CSP.replace(
    "script-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
  );
  return value === expected ? value : WORKBENCH_DOCUMENT_CSP;
}

export function isAllowedWorkbenchPath(pathname: string): boolean {
  if (EXACT_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/assets/")) {
    return safePathTail(pathname.slice("/assets/".length));
  }
  if (pathname.startsWith("/api/thread/assets/")) {
    return /^[A-Za-z0-9._-]+$/.test(
      pathname.slice("/api/thread/assets/".length),
    );
  }
  if (pathname.startsWith("/api/thread/viewer-apps/launch/")) {
    return /^[a-f0-9]{64}\/[a-f0-9]{64}$/.test(
      pathname.slice("/api/thread/viewer-apps/launch/".length),
    );
  }
  if (pathname.startsWith("/api/thread/viewer-apps/resources/")) {
    return /^[a-f0-9]{64}$/.test(
      pathname.slice("/api/thread/viewer-apps/resources/".length),
    );
  }
  return false;
}

function safePathTail(value: string): boolean {
  if (!value || value.includes("\\") || value.includes("\0")) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return false;
  }
  return decoded.split("/").every((segment) =>
    segment.length > 0 && segment !== "." && segment !== ".." &&
    /^[A-Za-z0-9._-]+$/.test(segment)
  );
}

function secureHeaders(
  headers: Readonly<Record<string, string>> = {},
): Headers {
  return new Headers({
    "Cache-Control": "no-store",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    ...headers,
  });
}
