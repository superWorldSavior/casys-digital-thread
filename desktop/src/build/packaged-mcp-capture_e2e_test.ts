import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { ChatHostClient } from "../chat-host/client.ts";

const PROTOCOL = "casys-desktop-chat/1.0";
const APP_URI = "ui://mcp-build123d/results-viewer";
const TOOLS = [
  "build123d_execute",
  "build123d_export",
  "build123d_observe_assembly_integrity",
  "build123d_project_2d",
];
const app = join(Deno.cwd(), "dist", "CasysDigitalThread.app");
const helper = join(app, "Contents", "Helpers", "casys-chat-host");
const runtime = join(app, "Contents", "Resources", "chat-host");
const node = join(runtime, "node");
const acpxRoot = join(runtime, "acpx");
const fixture = join(
  Deno.cwd(),
  "src",
  "build",
  "fixtures",
  "packaged-mcp-capture-agent.mjs",
);
const runnable = Deno.build.os === "darwin" && Deno.build.arch === "aarch64" &&
  Deno.permissions.querySync({ name: "net", host: "127.0.0.1" }).state ===
    "granted" &&
  Deno.permissions.querySync({ name: "run", command: helper }).state ===
    "granted" &&
  Deno.permissions.querySync({ name: "read", path: app }).state === "granted" &&
  Deno.permissions.querySync({ name: "write", path: "/tmp" }).state ===
    "granted" &&
  await exists(helper) && await exists(node) && await exists(acpxRoot);

/**
 * Exercises the actual packaged Chat Host and pinned ACP runtime, with an
 * output-less ACP fixture and a local MCP provider. This proves host capture,
 * not Muse compatibility, Docker preparation, or visual WebView rendering.
 */
