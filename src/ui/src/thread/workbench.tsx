import { cn } from "../lib/utils.ts";
import { CARD_SURFACE, PAGE_EYEBROW, SECTION_LABEL } from "../ui/cockpit.tsx";
import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";
import { Badge, type BadgeProps } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.tsx";
import { Notice } from "../ui/notice.tsx";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.tsx";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import { buildActivityReviewRecords } from "../project/review-decision-model.ts";
import {
  type AgentNowPresentation,
  agentPreparationDecisions,
  agentRunSummary,
  buildAgentNowPresentation,
  buildCurrentProjectWork,
  pendingHumanConfirmationDecisions,
} from "../project/model.ts";
import {
  ProjectNavigation,
  type ProjectWorkspaceView,
} from "../project/navigation.tsx";
import {
  parseProjectLocationHash,
  parseProjectViewHash,
  projectDeepLinkDomId,
  projectDeepLinkHash,
  type ProjectDeepLinkTarget,
  projectViewHash,
  shouldScrollProjectDeepLink,
} from "../project/navigation-model.ts";
import { DocumentaryBaselineWorkbench } from "../project/documentary-baseline-workbench.tsx";
import { ProjectOverview } from "../project/overview.tsx";
import { selectWorkbenchProjectResponse } from "../project/overview-response-index-model.ts";
import { PlanningWorkbench } from "../project/planning-workbench.tsx";
import { ProjectOperations, ProjectWorkRibbon } from "../project/work.tsx";
import {
  type CockpitFleetClient,
  type ThreadStreamStatus,
  type ThreadWorkbenchClient,
} from "./client.ts";
import {
  shouldAcceptViewerSessionsUpdate,
  type ThreadViewerSessionsClient,
  type ThreadViewerSessionsProjection,
  viewerSessionsMatchWorkbench,
} from "./viewer-sessions-client.ts";
import type { CockpitFleetProjection } from "../../../presentation/workbench/fleet/projection.ts";
import { activityFeedNodes } from "./feed-model.ts";
import { shouldAcceptWorkbenchUpdate } from "./live-update.ts";
import { ThreadFeed } from "./feed.tsx";
import { type ThreadGraphSelection } from "./graph.tsx";
import {
  buildEvidenceCanvasProjection,
  buildExplorationKindProjection,
  buildInitialEvidenceFrameProjection,
  type InitialEvidenceFrameAnchors,
  linkedEvidenceDetail,
  paintedDossierMetric,
} from "./evidence-canvas-model.ts";
import {
  DISPLAY_KIND_LABELS,
  type DisplayKind,
  displayKindOf,
} from "./evidence-exploration-model.ts";
import {
  allEvidenceKindsVisible,
  CURRENT_EVIDENCE_KIND_PRESET,
  isCurrentEvidenceKindPreset,
  isFullEvidenceKindScope,
} from "./graph-record-display.ts";
import {
  buildEvidenceGraphModel,
  type EvidenceGraphModel,
  graphWithoutAnalysisOverlay,
} from "./evidence-graph-model.ts";
import { EvidenceExploration } from "./evidence-exploration.tsx";
import {
  buildVerificationCaseLegend,
  filterGraphByVerificationCase,
  reconcileVerificationCaseContext,
  UNAVAILABLE_VERIFICATION_CASE_CATALOG,
  type VerificationCaseFilter,
} from "./verification-case-model.ts";
import { RecordInspectorPanel } from "./tool-inspectors.tsx";
import {
  graphNodeForSelection,
  resolveRecordInspectorTarget,
} from "./tool-inspector-model.ts";
import { EvidenceVersionHistory } from "./version-history.tsx";
import {
  buildVersionedGraphSelectionIndex,
  buildVersionedProvenanceProjection,
  edgeForVersionedGraphSelection,
  isStaleAmbiguousVersionedEdgeSelection,
  versionedEdgeGroupForSelection,
  versionedEdgeOccurrenceKey,
  type VersionedProvenanceEdgeGroup,
  type VersionedProvenanceProjection,
  versionedRefKey,
  visibleGraphRef,
  visibleGraphSelection,
} from "./versioned-provenance-model.ts";

function focusProjectWorkspace(): void {
  requestAnimationFrame(() => {
    globalThis.document?.getElementById("project-workspace-panel")?.focus({
      preventScroll: true,
    });
    globalThis.scrollTo({ top: 0, left: 0, behavior: "auto" });
  });
}
import type {
  EngineeringCaseCatalog,
  EngineeringWorkbenchSnapshot,
  ThreadAction,
  ThreadGraph as ThreadGraphData,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
  ThreadRef,
  ThreadWorkbenchSnapshot,
} from "./types.ts";

type PresentationTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info";

interface FactItem {
  id: string;
  label: ReactNode;
  value: ReactNode;
}

interface MetricTileItem {
  id: string;
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  detail?: ReactNode;
  tone?: PresentationTone;
}

const TONE_BADGE_VARIANT: Record<
  PresentationTone,
  NonNullable<BadgeProps["variant"]>
> = {
  neutral: "secondary",
  success: "success",
  warning: "warning",
  danger: "destructive",
  info: "info",
};

export interface ThreadWorkbenchProps {
  client: ThreadWorkbenchClient;
  /** Declared fleet topology; absent when the BFF has no manifest. */
  fleetClient?: CockpitFleetClient;
  /** Optional GET+SSE reader for exact browser-safe viewer descriptors. */
  viewerSessionsClient?: ThreadViewerSessionsClient;
  /** Validated read-only projection focus for sibling Desktop capabilities. */
  onProjectFocus?: (projectId: string | undefined) => void;
}

/**
 * The three canvas projections for one evidence model: the no-focus map,
 * the focus-aware canvas, and the kind-filtered exploration map. The live
 * and verification-filtered views share this triple; only their model and
 * versioned-provenance inputs differ.
 *
 * The projection identity must be stable across non-data renders (depth
 * control, selection highlight): rebuilding it per render remounted sigma
 * on every click — the "everything refreshes" defect. localDepth is NOT a
 * dependency: the local neighbourhood is computed at max depth and the
 * visible depth filters display only.
 *
 * The no-focus map paints the bounded initial frame by default; showFullMap
 * (one explicit gesture) restores the unbounded kind projection. The frame
 * is always computed so the banner overflow count stays exact in both
 * modes; it is a filter pass, negligible next to dagre/sigma.
 */
function useEvidenceCanvasProjections(
  workbench: EngineeringWorkbenchSnapshot | undefined,
  evidenceModel: EvidenceGraphModel | undefined,
  versionedProvenance: VersionedProvenanceProjection | undefined,
  explorationMapKinds: Record<DisplayKind, boolean>,
  lineageFocus: ThreadGraphRef | undefined,
  presentedMemberRef: ThreadGraphRef | undefined,
  initialFrameAnchors: InitialEvidenceFrameAnchors,
  showFullMap: boolean,
) {
  const fullMap = useMemo(() => {
    if (!workbench || workbench.surface !== "evidence") return undefined;
    if (!versionedProvenance || !evidenceModel) return undefined;
    return buildEvidenceCanvasProjection(
      evidenceModel,
      versionedProvenance.collapsedVersionCount,
      undefined,
      versionedProvenance.visibleRefByMemberRef,
    );
  }, [workbench, versionedProvenance, evidenceModel]);

  const canvas = useMemo(() => {
    if (!workbench || workbench.surface !== "evidence") return undefined;
    if (!versionedProvenance || !evidenceModel || !fullMap) {
      return undefined;
    }
    const focus = presentedMemberRef ?? lineageFocus;
    if (!focus) return fullMap;
    return buildEvidenceCanvasProjection(
      evidenceModel,
      versionedProvenance.collapsedVersionCount,
      focus,
      versionedProvenance.visibleRefByMemberRef,
    );
  }, [
    workbench,
    versionedProvenance,
    evidenceModel,
    fullMap,
    lineageFocus,
    presentedMemberRef,
  ]);

  // Kind-filtered projection for the full Evidence canvas. Changing
  // explorationMapKinds triggers a dagre remount — the re-layout on the
  // visible set is intentional (no gaps). workbench stays a dependency:
  // the guard reads it, and the model memos already rebuild on it, so no
  // extra remount can occur.
  const kindProjection = useMemo(() => {
    if (!workbench || workbench.surface !== "evidence") return undefined;
    if (!evidenceModel) return undefined;
    return buildExplorationKindProjection(
      evidenceModel,
      explorationMapKinds,
      versionedProvenance?.collapsedVersionCount ?? 0,
    );
  }, [workbench, evidenceModel, explorationMapKinds, versionedProvenance]);

  const initialFrame = useMemo(() => {
    if (!workbench || workbench.surface !== "evidence") return undefined;
    if (!evidenceModel) return undefined;
    return buildInitialEvidenceFrameProjection(
      evidenceModel,
      explorationMapKinds,
      initialFrameAnchors,
    );
  }, [workbench, evidenceModel, explorationMapKinds, initialFrameAnchors]);

  const mapProjection = showFullMap ? kindProjection : initialFrame;

  return { fullMap, canvas, kindProjection, initialFrame, mapProjection };
}

