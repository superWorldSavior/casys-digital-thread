import { assertEquals, assertThrows } from "@std/assert";
import {
  DESKTOP_CHAT_PROTOCOL,
  extractViewerArtifactRecords,
  isChatOpaqueId,
  isChatViewerToolName,
  isChatViewerUiUri,
  parseChatCanvasLayout,
  parseChatCommandRequest,
  parseChatCommandResponse,
  parseChatSaveFileRequest,
  parseChatSaveFileResponse,
  parseChatSnapshotDto,
  parseChatViewerAppFetchRequest,
  parseChatViewerAppFetchResponse,
  parseChatViewerArguments,
  parseChatViewerJson,
} from "./contracts.ts";

function conversation(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "conv-1",
    kind: "standalone",
    title: "Standalone",
    status: "idle",
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
    agentProfileId: "casys-muse",
    messages: [],
    viewers: [],
    ...overrides,
  };
}

function agentProfile(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "casys-muse",
    displayName: "Muse",
    available: true,
    version: "1.4.0",
    modelsExposed: false,
    ...overrides,
  };
}

function snapshotWith(
  ...conversations: ReadonlyArray<Record<string, unknown>>
): Record<string, unknown> {
  return {
    protocol: DESKTOP_CHAT_PROTOCOL,
    host: "ready",
    conversations: [...conversations],
    connectableMcps: [],
    agentProfiles: [
      agentProfile(),
      agentProfile({
        id: "casys-codex",
        displayName: "Codex",
        available: false,
        version: undefined,
        missingReason: "Codex is not signed in.",
      }),
    ],
    defaultAgentProfileId: "casys-muse",
  };
}

Deno.test("snapshot accepts a standalone conversation without a projectId", () => {
  const parsed = parseChatSnapshotDto(snapshotWith(conversation()));
  assertEquals(parsed.conversations.length, 1);
  assertEquals(parsed.conversations[0]?.kind, "standalone");
});

Deno.test("snapshot accepts a project conversation with a valid projectId", () => {
  const parsed = parseChatSnapshotDto(
    snapshotWith(
      conversation({
        kind: "project",
        projectId: "proj-123",
        title: "proj-123",
      }),
    ),
  );
  assertEquals(parsed.conversations[0]?.projectId, "proj-123");
});

Deno.test("snapshot rejects a standalone conversation carrying a projectId", () => {
  assertThrows(
    () =>
      parseChatSnapshotDto(
        snapshotWith(conversation({ projectId: "proj-123" })),
      ),
    TypeError,
    "standalone conversation must not have a projectId",
  );
});

Deno.test("snapshot rejects a project conversation without a projectId", () => {
  assertThrows(
    () => parseChatSnapshotDto(snapshotWith(conversation({ kind: "project" }))),
    TypeError,
    "project conversation requires a projectId",
  );
});

Deno.test("snapshot rejects a projectId outside the closed identifier contract", () => {
  assertThrows(
    () =>
      parseChatSnapshotDto(
        snapshotWith(
          conversation({ kind: "project", projectId: "not a project!" }),
        ),
      ),
    TypeError,
    "projectId must be an explicit Casys project identifier",
  );
});

Deno.test("snapshot carries agent profiles, default, and message provenance", () => {
  const parsed = parseChatSnapshotDto(
    snapshotWith(
      conversation({
        agentProfileId: "casys-codex",
        messages: [
          {
            id: "m-1",
            role: "user",
            kind: "text",
            text: "Hi",
            createdAt: "2026-09-27T00:00:00.000Z",
          },
          {
            id: "m-2",
            role: "assistant",
            kind: "text",
            text: "Hello",
            createdAt: "2026-09-27T00:00:01.000Z",
            agent: "casys-codex",
          },
        ],
      }),
    ),
  );
  assertEquals(parsed.defaultAgentProfileId, "casys-muse");
  assertEquals(parsed.agentProfiles.length, 2);
  assertEquals(parsed.agentProfiles[0]?.id, "casys-muse");
  assertEquals(parsed.agentProfiles[1]?.missingReason, "Codex is not signed in.");
  assertEquals(parsed.conversations[0]?.agentProfileId, "casys-codex");
  assertEquals(parsed.conversations[0]?.messages[0]?.agent, undefined);
  assertEquals(parsed.conversations[0]?.messages[1]?.agent, "casys-codex");
});

