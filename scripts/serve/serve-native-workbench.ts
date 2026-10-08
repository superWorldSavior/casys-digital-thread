import { parseArgs } from "../lib/cli.ts";
import { projectThreadViewerHierarchy } from "../../src/adapters/thread/thread-viewer-hierarchy.ts";
import type { ThreadSnapshotStore } from "../../src/domain/thread/thread-snapshot-store.ts";
import type { ThreadSnapshot } from "../../src/domain/thread/thread-snapshot.ts";
import type { EngineeringProjectSnapshot } from "../../src/domain/project/engineering-project.ts";
import type { EngineeringProjectRevisionStore } from "../../src/application/ports/out/engineering-project-revision-store.ts";
import {
  collectEngineeringProjectThreadReferenceIssues,
  validateEngineeringProjectSnapshot,
} from "../../src/domain/project/engineering-project-validation.ts";
import { FileThreadSnapshotStore } from "../../src/adapters/shared/stores/file-thread-snapshot-store.ts";
import { FileCockpitFocusStore } from "../../src/adapters/project/file-cockpit-focus-store.ts";
import type { CockpitFocusStore } from "../../src/application/ports/out/project/cockpit-focus-store.ts";
import {
  ARCHITECTURE_CAPTURE_DESCRIPTOR,
  DFM_CASE_CAPTURE_DESCRIPTOR,
  FEA_PROOF_CASE_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  GEOMETRY_CAPTURE_DESCRIPTOR,
  PRINT_ESTIMATE_CASE_CAPTURE_DESCRIPTOR,
  PRINTABILITY_CASE_CAPTURE_DESCRIPTOR,
  REQUIREMENTS_CAPTURE_DESCRIPTOR,
  SENSITIVITY_BASE_EVALUATION_CAPTURE_DESCRIPTOR,
  SENSITIVITY_STUDY_CAPTURE_DESCRIPTOR,
  SENSITIVITY_STUDY_CASE_CAPTURE_DESCRIPTOR,
  SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
  SYSML_SOURCE_CAPTURE_DESCRIPTOR,
} from "../../src/adapters/shared/cas/file-capture-store.ts";
import { FileProjectSourceWorkspaceStore } from "../../src/adapters/project-source-workspace/file-project-source-workspace-store.ts";
import { DEFAULT_PROJECT_SOURCE_WORKSPACE_DIRECTORY } from "../../src/adapters/project-source-workspace/server-composition.ts";
import {
  requireSysmlSourceAnalysis,
  type SysmlSourceAnalysisReader,
} from "../../src/adapters/architecture/renderer/sysml-source-analysis-capture.ts";
import { FileEngineeringProjectRevisionStore } from "../../src/adapters/shared/stores/engineering-project-store.ts";
import { enrichEngineeringEvidenceWorkbenchWithRequirementsBriefTraces } from "../../src/adapters/thread/requirements-brief-trace-workbench.ts";
import { createRequirementsBriefTraceStore } from "../../src/adapters/record/requirements-brief-trace-store.ts";
import { RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION } from "../../src/domain/record/requirements-brief-trace.ts";
import { RECORD_DOCUMENTARY_CLAUSE_RESPONSE_OPERATION } from "../../src/domain/record/documentary-clause-response.ts";
import { RECORD_SEAL_PRE_SIZING_WORKSHEET_OPERATION } from "../../src/domain/record/pre-sizing-worksheet.ts";
import {
  createPreSizingWorksheetStore,
  DEFAULT_PRE_SIZING_WORKSHEET_DIRECTORY,
} from "../../src/adapters/record/pre-sizing-worksheet-store.ts";
import {
  createDocumentaryClauseResponseStore,
  DEFAULT_DOCUMENTARY_CLAUSE_RESPONSE_DIRECTORY,
} from "../../src/adapters/record/documentary-clause-response-store.ts";
import {
  DEFAULT_AGENT_RESOURCE_CAPTURE_DIRECTORY,
  FileAgentResourceStore,
} from "../../src/adapters/resource/file-agent-resource-store.ts";
import { ReopenAgentResource } from "../../src/application/use-cases/resource/reopen-agent-resource.ts";
export { DEFAULT_DOCUMENTARY_CLAUSE_RESPONSE_DIRECTORY };
import { isExplicitLoopbackHostname } from "../../src/adapters/loopback-host.ts";
import {
  type EngineeringWorkbenchSnapshot,
  projectEngineeringPlanningWorkbenchSnapshot,
  projectEngineeringWorkbenchSnapshot,
} from "../../src/adapters/thread/engineering-workbench-projector.ts";
import { REGISTERED_ENGINEERING_OPERATION_PATH_LANE_RESOLVER } from "../../src/orchestration/operations/path-lanes.ts";
import {
  type ExactThreadSnapshotReader,
  FileExactThreadSnapshotDirectory,
  OrderedExactThreadSnapshotReader,
} from "../../src/adapters/shared/stores/engineering-thread-snapshot-resolver.ts";
import { threadSnapshotDescendsFrom } from "../../src/adapters/shared/stores/thread-snapshot-lineage.ts";
import { MODEL_WRITE_ARCHITECTURE_OPERATION } from "../../src/domain/architecture/renderer/architecture-proposal.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "../../src/domain/cad/canonical/geometry-proposal.ts";
import { MODEL_WRITE_REQUIREMENTS_OPERATION } from "../../src/domain/architecture/requirements/requirements-proposal.ts";
import { MODEL_WRITE_TRACED_REQUIREMENTS_OPERATION } from "../../src/domain/architecture/requirements/requirements-traced-proposal.ts";
import { MODEL_RECAPTURE_REQUIREMENTS_OPERATION } from "../../src/domain/architecture/requirements/requirements-recapture-proposal.ts";
import { MODEL_RECAPTURE_TRACED_REQUIREMENTS_OPERATION } from "../../src/domain/architecture/requirements/requirements-traced-recapture-proposal.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../../src/domain/architecture/seed/syson-model-seed.ts";
import { COMPILE_SEAL_ADMISSION_OPERATION } from "../../src/domain/compile/admission/technical-compilation-proposal.ts";
import { DESIGN_EXECUTE_BUILD123D_OPERATION } from "../../src/domain/cad/isolated/build123d-execution-proposal.ts";
import {
  VERIFY_RUN_FEA_STATIC_PROOF_OPERATION,
  VERIFY_SEAL_PROOF_CASE_OPERATION,
} from "../../src/domain/fea/seal-case/fea-proof-proposal.ts";
import { SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION } from "../../src/domain/modelica/qualified-kit/run-proposal.ts";
import { SIMULATE_RUN_ADMITTED_MODELICA_OPERATION } from "../../src/domain/modelica/admitted/run-proposal.ts";
import { ARCHIVE_LINEAGE_OPERATION } from "../../src/domain/thread/thread-retirement.ts";
import {
  ANALYZE_RUN_FEA_SENSITIVITY_OPERATION,
  ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
  MODEL_WRITE_SENSITIVITY_EDGES_OPERATION,
} from "../../src/domain/sensitivity/study/sensitivity-study-proposal.ts";
import {
  VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION,
  VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
} from "../../src/orchestration/operations/fea-isolated-static-proof.ts";
import {
  DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION,
  DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION,
} from "../../src/domain/fea/evaluation-closeout/static-mechanical-evaluation-closeout-proposal.ts";
import {
  Base64EngineeringAssetReader,
  FileEngineeringAssetReader,
  OrderedEngineeringAssetReader,
} from "../../src/adapters/engineering-asset-resolver.ts";
import { projectThreadWorkbenchSnapshot } from "../../src/adapters/thread/thread-workbench-projector.ts";
import {
  projectThreadViewerSessions,
  type ThreadViewerAppLaunchResolver,
} from "../../src/adapters/thread/thread-viewer-sessions-projector.ts";
import {
  FileThreadViewerAppRegistry,
  type ThreadViewerAppRegistryReader,
} from "../../src/adapters/thread/file-thread-viewer-app-registry.ts";
import {
  type ThreadViewerAppBinding,
  type ThreadViewerProjectReviewAnchor,
  type ThreadViewerSessionsProjection,
} from "../../src/presentation/workbench/thread/viewer-sessions.ts";
import { sha256Fingerprint } from "../../src/domain/kernel/deterministic-json.ts";
import { FileByteStore } from "../../src/adapters/shared/cas/file-byte-store.ts";
import type {
  ProductNavigationTechnicalAdmissionReader,
  ProductNavigationTechnicalAdmissionSourceDependencies,
} from "../../src/adapters/thread/product-navigation-technical-admission-source-reader.ts";
import {
  type EngineeringCaseWorkbenchEnricherDependencies,
  enrichThreadWorkbenchWithEngineeringCases,
} from "../../src/adapters/thread/verification-case-workbench-enricher.ts";
import {
  enrichThreadWorkbenchWithRequirementsTargets,
  type RequirementsCaptureReader,
} from "../../src/adapters/thread/requirements-target-workbench-enricher.ts";
import {
  composeHistoryCaptureReaders,
  enrichThreadWorkbenchWithRequirementsHistory,
} from "../../src/adapters/thread/requirements-history-workbench-enricher.ts";
import { CaptureProductStructureTraversal } from "../../src/adapters/architecture/renderer/capture-product-structure-traversal.ts";
import { ProjectProductNavigation } from "../../src/application/use-cases/product-navigation/project-product-navigation.ts";
import type { ProductNavigationUseCase } from "../../src/application/ports/in/product-navigation/product-navigation.ts";
import type { ProjectResponseUseCase } from "../../src/application/ports/in/project-response/project-response.ts";
import { ReadProjectResponse } from "../../src/application/use-cases/project-response/read-project-response.ts";
import { ThreadProjectResponseEvidenceReader } from "../../src/adapters/thread/project-response-evidence-reader.ts";
import { WorkbenchProductNavigationEvidenceAttachmentReader } from "../../src/adapters/thread/product-navigation-workbench.ts";
import { ProjectSourceWorkspaceAuthoringAttachmentReader } from "../../src/adapters/project-source-workspace/product-navigation-authoring-attachment-reader.ts";
import {
  PROJECT_SOURCE_WORKSPACE_BOUNDS,
  ProjectSourceWorkspaceError,
} from "../../src/domain/project-source-workspace/types.ts";
import {
  PRODUCT_NAVIGATION_QUERY_SCHEMA,
  type ProductExploreResult,
  unavailableExplore,
  unavailableProductNavigationProjection,
} from "../../src/application/ports/in/product-navigation/product-navigation-read-model.ts";
import {
  productStructureElementRef,
  productStructureElementRefsEqual,
  type ProductStructureOccurrenceRef,
} from "../../src/domain/architecture/product-structure-ref.ts";
import { readDeclaredCockpitFleet } from "../../src/adapters/thread/cockpit-fleet-projector.ts";
import type { CockpitFleetProjection } from "../../src/presentation/workbench/fleet/projection.ts";
import {
  type NativeWorkbenchProjectDiscovery,
  nativeWorkbenchProjectDiscoveryHttpStatus,
  readNativeWorkbenchProjectDiscovery,
  renderNativeWorkbenchProjectDiscoveryHtml,
} from "../../src/adapters/thread/native-workbench-project-discovery.ts";
import {
  FileLiveThreadUpdateStore,
  type LiveThreadUpdate,
  type LiveThreadUpdateJournal,
  overlayLiveThreadUpdates,
} from "../../src/adapters/shared/stores/live-thread-update-store.ts";
import type {
  GenericArchitectureCaptureReader,
} from "../../src/adapters/architecture/renderer/product-structure-catalog.ts";
import type { GenericGeometryCaptureReader } from "../../src/adapters/cad/canonical/geometry-bundle-product-catalog.ts";
import type { ProjectCapabilityWorkbenchReader } from "../../src/application/control-plane/project-capability-workbench.ts";
import {
  createLocalCapabilityRuntimeReadComposition,
  type LocalCapabilityRuntimeReadCompositionOptions,
} from "../../src/adapters/control-plane/local-capability-runtime-read-composition.ts";
import { DEFAULT_PROJECT_CAPABILITY_LEDGER_DIRECTORY } from "../../src/adapters/control-plane/file-project-capability-ledger-store.ts";