export function ThreadWorkbench({
  client,
  fleetClient,
  viewerSessionsClient,
  onProjectFocus,
}: ThreadWorkbenchProps): JSX.Element {
  const [workbench, setWorkbench] = useState<EngineeringWorkbenchSnapshot>();
  const [fleet, setFleet] = useState<CockpitFleetProjection>();
  const [viewerSessions, setViewerSessions] = useState<
    ThreadViewerSessionsProjection
  >();
  const [settledViewerSessionsBasisKey, setSettledViewerSessionsBasisKey] =
    useState<
      string
    >();
  const [selection, setSelection] = useState<ThreadRef>();
  const [graphSelection, setGraphSelection] = useState<ThreadGraphSelection>();
  const [lineageFocus, setLineageFocus] = useState<ThreadGraphRef>();
  const [presentedVersionRef, setPresentedVersionRef] = useState<
    ThreadGraphRef
  >();
  const ignoreStageResetUntilRef = useRef(0);
  const [activeView, setActiveView] = useState<ProjectWorkspaceView>(() =>
    parseProjectViewHash(globalThis.location?.hash ?? "")
  );
  const [activeDeepLink, setActiveDeepLink] = useState<
    ProjectDeepLinkTarget | undefined
  >(() => parseProjectLocationHash(globalThis.location?.hash ?? "").target);
  const [followLive, setFollowLive] = useState(true);
  const [streamStatus, setStreamStatus] = useState<
    ThreadStreamStatus | "snapshot"
  >(
    client.subscribe ? "connecting" : "snapshot",
  );
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    onProjectFocus?.(workbench?.project.project.id);
    return () => onProjectFocus?.(undefined);
  }, [onProjectFocus, workbench?.project.project.id]);
  // Evidence is one Graphology + dagre + Sigma canvas. The SVG Map layout
  // is not a second organisation of the same dossier.
  // Profondeur du voisinage en vue locale (façon Obsidian). Décision
  // opérateur 2026-08-08 : défaut 1 — les voisins immédiats seulement.
  const [localDepth, setLocalDepth] = useState<1 | 2 | 3>(1);
  const [verificationCaseFilter, setVerificationCaseFilter] = useState<
    VerificationCaseFilter
  >({ kind: "all" });
  // Panneau burger des réglages du graphe (fermé par défaut).
  // Type visibility for the full-map Exploration view (kind-projection, dagre
  // remounts on change). Default is the current-evidence preset: history,
  // attestation and derived-analysis kinds stay one gesture away.
  const [explorationMapKinds, setExplorationMapKinds] = useState<
    Record<DisplayKind, boolean>
  >({ ...CURRENT_EVIDENCE_KIND_PRESET });
  // Unbounded no-focus map. Default false: the map paints the bounded
  // initial frame; one explicit gesture lifts the bound for this project.
  const [showFullMap, setShowFullMap] = useState(false);
  const showFullMapProjectId = workbench?.project.project.id;
  useEffect(() => {
    setShowFullMap(false);
  }, [showFullMapProjectId]);
  // Type visibility for the local Exploration view (in-place sigma reducer,
  // no re-layout). Defaults: all kinds visible.
  const [explorationLocalKinds, setExplorationLocalKinds] = useState<
    Record<DisplayKind, boolean>
  >({
    "artifact": true,
    "observation": true,
    "requirement": true,
    "evaluation": true,
    "violation": true,
    "change": true,
    "consumption": true,
    "action": true,
    "analysis-node": true,
    "part-definition": true,
    "part-usage": true,
    "attribute-usage": true,
  });
  const snapshotRef = useRef<EngineeringWorkbenchSnapshot>();
  const viewerSessionsRef = useRef<ThreadViewerSessionsProjection>();
  const lastScrolledDeepLinkRef = useRef<string>();

  // Retour arriere et avance du navigateur : le fragment fait autorite sur
  // l'espace affiche, sinon les fleches de l'historique laissent l'URL et le
  // cockpit desynchronises.
  useEffect(() => {
    const syncFromHash = () => {
      const location = parseProjectLocationHash(
        globalThis.location?.hash ?? "",
      );
      if (location.target) lastScrolledDeepLinkRef.current = undefined;
      setActiveView(location.view);
      setActiveDeepLink(location.target);
      focusProjectWorkspace();
    };
    globalThis.addEventListener("popstate", syncFromHash);
    globalThis.addEventListener("hashchange", syncFromHash);
    return () => {
      globalThis.removeEventListener("popstate", syncFromHash);
      globalThis.removeEventListener("hashchange", syncFromHash);
    };
  }, []);

  // Planning has no technical record to inspect. A technical deep link must
  // therefore resolve to the planning overview in both rendered state and the
  // browser URL, without adding a synthetic navigation-history entry.
  useEffect(() => {
    if (workbench?.surface !== "planning") return;
    if (activeView !== "overview") setActiveView("overview");
    if (activeDeepLink !== undefined) setActiveDeepLink(undefined);
    const overviewHash = projectViewHash("overview");
    if (
      globalThis.location &&
      globalThis.history &&
      globalThis.location.hash !== overviewHash
    ) {
      globalThis.history.replaceState(null, "", overviewHash);
    }
  }, [activeDeepLink, activeView, workbench?.surface]);

  // Declared fleet topology is static workspace config: one read at mount,
  // no polling. Absence keeps `fleet` undefined and Operations degrades to
  // thread-observed systems.
  useEffect(() => {
    if (!fleetClient) return;
    const controller = new AbortController();
    fleetClient.load(controller.signal).then((projection) => {
      if (projection) setFleet(projection);
    });
    return () => controller.abort();
  }, [fleetClient]);

  useEffect(() => {
    if (
      !activeDeepLink ||
      !shouldScrollProjectDeepLink(
        lastScrolledDeepLinkRef.current,
        activeDeepLink,
      )
    ) return;
    const scrollKey = projectDeepLinkHash(activeDeepLink);
    const frame = requestAnimationFrame(() => {
      const target = globalThis.document?.getElementById(
        projectDeepLinkDomId(activeDeepLink),
      );
      if (!target) return;
      target.scrollIntoView({ block: "start" });
      lastScrolledDeepLinkRef.current = scrollKey;
    });
    return () => cancelAnimationFrame(frame);
  }, [activeDeepLink, activeView, workbench]);

  useEffect(() => {
    const controller = new AbortController();
    let unsubscribe: (() => void) | undefined;
    setError(undefined);
    client.load(controller.signal).then((next) => {
      snapshotRef.current = next;
      setWorkbench(next);
      if (next.surface !== "evidence") {
        setSelection(undefined);
        setLineageFocus(undefined);
        setGraphSelection(undefined);
        setInspectorOpen(false);
      } else {
        const thread = next.thread;
        const liveNode = activityFeedNodes(thread.graph.nodes)[0];
        const initialSelection: ThreadRef = liveNode?.selection ??
          (thread.violations[0]
            ? { kind: "violation", id: thread.violations[0].id }
            : { kind: "change", id: thread.change.id });
        setSelection(initialSelection);
        // The feed is a chronological journal on entry. Selection supplies
        // a harmless inspector default only; it must not expand a 30-edge
        // lineage before the reviewer explicitly selects an event.
        setLineageFocus(undefined);
        setGraphSelection(undefined);
      }
      if (client.subscribe) {
        unsubscribe = client.subscribe((incoming) => {
          const previous = snapshotRef.current;
          if (
            previous && !shouldAcceptWorkbenchUpdate(previous, incoming) &&
            !shouldAcceptPlanningActivityUpdate(previous, incoming)
          ) {
            return;
          }
          snapshotRef.current = incoming;
          setWorkbench(incoming);
          if (incoming.surface !== "evidence") {
            setSelection(undefined);
            setLineageFocus(undefined);
            setGraphSelection(undefined);
            setInspectorOpen(false);
            return;
          }
          if (previous?.surface !== "evidence") {
            const thread = incoming.thread;
            const liveNode = activityFeedNodes(thread.graph.nodes)[0];
            const initialSelection: ThreadRef = liveNode?.selection ??
              (thread.violations[0]
                ? { kind: "violation", id: thread.violations[0].id }
                : { kind: "change", id: thread.change.id });
            setSelection(initialSelection);
            setLineageFocus(undefined);
            setGraphSelection(undefined);
            return;
          }
          // Following live activity appends/reorders feed entries. It never
          // hijacks the reader's viewport by expanding a new lineage.
        }, setStreamStatus);
      } else {
        setStreamStatus("snapshot");
      }
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      setError(
        reason instanceof Error
          ? reason.message
          : "The linked engineering snapshot could not be loaded.",
      );
    });
    return () => {
      controller.abort();
      unsubscribe?.();
    };
  }, [client]);

  const viewerSessionsBasis = workbench;
  const viewerSessionsBasisKey = viewerSessionsBasis
    ? JSON.stringify([
      viewerSessionsBasis.project.project.id,
      viewerSessionsBasis.project.revision,
      viewerSessionsBasis.project.project.subjectId,
      viewerSessionsBasis.surface === "evidence"
        ? viewerSessionsBasis.thread.id
        : undefined,
      viewerSessionsBasis.surface === "evidence"
        ? viewerSessionsBasis.alignment.currentThreadRevision
        : undefined,
    ])
    : undefined;
  const viewerSessionsPending = Boolean(
    viewerSessionsClient && viewerSessionsBasisKey &&
      settledViewerSessionsBasisKey !== viewerSessionsBasisKey,
  );
  useEffect(() => {
    viewerSessionsRef.current = undefined;
    setViewerSessions(undefined);
    if (
      !viewerSessionsClient || !viewerSessionsBasis || !viewerSessionsBasisKey
    ) return;

    const controller = new AbortController();
    const accept = (incoming: ThreadViewerSessionsProjection) => {
      if (!viewerSessionsMatchWorkbench(incoming, viewerSessionsBasis)) return;
      if (
        !shouldAcceptViewerSessionsUpdate(viewerSessionsRef.current, incoming)
      ) {
        return;
      }
      viewerSessionsRef.current = incoming;
      setViewerSessions(incoming);
      setSettledViewerSessionsBasisKey(viewerSessionsBasisKey);
    };
    viewerSessionsClient.load(controller.signal).then((incoming) => {
      accept(incoming);
      if (!controller.signal.aborted) {
        setSettledViewerSessionsBasisKey(viewerSessionsBasisKey);
      }
    }).catch(() => {
      if (controller.signal.aborted) return;
      // The optional projection settled unavailable. The read-only Workbench
      // falls back to graph records instead of leaving a permanent skeleton.
      setSettledViewerSessionsBasisKey(viewerSessionsBasisKey);
    });
    const unsubscribe = viewerSessionsClient.subscribe?.(accept);
    return () => {
      controller.abort();
      unsubscribe?.();
    };
  }, [
    viewerSessionsBasisKey,
    viewerSessionsClient,
  ]);

  const activityReviewRecords = workbench
    ? buildActivityReviewRecords(
      workbench.project,
      workbench.surface === "evidence" ? workbench.thread : undefined,
    )
    : [];

  // Keep one versioned object graph for the Evidence renderers and their
  // selection state. The Evidence-only removal of closed actions happens
  // before version folding, so the graph passed to sigma and the graph that
  // resolves highlighted edge occurrences are the same objects.
  const presentedMemberRef = presentedVersionRef;

  const evidenceRawGraphMemo = useMemo(() => {
    if (!workbench || workbench.surface !== "evidence") return undefined;
    const thread = workbench.thread;
    const closedIds = new Set(
      buildCurrentProjectWork(workbench.project).closedActionTargetIds,
    );
    return graphWithoutAnalysisOverlay(
      graphWithoutClosedActions(thread.graph, thread.actions, closedIds),
    );
  }, [workbench]);

  const versionedProvenanceMemo = useMemo(() => {
    if (!workbench || workbench.surface !== "evidence") {
      return undefined;
    }
    if (!evidenceRawGraphMemo) return undefined;
    return buildVersionedProvenanceProjection(
      evidenceRawGraphMemo,
      workbench.thread.evidenceFamilyGraph,
      { presentedMemberRef },
    );
  }, [workbench, evidenceRawGraphMemo, presentedMemberRef]);

  const verificationRawGraphMemo = useMemo(() => {
    if (!evidenceRawGraphMemo) return undefined;
    return filterGraphByVerificationCase(
      evidenceRawGraphMemo,
      verificationCaseFilter,
    );
  }, [evidenceRawGraphMemo, verificationCaseFilter]);

  const verificationVersionedProvenanceMemo = useMemo(() => {
    if (!workbench || workbench.surface !== "evidence") return undefined;
    if (!verificationRawGraphMemo) return undefined;
    return buildVersionedProvenanceProjection(
      verificationRawGraphMemo,
      workbench.thread.evidenceFamilyGraph,
      { presentedMemberRef },
    );
  }, [workbench, verificationRawGraphMemo, presentedMemberRef]);

  // Memoize evidenceModel on the workbench + presented version so sigma is
  // not killed on highlight/depth changes. Presenting a family member is a
  // real topology change and must rebuild.
  const evidenceModel = useMemo((): EvidenceGraphModel => {
    if (!workbench || workbench.surface !== "evidence") {
      return null as unknown as EvidenceGraphModel;
    }
    if (!evidenceRawGraphMemo) return null as unknown as EvidenceGraphModel;
    const thread = workbench.thread;
    return buildEvidenceGraphModel(
      evidenceRawGraphMemo,
      thread.evidenceFamilyGraph,
      {
        versionedProjection: versionedProvenanceMemo!,
      },
    );
  }, [workbench, evidenceRawGraphMemo, versionedProvenanceMemo]);

  const verificationEvidenceModelMemo = useMemo((): EvidenceGraphModel => {
    if (
      !workbench || workbench.surface !== "evidence" ||
      !verificationRawGraphMemo || !verificationVersionedProvenanceMemo
    ) {
      return null as unknown as EvidenceGraphModel;
    }
    return buildEvidenceGraphModel(
      verificationRawGraphMemo,
      workbench.thread.evidenceFamilyGraph,
      {
        versionedProjection: verificationVersionedProvenanceMemo,
      },
    );
  }, [
    workbench,
    verificationRawGraphMemo,
    verificationVersionedProvenanceMemo,
  ]);

  // Initial-frame anchors: BFF family-graph current refs (version heads)
  // plus authority artifacts of the catalog's closed current-case
  // selection. Exact recorded membership only; the frame ignores anchors
  // absent from the kind-visible set (e.g. verification-filtered models).
  const initialFrameAnchors = useMemo((): InitialEvidenceFrameAnchors => {
    const empty: InitialEvidenceFrameAnchors = {
      familyCurrentRefs: [],
      caseAuthorityArtifactIds: [],
    };
    if (!workbench || workbench.surface !== "evidence") return empty;
    const familyCurrentRefs = workbench.thread.evidenceFamilyGraph.families
      .flatMap((family) => family.currentRefs);
    const catalog = workbench.thread.engineeringCases;
    if (!catalog) return { familyCurrentRefs, caseAuthorityArtifactIds: [] };
    const currentKeys = new Set(
      catalog.current.map((entry) => entry.currentCaseKey),
    );
    return {
      familyCurrentRefs,
      caseAuthorityArtifactIds: catalog.cases
        .filter((item) => currentKeys.has(item.key))
        .flatMap((item) => item.authorityArtifactIds),
    };
  }, [workbench]);

  const {
    fullMap: fullMapCanvasMemo,
    canvas: evidenceCanvasMemo,
    kindProjection: explorationKindProjectionMemo,
    initialFrame: explorationInitialFrameMemo,
    mapProjection: explorationMapProjectionMemo,
  } = useEvidenceCanvasProjections(
    workbench,
    evidenceModel,
    versionedProvenanceMemo,
    explorationMapKinds,
    lineageFocus,
    presentedMemberRef,
    initialFrameAnchors,
    showFullMap,
  );

  const {
    fullMap: verificationFullMapCanvasMemo,
    canvas: verificationEvidenceCanvasMemo,
    kindProjection: verificationKindProjectionMemo,
    initialFrame: verificationInitialFrameMemo,
    mapProjection: verificationMapProjectionMemo,
  } = useEvidenceCanvasProjections(
    workbench,
    verificationEvidenceModelMemo,
    verificationVersionedProvenanceMemo,
    explorationMapKinds,
    lineageFocus,
    presentedMemberRef,
    initialFrameAnchors,
    showFullMap,
  );

  // Keep one current occurrence index so a controlled keyed selection can
  // remap to the exact recorded relation, or be cleared after SSE if that
  // occurrence disappeared. Raw ids are intentionally absent from this path.
  const graphSelectionIndexMemo = useMemo(() => {
    if (!versionedProvenanceMemo || !evidenceCanvasMemo) return undefined;
    return buildVersionedGraphSelectionIndex(versionedProvenanceMemo);
  }, [versionedProvenanceMemo, evidenceCanvasMemo]);

  const verificationGraphSelectionIndexMemo = useMemo(() => {
    if (
      !verificationVersionedProvenanceMemo ||
      !verificationEvidenceCanvasMemo
    ) return undefined;
    return buildVersionedGraphSelectionIndex(
      verificationVersionedProvenanceMemo,
    );
  }, [
    verificationVersionedProvenanceMemo,
    verificationEvidenceCanvasMemo,
  ]);

  // An occurrence key is an exact selection contract. When a live snapshot
  // changes duplicate cardinality or removes a relation, do not let an inspector
  // retain a previous object or degrade to edge.id: close it deterministically.
  useEffect(() => {
    if (graphSelection?.kind !== "edge" || !graphSelection.occurrence) return;
    const activeVersionedProvenance = activeView === "verification"
      ? verificationVersionedProvenanceMemo
      : versionedProvenanceMemo;
    const activeSelectionIndex = activeView === "verification"
      ? verificationGraphSelectionIndexMemo
      : graphSelectionIndexMemo;
    if (!activeVersionedProvenance || !activeSelectionIndex) return;
    if (
      isStaleAmbiguousVersionedEdgeSelection(
        activeVersionedProvenance,
        graphSelection,
        activeSelectionIndex,
      )
    ) {
      setGraphSelection(undefined);
      setInspectorOpen(false);
    }
  }, [
    activeView,
    graphSelection,
    graphSelectionIndexMemo,
    verificationGraphSelectionIndexMemo,
    versionedProvenanceMemo,
    verificationVersionedProvenanceMemo,
  ]);

  useEffect(() => {
    if (
      !workbench || workbench.surface !== "evidence" ||
      !evidenceRawGraphMemo
    ) return;
    const transientRefs: ThreadGraphRef[] = [];
    if (graphSelection?.kind === "node") {
      transientRefs.push(graphSelection.ref);
    } else if (graphSelection?.kind === "edge" && graphSelection.occurrence) {
      transientRefs.push(
        graphSelection.occurrence.edge.from,
        graphSelection.occurrence.edge.to,
      );
    }
    if (lineageFocus) transientRefs.push(lineageFocus);
    if (presentedVersionRef) transientRefs.push(presentedVersionRef);
    if (inspectorOpen && graphSelection === undefined && selection) {
      const selectedNode = graphNodeForSelection(workbench.thread, selection);
      if (selectedNode) transientRefs.push(selectedNode.ref);
    }
    const reconciliation = reconcileVerificationCaseContext(
      workbench.thread.engineeringCases ??
        UNAVAILABLE_VERIFICATION_CASE_CATALOG,
      evidenceRawGraphMemo,
      verificationCaseFilter,
      transientRefs,
    );
    if (!reconciliation.resetTransientState) return;
    setPresentedVersionRef(undefined);
    setLineageFocus(undefined);
    setGraphSelection(undefined);
    setInspectorOpen(false);
  }, [
    evidenceRawGraphMemo,
    graphSelection,
    inspectorOpen,
    lineageFocus,
    presentedVersionRef,
    selection,
    verificationCaseFilter,
    workbench,
  ]);

  const pushWorkspaceHash = (hash: string) => {
    if (globalThis.location && globalThis.history) {
      if (globalThis.location.hash !== hash) {
        globalThis.history.pushState(null, "", hash);
      }
    }
  };

  const changeView = (next: ProjectWorkspaceView) => {
    lastScrolledDeepLinkRef.current = undefined;
    if (next === "verification" && activeView !== "verification") {
      // Entering Verification from another surface is an explicit new scope.
      // Never carry a previous case/version restriction into that navigation.
      setVerificationCaseFilter({ kind: "all" });
      setPresentedVersionRef(undefined);
    }
    setActiveView(next);
    setActiveDeepLink(undefined);
    // A selected record can belong to another tool surface. Keep the main
    // workspace calm when changing context; explicit inspection reopens this.
    setInspectorOpen(false);
    // Le fragment suit l'espace ouvert : recharger, revenir en arriere ou
    // partager le lien ramene au meme endroit du cockpit.
    pushWorkspaceHash(projectViewHash(next));
    focusProjectWorkspace();
  };

  /**
   * Inspecter est une destination, pas un panneau qui se déplie n'importe où.
   * L'inspecteur vit dans Verification : toute demande d'inspection, d'où
   * qu'elle vienne, y conduit. `changeView` referme le tiroir au passage,
   * la réouverture qui suit est donc volontaire et non un reste d'état.
   */
  const openInspector = () => {
    if (activeView !== "verification") changeView("verification");
    setInspectorOpen(true);
  };

  const openProjectDeepLink = (target: ProjectDeepLinkTarget) => {
    lastScrolledDeepLinkRef.current = undefined;
    const location = parseProjectLocationHash(projectDeepLinkHash(target));
    setActiveView(location.view);
    setActiveDeepLink(target);
    setInspectorOpen(false);
    if (globalThis.location && globalThis.history) {
      const hash = projectDeepLinkHash(target);
      if (globalThis.location.hash !== hash) {
        globalThis.history.pushState(null, "", hash);
      }
    }
    focusProjectWorkspace();
  };

  /**
   * Opens the evidence canvas anchored on the given node ref.
   *
   * Used by:
   *   - The "Open evidence canvas" button in the feed card lineage header
   *     (anchored on the card's own fact — ensures the canvas opens on the
   *     correct node even if lineageFocus drifted due to vignette interactions).
   *   - Node clicks inside the feed vignette (anchored on the clicked node).
   *
   * Flow: setLineageFocus → setGraphSelection → changeView("verification").
   * The evidence canvas then shows the bounded neighbourhood (depth 3) around
   * the anchored ref via buildEvidenceCanvasProjection.
   */
  const openEvidenceAnchored = (ref: ThreadGraphRef) => {
    setVerificationCaseFilter({ kind: "all" });
    setLineageFocus(ref);
    setGraphSelection({ kind: "node", ref });
    changeView("verification");
  };

  if (error) {
    return (
      <Notice title="Engineering project unavailable" tone="danger">
        {error}
      </Notice>
    );
  }
  if (!workbench || (workbench.surface === "evidence" && !selection)) {
    return (
      <div
        className="flex min-h-80 items-center justify-center gap-3 text-sm text-muted-foreground"
        aria-busy="true"
      >
        <span
          className="size-4 shrink-0 animate-spin rounded-full border-2 border-border border-t-foreground"
          aria-hidden="true"
        />
        <div>
          <strong className="block font-medium text-foreground">
            Reading project intent and linked evidence
          </strong>
          <span>No engineering tool is being executed.</span>
        </div>
      </div>
    );
  }

  if (workbench.surface === "planning") {
    // The effect above also normalizes state and URL; this keeps the first
    // planning render correct before that effect has run.
    const planningActiveView: ProjectWorkspaceView = "overview";
    return (
      <PlanningWorkbench
        workbench={workbench}
        viewerSessions={viewerSessions}
        streamStatus={streamStatus}
        activeView={planningActiveView}
        onChangeView={changeView}
      />
    );
  }

  if (workbench.surface === "documentary") {
    return (
      <DocumentaryBaselineWorkbench
        workbench={workbench}
        viewerSessions={viewerSessions}
        streamStatus={streamStatus}
        activeView={activeView}
        onChangeView={changeView}
      />
    );
  }

  const snapshot = workbench.thread;
  const project = workbench.project;
  const agentNow = buildAgentNowPresentation(project);
  const agentHeader = compactAgentHeader(agentNow, project);
  // versionedProvenance and evidenceCanvas are memoized above (guarded
  // useMemo, same pattern as evidenceModel): a stable projection identity is
  // what keeps the sigma instance alive across renders — the visible-depth
  // control and selection highlights must never remount the canvas.
  // We know they are defined here because the planning/documentary early
  // returns have already fired.
  const versionedProvenance = activeView === "verification"
    ? verificationVersionedProvenanceMemo!
    : versionedProvenanceMemo!;
  const evidenceCanvas = activeView === "verification"
    ? verificationEvidenceCanvasMemo!
    : evidenceCanvasMemo!;
  const fullMapCanvas = activeView === "verification"
    ? verificationFullMapCanvasMemo!
    : fullMapCanvasMemo!;
  const graphSelectionIndex = activeView === "verification"
    ? verificationGraphSelectionIndexMemo!
    : graphSelectionIndexMemo!;
  const displayedEvidenceModel = activeView === "verification"
    ? verificationEvidenceModelMemo
    : evidenceModel;
  const displayedMapProjection = activeView === "verification"
    ? verificationMapProjectionMemo
    : explorationMapProjectionMemo;
  // Minimap context stays the unbounded kind projection: the bounded frame
  // may exclude the focused node, which would drop the viewport highlight.
  const displayedMinimapContext = activeView === "verification"
    ? verificationKindProjectionMemo
    : explorationKindProjectionMemo;
  const displayedInitialFrame = activeView === "verification"
    ? verificationInitialFrameMemo
    : explorationInitialFrameMemo;
  const initialFrameOverflow =
    displayedInitialFrame?.initialFrameOverflowCount ?? 0;
  const initialFrameKindVisible = (displayedInitialFrame?.displayedCount ?? 0) +
    initialFrameOverflow;

  // Visible-depth display filter (local view only). The neighbourhood is
  // computed at max depth; here we derive what the chosen depth actually
  // shows for the Evidence banner.
  const depthKey = (ref: ThreadGraphRef) => `${ref.kind}:${ref.id}`;
  const withinLocalDepth = (ref: ThreadGraphRef): boolean => {
    if (!evidenceCanvas.isFiltered) return true;
    const depths = evidenceCanvas.localDepthByRefKey;
    if (depths && (depths.get(depthKey(ref)) ?? 0) > localDepth) return false;
    return true;
  };
  const explorationLocalVisibleCount = evidenceCanvas.isFiltered
    ? evidenceCanvas.nodes.filter((n) =>
      withinLocalDepth(n.ref) && explorationLocalKinds[displayKindOf(n)]
    ).length
    : 0;

  // Compute which DisplayKinds are present in the model (post-fold) so the
  // burger menu only shows toggles for types that actually exist in the data.
  const presentKinds = new Set<DisplayKind>(
    displayedEvidenceModel.nodes.map((n) => displayKindOf(n)),
  );

  // One-gesture scope switch between the current-evidence preset and the
  // complete map. A custom kind mix is neither; the toggle still reaches
  // the full map in one gesture and returns to the preset from there.
  const mapShowsFullScope = isFullEvidenceKindScope(explorationMapKinds);
  const mapShowsCurrentPreset = isCurrentEvidenceKindPreset(
    explorationMapKinds,
  );
  const toggleMapScope = () => {
    setExplorationMapKinds(
      mapShowsFullScope
        ? { ...CURRENT_EVIDENCE_KIND_PRESET }
        : allEvidenceKindsVisible(),
    );
  };

  const currentDecisionEvidence = (decisionId?: string) => {
    const decision = decisionId
      ? project.decisions.find((candidate) => candidate.id === decisionId)
      : undefined;
    if (!decision) return undefined;
    return decision.inputEvidenceRefs.find((reference) =>
      reference.snapshotId === snapshot.id &&
      reference.snapshotRevision === workbench.alignment.currentThreadRevision
    );
  };

  const focusDecisionEvidence = (decisionId?: string) => {
    const reference = currentDecisionEvidence(decisionId);
    if (!reference) return;
    const node = snapshot.graph.nodes.find((candidate) =>
      candidate.ref.kind === reference.kind &&
      candidate.ref.id === reference.id
    );
    if (!node) return;
    setLineageFocus(node.ref);
    setGraphSelection({ kind: "node", ref: node.ref });
    if (node.selection) setSelection(node.selection);
  };

  const openDecisionActivity = (decisionId?: string) => {
    focusDecisionEvidence(decisionId);
    changeView("work");
  };

  const openPublishedEvidence = (reference: ThreadGraphRef) => {
    const node = snapshot.graph.nodes.find((candidate) =>
      candidate.ref.kind === reference.kind && candidate.ref.id === reference.id
    );
    if (!node) return;
    setVerificationCaseFilter({ kind: "all" });
    setLineageFocus(node.ref);
    setGraphSelection({ kind: "node", ref: node.ref });
    if (node.selection) setSelection(node.selection);
    changeView("verification");
  };

  const selectThreadElement = (next: ThreadRef) => {
    setSelection(next);
    const graphNode = graphNodeForSelection(snapshot, next);
    if (graphNode) {
      setLineageFocus(graphNode.ref);
      setGraphSelection({ kind: "node", ref: graphNode.ref });
    }
  };

  const selectGraphNode = (
    node: ThreadGraphNode,
    options: {
      pauseLive?: boolean;
      inspect?: boolean;
      focusLineage?: boolean;
    } = {},
  ) => {
    if (options.pauseLive) {
      setFollowLive(false);
    }
    if (options.focusLineage !== false) {
      setLineageFocus(node.ref);
    }
    setGraphSelection({ kind: "node", ref: node.ref });
    if (options.inspect !== false) {
      openInspector();
    }
    if (node.selection) {
      setSelection(node.selection);
    }
  };

  const selectActivityNode = (
    node: ThreadGraphNode,
    origin: "feed" | "lineage",
  ) => {
    if (
      origin === "feed" && lineageFocus?.kind === node.ref.kind &&
      lineageFocus.id === node.ref.id
    ) {
      setLineageFocus(undefined);
      setGraphSelection(undefined);
      return;
    }
    selectGraphNode(node, {
      pauseLive: true,
      inspect: false,
    });
  };

  const selectPresentedVersion = (node: ThreadGraphNode) => {
    ignoreStageResetUntilRef.current = performance.now() + 1_500;
    setPresentedVersionRef(node.ref);
    selectGraphNode(node);
  };

  const selectVerificationGraphItem = (
    next: ThreadGraphSelection | undefined,
  ) => {
    if (next?.kind === "node") {
      const node = graphNodeByRef(snapshot, next.ref);
      if (node) {
        if (
          !presentedVersionRef ||
          versionedRefKey(node.ref) !== versionedRefKey(presentedVersionRef)
        ) {
          if (performance.now() >= ignoreStageResetUntilRef.current) {
            setPresentedVersionRef(undefined);
          }
        }
        selectGraphNode(node, { focusLineage: false });
      }
      return;
    }
    setGraphSelection(next);
    if (next === undefined) {
      // Sigma remounts under the version-history click and fires clickStage.
      // That is not a user background reset.
      if (performance.now() < ignoreStageResetUntilRef.current) return;
      setPresentedVersionRef(undefined);
      setLineageFocus(undefined);
      setInspectorOpen(false);
    }
    if (next?.kind === "edge") {
      openInspector();
    }
  };

  const changeVerificationCaseFilter = (next: VerificationCaseFilter) => {
    setVerificationCaseFilter(next);
    setPresentedVersionRef(undefined);
    setLineageFocus(undefined);
    setGraphSelection(undefined);
    setInspectorOpen(false);
  };

  const changeFollowLive = (next: boolean) => {
    setFollowLive(next);
  };

  const selectedEdge = graphSelection?.kind === "edge"
    ? edgeForVersionedGraphSelection(
      versionedProvenance,
      graphSelection,
      graphSelectionIndex,
    )
    : undefined;
  const selectedEdgeGroup = graphSelection?.kind === "edge"
    ? versionedEdgeGroupForSelection(
      versionedProvenance,
      graphSelection,
      graphSelectionIndex,
    )
    : undefined;
  const inspectorTarget = resolveRecordInspectorTarget(
    snapshot,
    graphSelection,
    inspectorOpen ? selection : undefined,
  );
  const selectedGraphNode = inspectorTarget.node;
  const inspectorRecord = inspectorTarget.record;
  const selectedVersionFamily = graphSelection?.kind === "node"
    ? versionedProvenance.familyByMemberRef.get(
      versionedRefKey(graphSelection.ref),
    )
    : undefined;

  const inspector = (
    <aside
      id="thread-tool-inspector"
      className="thread-tool-drawer flex min-h-0 flex-col"
      aria-label="Evidence inspector"
    >
      <header className="border-b border-border px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <p className={PAGE_EYEBROW}>
            Inspector
          </p>
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary" className="font-mono text-[9px]">
              Read only
            </Badge>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Close details"
              title="Close details"
              onClick={() => setInspectorOpen(false)}
            >
              <span aria-hidden="true">×</span>
            </Button>
          </div>
        </div>
        <p className="mt-1 truncate text-xs font-medium text-foreground">
          {selectedEdge
            ? "Recorded relation"
            : selectedGraphNode?.label ?? "No record selected"}
        </p>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {selectedEdge
          ? (
            <GraphEdgeInspector
              snapshot={snapshot}
              edge={selectedEdge}
              history={selectedEdgeGroup}
              onSelectGraphNode={selectGraphNode}
            />
          )
          : (
            <>
              {selectedVersionFamily && (
                <EvidenceVersionHistory
                  family={selectedVersionFamily}
                  selectedRef={presentedVersionRef ?? selectedGraphNode?.ref}
                  onSelectVersion={selectPresentedVersion}
                />
              )}
              <RecordInspectorPanel
                snapshot={snapshot}
                node={selectedGraphNode}
                selection={inspectorRecord}
                onSelect={selectThreadElement}
                onSelectGraphNode={selectGraphNode}
              />
            </>
          )}
      </div>
    </aside>
  );

  return (
    <div className="thread-workbench cockpit-surface">
      <ProjectNavigation
        activeView={activeView}
        onChange={changeView}
        status={
          <>
            <span
              className="project-navigation-stream"
              data-state={followLive ? streamStatus : "history"}
              aria-live="polite"
            >
              <i aria-hidden="true" />
              <span className="project-navigation-stream-label">
                {streamStatusLabel(streamStatus, followLive)}
              </span>
            </span>
            <span
              className="project-navigation-agent"
              title={`${agentHeader.label}: ${agentHeader.value}`}
            >
              <span>{agentHeader.label}</span>
              <strong>{agentHeader.value}</strong>
            </span>
            <time
              className="project-navigation-time"
              dateTime={snapshot.generatedAt}
              title={`Projection ${snapshot.generatedAt}`}
            >
              {formatTime(snapshot.generatedAt)}
            </time>
            <Badge
              variant={snapshot.source === "fixture" ? "warning" : "success"}
            >
              {snapshot.sourceLabel}
            </Badge>
          </>
        }
      />

      {workbench.alignment.status === "thread-ahead" && (
        <Notice tone="warning">
          <strong className="block font-medium">
            Project intent needs reconciliation
          </strong>
          <span>
            The technical thread is at revision{" "}
            {workbench.alignment.currentThreadRevision}, while project decisions
            remain anchored to revision{" "}
            {workbench.alignment.projectThreadRevision}.
          </span>
        </Notice>
      )}

      {workbench.unresolvedEvidenceReferences.length > 0 && (
        <Notice tone="warning">
          <strong className="block font-medium">
            {workbench.unresolvedEvidenceReferences.length} evidence{" "}
            {workbench.unresolvedEvidenceReferences.length === 1
              ? "reference does"
              : "references do"} not resolve in this thread revision
          </strong>
          <span>
            These project records cite thread entities or snapshots that the
            exact revision cannot resolve (usually residues of abandoned work).
            The rest of this page resolved.{" "}
            {workbench.unresolvedEvidenceReferences
              .map((issue) => issue.path)
              .join(", ")}
          </span>
        </Notice>
      )}

      {activeView === "overview"
        ? (
          <ProjectOverview
            project={project}
            thread={snapshot}
            viewerSessions={viewerSessions &&
                viewerSessionsMatchWorkbench(viewerSessions, workbench)
              ? viewerSessions
              : undefined}
            viewerSessionsReady={!viewerSessionsClient || Boolean(
              viewerSessions &&
                viewerSessionsMatchWorkbench(viewerSessions, workbench),
            )}
            viewerHierarchyPending={viewerSessionsPending}
            phaseLanes={workbench.projectPath.phaseLanes}
            activities={workbench.projectPath.activities}
            caseActivityJoins={workbench.caseActivityJoins}
            requirementsBriefTraces={workbench.requirementsBriefTraces}
            projectResponse={selectWorkbenchProjectResponse(workbench)}
            onNavigate={changeView}
            onOpenActivity={openDecisionActivity}
            onOpenDeepLink={openProjectDeepLink}
            onOpenEvidence={openPublishedEvidence}
          />
        )
        : (
          <main
            className={`thread-flow-section project-workspace-page is-${activeView}`}
            id="project-workspace-panel"
            tabIndex={-1}
            aria-labelledby="thread-flow-title"
          >
            <div className="project-page-heading mb-5 flex items-end justify-between gap-4 max-md:flex-col max-md:items-start">
              <div className="min-w-0">
                <p className="mb-1 font-mono text-[10px] font-medium uppercase tracking-[.1em] text-brand">
                  {workspaceEyebrow(activeView)}
                </p>
                <h2
                  id="thread-flow-title"
                  className="text-[22px] font-semibold leading-tight tracking-tight"
                >
                  {workspaceTitle(activeView)}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {activeView === "operations"
                    ? operationsHeadline(project)
                    : workspaceDescription(activeView)}
                </p>
              </div>
              <div className="flex shrink-0 items-center justify-end gap-3">
                {activeView === "verification" && (
                  <p className="font-mono text-[9.5px] font-medium uppercase tracking-[.08em] text-muted-foreground max-lg:hidden">
                    double-click node → local view · click background → map
                  </p>
                )}
              </div>
            </div>
            {activeView === "work" && (
              <div className="mb-3">
                <ProjectWorkRibbon project={project} />
              </div>
            )}
            {activeView === "verification" && (
              <>
                <EvidenceCaseNavigator
                  catalog={snapshot.engineeringCases ??
                    UNAVAILABLE_VERIFICATION_CASE_CATALOG}
                  nodes={evidenceRawGraphMemo!.nodes}
                  filter={verificationCaseFilter}
                  onChange={changeVerificationCaseFilter}
                />
                <MetricTiles
                  items={summaryMetrics(
                    snapshot,
                    paintedDossierMetric(displayedEvidenceModel, fullMapCanvas),
                  )}
                />
              </>
            )}
            <div
              className={`thread-graph-workspace ${
                activeView === "verification"
                  ? `is-verification ${inspectorOpen ? "has-inspector" : ""}`
                  : "is-wide"
              }`}
            >
              <div
                className={`thread-graph-stage thread-graph-stage-${activeView}`}
              >
                {activeView === "work"
                  ? (
                    <ThreadFeed
                      nodes={snapshot.graph.nodes}
                      edges={snapshot.graph.edges}
                      focus={lineageFocus}
                      selection={graphSelection}
                      followLive={followLive}
                      streamStatus={streamStatus}
                      threadIdentity={{
                        id: snapshot.id,
                        revision: snapshot.change.revision,
                      }}
                      evidenceModel={evidenceModel}
                      familyGraph={snapshot.evidenceFamilyGraph}
                      reviewRecords={activityReviewRecords}
                      project={project}
                      viewerSessions={viewerSessions}
                      onFollowLiveChange={changeFollowLive}
                      onSelectNode={selectActivityNode}
                      onSelectEdge={(edge) => {
                        setGraphSelection({
                          kind: "edge",
                          id: edge.id,
                          occurrence: {
                            key: versionedProvenance.memberOccurrenceKeyByEdge
                              .get(edge) ?? versionedEdgeOccurrenceKey(edge),
                            edge,
                          },
                        });
                        openInspector();
                      }}
                      onInspect={(next, node) => {
                        setSelection(next);
                        setLineageFocus(node.ref);
                        setGraphSelection({ kind: "node", ref: node.ref });
                        openInspector();
                      }}
                      onOpenEvidenceAnchored={openEvidenceAnchored}
                      onOpenReviewEvidence={openPublishedEvidence}
                    />
                  )
                  : activeView === "verification"
                  ? (
                    <section
                      className="thread-versioned-provenance"
                      aria-labelledby="thread-versioned-provenance-title"
                    >
                      <header className="flex items-start justify-between gap-4 px-5 py-4">
                        <div className="min-w-0 space-y-1">
                          <h4
                            id="thread-versioned-provenance-title"
                            className="text-base font-semibold"
                          >
                            {presentedMemberRef
                              ? "Selected version path"
                              : evidenceCanvas.isFiltered
                              ? `Local evidence · depth ${localDepth}`
                              : mapShowsFullScope
                              ? "Full evidence map"
                              : mapShowsCurrentPreset
                              ? "Current evidence"
                              : "Filtered evidence map"}
                          </h4>
                          <p className="text-sm text-muted-foreground">
                            {presentedMemberRef
                              ? `Depth ${localDepth}; the alternate version stays hidden.`
                              : evidenceCanvas.isFiltered
                              ? "Local view. Select the background to return to the map."
                              : !showFullMap && initialFrameOverflow > 0
                              ? `Bounded initial frame, ${initialFrameOverflow} more outside it. Show all for the complete map.`
                              : mapShowsFullScope
                              ? "Select a record to inspect. Double-click a node to focus its neighbourhood."
                              : mapShowsCurrentPreset
                              ? "Current head entities. Show full history for revisions, attestations and derived analysis."
                              : "Custom kind filter. Show full history for the complete map."}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {!presentedMemberRef &&
                            !evidenceCanvas.isFiltered && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={toggleMapScope}
                              aria-pressed={mapShowsFullScope}
                            >
                              {mapShowsFullScope ? "Current" : "Full history"}
                            </Button>
                          )}
                          {!presentedMemberRef &&
                            !evidenceCanvas.isFiltered &&
                            initialFrameOverflow > 0 && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setShowFullMap((value) => !value)}
                              aria-pressed={showFullMap}
                            >
                              {showFullMap
                                ? "Bounded view"
                                : `Show all ${initialFrameKindVisible}`}
                            </Button>
                          )}
                          <p className="font-mono text-xs text-muted-foreground">
                            {evidenceCanvas.isFiltered
                              ? `${explorationLocalVisibleCount} items shown · local view · depth ${localDepth}`
                              : (() => {
                                const kp = displayedMapProjection ??
                                  evidenceCanvas;
                                const parts: string[] = [
                                  `${kp.displayedCount} items shown`,
                                ];
                                if (
                                  !showFullMap && initialFrameOverflow > 0
                                ) {
                                  parts.push(
                                    `${initialFrameOverflow} outside initial frame`,
                                  );
                                }
                                const totalFolded =
                                  versionedProvenance.collapsedVersionCount;
                                if (totalFolded > 0) {
                                  parts.push(`${totalFolded} folded`);
                                }
                                if (kp.hiddenByKindCount > 0) {
                                  parts.push(
                                    `${kp.hiddenByKindCount} hidden by type`,
                                  );
                                }
                                return parts.join(" · ");
                              })()}
                          </p>
                        </div>
                      </header>
                      <div className="evidence-graph-menu">
                        <DropdownMenu align="end">
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="icon"
                              className="absolute right-3 top-10 size-7"
                              aria-label="Graph settings"
                            >
                              ☰
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuGroup>
                              <DropdownMenuLabel>Show</DropdownMenuLabel>
                              {(Object.keys(
                                DISPLAY_KIND_LABELS,
                              ) as DisplayKind[]).map(
                                (kind) => {
                                  if (!presentKinds.has(kind)) return null;
                                  const currentKinds = evidenceCanvas.isFiltered
                                    ? explorationLocalKinds
                                    : explorationMapKinds;
                                  const setCurrentKinds = evidenceCanvas
                                      .isFiltered
                                    ? setExplorationLocalKinds
                                    : setExplorationMapKinds;
                                  return (
                                    <DropdownMenuCheckboxItem
                                      key={kind}
                                      value={kind}
                                      checked={currentKinds[kind]}
                                      onCheckedChange={(checked) =>
                                        setCurrentKinds((prev) => ({
                                          ...prev,
                                          [kind]: checked === true,
                                        }))}
                                    >
                                      {DISPLAY_KIND_LABELS[kind]}
                                    </DropdownMenuCheckboxItem>
                                  );
                                },
                              )}
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <EvidenceExploration
                        key={`${
                          verificationCaseFilter.kind === "case"
                            ? verificationCaseFilter.caseKey
                            : "all-cases"
                        }:${
                          presentedMemberRef
                            ? `version:${versionedRefKey(presentedMemberRef)}`
                            : "live-map"
                        }`}
                        evidenceModel={displayedEvidenceModel}
                        projection={presentedMemberRef ||
                            evidenceCanvas.isFiltered
                          ? evidenceCanvas
                          : (displayedMapProjection ?? evidenceCanvas)}
                        displayDepth={presentedMemberRef ||
                            evidenceCanvas.isFiltered
                          ? localDepth
                          : undefined}
                        neighborDepth={localDepth}
                        onNeighborDepthChange={setLocalDepth}
                        visibleKinds={presentedMemberRef ||
                            evidenceCanvas.isFiltered
                          ? explorationLocalKinds
                          : undefined}
                        selection={visibleGraphSelection(
                          versionedProvenance,
                          graphSelection,
                          graphSelectionIndex,
                        )}
                        focus={visibleGraphRef(
                          versionedProvenance,
                          presentedMemberRef ?? lineageFocus,
                        )}
                        onSelectionChange={selectVerificationGraphItem}
                        verificationCases={snapshot.engineeringCases ??
                          UNAVAILABLE_VERIFICATION_CASE_CATALOG}
                        verificationCaseNodes={evidenceRawGraphMemo!.nodes}
                        verificationCaseFilter={verificationCaseFilter}
                        onVerificationCaseFilterChange={changeVerificationCaseFilter}
                        fullMapProjection={displayedMinimapContext ??
                          fullMapCanvas}
                        onEnterLocalView={(ref) => {
                          const node = graphNodeByRef(snapshot, ref);
                          if (node) selectGraphNode(node);
                        }}
                      />
                    </section>
                  )
                  : (
                    <ProjectOperations
                      project={project}
                      thread={snapshot}
                      fleet={fleet}
                      onOpenWork={() => changeView("work")}
                    />
                  )}
              </div>
              {activeView === "verification" && inspectorOpen && inspector}
            </div>
          </main>
        )}
    </div>
  );
}

