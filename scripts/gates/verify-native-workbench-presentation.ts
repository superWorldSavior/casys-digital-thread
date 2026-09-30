/**
 * Release gate for the native Workbench presentation boundary.
 *
 * The Workbench is not an MCP App or MCP client. Its presentation primitives
 * and theme stay local, while a generic opaque iframe implements only the
 * read-only Apps lifecycle for an exact registered whole App.
 *
 * `postMessage` is deliberately not a marker: react-dom's scheduler uses a
 * MessageChannel, so the literal appears in any React bundle. Provider
 * authority is checked on the actual Workbench import graph because the same
 * shell also mounts the independent Chat. Retired domain renderers and unsafe
 * iframe origin permissions remain forbidden across the whole shell.
 * `ui/initialize` is required by the minimal read-only iframe host.
 */
import {
  authorityMarkersInGraph,
  FORBIDDEN_WORKBENCH_AUTHORITY_MARKERS,
  type WorkbenchAuthorityGraph,
} from "./workbench-authority-graph.ts";

export const FORBIDDEN_NATIVE_BUNDLE_MARKERS = [
  ...FORBIDDEN_WORKBENCH_AUTHORITY_MARKERS,
  "allow-same-origin",
  "GLTFLoader",
  "STLLoader",
  "OrbitControls",
  "architectureSysmlSealInspectorView",
  "ProductRequirementsMatrix",
  "OverviewVerdictTiles",
  "AssemblyIntegrityVerdictTile",
  "EvaluationCloseoutCard",
  "AssemblyIntegrityCard",
  "parseGeometryDecisionView",
  "geometryReviewPartAssets",
  "overviewAssemblyIntegrityPromotions",
  "ProductWorkspaceFacet",
  "productFacetHash",
  "activeProductFacet",
  "architectureSysmlSeals",
  "architectureSysmlSources",
  "evaluationCloseoutCaptures",
  "assemblyIntegrityCaptures",
  "draftAssetReader",
  "productNavigation:",
  "buildPartAnchorageResolution",
  "feedScopeForNode",
  "thread-feed-component-filter",
  "ARCHITECTURE_SYSML_SEAL_ARTIFACT_ID_PREFIX",
  "DFM_CHECK_ARTIFACT_ID_PREFIX",
  "SENSITIVITY_BASE_EVALUATION_ARTIFACT_ID_PREFIX",
  "isPrimaryArtifact",
  "isMeasuredDfmArtifactId",
  "isSensitivityBaseEvaluationArtifactId",
  "isDemoLoopPrimaryArtifact",
  "document · documentary",
  "TOOL_FACETS",
  "resolveToolFacet",
  "contextMetrics",
  "WorkbenchToolId",
  "ToolInspectorPanel",
  "resolveToolInspectorTarget",
  "ADMITTED_MODELICA_PRODUCER",
  "ADMITTED_SPICE_PRODUCER",
  "FEA_STATIC_PROOF_PRODUCER",
  "explorationNodeLabel",
  "presentedUnaffectedSystems",
  "isAnalyzeInstrumentNode",
  "isSolverEnvelopeNode",
  "isFoldedEvidenceNode",
  "SUPPORTING_ARTIFACT_KINDS",
  "verificationChainDetail",
  "RecomputeHistoryPanel",
  "buildRecomputeHistory",
  "projectComponents(",
  "projectComponentStructureGraph",
  'ThreadWorkbenchSnapshot["components"]',
  "components: ThreadComponentCatalog",
  "isThreadComponentCatalog",
  "thread.components",
  "snapshot.components",
  "candidate.components",
  "componentCatalogForSubject",
  "componentCatalogForSnapshot",
  "resolveSnapshotComponentCatalog",
  "ThreadComponentPreview",
  "ThreadSourceFileCatalog",
  "enrichThreadWorkbenchWithTechnicalAdmissions",
  "projectSealedCadLeverGraph",
  "projectTechnicalAdmissionSourceFileGraph",
  '"cad-lever"',
  '"cad-unnamed-literal"',
  '"sourceFiles"',
  "/api/draft-assets/",
] as const;

/**
 * Retired presentation/model clusters.  Checking explicit paths complements
 * the bundle markers: a dead native viewer is still shipped source and can be
 * accidentally remounted later even when tree-shaking keeps it out today.
 *
 * Keep this list narrow.  Canonical Thread records and server-side engineering
 * authorities are legitimate; only Workbench-owned domain presentation and its
 * browser-only reconstruction models belong here.
 */
