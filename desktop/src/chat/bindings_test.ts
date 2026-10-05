import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import {
  CHAT_COMMAND_BINDING,
  CHAT_SAVE_FILE_BINDING,
  CHAT_SNAPSHOT_BINDING,
  CHAT_VIEWER_APP_BINDING,
  type DesktopChatBindingHost,
  registerDesktopChatBindings,
} from "./bindings.ts";
import {
  type ChatConversationDto,
  DESKTOP_CHAT_PROTOCOL,
} from "../../../src/presentation/desktop/chat/contracts.ts";
import type { ChatViewerBackend } from "./viewer-backend.ts";

Deno.test("Desktop registers only four narrow, versioned Chat bindings", async () => {
  const handlers = new Map<string, (input: unknown) => unknown>();
  registerDesktopChatBindings({
    bind(name, handler) {
      handlers.set(name, handler);
    },
  });
  assertEquals(
    [...handlers.keys()],
    [
      CHAT_SNAPSHOT_BINDING,
      CHAT_COMMAND_BINDING,
      CHAT_VIEWER_APP_BINDING,
      CHAT_SAVE_FILE_BINDING,
    ],
  );
  assertEquals(
    await handlers.get(CHAT_SNAPSHOT_BINDING)?.({ protocol: DESKTOP_CHAT_PROTOCOL }),
    {
      protocol: DESKTOP_CHAT_PROTOCOL,
      host: "unavailable",
      conversations: [],
      connectableMcps: [],
      error: "The packaged Chat Host is unavailable.",
      agentProfiles: [],
      defaultAgentProfileId: "casys-muse",
    },
  );
  assertEquals(
    await handlers.get(CHAT_COMMAND_BINDING)?.({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "request-1",
      command: "conversation.create",
      projectId: "coffee-machine",
    }),
    {
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "request-1",
      ok: false,
      error: "The packaged Chat Host is unavailable.",
    },
  );
  assertEquals(
    await handlers.get(CHAT_VIEWER_APP_BINDING)?.({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "request-app-1",
      server: "build123d",
      uri: "ui://build123d/results-viewer",
      fingerprint: `sha256:${"0".repeat(64)}`,
    }),
    {
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "request-app-1",
      ok: false,
      error: "Live viewer Apps are unavailable on this Desktop target.",
    },
  );
  assertEquals(
    await handlers.get(CHAT_SAVE_FILE_BINDING)?.({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "save-1",
      fileName: "box-v1.glb",
      data: "Z2xiAA==",
    }),
    {
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "save-1",
      ok: false,
      error: "File export is unavailable on this Desktop target.",
    },
  );
  await assertRejects(() =>
    Promise.resolve(
      handlers.get(CHAT_COMMAND_BINDING)?.({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: "request-2",
        command: "message.send",
        conversationId: "conversation:1",
        text: "",
      }),
    )
  );
});

Deno.test("viewer App binding ships bytes only on fingerprint match", async () => {
  const handlers = new Map<string, (input: unknown) => unknown>();
  const fingerprint = `sha256:${"1".repeat(64)}`;
  const viewerApp: ChatViewerBackend = {
    resolveApp: (_server, uri) =>
      Promise.resolve({
        uri,
        mimeType: "text/html;profile=mcp-app",
        bytes: new TextEncoder().encode("<app/>"),
        fingerprint,
      }),
    callTool: () => Promise.reject(new Error("not used")),
    readResource: () => Promise.reject(new Error("not used")),
  };
  registerDesktopChatBindings(
    { bind: (name, handler) => handlers.set(name, handler) },
    undefined,
    undefined,
    undefined,
    viewerApp,
  );
  const fetch = handlers.get(CHAT_VIEWER_APP_BINDING);
  assertEquals(
    await fetch?.({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "request-app-match",
      server: "build123d",
      uri: "ui://build123d/results-viewer",
      fingerprint,
    }),
    {
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "request-app-match",
      ok: true,
      app: {
        uri: "ui://build123d/results-viewer",
        mimeType: "text/html;profile=mcp-app",
        bytes: 6,
        fingerprint,
        encoding: "base64",
        data: btoa("<app/>"),
      },
    },
  );
  assertEquals(
    await fetch?.({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "request-app-rotated",
      server: "build123d",
      uri: "ui://build123d/results-viewer",
      fingerprint: `sha256:${"2".repeat(64)}`,
    }),
    {
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "request-app-rotated",
      ok: false,
      error: "Viewer App bytes no longer match the pinned fingerprint.",
    },
  );
});