/**
 * Planning receives status-only live milestones without a project revision.
 * The generic evidence comparator intentionally rejects equal-revision
 * planning snapshots, so keep this narrow exception at the composition edge.
 */
function shouldAcceptPlanningActivityUpdate(
  current: EngineeringWorkbenchSnapshot,
  incoming: EngineeringWorkbenchSnapshot,
): boolean {
  return current.surface === "planning" && incoming.surface === "planning" &&
    incoming.planning.activity.version > current.planning.activity.version;
}

function workspaceEyebrow(
  view: Exclude<ProjectWorkspaceView, "overview">,
): string {
  if (view === "work") return "Project · recorded activity";
  if (view === "verification") return "Evidence · verification";
  return "Utility · systems and runs";
}

/** Recorded run and human-attention state; never provider liveness. */
function operationsHeadline(
  project: EngineeringProjectSnapshot,
): string {
  const running =
    project.agentRuns.filter((run) => run.status === "running").length;
  const queued = project.agentRuns.filter((run) => run.status === "queued")
    .length;
  const confirmations = pendingHumanConfirmationDecisions(project).length;
  const preparations = agentPreparationDecisions(project).length;
  return `${running} running · ${queued} queued · ${confirmations} human confirmation${
    confirmations === 1 ? "" : "s"
  } · ${preparations} agent proposal${
    preparations === 1 ? "" : "s"
  } in preparation`;
}