Deno.test("snapshot refuses malformed agent profile shapes", () => {
  assertThrows(
    () => parseChatSnapshotDto(snapshotWith(conversation({ agentProfileId: "Nope!" }))),
    TypeError,
    "agentProfileId is invalid",
  );
  assertThrows(
    () =>
      parseChatSnapshotDto({
        ...snapshotWith(conversation()),
        agentProfiles: [agentProfile({ available: true, missingReason: "nope" })],
      }),
    TypeError,
    "available agent profile must not carry a missing reason",
  );
  assertThrows(
    () =>
      parseChatSnapshotDto({
        ...snapshotWith(conversation()),
        agentProfiles: [],
        defaultAgentProfileId: "not a profile!",
      }),
    TypeError,
    "defaultAgentProfileId is invalid",
  );
});

Deno.test("agent commands parse profile ids strictly", () => {
  const select = parseChatCommandRequest({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "r-agent-1",
    command: "agent.select",
    conversationId: "conv-1",
    profileId: "casys-muse",
  });
  assertEquals(select.command, "agent.select");
  const setDefault = parseChatCommandRequest({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "r-agent-2",
    command: "agent.set-default",
    profileId: "custom-x",
  });
  assertEquals(setDefault.command, "agent.set-default");
  const reload = parseChatCommandRequest({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "r-agent-3",
    command: "agent.reload-profiles",
  });
  assertEquals(reload.command, "agent.reload-profiles");
  assertThrows(
    () =>
      parseChatCommandRequest({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: "r-agent-4",
        command: "agent.select",
        conversationId: "conv-1",
        profileId: "Not A Profile!",
      }),
    TypeError,
    "profileId is invalid",
  );
});

const VIEWER_FINGERPRINT = `sha256:${"ab".repeat(32)}`;

Deno.test("viewer App fetch request pins server, uri, and fingerprint", () => {
  const parsed = parseChatViewerAppFetchRequest({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "request-app-1",
    server: "build123d",
    uri: "ui://build123d/results-viewer",
    fingerprint: VIEWER_FINGERPRINT,
  });
  assertEquals(parsed.server, "build123d");
  assertEquals(parsed.uri, "ui://build123d/results-viewer");
  assertEquals(parsed.fingerprint, VIEWER_FINGERPRINT);
});

Deno.test("viewer App fetch request refuses non-ui URIs", () => {
  assertThrows(
    () =>
      parseChatViewerAppFetchRequest({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: "request-app-2",
        server: "build123d",
        uri: "https://example.com/app.html",
        fingerprint: VIEWER_FINGERPRINT,
      }),
    TypeError,
    "viewer App URI is invalid",
  );
});

Deno.test("viewer App fetch response carries base64 bytes on success", () => {
  const parsed = parseChatViewerAppFetchResponse({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "request-app-1",
    ok: true,
    app: {
      uri: "ui://build123d/results-viewer",
      mimeType: "text/html;profile=mcp-app",
      bytes: 4,
      fingerprint: VIEWER_FINGERPRINT,
      encoding: "base64",
      data: "PGI+",
    },
  });
  assertEquals(parsed.ok, true);
  assertEquals(parsed.app?.bytes, 4);
  assertEquals(parsed.app?.data, "PGI+");
});

Deno.test("viewer resource-read accepts server-scoped artifact URIs", () => {
  const parsed = parseChatCommandRequest({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "request-read-1",
    command: "viewer.resource-read",
    conversationId: "conversation:1",
    toolCallId: "tool-call-1",
    uri: "casys://build123d/artifacts/abc123.glb",
  });
  if (parsed.command !== "viewer.resource-read") throw new Error("wrong branch");
  assertEquals(parsed.uri, "casys://build123d/artifacts/abc123.glb");
  assertThrows(
    () =>
      parseChatCommandRequest({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: "request-read-2",
        command: "viewer.resource-read",
        conversationId: "conversation:1",
        toolCallId: "tool-call-1",
        uri: "https://example.com/evil.glb",
      }),
    TypeError,
    "viewer resource URI is invalid",
  );
});

