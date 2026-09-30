/** Provider capabilities belong to Chat, never the read-only Workbench. */
export const FORBIDDEN_WORKBENCH_AUTHORITY_MARKERS = [
  "serverTools",
  "serverResources",
  "ui/notifications/tool-result",
] as const;

export const WORKBENCH_GRAPH_ROOT = "src/ui/src/thread/workbench.tsx";

export interface WorkbenchAuthorityGraph {
  readonly version: 1;
  readonly root: string;
  readonly modules: readonly {
    readonly id: string;
    readonly imports: readonly string[];
    readonly markers: readonly string[];
  }[];
}

/** Validate the build's closed import graph before trusting its marker report. */
export function authorityMarkersInGraph(
  graph: WorkbenchAuthorityGraph,
): readonly string[] {
  if (
    graph.version !== 1 || graph.root !== WORKBENCH_GRAPH_ROOT ||
    !Array.isArray(graph.modules) || graph.modules.length === 0
  ) {
    throw new Error(
      "Workbench authority graph evidence is missing or invalid.",
    );
  }
  const modules = new Map(graph.modules.map((module) => [module.id, module]));
  if (modules.size !== graph.modules.length || !modules.has(graph.root)) {
    throw new Error(
      "Workbench authority graph has a missing or duplicate root/module.",
    );
  }
  const visited = new Set<string>();
  const pending = [graph.root];
  const found = new Set<string>();
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    const module = modules.get(id);
    if (
      module === undefined || !Array.isArray(module.imports) ||
      !Array.isArray(module.markers)
    ) {
      throw new Error(
        `Workbench authority graph has an unresolved module: ${id}.`,
      );
    }
    visited.add(id);
    for (const marker of module.markers) {
      if (
        !FORBIDDEN_WORKBENCH_AUTHORITY_MARKERS.includes(
          marker as typeof FORBIDDEN_WORKBENCH_AUTHORITY_MARKERS[number],
        )
      ) {
        throw new Error(
          `Workbench authority graph has an unknown marker: ${marker}.`,
        );
      }
      found.add(marker);
    }
    pending.push(...module.imports);
  }
  if (visited.size !== modules.size) {
    throw new Error("Workbench authority graph contains unreachable modules.");
  }
  return FORBIDDEN_WORKBENCH_AUTHORITY_MARKERS.filter((marker) => found.has(marker));
}
