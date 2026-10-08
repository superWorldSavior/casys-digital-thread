import { assertEquals, assertNotEquals, assertStrictEquals } from "@std/assert";
import {
  expandProjectMcpWindow,
  loadProjectMcpWindows,
  moveProjectMcpWindow,
  openProjectMcpWindow,
  parseProjectMcpWindows,
  type ProjectChatViewerReference,
  type ProjectMcpWindow,
  type ProjectMcpWindowStorage,
  projectMcpWindowStorageKey,
  projectViewerKey,
  reconcileProjectMcpWindows,
  removeProjectMcpWindow,
  resizeProjectMcpWindow,
  restoreProjectMcpWindow,
  saveProjectMcpWindows,
  serializeProjectMcpWindows,
} from "./src/thread/chat-project-whiteboard-model.ts";

function reference(
  owner: string,
  viewerId = "result-1",
  projectId = "project-a",
): ProjectChatViewerReference {
  return {
    workspaceProjectId: projectId,
    owningConversationId: owner,
    viewer: {
      viewerId,
      toolCallId: "tool-1",
      messageId: "message-1",
      tool: "erpnext_company_list",
      appUri: "ui://mcp-erpnext/doclist-viewer",
    },
  };
}

class MemoryStorage implements ProjectMcpWindowStorage {
  readonly entries = new Map<string, string>();
  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }
}

Deno.test("project windows preserve two owners of the same retained viewer id", () => {
  const first = reference("chat-a");
  const second = reference("chat-b");
  const windows = openProjectMcpWindow(
    "project-a",
    openProjectMcpWindow("project-a", [], first),
    second,
  );
  assertEquals(windows.length, 2);
  assertNotEquals(windows[0]!.id, windows[1]!.id);
  const resolved = reconcileProjectMcpWindows("project-a", windows, [
    second,
    first,
  ]);
  assertEquals(resolved.map((entry) => entry.reference?.owningConversationId), [
    "chat-a",
    "chat-b",
  ]);
  assertNotEquals(projectViewerKey("a:b", "c"), projectViewerKey("a", "b:c"));
  assertNotEquals(
    projectViewerKey('a","b', "c"),
    projectViewerKey("a", 'b","c'),
  );
});

Deno.test("opening an existing exact result focuses it without duplicating or moving it", () => {
  const source = reference("chat-a");
  const windows = openProjectMcpWindow("project-a", [], source, {
    x: -80,
    y: 160,
    width: 700,
    height: 500,
  });
  const focused = openProjectMcpWindow("project-a", windows, source, {
    x: 0,
    y: 0,
    width: 320,
    height: 220,
  });
  assertEquals(focused.length, 1);
  assertEquals({ ...focused[0], z: windows[0]!.z }, windows[0]);
  assertEquals(focused[0]!.z, windows[0]!.z + 1);
  assertStrictEquals(
    openProjectMcpWindow(
      "project-a",
      windows,
      reference("other", "result", "project-b"),
    ),
    windows,
  );
});

Deno.test("missing, cross-project and ambiguous results remain unavailable without rebind or removal", () => {
  const windows = openProjectMcpWindow("project-a", [], reference("chat-a"));
  for (
    const sources of [
      [],
      [reference("chat-b")],
      [reference("chat-a", "result-1", "project-b")],
      [reference("chat-a"), reference("chat-a")],
    ]
  ) {
    const resolved = reconcileProjectMcpWindows("project-a", windows, sources);
    assertEquals(resolved.length, 1);
    assertEquals(resolved[0]!.status, "unavailable");
    assertEquals(resolved[0]!.reference, undefined);
    assertStrictEquals(resolved[0]!.window, windows[0]);
  }
  const available = reconcileProjectMcpWindows("project-a", windows, [
    reference("chat-a"),
  ]);
  assertEquals(available[0]!.status, "available");
});

Deno.test("local project persistence cannot overwrite Thread presentation or cross project boundaries", () => {
  const storage = new MemoryStorage();
  const nativeKey = "casys.project-whiteboard.presentation:v4:project-a";
  storage.setItem(nativeKey, "native positions and groups");
  const windows = openProjectMcpWindow("project-a", [], reference("chat-a"));
  assertEquals(saveProjectMcpWindows(storage, "project-a", windows), true);
  assertEquals(loadProjectMcpWindows(storage, "project-a"), windows);
  assertEquals(storage.getItem(nativeKey), "native positions and groups");
  assertEquals(loadProjectMcpWindows(storage, "project-b"), undefined);
  assertEquals(
    parseProjectMcpWindows(
      serializeProjectMcpWindows("project-a", windows)!,
      "project-b",
    ),
    undefined,
  );
  assertNotEquals(
    projectMcpWindowStorageKey("project/a"),
    projectMcpWindowStorageKey("project%2Fa"),
  );
  assertEquals(projectMcpWindowStorageKey(""), undefined);
  assertEquals(projectMcpWindowStorageKey("unsafe\nproject"), undefined);
});