Deno.test("viewer App fetch response refuses malformed fingerprints", () => {
  assertThrows(
    () =>
      parseChatViewerAppFetchResponse({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: "request-app-3",
        ok: true,
        app: {
          uri: "ui://build123d/results-viewer",
          mimeType: "text/html;profile=mcp-app",
          bytes: 4,
          fingerprint: "not-a-fingerprint",
          encoding: "base64",
          data: "PGI+",
        },
      }),
    TypeError,
    "viewer fingerprint is invalid",
  );
});

function viewerAppBytes(overrides: Record<string, unknown> = {}) {
  return {
    uri: "ui://build123d/results-viewer",
    mimeType: "text/html;profile=mcp-app",
    bytes: 4,
    fingerprint: VIEWER_FINGERPRINT,
    encoding: "base64",
    data: "PGI+",
    ...overrides,
  };
}

function viewerAppResponse(app: Record<string, unknown>) {
  return {
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "request-app-bounds",
    ok: true,
    app,
  };
}

Deno.test("viewer App fetch response drops smuggled sidecar fields", () => {
  const parsed = parseChatViewerAppFetchResponse(
    viewerAppResponse(viewerAppBytes({ evil: "smuggled", bytes: 4 })),
  );
  assertEquals(parsed.ok, true);
  assertEquals("evil" in (parsed.app ?? {}), false);
  assertEquals(Object.keys(parsed.app ?? {}).sort(), [
    "bytes",
    "data",
    "encoding",
    "fingerprint",
    "mimeType",
    "uri",
  ]);
});

Deno.test("viewer App fetch response enforces byte-count and payload caps", () => {
  assertThrows(
    () =>
      parseChatViewerAppFetchResponse(
        viewerAppResponse(viewerAppBytes({ bytes: 8_388_609 })),
      ),
    TypeError,
    "viewer App bytes is invalid",
  );
  assertThrows(
    () =>
      parseChatViewerAppFetchResponse(
        viewerAppResponse(viewerAppBytes({ data: "QQ==".padEnd(12_000_001, "A") })),
      ),
    TypeError,
    "viewer App data is invalid",
  );
});

Deno.test("viewer JSON rejects deep, oversized, and overlarge payloads", () => {
  let deep: unknown = 0;
  for (let depth = 0; depth < 12; depth += 1) deep = [deep];
  assertThrows(() => parseChatViewerJson(deep), TypeError, "too deep");
  assertThrows(
    () => parseChatViewerJson("x".repeat(65_537)),
    TypeError,
    "oversized string",
  );
  const wide: Record<string, unknown> = {};
  for (let index = 0; index < 500; index += 1) {
    wide[`key-${index}`] = "y".repeat(2_500);
  }
  assertThrows(() => parseChatViewerJson(wide), TypeError, "too large");
});

Deno.test("viewer JSON rejects node floods past the bounded budget", () => {
  const flood: unknown[] = [];
  for (let index = 0; index < 21; index += 1) {
    flood.push(new Array<unknown>(1_000).fill(0));
  }
  assertThrows(() => parseChatViewerJson(flood), TypeError, "too many nodes");
});

Deno.test("viewer arguments require a bounded object record", () => {
  assertEquals(parseChatViewerArguments({ width: 12 }), { width: 12 });
  assertThrows(
    () => parseChatViewerArguments([["width", 12]]),
    TypeError,
    "viewer arguments must be an object",
  );
  assertThrows(
    () => parseChatViewerArguments("width=12"),
    TypeError,
    "viewer arguments must be an object",
  );
  assertThrows(
    () => parseChatViewerArguments({ blob: "z".repeat(65_537) }),
    TypeError,
    "oversized string",
  );
});

const ARCHIVE_SHA = "cd".repeat(32);

