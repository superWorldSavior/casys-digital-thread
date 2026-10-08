import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { nextHullViewPlacement } from "./src/project/overview-thread-d3-flow-layout.ts";
import {
  loadOverviewThreadWhiteboardPresentation,
  loadOverviewThreadWhiteboardTransform,
  OVERVIEW_THREAD_WHITEBOARD_PRESENTATION_VERSION,
  type OverviewThreadWhiteboardPresentationReconciliation,
  type OverviewThreadWhiteboardPresentationState,
  type OverviewThreadWhiteboardPresentationStorage,
  overviewThreadWhiteboardPresentationStorageKey,
  parseOverviewThreadWhiteboardPresentation,
  reconcileOverviewThreadWhiteboardPresentation,
  saveOverviewThreadWhiteboardPresentation,
  saveOverviewThreadWhiteboardTransform,
  serializeOverviewThreadWhiteboardPresentation,
} from "./src/project/overview-thread-whiteboard-persistence.ts";

const PROJECT_ID = "project/demo alpha";
const REQUIREMENTS_GROUP = "group:requirements:system-model";
const BUILD_GROUP = "group:build:hull";
const REQUIREMENT_NODE = "artifact:req-1";
const ACTIVITY_NODE = "project-activity:run-1";
const HULL_NODE = "artifact:hull-1";
const STALE_NODE = "artifact:retired";
const HULL_SESSION = `mcp-app:${"a".repeat(64)}`;

const CURRENT: OverviewThreadWhiteboardPresentationReconciliation = {
  groupKeys: [REQUIREMENTS_GROUP, BUILD_GROUP],
  nodeKeys: [REQUIREMENT_NODE, ACTIVITY_NODE, HULL_NODE],
  viewerCapabilities: {
    [REQUIREMENT_NODE]: { sessionIds: [] },
    [ACTIVITY_NODE]: { sessionIds: [] },
    [HULL_NODE]: { sessionIds: [HULL_SESSION] },
  },
};

Deno.test("pre-graph viewport writes preserve all native project placements and viewers", () => {
  const storage = new MemoryStorage();
  const key = overviewThreadWhiteboardPresentationStorageKey(PROJECT_ID)!;
  const original = serializeOverviewThreadWhiteboardPresentation(PROJECT_ID, {
    ...completeState(),
    autoShownNodeKeys: [HULL_NODE, STALE_NODE],
  })!;
  storage.setItem(key, original);
  const transform = { x: -120, y: 88, k: 0.75 };
  assertEquals(
    saveOverviewThreadWhiteboardTransform(storage, PROJECT_ID, transform),
    true,
  );
  const expected = JSON.parse(original);
  expected.state.transform = transform;
  assertEquals(JSON.parse(storage.getItem(key)!), expected);
  assertEquals(
    loadOverviewThreadWhiteboardTransform(storage, PROJECT_ID),
    transform,
  );
});

Deno.test("pre-graph viewport cannot overwrite malformed or cross-project presentation", () => {
  const storage = new MemoryStorage();
  const key = overviewThreadWhiteboardPresentationStorageKey(PROJECT_ID)!;
  const wrongProject = serializeOverviewThreadWhiteboardPresentation(
    "another-project",
    completeState(),
  )!;
  storage.setItem(key, wrongProject);
  assertEquals(
    loadOverviewThreadWhiteboardTransform(storage, PROJECT_ID),
    undefined,
  );
  assertEquals(
    saveOverviewThreadWhiteboardTransform(storage, PROJECT_ID, {
      x: 0,
      y: 0,
      k: 1,
    }),
    false,
  );
  assertEquals(storage.getItem(key), wrongProject);
  storage.setItem(key, "not-json");
  assertEquals(
    saveOverviewThreadWhiteboardTransform(storage, PROJECT_ID, {
      x: 0,
      y: 0,
      k: 1,
    }),
    false,
  );
  assertEquals(storage.getItem(key), "not-json");
});