export const FORBIDDEN_NATIVE_PRESENTATION_PATHS = [
  "src/adapters/thread/architecture-sysml-seal-workbench-enricher.ts",
  "src/adapters/thread/assembly-integrity-workbench-enricher.ts",
  "src/adapters/thread/evaluation-closeout-workbench-enricher.ts",
  "src/adapters/thread/sealed-cad-lever-graph.ts",
  "src/adapters/thread/sealed-cad-lever-workbench-enricher.ts",
  "src/adapters/thread/technical-admission-source-file-graph.ts",
  "src/adapters/thread/technical-admission-workbench-enricher.ts",
  "src/presentation/workbench/thread/architecture.ts",
  "src/presentation/workbench/thread/components.ts",
  "src/presentation/workbench/thread/product-navigation.ts",
  "src/presentation/workbench/thread/source-files.ts",
  "src/ui/src/initial-result.ts",
  "src/ui/src/architecture/sysml-composite-projection.ts",
  "src/ui/src/cad/cad-presentation-projection.ts",
  "src/ui/src/cad/exact-thread-asset.ts",
  "src/ui/src/cad/geometry-decision-model.ts",
  "src/ui/src/cad/thread-asset-open-links.tsx",
  "src/ui/src/cad/three-orbit-viewport-model.ts",
  "src/ui/src/cad/three-orbit-viewport.ts",
  "src/ui/src/project/brief-record-model.ts",
  "src/ui/src/project/brief-record.tsx",
  "src/ui/src/project/overview-thread-instrument-model.ts",
  "src/ui/src/project/overview-thread-instrument.tsx",
  "src/ui/src/project/product-requirements-matrix.tsx",
  "src/ui/src/project/product-requirements-model.ts",
  "src/ui/src/project/product-sourcing.tsx",
  "src/ui/src/project/requirement-margin-model.ts",
  "src/ui/src/project/review-architecture-model.ts",
  "src/ui/src/thread/component-workspace-model.ts",
  "src/ui/src/thread/component-workspace.tsx",
  "src/ui/src/thread/essential-graph-filter.ts",
  "src/ui/src/thread/gltf-asset-canvas.tsx",
  "src/ui/src/thread/part-anchorage-model.ts",
  "src/ui/src/thread/product-anchor-model.ts",
  "src/ui/src/thread/product-authoring-sources.ts",
  "src/ui/src/thread/recompute-model.ts",
  "src/ui/src/thread/recompute.tsx",
] as const;

export interface PresentationBoundaryInput {
  readonly primitiveAdapterSource: string;
  readonly nativeBundle: string;
  /** Omission retains the strict legacy whole-bundle authority check. */
  readonly workbenchAuthorityGraph?: WorkbenchAuthorityGraph;
  readonly presentForbiddenPaths?: readonly string[];
}

export type PresentationBoundaryResult =
  | {
    readonly status: "ready";
  }
  | {
    readonly status: "failed";
    readonly errors: readonly string[];
  };

