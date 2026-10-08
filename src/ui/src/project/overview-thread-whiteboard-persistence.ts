import type {
  OverviewThreadD3FlowGroupPlacement,
  OverviewThreadD3FlowHullSort,
  OverviewThreadD3FlowHullView,
  OverviewThreadD3FlowNodePlacement,
} from "./overview-thread-d3-flow-layout.ts";
import type { OverviewThreadViewerGeometry } from "./overview-thread-viewer-geometry.ts";
import {
  OVERVIEW_THREAD_WHITEBOARD_MAX_SCALE,
  OVERVIEW_THREAD_WHITEBOARD_MIN_SCALE,
  type OverviewThreadWhiteboardTransform,
} from "./overview-thread-whiteboard-transform.ts";

/**
 * Local, non-authoritative presentation state only.
 *
 * This schema must never be used as Thread evidence, as a viewer-capability
 * source, or as an input to a provider operation. The current Thread snapshot
 * remains the sole authority for nodes, groups and viewers; persisted entries
 * are admitted only after exact reconciliation with that snapshot.
 */

export const OVERVIEW_THREAD_WHITEBOARD_PRESENTATION_VERSION = 4;

const STORAGE_NAMESPACE = "casys.project-whiteboard.presentation";
const PRESENTATION_SCHEMA = "casys-project-whiteboard-presentation";
const LEGACY_PRESENTATION_VERSIONS = [3, 2, 1] as const;
const MAX_PROJECT_ID_LENGTH = 512;
const MAX_ID_LENGTH = 4_096;
const MAX_PLACEMENT_COUNT = 10_000;
const MAX_VIEWER_COUNT = 1_000;
const MAX_ABSOLUTE_COORDINATE = 10_000_000;
const MAX_Z_INDEX = 1_000_000;

export type OverviewThreadWhiteboardPresentationLayoutMode =
  | "hierarchy"
  | "radial";

export interface OverviewThreadWhiteboardPresentationState {
  readonly layoutMode: OverviewThreadWhiteboardPresentationLayoutMode;
  readonly groupPlacements: Readonly<
    Record<string, OverviewThreadD3FlowGroupPlacement>
  >;
  readonly nodePlacements: Readonly<
    Record<string, OverviewThreadD3FlowNodePlacement>
  >;
  readonly transform: OverviewThreadWhiteboardTransform;
  readonly viewers: readonly OverviewThreadWhiteboardPresentationViewer[];
  /** Presentation intent only: do not auto-open the same record again. */
  readonly autoShownNodeKeys?: readonly string[];
}

interface OverviewThreadWhiteboardPresentationViewerBase {
  /** Stable identity; it must match the exact kind/node/asset tuple. */
  readonly id: string;
  /** Exact current graph node identity to which the viewer is tethered. */
  readonly nodeKey: string;
  readonly geometry: OverviewThreadViewerGeometry;
  readonly z: number;
  readonly expanded: boolean;
  /** Required while expanded so the integrated viewer can be restored. */
  readonly restoreGeometry?: OverviewThreadViewerGeometry;
  /** Visible hull row used as the connector anchor; never Thread evidence. */
  readonly presentationRowKey?: string;
}

/**
 * One exact server-projected viewer descriptor. Local state retains only its
 * stable session id and spatial presentation — never its URL or runtime data.
 */
export interface OverviewThreadWhiteboardSessionPresentationViewer
  extends OverviewThreadWhiteboardPresentationViewerBase {
  readonly kind: "session";
  readonly sessionId: string;
}

export type OverviewThreadWhiteboardPresentationViewer =
  OverviewThreadWhiteboardSessionPresentationViewer;

export interface OverviewThreadWhiteboardViewerCapability {
  /** Exact session keys from the current viewer-sessions replacement. */
  readonly sessionIds?: readonly string[] | ReadonlySet<string>;
}