Deno.test("pre-graph viewport leaves legacy native state for the existing full migration", () => {
  const storage = new MemoryStorage();
  const legacyKey = "casys.project-whiteboard.presentation:v3:project%2Fdemo%20alpha";
  const original = JSON.stringify({
    schema: "casys-project-whiteboard-presentation",
    version: 3,
    projectId: PROJECT_ID,
    state: completeState(),
  });
  storage.setItem(legacyKey, original);
  assertEquals(
    loadOverviewThreadWhiteboardTransform(storage, PROJECT_ID),
    completeState().transform,
  );
  assertEquals(
    saveOverviewThreadWhiteboardTransform(storage, PROJECT_ID, {
      x: 0,
      y: 0,
      k: 1,
    }),
    false,
  );
  assertEquals(
    storage.getItem(
      overviewThreadWhiteboardPresentationStorageKey(PROJECT_ID)!,
    ),
    null,
  );
  assertEquals(storage.getItem(legacyKey), original);
});

Deno.test("v4 remembers dismissed defaults without granting or retaining revoked sessions", () => {
  const state = {
    ...completeState(),
    autoShownNodeKeys: [HULL_NODE, STALE_NODE],
  };
  const encoded = serializeOverviewThreadWhiteboardPresentation(
    PROJECT_ID,
    state,
  )!;
  assertEquals(
    parseOverviewThreadWhiteboardPresentation(encoded, PROJECT_ID)
      ?.autoShownNodeKeys,
    [HULL_NODE, STALE_NODE],
  );
  const reconciled = reconcileOverviewThreadWhiteboardPresentation(state, {
    ...CURRENT,
    viewerCapabilities: {},
  });
  assertEquals(reconciled.viewers, []);
  assertEquals(reconciled.autoShownNodeKeys, [HULL_NODE]);
  assertEquals(
    serializeOverviewThreadWhiteboardPresentation(PROJECT_ID, {
      ...state,
      autoShownNodeKeys: [HULL_NODE, HULL_NODE],
    }),
    undefined,
  );
});

Deno.test("v3 migration preserves current sessions and the explicit tree layout", () => {
  const storage = new MemoryStorage();
  const state = {
    ...completeState(),
    groupPlacements: { [BUILD_GROUP]: { view: "tree" as const, width: 480 } },
  };
  storage.setItem(
    "casys.project-whiteboard.presentation:v3:project%2Fdemo%20alpha",
    JSON.stringify({
      schema: "casys-project-whiteboard-presentation",
      version: 3,
      projectId: PROJECT_ID,
      state,
    }),
  );
  assertEquals(
    loadOverviewThreadWhiteboardPresentation(storage, PROJECT_ID, CURRENT),
    state,
  );
});

function completeState(): OverviewThreadWhiteboardPresentationState {
  return {
    layoutMode: "hierarchy",
    groupPlacements: {
      [REQUIREMENTS_GROUP]: { x: 42, y: 68, offsetX: 4 },
      [BUILD_GROUP]: { x: 580, y: 236 },
    },
    nodePlacements: {
      [REQUIREMENT_NODE]: { offsetX: 12, offsetY: -6 },
      [HULL_NODE]: { offsetX: -8, offsetY: 14 },
    },
    transform: { x: -184.25, y: 42, k: 0.8 },
    viewers: [
      {
        kind: "session",
        id: `session:${HULL_NODE}:${HULL_SESSION}`,
        nodeKey: HULL_NODE,
        sessionId: HULL_SESSION,
        geometry: { x: 8, y: 8, width: 980, height: 540 },
        z: 4,
        expanded: true,
        restoreGeometry: { x: 620, y: 120, width: 360, height: 300 },
      },
    ],
  };
}

Deno.test("whiteboard persistence keys are versioned, encoded and project scoped", () => {
  const key = overviewThreadWhiteboardPresentationStorageKey(PROJECT_ID);
  assertEquals(
    key,
    "casys.project-whiteboard.presentation:v4:project%2Fdemo%20alpha",
  );
  assertEquals(
    overviewThreadWhiteboardPresentationStorageKey("project/demo beta") === key,
    false,
  );
  assertEquals(overviewThreadWhiteboardPresentationStorageKey(""), undefined);
  assertEquals(
    overviewThreadWhiteboardPresentationStorageKey(" project/demo"),
    undefined,
  );
  assertEquals(
    overviewThreadWhiteboardPresentationStorageKey("project\nother"),
    undefined,
  );
  assertEquals(
    overviewThreadWhiteboardPresentationStorageKey("project/\ud800"),
    undefined,
  );
});

