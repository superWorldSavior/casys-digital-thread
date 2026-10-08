import type { ChatToolViewerDto } from "../../../presentation/desktop/chat/contracts.ts";
import {
  normalizeOverviewThreadViewerGeometry,
  type OverviewThreadViewerGeometry,
} from "../project/overview-thread-viewer-geometry.ts";

export interface ProjectChatViewerReference {
  readonly workspaceProjectId: string;
  readonly owningConversationId: string;
  readonly viewer: ChatToolViewerDto;
}

/** Spatial presentation only; the current project projection supplies authority. */
export interface ProjectMcpWindow extends OverviewThreadViewerGeometry {
  readonly id: string;
  readonly owningConversationId: string;
  readonly viewerId: string;
  readonly z: number;
  readonly expanded?: boolean;
  readonly restoreGeometry?: OverviewThreadViewerGeometry;
}

export interface ResolvedProjectMcpWindow {
  readonly window: ProjectMcpWindow;
  readonly status: "available" | "unavailable";
  readonly reference?: ProjectChatViewerReference;
}

export interface ProjectMcpWindowStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const SCHEMA = "casys-project-whiteboard-chat-windows";
const NAMESPACE = "casys.project-whiteboard.chat-windows:v1";
const MAX_WINDOWS = 1_000;
const MAX_COORDINATE = 10_000_000;
const MAX_Z = 1_000_000;
const GEOMETRY_CONSTRAINTS = { minWidth: 320, minHeight: 220 };
const WINDOW_KEYS = [
  "id",
  "owningConversationId",
  "viewerId",
  "x",
  "y",
  "width",
  "height",
  "z",
  "expanded",
  "restoreGeometry",
] as const;

export function projectViewerKey(
  owningConversationId: string,
  viewerId: string,
): string {
  return `chat:${JSON.stringify([owningConversationId, viewerId])}`;
}

export function projectMcpWindowStorageKey(
  projectId: string,
): string | undefined {
  if (!safeId(projectId, 512)) return undefined;
  try {
    return `${NAMESPACE}:${encodeURIComponent(projectId)}`;
  } catch {
    return undefined;
  }
}

export function parseProjectMcpWindows(
  serialized: string,
  projectId: string,
): readonly ProjectMcpWindow[] | undefined {
  if (!projectMcpWindowStorageKey(projectId)) return undefined;
  try {
    const envelope: unknown = JSON.parse(serialized);
    if (
      !exactRecord(envelope, ["schema", "version", "projectId", "windows"]) ||
      envelope.schema !== SCHEMA || envelope.version !== 1 ||
      envelope.projectId !== projectId
    ) return undefined;
    return parseWindows(envelope.windows);
  } catch {
    return undefined;
  }
}

export function serializeProjectMcpWindows(
  projectId: string,
  windows: readonly ProjectMcpWindow[],
): string | undefined {
  if (!projectMcpWindowStorageKey(projectId)) return undefined;
  const parsed = parseWindows(windows);
  return parsed === undefined ? undefined : JSON.stringify({
    schema: SCHEMA,
    version: 1,
    projectId,
    windows: parsed,
  });
}

export function loadProjectMcpWindows(
  storage: ProjectMcpWindowStorage,
  projectId: string,
): readonly ProjectMcpWindow[] | undefined {
  const key = projectMcpWindowStorageKey(projectId);
  if (!key) return undefined;
  try {
    const serialized = storage.getItem(key);
    return serialized === null
      ? undefined
      : parseProjectMcpWindows(serialized, projectId);
  } catch {
    return undefined;
  }
}