export interface NativeWorkbenchHandlerOptions {
  store: ThreadSnapshotStore;
  /** Read-side capability only; project commands stay in the paired MCP. */
  projectStore:
    & Pick<EngineeringProjectRevisionStore, "get">
    & Partial<Pick<EngineeringProjectRevisionStore, "getRevision">>;
  /** EngineeringProject identity; never inferred from a thread subject. */
  projectId?: string;
  /** Agent-selected durable target. The BFF reads it, never mutates it. */
  cockpitFocus?: CockpitFocusStore;
  workspaceId?: string;
  /** Active store plus optional exact, versioned project baselines. */
  projectSnapshots?: ExactThreadSnapshotReader;
  /** Optional for a focused workspace whose durable focus supplies the project. */
  subjectId?: string;
  html?: string;
  /** When set, each GET re-reads the cockpit HTML so a rebuild is visible. */
  htmlPath?: string;
  /**
   * Directory of the Vite multi-file dist (`native-workbench.html` + hashed
   * JS/CSS). Defaults to the directory of `htmlPath`. The browser never
   * receives a command route through these files.
   */
  uiAssetDirectory?: string;
  /** Backend-only admission reader for the separate product-navigation query. */
  technicalCompilationAdmissions?: ProductNavigationTechnicalAdmissionReader;
  /** Exact workspace recross for product-navigation source attachments. */
  projectSourceWorkspace?:
    ProductNavigationTechnicalAdmissionSourceDependencies["workspace"];
  /** Optional exact CAS reopen of versioned requirements captures. */
  requirementsCaptures?: RequirementsCaptureReader;
  /**
   * Optional extra CAS reopen for historical study/case/base-evaluation
   * captures. Composed with requirementsCaptures only on the history path.
   */
  historyEvidenceCaptures?: RequirementsCaptureReader;
  /** Read-only store for independently versioned documentary correspondence claims. */
  requirementsBriefTraceCaptures?: RequirementsCaptureReader;
  /**
   * Same project-response use case as MCP. Workbench calls `.project` on the
   * already-resolved GET/SSE snapshots and never selects a newer tip.
   */
  projectResponse?: ProjectResponseUseCase;
  /**
   * Optional exact architecture-capture/4.0 reopen for the standalone
   * product-navigation GET query. Same application port as MCP read tools.
   */
  productStructureCaptures?: GenericArchitectureCaptureReader;
  geometryCaptures?: GenericGeometryCaptureReader;
  sysmlSourceAnalysis?: SysmlSourceAnalysisReader;
  /** Optional exact CAS reopen of supported sealed engineering cases. */
  engineeringCaseCaptures?: EngineeringCaseWorkbenchEnricherDependencies;
  /** Optional non-canonical activity journal projected into the same feed. */
  liveUpdates?: LiveThreadUpdateJournal;
  /**
   * Exact whole-App viewer registrations. They cannot choose a browser route.
   * No binding means no App session.
   */
  viewerAppBindings?: readonly ThreadViewerAppBinding[];
  /**
   * Optional gateway attesting the exact manifest/resource HTML behind a
   * same-origin launch route. No resolver means no App session is projected.
   */
  viewerAppLaunchResolver?: ThreadViewerAppLaunchResolver;
  /** Production file registry; when present it is authoritative over test seams. */
  viewerAppRegistry?: ThreadViewerAppRegistryReader;
  assetReader?: (filename: string) => Promise<Uint8Array | undefined>;
  /** Polling only observes persisted snapshots; it never executes a tool. */
  pollIntervalMs?: number;
  /**
   * Declared fleet topology for GET `/api/fleet`. Identity fields only;
   * missing or unreadable manifests resolve to 404 so the cockpit degrades
   * to thread-observed systems. Never live health.
   */
  cockpitFleet?: () => Promise<CockpitFleetProjection | undefined>;
  /**
   * Sanitized persisted-project index for an unfocused Desktop workspace.
   * This is a read-only navigation projection, never a focus mutation.
   */
  projectCatalog?: () => Promise<NativeWorkbenchProjectCatalog>;
  /**
   * Explicit v2 discovery projection. One invalid head stays an unavailable
   * placeholder instead of hiding the rest of the root. Never a command.
   */
  projectDiscovery?: () => Promise<NativeWorkbenchProjectDiscovery>;
  /**
   * Redacted operational-capability projection. The native Workbench may
   * observe it but never creates a runtime plan or host mutation.
   */
  capabilityWorkbench?: ProjectCapabilityWorkbenchReader;
}

export interface NativeWorkbenchProjectCatalogItem {
  readonly id: string;
  readonly name: string;
  readonly revision: number;
  readonly subjectId: string;
}

export type NativeWorkbenchProjectCatalog =
  | {
    readonly schemaVersion: "native-workbench-project-catalog/1.0";
    readonly state: "available";
    readonly projects: readonly NativeWorkbenchProjectCatalogItem[];
  }
  | {
    readonly schemaVersion: "native-workbench-project-catalog/1.0";
    readonly state: "unavailable";
    readonly projects: readonly [];
    readonly reason: string;
  };

/**
 * Reopen the latest validated revision for every persisted project directory.
 *
 * Discovery is deliberately fail-closed: a malformed identity or a project
 * directory without an exactly reopenable head makes the whole navigation
 * projection unavailable instead of returning a misleading partial list.
 */
