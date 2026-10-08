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
  type ChatCommandRequest,
  type ChatCommandResponse,
  type ChatConversationDto,
  type ChatProjectViewerDto,
  type ChatSnapshotDto,
  type ChatToolViewerDto,
  DESKTOP_CHAT_PROTOCOL,
  parseChatCommandResponse,
  parseChatSnapshotDto,
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

Deno.test("focused project aggregates unselected MCP viewers and excludes forged membership", async () => {
  const a1: ChatConversationDto = {
    ...standaloneConversation("conversation:a1", "A1", "coffee-machine"),
    viewers: [projectViewer("conversation:a1", "coffee-machine").viewer],
  };
  const a2: ChatConversationDto = {
    ...standaloneConversation("conversation:a2", "A2", "coffee-machine"),
    viewers: [projectViewer("conversation:a2", "coffee-machine").viewer],
  };
  const b = standaloneConversation("conversation:b", "B_SECRET", "other-project");
  const free = standaloneConversation("conversation:free", "FREE");
  const engineering = conversation("coffee-machine", "conversation:engineering");
  const expected = [
    projectViewer(a1.id, "coffee-machine"),
    projectViewer(a2.id, "coffee-machine"),
  ];
  const hostSnapshot: ChatSnapshotDto = {
    ...snapshot(a1, a2, b, free, engineering),
    retention: { days: 30, maxConversations: 50, maxVersions: 20 },
    projectViewers: [
      ...expected,
      projectViewer(b.id, "other-project"),
      projectViewer(b.id, "coffee-machine"),
      projectViewer(free.id, "coffee-machine"),
      projectViewer(engineering.id, "coffee-machine"),
      projectViewer("conversation:missing", "coffee-machine"),
      projectViewer(a1.id, "other-project"),
    ],
  };
  const binding = testBindings({
    snapshot: () => Promise.resolve(hostSnapshot),
    command: () => Promise.reject(new Error("not used")),
  }, () => Promise.resolve("coffee-machine"));

  const focused = await binding.read();
  assertEquals(focused.conversations.map((entry) => entry.id), [
    a1.id,
    a2.id,
    free.id,
    engineering.id,
  ]);
  assertEquals(focused.projectViewers, expected);
  assertEquals(focused.retention, hostSnapshot.retention);
  assertEquals(JSON.stringify(focused).includes("B_SECRET"), false);

  const selected = await binding.read(a1.id);
  assertEquals(selected.conversations.map((entry) => entry.id), [
    a1.id,
    a2.id,
    free.id,
    engineering.id,
  ]);
  assertEquals(
    selected.conversations.find((entry) => entry.id === a1.id)?.messages.map((entry) =>
      entry.text
    ),
    ["A1"],
  );
  for (const conversationId of [a2.id, free.id, engineering.id]) {
    const unselected = selected.conversations.find((entry) =>
      entry.id === conversationId
    );
    assertEquals(unselected?.messages, []);
    assertEquals(unselected?.viewers, []);
  }
  assertEquals(selected.projectViewers, expected);
  assertEquals(selected.retention, hostSnapshot.retention);
  assertEquals(selected.selectedConversationId, a1.id);
});

Deno.test("associated foreign chats are hidden while unattached standalone chats remain visible", async () => {
  const foreign = standaloneConversation(
    "conversation:b",
    "FOREIGN_SECRET",
    "other-project",
  );
  const free = standaloneConversation("conversation:free", "FREE");
  const requests: Array<string | undefined> = [];
  const binding = testBindings({
    snapshot(input) {
      requests.push(input.conversationId);
      return Promise.resolve(snapshot(foreign, free));
    },
    command: () => Promise.reject(new Error("not used")),
  }, () => Promise.resolve("coffee-machine"));
  await binding.read();
  const hidden = await binding.read(foreign.id);
  assertEquals(hidden.conversations, []);
  assertEquals(hidden.selectedConversationId, undefined);
  assertEquals(JSON.stringify(hidden).includes("FOREIGN_SECRET"), false);
  assertEquals(requests, [undefined]);
  const visible = await binding.read(free.id);
  assertEquals(visible.conversations.map((entry) => entry.id), [free.id]);
  assertEquals(requests, [undefined, free.id]);
});

Deno.test("absent focus releases no project viewers or associated transcripts", async () => {
  const member = standaloneConversation(
    "conversation:a",
    "PROJECT_SECRET",
    "coffee-machine",
  );
  const free = standaloneConversation("conversation:free", "FREE");
  const binding = testBindings({
    snapshot: () =>
      Promise.resolve({
        ...snapshot(member, free),
        projectViewers: [projectViewer(member.id, "coffee-machine")],
      }),
    command: () => Promise.reject(new Error("not used")),
  }, () => Promise.resolve(undefined));
  const result = await binding.read();
  assertEquals(result.projectViewers, []);
  assertEquals(result.conversations.map((entry) => entry.id), [free.id]);
  assertEquals(result.selectedConversationId, undefined);
  assertEquals(JSON.stringify(result).includes("PROJECT_SECRET"), false);
});