Deno.test("whiteboard presentation round-trips every spatial field without granting authority", () => {
  const state = completeState();
  const serialized = serializeOverviewThreadWhiteboardPresentation(
    PROJECT_ID,
    state,
  );
  assert(serialized);
  assertStringIncludes(
    serialized,
    '"schema":"casys-project-whiteboard-presentation"',
  );
  assertStringIncludes(serialized, '"version":4');
  assertStringIncludes(serialized, `"sessionId":"${HULL_SESSION}"`);
  assertEquals(serialized.includes('"uri"'), false);
  assertEquals(serialized.includes('"token"'), false);
  assertEquals(
    parseOverviewThreadWhiteboardPresentation(serialized, PROJECT_ID),
    state,
  );

  const envelope = JSON.parse(serialized);
  assertEquals(envelope.projectId, PROJECT_ID);
  assertEquals(envelope.state.viewers[0].expanded, true);
  assertEquals(envelope.state.viewers[0].restoreGeometry, {
    x: 620,
    y: 120,
    width: 360,
    height: 300,
  });

  const explicitUndefined = completeState();
  const firstViewer = explicitUndefined.viewers[0];
  assert(firstViewer);
  const withRuntimeOptional: OverviewThreadWhiteboardPresentationState = {
    ...explicitUndefined,
    viewers: [
      { ...firstViewer, expanded: false, restoreGeometry: undefined },
      ...explicitUndefined.viewers.slice(1),
    ],
  };
  assert(
    serializeOverviewThreadWhiteboardPresentation(
      PROJECT_ID,
      withRuntimeOptional,
    ),
  );
});

Deno.test("persistence admits an optional group-scoped presentation row without changing canonical viewer identity", () => {
  const presentationRowKey = `hull-row:${
    JSON.stringify(["group:12:system-model|18:domain:sysml-model", "root"])
  }`;
  const state = completeState();
  const first = state.viewers[0]!;
  const withAnchor: OverviewThreadWhiteboardPresentationState = {
    ...state,
    viewers: [{ ...first, presentationRowKey }],
  };
  const serialized = serializeOverviewThreadWhiteboardPresentation(
    PROJECT_ID,
    withAnchor,
  );
  assert(serialized);
  const parsed = parseOverviewThreadWhiteboardPresentation(
    serialized,
    PROJECT_ID,
  );
  assertEquals(parsed?.viewers[0]?.presentationRowKey, presentationRowKey);
  assertEquals(parsed?.viewers[0]?.nodeKey, HULL_NODE);
  assertEquals(parsed?.viewers[0]?.sessionId, HULL_SESSION);
  const reconciled = reconcileOverviewThreadWhiteboardPresentation(
    parsed!,
    CURRENT,
  );
  assertEquals(reconciled.viewers[0]?.presentationRowKey, presentationRowKey);
  assertEquals(reconciled.viewers[0]?.nodeKey, HULL_NODE);
});

Deno.test("off-graph viewers and camera positions survive a project reload", () => {
  const state = completeState();
  const offGraph: OverviewThreadWhiteboardPresentationState = {
    ...state,
    transform: { x: 4_800, y: -3_200, k: 0.4 },
    viewers: state.viewers.map((viewer, index) => ({
      ...viewer,
      geometry: {
        ...viewer.geometry,
        x: index === 0 ? -2_400 : 3_600 + index * 500,
        y: index === 1 ? -1_800 : 2_100 + index * 300,
      },
      ...(viewer.restoreGeometry
        ? {
          restoreGeometry: {
            ...viewer.restoreGeometry,
            x: -3_200,
            y: 4_400,
          },
        }
        : {}),
    })),
  };
  const serialized = serializeOverviewThreadWhiteboardPresentation(
    PROJECT_ID,
    offGraph,
  );
  assert(serialized);
  assertEquals(
    parseOverviewThreadWhiteboardPresentation(serialized, PROJECT_ID),
    offGraph,
  );
});