export async function readPersistedProjectCatalog(
  store: Pick<EngineeringProjectRevisionStore, "get">,
  directory: string,
): Promise<NativeWorkbenchProjectCatalog> {
  try {
    const projects: NativeWorkbenchProjectCatalogItem[] = [];
    try {
      for await (const entry of Deno.readDir(directory)) {
        if (!entry.isDirectory || entry.isSymlink) continue;
        let projectId: string;
        try {
          projectId = decodeURIComponent(entry.name);
        } catch {
          throw new Error("A persisted project directory has an invalid identity.");
        }
        const project = await store.get(projectId);
        if (!project) {
          throw new Error(`Persisted project ${projectId} has no published revision.`);
        }
        projects.push({
          id: project.project.id,
          name: project.project.name,
          revision: project.revision,
          subjectId: project.project.subjectId,
        });
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    projects.sort((left, right) =>
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
    );
    return Object.freeze({
      schemaVersion: "native-workbench-project-catalog/1.0",
      state: "available",
      projects: Object.freeze(projects),
    });
  } catch {
    return Object.freeze({
      schemaVersion: "native-workbench-project-catalog/1.0",
      state: "unavailable",
      projects: [] as const,
      reason: "Persisted project revisions could not be reopened exactly.",
    });
  }
}

/**
 * A caller that names a project does not also have to know the project's
 * internal thread-subject identity.
 */
export function resolveNativeWorkbenchProjectId(
  explicitProjectId: string | undefined,
  _explicitSubjectId: string | undefined,
): string | undefined {
  return explicitProjectId;
}

export interface NativeWorkbenchStartupTarget {
  readonly hostname: string;
  readonly port: number;
  /** Kept for CLI compatibility; the native Workbench is always read-only. */
  readonly noSeed: true;
  readonly workspaceId?: string;
  readonly projectId?: string;
  readonly explicitSubjectId?: string;
}

/** Read-only factory boundary: it exposes only the BFF projection, never a mutator. */
export type NativeWorkbenchCapabilityReadCompositionFactory = (
  options: Pick<
    LocalCapabilityRuntimeReadCompositionOptions,
    "ledgerDirectory"
  >,
) => Promise<{ readonly workbench: ProjectCapabilityWorkbenchReader }>;

/**
 * The BFF must read the same local authorization ledger as its paired MCP.
 * This path changes where immutable operational authority is read, never which
 * binding or provider is selected.
 */
export async function createNativeWorkbenchCapabilityWorkbench(
  cliArgs: Readonly<Record<string, string | undefined>>,
  createComposition: NativeWorkbenchCapabilityReadCompositionFactory =
    createLocalCapabilityRuntimeReadComposition,
): Promise<ProjectCapabilityWorkbenchReader> {
  return (await createComposition({
    ledgerDirectory: cliArgs["project-capability-ledger-dir"] ??
      DEFAULT_PROJECT_CAPABILITY_LEDGER_DIRECTORY,
  })).workbench;
}

/**
 * Resolve the BFF's startup target without touching project state.
 *
 * The Workbench is read-only. It requires an explicit fixed target or a
 * durable cockpit focus; it never substitutes a bootstrap project or seeds a
 * project revision.
 */
export function resolveNativeWorkbenchStartupTarget(
  cliArgs: Readonly<Record<string, string | undefined>>,
): NativeWorkbenchStartupTarget {
  const hostname = cliArgs["host"] ?? "127.0.0.1";
  if (!isExplicitLoopbackHostname(hostname)) {
    throw new TypeError(
      "--host must be an explicit loopback hostname (127.0.0.1, localhost, or ::1).",
    );
  }
  // Preserve strict validation of the legacy flag while keeping startup
  // read-only regardless of whether callers include it.
  booleanFlag("no-seed", cliArgs);
  const explicitWorkspaceId = cliArgs["workspace-id"];
  const explicitProjectId = cliArgs["project-id"];
  const explicitSubjectId = cliArgs["subject"];
  if (explicitSubjectId !== undefined && explicitProjectId === undefined) {
    throw new TypeError("--subject requires --project-id.");
  }
  if (
    explicitWorkspaceId === undefined && explicitProjectId === undefined
  ) {
    throw new TypeError(
      "--workspace-id or --project-id is required; no bootstrap project is configured.",
    );
  }
  const projectId = resolveNativeWorkbenchProjectId(
    explicitProjectId,
    explicitSubjectId,
  );
  // An explicit pin disables cockpit-focus follow. Keeping --workspace-id
  // would attach durable focus and silently serve that other project.
  return {
    hostname,
    port: integerArgument("port", cliArgs) ?? 5175,
    noSeed: true,
    workspaceId: projectId === undefined ? explicitWorkspaceId : undefined,
    projectId,
    explicitSubjectId,
  };
}

type ResolvedActiveProject = {
  readonly kind: "project";
  readonly projectId: string;
  readonly project: EngineeringProjectSnapshot;
  readonly subjectId: string;
};

type ActiveTargetResolution = ResolvedActiveProject;

async function resolveActiveProject(
  options: NativeWorkbenchHandlerOptions,
): Promise<ActiveTargetResolution> {
  const pinnedProjectId = options.projectId;
  const focus = pinnedProjectId === undefined
    ? await options.cockpitFocus?.get(options.workspaceId ?? "primary")
    : undefined;
  const projectId = pinnedProjectId ??
    focus?.target.projectId ??
    configuredProjectId(options);
  const project = await options.projectStore.get(projectId);
  if (!project) throw new NativeWorkbenchProjectNotFoundError(projectId);
  const subjectId = pinnedProjectId === undefined && focus
    ? project.project.subjectId
    : options.subjectId ?? project.project.subjectId;
  if (project.project.subjectId !== subjectId) {
    throw new Error(
      `Engineering project subject ${project.project.subjectId} does not match resolved Workbench subject ${subjectId}.`,
    );
  }
  return {
    kind: "project",
    projectId,
    project,
    subjectId,
  };
}

class NativeWorkbenchProjectNotFoundError extends Error {
  constructor(readonly projectId: string) {
    super(`Engineering project ${projectId} was not found.`);
    this.name = "NativeWorkbenchProjectNotFoundError";
  }
}

/**
 * An explicitly supplied subject remains an operator override. Otherwise the
 * persisted project is authoritative and supplies its own durable subject id.
 */
export async function resolveNativeWorkbenchSubjectId(
  projectId: string,
  explicitSubjectId: string | undefined,
  projectStore: Pick<EngineeringProjectRevisionStore, "get">,
): Promise<string> {
  if (explicitSubjectId !== undefined) return explicitSubjectId;
  const project = await projectStore.get(projectId);
  if (!project) {
    throw new Error(
      `Engineering project ${projectId} was not found while resolving its Workbench subject.`,
    );
  }
  return project.project.subjectId;
}

export function createNativeWorkbenchHandler(
  options: NativeWorkbenchHandlerOptions,
): (request: Request) => Promise<Response> {
  const navigation = composeProductNavigation(options);
  const viewerSessionsSequencer = new ThreadViewerSessionsSequencer();
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      if (request.method !== "GET") return methodNotAllowed();
      return json({ status: "ok", service: "native-workbench" }, 200);
    }
    if (url.pathname.startsWith("/api/thread/assets/")) {
      if (request.method !== "GET") return methodNotAllowed();
      return serveThreadAsset(url.pathname, options.assetReader);
    }
    if (url.pathname.startsWith("/api/thread/viewer-apps/")) {
      if (request.method !== "GET") return methodNotAllowed();
      return options.viewerAppRegistry
        ? await options.viewerAppRegistry.serve(url.pathname)
        : new Response("Not found", { status: 404 });
    }
    if (url.pathname === "/api/fleet") {
      if (request.method !== "GET") return methodNotAllowed();
      return await serveCockpitFleet(options);
    }
    if (url.pathname === "/api/projects") {
      if (request.method !== "GET") return methodNotAllowed();
      return await serveProjectCatalog(options);
    }
    if (url.pathname === "/api/project-discovery") {
      if (request.method !== "GET") return methodNotAllowed();
      return await serveProjectDiscovery(options);
    }
    if (url.pathname === "/api/project/capabilities") {
      if (request.method !== "GET") return methodNotAllowed();
      return await serveProjectCapabilityWorkbench(options);
    }
    if (url.pathname === "/api/thread/product-navigation") {
      if (request.method !== "GET") return methodNotAllowed();
      return await serveProductNavigationQuery(url, options, navigation);
    }
    if (url.pathname === "/api/thread/viewer-sessions/events") {
      if (request.method !== "GET") return methodNotAllowed();
      return await viewerSessionsEventStream(
        request,
        options,
        viewerSessionsSequencer,
      );
    }
    if (url.pathname === "/api/thread/viewer-sessions") {
      if (request.method !== "GET") return methodNotAllowed();
      let context: ActiveTargetResolution;
      try {
        context = await resolveActiveProject(options);
      } catch (error) {
        if (error instanceof NativeWorkbenchProjectNotFoundError) {
          return projectNotFound(error.projectId);
        }
        throw error;
      }
      const snapshot = await resolveCurrentThreadSnapshot(
        context.project,
        options,
        context.subjectId,
      );
      if (!snapshot && context.project.threadSnapshots.length > 0) {
        return json({
          error: "thread_snapshot_not_found",
          subjectId: context.subjectId,
        }, 404);
      }
      return json(
        await projectViewerSessions(
          context,
          snapshot,
          options,
          undefined,
          viewerSessionsSequencer,
        ),
        200,
      );
    }
    if (url.pathname === "/api/thread/workbench/events") {
      if (request.method !== "GET") return methodNotAllowed();
      return await snapshotEventStream(request, options);
    }
    if (url.pathname === "/api/thread/workbench") {
      if (request.method !== "GET") return methodNotAllowed();
      let context: ActiveTargetResolution;
      try {
        context = await resolveActiveProject(options);
      } catch (error) {
        if (error instanceof NativeWorkbenchProjectNotFoundError) {
          return projectNotFound(error.projectId);
        }
        throw error;
      }
      const snapshot = await resolveCurrentThreadSnapshot(
        context.project,
        options,
        context.subjectId,
      );
      if (!snapshot && context.project.threadSnapshots.length > 0) {
        return json({
          error: "thread_snapshot_not_found",
          subjectId: context.subjectId,
        }, 404);
      }
      const projection = await projectWorkbenchSnapshot(
        context.project,
        snapshot,
        options,
        context.subjectId,
        undefined,
      );
      return json(
        projection,
        200,
        {
          "X-Casys-Data-Source": workbenchDataSource(projection),
        },
      );
    }
    if (url.pathname === "/" || url.pathname === "/native-workbench.html") {
      if (request.method !== "GET") return methodNotAllowed();
      const html = options.htmlPath
        ? await Deno.readTextFile(options.htmlPath)
        : options.html ?? "";
      const appScriptNonce = createMcpAppScriptNonce();
      return new Response(
        injectMcpAppScriptNonce(html, appScriptNonce),
        {
          headers: workbenchDocumentHeaders(
            { "Content-Type": "text/html; charset=utf-8" },
            appScriptNonce,
          ),
        },
      );
    }
    if (request.method === "GET") {
      const asset = await serveWorkbenchUiAsset(url.pathname, options);
      if (asset) return asset;
    }
    return new Response("Not found", { status: 404 });
  };
}

async function snapshotEventStream(
  request: Request,
  options: NativeWorkbenchHandlerOptions,
): Promise<Response> {
  let initial: ActiveTargetResolution;
  try {
    initial = await resolveActiveProject(options);
  } catch (error) {
    if (error instanceof NativeWorkbenchProjectNotFoundError) {
      return projectNotFound(error.projectId);
    }
    throw error;
  }
  let current = initial;
  const encoder = new TextEncoder();
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  let lastEventId = request.headers.get("Last-Event-ID") ?? "";
  let cancelled = false;
  let lastWrite = Date.now();

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const run = async () => {
        // Deno.serve's legacy request signal aborts after a successful handler
        // return, even while a streaming response is still open. Stream
        // cancellation is the reliable browser-disconnect signal here.
        while (!cancelled) {
          let latestProject: ActiveTargetResolution;
          try {
            latestProject = await resolveActiveProject(options);
          } catch (error) {
            if (!(error instanceof NativeWorkbenchProjectNotFoundError)) {
              throw error;
            }
            await waitForPoll(pollIntervalMs);
            continue;
          }
          if (latestProject.projectId !== current.projectId) {
            const targetId = `focus:project:${latestProject.projectId}`;
            if (targetId !== lastEventId) {
              controller.enqueue(encoder.encode(
                `id: ${targetId}\nevent: cockpit-focus\ndata: ${
                  JSON.stringify({ target: publicFocusTarget(latestProject) })
                }\n\n`,
              ));
              lastEventId = targetId;
              lastWrite = Date.now();
            }
            current = latestProject;
            await waitForPoll(pollIntervalMs);
            continue;
          }
          const liveUpdates = await options.liveUpdates?.list(current.subjectId) ?? [];
          // A manifest removed during an established stream cannot revoke the
          // last valid event. A reconnect will receive an explicit 404.
          current = latestProject;
          const snapshot = await resolveCurrentThreadSnapshot(
            current.project,
            options,
            current.subjectId,
          );
          const liveVersion = liveUpdates.at(-1)?.sequence ?? 0;
          const workspaceIdentity = await currentProjectSourceWorkspaceHeadIdentity(
            current.projectId,
            options,
          );
          const focusPrefix = options.cockpitFocus ? `${current.projectId}:` : "";
          const eventId = snapshot
            ? `${focusPrefix}${current.project.revision}:${snapshot.revision}:${liveVersion}:${workspaceIdentity}`
            : `planning:${focusPrefix}${current.project.revision}:${liveVersion}:${workspaceIdentity}`;
          if (eventId !== lastEventId) {
            const projection = await projectWorkbenchSnapshot(
              current.project,
              snapshot,
              options,
              current.subjectId,
              liveUpdates,
            );
            controller.enqueue(encoder.encode(
              `id: ${eventId}\nevent: workbench-snapshot\ndata: ${
                JSON.stringify(projection)
              }\n\n`,
            ));
            lastEventId = eventId;
            lastWrite = Date.now();
          } else if (Date.now() - lastWrite >= 15_000) {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
            lastWrite = Date.now();
          }
          await waitForPoll(pollIntervalMs);
        }
      };
      void run().then(() => {
        try {
          controller.close();
        } catch {
          // The browser may have cancelled the stream first.
        }
      }).catch((error) => {
        try {
          controller.error(error);
        } catch {
          // The browser may have cancelled the stream first.
        }
      });
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(body, {
    headers: workbenchReadHeaders({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    }),
  });
}