Deno.test("save-file binding decodes bytes and reports the saved path", async () => {
  const handlers = new Map<string, (input: unknown) => unknown>();
  const saved: Array<{ fileName: string; bytes: Uint8Array }> = [];
  registerDesktopChatBindings(
    { bind: (name, handler) => handlers.set(name, handler) },
    undefined,
    undefined,
    undefined,
    undefined,
    {
      saveFile: (fileName, data) => {
        saved.push({ fileName, bytes: data });
        return Promise.resolve({
          path: `/Downloads/${fileName}`,
          bytes: data.byteLength,
        });
      },
    },
  );
  assertEquals(
    await handlers.get(CHAT_SAVE_FILE_BINDING)?.({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "save-2",
      fileName: "box-v1.glb",
      data: "Z2xiAA==",
    }),
    {
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "save-2",
      ok: true,
      path: "/Downloads/box-v1.glb",
      bytes: 4,
    },
  );
  assertEquals(saved.length, 1);
  assertEquals(saved[0].fileName, "box-v1.glb");
  assertEquals(saved[0].bytes, new Uint8Array([0x67, 0x6c, 0x62, 0x00]));
  assertEquals(
    await handlers.get(CHAT_SAVE_FILE_BINDING)?.({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "save-3",
      fileName: "../escape.glb",
      data: "Z2xiAA==",
    }),
    {
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "invalid",
      ok: false,
      error: "File export request is invalid.",
    },
  );
  assertEquals(
    await handlers.get(CHAT_SAVE_FILE_BINDING)?.({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "save-4",
      fileName: "box-v1.glb",
      data: "ab=c",
    }),
    {
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "invalid",
      ok: false,
      error: "File export request is invalid.",
    },
  );
  // Padding-only input passes the alphabet shape but cannot decode: the
  // binding reports invalid data instead of a raw engine message.
  assertEquals(
    await handlers.get(CHAT_SAVE_FILE_BINDING)?.({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "save-5",
      fileName: "box-v1.glb",
      data: "==",
    }),
    {
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "save-5",
      ok: false,
      error: "File export data is invalid.",
    },
  );
});

Deno.test("external URL command stays on the Desktop binding capability", async () => {
  const handlers = new Map<string, (input: unknown) => unknown>();
  const opened: string[] = [];
  registerDesktopChatBindings(
    {
      bind(name, handler) {
        handlers.set(name, handler);
      },
    },
    undefined,
    {
      open(url) {
        opened.push(url);
        return Promise.resolve();
      },
    },
  );
  assertEquals(
    await handlers.get(CHAT_COMMAND_BINDING)?.({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "external-1",
      command: "external.open",
      url: "https://example.com/confirm",
    }),
    { protocol: DESKTOP_CHAT_PROTOCOL, requestId: "external-1", ok: true },
  );
  assertEquals(opened, ["https://example.com/confirm"]);
});

Deno.test("Chat snapshot without Workbench focus passes standalone chats only", async () => {
  const handlers = new Map<string, (input: unknown) => unknown>();
  let snapshots = 0;
  registerDesktopChatBindings(
    { bind: (name, handler) => handlers.set(name, handler) },
    {
      snapshot() {
        snapshots += 1;
        return Promise.resolve(snapshot(
          conversation("coffee-machine", "conversation:coffee", "CURRENT"),
          standaloneConversation("conversation:solo", "SOLO"),
        ));
      },
      command: () => Promise.reject(new Error("not used")),
    },
    undefined,
    { currentProjectId: () => Promise.resolve(undefined) },
  );

  const response = await handlers.get(CHAT_SNAPSHOT_BINDING)?.({
    protocol: DESKTOP_CHAT_PROTOCOL,
  });
  assertEquals(
    (response as { conversations: readonly ChatConversationDto[] }).conversations
      .map((item) => item.id),
    ["conversation:solo"],
  );
  assertEquals(snapshots, 1);
  assertEquals(JSON.stringify(response).includes("CURRENT"), false);
});