export interface OverviewThreadWhiteboardPresentationReconciliation {
  /** Exact identities emitted by the current D3 flow layout. */
  readonly groupKeys: Iterable<string>;
  /** Exact identities emitted by the current overview-node projection. */
  readonly nodeKeys: Iterable<string>;
  /** Capabilities derived from current authoritative Thread facts only. */
  readonly viewerCapabilities: Readonly<
    Record<string, OverviewThreadWhiteboardViewerCapability>
  >;
}

/** Minimal browser Storage surface, kept injectable for SSR and tests. */
export interface OverviewThreadWhiteboardPresentationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface OverviewThreadWhiteboardPresentationEnvelope {
  readonly schema: typeof PRESENTATION_SCHEMA;
  readonly version: typeof OVERVIEW_THREAD_WHITEBOARD_PRESENTATION_VERSION;
  readonly projectId: string;
  readonly state: OverviewThreadWhiteboardPresentationState;
}

/** Returns no key for an unsafe project identity, disabling local persistence. */
export function overviewThreadWhiteboardPresentationStorageKey(
  projectId: string,
): string | undefined {
  return presentationStorageKey(
    projectId,
    OVERVIEW_THREAD_WHITEBOARD_PRESENTATION_VERSION,
  );
}

function presentationStorageKey(
  projectId: string,
  version: number,
): string | undefined {
  if (!isSafeId(projectId, MAX_PROJECT_ID_LENGTH)) return undefined;
  try {
    return `${STORAGE_NAMESPACE}:v${version}:${encodeURIComponent(projectId)}`;
  } catch {
    return undefined;
  }
}

/**
 * Strictly serialises a presentation snapshot. Invalid runtime values fail
 * closed instead of being normalised into a plausible-looking layout.
 */
export function serializeOverviewThreadWhiteboardPresentation(
  projectId: string,
  state: OverviewThreadWhiteboardPresentationState,
): string | undefined {
  if (!overviewThreadWhiteboardPresentationStorageKey(projectId)) {
    return undefined;
  }
  let parsedState: OverviewThreadWhiteboardPresentationState | undefined;
  try {
    parsedState = parsePresentationState(state);
  } catch {
    return undefined;
  }
  if (!parsedState) return undefined;

  const envelope: OverviewThreadWhiteboardPresentationEnvelope = {
    schema: PRESENTATION_SCHEMA,
    version: OVERVIEW_THREAD_WHITEBOARD_PRESENTATION_VERSION,
    projectId,
    state: parsedState,
  };
  try {
    return JSON.stringify(envelope);
  } catch {
    return undefined;
  }
}

/** Rejects malformed, cross-project and differently versioned entries. */
export function parseOverviewThreadWhiteboardPresentation(
  serialized: string,
  projectId: string,
): OverviewThreadWhiteboardPresentationState | undefined {
  if (!overviewThreadWhiteboardPresentationStorageKey(projectId)) {
    return undefined;
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(serialized);
  } catch {
    return undefined;
  }
  if (
    !isExactRecord(candidate, ["schema", "version", "projectId", "state"]) ||
    candidate.schema !== PRESENTATION_SCHEMA ||
    candidate.version !== OVERVIEW_THREAD_WHITEBOARD_PRESENTATION_VERSION ||
    candidate.projectId !== projectId
  ) {
    return undefined;
  }
  return parsePresentationState(candidate.state);
}

/**
 * Drops stale placements and viewers unless their exact current identity and
 * viewer capability still exist. It never infers a relationship from labels,
 * proximity, a previous session, or the persisted viewer kind.
 */