async function viewerSessionsEventStream(
  request: Request,
  options: NativeWorkbenchHandlerOptions,
  sequencer: ThreadViewerSessionsSequencer,
): Promise<Response> {
  let initial: ActiveTargetResolution;
  try {
    initial = await resolveActiveProject(options);
  } catch (error) {
    if (error instanceof NativeWorkbenchProjectNotFoundError) {
      return projectNotFound(error.projectId);
    }
    throw error;
  }
  const initialSnapshot = await resolveCurrentThreadSnapshot(
    initial.project,
    options,
    initial.subjectId,
  );
  if (!initialSnapshot && initial.project.threadSnapshots.length > 0) {
    return json({
      error: "thread_snapshot_not_found",
      subjectId: initial.subjectId,
    }, 404);
  }
  let current = initial;
  const encoder = new TextEncoder();
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  let lastEventId = request.headers.get("Last-Event-ID") ?? "";
  let cancelled = false;
  let lastWrite = Date.now();

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const run = async () => {
        while (!cancelled) {
          let latestProject: ActiveTargetResolution;
          try {
            latestProject = await resolveActiveProject(options);
          } catch (error) {
            if (!(error instanceof NativeWorkbenchProjectNotFoundError)) {
              throw error;
            }
            await waitForPoll(pollIntervalMs);
            continue;
          }
          if (latestProject.projectId !== current.projectId) {
            const targetId = `focus:project:${latestProject.projectId}`;
            if (targetId !== lastEventId) {
              controller.enqueue(encoder.encode(
                `id: ${targetId}\nevent: cockpit-focus\ndata: ${
                  JSON.stringify({ target: publicFocusTarget(latestProject) })
                }\n\n`,
              ));
              lastEventId = targetId;
              lastWrite = Date.now();
            }
            current = latestProject;
            await waitForPoll(pollIntervalMs);
            continue;
          }
          current = latestProject;
          const snapshot = await resolveCurrentThreadSnapshot(
            current.project,
            options,
            current.subjectId,
          );
          if (!snapshot && current.project.threadSnapshots.length > 0) {
            throw new Error(
              "A declared technical baseline could not be resolved for viewer sessions.",
            );
          }
          const liveUpdates = await options.liveUpdates?.list(current.subjectId) ?? [];
          const projection = await projectViewerSessions(
            current,
            snapshot,
            options,
            liveUpdates,
            sequencer,
          );
          const eventId =
            `viewer-sessions:${current.projectId}:${projection.sequence}:${projection.projectionFingerprint}`;
          if (eventId !== lastEventId) {
            controller.enqueue(encoder.encode(
              `id: ${eventId}\nevent: viewer-sessions\ndata: ${
                JSON.stringify(projection)
              }\n\n`,
            ));
            lastEventId = eventId;
            lastWrite = Date.now();
          } else if (Date.now() - lastWrite >= 15_000) {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
            lastWrite = Date.now();
          }
          await waitForPoll(pollIntervalMs);
        }
      };
      void run().then(() => {
        try {
          controller.close();
        } catch {
          // The browser may have cancelled the stream first.
        }
      }).catch((error) => {
        try {
          controller.error(error);
        } catch {
          // The browser may have cancelled the stream first.
        }
      });
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(body, {
    headers: workbenchReadHeaders({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    }),
  });
}

async function projectViewerSessions(
  context: ActiveTargetResolution,
  snapshot: ThreadSnapshot | undefined,
  options: NativeWorkbenchHandlerOptions,
  liveUpdates?: LiveThreadUpdate[],
  sequencer?: ThreadViewerSessionsSequencer,
) {
  const project = async () => {
    const thread = snapshot
      ? await projectThreadSnapshot(
        snapshot,
        options,
        context.projectId,
        context.subjectId,
        liveUpdates,
      )
      : undefined;
    const registrySnapshot = await options.viewerAppRegistry?.read();
    const projection = await projectThreadViewerSessions(
      {
        projectId: context.projectId,
        projectRevision: context.project.revision,
        subjectId: context.subjectId,
        sequence: thread?.live.version ?? context.project.revision,
        ...(snapshot
          ? { thread: { id: snapshot.id, revision: snapshot.revision } }
          : {}),
        projectReviewAnchors: projectViewerReviewAnchors(context.project),
      },
      thread,
      options.viewerAppRegistry
        ? registrySnapshot?.bindings ?? []
        : options.viewerAppBindings ?? [],
      options.viewerAppRegistry
        ? registrySnapshot?.launchResolver
        : options.viewerAppLaunchResolver,
    );
    if (!snapshot || !options.productStructureCaptures || !options.geometryCaptures) {
      return projection;
    }
    const hierarchy = await projectThreadViewerHierarchy({
      snapshot,
      basis: projection.basis,
      sessions: projection.sessions,
      architectureCaptures: options.productStructureCaptures,
      geometryCaptures: options.geometryCaptures,
      sysmlSourceAnalysis: options.sysmlSourceAnalysis,
    });
    const { projectionFingerprint: _priorFingerprint, ...base } = projection;
    const withHierarchy = { ...base, hierarchy };
    const fingerprint = await sha256Fingerprint(withHierarchy);
    return { ...withHierarchy, projectionFingerprint: `sha256:${fingerprint.digest}` };
  };
  return sequencer ? await sequencer.project(project) : await project();
}

interface ThreadViewerProjectionSequenceState {
  readonly sourceSequence: number;
  readonly sourceFingerprint: string;
  readonly projection: ThreadViewerSessionsProjection;
}

/**
 * Owns a monotonic viewer-projection clock per exact basis. Resolver
 * attestation changes are observable even when Project/Thread revisions do
 * not move; regressing source reads are ignored.
 */
export class ThreadViewerSessionsSequencer {
  readonly #states = new Map<string, ThreadViewerProjectionSequenceState>();
  #tail: Promise<void> = Promise.resolve();

  admit(
    candidate: ThreadViewerSessionsProjection,
  ): Promise<ThreadViewerSessionsProjection> {
    const result = this.#tail.then(() => this.#admit(candidate));
    this.#tail = result.then(() => undefined, () => undefined);
    return result;
  }

  /**
   * Sequence the complete registry-read/resolver/projector factory. Queuing
   * only its completed candidate lets an older slow resolver finish after a
   * revocation and falsely resurrect the old App as a newer replacement.
   */
  project(
    factory: () => Promise<ThreadViewerSessionsProjection>,
  ): Promise<ThreadViewerSessionsProjection> {
    const result = this.#tail.then(async () => this.#admit(await factory()));
    this.#tail = result.then(() => undefined, () => undefined);
    return result;
  }

  async #admit(
    candidate: ThreadViewerSessionsProjection,
  ): Promise<ThreadViewerSessionsProjection> {
    const key = viewerProjectionBasisKey(candidate);
    const previous = this.#states.get(key);
    if (previous && candidate.sequence < previous.sourceSequence) {
      return previous.projection;
    }
    if (
      previous && candidate.sequence === previous.sourceSequence &&
      candidate.projectionFingerprint === previous.sourceFingerprint
    ) return previous.projection;

    const sequence = previous
      ? Math.max(candidate.sequence, previous.projection.sequence + 1)
      : candidate.sequence;
    const body = {
      schemaVersion: candidate.schemaVersion,
      basis: candidate.basis,
      sequence,
      sessions: candidate.sessions,
      ...(candidate.hierarchy === undefined ? {} : { hierarchy: candidate.hierarchy }),
    };
    const fingerprint = await sha256Fingerprint(body);
    const projection: ThreadViewerSessionsProjection = {
      ...body,
      projectionFingerprint: `${fingerprint.algorithm}:${fingerprint.digest}`,
    };
    this.#states.set(key, {
      sourceSequence: candidate.sequence,
      sourceFingerprint: candidate.projectionFingerprint,
      projection,
    });
    return projection;
  }
}

function viewerProjectionBasisKey(
  projection: ThreadViewerSessionsProjection,
): string {
  const { basis } = projection;
  return `${basis.projectId}\u0000${basis.projectRevision}\u0000${basis.subjectId}\u0000${
    basis.thread?.id ?? ""
  }\u0000${basis.thread?.revision ?? ""}`;
}

/** Exact pre-MRTR anchors only; payloads remain App-owned registry data. */
export function projectViewerReviewAnchors(
  project: EngineeringProjectSnapshot,
): readonly ThreadViewerProjectReviewAnchor[] {
  const anchors = new Map<string, ThreadViewerProjectReviewAnchor>();
  const briefReview = project.framing?.proposalReview;
  if (briefReview?.status === "pending") {
    const anchor = projectReviewAnchor(
      briefReview.briefSnapshotId,
      project.revision,
      briefReview.inputFingerprint,
    );
    anchors.set(projectReviewAnchorIdentity(anchor), anchor);
  }

  const supportedOperations = new Set<string>([
    MODEL_WRITE_ARCHITECTURE_OPERATION.id,
    MODEL_WRITE_REQUIREMENTS_OPERATION.id,
    DESIGN_WRITE_GEOMETRY_OPERATION.id,
  ]);
  const reviewDecisionIds = new Set(
    project.workItems.flatMap((item) =>
      item.operation && supportedOperations.has(item.operation.id)
        ? [...item.decisionIds]
        : []
    ),
  );
  for (const decision of project.decisions) {
    if (
      decision.status !== "proposed" || !decision.inputFingerprint ||
      !reviewDecisionIds.has(decision.id)
    ) continue;
    const anchor = projectReviewAnchor(
      decision.id,
      project.revision,
      decision.inputFingerprint,
    );
    anchors.set(projectReviewAnchorIdentity(anchor), anchor);
  }
  return [...anchors.values()].toSorted((left, right) =>
    left.id.localeCompare(right.id)
  );
}

function projectReviewAnchor(
  id: string,
  revision: number,
  fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
): ThreadViewerProjectReviewAnchor {
  return {
    kind: "project-review",
    id,
    revision,
    fingerprint: `${fingerprint.algorithm}:${fingerprint.digest}`,
  };
}

function projectReviewAnchorIdentity(
  anchor: ThreadViewerProjectReviewAnchor,
): string {
  return `${anchor.id}:${anchor.revision}:${anchor.fingerprint}`;
}

async function currentProjectSourceWorkspaceHeadIdentity(
  projectId: string,
  options: NativeWorkbenchHandlerOptions,
): Promise<string> {
  if (!options.projectSourceWorkspace) return "workspace:none";
  const workspace = await options.projectSourceWorkspace.load(projectId);
  const fingerprint = workspace.lastEventFingerprint;
  return fingerprint
    ? `workspace:${workspace.workspaceRevision}:${fingerprint.algorithm}:${fingerprint.digest}`
    : `workspace:${workspace.workspaceRevision}:empty`;
}