Deno.test("strict window persistence rejects malformed identities, geometry and provider data", () => {
  const windows = openProjectMcpWindow("project-a", [], reference("chat-a"));
  const valid = serializeProjectMcpWindows("project-a", windows)!;
  const envelope = JSON.parse(valid);
  for (
    const patch of [
      { id: "another owner" },
      { x: "24" },
      { x: 10_000_001 },
      { width: 0 },
      { height: -1 },
      { z: 0.5 },
      { expanded: true },
      {
        expanded: true,
        restoreGeometry: {
          x: 0,
          y: 0,
          width: 620,
          height: 460,
          serverTools: ["never a persisted capability"],
        },
      },
      { restoreGeometry: { x: 0, y: 0, width: 620, height: 460 } },
      { toolResult: { secret: "never persisted" } },
      { serverTools: ["not a persisted capability"] },
      { appUri: "ui://forged" },
    ]
  ) {
    assertEquals(
      parseProjectMcpWindows(
        JSON.stringify({
          ...envelope,
          windows: [{ ...envelope.windows[0], ...patch }],
        }),
        "project-a",
      ),
      undefined,
    );
  }
  assertEquals(
    parseProjectMcpWindows(
      JSON.stringify({ ...envelope, version: 2 }),
      "project-a",
    ),
    undefined,
  );
  assertEquals(
    parseProjectMcpWindows(
      JSON.stringify({
        ...envelope,
        windows: [envelope.windows[0], envelope.windows[0]],
      }),
      "project-a",
    ),
    undefined,
  );
  assertEquals(
    serializeProjectMcpWindows("project-a", [{
      ...windows[0]!,
      x: Number.NaN,
    }]),
    undefined,
  );
});

Deno.test("spatial edits stay local, preserve the other owner and restore exact pre-expansion geometry", () => {
  const windows = openProjectMcpWindow(
    "project-a",
    openProjectMcpWindow("project-a", [], reference("chat-a")),
    reference("chat-b"),
  );
  const firstId = windows[0]!.id;
  const moved = moveProjectMcpWindow(windows, firstId, -500, 230);
  const resized = resizeProjectMcpWindow(moved, firstId, 900, 650);
  assertEquals([
    resized[0]!.x,
    resized[0]!.y,
    resized[0]!.width,
    resized[0]!.height,
  ], [-500, 230, 900, 650]);
  assertStrictEquals(resized[1], windows[1]);
  const expanded = expandProjectMcpWindow(resized, firstId, {
    x: -900,
    y: -200,
    width: 1600,
    height: 1000,
  });
  const reexpanded = expandProjectMcpWindow(expanded, firstId, {
    x: 0,
    y: 0,
    width: 1200,
    height: 800,
  });
  const persisted = serializeProjectMcpWindows("project-a", reexpanded)!;
  const restored = restoreProjectMcpWindow(
    parseProjectMcpWindows(persisted, "project-a")!,
    firstId,
  );
  assertEquals({ ...restored[0], z: resized[0]!.z }, resized[0]);
  assertEquals(restored[0]!.expanded, undefined);
  assertEquals(restored[0]!.restoreGeometry, undefined);
  assertEquals(windows[0]!.x, 24);
  const minimum = resizeProjectMcpWindow(windows, firstId, 10, 10);
  assertEquals([minimum[0]!.width, minimum[0]!.height], [320, 220]);
  assertStrictEquals(moveProjectMcpWindow(windows, "missing", 1, 1), windows);
  assertStrictEquals(removeProjectMcpWindow(windows, "missing"), windows);
  assertEquals(
    removeProjectMcpWindow(windows, firstId).map((window) =>
      window.owningConversationId
    ),
    ["chat-b"],
  );
});

Deno.test("unavailable results survive save and reload until explicitly removed", () => {
  const storage = new MemoryStorage();
  const windows = openProjectMcpWindow(
    "project-a",
    [],
    reference("retired-chat"),
  );
  assertEquals(saveProjectMcpWindows(storage, "project-a", windows), true);
  const loaded = loadProjectMcpWindows(storage, "project-a")!;
  assertEquals(
    reconcileProjectMcpWindows("project-a", loaded, [])[0]!.status,
    "unavailable",
  );
  assertEquals(removeProjectMcpWindow(loaded, loaded[0]!.id), []);
});

Deno.test("storage failure is reported without simulating a saved layout", () => {
  const storage: ProjectMcpWindowStorage = {
    getItem() {
      throw new Error("unavailable");
    },
    setItem() {
      throw new Error("full");
    },
  };
  const windows: readonly ProjectMcpWindow[] = openProjectMcpWindow(
    "project-a",
    [],
    reference("chat-a"),
  );
  assertEquals(loadProjectMcpWindows(storage, "project-a"), undefined);
  assertEquals(saveProjectMcpWindows(storage, "project-a", windows), false);
});