Deno.test("focus change while the host snapshot is pending releases neither transcripts nor aggregate", async () => {
  const entered = deferred<void>();
  const release = deferred<void>();
  let focus = "coffee-machine";
  let snapshots = 0;
  const member = standaloneConversation("conversation:a", "STALE_SECRET", focus);
  const binding = testBindings({
    async snapshot() {
      snapshots += 1;
      entered.resolve();
      await release.promise;
      return {
        ...snapshot(member),
        projectViewers: [projectViewer(member.id, "coffee-machine")],
      };
    },
    command: () => Promise.reject(new Error("not used")),
  }, () => Promise.resolve(focus));
  const pending = binding.read();
  await entered.promise;
  focus = "other-project";
  release.resolve();
  const result = await pending;
  assertEquals(result.conversations, []);
  assertEquals(result.projectViewers ?? [], []);
  assertEquals(JSON.stringify(result).includes("STALE_SECRET"), false);
  assertEquals(snapshots, 1);
});

Deno.test("workspace chat creation requires exact available focus before any host command", async () => {
  let focus: string | undefined = "other-project";
  const commands: ChatCommandRequest[] = [];
  let snapshots = 0;
  const binding = testBindings({
    snapshot() {
      snapshots += 1;
      return Promise.resolve(snapshot());
    },
    command(input) {
      commands.push(input);
      return Promise.resolve({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: input.requestId,
        ok: true,
      });
    },
  }, () => Promise.resolve(focus));
  const request: ChatCommandRequest = {
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "create-workspace",
    command: "conversation.create",
    workspaceProjectId: "coffee-machine",
    title: "ERPNext",
  };
  assertEquals((await binding.command(request)).ok, false);
  focus = undefined;
  assertEquals((await binding.command(request)).ok, false);
  assertEquals(commands, []);
  focus = "coffee-machine";
  assertEquals((await binding.command(request)).ok, true);
  assertEquals(commands, [request]);
  assertEquals(snapshots, 0);
});

Deno.test("workspace attachment requires exact available focus and an eligible standalone owner", async () => {
  const free = standaloneConversation("conversation:free");
  const same = standaloneConversation("conversation:same", undefined, "coffee-machine");
  const foreign = standaloneConversation(
    "conversation:foreign",
    undefined,
    "other-project",
  );
  const engineering = conversation("coffee-machine", "conversation:engineering");
  let focus: string | undefined;
  const commands: ChatCommandRequest[] = [];
  const binding = testBindings({
    snapshot: () => Promise.resolve(snapshot(free, same, foreign, engineering)),
    command(input) {
      commands.push(input);
      return Promise.resolve({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: input.requestId,
        ok: true,
      });
    },
  }, () => Promise.resolve(focus));
  const request = {
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "attach-workspace",
    command: "conversation.attach-project",
    conversationId: free.id,
    workspaceProjectId: "coffee-machine",
  } as const;
  assertEquals((await binding.command(request)).ok, false);
  focus = "other-project";
  assertEquals((await binding.command(request)).ok, false);
  focus = "coffee-machine";
  for (const conversationId of [foreign.id, engineering.id, "conversation:missing"]) {
    assertEquals((await binding.command({ ...request, conversationId })).ok, false);
  }
  assertEquals(commands, []);
  assertEquals((await binding.command(request)).ok, true);
  const alreadyAssociated = { ...request, conversationId: same.id };
  assertEquals((await binding.command(alreadyAssociated)).ok, true);
  assertEquals(commands, [request, alreadyAssociated]);
});