function archivedViewer(overrides: Record<string, unknown> = {}) {
  return {
    toolCallId: "tool-call-1",
    messageId: "message-1",
    tool: "build123d_export",
    appUri: "ui://mcp-build123d/results-viewer",
    archive: {
      revision: 2,
      resultDigest: `sha256:${ARCHIVE_SHA}`,
      server: "build123d",
      capturedAt: "2026-09-27T00:00:00.000Z",
      failed: false,
      artifacts: [
        {
          uri: `casys://build123d/artifacts/${ARCHIVE_SHA}.glb`,
          fileName: `${ARCHIVE_SHA}.glb`,
          mimeType: "model/gltf-binary",
          bytes: 3408,
          sha256: ARCHIVE_SHA,
          state: "saved",
        },
        {
          uri: "casys://build123d/artifacts/huge.step",
          fileName: "huge.step",
          mimeType: "model/step",
          bytes: 9_000_000,
          sha256: "ef".repeat(32),
          state: "missing",
          reason: "The export exceeds the 512 KiB retained-bytes cap.",
        },
      ],
      ...overrides,
    },
  };
}

Deno.test("snapshot carries retention and per-version saved-work archives", () => {
  const parsed = parseChatSnapshotDto({
    ...snapshotWith(conversation({ viewers: [archivedViewer()] })),
    retention: { days: 30, maxConversations: 50 },
  });
  assertEquals(parsed.retention, { days: 30, maxConversations: 50 });
  const versioned = parseChatSnapshotDto({
    ...snapshotWith(conversation({ viewers: [archivedViewer()] })),
    retention: { days: 30, maxConversations: 50, maxVersions: 20 },
  });
  assertEquals(versioned.retention, {
    days: 30,
    maxConversations: 50,
    maxVersions: 20,
  });
  const archive = parsed.conversations[0]?.viewers[0]?.archive;
  assertEquals(archive?.revision, 2);
  assertEquals(archive?.artifacts.length, 2);
  assertEquals(archive?.artifacts[1]?.state, "missing");
});

Deno.test("snapshot refuses malformed retention and archive shapes", () => {
  assertThrows(
    () =>
      parseChatSnapshotDto({
        ...snapshotWith(conversation()),
        retention: { days: 0, maxConversations: 50 },
      }),
    TypeError,
    "chat retention is invalid",
  );
  assertThrows(
    () =>
      parseChatSnapshotDto({
        ...snapshotWith(conversation()),
        retention: { days: 30, maxConversations: 50, maxVersions: 0 },
      }),
    TypeError,
    "chat retention is invalid",
  );
  assertThrows(
    () =>
      parseChatSnapshotDto(
        snapshotWith(
          conversation({ viewers: [archivedViewer({ revision: 0 })] }),
        ),
      ),
    TypeError,
    "viewer archive revision is invalid",
  );
  assertThrows(
    () =>
      parseChatSnapshotDto(
        snapshotWith(
          conversation({
            viewers: [{
              ...archivedViewer(),
              archive: {
                ...(archivedViewer().archive as Record<string, unknown>),
                artifacts: [{
                  uri: "casys://build123d/artifacts/x.glb",
                  fileName: "../escape.glb",
                  mimeType: "model/gltf-binary",
                  bytes: 8,
                  sha256: ARCHIVE_SHA,
                  state: "saved",
                }],
              },
            }],
          }),
        ),
      ),
    TypeError,
    "viewer artifact file name is invalid",
  );
});

Deno.test("viewer resource requires an explicit saved-or-live source", () => {
  const response = (source: unknown) => ({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "request-read-1",
    ok: true,
    viewerResource: {
      uri: "casys://build123d/artifacts/x.glb",
      mimeType: "model/gltf-binary",
      bytes: 4,
      encoding: "base64",
      data: "Z2xiAA==",
      source,
    },
  });
  assertEquals(
    parseChatCommandResponse(response("saved")).viewerResource?.source,
    "saved",
  );
  assertEquals(
    parseChatCommandResponse(response("live")).viewerResource?.source,
    "live",
  );
  assertThrows(
    () => parseChatCommandResponse(response("archived")),
    TypeError,
    "viewer resource source is invalid",
  );
  assertThrows(
    () => parseChatCommandResponse(response(undefined)),
    TypeError,
    "viewer resource source is invalid",
  );
});