export function reconcileOverviewThreadWhiteboardPresentation(
  state: OverviewThreadWhiteboardPresentationState,
  current: OverviewThreadWhiteboardPresentationReconciliation,
): OverviewThreadWhiteboardPresentationState {
  const groupKeys = new Set(current.groupKeys);
  const nodeKeys = new Set(current.nodeKeys);
  const groupPlacements = nullRecord<OverviewThreadD3FlowGroupPlacement>();
  const nodePlacements = nullRecord<OverviewThreadD3FlowNodePlacement>();

  for (const [key, placement] of Object.entries(state.groupPlacements)) {
    if (groupKeys.has(key)) groupPlacements[key] = placement;
  }
  for (const [key, placement] of Object.entries(state.nodePlacements)) {
    if (nodeKeys.has(key)) nodePlacements[key] = placement;
  }

  const viewers = state.viewers.filter((viewer) => {
    if (!nodeKeys.has(viewer.nodeKey)) return false;
    const capability = ownValue(current.viewerCapabilities, viewer.nodeKey);
    if (!capability) return false;
    return hasExactSessionId(capability.sessionIds, viewer.sessionId);
  });

  return {
    layoutMode: state.layoutMode,
    groupPlacements,
    nodePlacements,
    transform: state.transform,
    viewers,
    ...(state.autoShownNodeKeys
      ? {
        autoShownNodeKeys: state.autoShownNodeKeys.filter((key) =>
          nodeKeys.has(key)
        ),
      }
      : {}),
  };
}

/** Reads, validates and reconciles one project-scoped local snapshot. */
export function loadOverviewThreadWhiteboardPresentation(
  storage: OverviewThreadWhiteboardPresentationStorage,
  projectId: string,
  current: OverviewThreadWhiteboardPresentationReconciliation,
): OverviewThreadWhiteboardPresentationState | undefined {
  const key = overviewThreadWhiteboardPresentationStorageKey(projectId);
  if (!key) return undefined;
  let serialized: string | null;
  try {
    serialized = storage.getItem(key);
  } catch {
    return undefined;
  }
  if (serialized !== null) {
    const parsed = parseOverviewThreadWhiteboardPresentation(
      serialized,
      projectId,
    );
    return parsed
      ? reconcileOverviewThreadWhiteboardPresentation(parsed, current)
      : undefined;
  }

  for (const version of LEGACY_PRESENTATION_VERSIONS) {
    const legacyKey = presentationStorageKey(projectId, version);
    if (!legacyKey) continue;
    let legacySerialized: string | null;
    try {
      legacySerialized = storage.getItem(legacyKey);
    } catch {
      return undefined;
    }
    if (legacySerialized === null) continue;
    const migrated = parseLegacyOverviewThreadWhiteboardPresentation(
      legacySerialized,
      projectId,
      version,
    );
    if (!migrated) return undefined;
    const reconciled = reconcileOverviewThreadWhiteboardPresentation(
      migrated,
      current,
    );
    const currentSerialized = serializeOverviewThreadWhiteboardPresentation(
      projectId,
      reconciled,
    );
    if (currentSerialized) {
      try {
        storage.setItem(key, currentSerialized);
      } catch {
        // A read remains useful when local storage is temporarily read-only.
      }
    }
    return reconciled;
  }
  return undefined;
}

/**
 * Reconciles then writes local presentation state. `false` covers invalid
 * state, unavailable storage and quota/security failures; no backend is used.
 */