Deno.test("global Chat snapshot filters foreign transcripts and known foreign ids call no Host", async () => {
  const handlers = new Map<string, (input: unknown) => unknown>();
  let snapshots = 0;
  registerDesktopChatBindings(
    { bind: (name, handler) => handlers.set(name, handler) },
    {
      snapshot() {
        snapshots += 1;
        return Promise.resolve(snapshot(
          conversation("coffee-machine", "conversation:coffee", "CURRENT"),
          conversation("foreign-project", "conversation:foreign", "FOREIGN_SECRET"),
        ));
      },
      command: () => Promise.reject(new Error("not used")),
    },
    undefined,
    { currentProjectId: () => Promise.resolve("coffee-machine") },
  );

  const global = await handlers.get(CHAT_SNAPSHOT_BINDING)?.({
    protocol: DESKTOP_CHAT_PROTOCOL,
  });
  assertEquals(
    (global as { conversations: readonly ChatConversationDto[] }).conversations
      .map((item) => item.id),
    ["conversation:coffee"],
  );
  assertEquals(JSON.stringify(global).includes("FOREIGN_SECRET"), false);
  assertEquals(snapshots, 1);

  const foreign = await handlers.get(CHAT_SNAPSHOT_BINDING)?.({
    protocol: DESKTOP_CHAT_PROTOCOL,
    conversationId: "conversation:foreign",
  });
  assertEquals(
    (foreign as { conversations: readonly ChatConversationDto[] }).conversations,
    [],
  );
  assertEquals(JSON.stringify(foreign).includes("FOREIGN_SECRET"), false);
  assertEquals(snapshots, 1);
});

Deno.test("focus changing while Chat snapshot loads releases zero transcript", async () => {
  const handlers = new Map<string, (input: unknown) => unknown>();
  const focus = ["coffee-machine", "other-project"];
  let snapshots = 0;
  registerDesktopChatBindings(
    { bind: (name, handler) => handlers.set(name, handler) },
    {
      snapshot() {
        snapshots += 1;
        return Promise.resolve(snapshot(
          conversation("coffee-machine", "conversation:coffee", "CHANGED_SECRET"),
        ));
      },
      command: () => Promise.reject(new Error("not used")),
    },
    undefined,
    { currentProjectId: () => Promise.resolve(focus.shift()) },
  );

  const response = await handlers.get(CHAT_SNAPSHOT_BINDING)?.({
    protocol: DESKTOP_CHAT_PROTOCOL,
  });
  assertEquals(
    (response as { conversations: readonly ChatConversationDto[] }).conversations,
    [],
  );
  assertEquals(JSON.stringify(response).includes("CHANGED_SECRET"), false);
  assertEquals(snapshots, 1);
});

Deno.test("WebView conversation creation is refused out of focus before Chat Host", async () => {
  const handlers = new Map<string, (input: unknown) => unknown>();
  const commandInputs: unknown[] = [];
  let snapshots = 0;
  let focusedProjectId: string | undefined = "coffee-machine";
  const host: DesktopChatBindingHost = {
    snapshot() {
      snapshots += 1;
      return Promise.resolve(snapshot());
    },
    command(input) {
      commandInputs.push(input);
      return Promise.resolve({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: input.requestId,
        ok: true,
        conversationId: "conversation:1",
      });
    },
  };
  registerDesktopChatBindings(
    { bind: (name, handler) => handlers.set(name, handler) },
    host,
    undefined,
    { currentProjectId: () => Promise.resolve(focusedProjectId) },
  );

  assertEquals(
    await handlers.get(CHAT_COMMAND_BINDING)?.({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "create-out-of-focus",
      command: "conversation.create",
      projectId: "foreign-project",
    }),
    {
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "create-out-of-focus",
      ok: false,
      error: "Chat command project does not match the current Workbench project focus.",
    },
  );
  assertEquals(snapshots, 0);
  assertEquals(commandInputs, []);

  focusedProjectId = undefined;
  assertEquals(
    await handlers.get(CHAT_COMMAND_BINDING)?.({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "create-without-focus",
      command: "conversation.create",
      projectId: "coffee-machine",
    }),
    {
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "create-without-focus",
      ok: false,
      error: "Chat commands require an available Workbench project focus.",
    },
  );
  assertEquals(commandInputs, []);

  focusedProjectId = "coffee-machine";
  assertEquals(
    await handlers.get(CHAT_COMMAND_BINDING)?.({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "create-in-focus",
      command: "conversation.create",
      projectId: "coffee-machine",
    }),
    {
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "create-in-focus",
      ok: true,
      conversationId: "conversation:1",
    },
  );
  assertEquals(snapshots, 0);
  assertEquals(commandInputs.length, 1);
});