async function projectWorkbenchSnapshot(
  project: EngineeringProjectSnapshot,
  snapshot: ThreadSnapshot | undefined,
  options: NativeWorkbenchHandlerOptions,
  subjectId: string,
  liveUpdates?: LiveThreadUpdate[],
): Promise<EngineeringWorkbenchSnapshot> {
  if (!snapshot) {
    if (project.threadSnapshots.length > 0) {
      throw new Error(
        "A declared technical baseline could not be resolved for this project.",
      );
    }
    if (project.project.subjectId !== subjectId) {
      throw new Error(
        `Engineering project subject ${project.project.subjectId} does not match resolved Workbench subject ${subjectId}.`,
      );
    }
    return projectEngineeringPlanningWorkbenchSnapshot(
      project,
      liveUpdates ?? (await options.liveUpdates?.list(subjectId) ?? []),
    );
  }
  const declaredSnapshots = await Promise.all(
    project.threadSnapshots.map((reference) =>
      reference.snapshotId === snapshot.id &&
        reference.revision === snapshot.revision
        ? Promise.resolve(snapshot)
        : (options.projectSnapshots ?? options.store).get(reference.snapshotId)
    ),
  );
  // Structural corruption stays fail-fast, but a dangling evidence link (for
  // example a decision left behind by an abandoned work item) must not hide
  // the whole read-only projection: label it on the snapshot instead.
  const validatedProject = validateEngineeringProjectSnapshot(project);
  const unresolvedEvidenceReferences = collectEngineeringProjectThreadReferenceIssues(
    validatedProject,
    declaredSnapshots.filter(
      (candidate): candidate is ThreadSnapshot => candidate !== undefined,
    ),
  ).map((issue) => ({ path: issue.path, message: issue.message }));
  const updates = liveUpdates ??
    (await options.liveUpdates?.list(subjectId) ?? []);
  const projected = projectEngineeringWorkbenchSnapshot(
    validatedProject,
    await projectThreadSnapshot(
      snapshot,
      options,
      validatedProject.project.id,
      subjectId,
      updates,
    ),
    snapshot.revision,
    updates,
    unresolvedEvidenceReferences,
    REGISTERED_ENGINEERING_OPERATION_PATH_LANE_RESOLVER,
  );
  if (projected.surface !== "evidence") return projected;
  const withTraces = options.requirementsCaptures && options.projectStore.getRevision
    ? await enrichEngineeringEvidenceWorkbenchWithRequirementsBriefTraces(
      projected,
      {
        sourceThread: snapshot,
        projects: {
          getRevision: options.projectStore.getRevision.bind(
            options.projectStore,
          ),
        },
        captures: options.requirementsCaptures,
        ...(options.requirementsBriefTraceCaptures
          ? {
            claimHistory: {
              projects: {
                get: options.projectStore.get.bind(options.projectStore),
                getRevision: options.projectStore.getRevision.bind(
                  options.projectStore,
                ),
              },
              snapshots: options.projectSnapshots ?? options.store,
              captures: options.requirementsCaptures,
              traces: options.requirementsBriefTraceCaptures,
            },
          }
          : {}),
      },
    )
    : projected;
  return await enrichEngineeringEvidenceWorkbenchWithProjectResponse(
    withTraces,
    snapshot,
    options,
  );
}

async function enrichEngineeringEvidenceWorkbenchWithProjectResponse(
  projected: Extract<EngineeringWorkbenchSnapshot, { surface: "evidence" }>,
  snapshot: ThreadSnapshot,
  options: NativeWorkbenchHandlerOptions,
): Promise<Extract<EngineeringWorkbenchSnapshot, { surface: "evidence" }>> {
  if (!options.projectResponse) return projected;
  const response = await options.projectResponse.project({
    project: projected.project,
    thread: snapshot,
  });
  return { ...projected, response };
}

async function resolveDeclaredProjectHead(
  project: EngineeringProjectSnapshot,
  options: NativeWorkbenchHandlerOptions,
): Promise<ThreadSnapshot | undefined> {
  const reference =
    [...project.threadSnapshots].sort((left, right) =>
      right.revision - left.revision ||
      right.snapshotId.localeCompare(left.snapshotId)
    )[0];
  if (!reference) return undefined;
  const snapshot = await (options.projectSnapshots ?? options.store).get(
    reference.snapshotId,
  );
  if (
    snapshot &&
    (snapshot.id !== reference.snapshotId ||
      snapshot.revision !== reference.revision ||
      snapshot.subject.id !== reference.subjectId)
  ) {
    throw new Error(
      `Declared ThreadSnapshot ${reference.snapshotId}@${reference.revision} resolved to a different snapshot.`,
    );
  }
  return snapshot;
}

async function resolveCurrentThreadSnapshot(
  project: EngineeringProjectSnapshot,
  options: NativeWorkbenchHandlerOptions,
  subjectId: string,
): Promise<ThreadSnapshot | undefined> {
  // Before the first deterministic operation publishes a declared baseline,
  // an intent-only project is not allowed to borrow a current subject head.
  if (project.threadSnapshots.length === 0) return undefined;
  const [active, declared] = await Promise.all([
    options.store.latest(subjectId),
    resolveDeclaredProjectHead(project, options),
  ]);
  if (!active) return declared;
  if (!declared) return active;
  if (active.revision === declared.revision && active.id !== declared.id) {
    throw new Error(
      `Ambiguous ThreadSnapshot revision ${active.revision}: active ${active.id} conflicts with declared ${declared.id}.`,
    );
  }
  if (active.revision <= declared.revision) return declared;
  // A known durable-writer operation can make a next ThreadSnapshot durable before
  // completeRun attaches that exact reference to the project. A crash in that
  // narrow interval must not let an undeclared descendant become canonical in
  // the browser. Keep the declared head on screen; projectWorkbenchSnapshot
  // still overlays the bounded live journal onto it. The durable result
  // becomes eligible only after completeRun records its exact reference in
  // immutable project state.
  if (hasUnattachedDurableProjectOperation(project)) return declared;
  const lineageSnapshots = new OrderedExactThreadSnapshotReader([
    options.store,
    ...(options.projectSnapshots ? [options.projectSnapshots] : []),
  ]);
  return await threadSnapshotDescendsFrom(
      active,
      declared,
      lineageSnapshots,
    )
    ? active
    : declared;
}

/**
 * These exact server-owned operations persist a Thread successor before
 * completeRun attaches its reference to immutable project state. A
 * forward head is therefore not browser-canonical while one is still active.
 * Additions are intentionally explicit: a registered operation alone does
 * not establish this persistence ordering.
 */
const DURABLE_BEFORE_PROJECT_ATTACHMENT_OPERATIONS = [
  SYSON_MODEL_SEED_OPERATION,
  MODEL_WRITE_ARCHITECTURE_OPERATION,
  MODEL_WRITE_REQUIREMENTS_OPERATION,
  MODEL_WRITE_TRACED_REQUIREMENTS_OPERATION,
  MODEL_RECAPTURE_REQUIREMENTS_OPERATION,
  MODEL_RECAPTURE_TRACED_REQUIREMENTS_OPERATION,
  RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION,
  RECORD_DOCUMENTARY_CLAUSE_RESPONSE_OPERATION,
  RECORD_SEAL_PRE_SIZING_WORKSHEET_OPERATION,
  DESIGN_WRITE_GEOMETRY_OPERATION,
  VERIFY_SEAL_PROOF_CASE_OPERATION,
  VERIFY_RUN_FEA_STATIC_PROOF_OPERATION,
  COMPILE_SEAL_ADMISSION_OPERATION,
  DESIGN_EXECUTE_BUILD123D_OPERATION,
  VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION,
  SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
  SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
  VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
  ARCHIVE_LINEAGE_OPERATION,
  ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
  ANALYZE_RUN_FEA_SENSITIVITY_OPERATION,
  MODEL_WRITE_SENSITIVITY_EDGES_OPERATION,
  DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION,
  DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION,
] as const;

function hasUnattachedDurableProjectOperation(
  project: EngineeringProjectSnapshot,
): boolean {
  const workItems = new Map(project.workItems.map((item) => [item.id, item]));
  return project.agentRuns.some((run) => {
    if (!isAwaitingDurableProjectAttachment(run.status)) {
      return false;
    }
    const operation = workItems.get(run.workItemId)?.operation;
    return DURABLE_BEFORE_PROJECT_ATTACHMENT_OPERATIONS.some((candidate) =>
      operation?.id === candidate.id && operation.version === candidate.version
    );
  });
}

/** Test seam for the explicit durable-writer allowlist used by the browser. */
export function hasUnattachedDurableProjectOperationForTest(
  project: EngineeringProjectSnapshot,
): boolean {
  return hasUnattachedDurableProjectOperation(project);
}

function isAwaitingDurableProjectAttachment(
  status: EngineeringProjectSnapshot["agentRuns"][number]["status"],
): boolean {
  return status === "queued" || status === "running" ||
    status === "waiting-for-decision" || status === "publishing" ||
    // Defensive legacy/recovery guard: older executors could mark a run
    // failed after save(snapshot) succeeded but before readback. A failed
    // durable-writer operation never authorizes an unattached descendant.
    status === "failed";
}

function workbenchDataSource(projection: EngineeringWorkbenchSnapshot): string {
  if (projection.surface === "planning") {
    return "engineering-project-plan";
  }
  if (projection.surface === "documentary") {
    return "engineering-project-documentary-baseline";
  }
  return projection.thread.live.active.length
    ? "canonical-thread-snapshot+live-updates"
    : "canonical-thread-snapshot";
}

async function projectThreadSnapshot(
  snapshot: ThreadSnapshot,
  options: NativeWorkbenchHandlerOptions,
  projectId: string,
  subjectId: string,
  liveUpdates?: LiveThreadUpdate[],
) {
  const projected = projectThreadWorkbenchSnapshot(snapshot);
  const withRequirements = options.requirementsCaptures
    ? await enrichThreadWorkbenchWithRequirementsTargets(
      projected,
      options.requirementsCaptures,
      snapshot,
    )
    : projected;
  const withRequirementsHistory = options.requirementsCaptures
    ? await enrichThreadWorkbenchWithRequirementsHistory(
      withRequirements,
      composeHistoryCaptureReaders(
        options.requirementsCaptures,
        options.historyEvidenceCaptures,
      ),
      snapshot,
    )
    : withRequirements;
  const withEngineeringCases = options.engineeringCaseCaptures
    ? await enrichThreadWorkbenchWithEngineeringCases(
      withRequirementsHistory,
      options.engineeringCaseCaptures,
      { projectId },
    )
    : withRequirementsHistory;
  const updates = liveUpdates ??
    (await options.liveUpdates?.list(subjectId) ?? []);
  return overlayLiveThreadUpdates(
    withEngineeringCases,
    snapshot.revision,
    updates,
    updates.at(-1)?.sequence ?? 0,
  );
}

function composeProductNavigation(
  options: NativeWorkbenchHandlerOptions,
): ProductNavigationUseCase | undefined {
  const captures = options.productStructureCaptures;
  if (!captures) return undefined;
  return new ProjectProductNavigation({
    projects: options.projectStore,
    snapshots: options.store,
    traversal: new CaptureProductStructureTraversal(
      captures,
      options.sysmlSourceAnalysis,
    ),
    workspace: options.projectSourceWorkspace,
    evidenceAttachments: new WorkbenchProductNavigationEvidenceAttachmentReader(
      {
        admissions: options.technicalCompilationAdmissions,
        workspace: options.projectSourceWorkspace,
        requirementsCaptures: options.requirementsCaptures,
        historyEvidenceCaptures: options.historyEvidenceCaptures,
        engineeringCases: options.engineeringCaseCaptures,
      },
    ),
    authoringAttachments: options.projectSourceWorkspace
      ? new ProjectSourceWorkspaceAuthoringAttachmentReader(
        options.projectSourceWorkspace,
      )
      : undefined,
  });
}