Deno.test("project viewer commands retain the original owner and stable capture identity", async () => {
  const selected = standaloneConversation(
    "conversation:selected",
    undefined,
    "coffee-machine",
  );
  const owner = standaloneConversation(
    "conversation:owner",
    undefined,
    "coffee-machine",
  );
  const foreign = standaloneConversation(
    "conversation:foreign",
    undefined,
    "other-project",
  );
  const commands: ChatCommandRequest[] = [];
  const binding = testBindings({
    snapshot: () => Promise.resolve(snapshot(selected, owner, foreign)),
    command(input) {
      commands.push(input);
      return Promise.resolve({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: input.requestId,
        ok: true,
      });
    },
  }, () => Promise.resolve("coffee-machine"));
  const base = { protocol: DESKTOP_CHAT_PROTOCOL, conversationId: owner.id } as const;
  const requests: Array<
    Extract<ChatCommandRequest, {
      command:
        | "viewer.open"
        | "viewer.tool-call"
        | "viewer.resource-read"
        | "viewer.archive-read";
    }>
  > = [
    {
      ...base,
      requestId: "open-capture",
      command: "viewer.open",
      toolCallId: "capture:stable",
    },
    {
      ...base,
      requestId: "call-capture",
      command: "viewer.tool-call",
      toolCallId: "capture:stable",
      name: "erpnext_doc_get",
      arguments: { doctype: "Company", name: "Casys Industries" },
    },
    {
      ...base,
      requestId: "read-capture",
      command: "viewer.resource-read",
      toolCallId: "capture:stable",
      uri: "ui://mcp-erpnext/doc-viewer",
    },
    {
      ...base,
      requestId: "archive-capture",
      command: "viewer.archive-read",
      viewerId: "capture:stable",
    },
  ];
  for (const request of requests) {
    assertEquals(
      (await binding.command({ ...request, conversationId: foreign.id })).ok,
      false,
    );
  }
  assertEquals(commands, []);
  for (const request of requests) {
    assertEquals((await binding.command(request)).ok, true);
  }
  assertEquals(commands, requests);
  assertEquals(
    commands.every((request) =>
      "conversationId" in request && request.conversationId === owner.id
    ),
    true,
  );
});

Deno.test("focus change during workspace command authorization sends zero host commands", async () => {
  for (
    const command of [
      "conversation.create",
      "conversation.attach-project",
      "viewer.open",
    ] as const
  ) {
    const entered = deferred<void>();
    const release = deferred<string>();
    let reads = 0;
    let commands = 0;
    const owner = standaloneConversation(
      "conversation:owner",
      undefined,
      "coffee-machine",
    );
    const binding = testBindings({
      snapshot: () => Promise.resolve(snapshot(owner)),
      command(input) {
        commands += 1;
        return Promise.resolve({
          protocol: DESKTOP_CHAT_PROTOCOL,
          requestId: input.requestId,
          ok: true,
        });
      },
    }, () => {
      reads += 1;
      if (reads === 1) return Promise.resolve("coffee-machine");
      entered.resolve();
      return release.promise;
    });
    const base = {
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: `race:${command}`,
    } as const;
    const request: ChatCommandRequest = command === "conversation.create"
      ? { ...base, command, workspaceProjectId: "coffee-machine" }
      : command === "conversation.attach-project"
      ? {
        ...base,
        command,
        conversationId: owner.id,
        workspaceProjectId: "coffee-machine",
      }
      : { ...base, command, conversationId: owner.id, toolCallId: "capture:stable" };
    const pending = binding.command(request);
    await Promise.race([
      entered.promise,
      pending.then(() => {
        throw new Error("command completed before verifying the focus again");
      }),
    ]);
    assertEquals(commands, 0);
    release.resolve("other-project");
    assertEquals((await pending).ok, false);
    assertEquals(commands, 0);
    assertEquals(reads, 2);
  }
});

function testBindings(
  host: DesktopChatBindingHost,
  currentProjectId: () => Promise<string | undefined>,
): {
  read(conversationId?: string): Promise<ChatSnapshotDto>;
  command(input: ChatCommandRequest): Promise<ChatCommandResponse>;
} {
  const handlers = new Map<string, (input: unknown) => unknown>();
  registerDesktopChatBindings(
    { bind: (name, handler) => handlers.set(name, handler) },
    host,
    undefined,
    { currentProjectId },
  );
  return {
    async read(conversationId) {
      return parseChatSnapshotDto(
        await handlers.get(CHAT_SNAPSHOT_BINDING)?.({
          protocol: DESKTOP_CHAT_PROTOCOL,
          ...(conversationId === undefined ? {} : { conversationId }),
        }),
      );
    },
    async command(input) {
      return parseChatCommandResponse(
        await handlers.get(CHAT_COMMAND_BINDING)?.(input),
      );
    },
  };
}

function projectViewer(
  owningConversationId: string,
  workspaceProjectId: string,
): ChatProjectViewerDto {
  const viewer: ChatToolViewerDto = {
    viewerId: `capture:${owningConversationId}`,
    toolCallId: "native-call:reused",
    messageId: `message:${owningConversationId}`,
    tool: "erpnext_company_list",
    appUri: "ui://mcp-erpnext/doclist-viewer",
  };
  return { workspaceProjectId, owningConversationId, viewer };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

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
  workspaceProjectId?: string,
): ChatConversationDto {
  return Object.freeze({
    id,
    kind: "standalone" as const,
    ...(workspaceProjectId === undefined ? {} : { workspaceProjectId }),
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