Deno.test("existing conversation commands remain bound to the current focus", async () => {
  const handlers = new Map<string, (input: unknown) => unknown>();
  const commandInputs: unknown[] = [];
  let focusedProjectId: string | undefined = "coffee-machine";
  const host: DesktopChatBindingHost = {
    snapshot: () => Promise.resolve(snapshot(conversation())),
    command(input) {
      commandInputs.push(input);
      return Promise.resolve({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: input.requestId,
        ok: true,
        conversationId: "conversation:1",
      });
    },
  };
  registerDesktopChatBindings(
    { bind: (name, handler) => handlers.set(name, handler) },
    host,
    undefined,
    { currentProjectId: () => Promise.resolve(focusedProjectId) },
  );
  const request = {
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "message-1",
    command: "message.send",
    conversationId: "conversation:1",
    text: "Continue",
  } as const;

  assertEquals(await handlers.get(CHAT_COMMAND_BINDING)?.(request), {
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "message-1",
    ok: true,
    conversationId: "conversation:1",
  });
  focusedProjectId = "other-project";
  assertEquals(
    await handlers.get(CHAT_COMMAND_BINDING)?.({
      ...request,
      requestId: "message-after-focus-change",
    }),
    {
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "message-after-focus-change",
      ok: false,
      error: "Chat command project does not match the current Workbench project focus.",
    },
  );
  assertEquals(commandInputs.length, 1);
});

Deno.test("focus changing during existing-conversation authorization fails closed", async () => {
  const handlers = new Map<string, (input: unknown) => unknown>();
  const focus = ["coffee-machine", "other-project"];
  let commands = 0;
  registerDesktopChatBindings(
    { bind: (name, handler) => handlers.set(name, handler) },
    {
      snapshot: () => Promise.resolve(snapshot(conversation())),
      command(input) {
        commands += 1;
        return Promise.resolve({
          protocol: DESKTOP_CHAT_PROTOCOL,
          requestId: input.requestId,
          ok: true,
        });
      },
    },
    undefined,
    { currentProjectId: () => Promise.resolve(focus.shift()) },
  );

  assertEquals(
    await handlers.get(CHAT_COMMAND_BINDING)?.({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "changed-mid-command",
      command: "conversation.close",
      conversationId: "conversation:1",
    }),
    {
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "changed-mid-command",
      ok: false,
      error: "Chat command project does not match the current Workbench project focus.",
    },
  );
  assertEquals(commands, 0);
});

Deno.test("standalone creation and commands need no Workbench focus", async () => {
  const handlers = new Map<string, (input: unknown) => unknown>();
  const commandInputs: unknown[] = [];
  const host: DesktopChatBindingHost = {
    snapshot: () => Promise.resolve(snapshot(standaloneConversation())),
    command(input) {
      commandInputs.push(input);
      return Promise.resolve({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: input.requestId,
        ok: true,
        conversationId: "conversation:solo",
      });
    },
  };
  registerDesktopChatBindings(
    { bind: (name, handler) => handlers.set(name, handler) },
    host,
    undefined,
    { currentProjectId: () => Promise.resolve(undefined) },
  );

  assertEquals(
    await handlers.get(CHAT_COMMAND_BINDING)?.({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "create-standalone",
      command: "conversation.create",
    }),
    {
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "create-standalone",
      ok: true,
      conversationId: "conversation:solo",
    },
  );
  assertEquals(
    await handlers.get(CHAT_COMMAND_BINDING)?.({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "standalone-message",
      command: "message.send",
      conversationId: "conversation:solo",
      text: "Hello",
    }),
    {
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "standalone-message",
      ok: true,
      conversationId: "conversation:solo",
    },
  );
  assertEquals(commandInputs.length, 2);
});