async function serveProductNavigationQuery(
  url: URL,
  options: NativeWorkbenchHandlerOptions,
  navigation: ProductNavigationUseCase | undefined,
): Promise<Response> {
  if (!navigation) {
    return json(unavailableProductNavigationProjection(), 200);
  }
  let context: ActiveTargetResolution;
  try {
    context = await resolveActiveProject(options);
  } catch (error) {
    if (error instanceof NativeWorkbenchProjectNotFoundError) {
      return projectNotFound(error.projectId);
    }
    throw error;
  }
  const projectId = context.projectId;
  const view = url.searchParams.get("view");
  if (view === "authoring-attachments" || view === "context") {
    return await serveInspectQuery(url, navigation, projectId);
  }
  if (view === "children" || view === "neighborhood") {
    const occurrence = occurrenceFromQuery(url);
    if (occurrence === "invalid") return invalidExactElementPath();
    if (occurrence === "missing") {
      return invalidAuthoringAttachmentsQuery(
        "id must be an exact SysML element identity. latest is refused.",
      );
    }
    if (occurrence === "kind-invalid") {
      return invalidAuthoringAttachmentsQuery(
        "kind must be part-definition or part-usage. latest is refused.",
      );
    }
    if (occurrence.kind === "semantic-root") {
      return json(
        exactSemanticRootExplore(
          await navigation.explore({ projectId }),
          occurrence.elementId,
        ),
        200,
      );
    }
    return json(
      await navigation.explore({
        projectId,
        selection: occurrence.occurrence,
      }),
      200,
    );
  }
  if (view === "path") {
    const usagePath = parseExactElementPath(url.searchParams.get("usagePath"));
    if (usagePath === "invalid") return invalidExactElementPath();
    if (usagePath.length === 0) {
      return json(await navigation.explore({ projectId }), 200);
    }
    return json(
      await navigation.explore({
        projectId,
        selection: {
          element: productStructureElementRef(
            "PartUsage",
            usagePath[usagePath.length - 1]!,
          ),
          path: usagePath,
        },
      }),
      200,
    );
  }
  const result = view === "search"
    ? await navigation.search({
      projectId,
      query: {
        kind: "exact-id",
        elementId: url.searchParams.get("id") ?? "",
      },
    })
    : view === "roots"
    ? await navigation.explore({ projectId })
    : view === null || view === ""
    ? await navigation.projection({ projectId })
    : {
      schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
      status: "unavailable" as const,
    };
  return json(result, 200);
}

const EXACT_ELEMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

function parseExactElementPath(value: string | null): string[] | "invalid" {
  if (value === null || value === "") return [];
  const segments = value.split(",");
  for (const segment of segments) {
    if (
      segment === "" ||
      segment === "latest" ||
      !EXACT_ELEMENT_ID.test(segment)
    ) {
      return "invalid";
    }
  }
  return segments;
}

function invalidExactElementPath(): Response {
  return new Response(
    "Invalid exact element path. Empty segments and latest are refused.",
    { status: 400 },
  );
}