Deno.test("parser fails closed on malformed, cross-project, stale-schema and invented viewer entries", () => {
  const serialized = serializeOverviewThreadWhiteboardPresentation(
    PROJECT_ID,
    completeState(),
  )!;
  assertEquals(
    parseOverviewThreadWhiteboardPresentation("not json", PROJECT_ID),
    undefined,
  );
  assertEquals(
    parseOverviewThreadWhiteboardPresentation(serialized, "project/other"),
    undefined,
  );

  const badVersion = JSON.parse(serialized);
  badVersion.version = 1;
  assertEquals(parseEnvelope(badVersion), undefined);

  const unknownStateField = JSON.parse(serialized);
  unknownStateField.state.authoritative = true;
  assertEquals(parseEnvelope(unknownStateField), undefined);

  const badTransform = JSON.parse(serialized);
  badTransform.state.transform.k = 99;
  assertEquals(parseEnvelope(badTransform), undefined);

  const inventedViewerId = JSON.parse(serialized);
  inventedViewerId.state.viewers[0].id = "session:another-node:invented";
  assertEquals(parseEnvelope(inventedViewerId), undefined);

  const unknownViewerKind = JSON.parse(serialized);
  unknownViewerKind.state.viewers[0].kind = "simulation";
  assertEquals(parseEnvelope(unknownViewerKind), undefined);

  const retiredNativeViewerKind = JSON.parse(serialized);
  retiredNativeViewerKind.state.viewers[0].kind = "record";
  assertEquals(parseEnvelope(retiredNativeViewerKind), undefined);

  const expandedWithoutRestore = JSON.parse(serialized);
  delete expandedWithoutRestore.state.viewers[0].restoreGeometry;
  assertEquals(parseEnvelope(expandedWithoutRestore), undefined);

  const duplicateViewer = JSON.parse(serialized);
  duplicateViewer.state.viewers.push(duplicateViewer.state.viewers[0]);
  assertEquals(parseEnvelope(duplicateViewer), undefined);

  const emptyPlacement = JSON.parse(serialized);
  emptyPlacement.state.nodePlacements[HULL_NODE] = {};
  assertEquals(parseEnvelope(emptyPlacement), undefined);
});

Deno.test("reconciliation retains only current exact groups, nodes and viewer capabilities", () => {
  const state = completeState();
  const withStaleEntries: OverviewThreadWhiteboardPresentationState = {
    ...state,
    groupPlacements: {
      ...state.groupPlacements,
      "group:retired": { x: 900, y: 900 },
    },
    nodePlacements: {
      ...state.nodePlacements,
      [STALE_NODE]: { offsetX: 99, offsetY: 99 },
    },
    viewers: [
      ...state.viewers,
      {
        kind: "session",
        id: `session:${STALE_NODE}:mcp-app:${"d".repeat(64)}`,
        nodeKey: STALE_NODE,
        sessionId: `mcp-app:${"d".repeat(64)}`,
        geometry: { x: 10, y: 10, width: 300, height: 220 },
        z: 5,
        expanded: false,
      },
      {
        kind: "session",
        id: `session:${HULL_NODE}:mcp-app:${"b".repeat(64)}`,
        nodeKey: HULL_NODE,
        sessionId: `mcp-app:${"b".repeat(64)}`,
        geometry: { x: 20, y: 20, width: 300, height: 220 },
        z: 6,
        expanded: false,
      },
    ],
  };

  const reconciled = reconcileOverviewThreadWhiteboardPresentation(
    withStaleEntries,
    CURRENT,
  );

  assertEquals(Object.keys(reconciled.groupPlacements), [
    REQUIREMENTS_GROUP,
    BUILD_GROUP,
  ]);
  assertEquals(Object.keys(reconciled.nodePlacements), [
    REQUIREMENT_NODE,
    HULL_NODE,
  ]);
  assertEquals(
    reconciled.viewers.map((viewer) => viewer.id),
    state.viewers.map((viewer) => viewer.id),
  );
  assertEquals(reconciled.transform, state.transform);
  assertEquals(reconciled.layoutMode, state.layoutMode);
});