Deno.test("unknown conversation ids are verified against the Host before selection", async () => {
  const handlers = new Map<string, (input: unknown) => unknown>();
  let snapshots = 0;
  const host: DesktopChatBindingHost = {
    snapshot(input) {
      snapshots += 1;
      const all = [
        conversation("foreign-project", "conversation:foreign", "FOREIGN_SECRET"),
        standaloneConversation("conversation:solo", "SOLO"),
      ];
      const matching = input.conversationId === undefined
        ? all
        : all.filter((entry) => entry.id === input.conversationId);
      return Promise.resolve(snapshot(...matching));
    },
    command: () => Promise.reject(new Error("not used")),
  };
  registerDesktopChatBindings(
    { bind: (name, handler) => handlers.set(name, handler) },
    host,
    undefined,
    { currentProjectId: () => Promise.resolve("coffee-machine") },
  );

  // Unknown foreign id: verified against the Host, then filtered with no load.
  const foreign = await handlers.get(CHAT_SNAPSHOT_BINDING)?.({
    protocol: DESKTOP_CHAT_PROTOCOL,
    conversationId: "conversation:foreign",
  });
  assertEquals(
    (foreign as { conversations: readonly ChatConversationDto[] }).conversations,
    [],
  );
  assertEquals(JSON.stringify(foreign).includes("FOREIGN_SECRET"), false);
  assertEquals(snapshots, 1);

  // Unknown standalone id: verified then passed with its transcript.
  const solo = await handlers.get(CHAT_SNAPSHOT_BINDING)?.({
    protocol: DESKTOP_CHAT_PROTOCOL,
    conversationId: "conversation:solo",
  });
  assertEquals(
    (solo as { conversations: readonly ChatConversationDto[] }).conversations.map(
      (item) => item.id,
    ),
    ["conversation:solo"],
  );
});

function snapshot(...conversations: readonly ChatConversationDto[]) {
  return Object.freeze({
    protocol: DESKTOP_CHAT_PROTOCOL,
    host: "ready" as const,
    conversations: Object.freeze(conversations),
    connectableMcps: Object.freeze([]),
    ...(conversations[0] === undefined
      ? {}
      : { selectedConversationId: conversations[0].id }),
    agentProfiles: Object.freeze([{
      id: "casys-muse",
      displayName: "Muse",
      available: true,
      version: "test-1",
      modelsExposed: false,
    }]),
    defaultAgentProfileId: "casys-muse",
  });
}

function conversation(
  projectId = "coffee-machine",
  id = "conversation:1",
  message?: string,
): ChatConversationDto {
  return Object.freeze({
    id,
    kind: "project" as const,
    projectId,
    title: "Coffee machine",
    status: "idle",
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    agentProfileId: "casys-muse",
    viewers: Object.freeze([]),
    messages: Object.freeze(
      message === undefined ? [] : [{
        id: `message:${id}`,
        role: "assistant" as const,
        kind: "text" as const,
        text: message,
        createdAt: "2026-08-23T00:00:00.000Z",
      }],
    ),
  });
}

function standaloneConversation(
  id = "conversation:solo",
  message?: string,
): ChatConversationDto {
  return Object.freeze({
    id,
    kind: "standalone" as const,
    title: "Standalone chat",
    status: "idle",
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    agentProfileId: "casys-muse",
    viewers: Object.freeze([]),
    messages: Object.freeze(
      message === undefined ? [] : [{
        id: `message:${id}`,
        role: "assistant" as const,
        kind: "text" as const,
        text: message,
        createdAt: "2026-08-23T00:00:00.000Z",
      }],
    ),
  });
}