export function evaluatePresentationBoundary(
  input: PresentationBoundaryInput,
): PresentationBoundaryResult {
  const errors: string[] = [];

  const mcpViewImports = findMcpViewImports(input.primitiveAdapterSource);
  if (mcpViewImports.length > 0) {
    errors.push(
      `src/ui/src/mcp-view-primitives.ts must not import @casys/mcp-view entry points: ${
        mcpViewImports.join(", ")
      }.`,
    );
  }

  const runtimeMarkers = findMarkers(
    input.nativeBundle,
    input.workbenchAuthorityGraph === undefined
      ? FORBIDDEN_NATIVE_BUNDLE_MARKERS
      : FORBIDDEN_NATIVE_BUNDLE_MARKERS.filter((marker) =>
        !FORBIDDEN_WORKBENCH_AUTHORITY_MARKERS.includes(
          marker as typeof FORBIDDEN_WORKBENCH_AUTHORITY_MARKERS[number],
        )
      ),
  );
  if (runtimeMarkers.length > 0) {
    errors.push(
      `native Workbench source or bundle contains provider authority or native viewer markers: ${
        runtimeMarkers.join(", ")
      }.`,
    );
  }

  if (input.workbenchAuthorityGraph !== undefined) {
    try {
      const markers = authorityMarkersInGraph(input.workbenchAuthorityGraph);
      if (markers.length > 0) {
        errors.push(
          `read-only Workbench import graph contains provider authority markers: ${
            markers.join(", ")
          }.`,
        );
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if ((input.presentForbiddenPaths?.length ?? 0) > 0) {
    errors.push(
      `retired native Workbench presentation paths still exist: ${
        input.presentForbiddenPaths!.join(", ")
      }.`,
    );
  }

  return errors.length > 0 ? { status: "failed", errors } : { status: "ready" };
}

async function existingForbiddenPresentationPaths(): Promise<
  readonly string[]
> {
  const present: string[] = [];
  for (const path of FORBIDDEN_NATIVE_PRESENTATION_PATHS) {
    try {
      const info = await Deno.stat(path);
      if (info.isFile) present.push(path);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  return present;
}

function findMarkers(bundle: string, markers: readonly string[]): string[] {
  return markers.filter((marker) => bundle.includes(marker));
}

function findMcpViewImports(source: string): string[] {
  return [...source.matchAll(/from\s+"(@casys\/mcp-view(?:\/[^\"]+)?)"/g)]
    .map((match) => match[1])
    .filter((specifier): specifier is string => specifier !== undefined);
}

async function readNativeWorkbenchBundle(
  root = "src/ui/dist/thread",
): Promise<string> {
  const html = await Deno.readTextFile(`${root}/native-workbench.html`);
  const parts = [html];
  try {
    for await (const entry of Deno.readDir(`${root}/assets`)) {
      if (!entry.isFile) continue;
      if (!/\.(js|css)$/.test(entry.name)) continue;
      parts.push(await Deno.readTextFile(`${root}/assets/${entry.name}`));
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return parts.join("\n");
}

if (import.meta.main) {
  const [
    primitiveAdapterSource,
    nativeBundle,
    workbenchAuthorityGraph,
    inspectorModelSource,
    overviewSource,
    operationsSource,
    reviewModelSource,
    heroModelSource,
    navigationModelSource,
    workbenchSource,
    feedModelSource,
    feedSource,
    evidenceCanvasModelSource,
    evidenceGraphModelSource,
    evidenceExplorationModelSource,
    threadProjectorSource,
    threadSnapshotContractSource,
    threadTypesSource,
    nativeServerSource,
    desktopBffSource,
    presentForbiddenPaths,
  ] = await Promise.all([
    Deno.readTextFile("src/ui/src/mcp-view-primitives.ts"),
    readNativeWorkbenchBundle(),
    Deno.readTextFile("src/ui/dist/thread/workbench-authority-graph.json")
      .then((source) => JSON.parse(source) as WorkbenchAuthorityGraph),
    Deno.readTextFile("src/ui/src/thread/tool-inspector-model.ts"),
    Deno.readTextFile("src/ui/src/project/overview.tsx"),
    Deno.readTextFile("src/ui/src/project/work.tsx"),
    Deno.readTextFile("src/ui/src/project/review-decision-model.ts"),
    Deno.readTextFile("src/ui/src/project/overview-thread-hero-model.ts"),
    Deno.readTextFile("src/ui/src/project/navigation-model.ts"),
    Deno.readTextFile("src/ui/src/thread/workbench.tsx"),
    Deno.readTextFile("src/ui/src/thread/feed-model.ts"),
    Deno.readTextFile("src/ui/src/thread/feed.tsx"),
    Deno.readTextFile("src/ui/src/thread/evidence-canvas-model.ts"),
    Deno.readTextFile("src/ui/src/thread/evidence-graph-model.ts"),
    Deno.readTextFile("src/ui/src/thread/evidence-exploration-model.ts"),
    Deno.readTextFile("src/adapters/thread/thread-workbench-projector.ts"),
    Deno.readTextFile("src/presentation/workbench/thread/snapshot.ts"),
    Deno.readTextFile("src/ui/src/thread/types.ts"),
    Deno.readTextFile("scripts/serve/serve-native-workbench.ts"),
    Deno.readTextFile("desktop/src/workbench/bff.ts"),
    existingForbiddenPresentationPaths(),
  ]);
  const result = evaluatePresentationBoundary({
    primitiveAdapterSource,
    workbenchAuthorityGraph,
    nativeBundle: [
      nativeBundle,
      inspectorModelSource,
      overviewSource,
      operationsSource,
      reviewModelSource,
      heroModelSource,
      navigationModelSource,
      workbenchSource,
      feedModelSource,
      feedSource,
      evidenceCanvasModelSource,
      evidenceGraphModelSource,
      evidenceExplorationModelSource,
      threadProjectorSource,
      threadSnapshotContractSource,
      threadTypesSource,
      nativeServerSource,
      desktopBffSource,
    ].join("\n"),
    presentForbiddenPaths,
  });

  switch (result.status) {
    case "ready":
      console.log(
        "OK native Workbench keeps its self-contained presentation boundary.",
      );
      break;
    case "failed":
      for (const error of result.errors) console.error(`ERROR ${error}`);
      Deno.exit(1);
  }
}