Deno.test("save-file request pins names and bytes, response reports paths", () => {
  const parsed = parseChatSaveFileRequest({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "save-1",
    fileName: "box-v1.glb",
    data: "Z2xiAA==",
  });
  assertEquals(parsed.fileName, "box-v1.glb");
  assertThrows(
    () =>
      parseChatSaveFileRequest({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: "save-2",
        fileName: "../escape.glb",
        data: "Z2xiAA==",
      }),
    TypeError,
    "viewer artifact file name is invalid",
  );
  const ok = parseChatSaveFileResponse({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "save-1",
    ok: true,
    path: "/Users/test/Downloads/box-v1.glb",
    bytes: 4,
  });
  assertEquals(ok.ok, true);
  assertEquals(ok.path, "/Users/test/Downloads/box-v1.glb");
  const failed = parseChatSaveFileResponse({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "save-2",
    ok: false,
    error: "No free export file name was found in Downloads.",
  });
  assertEquals(failed.ok, false);
});

Deno.test("artifact extraction admits only versioned digest-bound records", () => {
  const valid = {
    schemaVersion: "build123d-export-artifact/1.0",
    uri: `casys://build123d/artifacts/${ARCHIVE_SHA}.glb`,
    mimeType: "model/gltf-binary",
    bytes: 3408,
    sha256: ARCHIVE_SHA,
  };
  assertEquals(
    extractViewerArtifactRecords({
      structuredContent: {
        files: [
          { artifact: valid },
          { artifact: { ...valid } },
          { artifact: { ...valid, schemaVersion: "other/1.0" } },
          { artifact: { ...valid, uri: "https://example.com/x.glb" } },
          {
            artifact: { ...valid, sha256: "ef".repeat(32), bytes: 40_000_000 },
          },
          { artifact: "no" },
          "no",
        ],
      },
    }),
    [{
      uri: valid.uri,
      mimeType: valid.mimeType,
      bytes: valid.bytes,
      sha256: valid.sha256,
    }],
  );
  assertEquals(extractViewerArtifactRecords({}), []);
  assertEquals(extractViewerArtifactRecords(null), []);
});

Deno.test("artifact extraction keeps one record per URI for shared bytes", () => {
  const first = `casys://build123d/artifacts/a.step`;
  const second = `casys://build123d/artifacts/b.step`;
  const records = extractViewerArtifactRecords({
    structuredContent: {
      files: [
        {
          artifact: {
            schemaVersion: "build123d-export-artifact/1.0",
            uri: first,
            mimeType: "model/step",
            bytes: 4,
            sha256: ARCHIVE_SHA,
          },
        },
        {
          artifact: {
            schemaVersion: "build123d-export-artifact/1.0",
            uri: second,
            mimeType: "model/step",
            bytes: 4,
            sha256: ARCHIVE_SHA,
          },
        },
        {
          artifact: {
            schemaVersion: "build123d-export-artifact/1.0",
            uri: first,
            mimeType: "model/step",
            bytes: 4,
            sha256: ARCHIVE_SHA,
          },
        },
      ],
    },
  });
  assertEquals(records.map((record) => record.uri), [first, second]);
});

Deno.test("save-file data must be decodable base64", () => {
  assertThrows(
    () =>
      parseChatSaveFileRequest({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: "save-length",
        fileName: "box-v1.glb",
        data: "abcde",
      }),
    TypeError,
    "save file data is invalid",
  );
});

Deno.test("host filter predicates mirror the renderer shapes", () => {
  assertEquals(isChatViewerToolName("build123d_export"), true);
  assertEquals(isChatViewerToolName("a-b_c.d9"), true);
  assertEquals(isChatViewerToolName(""), false);
  assertEquals(isChatViewerToolName("evil tool/x"), false);
  assertEquals(isChatViewerToolName("x".repeat(129)), false);
  assertEquals(isChatViewerToolName(42), false);
  assertEquals(isChatOpaqueId("conversation:1"), true);
  assertEquals(isChatOpaqueId("a.b_c-d:e"), true);
  assertEquals(isChatOpaqueId(""), false);
  assertEquals(isChatOpaqueId("has space"), false);
  assertEquals(isChatOpaqueId("x".repeat(161)), false);
  assertEquals(isChatViewerUiUri("ui://build123d/results-viewer"), true);
  assertEquals(isChatViewerUiUri("https://example.com/x"), false);
  assertEquals(isChatViewerUiUri("ui://with space"), false);
  assertEquals(isChatViewerUiUri(`ui://${"x".repeat(500)}`), false);
});

