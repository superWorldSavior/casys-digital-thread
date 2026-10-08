import { assertEquals } from "jsr:@std/assert@1.0.14";
import { FileChatConversationStore, type StoredConversation } from "./store.ts";

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

Deno.test("file store load isolates an invalid artifact manifest", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-chat-file-store-" });
  try {
    const now = new Date("2026-09-27T12:00:00.000Z");
    const store = new FileChatConversationStore({ root, now: () => now });
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

Deno.test("file store preserves standalone whiteboard membership without assigning legacy chats", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-chat-project-membership-" });
  try {
    const now = new Date("2026-09-30T12:00:00.000Z");
    const original = archivedEntry("conversation:member", now.toISOString());
    await new FileChatConversationStore({ root, now: () => now }).save([
      { ...original, workspaceProjectId: "project-a" },
      archivedEntry("conversation:legacy", now.toISOString()),
    ]);
    const loaded = await new FileChatConversationStore({ root, now: () => now }).load();
    const member = loaded.find((entry) => entry.id === original.id);
    assertEquals(member?.workspaceProjectId, "project-a");
    assertEquals(member?.projectId, undefined);
    assertEquals(member?.kind, "standalone");
    assertEquals(member?.sessionKey, original.sessionKey);
    assertEquals(member?.mcpId, original.mcpId);
    assertEquals(member?.toolResults, original.toolResults);
    assertEquals(
      loaded.find((entry) => entry.id === "conversation:legacy")?.workspaceProjectId,
      undefined,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("post-commit artifact cleanup failure preserves membership and retries next save", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-chat-postcommit-gc-" });
  const warning = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    const now = new Date("2026-09-30T12:00:00.000Z");
    const staleDigest = "ef".repeat(32);
    let failRemoval = true;
    const store = new FileChatConversationStore({
      root,
      now: () => now,
      removeArtifactFile: async (path) => {
        if (failRemoval) {
          failRemoval = false;
          throw new Error(`private artifact path: ${path}`);
        }
        await Deno.remove(path);
      },
    });
    await store.saveArtifact(staleDigest, new Uint8Array([1, 2, 3]));
    const member = {
      ...archivedEntry("conversation:member", now.toISOString()),
      workspaceProjectId: "project-a",
    };
    await store.save([member]);
    assertEquals((await store.load())[0]?.workspaceProjectId, "project-a");
    assertEquals(await store.loadArtifact(staleDigest), new Uint8Array([1, 2, 3]));
    assertEquals(warnings, [[
      "Chat artifact cleanup failed after commit; retrying on next save.",
    ]]);

    await store.save([member]);
    assertEquals(await store.loadArtifact(staleDigest), undefined);
    assertEquals((await store.load())[0]?.workspaceProjectId, "project-a");
    assertEquals(warnings.length, 1);
  } finally {
    console.warn = warning;
    await Deno.remove(root, { recursive: true });
  }
});