Deno.test({
  name: "packaged host retains scoped MCP exports across ACP resume and restart",
  ignore: !runnable,
  fn: async () => {
    const root = await Deno.makeTempDir({
      dir: "/tmp",
      prefix: "casys-packaged-capture-",
    });
    const dataRoot = join(root, "chat-data");
    const providerCalls: number[] = [];
    const artifacts = [1, 2].map((revision) => {
      const bytes = new TextEncoder().encode(
        `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('fixture ${revision}'),'2;1');\nENDSEC;\nEND-ISO-10303-21;\n`,
      );
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      return {
        revision,
        bytes,
        sha256,
        uri: `casys://build123d/artifacts/${sha256}.step`,
      };
    });
    const provider = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen: () => {} },
      async (request) => {
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path === "/health") {
          return Response.json({ status: "ok" });
        }
        if (request.method !== "POST" || path !== "/mcp") {
          return new Response("not found", { status: 404 });
        }
        const rpc = await request.json() as {
          id: string | number;
          method: string;
          params?: Record<string, unknown>;
        };
        const result = (() => {
          if (rpc.method === "server/discover") {
            return {
              resultType: "complete",
              serverInfo: { name: "capture-fixture", version: "1.0.0" },
            };
          }
          if (rpc.method === "tools/list") {
            return {
              resultType: "complete",
              tools: TOOLS.map((name) => ({
                name,
                description: "Deterministic fixture only",
                inputSchema: { type: "object", additionalProperties: true },
                ...(name === "build123d_export"
                  ? { _meta: { ui: { resourceUri: APP_URI } } }
                  : {}),
              })),
            };
          }
          if (rpc.method === "resources/list") {
            return {
              resultType: "complete",
              resources: [{ uri: APP_URI, name: "Results viewer" }],
            };
          }
          if (rpc.method === "resources/read") {
            const uri = rpc.params?.uri;
            if (uri === APP_URI) {
              return {
                resultType: "complete",
                contents: [{
                  uri,
                  mimeType: "text/html;profile=mcp-app",
                  text: "<!doctype html><title>Fixture viewer</title>",
                }],
              };
            }
            const artifact = artifacts.find((entry) => entry.uri === uri);
            if (artifact === undefined) {
              throw new Error("unknown fixture resource");
            }
            return {
              resultType: "complete",
              contents: [{
                uri,
                mimeType: "model/step",
                blob: btoa(String.fromCharCode(...artifact.bytes)),
              }],
            };
          }
          if (rpc.method === "tools/call") {
            assertEquals(rpc.params?.name, "build123d_export");
            const args = rpc.params?.arguments as
              | { revision?: number }
              | undefined;
            const revision = args?.revision;
            assert(revision === 1 || revision === 2);
            providerCalls.push(revision);
            const artifact = artifacts[revision - 1];
            return {
              resultType: "complete",
              content: [{ type: "text", text: "Fixture export completed." }],
              structuredContent: {
                files: [{
                  artifact: {
                    schemaVersion: "build123d-export-artifact/1.0",
                    uri: artifact.uri,
                    mimeType: "model/step",
                    bytes: artifact.bytes.length,
                    sha256: artifact.sha256,
                  },
                }],
              },
              _meta: { ui: { resourceUri: APP_URI } },
            };
          }
          throw new Error(`unexpected fixture MCP method: ${rpc.method}`);
        })();
        return Response.json({ jsonrpc: "2.0", id: rpc.id, result });
      },
    );
    const port = (provider.addr as Deno.NetAddr).port;
    const endpoint = `http://127.0.0.1:${port}`;
    let host: ChatHostClient | undefined;
    try {
      await Deno.mkdir(dataRoot, { recursive: true });
      await Deno.writeTextFile(
        join(dataRoot, "agent-profiles.json"),
        JSON.stringify({
          defaultProfileId: "capture-fixture",
          profiles: [{
            id: "capture-fixture",
            displayName: "Capture fixture",
            agentName: "capture-fixture",
            launch: {
              kind: "command",
              path: node,
              args: [fixture, acpxRoot, root],
            },
            authRecovery: "Fixture needs no authentication.",
            modelsExposed: false,
          }],
        }),
      );
      const start = () =>
        ChatHostClient.start({
          paths: { executable: helper, target: "darwin-arm64" },
          dataRoot,
          launchCwd: root,
          env: { HOME: root, PATH: "/usr/bin:/bin" },
          platform: "macOS",
          timeouts: { readyMs: 30_000, requestMs: 30_000 },
        });
      host = await start();
      const initial = await host.snapshot({ protocol: PROTOCOL });
      assertEquals(initial.defaultAgentProfileId, "capture-fixture");
      assertEquals(initial.conversations.length, 0);
      const selected = initial.agentProfiles.find((profile) =>
        profile.id === "capture-fixture"
      );
      assertEquals(selected?.available, true, selected?.missingReason);
      await host.mcpEnsure({
        mcpId: "build123d",
        mcpUrl: `${endpoint}/mcp`,
        healthUrl: `${endpoint}/health`,
      });
      assert(
        (await host.command({
          protocol: PROTOCOL,
          requestId: "fixture-create",
          command: "conversation.create",
        })).ok,
      );
      const created = await host.snapshot({ protocol: PROTOCOL });
      const conversationId = created.selectedConversationId;
      assert(typeof conversationId === "string");
      assert(
        (await host.command({
          protocol: PROTOCOL,
          requestId: "fixture-enable",
          command: "mcp.enable",
          conversationId,
          mcpId: "build123d",
        })).ok,
      );

      for (
        const [index, marker] of ["revision-one", "revision-two"].entries()
      ) {
        const revision = index + 1;
        assert(
          (await host.command({
            protocol: PROTOCOL,
            requestId: `fixture-turn-${revision}`,
            command: "message.send",
            conversationId,
            text: marker,
          })).ok,
        );
        const conversation = await waitForIdle(host, conversationId, revision);
        assertEquals(conversation.viewers.length, revision);
        const latest = conversation.viewers[revision - 1];
        assertEquals(latest.archive?.revision, revision);
        assertEquals(latest.archive?.artifacts.length, 1);
        assertEquals(latest.archive?.artifacts[0].state, "saved");
        assertEquals(
          latest.archive?.artifacts[0].sha256,
          artifacts[index].sha256,
        );
        const capture = await host.command({
          protocol: PROTOCOL,
          requestId: `fixture-capture-${revision}`,
          command: "viewer.archive-read",
          conversationId,
          viewerId: latest.viewerId,
        });
        assert(capture.ok && capture.viewerCapture !== undefined);
        assertEquals(capture.viewerCapture.toolInput.revision, revision);
        assert(
          JSON.stringify(capture.viewerCapture.toolResult).includes(
            artifacts[index].uri,
          ),
        );
        const saved = await host.command({
          protocol: PROTOCOL,
          requestId: `fixture-live-saved-${revision}`,
          command: "viewer.resource-read",
          conversationId,
          toolCallId: latest.viewerId,
          uri: artifacts[index].uri,
        });
        assert(saved.ok && saved.viewerResource !== undefined);
        assertEquals(saved.viewerResource.source, "saved");
        assertEquals(
          Uint8Array.from(
            atob(saved.viewerResource.data),
            (char) => char.charCodeAt(0),
          ),
          artifacts[index].bytes,
        );
        assertEquals(
          providerCalls,
          Array.from({ length: revision }, (_, i) => i + 1),
        );
        assert(
          !conversation.messages.some((message) => message.text.includes("casys://")),
        );
      }
      const events = (await Deno.readTextFile(join(root, "agent-events.jsonl")))
        .trim()
        .split("\n").map((line) =>
          JSON.parse(line) as {
            kind: string;
            sessionId: string;
            url: string;
            revision?: number;
          }
        );
      assertEquals(events.filter((event) => event.kind === "new").length, 1);
      assertEquals(events.filter((event) => event.kind === "load").length, 1);
      const prompts = events.filter((event) => event.kind === "prompt");
      assertEquals(prompts.map((event) => event.revision), [1, 2]);
      assertEquals(prompts[0].sessionId, prompts[1].sessionId);
      assert(prompts[0].url !== prompts[1].url);

      assertEquals(await host.stop(), { status: "stopped" });
      host = undefined;
      await provider.shutdown();
      host = await start();
      const reopened = await host.snapshot({
        protocol: PROTOCOL,
        conversationId,
      });
      const conversation = reopened.conversations.find((entry) =>
        entry.id === conversationId
      );
      assert(conversation !== undefined);
      assertEquals(conversation.viewers.length, 2);
      for (const [index, viewer] of conversation.viewers.entries()) {
        const artifact = artifacts[index];
        const response = await host.command({
          protocol: PROTOCOL,
          requestId: `fixture-read-${index}`,
          command: "viewer.resource-read",
          conversationId,
          toolCallId: viewer.toolCallId,
          uri: artifact.uri,
        });
        assert(response.ok && response.viewerResource !== undefined);
        assertEquals(response.viewerResource.source, "saved");
        assertEquals(
          Uint8Array.from(
            atob(response.viewerResource.data),
            (char) => char.charCodeAt(0),
          ),
          artifact.bytes,
        );
      }
      assertEquals(providerCalls, [1, 2]);
    } catch (error) {
      const agentLog = await Deno.readTextFile(join(root, "agent-events.jsonl"))
        .catch(() => "<no agent events>");
      throw new Error(
        `${
          error instanceof Error ? error.message : String(error)
        }; agent events: ${agentLog.trim()}`,
      );
    } finally {
      if (host !== undefined) await host.stop().catch(() => undefined);
      await provider.shutdown().catch(() => undefined);
      await Deno.remove(root, { recursive: true });
    }
  },
});

async function waitForIdle(
  host: ChatHostClient,
  conversationId: string,
  count: number,
) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const snapshot = await host.snapshot({
      protocol: PROTOCOL,
      conversationId,
    });
    const conversation = snapshot.conversations.find((entry) =>
      entry.id === conversationId
    );
    assert(conversation !== undefined);
    if (conversation.status === "failed") {
      throw new Error(
        `fixture turn ${count} failed: ${
          conversation.messages.slice(-2).map((message) => message.text).join(
            " | ",
          )
        }`,
      );
    }
    if (
      conversation.status === "idle" && conversation.viewers.length >= count
    ) {
      return conversation;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`fixture turn ${count} did not settle`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