async function serveInspectQuery(
  url: URL,
  navigation: ProductNavigationUseCase,
  projectId: string,
): Promise<Response> {
  const kindParam = url.searchParams.get("kind");
  if (kindParam !== "part-definition" && kindParam !== "part-usage") {
    return invalidAuthoringAttachmentsQuery(
      "kind must be part-definition or part-usage. latest is refused.",
    );
  }
  const nodeId = url.searchParams.get("id") ?? "";
  if (
    nodeId === "" ||
    nodeId === "latest" ||
    !EXACT_ELEMENT_ID.test(nodeId)
  ) {
    return invalidAuthoringAttachmentsQuery(
      "id must be an exact SysML element identity. latest is refused.",
    );
  }
  const path = parseExactElementPath(url.searchParams.get("path"));
  if (path === "invalid") return invalidExactElementPath();
  const pageSize = parseExactPageSize(url.searchParams.get("pageSize"));
  if (pageSize === "invalid") {
    return invalidAuthoringAttachmentsQuery(
      `pageSize must be an integer from 1 to ${PROJECT_SOURCE_WORKSPACE_BOUNDS.maxPageSize}. latest is refused.`,
    );
  }
  const cursor = parseExactCursor(url.searchParams.get("cursor"));
  if (cursor === "invalid") {
    return invalidAuthoringAttachmentsQuery(
      "cursor must be the opaque nextCursor from this view. latest is refused.",
    );
  }
  const selection = kindParam === "part-usage"
    ? {
      kind: "occurrence" as const,
      occurrence: {
        element: productStructureElementRef("PartUsage", nodeId),
        path: path.length === 0 ? [nodeId] : path,
      },
    }
    : {
      kind: "element" as const,
      element: productStructureElementRef("PartDefinition", nodeId),
    };
  try {
    const result = await navigation.inspect({
      projectId,
      selection,
      ...(pageSize === undefined ? {} : { pageSize }),
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (
      result.status === "unresolved" &&
      result.diagnostics.some((item) => item.code === "cursor.mismatch")
    ) {
      return invalidAuthoringAttachmentsQuery(
        "cursor must be the opaque nextCursor from this view. latest is refused.",
      );
    }
    return json(result, 200);
  } catch (error) {
    if (error instanceof ProjectSourceWorkspaceError) {
      return invalidAuthoringAttachmentsQuery(error.message);
    }
    throw error;
  }
}

function occurrenceFromQuery(url: URL):
  | "invalid"
  | "missing"
  | "kind-invalid"
  | { readonly kind: "semantic-root"; readonly elementId: string }
  | {
    readonly kind: "occurrence";
    readonly occurrence: ProductStructureOccurrenceRef;
  } {
  const kindParam = url.searchParams.get("kind");
  const nodeId = url.searchParams.get("id") ?? "";
  const path = parseExactElementPath(url.searchParams.get("path"));
  if (path === "invalid") return "invalid";
  if (nodeId === "" || nodeId === "latest" || !EXACT_ELEMENT_ID.test(nodeId)) {
    return "missing";
  }
  if (kindParam === "part-usage") {
    return {
      kind: "occurrence",
      occurrence: {
        element: productStructureElementRef("PartUsage", nodeId),
        path: path.length === 0 ? [nodeId] : path,
      },
    };
  }
  if (kindParam !== "part-definition") return "kind-invalid";
  if (path.length !== 0) return "invalid";
  return { kind: "semantic-root", elementId: nodeId };
}

function exactSemanticRootExplore(
  result: ProductExploreResult,
  elementId: string,
): ProductExploreResult {
  if (
    result.status === "observed" &&
    result.focus &&
    productStructureElementRefsEqual(
      result.focus.element,
      productStructureElementRef("PartDefinition", elementId),
    )
  ) {
    return result;
  }
  if (result.status !== "observed") return result;
  return unavailableExplore({
    basis: result.basis,
    status: "unattached",
    diagnostics: [{
      code: "selection.unattached",
      relation: "selection",
      recovery:
        "Pass a PartUsage occurrence published by explore or inspect on this exact basis.",
    }],
  });
}

function parseExactPageSize(
  value: string | null,
): number | undefined | "invalid" {
  if (value === null || value === "") return undefined;
  if (value === "latest") return "invalid";
  if (!/^[1-9][0-9]*$/.test(value)) return "invalid";
  const size = Number(value);
  if (
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > PROJECT_SOURCE_WORKSPACE_BOUNDS.maxPageSize
  ) {
    return "invalid";
  }
  return size;
}

function parseExactCursor(
  value: string | null,
): string | undefined | "invalid" {
  if (value === null || value === "") return undefined;
  if (value === "latest") return "invalid";
  if (value.length > PROJECT_SOURCE_WORKSPACE_BOUNDS.maxCursorLength) {
    return "invalid";
  }
  return value;
}

function invalidAuthoringAttachmentsQuery(message: string): Response {
  return new Response(message, { status: 400 });
}

async function serveThreadAsset(
  pathname: string,
  reader?: (filename: string) => Promise<Uint8Array | undefined>,
): Promise<Response> {
  if (!reader) return new Response("Not found", { status: 404 });
  let filename: string;
  try {
    filename = decodeURIComponent(pathname.slice("/api/thread/assets/".length));
  } catch {
    return new Response("Invalid asset path", { status: 400 });
  }
  if (!/^[A-Za-z0-9._-]+$/.test(filename)) {
    return new Response("Invalid asset path", { status: 400 });
  }
  const bytes = await reader(filename);
  if (!bytes) return new Response("Not found", { status: 404 });
  const addressed = /^([a-f0-9]{64})\.(step|glb|gltf|stl)$/.exec(filename);
  if (addressed && await sha256Hex(bytes) !== addressed[1]) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(Uint8Array.from(bytes).buffer, {
    headers: workbenchReadHeaders({
      "Content-Type": filename.endsWith(".step")
        ? "model/step"
        : filename.endsWith(".glb")
        ? "model/gltf-binary"
        : filename.endsWith(".gltf")
        ? "model/gltf+json"
        : "model/stl",
      "Cache-Control": "no-store",
    }),
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const WORKBENCH_UI_ASSET_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function dirnameOf(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  return slash <= 0 ? "." : trimmed.slice(0, slash);
}

function resolveUiAssetDirectory(
  options: NativeWorkbenchHandlerOptions,
): string | undefined {
  if (options.uiAssetDirectory) return options.uiAssetDirectory;
  if (options.htmlPath) return dirnameOf(options.htmlPath);
  return undefined;
}

function workbenchUiAssetContentType(filename: string): string | undefined {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return undefined;
  return WORKBENCH_UI_ASSET_TYPES[filename.slice(dot).toLowerCase()];
}

/**
 * Resolve a hashed Vite asset under the UI dist directory. Rejects traversal,
 * absolute segments, and unknown extensions. This is a read-only file serve.
 */
export function resolveWorkbenchUiAssetPath(
  directory: string,
  pathname: string,
): string | undefined {
  if (!pathname.startsWith("/assets/") || pathname.includes("\0")) {
    return undefined;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return undefined;
  const segments = decoded.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return undefined;
  }
  if (segments[0] !== "assets") return undefined;
  const filename = segments.at(-1);
  if (!filename || !workbenchUiAssetContentType(filename)) return undefined;
  return `${directory.replace(/\/+$/, "")}/${segments.join("/")}`;
}

async function serveWorkbenchUiAsset(
  pathname: string,
  options: NativeWorkbenchHandlerOptions,
): Promise<Response | undefined> {
  const directory = resolveUiAssetDirectory(options);
  if (!directory) return undefined;
  const path = resolveWorkbenchUiAssetPath(directory, pathname);
  if (!path) return undefined;
  const contentType = workbenchUiAssetContentType(path);
  if (!contentType) return undefined;
  try {
    const bytes = await Deno.readFile(path);
    return new Response(bytes, {
      headers: workbenchReadHeaders({
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      }),
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return new Response("Not found", { status: 404 });
    }
    throw error;
  }
}

function waitForPoll(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

if (import.meta.main) {
  const cliArgs = parseArgs(Deno.args);
  const startup = resolveNativeWorkbenchStartupTarget(cliArgs);
  const {
    explicitSubjectId,
    hostname,
    port,
    projectId,
    workspaceId,
  } = startup;
  const snapshotDirectory = cliArgs["snapshot-dir"] ??
    "state/local/thread-snapshots";
  const activeProjectDirectory = cliArgs["active-project-dir"] ??
    "state/local/engineering-projects";
  const projectBaselineDirectory = cliArgs["project-baseline-dir"] ??
    "config/projects/baselines";
  const projectBaselineAssetDirectory = cliArgs["project-baseline-asset-dir"] ??
    `${projectBaselineDirectory}/assets`;
  const htmlPath = cliArgs["html"] ??
    "src/ui/dist/thread/native-workbench.html";
  const assetDirectory = cliArgs["asset-dir"] ?? "state/local/thread-assets";
  const liveUpdateDirectory = cliArgs["live-update-dir"] ??
    "state/local/live-thread-updates";
  const focusDirectory = cliArgs["focus-dir"] ?? "state/local/cockpit-focus";
  const architectureCaptureDirectory = cliArgs["architecture-capture-dir"] ??
    ARCHITECTURE_CAPTURE_DESCRIPTOR.directory;
  const geometryCaptureDirectory = cliArgs["geometry-capture-dir"] ??
    GEOMETRY_CAPTURE_DESCRIPTOR.directory;
  const viewerAppRegistryPath = cliArgs["viewer-app-registry"];
  const viewerAppObjectDirectory = cliArgs["viewer-app-object-dir"];
  if (
    (viewerAppRegistryPath === undefined) !==
      (viewerAppObjectDirectory === undefined)
  ) {
    throw new TypeError(
      "--viewer-app-registry and --viewer-app-object-dir must be configured together.",
    );
  }
  const viewerAppRegistry = viewerAppRegistryPath && viewerAppObjectDirectory
    ? new FileThreadViewerAppRegistry({
      registryPath: viewerAppRegistryPath,
      objectDirectory: viewerAppObjectDirectory,
    })
    : undefined;
  const store = new FileThreadSnapshotStore(snapshotDirectory);
  const projectSnapshots = new OrderedExactThreadSnapshotReader([
    store,
    new FileExactThreadSnapshotDirectory(projectBaselineDirectory),
  ]);
  const cockpitFocus = workspaceId
    ? new FileCockpitFocusStore(focusDirectory)
    : undefined;
  const archCaptures = new FileCaptureStore({
    ...ARCHITECTURE_CAPTURE_DESCRIPTOR,
    directory: architectureCaptureDirectory,
  });
  const sysmlSourceCaptures = new FileCaptureStore(
    SYSML_SOURCE_CAPTURE_DESCRIPTOR,
  );
  const sourceAnalysisCaptures = new FileCaptureStore(
    SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
  );
  const sysmlSourceAnalysis: SysmlSourceAnalysisReader = {
    reopen: (reference) =>
      requireSysmlSourceAnalysis(reference, {
        sourceCaptures: sysmlSourceCaptures,
        analysisCaptures: sourceAnalysisCaptures,
      }),
  };
  const geometryCaptures = new FileCaptureStore({
    ...GEOMETRY_CAPTURE_DESCRIPTOR,
    directory: geometryCaptureDirectory,
  });
  const technicalCompilationSealBytes = new FileByteStore({
    kind: "technical-compilation-admission-capture",
    directory: cliArgs["technical-compilation-admission-dir"] ??
      "state/local/recorded-analysis/technical-compilation/seals",
    uriNamespace: "technical-compilation-admission-capture",
    label: "Sealed technical compilation admission",
  });
  const technicalCompilationAdmissions: ProductNavigationTechnicalAdmissionReader = {
    read: async (fingerprint) => {
      const stored = await technicalCompilationSealBytes.read(fingerprint);
      return stored === undefined
        ? undefined
        : new TextDecoder("utf-8", { fatal: true }).decode(stored.copy());
    },
  };
  const projectSourceWorkspace = new FileProjectSourceWorkspaceStore(
    cliArgs["project-source-workspace-dir"] ??
      DEFAULT_PROJECT_SOURCE_WORKSPACE_DIRECTORY,
  );
  const requirementsCaptures: RequirementsCaptureReader = new FileCaptureStore(
    REQUIREMENTS_CAPTURE_DESCRIPTOR,
  );
  const engineeringCaseCaptures: EngineeringCaseWorkbenchEnricherDependencies = {
    mechanicalProof: new FileCaptureStore(
      FEA_PROOF_CASE_CAPTURE_DESCRIPTOR,
    ),
    sensitivityStudy: new FileCaptureStore(
      SENSITIVITY_STUDY_CASE_CAPTURE_DESCRIPTOR,
    ),
    printabilityCheck: new FileCaptureStore(
      PRINTABILITY_CASE_CAPTURE_DESCRIPTOR,
    ),
    printEstimate: new FileCaptureStore(
      PRINT_ESTIMATE_CASE_CAPTURE_DESCRIPTOR,
    ),
    dfmCheck: new FileCaptureStore(DFM_CASE_CAPTURE_DESCRIPTOR),
    preSizingWorksheet: createPreSizingWorksheetStore(
      cliArgs["pre-sizing-worksheet-dir"] ??
        DEFAULT_PRE_SIZING_WORKSHEET_DIRECTORY,
    ),
  };
  const historyEvidenceCaptures = composeHistoryCaptureReaders(
    new FileCaptureStore(SENSITIVITY_STUDY_CAPTURE_DESCRIPTOR),
    engineeringCaseCaptures.sensitivityStudy,
    new FileCaptureStore(SENSITIVITY_BASE_EVALUATION_CAPTURE_DESCRIPTOR),
  );
  // The paired MCP owns all project commands and initialisation. The cockpit
  // reads existing immutable revisions and never seeds a fallback.
  const projectStore: EngineeringProjectRevisionStore =
    new FileEngineeringProjectRevisionStore(activeProjectDirectory);
  const capabilityWorkbench = await createNativeWorkbenchCapabilityWorkbench(
    cliArgs,
  );
  const subjectId = projectId === undefined
    ? undefined
    : await resolveNativeWorkbenchSubjectId(
      projectId,
      explicitSubjectId,
      projectStore,
    );
  const assetReader = new OrderedEngineeringAssetReader([
    new FileEngineeringAssetReader(assetDirectory),
    new Base64EngineeringAssetReader(projectBaselineAssetDirectory),
  ]);
  const liveUpdates = new FileLiveThreadUpdateStore(liveUpdateDirectory);
  const requirementsBriefTraceCaptures = createRequirementsBriefTraceStore(
    REQUIREMENTS_CAPTURE_DESCRIPTOR.directory,
  );
  const documentaryClauseResponseCaptures = createDocumentaryClauseResponseStore(
    DEFAULT_DOCUMENTARY_CLAUSE_RESPONSE_DIRECTORY,
  );
  const reopenAgentResource = new ReopenAgentResource(
    new FileAgentResourceStore(DEFAULT_AGENT_RESOURCE_CAPTURE_DIRECTORY),
  );
  const projectResponse = new ReadProjectResponse({
    projects: projectStore,
    snapshots: projectSnapshots ?? store,
    evidence: new ThreadProjectResponseEvidenceReader({
      projects: projectStore,
      snapshots: projectSnapshots ?? store,
      captures: requirementsCaptures,
      claimHistory: {
        projects: projectStore,
        snapshots: projectSnapshots ?? store,
        captures: requirementsCaptures,
        traces: requirementsBriefTraceCaptures,
      },
      clauseResponses: documentaryClauseResponseCaptures,
      resources: reopenAgentResource,
    }),
  });
  const handler = createNativeWorkbenchHandler({
    store,
    projectStore,
    projectId,
    cockpitFocus,
    workspaceId,
    projectSnapshots,
    subjectId,
    htmlPath,
    uiAssetDirectory: dirnameOf(htmlPath),
    technicalCompilationAdmissions,
    projectSourceWorkspace,
    requirementsCaptures,
    historyEvidenceCaptures,
    requirementsBriefTraceCaptures,
    projectResponse,
    productStructureCaptures: archCaptures,
    geometryCaptures,
    sysmlSourceAnalysis,
    engineeringCaseCaptures,
    liveUpdates,
    viewerAppRegistry,
    assetReader: (filename) => assetReader.read(filename),
    cockpitFleet: () =>
      readDeclaredCockpitFleet(
        cliArgs["fleet-manifest"] ?? "config/mcp-fleet.json",
      ),
    projectCatalog: () =>
      readPersistedProjectCatalog(projectStore, activeProjectDirectory),
    projectDiscovery: () =>
      readNativeWorkbenchProjectDiscovery(projectStore, activeProjectDirectory),
    capabilityWorkbench,
  });
  const workspaceHandler = workspaceId === undefined || !cockpitFocus
    ? handler
    : createFocusedWorkspaceHandler({
      focus: cockpitFocus,
      workspaceId,
      native: handler,
      projectCatalog: () =>
        readPersistedProjectCatalog(projectStore, activeProjectDirectory),
      projectDiscovery: () =>
        readNativeWorkbenchProjectDiscovery(
          projectStore,
          activeProjectDirectory,
        ),
    });

  Deno.serve({
    hostname,
    port,
    onListen: ({ hostname, port }) => {
      console.log(`Native Workbench: http://${hostname}:${port}/`);
      console.log(
        subjectId === undefined
          ? "Snapshot subject: selected by durable cockpit focus"
          : `Snapshot subject: ${subjectId}`,
      );
      console.log(
        projectId === undefined
          ? "Engineering project id: selected by durable cockpit focus"
          : `Engineering project id: ${projectId}`,
      );
      console.log(`Active project revisions: ${activeProjectDirectory}`);
      console.log(`Versioned project baselines: ${projectBaselineDirectory}`);
      console.log(
        `Versioned presentation baselines: ${projectBaselineAssetDirectory}`,
      );
      console.log(`Live activity journal: ${liveUpdateDirectory}`);
      if (workspaceId) {
        console.log(`Agent-selected cockpit workspace: ${workspaceId}`);
      }
      console.log(
        "Project state: read-only active revisions (no fallback seeding)",
      );
      console.log(
        "Workbench transport is GET + SSE only. Commands and signed decisions remain in the paired MCP conversation.",
      );
    },
  }, workspaceHandler);
}

interface FocusedWorkspaceHandlerOptions {
  readonly focus: CockpitFocusStore;
  readonly workspaceId: string;
  readonly native: (request: Request) => Promise<Response>;
  /** Desktop chat can open without selecting a project; project APIs cannot. */
  readonly allowUnfocusedDocument?: boolean;
  readonly projectCatalog?: () => Promise<NativeWorkbenchProjectCatalog>;
  readonly projectDiscovery?: () => Promise<NativeWorkbenchProjectDiscovery>;
}

/**
 * Same-origin workspace router. The root is always the canonical native
 * cockpit; focus selects one project from its first framing revision onward.
 */
export function createFocusedWorkspaceHandler(
  options: FocusedWorkspaceHandlerOptions,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") return await options.native(request);
    if (request.method !== "GET") return methodNotAllowed();
    if (url.pathname.startsWith("/assets/")) {
      return await options.native(request);
    }
    if (url.pathname === "/api/projects") return await options.native(request);
    if (url.pathname === "/api/project-discovery") {
      return await options.native(request);
    }
    if (
      options.allowUnfocusedDocument &&
      (url.pathname === "/" || url.pathname === "/native-workbench.html")
    ) {
      return await options.native(
        url.pathname === "/" ? request : requestAtRoot(request),
      );
    }
    const focus = await options.focus.get(options.workspaceId);
    if (!focus) {
      return await cockpitFocusUnavailable(
        options.workspaceId,
        request,
        options.projectCatalog,
        options.projectDiscovery,
      );
    }
    if (
      url.pathname === "/" || url.pathname === "/native-workbench.html"
    ) {
      // The canonical cockpit owns the root before and after approval. The
      // browser reads the durable focus through its read-only API, never by a
      // focus command or a second application URL.
      const rootRequest = url.pathname === "/" ? request : requestAtRoot(request);
      return await options.native(rootRequest);
    }
    return await options.native(request);
  };
}

function requestAtRoot(request: Request): Request {
  const url = new URL(request.url);
  url.pathname = "/";
  return new Request(url, { method: "GET", headers: request.headers });
}

async function serveCockpitFleet(
  options: NativeWorkbenchHandlerOptions,
): Promise<Response> {
  if (!options.cockpitFleet) {
    return json({ error: "fleet_unavailable" }, 404);
  }
  const projection = await options.cockpitFleet();
  if (!projection) {
    return json({ error: "fleet_unavailable" }, 404);
  }
  return json(projection, 200);
}

async function serveProjectCapabilityWorkbench(
  options: NativeWorkbenchHandlerOptions,
): Promise<Response> {
  if (!options.capabilityWorkbench) {
    return json({
      error: "project_capability_workbench_unavailable",
      message: "Operational capability projection is not configured.",
    }, 503);
  }
  let context: ActiveTargetResolution;
  try {
    context = await resolveActiveProject(options);
  } catch (error) {
    if (error instanceof NativeWorkbenchProjectNotFoundError) {
      return projectNotFound(error.projectId);
    }
    throw error;
  }
  return json(await options.capabilityWorkbench.read(context.project), 200);
}

async function serveProjectCatalog(
  options: NativeWorkbenchHandlerOptions,
): Promise<Response> {
  if (!options.projectCatalog) {
    return json(
      {
        schemaVersion: "native-workbench-project-catalog/1.0",
        state: "unavailable",
        projects: [],
        reason: "Persisted project catalog is unavailable.",
      } satisfies NativeWorkbenchProjectCatalog,
      503,
    );
  }
  const catalog = await options.projectCatalog();
  return json(catalog, catalog.state === "available" ? 200 : 503);
}

async function serveProjectDiscovery(
  options: NativeWorkbenchHandlerOptions,
): Promise<Response> {
  const discovery = options.projectDiscovery
    ? await options.projectDiscovery()
    : unconfiguredProjectDiscovery();
  return json(discovery, nativeWorkbenchProjectDiscoveryHttpStatus(discovery));
}

function unconfiguredProjectDiscovery(): NativeWorkbenchProjectDiscovery {
  return Object.freeze({
    schemaVersion: "native-workbench-project-discovery/2.0",
    state: "unavailable",
    reasonCode: "root-unreadable",
    message: "Configured project root could not be enumerated completely.",
    counts: Object.freeze({
      available: 0,
      unavailable: 0,
      candidates: 0,
    }),
    enumeration: Object.freeze({ complete: false, truncated: false }),
    entries: Object.freeze([]),
  });
}

function json(
  value: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return Response.json(value, {
    status,
    headers: workbenchReadHeaders({
      "Cache-Control": "no-store",
      ...headers,
    }),
  });
}

function methodNotAllowed(allow = "GET"): Response {
  return new Response("Method not allowed", {
    status: 405,
    headers: workbenchReadHeaders({ Allow: allow }),
  });
}

function projectNotFound(projectId: string): Response {
  return json({
    error: "engineering_project_not_found",
    projectId,
  }, 404);
}

function publicFocusTarget(target: ActiveTargetResolution): {
  kind: "project";
  projectId: string;
} {
  return { kind: "project", projectId: target.projectId };
}

async function cockpitFocusUnavailable(
  workspaceId: string,
  request: Request,
  projectCatalog?: () => Promise<NativeWorkbenchProjectCatalog>,
  projectDiscovery?: () => Promise<NativeWorkbenchProjectDiscovery>,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    return json({
      error: "cockpit_focus_not_selected",
      workspaceId,
      message:
        "The paired agent has not selected a durable project for this cockpit workspace yet.",
    }, 409);
  }
  const list = projectDiscovery
    ? renderNativeWorkbenchProjectDiscoveryHtml(await projectDiscovery())
    : renderPersistedProjectCatalogHtml(
      projectCatalog ? await projectCatalog() : {
        schemaVersion: "native-workbench-project-catalog/1.0" as const,
        state: "unavailable" as const,
        projects: [] as const,
        reason: "Persisted project catalog is unavailable.",
      },
    );
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cockpit awaiting project context</title><style>body{font:16px system-ui;max-width:52rem;margin:8vh auto;padding:0 1.5rem;color:#1c2126;background:#f5f2ea}main{padding:2rem;border:1px solid #d4cdc0;background:#fbf8f1}code{overflow-wrap:anywhere}li+li{margin-top:1rem}</style><main><p>Casys Digital Thread</p><h1>Opening project context</h1><p>Your paired agent has not selected a durable project for this workspace. No engineering tool is running.</p><h2>Persisted projects</h2>${list}<p>Choose the project from the paired assistant. This read-only Workbench has no project command.</p></main></html>`,
    {
      status: 200,
      headers: workbenchDocumentHeaders({
        "Content-Type": "text/html; charset=utf-8",
      }),
    },
  );
}

function renderPersistedProjectCatalogHtml(
  catalog: NativeWorkbenchProjectCatalog,
): string {
  const projects = catalog.state === "available"
    ? catalog.projects.map((project) =>
      `<li><strong>${escapeHtml(project.name)}</strong><br><code>${
        escapeHtml(project.id)
      }</code> · revision ${project.revision}</li>`
    ).join("")
    : `<li><strong>unavailable</strong> — ${escapeHtml(catalog.reason)}</li>`;
  return catalog.state === "available" && catalog.projects.length === 0
    ? "<p>No persisted engineering project is available.</p>"
    : `<ul>${projects}</ul>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export const MCP_APP_SCRIPT_NONCE_META_NAME = "casys-mcp-app-script-nonce" as const;

function workbenchCsp(appScriptNonce?: string): string {
  const scriptSource = appScriptNonce === undefined
    ? "script-src 'self'"
    : `script-src 'self' 'nonce-${appScriptNonce}'`;
  // WebKit applies the creator's frame-ancestors policy to its Blob App
  // frames. Same-origin ancestors admit that bootstrap while keeping
  // cross-origin embedding blocked; the App sandbox remains opaque.
  return "default-src 'none'; base-uri 'none'; form-action 'none'; " +
    `frame-ancestors 'self'; object-src 'none'; ${scriptSource}; ` +
    "style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "font-src 'self'; connect-src 'self'; frame-src blob:; media-src 'none'; " +
    "worker-src 'none'; manifest-src 'none'";
}

/**
 * Add the host-owned nonce that the browser uses only while wrapping an exact
 * MCP App HTML resource. It is document-scoped and deliberately absent from
 * the viewer-session projection, so it cannot perturb session sequencing.
 */
export function injectMcpAppScriptNonce(html: string, nonce: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(nonce)) {
    throw new TypeError("The MCP App script nonce is invalid.");
  }
  if (
    new RegExp(
      `<meta\\s+[^>]*name=["']${MCP_APP_SCRIPT_NONCE_META_NAME}["']`,
      "i",
    ).test(html)
  ) {
    throw new TypeError("The Workbench HTML already declares an MCP App nonce.");
  }
  const meta = `<meta name="${MCP_APP_SCRIPT_NONCE_META_NAME}" content="${nonce}">`;
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (head?.index !== undefined) {
    const insertion = head.index + head[0].length;
    return `${html.slice(0, insertion)}${meta}${html.slice(insertion)}`;
  }
  const documentElement = /<html(?:\s[^>]*)?>/i.exec(html);
  if (documentElement?.index !== undefined) {
    const insertion = documentElement.index + documentElement[0].length;
    return `${html.slice(0, insertion)}<head>${meta}</head>${html.slice(insertion)}`;
  }
  return `<!doctype html><html><head>${meta}</head><body>${html}</body></html>`;
}

function createMcpAppScriptNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function workbenchReadHeaders(
  headers: Readonly<Record<string, string>> = {},
): Headers {
  return new Headers({
    "Cache-Control": "no-store",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    ...headers,
  });
}

function workbenchDocumentHeaders(
  headers: Readonly<Record<string, string>> = {},
  appScriptNonce?: string,
): Headers {
  const result = workbenchReadHeaders(headers);
  result.set("Content-Security-Policy", workbenchCsp(appScriptNonce));
  return result;
}

function configuredProjectId(options: NativeWorkbenchHandlerOptions): string {
  const projectId = options.projectId;
  if (projectId === undefined) {
    throw new Error(
      "Native Workbench requires a durable cockpit focus or a fixed project.",
    );
  }
  return projectId;
}

function booleanFlag(
  name: string,
  cliArgs: Readonly<Record<string, string | undefined>>,
): boolean {
  const value = cliArgs[name];
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new TypeError(`--${name} must be a boolean flag.`);
}

function integerArgument(
  name: string,
  cliArgs: Readonly<Record<string, string | undefined>>,
): number | undefined {
  const value = cliArgs[name];
  if (value === undefined) return undefined;
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0 || result > 65535) {
    throw new Error(`--${name} must be an integer between 1 and 65535.`);
  }
  return result;
}