Deno.test("session presentation is rejected without its exact current session key", () => {
  const serialized = serializeOverviewThreadWhiteboardPresentation(
    PROJECT_ID,
    completeState(),
  )!;
  const session = JSON.parse(serialized);
  session.state.viewers[0].sessionId = `mcp-app:${"c".repeat(64)}`;
  assertEquals(parseEnvelope(session), undefined);
});

Deno.test("local load and save reconcile before storage and contain storage failures", () => {
  const storage = new MemoryStorage();
  const state = completeState();
  assertEquals(
    saveOverviewThreadWhiteboardPresentation(
      storage,
      PROJECT_ID,
      state,
      CURRENT,
    ),
    true,
  );
  const expectedKey = overviewThreadWhiteboardPresentationStorageKey(
    PROJECT_ID,
  )!;
  assertEquals(storage.writes, [expectedKey]);
  assertEquals(
    loadOverviewThreadWhiteboardPresentation(storage, PROJECT_ID, CURRENT),
    state,
  );
  assertEquals(
    loadOverviewThreadWhiteboardPresentation(storage, "project/other", CURRENT),
    undefined,
  );

  const blockedStorage: OverviewThreadWhiteboardPresentationStorage = {
    getItem() {
      throw new DOMException("blocked", "SecurityError");
    },
    setItem() {
      throw new DOMException("full", "QuotaExceededError");
    },
  };
  assertEquals(
    loadOverviewThreadWhiteboardPresentation(
      blockedStorage,
      PROJECT_ID,
      CURRENT,
    ),
    undefined,
  );
  assertEquals(
    saveOverviewThreadWhiteboardPresentation(
      blockedStorage,
      PROJECT_ID,
      state,
      CURRENT,
    ),
    false,
  );
});

Deno.test("view-switched hulls persist without a schema bump or sizesByView", () => {
  assertEquals(OVERVIEW_THREAD_WHITEBOARD_PRESENTATION_VERSION, 4);
  const switched = nextHullViewPlacement({
    x: 12,
    y: 14,
    width: 400,
    height: 800,
    scrollRow: 2,
    view: "tree",
    sort: "recorded",
    collapsed: false,
  }, "list");
  const encoded = serializeOverviewThreadWhiteboardPresentation(
    PROJECT_ID,
    {
      ...completeState(),
      groupPlacements: { [BUILD_GROUP]: switched },
    },
  )!;
  assertEquals(encoded.includes("sizesByView"), false);
  const parsed = parseOverviewThreadWhiteboardPresentation(encoded, PROJECT_ID);
  assertEquals(parsed?.groupPlacements[BUILD_GROUP], switched);
  assertEquals("width" in (parsed?.groupPlacements[BUILD_GROUP] ?? {}), false);
  assertEquals("height" in (parsed?.groupPlacements[BUILD_GROUP] ?? {}), false);
  assertEquals(
    "scrollRow" in (parsed?.groupPlacements[BUILD_GROUP] ?? {}),
    false,
  );
});