export function saveOverviewThreadWhiteboardPresentation(
  storage: OverviewThreadWhiteboardPresentationStorage,
  projectId: string,
  state: OverviewThreadWhiteboardPresentationState,
  current: OverviewThreadWhiteboardPresentationReconciliation,
): boolean {
  const key = overviewThreadWhiteboardPresentationStorageKey(projectId);
  if (!key) return false;
  const serialized = serializeOverviewThreadWhiteboardPresentation(
    projectId,
    reconcileOverviewThreadWhiteboardPresentation(state, current),
  );
  if (!serialized) return false;
  try {
    storage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}

/** A pre-graph viewport can read geometry without retiring recorded placements. */
export function loadOverviewThreadWhiteboardTransform(
  storage: OverviewThreadWhiteboardPresentationStorage,
  projectId: string,
): OverviewThreadWhiteboardTransform | undefined {
  const key = overviewThreadWhiteboardPresentationStorageKey(projectId);
  if (!key) return undefined;
  try {
    const serialized = storage.getItem(key);
    if (serialized !== null) {
      return parseOverviewThreadWhiteboardPresentation(serialized, projectId)
        ?.transform;
    }
    for (const version of LEGACY_PRESENTATION_VERSIONS) {
      const legacyKey = presentationStorageKey(projectId, version);
      if (!legacyKey) continue;
      const legacy = storage.getItem(legacyKey);
      if (legacy !== null) {
        return parseLegacyOverviewThreadWhiteboardPresentation(
          legacy,
          projectId,
          version,
        )?.transform;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Update only the viewport; unknown or legacy state must not become an empty v4. */
export function saveOverviewThreadWhiteboardTransform(
  storage: OverviewThreadWhiteboardPresentationStorage,
  projectId: string,
  transform: OverviewThreadWhiteboardTransform,
): boolean {
  const key = overviewThreadWhiteboardPresentationStorageKey(projectId);
  if (!key) return false;
  try {
    const previous = storage.getItem(key);
    const state = previous === null
      ? undefined
      : parseOverviewThreadWhiteboardPresentation(previous, projectId);
    if (previous !== null && !state) return false;
    if (!state) {
      for (const version of LEGACY_PRESENTATION_VERSIONS) {
        const legacyKey = presentationStorageKey(projectId, version);
        if (legacyKey && storage.getItem(legacyKey) !== null) return false;
      }
    }
    const serialized = serializeOverviewThreadWhiteboardPresentation(
      projectId,
      {
        ...(state ?? {
          layoutMode: "hierarchy",
          groupPlacements: {},
          nodePlacements: {},
          viewers: [],
        }),
        transform,
      },
    );
    if (!serialized) return false;
    storage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}

function parsePresentationState(
  candidate: unknown,
): OverviewThreadWhiteboardPresentationState | undefined {
  const hasAutoShown = isRecord(candidate) &&
    Object.hasOwn(candidate, "autoShownNodeKeys");
  if (
    !isExactRecord(candidate, [
      "layoutMode",
      "groupPlacements",
      "nodePlacements",
      "transform",
      "viewers",
      ...(hasAutoShown ? ["autoShownNodeKeys"] : []),
    ]) ||
    (candidate.layoutMode !== "hierarchy" && candidate.layoutMode !== "radial")
  ) {
    return undefined;
  }
  const groupPlacements = parseGroupPlacements(candidate.groupPlacements);
  const nodePlacements = parseNodePlacements(candidate.nodePlacements);
  const transform = parseTransform(candidate.transform);
  const viewers = parseViewers(candidate.viewers);
  const autoShownNodeKeys = hasAutoShown
    ? candidate.autoShownNodeKeys
    : undefined;
  if (
    hasAutoShown && (!Array.isArray(autoShownNodeKeys) ||
      autoShownNodeKeys.length > MAX_PLACEMENT_COUNT ||
      autoShownNodeKeys.some((key) => !isSafeId(key)) ||
      new Set(autoShownNodeKeys).size !== autoShownNodeKeys.length)
  ) return undefined;
  if (!groupPlacements || !nodePlacements || !transform || !viewers) {
    return undefined;
  }
  return {
    layoutMode: candidate.layoutMode,
    groupPlacements,
    nodePlacements,
    transform,
    viewers,
    ...(hasAutoShown
      ? { autoShownNodeKeys: [...autoShownNodeKeys as string[]] }
      : {}),
  };
}

/**
 * Migrates only presentation geometry from retired schemas. Native viewer
 * entries are intentionally discarded; exact MCP App sessions from v2 may be
 * retained and are still reconciled against the current Thread snapshot.
 */
function parseLegacyOverviewThreadWhiteboardPresentation(
  serialized: string,
  projectId: string,
  version: (typeof LEGACY_PRESENTATION_VERSIONS)[number],
): OverviewThreadWhiteboardPresentationState | undefined {
  let candidate: unknown;
  try {
    candidate = JSON.parse(serialized);
  } catch {
    return undefined;
  }
  if (
    !isExactRecord(candidate, ["schema", "version", "projectId", "state"]) ||
    candidate.schema !== PRESENTATION_SCHEMA ||
    candidate.version !== version ||
    candidate.projectId !== projectId ||
    !isRecord(candidate.state) ||
    !isExactRecord(candidate.state, [
      "layoutMode",
      "groupPlacements",
      "nodePlacements",
      "transform",
      "viewers",
    ]) ||
    (candidate.state.layoutMode !== "hierarchy" &&
      candidate.state.layoutMode !== "radial") ||
    !Array.isArray(candidate.state.viewers) ||
    candidate.state.viewers.length > MAX_VIEWER_COUNT
  ) {
    return undefined;
  }

  const groupPlacements = parseGroupPlacements(candidate.state.groupPlacements);
  const nodePlacements = parseNodePlacements(candidate.state.nodePlacements);
  const transform = parseTransform(candidate.state.transform);
  if (!groupPlacements || !nodePlacements || !transform) return undefined;

  const viewers: OverviewThreadWhiteboardPresentationViewer[] = [];
  const seenIds = new Set<string>();
  for (const value of candidate.state.viewers) {
    if (!isRecord(value) || typeof value.kind !== "string") return undefined;
    if (value.kind === "session") {
      if (version !== 2 && version !== 3) return undefined;
      const viewer = parseViewer(value);
      if (!viewer || seenIds.has(viewer.id)) return undefined;
      seenIds.add(viewer.id);
      viewers.push(viewer);
      continue;
    }
    const retiredKinds = version === 1
      ? ["record", "activity", "cad"]
      : ["record", "activity"];
    if (!retiredKinds.includes(value.kind)) return undefined;
  }

  return {
    layoutMode: candidate.state.layoutMode,
    groupPlacements,
    nodePlacements,
    transform,
    viewers,
  };
}

function parseGroupPlacements(
  candidate: unknown,
): Readonly<Record<string, OverviewThreadD3FlowGroupPlacement>> | undefined {
  if (!isRecord(candidate)) return undefined;
  const entries = Object.entries(candidate);
  if (entries.length > MAX_PLACEMENT_COUNT) return undefined;
  const result = nullRecord<OverviewThreadD3FlowGroupPlacement>();
  for (const [key, value] of entries) {
    const placement = isSafeId(key) ? parseGroupPlacement(value) : undefined;
    if (!placement) return undefined;
    result[key] = placement;
  }
  return result;
}

/**
 * Reading state a hull remembers, alongside its box. These are presentation
 * choices: an unknown value rejects the whole entry rather than degrading to a
 * default, so a restored board is exactly what was saved or nothing.
 */
const HULL_VIEWS: readonly string[] = ["tree", "list", "matrix"];
const HULL_SORTS: readonly string[] = ["recorded", "recent", "name"];

/**
 * One hull's remembered box.
 *
 * A hull carries more than a position: an operator-chosen size and whether it
 * is folded. All of it is presentation, and all of it is validated here — an
 * unknown or malformed field rejects the whole entry rather than being dropped
 * silently, so a restored board is either exactly what was saved or nothing.
 */
function parseGroupPlacement(
  candidate: unknown,
): OverviewThreadD3FlowGroupPlacement | undefined {
  if (!isRecord(candidate)) return undefined;
  const coordinateKeys = ["x", "y", "offsetX", "offsetY"] as const;
  const dimensionKeys = ["width", "height"] as const;
  const ownKeys = Object.keys(candidate);
  if (ownKeys.length === 0) return undefined;
  for (const key of ownKeys) {
    const value = candidate[key];
    if ((coordinateKeys as readonly string[]).includes(key)) {
      if (!isCoordinate(value)) return undefined;
      continue;
    }
    if ((dimensionKeys as readonly string[]).includes(key)) {
      if (!isPositiveDimension(value)) return undefined;
      continue;
    }
    if (key === "collapsed") {
      if (typeof value !== "boolean") return undefined;
      continue;
    }
    if (key === "view") {
      if (!HULL_VIEWS.includes(value as string)) return undefined;
      continue;
    }
    if (key === "sort") {
      if (!HULL_SORTS.includes(value as string)) return undefined;
      continue;
    }
    if (key === "scrollRow") {
      if (
        typeof value !== "number" || !Number.isInteger(value) || value < 0
      ) {
        return undefined;
      }
      continue;
    }
    return undefined;
  }
  const placement = nullRecord<number | boolean>();
  for (const key of [...coordinateKeys, ...dimensionKeys]) {
    const value = candidate[key];
    if (Object.hasOwn(candidate, key) && typeof value === "number") {
      placement[key] = value;
    }
  }
  if (typeof candidate.collapsed === "boolean") {
    placement.collapsed = candidate.collapsed;
  }
  const view = candidate.view;
  const sort = candidate.sort;
  const scrollRow = candidate.scrollRow;
  return {
    ...(placement as OverviewThreadD3FlowGroupPlacement),
    ...(typeof view === "string" && HULL_VIEWS.includes(view)
      ? { view: view as OverviewThreadD3FlowHullView }
      : {}),
    ...(typeof sort === "string" && HULL_SORTS.includes(sort)
      ? { sort: sort as OverviewThreadD3FlowHullSort }
      : {}),
    ...(typeof scrollRow === "number" ? { scrollRow } : {}),
  };
}

function parseNodePlacements(
  candidate: unknown,
): Readonly<Record<string, OverviewThreadD3FlowNodePlacement>> | undefined {
  if (!isRecord(candidate)) return undefined;
  const entries = Object.entries(candidate);
  if (entries.length > MAX_PLACEMENT_COUNT) return undefined;
  const result = nullRecord<OverviewThreadD3FlowNodePlacement>();
  for (const [key, value] of entries) {
    if (!isSafeId(key) || !isPlacement(value, ["offsetX", "offsetY"])) {
      return undefined;
    }
    result[key] = copyDefinedCoordinates(value, ["offsetX", "offsetY"]);
  }
  return result;
}

function parseTransform(
  candidate: unknown,
): OverviewThreadWhiteboardTransform | undefined {
  if (
    !isExactRecord(candidate, ["x", "y", "k"]) ||
    !isCoordinate(candidate.x) ||
    !isCoordinate(candidate.y) ||
    !isFiniteNumber(candidate.k) ||
    candidate.k < OVERVIEW_THREAD_WHITEBOARD_MIN_SCALE ||
    candidate.k > OVERVIEW_THREAD_WHITEBOARD_MAX_SCALE
  ) {
    return undefined;
  }
  return { x: candidate.x, y: candidate.y, k: candidate.k };
}

function parseViewers(
  candidate: unknown,
): readonly OverviewThreadWhiteboardPresentationViewer[] | undefined {
  if (!Array.isArray(candidate) || candidate.length > MAX_VIEWER_COUNT) {
    return undefined;
  }
  const viewers: OverviewThreadWhiteboardPresentationViewer[] = [];
  const seenIds = new Set<string>();
  for (const value of candidate) {
    const viewer = parseViewer(value);
    if (!viewer || seenIds.has(viewer.id)) return undefined;
    seenIds.add(viewer.id);
    viewers.push(viewer);
  }
  return viewers;
}

function parseViewer(
  candidate: unknown,
): OverviewThreadWhiteboardPresentationViewer | undefined {
  if (!isRecord(candidate)) return undefined;
  const hasRestoreGeometry = Object.hasOwn(candidate, "restoreGeometry");
  const hasPresentationRowKey = Object.hasOwn(
    candidate,
    "presentationRowKey",
  );
  const keys = [
    "kind",
    "id",
    "nodeKey",
    "sessionId",
    "geometry",
    "z",
    "expanded",
    ...(hasRestoreGeometry ? ["restoreGeometry"] : []),
    ...(hasPresentationRowKey ? ["presentationRowKey"] : []),
  ];
  if (
    candidate.kind !== "session" ||
    !isExactRecord(candidate, keys) ||
    !isSafeId(candidate.id) ||
    !isSafeId(candidate.nodeKey) ||
    typeof candidate.expanded !== "boolean" ||
    (candidate.expanded && !hasRestoreGeometry) ||
    (!candidate.expanded && hasRestoreGeometry &&
      candidate.restoreGeometry !== undefined) ||
    !Number.isSafeInteger(candidate.z) ||
    (candidate.z as number) < 0 ||
    (candidate.z as number) > MAX_Z_INDEX
  ) {
    return undefined;
  }
  const geometry = parseViewerGeometry(candidate.geometry);
  const restoreGeometry = candidate.expanded
    ? parseViewerGeometry(candidate.restoreGeometry)
    : undefined;
  if (!geometry || (candidate.expanded && !restoreGeometry)) return undefined;

  if (!isSafeId(candidate.sessionId)) return undefined;
  const presentationRowKey = typeof candidate.presentationRowKey === "string" &&
      isSafeId(candidate.presentationRowKey)
    ? candidate.presentationRowKey
    : undefined;
  if (hasPresentationRowKey && !presentationRowKey) return undefined;
  const viewer: OverviewThreadWhiteboardSessionPresentationViewer = {
    kind: "session",
    id: candidate.id,
    nodeKey: candidate.nodeKey,
    sessionId: candidate.sessionId,
    geometry,
    z: candidate.z as number,
    expanded: candidate.expanded,
    ...(restoreGeometry ? { restoreGeometry } : {}),
    ...(presentationRowKey ? { presentationRowKey } : {}),
  };
  return viewer.id === expectedViewerId(viewer) ? viewer : undefined;
}

function parseViewerGeometry(
  candidate: unknown,
): OverviewThreadViewerGeometry | undefined {
  if (
    !isExactRecord(candidate, ["x", "y", "width", "height"]) ||
    !isCoordinate(candidate.x) ||
    !isCoordinate(candidate.y) ||
    !isPositiveDimension(candidate.width) ||
    !isPositiveDimension(candidate.height)
  ) {
    return undefined;
  }
  return {
    x: candidate.x,
    y: candidate.y,
    width: candidate.width,
    height: candidate.height,
  };
}

function expectedViewerId(
  viewer: OverviewThreadWhiteboardPresentationViewer,
): string {
  return `session:${viewer.nodeKey}:${viewer.sessionId}`;
}

function isPlacement(
  candidate: unknown,
  keys: readonly string[],
): candidate is Record<string, number> {
  if (!isRecord(candidate)) return false;
  const ownKeys = Object.keys(candidate);
  return ownKeys.length > 0 && ownKeys.every((key) => keys.includes(key)) &&
    ownKeys.every((key) => isCoordinate(candidate[key]));
}

function copyDefinedCoordinates<T>(
  source: Record<string, number>,
  keys: readonly string[],
): T {
  const result = nullRecord<number>();
  for (const key of keys) {
    const value = source[key];
    if (Object.hasOwn(source, key) && value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
}

function hasExactSessionId(
  sessionIds: readonly string[] | ReadonlySet<string> | undefined,
  sessionId: string,
): boolean {
  return sessionIds instanceof Set
    ? sessionIds.has(sessionId)
    : Array.isArray(sessionIds) && sessionIds.includes(sessionId);
}

function ownValue<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const ownKeys = Object.keys(value);
  return ownKeys.length === keys.length &&
    ownKeys.every((key) => keys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeId(value: unknown, maxLength = MAX_ID_LENGTH): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= maxLength && value.trim() === value &&
    !hasControlCharacter(value);
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function isCoordinate(value: unknown): value is number {
  return isFiniteNumber(value) && Math.abs(value) <= MAX_ABSOLUTE_COORDINATE;
}

function isPositiveDimension(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0 &&
    value <= MAX_ABSOLUTE_COORDINATE;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nullRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}
