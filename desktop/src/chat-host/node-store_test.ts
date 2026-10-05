import { assertEquals } from "jsr:@std/assert@1.0.14";
import type { StoredConversation } from "../chat/store.ts";
import { NodeChatConversationStore } from "./node-store.ts";

Deno.test("Chat Host persists metadata and bounded transcript outside Thread and CAS", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-chat-store-" });
  try {
    const now = new Date("2026-08-23T12:00:00.000Z");
    const store = new NodeChatConversationStore(root, {
      now: () => now,
      retentionDays: 30,
      maxConversations: 2,
      maxMessagesPerConversation: 1,
    });
    const current = conversation("conversation:current", now.toISOString(), 2);
    const expired = conversation("conversation:expired", "2026-07-01T00:00:00.000Z", 1);
    await store.save([expired, current]);
    const loaded = await store.load();
    assertEquals(loaded.length, 1);
    assertEquals(loaded[0].id, current.id);
    assertEquals(loaded[0].messages.map((message) => message.text), ["message 2"]);
    const index = JSON.parse(await Deno.readTextFile(`${root}/conversations.json`));
    assertEquals("messages" in index.conversations[0], false);
    assertEquals(await exists(`${root}/thread`), false);
    assertEquals(await exists(`${root}/cas`), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("Chat Host store round-trips standalone kind, MCP, and viewer archive", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-chat-store-" });
  try {
    const now = new Date("2026-09-27T12:00:00.000Z");
    const store = new NodeChatConversationStore(root, { now: () => now });
    const sha256 = "ab".repeat(32);
    await store.saveArtifact(sha256, new TextEncoder().encode("glb-bytes"));
    const entry: StoredConversation = {
      id: "conversation:solo",
      kind: "standalone",
      agentProfileId: "casys-muse",
      sessionKey: "casys-desktop-exclusive/standalone/conversation:solo",
      title: "Standalone",
      status: "idle",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      messages: [
        {
          id: "message-1",
          role: "assistant",
          kind: "text",
          text: "volume 1000",
          createdAt: now.toISOString(),
          agent: "casys-muse",
        },
      ],
      mcpId: "build123d",
      mcpStatus: "connected",
      mcpTools: ["build123d_export"],
      toolResults: [
        {
          toolCallId: "tool-call-1",
          server: "build123d",
          tool: "build123d_export",
          messageId: "message-1",
          appUri: "ui://mcp-build123d/results-viewer",
          failed: false,
          input: { script: "result = 1" },
          result: { volume: 1000 },
          capturedAt: now.toISOString(),
          revision: 1,
          resultDigest: `sha256:${"cd".repeat(32)}`,
          artifacts: [
            {
              uri: `casys://build123d/artifacts/${sha256}.glb`,
              fileName: `${sha256}.glb`,
              mimeType: "model/gltf-binary",
              bytes: 9,
              sha256,
              state: "saved",
              savedAt: now.toISOString(),
            },
          ],
        },
      ],
    };
    await store.save([entry]);
    const loaded = await store.load();
    assertEquals(loaded.length, 1);
    assertEquals(loaded[0].kind, "standalone");
    assertEquals(loaded[0].agentProfileId, "casys-muse");
    assertEquals(loaded[0].messages[0].agent, "casys-muse");
    assertEquals(loaded[0].mcpId, "build123d");
    assertEquals(loaded[0].mcpTools, ["build123d_export"]);
    assertEquals(loaded[0].toolResults?.length, 1);
    assertEquals(loaded[0].toolResults?.[0].revision, 1);
    assertEquals(
      loaded[0].toolResults?.[0].artifacts?.[0].state,
      "saved",
    );
    assertEquals(
      new TextDecoder().decode(await store.loadArtifact(sha256)),
      "glb-bytes",
    );
    assertEquals(store.retention(), { days: 30, maxConversations: 50 });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("Chat Host store prunes only bytes unreferenced by retained work", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-chat-store-" });
  try {
    const now = new Date("2026-09-27T12:00:00.000Z");
    const store = new NodeChatConversationStore(root, { now: () => now });
    const kept = "11".repeat(32);
    const dropped = "22".repeat(32);
    await store.saveArtifact(kept, new Uint8Array([1]));
    await store.saveArtifact(dropped, new Uint8Array([2]));
    const entry: StoredConversation = {
      id: "conversation:solo",
      kind: "standalone",
      sessionKey: "casys-desktop-exclusive/standalone/conversation:solo",
      title: "Standalone",
      status: "idle",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      messages: [],
      toolResults: [
        {
          toolCallId: "tool-call-1",
          server: "build123d",
          tool: "t_one",
          messageId: "message-1",
          appUri: "ui://mcp-build123d/results-viewer",
          failed: false,
          input: {},
          result: {},
          capturedAt: now.toISOString(),
          artifacts: [
            {
              uri: `casys://build123d/artifacts/${kept}.glb`,
              fileName: "kept.glb",
              mimeType: "model/gltf-binary",
              bytes: 1,
              sha256: kept,
              state: "saved",
            },
          ],
        },
      ],
    };
    await store.save([entry]);
    assertEquals(await store.loadArtifact(kept), new Uint8Array([1]));
    assertEquals(await store.loadArtifact(dropped), undefined);
    assertEquals(await store.loadArtifact("not-a-digest"), undefined);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

function conversation(
  id: string,
  updatedAt: string,
  messageCount: number,
): StoredConversation {
  return {
    id,
    projectId: "coffee-machine",
    sessionKey: `casys-desktop-exclusive/coffee-machine/${id}`,
    title: "Project coffee-machine",
    status: "idle",
    createdAt: updatedAt,
    updatedAt,
    messages: Array.from({ length: messageCount }, (_, index) => ({
      id: `message:${index + 1}`,
      role: "assistant" as const,
      kind: "text" as const,
      text: `message ${index + 1}`,
      createdAt: updatedAt,
    })),
  };
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

function archivedEntry(id: string, now: string): StoredConversation {
  const sha256 = "ab".repeat(32);
  return {
    id,
    kind: "standalone",
    sessionKey: `casys-desktop-exclusive/standalone/${id}`,
    title: "Standalone",
    status: "idle",
    createdAt: now,
    updatedAt: now,
    messages: [],
    mcpId: "build123d",
    mcpStatus: "connected",
    mcpTools: ["build123d_export"],
    toolResults: [
      {
        toolCallId: "tool-call-1",
        server: "build123d",
        tool: "build123d_export",
        messageId: "message-1",
        appUri: "ui://mcp-build123d/results-viewer",
        failed: false,
        input: { script: "result = 1" },
        result: { volume: 1000 },
        capturedAt: now,
        revision: 1,
        resultDigest: `sha256:${"cd".repeat(32)}`,
        artifacts: [
          {
            uri: `casys://build123d/artifacts/${sha256}.glb`,
            fileName: `${sha256}.glb`,
            mimeType: "model/gltf-binary",
            bytes: 9,
            sha256,
            state: "saved",
            savedAt: now,
          },
        ],
      },
    ],
  };
}

Deno.test("Node store load isolates an invalid artifact manifest", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-chat-node-store-" });
  try {
    const now = new Date("2026-09-27T12:00:00.000Z");
    const store = new NodeChatConversationStore(root, { now: () => now });
    await store.save([
      archivedEntry("conversation:tampered", now.toISOString()),
      archivedEntry("conversation:clean", now.toISOString()),
    ]);
    const indexPath = `${root}/conversations.json`;
    const index = JSON.parse(await Deno.readTextFile(indexPath));
    const tampered = index.conversations.find((entry: { id: string }) =>
      entry.id === "conversation:tampered"
    );
    tampered.toolResults[0].artifacts[0].fileName = "../escape.step";
    await Deno.writeTextFile(indexPath, JSON.stringify(index));
    const loaded = await store.load();
    assertEquals(loaded.length, 2);
    const degraded = loaded.find((entry) => entry.id === "conversation:tampered");
    assertEquals(degraded?.toolResults?.length, 1);
    assertEquals(degraded?.toolResults?.[0].toolCallId, "tool-call-1");
    assertEquals(degraded?.toolResults?.[0].revision, undefined);
    assertEquals(degraded?.toolResults?.[0].resultDigest, undefined);
    assertEquals(degraded?.toolResults?.[0].artifacts, undefined);
    assertEquals(
      JSON.stringify(loaded).includes("escape.step"),
      false,
      "invalid manifest path leaked into loaded state",
    );
    const clean = loaded.find((entry) => entry.id === "conversation:clean");
    assertEquals(clean?.toolResults?.[0].revision, 1);
    assertEquals(clean?.toolResults?.[0].artifacts?.[0].state, "saved");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