Deno.test("legacy hull geometry migrates to v4 while retired native viewers are discarded", () => {
  const storage = new MemoryStorage();
  const legacyKey = "casys.project-whiteboard.presentation:v1:project%2Fdemo%20alpha";
  const legacyState = {
    layoutMode: "radial",
    groupPlacements: {
      [BUILD_GROUP]: {
        x: -10_000,
        y: 10_000,
        width: 720,
        height: 480,
        collapsed: true,
        view: "matrix" as const,
        sort: "name" as const,
        scrollRow: 7,
      },
    },
    nodePlacements: {
      [HULL_NODE]: { offsetX: -18, offsetY: 24 },
    },
    transform: { x: 320, y: -180, k: 1.2 },
    viewers: [{
      kind: "cad",
      id: `cad:${HULL_NODE}:retired-asset`,
      nodeKey: HULL_NODE,
      assetId: "retired-asset",
      geometry: { x: 10, y: 20, width: 400, height: 300 },
      z: 3,
      expanded: false,
    }],
  };
  storage.setItem(
    legacyKey,
    JSON.stringify({
      schema: "casys-project-whiteboard-presentation",
      version: 1,
      projectId: PROJECT_ID,
      state: legacyState,
    }),
  );

  const migrated = loadOverviewThreadWhiteboardPresentation(
    storage,
    PROJECT_ID,
    CURRENT,
  );
  assert(migrated);
  assertEquals(migrated.layoutMode, legacyState.layoutMode);
  assertEquals(migrated.groupPlacements, legacyState.groupPlacements);
  assertEquals(migrated.nodePlacements, legacyState.nodePlacements);
  assertEquals(migrated.transform, legacyState.transform);
  assertEquals(migrated.viewers, []);

  const currentKey = overviewThreadWhiteboardPresentationStorageKey(
    PROJECT_ID,
  )!;
  const migratedEnvelope = storage.getItem(currentKey);
  assert(migratedEnvelope);
  assertEquals(
    parseOverviewThreadWhiteboardPresentation(migratedEnvelope, PROJECT_ID),
    migrated,
  );
});

Deno.test("v2 migration keeps only exact current MCP App sessions", () => {
  const storage = new MemoryStorage();
  const state = completeState();
  const legacyKey = "casys.project-whiteboard.presentation:v2:project%2Fdemo%20alpha";
  storage.setItem(
    legacyKey,
    JSON.stringify({
      schema: "casys-project-whiteboard-presentation",
      version: 2,
      projectId: PROJECT_ID,
      state: {
        ...state,
        viewers: [
          {
            kind: "record",
            id: `record:${REQUIREMENT_NODE}`,
            nodeKey: REQUIREMENT_NODE,
            geometry: { x: 20, y: 20, width: 320, height: 220 },
            z: 2,
            expanded: false,
          },
          ...state.viewers,
        ],
      },
    }),
  );

  assertEquals(
    loadOverviewThreadWhiteboardPresentation(storage, PROJECT_ID, CURRENT),
    state,
  );
});

Deno.test("save removes stale local entries before the next reload", () => {
  const storage = new MemoryStorage();
  const state = completeState();
  const staleState: OverviewThreadWhiteboardPresentationState = {
    ...state,
    groupPlacements: {
      ...state.groupPlacements,
      "group:old": { x: 10, y: 20 },
    },
    viewers: [
      ...state.viewers,
      {
        kind: "session",
        id: `session:${STALE_NODE}:mcp-app:${"e".repeat(64)}`,
        nodeKey: STALE_NODE,
        sessionId: `mcp-app:${"e".repeat(64)}`,
        geometry: { x: 10, y: 10, width: 300, height: 220 },
        z: 9,
        expanded: false,
      },
    ],
  };
  assert(
    saveOverviewThreadWhiteboardPresentation(
      storage,
      PROJECT_ID,
      staleState,
      CURRENT,
    ),
  );
  const stored = JSON.parse(
    storage.getItem(
      overviewThreadWhiteboardPresentationStorageKey(PROJECT_ID)!,
    )!,
  );
  assertEquals(stored.state.groupPlacements["group:old"], undefined);
  assertEquals(
    stored.state.viewers.some((viewer: { id: string }) =>
      viewer.id === `session:${STALE_NODE}:mcp-app:${"e".repeat(64)}`
    ),
    false,
  );
});

function parseEnvelope(value: unknown) {
  return parseOverviewThreadWhiteboardPresentation(
    JSON.stringify(value),
    PROJECT_ID,
  );
}

class MemoryStorage implements OverviewThreadWhiteboardPresentationStorage {
  readonly #values = new Map<string, string>();
  readonly writes: string[] = [];

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writes.push(key);
    this.#values.set(key, value);
  }
}
