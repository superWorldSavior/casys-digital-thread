import {
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "jsr:@std/assert@1.0.14";
import { WORKBENCH_ACCESS_HEADER, WORKBENCH_ORIGIN } from "./contracts.ts";
import { isAllowedWorkbenchPath, proxyDesktopWorkbenchRequest } from "./proxy.ts";

const TOKEN = "a".repeat(64);
const SESSION = { origin: WORKBENCH_ORIGIN, accessToken: TOKEN } as const;
const APP_NONCE = "A".repeat(43);
const DYNAMIC_WORKBENCH_CSP =
  "default-src 'none'; base-uri 'none'; form-action 'none'; " +
  "frame-ancestors 'self'; object-src 'none'; " +
  `script-src 'self' 'nonce-${APP_NONCE}'; ` +
  "style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "font-src 'self'; connect-src 'self'; frame-src blob:; media-src 'none'; " +
  "worker-src 'none'; manifest-src 'none'";

Deno.test("Desktop Workbench proxy forwards only bounded read headers and its host token", async () => {
  let upstreamUrl = "";
  let upstreamInit: RequestInit | undefined;
  const fetchImpl: typeof fetch = (input, init) => {
    upstreamUrl = String(input);
    upstreamInit = init;
    return Promise.resolve(
      new Response("projection", {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Casys-Data-Source": "engineering-project-plan",
          "Set-Cookie": "credential=must-not-pass",
          "X-Upstream-Origin": WORKBENCH_ORIGIN,
        },
      }),
    );
  };
  const response = await proxyDesktopWorkbenchRequest(
    new Request("http://desktop.local/api/thread/workbench?view=summary", {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer renderer-secret",
        Cookie: "provider=secret",
        [WORKBENCH_ACCESS_HEADER]: "renderer-token",
      },
    }),
    { session: SESSION, fetchImpl },
  );

  assertEquals(upstreamUrl, `${WORKBENCH_ORIGIN}/api/thread/workbench?view=summary`);
  assertEquals(upstreamInit?.method, "GET");
  const headers = new Headers(upstreamInit?.headers);
  assertEquals(headers.get(WORKBENCH_ACCESS_HEADER), TOKEN);
  assertEquals(headers.get("accept"), "application/json");
  assertEquals(headers.get("authorization"), null);
  assertEquals(headers.get("cookie"), null);
  assertEquals(response?.status, 200);
  assertEquals(await response?.text(), "projection");
  assertEquals(response?.headers.get("set-cookie"), null);
  assertEquals(response?.headers.get("x-upstream-origin"), null);
  assertEquals(
    response?.headers.get("x-casys-data-source"),
    "engineering-project-plan",
  );
  assertEquals(response?.headers.get("x-content-type-options"), "nosniff");
  assertFalse(JSON.stringify([...response!.headers]).includes(TOKEN));
});

Deno.test("Desktop Workbench proxy translates HEAD to a bodyless upstream GET", async () => {
  let upstreamMethod = "";
  const response = await proxyDesktopWorkbenchRequest(
    new Request("http://desktop.local/native-workbench.html", { method: "HEAD" }),
    {
      session: SESSION,
      fetchImpl: (_input, init) => {
        upstreamMethod = init?.method ?? "";
        return Promise.resolve(
          new Response("must be stripped", {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Content-Security-Policy": DYNAMIC_WORKBENCH_CSP,
            },
          }),
        );
      },
    },
  );
  assertEquals(upstreamMethod, "GET");
  assertEquals(await response?.text(), "");
  assertStringIncludes(
    response?.headers.get("content-security-policy") ?? "",
    "connect-src 'self'",
  );
  assertStringIncludes(
    response?.headers.get("content-security-policy") ?? "",
    "frame-src blob:",
  );
  assertStringIncludes(
    response?.headers.get("content-security-policy") ?? "",
    `'nonce-${APP_NONCE}'`,
  );
  assertEquals(
    response?.headers.get("content-security-policy"),
    DYNAMIC_WORKBENCH_CSP,
  );
  assertEquals(response?.headers.get("x-frame-options"), "DENY");
  assertFalse(
    (response?.headers.get("content-security-policy") ?? "").includes(
      "frame-src 'self'",
    ),
  );
});

