import type {
  ChatCanvasGroupDto,
  ChatCanvasLayoutDto,
  ChatCanvasNodeDto,
  ChatToolViewerDto,
} from "../../../presentation/desktop/chat/contracts.ts";

/**
 * Pure session-Canvas model (#55): reconciles the persisted layout with
 * the live conversation viewers and applies local edits. No React here;
 * the component stays a thin renderer over these transitions.
 */

export interface CanvasPlacedNode {
  readonly node: ChatCanvasNodeDto;
  readonly viewer?: ChatToolViewerDto;
}

export interface CanvasResolvedLayout {
  readonly placed: readonly CanvasPlacedNode[];
  readonly unplaced: readonly ChatToolViewerDto[];
  readonly groups: readonly ChatCanvasGroupDto[];
}

/** Viewers without a node surface as unplaced; notes always persist. */
export function resolveCanvasNodes(
  layout: ChatCanvasLayoutDto,
  viewers: readonly ChatToolViewerDto[],
): CanvasResolvedLayout {
  const byViewer = new Map(
    viewers.map((viewer) => [viewer.viewerId, viewer]),
  );
  const seen = new Set<string>();
  const placed: CanvasPlacedNode[] = [];
  for (const node of layout.nodes) {
    if (node.kind === "viewer") {
      if (node.viewerId === undefined) continue;
      const viewer = byViewer.get(node.viewerId);
      if (viewer === undefined) continue;
      seen.add(node.viewerId);
      placed.push({ node, viewer });
    } else {
      placed.push({ node });
    }
  }
  return {
    placed,
    unplaced: viewers.filter((viewer) => !seen.has(viewer.viewerId)),
    groups: layout.groups,
  };
}

/** Deterministic cascade for newly placed nodes. */
export function autoPlace(
  index: number,
): { readonly x: number; readonly y: number } {
  const step = 48;
  const slot = index % 8;
  return { x: 24 + slot * step, y: 24 + slot * step };
}

function replaceNode(
  layout: ChatCanvasLayoutDto,
  id: string,
  next: ChatCanvasNodeDto,
): ChatCanvasLayoutDto {
  return {
    ...layout,
    nodes: layout.nodes.map((node) => (node.id === id ? next : node)),
  };
}

export function applyNodeMove(
  layout: ChatCanvasLayoutDto,
  id: string,
  x: number,
  y: number,
): ChatCanvasLayoutDto {
  const node = layout.nodes.find((entry) => entry.id === id);
  if (node === undefined) return layout;
  return replaceNode(layout, id, { ...node, x, y });
}

export function applyNodeResize(
  layout: ChatCanvasLayoutDto,
  id: string,
  width: number,
  height: number,
): ChatCanvasLayoutDto {
  const node = layout.nodes.find((entry) => entry.id === id);
  if (node === undefined || width <= 0 || height <= 0) return layout;
  return replaceNode(layout, id, { ...node, width, height });
}

export function applyNodeGroup(
  layout: ChatCanvasLayoutDto,
  id: string,
  groupId: string | undefined,
): ChatCanvasLayoutDto {
  const node = layout.nodes.find((entry) => entry.id === id);
  if (node === undefined) return layout;
  if (
    groupId !== undefined &&
    !layout.groups.some((group) => group.id === groupId)
  ) {
    return layout;
  }
  const { groupId: _dropped, ...rest } = node;
  return replaceNode(
    layout,
    id,
    groupId === undefined ? rest : { ...rest, groupId },
  );
}

export function addCanvasNote(
  layout: ChatCanvasLayoutDto,
  note: {
    readonly id: string;
    readonly text: string;
    readonly x: number;
    readonly y: number;
  },
): ChatCanvasLayoutDto {
  if (layout.nodes.some((entry) => entry.id === note.id)) return layout;
  const z = layout.nodes.reduce((max, entry) => Math.max(max, entry.z), 0) + 1;
  return {
    ...layout,
    nodes: [...layout.nodes, { ...note, kind: "note", z }],
  };
}

export function addCanvasGroup(
  layout: ChatCanvasLayoutDto,
  group: ChatCanvasGroupDto,
): ChatCanvasLayoutDto {
  if (layout.groups.some((entry) => entry.id === group.id)) return layout;
  return { ...layout, groups: [...layout.groups, group] };
}

export function placeViewerNode(
  layout: ChatCanvasLayoutDto,
  node: { readonly id: string; readonly viewerId: string },
): ChatCanvasLayoutDto {
  if (layout.nodes.some((entry) => entry.id === node.id)) return layout;
  if (
    layout.nodes.some((entry) =>
      entry.kind === "viewer" && entry.viewerId === node.viewerId
    )
  ) {
    return layout;
  }
  const z = layout.nodes.reduce((max, entry) => Math.max(max, entry.z), 0) + 1;
  return {
    ...layout,
    nodes: [...layout.nodes, {
      ...node,
      ...autoPlace(layout.nodes.length),
      kind: "viewer",
      z,
    }],
  };
}

export function removeCanvasNode(
  layout: ChatCanvasLayoutDto,
  id: string,
): ChatCanvasLayoutDto {
  if (!layout.nodes.some((entry) => entry.id === id)) return layout;
  return { ...layout, nodes: layout.nodes.filter((entry) => entry.id !== id) };
}

export function applyNodeTitle(
  layout: ChatCanvasLayoutDto,
  id: string,
  title: string | undefined,
): ChatCanvasLayoutDto {
  const node = layout.nodes.find((entry) => entry.id === id);
  if (node === undefined) return layout;
  const { title: _dropped, ...rest } = node;
  return replaceNode(
    layout,
    id,
    title === undefined || title === "" ? rest : { ...rest, title },
  );
}

export function applyNoteText(
  layout: ChatCanvasLayoutDto,
  id: string,
  text: string,
): ChatCanvasLayoutDto {
  const node = layout.nodes.find((entry) => entry.id === id);
  if (node === undefined || node.kind !== "note" || text === "") return layout;
  return replaceNode(layout, id, { ...node, text });
}

export function applyNoteDone(
  layout: ChatCanvasLayoutDto,
  id: string,
  done: boolean,
): ChatCanvasLayoutDto {
  const node = layout.nodes.find((entry) => entry.id === id);
  if (node === undefined || node.kind !== "note") return layout;
  const { done: _dropped, ...rest } = node;
  return replaceNode(layout, id, done ? { ...rest, done } : rest);
}

/** Display title: custom title, then tool name, then "Note". */
export function nodeDisplayTitle(
  node: { readonly title?: string; readonly kind: "viewer" | "note" },
  viewerTool?: string,
): string {
  if (node.title !== undefined) return node.title;
  if (node.kind === "viewer") return viewerTool ?? "Viewer";
  return "Note";
}
