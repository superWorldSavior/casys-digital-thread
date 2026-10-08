import { assertEquals } from "@std/assert";
import {
  MCP_APP_DOCUMENT_MIME_TYPE,
  MCP_APP_SCRIPT_NONCE_META_NAME,
} from "./src/thread/mcp-app-document-loader.ts";
import { MCP_APP_READ_ONLY_HOST_PROTOCOL_VERSION } from "./src/thread/mcp-app-read-only-host.ts";

const HOST_NONCE = "A".repeat(43);
const APP_ID = "io.casys.test.frame";
const APP_VERSION = "1.0.0";
const CHROME = chromeExecutable();
const PLAYWRIGHT = Deno.env.get("CASYS_PLAYWRIGHT_MODULE") ??
  new URL("./node_modules/playwright/index.mjs", import.meta.url).pathname;
const VITE = new URL("./node_modules/vite/dist/node/index.js", import.meta.url)
  .pathname;
const LIFECYCLE = new URL(
  "./src/thread/mcp-app-frame-lifecycle.ts",
  import.meta.url,
).pathname;

Deno.test({
  name:
    "mounted MCP App frame starts eagerly, surfaces fetch refusal, retries, and quarantines navigation",
  ignore: CHROME === undefined || !(await playwrightAvailable()),
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const resourceBytes = new TextEncoder().encode("registered bytes");
    const resourceFingerprint = await sha256Fingerprint(resourceBytes);
    const appHtml = fixtureAppHtml(resourceFingerprint);
    const appBytes = new TextEncoder().encode(appHtml);
    const appFingerprint = await sha256Fingerprint(appBytes);
    const session = sessionFixture({
      appBytes,
      appFingerprint,
      resourceBytes,
      resourceFingerprint,
    });

    let serveApp = false;
    const profile = await Deno.makeTempDir({
      prefix: "casys-mcp-app-frame-chrome-",
    });
    const harness = await bundleHarness(profile);
    const server = Deno.serve({
      hostname: "127.0.0.1",
      port: 0,
      onListen() {},
    }, (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/harness.js") {
        return new Response(harness, {
          headers: {
            "Content-Type": "text/javascript; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      }
      if (url.pathname === "/enable-app") {
        serveApp = true;
        return new Response(null, { status: 204 });
      }
      if (url.pathname === session.launchUri) {
        if (!serveApp) {
          return new Response("unavailable", { status: 404 });
        }
        return new Response(appBytes, {
          status: 200,
          headers: {
            "Content-Type": MCP_APP_DOCUMENT_MIME_TYPE,
            "Content-Length": String(appBytes.byteLength),
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      if (url.pathname === session.readResources[0]?.uri) {
        return new Response(resourceBytes, {
          status: 200,
          headers: {
            "Content-Type": session.readResources[0]!.mimeType,
            "Content-Length": String(resourceBytes.byteLength),
            "Cache-Control": "no-store",
          },
        });
      }
      if (url.pathname !== "/") {
        return new Response("Not found", { status: 404 });
      }
      return new Response(parentDocument(session), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": parentCsp(HOST_NONCE),
          "X-Frame-Options": "DENY",
          "Cache-Control": "no-store",
        },
      });
    });
    const origin = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;

    try {
      const proof = await runPlaywright(origin, profile);
      assertEquals(proof.initialStatus, "unavailable");
      assertEquals(proof.initialReason, "document-unavailable");
      assertEquals(proof.afterRetry, "resource-delivered");
      assertEquals(proof.iframeLoading, "eager");
      assertEquals(proof.sandbox, "allow-scripts");
      assertEquals(proof.allowSameOrigin, false);
      assertEquals(proof.afterNavigation, "error");
      assertEquals(proof.navigationReason, "document-replaced");
    } finally {
      try {
        await server.shutdown();
      } finally {
        await Deno.remove(profile, { recursive: true });
      }
    }
  },
});

async function bundleHarness(profile: string): Promise<string> {
  const entry = `${profile}/harness.ts`;
  await Deno.writeTextFile(
    entry,
    `import { startMcpAppFrame } from ${JSON.stringify(LIFECYCLE)};
const mount = document.querySelector("#mount");
const session = JSON.parse(document.querySelector("#session").textContent);
const overlay = document.createElement("div");
overlay.setAttribute("role", "status");
overlay.style.position = "absolute";
overlay.style.inset = "0";
overlay.style.zIndex = "1";
mount.append(overlay);
const writeStatus = (status) => {
  mount.setAttribute("data-mcp-app-frame-status", status.kind);
  if (status.reason) mount.setAttribute("data-mcp-app-frame-reason", status.reason);
  else mount.removeAttribute("data-mcp-app-frame-reason");
  const covers = status.kind === "loading" || status.kind === "unavailable" || status.kind === "error";
  overlay.style.display = covers ? "grid" : "none";
  overlay.replaceChildren();
  if (!covers) return;
  const message = document.createElement("p");
  message.textContent = status.kind === "unavailable" ? "Registered App unavailable" : status.kind;
  overlay.append(message);
  if (status.kind === "unavailable" || status.kind === "error") {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.dataset.mcpAppFrameRetry = "";
    retry.textContent = "Retry registered App";
    retry.addEventListener("click", () => globalThis.__mcpAppFrame.retry());
    overlay.append(retry);
  }
};
globalThis.__mcpAppFrame = startMcpAppFrame({
  session,
  hostContext: () => ({ theme: "light", locale: "en" }),
  onStatus: writeStatus,
  createFrame() {
    const frameNode = document.createElement("iframe");
    frameNode.className = "test-app-frame";
    frameNode.title = session.app.id + " " + session.app.version;
    frameNode.setAttribute("sandbox", "allow-scripts");
    frameNode.referrerPolicy = "no-referrer";
    frameNode.loading = "eager";
    mount.insertBefore(frameNode, overlay);
    return frameNode;
  },
  disposeFrame(frame) { frame.remove(); },
});
`,
  );
  const script = `${profile}/bundle-harness.mjs`;
  await Deno.writeTextFile(
    script,
    `
import { build } from ${JSON.stringify(VITE)};
const result = await build({
  configFile: false,
  root: ${JSON.stringify(new URL(".", import.meta.url).pathname)},
  logLevel: "silent",
  build: {
    write: false,
    minify: false,
    emptyOutDir: false,
    lib: {
      entry: ${JSON.stringify(entry)},
      name: "McpAppFrameHarness",
      formats: ["iife"],
      fileName: () => "harness.js",
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
const built = Array.isArray(result) ? result[0] : result;
const chunk = built?.output?.find((item) => item.type === "chunk");
if (!chunk || !("code" in chunk)) {
  throw new Error("Vite did not emit the MCP App frame harness.");
}
process.stdout.write(chunk.code);
`,
  );
  const output = await new Deno.Command("node", {
    args: [script],
    stdout: "piped",
    stderr: "piped",
    cwd: new URL(".", import.meta.url).pathname,
  }).output();
  if (!output.success) {
    throw new Error(
      `Vite harness bundle failed: ${new TextDecoder().decode(output.stderr)}`,
    );
  }
  return new TextDecoder().decode(output.stdout);
}

async function runPlaywright(
  origin: string,
  profile: string,
): Promise<{
  initialStatus: string;
  initialReason: string;
  afterRetry: string;
  iframeLoading: string;
  sandbox: string;
  allowSameOrigin: boolean;
  afterNavigation: string;
  navigationReason: string;
}> {
  const script = `${profile}/playwright-run.mjs`;
  await Deno.writeTextFile(
    script,
    `
import { chromium } from ${JSON.stringify(PLAYWRIGHT)};
const browser = await chromium.launch({
  headless: true,
  executablePath: ${JSON.stringify(CHROME)},
});
const page = await browser.newPage();
await page.goto(${JSON.stringify(origin)});
await page.waitForFunction(() => {
  const mount = document.querySelector("#mount");
  return mount?.getAttribute("data-mcp-app-frame-status") === "unavailable";
}, null, { timeout: 15000 });
const initial = await page.evaluate(() => {
  const mount = document.querySelector("#mount");
  const frame = document.querySelector("iframe");
  return {
    initialStatus: mount?.getAttribute("data-mcp-app-frame-status") ?? "",
    initialReason: mount?.getAttribute("data-mcp-app-frame-reason") ?? "",
    iframeLoading: frame?.loading ?? "",
    sandbox: frame?.getAttribute("sandbox") ?? "",
    allowSameOrigin: (frame?.getAttribute("sandbox") ?? "").includes(
      "allow-same-origin",
    ),
  };
});
await page.evaluate(() => fetch("/enable-app"));
await page.click("[data-mcp-app-frame-retry]");
await page.waitForFunction(() => {
  const mount = document.querySelector("#mount");
  return mount?.getAttribute("data-mcp-app-frame-status") ===
    "resource-delivered";
}, null, { timeout: 15000 });
const afterRetry = await page.evaluate(() => {
  const mount = document.querySelector("#mount");
  return mount?.getAttribute("data-mcp-app-frame-status") ?? "";
});
await page.evaluate(() => {
  const frame = document.querySelector("iframe");
  frame?.contentWindow?.postMessage({ type: "test.navigate" }, "*");
});
await page.waitForFunction(() => {
  const mount = document.querySelector("#mount");
  return mount?.getAttribute("data-mcp-app-frame-status") === "error";
}, null, { timeout: 8000 });
const afterNavigation = await page.evaluate(() => {
  const mount = document.querySelector("#mount");
  return {
    afterNavigation: mount?.getAttribute("data-mcp-app-frame-status") ?? "",
    navigationReason: mount?.getAttribute("data-mcp-app-frame-reason") ?? "",
  };
});
await browser.close();
console.log(JSON.stringify({ ...initial, afterRetry, ...afterNavigation }));
`,
  );
  const output = await new Deno.Command("node", {
    args: [script],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `Playwright frame test failed: ${new TextDecoder().decode(output.stderr)}\n${
        new TextDecoder().decode(output.stdout)
      }`,
    );
  }
  return JSON.parse(new TextDecoder().decode(output.stdout));
}

function parentDocument(session: unknown): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="${MCP_APP_SCRIPT_NONCE_META_NAME}" content="${HOST_NONCE}">
</head>
<body>
<script type="application/json" id="session">${
    JSON.stringify(session).replaceAll("<", "\\u003c")
  }</script>
<div style="transform: translate3d(24px, 16px, 0) scale(0.9); transform-origin: 0 0; width: 32rem; height: 22rem; position: relative;">
  <div id="mount" style="position: relative; display: grid; width: 100%; height: 100%; min-height: 0;"></div>
</div>
<script nonce="${HOST_NONCE}" src="/harness.js"></script>
</body>
</html>`;
}

function parentCsp(nonce: string): string {
  return [
    "default-src 'none'",
    "frame-ancestors 'self'",
    `script-src 'nonce-${nonce}'`,
    "script-src-attr 'none'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "connect-src 'self'",
    "frame-src blob:",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "media-src 'none'",
    "worker-src 'none'",
  ].join("; ");
}

function fixtureAppHtml(fingerprint: string): string {
  const script = `
const channel = new MessageChannel();
channel.port1.start();
parent.postMessage({schemaVersion:"io.casys.mcp-app-host.resource-read/1.0",type:"mcp-app-host.resource.port.offer"},"*",[channel.port2]);
addEventListener("message", (event) => {
  const message = event.data;
  if (message?.jsonrpc === "2.0" && message?.id === 1 && message?.result) {
    parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/initialized"},"*");
    return;
  }
  if (message?.jsonrpc === "2.0" && message?.method === "ui/compose/event") {
    channel.port1.postMessage({
      schemaVersion:"io.casys.mcp-app-host.resource-read/1.0",
      type:"mcp-app-host.resource.read",
      requestId:"frame-probe",
      fingerprint:${JSON.stringify(fingerprint)}
    });
    return;
  }
  if (message?.type === "test.navigate") {
    location.href = "about:blank";
  }
});
channel.port1.addEventListener("message", () => {});
parent.postMessage({
  jsonrpc:"2.0",
  id:1,
  method:"ui/initialize",
  params:{
    protocolVersion:${JSON.stringify(MCP_APP_READ_ONLY_HOST_PROTOCOL_VERSION)},
    appInfo:{name:${JSON.stringify(APP_ID)},version:${JSON.stringify(APP_VERSION)}},
    appCapabilities:{}
  }
},"*");
`;
  return `<!doctype html><html><head></head><body><script type="module">${script}</script></body></html>`;
}

function sessionFixture(input: {
  readonly appBytes: Uint8Array;
  readonly appFingerprint: string;
  readonly resourceBytes: Uint8Array;
  readonly resourceFingerprint: string;
}) {
  const resourcePath = `/api/thread/viewer-apps/resources/${
    input.resourceFingerprint.slice(7)
  }`;
  return {
    id: `mcp-app:${"d".repeat(64)}`,
    kind: "mcp-app",
    anchor: { kind: "artifact", id: "recorded-result" },
    app: { id: APP_ID, version: APP_VERSION },
    manifest: {
      uri: "ui://casys-test/app-manifest",
      fingerprint: `sha256:${"a".repeat(64)}`,
    },
    resource: {
      uri: "ui://casys-test/results-viewer",
      fingerprint: input.appFingerprint,
      ownership: "whole-view",
      mimeType: MCP_APP_DOCUMENT_MIME_TYPE,
      bytes: input.appBytes.byteLength,
    },
    launchUri: `/api/thread/viewer-apps/launch/${"a".repeat(64)}/${
      input.appFingerprint.slice(7)
    }`,
    readResources: [{
      uri: resourcePath,
      mimeType: "application/octet-stream",
      bytes: input.resourceBytes.byteLength,
      fingerprint: input.resourceFingerprint,
    }],
    session: {
      action: "viewer.session.apply",
      schema: "io.casys.test.session/1.0",
      payload: {
        schemaVersion: "io.casys.test.session/1.0",
        projection: {
          status: "available",
          resourceFingerprint: input.resourceFingerprint,
        },
      },
      fingerprint: `sha256:${"c".repeat(64)}`,
    },
  };
}

function chromeExecutable(): string | undefined {
  const candidates = Deno.build.os === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    : ["/usr/bin/google-chrome", "/usr/bin/chromium"];
  return candidates.find((path) => {
    try {
      return Deno.statSync(path).isFile;
    } catch {
      return false;
    }
  });
}

async function playwrightAvailable(): Promise<boolean> {
  try {
    return (await Deno.stat(PLAYWRIGHT)).isFile;
  } catch {
    return false;
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