Deno.test("Desktop Workbench proxy rejects an upstream policy permitting foreign ancestors", async () => {
  const response = await proxyDesktopWorkbenchRequest(
    new Request("http://desktop.local/native-workbench.html"),
    {
      session: SESSION,
      fetchImpl: () =>
        Promise.resolve(
          new Response("document", {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Content-Security-Policy": DYNAMIC_WORKBENCH_CSP.replace(
                "frame-ancestors 'self'",
                "frame-ancestors *",
              ),
            },
          }),
        ),
    },
  );
  const policy = response?.headers.get("content-security-policy") ?? "";
  assertStringIncludes(policy, "frame-ancestors 'self'");
  assertStringIncludes(policy, "frame-src blob:");
  assertFalse(policy.includes("frame-ancestors *"));
  assertFalse(policy.includes("nonce-"));
  assertEquals(response?.headers.get("x-frame-options"), "DENY");
});

Deno.test("Desktop Workbench proxy streams SSE and preserves only Last-Event-ID", async () => {
  let upstreamHeaders = new Headers();
  const response = await proxyDesktopWorkbenchRequest(
    new Request("http://desktop.local/api/thread/workbench/events", {
      headers: {
        "Last-Event-ID": "revision-7",
        "X-Provider-Key": "must-not-pass",
      },
    }),
    {
      session: SESSION,
      fetchImpl: (_input, init) => {
        upstreamHeaders = new Headers(init?.headers);
        return Promise.resolve(
          new Response("event: snapshot\ndata: {}\n\n", {
            headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          }),
        );
      },
    },
  );
  assertEquals(upstreamHeaders.get("last-event-id"), "revision-7");
  assertEquals(upstreamHeaders.get("x-provider-key"), null);
  assertEquals(response?.headers.get("x-accel-buffering"), "no");
  assertEquals(await response?.text(), "event: snapshot\ndata: {}\n\n");
});

Deno.test("Desktop Workbench proxy exposes only exact viewer session and CAS routes", async () => {
  const digest = "a".repeat(64);
  for (
    const path of [
      "/api/thread/viewer-sessions",
      "/api/thread/viewer-sessions/events",
      `/api/thread/viewer-apps/launch/${digest}/${digest}`,
      `/api/thread/viewer-apps/resources/${digest}`,
    ]
  ) {
    assertEquals(isAllowedWorkbenchPath(path), true, path);
  }
  for (
    const path of [
      "/api/thread/viewer-apps/launch/latest/latest",
      `/api/thread/viewer-apps/launch/${digest}`,
      `/api/thread/viewer-apps/launch/${digest}/${digest}/extra`,
      "/api/thread/viewer-apps/resources/latest",
      `/api/thread/viewer-apps/resources/${digest}/extra`,
      `/api/draft-assets/${digest}`,
    ]
  ) {
    assertFalse(isAllowedWorkbenchPath(path), path);
  }

  let upstream = "";
  const response = await proxyDesktopWorkbenchRequest(
    new Request("http://desktop.local/api/thread/viewer-sessions/events", {
      headers: { "Last-Event-ID": "viewer-sessions:7" },
    }),
    {
      session: SESSION,
      fetchImpl: (input, init) => {
        upstream = String(input);
        assertEquals(
          new Headers(init?.headers).get("last-event-id"),
          "viewer-sessions:7",
        );
        return Promise.resolve(
          new Response("event: viewer-sessions\ndata: {}\n\n", {
            headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          }),
        );
      },
    },
  );
  assertEquals(upstream, `${WORKBENCH_ORIGIN}/api/thread/viewer-sessions/events`);
  assertEquals(response?.headers.get("x-accel-buffering"), "no");
});

Deno.test("Desktop Workbench proxy rejects methods, commands, and traversal before fetch", async () => {
  let fetches = 0;
  const fetchImpl: typeof fetch = () => {
    fetches += 1;
    return Promise.resolve(new Response("unexpected"));
  };
  const rejected = await proxyDesktopWorkbenchRequest(
    new Request("http://desktop.local/api/thread/workbench", { method: "POST" }),
    { session: SESSION, fetchImpl },
  );
  assertEquals(rejected?.status, 405);
  assertEquals(rejected?.headers.get("allow"), "GET, HEAD");
  assertEquals(fetches, 0);
  assertEquals(
    await proxyDesktopWorkbenchRequest(
      new Request("http://desktop.local/mcp"),
      { session: SESSION, fetchImpl },
    ),
    undefined,
  );
  for (
    const path of [
      "/healthz",
      "/api/project/commands",
      "/assets/%252e%252e/secret.js",
      "/assets/a\\secret.js",
      "/api/thread/assets/a/b",
      "/api/draft-assets/not-a-digest",
    ]
  ) assertFalse(isAllowedWorkbenchPath(path), path);
  assertEquals(fetches, 0);
});