function workspaceTitle(
  view: Exclude<ProjectWorkspaceView, "overview">,
): string {
  if (view === "work") return "Activity";
  if (view === "verification") return "Evidence";
  return "Systems & runs";
}

function workspaceDescription(
  view: Exclude<ProjectWorkspaceView, "overview">,
): string {
  if (view === "work") {
    return "Recorded activity, reviews and lineage.";
  }
  if (view === "verification") {
    return "Start from a verification case, then inspect its exact evidence chain.";
  }
  return "Read-only execution, integrations and record diagnostics.";
}

function EvidenceCaseNavigator({
  catalog,
  nodes,
  filter,
  onChange,
}: {
  catalog: EngineeringCaseCatalog;
  nodes: readonly ThreadGraphNode[];
  filter: VerificationCaseFilter;
  onChange: (filter: VerificationCaseFilter) => void;
}): JSX.Element {
  const cases = buildVerificationCaseLegend(catalog, nodes);
  const statusVariant = catalog.status === "observed"
    ? "success"
    : catalog.status === "unresolved"
    ? "warning"
    : "secondary";
  return (
    <section
      className="evidence-case-navigator mb-4 border-y border-border py-4"
      aria-labelledby="evidence-cases-title"
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className={SECTION_LABEL}>Verification cases</p>
          <h3
            id="evidence-cases-title"
            className="mt-1 text-base font-semibold"
          >
            Start with the engineering question
          </h3>
        </div>
        <Badge variant={statusVariant}>{catalog.status}</Badge>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-2">
        <button
          type="button"
          aria-pressed={filter.kind === "all"}
          className={cn(
            "min-w-0 rounded-lg border p-3 text-left transition-colors",
            filter.kind === "all"
              ? "border-brand bg-brand/[0.04]"
              : "border-border bg-card hover:border-brand/40",
          )}
          onClick={() => onChange({ kind: "all" })}
        >
          <span className="block text-sm font-semibold">
            Complete project record
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {nodes.length} linked evidence items across every recorded case
          </span>
        </button>
        {cases.map((item) => {
          const selected = filter.kind === "case" &&
            filter.caseKey === item.case.key;
          return (
            <button
              key={item.case.key}
              type="button"
              aria-pressed={selected}
              className={cn(
                "min-w-0 rounded-lg border p-3 text-left transition-colors",
                selected
                  ? "border-brand bg-brand/[0.04]"
                  : "border-border bg-card hover:border-brand/40",
              )}
              onClick={() => onChange({ kind: "case", caseKey: item.case.key })}
            >
              <span className="block text-sm font-semibold">
                {sentenceCaseLabel(item.case.family)}
              </span>
              <span className="mt-1 block break-words text-xs text-muted-foreground">
                {item.case.id} · r{item.case.revision} · {item.nodeCount}{" "}
                linked items
              </span>
              <span
                className="mt-2 line-clamp-2 block text-xs text-foreground/75"
                title={item.case.scope}
              >
                {item.case.scope}
              </span>
            </button>
          );
        })}
        {cases.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            No engineering case is recorded in this exact snapshot. Catalog
            status: {catalog.status}.
          </div>
        )}
      </div>
    </section>
  );
}

