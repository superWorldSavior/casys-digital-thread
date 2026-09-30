import { assertEquals } from "@std/assert";
import {
  buildEvidenceCanvasProjection,
  buildExplorationKindProjection,
  buildInitialEvidenceFrameProjection,
  INITIAL_EVIDENCE_FRAME_MAX_NODES,
  linkedEvidenceDetail,
  makeEvidenceComponentLabeler,
  paintedDossierMetric,
} from "./src/thread/evidence-canvas-model.ts";
import type { DisplayKind } from "./src/thread/graph-record-display.ts";
import {
  allEvidenceKindsVisible,
  CURRENT_EVIDENCE_KIND_PRESET,
  isCurrentEvidenceKindPreset,
  isFullEvidenceKindScope,
} from "./src/thread/graph-record-display.ts";
import { buildEvidenceGraphModel } from "./src/thread/evidence-graph-model.ts";
import type {
  ThreadEvidenceFamilyGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./src/thread/types.ts";

const EMPTY_FAMILY_GRAPH: ThreadEvidenceFamilyGraph = {
  schemaVersion: "thread-evidence-family-graph/1.0",
  asOf: { snapshotId: "test", revision: 1 },
  families: [],
  edges: [],
  omittedSelfLoops: [],
  omittedCycleEdges: [],
};

Deno.test("generic evidence canvas never folds by provider, id prefix or artifact kind", () => {
  const nodes = [
    node("sensitivity-case-a", "artifact", "build123d", "solver-result"),
    node("middle", "consumption", "calculix"),
    node("result", "observation", "syson"),
  ];
  const edges = [
    edge("one", nodes[0]!.ref, nodes[1]!.ref),
    edge("two", nodes[1]!.ref, nodes[2]!.ref),
  ];
  const model = buildEvidenceGraphModel(
    { nodes, edges },
    EMPTY_FAMILY_GRAPH,
  );
  const projection = buildEvidenceCanvasProjection(
    model,
    0,
    undefined,
    new Map(),
  );

  assertEquals(projection.nodes, nodes);
  assertEquals(projection.edges, edges);
  assertEquals(projection.hiddenByKindCount, 0);
});

Deno.test("local evidence view is a generic bounded recorded neighbourhood", () => {
  const nodes = ["a", "b", "c", "d"].map((id) =>
    node(id, "artifact", "recorded-system")
  );
  const model = buildEvidenceGraphModel({
    nodes,
    edges: [
      edge("ab", nodes[0]!.ref, nodes[1]!.ref),
      edge("bc", nodes[1]!.ref, nodes[2]!.ref),
      edge("cd", nodes[2]!.ref, nodes[3]!.ref),
    ],
  }, EMPTY_FAMILY_GRAPH);
  const projection = buildEvidenceCanvasProjection(
    model,
    0,
    nodes[0]!.ref,
    new Map(),
  );

  assertEquals(projection.isFiltered, true);
  assertEquals(projection.nodes.map((item) => item.ref.id), [
    "a",
    "b",
    "c",
    "d",
  ]);
  assertEquals(projection.localDepthByRefKey?.get("artifact:a"), 0);
  assertEquals(projection.localDepthByRefKey?.get("artifact:d"), 3);
});

Deno.test("kind filter uses literal recorded entity kinds", () => {
  const artifact = node("artifact", "artifact", "build123d", "mesh");
  const observation = node("observation", "observation", "calculix");
  const model = buildEvidenceGraphModel({
    nodes: [artifact, observation],
    edges: [edge("relation", artifact.ref, observation.ref)],
  }, EMPTY_FAMILY_GRAPH);
  const kinds = allKinds(true);
  kinds.artifact = false;
  const projection = buildExplorationKindProjection(model, kinds);

  assertEquals(projection.nodes.map((item) => item.ref.id), ["observation"]);
  assertEquals(projection.edges, []);
});

Deno.test("component labels and dossier metrics remain graph-derived", () => {
  const record = node("record", "artifact", "digital-thread");
  const model = buildEvidenceGraphModel(
    { nodes: [record], edges: [] },
    EMPTY_FAMILY_GRAPH,
  );
  const projection = buildEvidenceCanvasProjection(
    model,
    0,
    undefined,
    new Map(),
  );
  const label = makeEvidenceComponentLabeler(model, true)([record], 0);

  assertEquals(label.length > 0, true);
  assertEquals(paintedDossierMetric(model, projection), {
    itemCount: 1,
    componentCount: 1,
  });
  assertEquals(linkedEvidenceDetail(1), "in 1 linked dossier");
});

Deno.test("current evidence preset keeps head entities and parks history kinds", () => {
  assertEquals(
    Object.entries(CURRENT_EVIDENCE_KIND_PRESET)
      .filter(([, visible]) => !visible)
      .map(([kind]) => kind)
      .sort(),
    ["analysis-node", "change", "consumption"],
  );
  assertEquals(
    isCurrentEvidenceKindPreset({ ...CURRENT_EVIDENCE_KIND_PRESET }),
    true,
  );
  assertEquals(
    isFullEvidenceKindScope({ ...CURRENT_EVIDENCE_KIND_PRESET }),
    false,
  );
  assertEquals(isCurrentEvidenceKindPreset(allKinds(true)), false);
  assertEquals(isFullEvidenceKindScope(allKinds(true)), true);
  const custom = { ...CURRENT_EVIDENCE_KIND_PRESET, artifact: false };
  assertEquals(isCurrentEvidenceKindPreset(custom), false);
  assertEquals(isFullEvidenceKindScope(custom), false);
  assertEquals(allEvidenceKindsVisible(), allKinds(true));
});

Deno.test("current evidence preset paints entities and their recorded edges only", () => {
  const artifact = node("part", "artifact", "digital-thread");
  const change = node("rev", "change", "digital-thread");
  const model = buildEvidenceGraphModel({
    nodes: [artifact, change],
    edges: [edge("changes", change.ref, artifact.ref)],
  }, EMPTY_FAMILY_GRAPH);
  const projection = buildExplorationKindProjection(
    model,
    { ...CURRENT_EVIDENCE_KIND_PRESET },
  );

  assertEquals(projection.nodes.map((item) => item.ref.id), ["part"]);
  assertEquals(projection.edges, []);
  assertEquals(projection.displayedCount, 1);
  assertEquals(projection.hiddenByKindCount, 1);
});

Deno.test("initial frame keeps current anchors and bounds a bulky thread", () => {
  const chain = Array.from(
    { length: 300 },
    (_, i) => node(`a${String(i).padStart(3, "0")}`, "artifact", "recorded-system"),
  );
  const stale = node("a-old", "artifact", "recorded-system");
  const req1 = node("req-1", "requirement", "recorded-system");
  const req2 = node("req-2", "requirement", "recorded-system");
  const verdict = node("eval-1", "evaluation", "recorded-system");
  const edges: ThreadGraphEdge[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    edges.push(edge(`chain-${i}`, chain[i]!.ref, chain[i + 1]!.ref));
  }
  edges.push(edge("req-link", req1.ref, chain[0]!.ref));
  edges.push(edge("verdict-link", verdict.ref, req1.ref));
  const model = buildEvidenceGraphModel({
    nodes: [...chain, stale, req1, req2, verdict],
    edges,
  }, {
    ...EMPTY_FAMILY_GRAPH,
    families: [{
      id: "family:head",
      entityKind: "artifact",
      historicalRefs: [stale.ref],
      currentRefs: [chain[299]!.ref],
      revisionCount: 1,
      status: "current",
      relationship: {
        relation: "supersedes",
        classification: "not-recorded",
        equivalence: "not-recorded",
      },
      transitions: [{
        edgeRef: {
          id: "supersede-stale",
          relation: "supersedes",
          origin: "provenance",
        },
        historical: stale.ref,
        successor: chain[299]!.ref,
      }],
    }],
  });
  const anchors = {
    familyCurrentRefs: [chain[299]!.ref],
    caseAuthorityArtifactIds: ["a150"],
  };
  const first = buildInitialEvidenceFrameProjection(
    model,
    { ...CURRENT_EVIDENCE_KIND_PRESET },
    anchors,
    10,
  );
  const second = buildInitialEvidenceFrameProjection(
    model,
    { ...CURRENT_EVIDENCE_KIND_PRESET },
    anchors,
    10,
  );
  const ids = first.nodes.map((item) => item.ref.id);
  assertEquals(ids.length, 9);
  // Deterministic: anchors by ref key, then neighbours by ref key.
  assertEquals(ids, second.nodes.map((item) => item.ref.id));
  for (const id of ["a299", "a150", "req-1", "req-2", "eval-1"]) {
    assertEquals(ids.includes(id), true);
  }
  // Depth-1 recorded neighbours of the anchors stay in the frame.
  for (const id of ["a298", "a149", "a151", "a000"]) {
    assertEquals(ids.includes(id), true);
  }
  assertEquals(
    first.displayedCount + first.hiddenByKindCount +
      (first.initialFrameOverflowCount ?? 0),
    model.nodes.length,
  );
  assertEquals((first.initialFrameOverflowCount ?? 0) > 0, true);
  // Every painted edge is recorded with both ends shown.
  for (const item of first.edges) {
    assertEquals(ids.includes(item.from.id), true);
    assertEquals(ids.includes(item.to.id), true);
  }
});

Deno.test("initial frame paints the whole kind projection under the bound", () => {
  const artifact = node("part", "artifact", "digital-thread");
  const change = node("rev", "change", "digital-thread");
  const model = buildEvidenceGraphModel({
    nodes: [artifact, change],
    edges: [edge("changes", change.ref, artifact.ref)],
  }, EMPTY_FAMILY_GRAPH);
  const framed = buildInitialEvidenceFrameProjection(
    model,
    { ...CURRENT_EVIDENCE_KIND_PRESET },
    { familyCurrentRefs: [], caseAuthorityArtifactIds: [] },
  );
  const kindOnly = buildExplorationKindProjection(
    model,
    { ...CURRENT_EVIDENCE_KIND_PRESET },
  );
  assertEquals(framed.nodes, kindOnly.nodes);
  assertEquals(framed.edges, kindOnly.edges);
  assertEquals(framed.displayedCount, 1);
  assertEquals(framed.hiddenByKindCount, 1);
  assertEquals(framed.initialFrameOverflowCount, 0);
});

Deno.test("initial frame without anchors degrades to deterministic truncation", () => {
  const chain = Array.from(
    { length: 200 },
    (_, i) => node(`a${String(i).padStart(3, "0")}`, "artifact", "recorded-system"),
  );
  const edges: ThreadGraphEdge[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    edges.push(edge(`chain-${i}`, chain[i]!.ref, chain[i + 1]!.ref));
  }
  const model = buildEvidenceGraphModel(
    { nodes: chain, edges },
    EMPTY_FAMILY_GRAPH,
  );
  const framed = buildInitialEvidenceFrameProjection(
    model,
    { ...CURRENT_EVIDENCE_KIND_PRESET },
    { familyCurrentRefs: [], caseAuthorityArtifactIds: [] },
  );
  assertEquals(framed.nodes.length, INITIAL_EVIDENCE_FRAME_MAX_NODES);
  assertEquals(
    framed.nodes.map((item) => item.ref.id),
    Array.from(
      { length: INITIAL_EVIDENCE_FRAME_MAX_NODES },
      (_, i) => `a${String(i).padStart(3, "0")}`,
    ),
  );
  assertEquals(
    framed.initialFrameOverflowCount,
    200 - INITIAL_EVIDENCE_FRAME_MAX_NODES,
  );
});

Deno.test("initial frame honours hidden kinds and keeps counts exact", () => {
  const chain = Array.from(
    { length: 160 },
    (_, i) => node(`a${String(i).padStart(3, "0")}`, "artifact", "recorded-system"),
  );
  const probe = node("probe", "observation", "recorded-system");
  const edges: ThreadGraphEdge[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    edges.push(edge(`chain-${i}`, chain[i]!.ref, chain[i + 1]!.ref));
  }
  edges.push(edge("probe-link", probe.ref, chain[0]!.ref));
  const model = buildEvidenceGraphModel(
    { nodes: [...chain, probe], edges },
    EMPTY_FAMILY_GRAPH,
  );
  const kinds = { ...CURRENT_EVIDENCE_KIND_PRESET, observation: false };
  const framed = buildInitialEvidenceFrameProjection(
    model,
    kinds,
    { familyCurrentRefs: [], caseAuthorityArtifactIds: [] },
  );
  assertEquals(
    framed.nodes.some((item) => item.ref.id === "probe"),
    false,
  );
  assertEquals(framed.hiddenByKindCount, 1);
  assertEquals(
    framed.displayedCount + framed.hiddenByKindCount +
      (framed.initialFrameOverflowCount ?? 0),
    model.nodes.length,
  );
});

function allKinds(value: boolean): Record<DisplayKind, boolean> {
  return {
    artifact: value,
    consumption: value,
    observation: value,
    requirement: value,
    evaluation: value,
    violation: value,
    change: value,
    action: value,
    "analysis-node": value,
    "part-definition": value,
    "part-usage": value,
    "attribute-usage": value,
  };
}

function node(
  id: string,
  entityKind: ThreadGraphRef["kind"],
  system: string,
  artifactKind?: string,
): ThreadGraphNode {
  return {
    id: `graph:${entityKind}:${id}`,
    ref: { kind: entityKind, id },
    entityKind,
    ...(artifactKind ? { artifactKind } : {}),
    label: id,
    system,
    freshness: "fresh",
    summary: id,
  };
}

function edge(
  id: string,
  from: ThreadGraphRef,
  to: ThreadGraphRef,
): ThreadGraphEdge {
  return {
    id,
    from,
    to,
    relation: "derived_from",
    rationale: id,
    origin: "provenance",
  };
}