function canvasLayout(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 1,
    nodes: [
      {
        id: "node-1",
        kind: "viewer",
        x: 10,
        y: 20,
        z: 1,
        toolCallId: "tool-call-1",
      },
      {
        id: "node-2",
        kind: "note",
        x: 300,
        y: 20,
        width: 240,
        height: 120,
        z: 2,
        text: "Check wall thickness",
        groupId: "group-1",
      },
    ],
    groups: [{ id: "group-1", title: "Review" }],
    ...overrides,
  };
}

Deno.test("canvas layout parses viewer and note nodes strictly", () => {
  const parsed = parseChatCanvasLayout(canvasLayout());
  assertEquals(parsed.version, 1);
  assertEquals(parsed.nodes.length, 2);
  assertEquals(parsed.groups.length, 1);
  const get = parseChatCommandRequest({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "r-canvas-1",
    command: "canvas.get-layout",
    conversationId: "conv-1",
  });
  assertEquals(get.command, "canvas.get-layout");
  const set = parseChatCommandRequest({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "r-canvas-2",
    command: "canvas.set-layout",
    conversationId: "conv-1",
    layout: canvasLayout(),
  });
  assertEquals(set.command, "canvas.set-layout");
  const response = parseChatCommandResponse({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "r-canvas-1",
    ok: true,
    conversationId: "conv-1",
    layout: canvasLayout(),
  });
  assertEquals(response.layout?.nodes.length, 2);
});

Deno.test("canvas layout rejects version, identity, and kind surprises", () => {
  const cases: ReadonlyArray<readonly [Record<string, unknown>, string]> = [
    [canvasLayout({ version: 2 }), "canvas layout version is invalid"],
    [
      canvasLayout({
        nodes: [
          { id: "dup", kind: "note", x: 0, y: 0, z: 0, text: "a" },
          { id: "dup", kind: "note", x: 0, y: 0, z: 0, text: "b" },
        ],
      }),
      "canvas layout node ids must be unique",
    ],
    [
      canvasLayout({
        nodes: [{
          id: "n",
          kind: "note",
          x: 0,
          y: 0,
          z: 0,
          text: "a",
          groupId: "missing",
        }],
      }),
      "canvas node group is unknown",
    ],
    [
      canvasLayout({
        nodes: [{
          id: "n",
          kind: "viewer",
          x: 0,
          y: 0,
          z: 0,
          toolCallId: "t",
          text: "nope",
        }],
      }),
      "canvas viewer nodes carry no text",
    ],
    [
      canvasLayout({
        nodes: [{
          id: "n",
          kind: "note",
          x: 0,
          y: 0,
          z: 0,
          text: "a",
          toolCallId: "t",
        }],
      }),
      "canvas note nodes carry no tool result",
    ],
    [
      canvasLayout({
        nodes: [{ id: "n", kind: "note", x: 1e9, y: 0, z: 0, text: "a" }],
      }),
      "canvas node x is out of range",
    ],
    [
      canvasLayout({
        nodes: [{
          id: "n",
          kind: "viewer",
          x: 0,
          y: 0,
          z: 0,
          toolCallId: "t",
          done: true,
        }],
      }),
      "canvas viewer nodes carry no text",
    ],
    [
      canvasLayout({
        nodes: [{ id: "n", kind: "note", x: 0, y: 0, z: 0, text: "a", done: "yes" }],
      }),
      "canvas note done is invalid",
    ],
  ];
  for (const [layout, message] of cases) {
    assertThrows(() => parseChatCanvasLayout(layout), TypeError, message);
  }
});