function sentenceCaseLabel(value: string): string {
  const label = value.replaceAll("-", " ");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

function FactList(
  { items }: { items: readonly FactItem[] },
): JSX.Element {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <div key={item.id} className="contents">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 break-words text-sm">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function MetricTiles(
  { items }: { items: readonly MetricTileItem[] },
): JSX.Element {
  return (
    <div className="mb-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-3">
      {items.map((metric) => (
        <article
          key={metric.id}
          className={cn("p-3", CARD_SURFACE)}
          data-metric={metric.id}
          data-tone={metric.tone ?? "neutral"}
        >
          <p className="text-xs text-muted-foreground">{metric.label}</p>
          <p>
            <strong className="text-xl font-semibold tabular-nums">
              {metric.value}
            </strong>
            {metric.unit && (
              <span className="ml-1 font-mono text-xs text-muted-foreground">
                {metric.unit}
              </span>
            )}
          </p>
          {metric.detail && (
            <p className="text-xs text-muted-foreground">{metric.detail}</p>
          )}
        </article>
      ))}
    </div>
  );
}

function Mono({ children }: { children: ReactNode }): JSX.Element {
  return (
    <code className="font-mono text-xs text-muted-foreground">{children}</code>
  );
}

function GraphEdgeInspector({ snapshot, edge, history, onSelectGraphNode }: {
  snapshot: ThreadWorkbenchSnapshot;
  edge: ThreadGraphEdge;
  history?: VersionedProvenanceEdgeGroup;
  onSelectGraphNode: (node: ThreadGraphNode) => void;
}): JSX.Element {
  const source = graphNodeByRef(snapshot, edge.from);
  const target = graphNodeByRef(snapshot, edge.to);
  const tone: PresentationTone = edge.attestation?.status === "mismatch"
    ? "danger"
    : edge.attestation?.status === "verified"
    ? "success"
    : "info";
  const facts: FactItem[] = [
    { id: "origin", label: "Evidence class", value: edge.origin },
    {
      id: "relation",
      label: "Relation",
      value: <Mono>{edge.relation}</Mono>,
    },
  ];
  if (edge.attestation) {
    facts.push(
      {
        id: "verified",
        label: "Checked",
        value: formatDateTime(edge.attestation.checkedAt),
      },
      {
        id: "producer-hash",
        label: "Producer hash",
        value: <Mono>{edge.attestation.producerFingerprint}</Mono>,
      },
      {
        id: "consumer-hash",
        label: "Consumed hash",
        value: <Mono>{edge.attestation.consumedFingerprint}</Mono>,
      },
    );
  }
  if (edge.analysis) {
    facts.push(
      {
        id: "assertion-id",
        label: "Assertion",
        value: <Mono>{edge.analysis.assertionId}</Mono>,
      },
      {
        id: "epistemic-basis",
        label: "Knowledge basis",
        value: edge.analysis.epistemicBasis,
      },
      {
        id: "asserted-by",
        label: "Asserted by",
        value:
          `${edge.analysis.assertedBy.kind} · ${edge.analysis.assertedBy.id}${
            edge.analysis.assertedBy.version
              ? ` @ ${edge.analysis.assertedBy.version}`
              : ""
          }`,
      },
      {
        id: "analysis-scope",
        label: "Validity scope",
        value: edge.analysis.scope.kind,
      },
      {
        id: "analysis-evidence",
        label: "Exact evidence",
        value: edge.analysis.evidence.map((item) => item.id).join(", "),
      },
    );
    if (edge.analysis.measurement) {
      const measurement = edge.analysis.measurement;
      facts.push({
        id: "analysis-derivative",
        label: "Local derivative",
        value: `${measurement.derivative.value} ${measurement.derivative.unit}`,
      });
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            Selected handoff
          </p>
          <CardTitle className="text-base">
            {relationTitle(edge.relation)}
          </CardTitle>
        </div>
        <Badge variant={TONE_BADGE_VARIANT[tone]}>{edge.origin}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{edge.rationale}</p>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <GraphEndpoint
            label="Source / upstream"
            node={source}
            onSelect={onSelectGraphNode}
          />
          <span aria-hidden="true" className="text-muted-foreground">→</span>
          <GraphEndpoint
            label="Result / downstream"
            node={target}
            onSelect={onSelectGraphNode}
          />
        </div>
        <FactList items={facts} />
        {history && history.members.length > 1 && (
          <details>
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Recorded handoffs ({history.members.length})
            </summary>
            <ul className="mt-2 divide-y divide-border">
              {history.members.map((member, index) => (
                <li key={member.id} className="space-y-0.5 py-2">
                  <strong className="text-sm">
                    {member.id === history.representative.id
                      ? "Current handoff"
                      : `Earlier handoff ${index + 1}`}
                  </strong>
                  <Mono>{relationLabel(member.relation)}</Mono>
                  <p className="text-sm text-muted-foreground">
                    {member.rationale}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        )}
        {edge.attestation && (
          <Notice
            title={edge.attestation.status === "verified"
              ? "Exact consumed bytes verified"
              : "Producer / consumer bytes differ"}
            tone={edge.attestation.status === "verified" ? "success" : "danger"}
          >
            {edge.attestation.status === "verified"
              ? "This handoff is backed by matching producer and consumer fingerprints."
              : "This dependency cannot support a current verdict until the consumer is rerun with the recorded producer bytes."}
          </Notice>
        )}
        {!edge.attestation && edge.analysis
          ? (
            <Notice title="Qualified analysis assertion" tone="info">
              This semantic relation is backed by the exact evidence listed
              above and is classified as{" "}
              {edge.analysis.epistemicBasis}. It does not grant execution
              authority.
            </Notice>
          )
          : !edge.attestation && (
            <Notice title="Recorded semantic relation" tone="info">
              This edge comes from an explicit canonical relation. It is not a
              byte-level consumption attestation.
            </Notice>
          )}
      </CardContent>
    </Card>
  );
}

function GraphEndpoint({ label, node, onSelect }: {
  label: string;
  node?: ThreadGraphNode;
  onSelect: (node: ThreadGraphNode) => void;
}): JSX.Element {
  if (!node) {
    return (
      <div
        className="min-w-0 rounded-lg bg-muted/50 p-3"
        data-missing="true"
      >
        <p className="text-xs text-muted-foreground">{label}</p>
        <strong className="block text-sm">Endpoint unavailable</strong>
      </div>
    );
  }
  return (
    <button
      className="min-w-0 rounded-lg bg-muted/50 p-3 text-left"
      type="button"
      onClick={() => onSelect(node)}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <strong className="block text-sm">{node.label}</strong>
      <span className="font-mono text-xs text-muted-foreground">
        {node.system} · {node.entityKind}
      </span>
    </button>
  );
}

/**
 * A completed replacement closes only the exact action target declared by the
 * project lifecycle projection. The raw action and every attempt stay in the
 * Activity feed and inspector; this calm canvas simply does not offer an
 * already-closed obligation as if it were current work.
 */
function graphWithoutClosedActions(
  graph: ThreadGraphData,
  actions: readonly ThreadAction[],
  closedActionTargetIds: ReadonlySet<string>,
): ThreadGraphData {
  if (closedActionTargetIds.size === 0) return graph;
  const actionById = new Map(actions.map((action) => [action.id, action]));
  const nodes = graph.nodes.filter((node) => {
    if (node.entityKind !== "action") return true;
    const action = actionById.get(node.ref.id);
    return !action || !closedActionTargetIds.has(`artifact:${action.targetId}`);
  });
  const visible = new Set(nodes.map((node) => versionedRefKey(node.ref)));
  return {
    nodes,
    edges: graph.edges.filter((edge) =>
      visible.has(versionedRefKey(edge.from)) &&
      visible.has(versionedRefKey(edge.to))
    ),
  };
}

function summaryMetrics(
  snapshot: ThreadWorkbenchSnapshot,
  painted: ReturnType<typeof paintedDossierMetric>,
): MetricTileItem[] {
  return [
    {
      id: "impact",
      label: "Linked evidence",
      value: painted.itemCount,
      unit: "items",
      detail: linkedEvidenceDetail(painted.componentCount),
      tone: "info",
    },
    {
      id: "records",
      label: "Recorded graph",
      value: snapshot.graph.nodes.length,
      unit: "records",
      detail: `${snapshot.graph.edges.length} explicit relations`,
      tone: "neutral",
    },
    {
      id: "activity",
      label: "Recorded activity",
      value: snapshot.flow.length,
      unit: "entries",
      detail: "chronological identities",
      tone: "neutral",
    },
    {
      id: "history",
      label: "Recorded history",
      value: snapshot.evidenceFamilyGraph.families.length,
      unit: "families",
      detail: snapshot.previous
        ? `previous snapshot ${snapshot.previous.snapshotId}`
        : "no previous snapshot",
      tone: "neutral",
    },
  ];
}

function graphNodeByRef(
  snapshot: ThreadWorkbenchSnapshot,
  reference: ThreadGraphRef,
): ThreadGraphNode | undefined {
  return snapshot.graph.nodes.find((node) =>
    node.ref.kind === reference.kind && node.ref.id === reference.id
  );
}

function relationTitle(relation: ThreadGraphEdge["relation"]): string {
  return relation
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function relationLabel(relation: ThreadGraphEdge["relation"]): string {
  return relation.replaceAll("_", " ").replaceAll("-", " ");
}

function streamStatusLabel(
  status: ThreadStreamStatus | "snapshot",
  followLive: boolean,
): string {
  if (!followLive) return "History under review";
  if (status === "live") return "Validated activity live";
  if (status === "connecting") return "Connecting activity stream";
  if (status === "reconnecting") return "Reconnecting activity stream";
  return "Persisted snapshot";
}

function compactAgentHeader(
  presentation: AgentNowPresentation,
  project: EngineeringProjectSnapshot,
): { label: "Agent now" | "Last agent run"; value: string } {
  if (presentation.kind === "active-run") {
    const work = project.workItems.find((item) =>
      item.id === presentation.run.workItemId
    );
    return {
      label: "Agent now",
      value: work?.title ?? agentRunSummary(project, presentation.run),
    };
  }
  if (presentation.kind === "current-work") {
    return { label: "Agent now", value: presentation.work.title };
  }
  if (presentation.kind === "last-settled-run") {
    return {
      label: "Last agent run",
      value: agentRunSummary(project, presentation.run),
    };
  }
  return { label: "Agent now", value: "No recorded activity" };
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatDateTime(value?: string): string {
  if (!value) return "not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