export function saveProjectMcpWindows(
  storage: ProjectMcpWindowStorage,
  projectId: string,
  windows: readonly ProjectMcpWindow[],
): boolean {
  const key = projectMcpWindowStorageKey(projectId);
  const serialized = serializeProjectMcpWindows(projectId, windows);
  if (!key || serialized === undefined) return false;
  try {
    storage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}

export function reconcileProjectMcpWindows(
  projectId: string,
  windows: readonly ProjectMcpWindow[],
  references: readonly ProjectChatViewerReference[],
): readonly ResolvedProjectMcpWindow[] {
  const byIdentity = new Map<string, ProjectChatViewerReference[]>();
  for (const reference of references) {
    if (reference.workspaceProjectId !== projectId) continue;
    const key = projectViewerKey(
      reference.owningConversationId,
      reference.viewer.viewerId,
    );
    byIdentity.set(key, [...(byIdentity.get(key) ?? []), reference]);
  }
  return windows.map((window) => {
    const matches = byIdentity.get(projectViewerKey(
      window.owningConversationId,
      window.viewerId,
    ));
    return matches?.length === 1
      ? { window, status: "available", reference: matches[0] }
      : { window, status: "unavailable" };
  });
}

export function openProjectMcpWindow(
  projectId: string,
  windows: readonly ProjectMcpWindow[],
  reference: ProjectChatViewerReference,
  geometry?: OverviewThreadViewerGeometry,
): readonly ProjectMcpWindow[] {
  if (
    !safeId(projectId, 512) || reference.workspaceProjectId !== projectId ||
    !safeId(reference.owningConversationId) ||
    !safeId(reference.viewer.viewerId)
  ) return windows;
  const id = projectViewerKey(
    reference.owningConversationId,
    reference.viewer.viewerId,
  );
  if (windows.some((window) => window.id === id)) {
    return focusProjectMcpWindow(windows, id);
  }
  if (windows.length >= MAX_WINDOWS) return windows;
  const offset = (windows.length % 8) * 48;
  return [...windows, {
    id,
    owningConversationId: reference.owningConversationId,
    viewerId: reference.viewer.viewerId,
    ...normalizeOverviewThreadViewerGeometry(
      geometry ?? { x: 24 + offset, y: 24 + offset, width: 620, height: 460 },
      GEOMETRY_CONSTRAINTS,
    ),
    z: nextZ(windows),
  }];
}

export function focusProjectMcpWindow(
  windows: readonly ProjectMcpWindow[],
  id: string,
): readonly ProjectMcpWindow[] {
  return editWindow(
    windows,
    id,
    (window) => ({ ...window, z: nextZ(windows) }),
  );
}

export function moveProjectMcpWindow(
  windows: readonly ProjectMcpWindow[],
  id: string,
  x: number,
  y: number,
): readonly ProjectMcpWindow[] {
  return editWindow(windows, id, (window) => ({
    ...window,
    ...normalizeOverviewThreadViewerGeometry(
      { ...window, x, y },
      GEOMETRY_CONSTRAINTS,
    ),
  }));
}

export function resizeProjectMcpWindow(
  windows: readonly ProjectMcpWindow[],
  id: string,
  width: number,
  height: number,
): readonly ProjectMcpWindow[] {
  return editWindow(windows, id, (window) => ({
    ...window,
    ...normalizeOverviewThreadViewerGeometry(
      { ...window, width, height },
      GEOMETRY_CONSTRAINTS,
    ),
  }));
}

export function expandProjectMcpWindow(
  windows: readonly ProjectMcpWindow[],
  id: string,
  geometry: OverviewThreadViewerGeometry,
): readonly ProjectMcpWindow[] {
  return editWindow(windows, id, (window) => ({
    ...window,
    ...normalizeOverviewThreadViewerGeometry(geometry, GEOMETRY_CONSTRAINTS),
    expanded: true,
    restoreGeometry: window.restoreGeometry ?? windowGeometry(window),
    z: nextZ(windows),
  }));
}

export function restoreProjectMcpWindow(
  windows: readonly ProjectMcpWindow[],
  id: string,
): readonly ProjectMcpWindow[] {
  return editWindow(windows, id, (window) => {
    if (!window.expanded || !window.restoreGeometry) return window;
    const { expanded: _expanded, restoreGeometry, ...rest } = window;
    return { ...rest, ...restoreGeometry };
  });
}

export function removeProjectMcpWindow(
  windows: readonly ProjectMcpWindow[],
  id: string,
): readonly ProjectMcpWindow[] {
  return windows.some((window) => window.id === id)
    ? windows.filter((window) => window.id !== id)
    : windows;
}

function editWindow(
  windows: readonly ProjectMcpWindow[],
  id: string,
  edit: (window: ProjectMcpWindow) => ProjectMcpWindow,
): readonly ProjectMcpWindow[] {
  return windows.some((window) => window.id === id)
    ? windows.map((window) => window.id === id ? edit(window) : window)
    : windows;
}

function nextZ(windows: readonly ProjectMcpWindow[]): number {
  return Math.min(
    MAX_Z,
    windows.reduce((top, window) => Math.max(top, window.z), 0) + 1,
  );
}

function windowGeometry(
  window: OverviewThreadViewerGeometry,
): OverviewThreadViewerGeometry {
  return {
    x: window.x,
    y: window.y,
    width: window.width,
    height: window.height,
  };
}

function parseWindows(value: unknown): readonly ProjectMcpWindow[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_WINDOWS) return undefined;
  const parsed: ProjectMcpWindow[] = [];
  const ids = new Set<string>();
  for (const raw of value) {
    if (
      !exactRecord(raw, WINDOW_KEYS) || !safeId(raw.owningConversationId) ||
      !safeId(raw.viewerId) ||
      raw.id !== projectViewerKey(raw.owningConversationId, raw.viewerId) ||
      ids.has(raw.id as string) || !validGeometry(raw) ||
      !Number.isInteger(raw.z) || typeof raw.z !== "number" ||
      raw.z < 0 || raw.z > MAX_Z ||
      (raw.expanded !== undefined && typeof raw.expanded !== "boolean") ||
      (raw.expanded === true
        ? (!exactRecord(raw.restoreGeometry, ["x", "y", "width", "height"]) ||
          !validGeometry(raw.restoreGeometry))
        : raw.restoreGeometry !== undefined)
    ) return undefined;
    ids.add(raw.id as string);
    parsed.push({
      id: raw.id as string,
      owningConversationId: raw.owningConversationId,
      viewerId: raw.viewerId,
      x: raw.x as number,
      y: raw.y as number,
      width: raw.width as number,
      height: raw.height as number,
      z: raw.z,
      ...(raw.expanded === undefined ? {} : { expanded: raw.expanded }),
      ...(raw.expanded === true
        ? {
          restoreGeometry: windowGeometry(
            raw.restoreGeometry as unknown as OverviewThreadViewerGeometry,
          ),
        }
        : {}),
    });
  }
  return parsed;
}

function validGeometry(value: unknown): boolean {
  if (!record(value)) return false;
  if (!finiteCoordinate(value.x) || !finiteCoordinate(value.y)) return false;
  return finiteCoordinate(value.width) && value.width > 0 &&
    finiteCoordinate(value.height) && value.height > 0;
}

function finiteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) &&
    Math.abs(value) <= MAX_COORDINATE;
}

function safeId(value: unknown, limit = 4_096): value is string {
  if (
    typeof value !== "string" || value.trim().length === 0 ||
    value.length > limit
  ) return false;
  return ![...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return record(value) && Object.keys(value).every((key) => keys.includes(key));
}
