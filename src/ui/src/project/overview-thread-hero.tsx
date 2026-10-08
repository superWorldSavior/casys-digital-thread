import { SECTION_LABEL } from "../ui/cockpit.tsx";
import {
  type ProjectWhiteboardHostLease,
  type ProjectWhiteboardRect,
  projectWhiteboardRevealTransform,
  registerProjectWhiteboardHost,
} from "../ui/project-whiteboard-host.ts";
import { cn } from "../lib/utils.ts";
import {
  whiteboardFlowCable,
  whiteboardFlowRadialNode,
  whiteboardMonitor,
  whiteboardMonitorAction,
  whiteboardMonitorPart,
  whiteboardNote,
  whiteboardNoteAction,
  whiteboardNotePart,
  whiteboardNotePin,
  whiteboardNoteState,
  whiteboardToolbar,
  whiteboardToolbarButton,
  whiteboardToolbarPart,
  whiteboardViewer,
  whiteboardViewerPart,
} from "../ui/whiteboard.ts";
import type {
  CSSProperties,
  JSX,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  buildOverviewThreadHero,
  OVERVIEW_LANES,
  type OverviewActivityHeroNode,
  type OverviewHeroEdge,
  type OverviewHeroNode,
  type OverviewRecordedHeroNode,
} from "./overview-thread-hero-model.ts";
import { buildOverviewThreadD3Layout } from "./overview-thread-d3-layout.ts";
import {
  flowGroupCaption,
  OverviewThreadD3Flow,
  type OverviewThreadD3FlowMoveDirection,
  type OverviewThreadStageSummary,
} from "./overview-thread-d3-flow.tsx";
import {
  buildOverviewThreadD3FlowLayout,
  nextHullViewPlacement,
  overviewThreadD3FlowGroupIdentity,
  type OverviewThreadD3FlowGroupLayout,
  type OverviewThreadD3FlowGroupPlacement,
  type OverviewThreadD3FlowHullView,
  type OverviewThreadD3FlowRoutingState,
  rememberOverviewThreadHullPositions,
} from "./overview-thread-d3-flow-layout.ts";
import type { ProjectPathActivityView } from "./model.ts";
import type {
  EngineeringWorkbenchRequirementsBriefTrace,
  ThreadGraphRef,
  ThreadWorkbenchSnapshot,
} from "../thread/types.ts";
import type {
  ThreadViewerSession,
  ThreadViewerSessionsProjection,
} from "../thread/viewer-sessions-client.ts";
import { McpAppFrame } from "../thread/mcp-app-frame.tsx";
import { overviewThreadSelectionConnections } from "./overview-thread-selection-model.ts";
import { OverviewThreadSelectionNote } from "./overview-thread-selection-note.tsx";
import { OverviewThreadRequirementsBriefTrace } from "./overview-thread-requirements-brief-trace.tsx";
import { RequirementHistoricalUnjoinedContext } from "../thread/requirement-historical-unjoined.tsx";
import { selectOverviewHistoricalUnjoined } from "../thread/requirement-historical-unjoined-selection.ts";
import { OverviewThreadBriefSourceNote } from "./overview-thread-brief-source-note.tsx";
import { OverviewSensitivityJourneyDisclosure } from "./overview-sensitivity-journey-note.tsx";
import {
  buildOverviewSensitivityJourneys,
  buildOverviewSensitivityVerdictBindings,
  type OverviewSensitivityJourney,
} from "./overview-sensitivity-journey.ts";
import type { ProjectBriefRevision } from "../../../domain/project/project-brief.ts";
import { overviewHullRowAnchors } from "./overview/hulls/row-anchors.ts";
import { withOverviewCurrentBrief } from "./overview/hulls/current-brief.ts";
import { applyOverviewHullAdapters } from "./overview/hulls/adapters/index.ts";
import { OverviewCurrentBriefDocument } from "./overview-thread-current-brief.tsx";
import {
  overviewCurrentBriefMatches,
  overviewCurrentBriefViewerId,
  overviewCurrentBriefViewerTitle,
} from "./overview-thread-current-brief.ts";
import {
  mergeOverviewViewerAliases,
  overviewDfmCaptureViewerAliases,
} from "./overview-thread-dfm-viewer-discovery.ts";
import {
  overviewCanonicalViewerNodeKey,
  overviewDefaultViewerSessions,
  overviewRequirementSourceViewerAliases,
  type OverviewViewerOpenTarget,
} from "./overview-thread-viewer-discovery.ts";
import {
  activateOverviewHullRow,
  buildOverviewHullContents,
  buildOverviewVersionHistory,
  overviewContextActionPresentationRowKey,
  type OverviewHullContent,
  overviewHullHierarchyPendingPlaceholders,
  overviewHullMappedGraphKey,
  OverviewHullMenuRowBody,
  overviewHullPresentationRowKey,
  overviewHullPresentationRowLookup,
  overviewHullRowActions,
  overviewHullRowPrimaryGraphRef,
  overviewHullStructureRowCounts,
  parseOverviewHullPresentationRowKey,
} from "./overview/hulls/index.ts";
import { layoutOverviewHullRows } from "./overview/hulls/row-layout.ts";
import { overviewActivityStatusCaption } from "./overview/activity-status-caption.ts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuContextTrigger,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "../ui/dropdown-menu.tsx";
import {
  type OverviewThreadWhiteboardPresentationReconciliation,
  type OverviewThreadWhiteboardViewerCapability,
} from "./overview-thread-whiteboard-persistence.ts";
import {
  OVERVIEW_SELECTION_NOTE_GAP,
  OVERVIEW_SELECTION_NOTE_TOP_MARGIN,
  OVERVIEW_WHITEBOARD_INITIAL_TRANSFORM,
  overviewCanvasPointerBecamePan,
  overviewSelectionNoteAnchorFromRects,
  type OverviewSelectionNotePlacement,
  overviewViewerGeometry,
  overviewViewerId,
  type OverviewViewerState,
  type OverviewWhiteboardLayoutMode,
  placeOverviewSelectionNote,
  useOverviewWhiteboardPresentation,
} from "./overview/whiteboard/index.ts";
import {
  overviewThreadNodeContextValue,
  parseOverviewThreadContextTarget,
} from "./overview-thread-context-target.ts";
import {
  fitOverviewThreadWhiteboardTransform,
  nextOverviewWhiteboardTransformOnObservedResize,
  type OverviewThreadWhiteboardBounds,
  overviewThreadWhiteboardContentBounds,
  type OverviewThreadWhiteboardTransform,
  panOverviewThreadWhiteboard,
  resetOverviewThreadWhiteboardTransform,
  zoomOverviewThreadWhiteboardAt,
  zoomOverviewThreadWhiteboardByWheel,
} from "./overview-thread-whiteboard-transform.ts";
import {
  buildOverviewThreadViewerConnectorGeometry,
  normalizeOverviewThreadViewerGeometry,
  type OverviewThreadViewerGeometry,
  overviewThreadViewerScreenDeltaToWorld,
  overviewThreadViewerScreenPointToWorld,
  resizeOverviewThreadViewerByScreenDelta,
  separateOverviewThreadInitialViewer,
  separateOverviewThreadViewers,
} from "./overview-thread-viewer-geometry.ts";

const OVERVIEW_GRAPH_TITLE_ID = "overview-thread-graph-title";
const OVERVIEW_GRAPH_DESCRIPTION_ID = "overview-thread-graph-description";

type OverviewD3Node = ReturnType<
  typeof buildOverviewThreadD3Layout
>["nodes"][number];
type OverviewFlowNode = ReturnType<
  typeof buildOverviewThreadD3FlowLayout
>["nodes"][number];
type OverviewReactWheelEvent = Parameters<
  NonNullable<JSX.IntrinsicElements["div"]["onWheel"]>
>[0];

type OverviewNodeContextAction =
  | {
    readonly kind: "open-session";
    readonly nodeKey: string;
    readonly sessionId: string;
    readonly label: string;
  }
  | {
    readonly kind: "open-evidence";
    readonly reference: ThreadGraphRef;
    readonly label: string;
  }
  | {
    readonly kind: "open-activity";
    readonly label: string;
  }
  | {
    readonly kind: "open-current-brief";
    readonly label: string;
  };

type OverviewOpenSessionContextAction = Extract<
  OverviewNodeContextAction,
  { readonly kind: "open-session" }
>;

interface OverviewViewerDragState {
  readonly viewerId: string;
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly originX: number;
  readonly originY: number;
}

interface OverviewViewerResizeState {
  readonly viewerId: string;
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly originWidth: number;
  readonly originHeight: number;
}

interface OverviewHullMonitorState extends OverviewThreadViewerGeometry {
  readonly groupKey: string;
}

interface OverviewHullMonitorDragState {
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly originX: number;
  readonly originY: number;
}

interface OverviewHullMonitorResizeState {
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly originWidth: number;
  readonly originHeight: number;
}

interface OverviewCanvasPanState {
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  lastClientX: number;
  lastClientY: number;
  moved: boolean;
}

const OVERVIEW_VIEWER_PADDING = 8;
const OVERVIEW_VIEWER_DEFAULT_WIDTH = 620;
const OVERVIEW_VIEWER_DEFAULT_HEIGHT = 460;
const OVERVIEW_VIEWER_MIN_WIDTH = 260;
const OVERVIEW_VIEWER_MIN_HEIGHT = 210;
const OVERVIEW_HULL_MONITOR_WIDTH = 360;
const OVERVIEW_HULL_MONITOR_HEIGHT = 300;

export function OverviewThreadHero({
  thread,
  currentBrief,
  projectId,
  viewerSessions,
  viewerSessionsReady = true,
  viewerHierarchyPending = false,
  requirementsBriefTraces = [],
  activities = [],
  stages = [],
  immersive = false,
  onOpenEvidence,
  onOpenActivity,
}: {
  readonly thread: ThreadWorkbenchSnapshot;
  readonly currentBrief?: ProjectBriefRevision;
  readonly projectId?: string;
  readonly viewerSessions?: ThreadViewerSessionsProjection;
  /** False while the exact current session projection is unknown, not empty. */
  readonly viewerSessionsReady?: boolean;
  /** True only while the current viewer hierarchy request is in flight. */
  readonly viewerHierarchyPending?: boolean;
  /** Optional server-sealed brief clauses for requirements selections. */
  readonly requirementsBriefTraces?:
    readonly EngineeringWorkbenchRequirementsBriefTrace[];
  readonly activities?: readonly ProjectPathActivityView[];
  readonly stages?: readonly OverviewThreadStageSummary[];
  readonly immersive?: boolean;
  readonly onOpenEvidence: (reference: ThreadGraphRef) => void;
  readonly onOpenActivity: () => void;
}): JSX.Element {
  const recordView = useMemo(
    () =>
      withOverviewCurrentBrief(
        buildOverviewThreadHero(thread, activities, requirementsBriefTraces),
        currentBrief,
      ),
    [thread, activities, requirementsBriefTraces, currentBrief],
  );
  const sensitivityJourneys = useMemo(
    () => buildOverviewSensitivityJourneys(thread),
    [thread],
  );
  const sensitivityVerdictBindings = useMemo(
    () => buildOverviewSensitivityVerdictBindings(thread, sensitivityJourneys),
    [sensitivityJourneys, thread],
  );
  const sensitivityJourneysByVerdictNodeKey = useMemo(() => {
    const journeysById = new Map(
      sensitivityJourneys.map((journey) => [journey.id, journey]),
    );
    const grouped = new Map<string, OverviewSensitivityJourney[]>();
    for (const binding of sensitivityVerdictBindings) {
      const journey = journeysById.get(binding.journeyId);
      if (!journey) continue;
      grouped.set(binding.verdictNodeKey, [
        ...grouped.get(binding.verdictNodeKey) ?? [],
        journey,
      ]);
    }
    return grouped;
  }, [sensitivityJourneys, sensitivityVerdictBindings]);
  const sensitivityVerdictNativeDetails = useMemo(() =>
    new Map(
      [...sensitivityJourneysByVerdictNodeKey].map(([nodeKey, journeys]) => [
        nodeKey,
        {
          kind: "sensitivity",
          label: journeys.length === 1
            ? "Sensitivity"
            : `Sensitivity ${journeys.length}`,
          title: journeys.length === 1
            ? "Open the related measured sensitivity FEA"
            : `Open ${journeys.length} related measured sensitivity FEA studies`,
          ariaLabel: journeys.length === 1
            ? "Open related sensitivity FEA"
            : `Open ${journeys.length} related sensitivity FEA studies`,
        },
      ]),
    ), [sensitivityJourneysByVerdictNodeKey]);
  const classifiedRecords = useMemo(
    () =>
      recordView.nodes.flatMap((item) =>
        item.kind === "recorded"
          ? [{
            key: item.key,
            hullKey: overviewThreadD3FlowGroupIdentity(
              item.lane,
              item.groupKey,
            ),
          }]
          : []
      ),
    [recordView.nodes],
  );
  const versionHistory = useMemo(
    () =>
      buildOverviewVersionHistory(
        thread.graph,
        thread.evidenceFamilyGraph,
        classifiedRecords,
      ),
    [
      classifiedRecords,
      thread.evidenceFamilyGraph,
      thread.graph,
    ],
  );
  const view = useMemo(
    () =>
      withOverviewCurrentBrief(
        buildOverviewThreadHero(
          { ...thread, graph: versionHistory.displayedGraph },
          activities,
          requirementsBriefTraces,
        ),
        currentBrief,
      ),
    [
      activities,
      currentBrief,
      requirementsBriefTraces,
      thread,
      versionHistory.displayedGraph,
    ],
  );
  const [whiteboardWorldSize, setWhiteboardWorldSize] = useState({
    width: 1000,
    height: 560,
  });
  // Magnetic corridor membership is transient visual state. It stabilises
  // capture/release across drag frames, but is intentionally excluded from
  // the persisted whiteboard and every Thread authority contract.
  const flowRoutingStateRef = useRef<OverviewThreadD3FlowRoutingState>();
  const viewerAliasRecords = useMemo(
    () =>
      recordView.nodes.flatMap((item) =>
        item.kind === "recorded"
          ? [{
            key: item.key,
            groupKey: item.groupKey,
            isRequirementsCapture: item.isRequirementsCapture,
            ref: item.node.ref,
          }]
          : []
      ),
    [recordView.nodes],
  );
  const dfmAliasRecords = useMemo(
    () =>
      recordView.nodes.flatMap((item) =>
        item.kind === "recorded"
          ? [{
            key: item.key,
            ref: item.node.ref,
            entityKind: item.node.entityKind,
            artifactKind: item.node.artifactKind,
            engineeringCaseRefs: item.node.engineeringCaseRefs,
          }]
          : []
      ),
    [recordView.nodes],
  );
  const viewerAliases = useMemo(
    () =>
      mergeOverviewViewerAliases(
        overviewRequirementSourceViewerAliases(
          viewerAliasRecords,
          thread.graph.edges,
          viewerSessions?.sessions ?? [],
        ),
        overviewDfmCaptureViewerAliases({
          records: dfmAliasRecords,
          artifacts: thread.artifacts,
          edges: thread.graph.edges,
          sessions: viewerSessions?.sessions ?? [],
          catalog: thread.engineeringCases,
        }),
      ),
    [
      dfmAliasRecords,
      thread.artifacts,
      thread.engineeringCases,
      thread.graph.edges,
      viewerAliasRecords,
      viewerSessions,
    ],
  );
  const recordNodesByKey = useMemo(
    () => new Map(recordView.nodes.map((item) => [item.key, item])),
    [recordView.nodes],
  );
  const nodesByKey = useMemo(
    () => new Map(view.nodes.map((item) => [item.key, item])),
    [view.nodes],
  );
  const viewerSessionsByNodeKey = useMemo(() => {
    const sessionsByNodeKey = new Map<
      string,
      readonly ThreadViewerSession[]
    >();
    for (const session of viewerSessions?.sessions ?? []) {
      if (session.anchor.kind === "project-review") continue;
      const nodeKey = overviewThreadGraphRefKey(session.anchor);
      const node = recordNodesByKey.get(nodeKey);
      if (node?.kind !== "recorded") continue;
      const current = sessionsByNodeKey.get(nodeKey) ?? [];
      sessionsByNodeKey.set(nodeKey, [...current, session]);
    }
    return sessionsByNodeKey;
  }, [recordNodesByKey, viewerSessions]);
  const viewerSessionsById = useMemo(
    () =>
      new Map(
        [...viewerSessionsByNodeKey.values()].flat().map((session) => [
          session.id,
          session,
        ]),
      ),
    [viewerSessionsByNodeKey],
  );
  const viewerNodeKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const key of viewerSessionsByNodeKey.keys()) {
      if (nodesByKey.has(key)) keys.add(key);
    }
    for (const key of viewerAliases.keys()) {
      if (nodesByKey.has(key)) keys.add(key);
    }
    return keys;
  }, [nodesByKey, viewerAliases, viewerSessionsByNodeKey]);
  const persistenceGroupKeys = useMemo(
    () => [
      ...new Set(
        recordView.nodes.map((item) =>
          overviewThreadD3FlowGroupIdentity(item.lane, item.groupKey)
        ),
      ),
    ],
    [recordView.nodes],
  );
  const persistenceNodeKeys = useMemo(
    () => recordView.nodes.map((item) => item.key),
    [recordView.nodes],
  );
  const persistenceViewerCapabilities = useMemo(() => {
    const result = Object.create(null) as Record<
      string,
      OverviewThreadWhiteboardViewerCapability
    >;
    for (const item of recordView.nodes) {
      result[item.key] = {
        sessionIds: (viewerSessionsByNodeKey.get(item.key) ?? []).map(
          (session) => session.id,
        ),
      };
    }
    return result;
  }, [recordView.nodes, viewerSessionsByNodeKey]);
  const persistenceReconciliation = useMemo<
    OverviewThreadWhiteboardPresentationReconciliation
  >(() => ({
    groupKeys: persistenceGroupKeys,
    nodeKeys: persistenceNodeKeys,
    viewerCapabilities: persistenceViewerCapabilities,
  }), [
    persistenceGroupKeys,
    persistenceNodeKeys,
    persistenceViewerCapabilities,
  ]);
  const whiteboard = useOverviewWhiteboardPresentation({
    projectId,
    viewerSessionsReady,
    reconciliation: persistenceReconciliation,
  });
  const {
    presentation,
    persistenceProjectId,
    apply,
    markTouched,
    isTouched,
    consumeSkipNextAutoFit,
    reconcileSnapshot,
    rememberHullPositions,
    setGroupPlacements,
    setNodePlacements,
    setWhiteboardTransform,
    setViewers,
    setAutoShownNodeKeys,
    setSelectedKey,
    setSelectedRowKey,
    setSelectionPinned,
    closeSelection,
    clearCanvasSelection,
    setHoveredKey,
    setFocusedKey,
    resetLayout,
  } = whiteboard;
  const {
    layoutMode,
    groupPlacements,
    nodePlacements,
    transform: whiteboardTransform,
    viewers,
    autoShownNodeKeys,
    selectedKey,
    selectedRowKey,
    selectionPinned,
    hoveredKey,
    focusedKey,
    fixedGroupKey,
    hydration: persistenceHydration,
  } = presentation;
  const settledHierarchy = viewerHierarchyPending
    ? undefined
    : viewerSessions?.hierarchy;
  const hullEngineeringCases = useMemo(() => ({
    catalog: thread.engineeringCases,
    sessions: viewerSessions?.sessions ?? [],
    viewerAliases,
  }), [
    thread.engineeringCases,
    viewerAliases,
    viewerSessions,
  ]);
  const hullAdapterContext = useMemo(() => ({
    nodes: view.nodes,
    engineeringCases: hullEngineeringCases,
  }), [
    view.nodes,
    hullEngineeringCases,
  ]);
  const recordHullAdapterContext = useMemo(() => ({
    nodes: recordView.nodes,
    engineeringCases: hullEngineeringCases,
  }), [
    recordView.nodes,
    hullEngineeringCases,
  ]);
  const hullContents = useMemo(
    () =>
      applyOverviewHullAdapters(
        buildOverviewHullContents(
          view.nodes,
          viewerSessions?.sessions ?? [],
          settledHierarchy,
          groupPlacements,
          viewerAliases,
        ),
        { ...hullAdapterContext, currentBrief },
      ),
    [
      view,
      viewerSessions,
      settledHierarchy,
      groupPlacements,
      viewerAliases,
      currentBrief,
      hullAdapterContext,
    ],
  );
  const candidateStructuredRowCounts = useMemo(
    () => overviewHullHierarchyPendingPlaceholders(view.nodes, hullContents),
    [hullContents, view.nodes],
  );
  const pendingHierarchyGroupKeys = useMemo(
    () =>
      viewerHierarchyPending
        ? new Set(candidateStructuredRowCounts.keys())
        : new Set<string>(),
    [candidateStructuredRowCounts, viewerHierarchyPending],
  );
  const groupStructureRowCounts = useMemo(
    () =>
      overviewHullStructureRowCounts(
        hullContents,
        candidateStructuredRowCounts,
      ),
    [hullContents, candidateStructuredRowCounts],
  );
  const recordHullContents = useMemo(() =>
    applyOverviewHullAdapters(
      buildOverviewHullContents(
        recordView.nodes,
        viewerSessions?.sessions ?? [],
        settledHierarchy,
        groupPlacements,
        viewerAliases,
      ),
      recordHullAdapterContext,
    ), [
    recordView.nodes,
    viewerSessions,
    settledHierarchy,
    groupPlacements,
    viewerAliases,
    recordHullAdapterContext,
  ]);
  const groupRowAnchors = useMemo(() =>
    overviewHullRowAnchors(
      hullContents,
      view.nodes,
      settledHierarchy,
    ), [hullContents, view.nodes, settledHierarchy]);
  const availableRowKeys = useMemo(() => {
    const keys: string[] = [];
    for (const [groupKey, content] of hullContents) {
      for (const row of content.rows) {
        keys.push(overviewHullPresentationRowKey(groupKey, row.key));
      }
    }
    return keys;
  }, [hullContents]);
  const radialLayout = useMemo(
    () =>
      buildOverviewThreadD3Layout(
        view.nodes.map(({ key, lane, groupKey, label }) => ({
          key,
          lane,
          groupKey,
          label,
        })),
        view.edges,
        overviewD3LayoutOptions(view.nodes.length),
      ),
    [view.edges, view.nodes],
  );
  const flowLayout = useMemo(
    () =>
      buildOverviewThreadD3FlowLayout(
        view.nodes.map((item) => ({
          key: item.key,
          lane: item.lane,
          groupKey: item.groupKey,
          label: item.label,
          ...(item.kind === "recorded" && item.node.recordedAt
            ? { recordedAt: item.node.recordedAt }
            : {}),
          ...(item.kind === "recorded" && item.parentKey
            ? { parentKey: item.parentKey }
            : {}),
        })),
        view.edges,
        immersive
          ? {
            minHeight: 560,
            topInset: 64,
            bottomInset: 104,
            groupPlacements,
            groupStructureRowCounts,
            groupRowAnchors,
            avoidGroupOverlap: true,
            fixedGroupKey,
            nodePlacements,
            previousRoutingState: flowRoutingStateRef.current,
          }
          : {
            groupPlacements,
            groupStructureRowCounts,
            groupRowAnchors,
            avoidGroupOverlap: true,
            fixedGroupKey,
            nodePlacements,
            previousRoutingState: flowRoutingStateRef.current,
          },
      ),
    [
      fixedGroupKey,
      groupPlacements,
      groupStructureRowCounts,
      groupRowAnchors,
      immersive,
      nodePlacements,
      view.edges,
      view.nodes,
    ],
  );
  const flowLayoutRef = useRef(flowLayout);
  flowLayoutRef.current = flowLayout;
  useEffect(() => {
    flowRoutingStateRef.current = flowLayout.nextRoutingState;
  }, [flowLayout.nextRoutingState]);
  const changeHullPlacement = (
    key: string,
    patch: OverviewThreadD3FlowGroupPlacement,
  ) => {
    setGroupPlacements((current) => {
      const settled = rememberOverviewThreadHullPositions(
        current,
        flowLayoutRef.current.groups,
      );
      return { ...settled, [key]: { ...settled[key], ...patch } };
    }, { fixedGroupKey: key, markTouched: true });
  };
  const changeHullView = (
    key: string,
    view: OverviewThreadD3FlowHullView,
  ) => {
    setGroupPlacements((current) => {
      const settled = rememberOverviewThreadHullPositions(
        current,
        flowLayoutRef.current.groups,
      );
      return {
        ...settled,
        [key]: nextHullViewPlacement(settled[key], view),
      };
    }, { fixedGroupKey: key, markTouched: true });
  };
  const [contextTriggerValue, setContextTriggerValue] = useState<
    string | null
  >(null);
  const [contextPresentationRowKey, setContextPresentationRowKey] = useState<
    string
  >();
  const [hullMonitor, setHullMonitor] = useState<OverviewHullMonitorState>();
  const [selectionNotePlacement, setSelectionNotePlacement] = useState<
    OverviewSelectionNotePlacement
  >();
  const heroRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const projectHostRef = useRef<HTMLDivElement>(null);
  const projectHostLease = useRef<ProjectWhiteboardHostLease>();
  const revealProjectWindow = (rect: ProjectWhiteboardRect) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    markTouched();
    setWhiteboardTransform(projectWhiteboardRevealTransform({
      width: viewport.clientWidth,
      height: viewport.clientHeight,
    }, rect));
  };
  useLayoutEffect(() => {
    const element = projectHostRef.current;
    const viewport = viewportRef.current;
    if (!projectId || !element || !viewport) return;
    const lease = registerProjectWhiteboardHost(projectId, {
      element,
      viewport,
      transform: whiteboardTransform,
      worldSize: whiteboardWorldSize,
      reveal: revealProjectWindow,
    });
    projectHostLease.current = lease;
    return () => {
      lease.dispose();
      if (projectHostLease.current === lease) {
        projectHostLease.current = undefined;
      }
    };
  }, [projectId]);
  useLayoutEffect(() => {
    const element = projectHostRef.current;
    const viewport = viewportRef.current;
    if (!element || !viewport) return;
    projectHostLease.current?.update({
      element,
      viewport,
      transform: whiteboardTransform,
      worldSize: whiteboardWorldSize,
      reveal: revealProjectWindow,
    });
  }, [projectId, whiteboardTransform, whiteboardWorldSize]);
  const fitWhiteboardRef = useRef<() => void>(() => undefined);
  const dragRef = useRef<OverviewViewerDragState>();
  const resizeRef = useRef<OverviewViewerResizeState>();
  const hullMonitorDragRef = useRef<OverviewHullMonitorDragState>();
  const hullMonitorResizeRef = useRef<OverviewHullMonitorResizeState>();
  const canvasPanRef = useRef<OverviewCanvasPanState>();
  const nodeRefs = useRef(
    new Map<string, HTMLButtonElement | SVGGElement>(),
  );
  const viewerRefs = useRef(new Map<string, HTMLElement>());
  const rememberHullPositionsRef = useRef(rememberHullPositions);
  const reconcileSnapshotRef = useRef(reconcileSnapshot);
  const consumeSkipNextAutoFitRef = useRef(consumeSkipNextAutoFit);
  const isTouchedRef = useRef(isTouched);
  const setWhiteboardTransformRef = useRef(setWhiteboardTransform);
  rememberHullPositionsRef.current = rememberHullPositions;
  reconcileSnapshotRef.current = reconcileSnapshot;
  consumeSkipNextAutoFitRef.current = consumeSkipNextAutoFit;
  isTouchedRef.current = isTouched;
  setWhiteboardTransformRef.current = setWhiteboardTransform;
  useLayoutEffect(() => {
    const host = heroRef.current;
    const hasSelection = selectedKey !== undefined ||
      selectedRowKey !== undefined;
    if (!host || !hasSelection) {
      setSelectionNotePlacement(undefined);
      return;
    }
    const update = () => {
      const anchor =
        (selectedRowKey ? nodeRefs.current.get(selectedRowKey) : undefined) ??
          (selectedKey ? nodeRefs.current.get(selectedKey) : undefined);
      if (!anchor) {
        return;
      }
      const note = host.querySelector(".overview-thread-selection-note");
      setSelectionNotePlacement(
        readOverviewSelectionNotePlacement(host, anchor, note),
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    const note = host.querySelector(".overview-thread-selection-note");
    if (note) {
      observer.observe(note);
    }
    return () => observer.disconnect();
  }, [
    selectedKey,
    selectedRowKey,
    whiteboardTransform,
    layoutMode,
    groupPlacements,
    nodePlacements,
  ]);
  useEffect(() => {
    rememberHullPositionsRef.current(flowLayout.groups);
  }, [
    flowLayout.groups,
    persistenceHydration?.projectId,
    persistenceProjectId,
  ]);
  const lastSelectedGraphKeyRef = useRef<string>();
  const availableRowKeysSignatureRef = useRef(availableRowKeys.join("\0"));
  if (selectedKey) lastSelectedGraphKeyRef.current = selectedKey;
  useLayoutEffect(() => {
    const signature = availableRowKeys.join("\0");
    const keysChanged = availableRowKeysSignatureRef.current !== signature;
    availableRowKeysSignatureRef.current = signature;
    const graphKey = selectedKey ??
      (keysChanged ? lastSelectedGraphKeyRef.current : undefined);
    if (!graphKey) return;
    if (selectedRowKey && availableRowKeys.includes(selectedRowKey)) {
      if (keysChanged && !selectedKey) setSelectedKey(graphKey);
      return;
    }
    let mapped: string | undefined;
    let preferred: string | undefined;
    for (const [groupKey, content] of hullContents) {
      for (const row of content.rows) {
        const mappedKey = overviewHullMappedGraphKey(
          groupKey,
          row,
          groupRowAnchors,
          content.rows,
          nodesByKey,
        );
        const matches = mappedKey === graphKey ||
          row.nodeKey === graphKey ||
          row.viewerNodeKey === graphKey;
        if (!matches) continue;
        const rowKey = overviewHullPresentationRowKey(groupKey, row.key);
        mapped ??= rowKey;
        if (row.viewerNodeKey === graphKey) preferred = rowKey;
      }
    }
    const nextRowKey = preferred ?? mapped;
    if (!nextRowKey) return;
    if (nextRowKey !== selectedRowKey) setSelectedRowKey(nextRowKey);
    if (graphKey !== selectedKey) setSelectedKey(graphKey);
  }, [
    availableRowKeys,
    groupRowAnchors,
    hullContents,
    nodesByKey,
    selectedKey,
    selectedRowKey,
    setSelectedKey,
    setSelectedRowKey,
  ]);
  useEffect(() => {
    const availableSessionIds = viewerSessions
      ? viewerSessions.sessions.map((session) => session.id)
      : undefined;
    reconcileSnapshotRef.current({
      displayedKeys: view.nodes.map((item) => item.key),
      recordedKeys: recordView.nodes.map((item) => item.key),
      availableSessionIds,
      currentBriefSnapshotId: currentBrief?.id,
      hierarchyFirstKey: flowLayout.nodes[0]?.key,
      radialFirstKey: radialLayout.nodes[0]?.key,
      availableRowKeys,
    });
  }, [
    availableRowKeys,
    currentBrief?.id,
    flowLayout.nodes,
    layoutMode,
    radialLayout.nodes,
    recordView.nodes,
    view.nodes,
    viewerSessions,
  ]);
  useEffect(() => {
    if (
      persistenceHydration?.projectId !== (persistenceProjectId ?? null)
    ) return;
    if (consumeSkipNextAutoFitRef.current()) return;
    if (isTouchedRef.current()) return;
    const frame = requestAnimationFrame(() => {
      const bounds = readOverviewWhiteboardBounds(
        viewportRef.current,
        worldRef.current,
        [],
        layoutMode === "hierarchy" ? flowLayoutRef.current : undefined,
      );
      setWhiteboardTransformRef.current(
        bounds
          ? fitOverviewThreadWhiteboardTransform(bounds)
          : OVERVIEW_WHITEBOARD_INITIAL_TRANSFORM,
        { touched: false },
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [
    immersive,
    layoutMode,
    persistenceHydration?.projectId,
    persistenceHydration?.restored,
    persistenceProjectId,
    radialLayout.viewBox[2],
    radialLayout.viewBox[3],
    view.nodes.length,
  ]);
  useEffect(() => {
    const viewport = viewportRef.current;
    const world = worldRef.current;
    if (!viewport || !world || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const viewportChanged = entries.some((entry) =>
        entry.target === viewport
      );
      const bounds = readOverviewWhiteboardBounds(
        viewport,
        world,
        [],
        layoutMode === "hierarchy" ? flowLayoutRef.current : undefined,
      );
      if (!bounds) return;
      setWhiteboardWorldSize((current) => {
        const next = {
          width: world.offsetWidth,
          height: world.offsetHeight,
        };
        return current.width === next.width && current.height === next.height
          ? current
          : next;
      });
      setWhiteboardTransformRef.current((current) =>
        nextOverviewWhiteboardTransformOnObservedResize({
          viewportChanged,
          touched: isTouchedRef.current(),
          current,
          bounds,
        })
      );
    });
    observer.observe(viewport);
    observer.observe(world);
    return () => observer.disconnect();
  }, [immersive, layoutMode]);
  const activeKey = hoveredKey ?? selectedKey;
  const selectedItem = selectedKey ? nodesByKey.get(selectedKey) : undefined;
  const selectedSensitivityJourneys = selectedItem?.kind === "recorded"
    ? sensitivityJourneysByVerdictNodeKey.get(selectedItem.key) ?? []
    : [];
  const selectedHistoricalUnjoined = selectedItem?.kind === "recorded"
    ? selectOverviewHistoricalUnjoined(thread, selectedItem.node.ref)
    : undefined;
  const selectedPresentation = selectedRowKey
    ? parseOverviewHullPresentationRowKey(selectedRowKey)
    : undefined;
  const selectedHullRow = selectedPresentation
    ? hullContents.get(selectedPresentation.groupKey)?.rows.find((row) =>
      row.key === selectedPresentation.rowKey
    )
    : undefined;
  const selectedBriefSection =
    selectedHullRow?.nativeAction === "open-current-brief"
      ? selectedHullRow
      : undefined;
  const selectedConnections = useMemo(
    () =>
      selectedKey
        ? overviewThreadSelectionConnections(thread.graph, selectedKey)
        : [],
    [selectedKey, thread.graph],
  );
  const relatedKeys = useMemo(
    () => overviewRelatedNodeKeys(view.edges, activeKey),
    [view.edges, activeKey],
  );
  const toggleSelection = (item: OverviewHeroNode) => {
    apply({ type: "selection-toggled", key: item.key });
  };
  const bringViewerFront = (viewerId: string) => {
    setViewers((current) => {
      const top = Math.max(0, ...current.map((viewer) => viewer.z)) + 1;
      return current.map((viewer) =>
        viewer.id === viewerId ? { ...viewer, z: top } : viewer
      );
    });
  };
  const openViewer = (
    request: {
      readonly kind: "session";
      readonly nodeKey: string;
      readonly sessionId: string;
      readonly presentationRowKey?: string;
    },
    automatic = false,
  ) => {
    const session = viewerSessionsById.get(request.sessionId);
    const nodeKey = session
      ? overviewCanonicalViewerNodeKey(session) ?? request.nodeKey
      : request.nodeKey;
    if (!recordNodesByKey.has(nodeKey)) return;
    const resolved = { ...request, nodeKey };
    const id = overviewViewerId(resolved);
    setAutoShownNodeKeys((current) =>
      current.includes(resolved.nodeKey)
        ? current
        : [...current, resolved.nodeKey]
    );
    setViewers((current) => {
      const top = Math.max(0, ...current.map((viewer) => viewer.z)) + 1;
      if (current.some((viewer) => viewer.id === id)) {
        return current.map((viewer) =>
          viewer.id === id ? { ...viewer, z: top } : viewer
        );
      }
      const world = worldRef.current;
      const viewport = viewportRef.current;
      const anchor = (request.presentationRowKey
        ? nodeRefs.current.get(request.presentationRowKey)
        : undefined) ??
        nodeRefs.current.get(resolved.nodeKey);
      const viewportBounds = viewport?.getBoundingClientRect();
      const anchorBounds = anchor?.getBoundingClientRect();
      const worldWidth = world?.offsetWidth ?? whiteboardWorldSize.width;
      const worldHeight = world?.offsetHeight ?? whiteboardWorldSize.height;
      const anchorPoint = viewportBounds && anchorBounds
        ? overviewThreadViewerScreenPointToWorld(
          {
            x: anchorBounds.left + anchorBounds.width / 2 -
              viewportBounds.left,
            y: anchorBounds.top + anchorBounds.height / 2 -
              viewportBounds.top,
          },
          whiteboardTransform,
        )
        : { x: worldWidth / 2, y: worldHeight / 2 };
      const cascade = current.length % 6;
      const width = Math.min(
        OVERVIEW_VIEWER_DEFAULT_WIDTH,
        Math.max(180, worldWidth - OVERVIEW_VIEWER_PADDING * 2),
      );
      const height = Math.min(
        OVERVIEW_VIEWER_DEFAULT_HEIGHT,
        Math.max(160, worldHeight - OVERVIEW_VIEWER_PADDING * 2),
      );
      const geometry = normalizeOverviewThreadViewerGeometry(
        initialOverviewViewerGeometry(
          anchorPoint,
          { width, height },
          { width: worldWidth, height: worldHeight },
          cascade,
        ),
        overviewViewerGeometryConstraints(),
      );
      return separateOverviewThreadViewers([...current, {
        ...resolved,
        id,
        ...(request.presentationRowKey
          ? { presentationRowKey: request.presentationRowKey }
          : {}),
        ...(automatic
          ? separateOverviewThreadInitialViewer(geometry, current, worldWidth)
          : geometry),
        z: top,
      } as OverviewViewerState], id);
    });
    closeSelection();
    setHoveredKey(undefined);
    setFocusedKey(undefined);
    requestAnimationFrame(() => viewerRefs.current.get(id)?.focus());
  };
  const openCurrentBriefViewer = (presentationRowKey?: string) => {
    if (!currentBrief) return;
    const id = overviewCurrentBriefViewerId(currentBrief.id);
    setViewers((current) => {
      const top = Math.max(0, ...current.map((viewer) => viewer.z)) + 1;
      const existing = current.find((viewer) => viewer.id === id);
      if (existing) {
        return current.map((viewer) =>
          viewer.id === id
            ? {
              ...viewer,
              z: top,
              ...(presentationRowKey ? { presentationRowKey } : {}),
            }
            : viewer
        );
      }
      const world = worldRef.current;
      const viewport = viewportRef.current;
      const anchor = presentationRowKey
        ? nodeRefs.current.get(presentationRowKey)
        : undefined;
      const viewportBounds = viewport?.getBoundingClientRect();
      const anchorBounds = anchor?.getBoundingClientRect();
      const worldWidth = world?.offsetWidth ?? whiteboardWorldSize.width;
      const worldHeight = world?.offsetHeight ?? whiteboardWorldSize.height;
      const anchorPoint = viewportBounds && anchorBounds
        ? overviewThreadViewerScreenPointToWorld(
          {
            x: anchorBounds.left + anchorBounds.width / 2 -
              viewportBounds.left,
            y: anchorBounds.top + anchorBounds.height / 2 -
              viewportBounds.top,
          },
          whiteboardTransform,
        )
        : { x: worldWidth / 2, y: worldHeight / 2 };
      const geometry = normalizeOverviewThreadViewerGeometry(
        initialOverviewViewerGeometry(
          anchorPoint,
          {
            width: Math.min(
              OVERVIEW_VIEWER_DEFAULT_WIDTH,
              Math.max(180, worldWidth - OVERVIEW_VIEWER_PADDING * 2),
            ),
            height: Math.min(
              OVERVIEW_VIEWER_DEFAULT_HEIGHT,
              Math.max(160, worldHeight - OVERVIEW_VIEWER_PADDING * 2),
            ),
          },
          { width: worldWidth, height: worldHeight },
          current.length % 6,
        ),
        overviewViewerGeometryConstraints(),
      );
      return separateOverviewThreadViewers([...current, {
        kind: "current-brief",
        id,
        briefSnapshotId: currentBrief.id,
        ...(presentationRowKey ? { presentationRowKey } : {}),
        ...geometry,
        z: top,
      }], id);
    });
    requestAnimationFrame(() => viewerRefs.current.get(id)?.focus());
  };
  const runContextAction = (
    action: OverviewNodeContextAction,
    presentationRowKey?: string,
  ) => {
    if (action.kind === "open-session") {
      const openingRowKey = overviewContextActionPresentationRowKey(
        presentationRowKey,
      );
      openViewer({
        kind: "session",
        nodeKey: action.nodeKey,
        sessionId: action.sessionId,
        ...(openingRowKey ? { presentationRowKey: openingRowKey } : {}),
      });
      return;
    }
    if (action.kind === "open-current-brief") {
      openCurrentBriefViewer(
        overviewContextActionPresentationRowKey(presentationRowKey),
      );
      return;
    }
    if (action.kind === "open-evidence") {
      onOpenEvidence(action.reference);
      return;
    }
    onOpenActivity();
  };
  useEffect(() => {
    if (
      !viewerSessionsReady || !persistenceHydration?.viewersRestored ||
      persistenceHydration.projectId !== (persistenceProjectId ?? null)
    ) return;
    const sessions = [...viewerSessionsById.values()];
    if (sessions.length > 1 && viewerSessions?.hierarchy === undefined) return;
    const unseen = sessions.filter((session) =>
      session.anchor.kind !== "project-review" &&
      !autoShownNodeKeys.includes(overviewThreadGraphRefKey(session.anchor))
    );
    if (unseen.length === 0) return;
    const unseenIds = new Set(unseen.map((session) => session.id));
    const displayedKeys = new Set(view.nodes.map((item) => item.key));
    const defaults = overviewDefaultViewerSessions(
      sessions,
      viewerSessions?.hierarchy,
    )
      .filter((session) =>
        session.anchor.kind !== "project-review" &&
        unseenIds.has(session.id) &&
        displayedKeys.has(overviewThreadGraphRefKey(session.anchor))
      );
    for (const session of defaults) {
      if (session.anchor.kind === "project-review") continue;
      openViewer({
        kind: "session",
        nodeKey: overviewThreadGraphRefKey(session.anchor),
        sessionId: session.id,
      }, true);
    }
    setAutoShownNodeKeys((
      current,
    ) => [
      ...new Set([
        ...current,
        ...unseen.flatMap((session) =>
          session.anchor.kind === "project-review"
            ? []
            : [overviewThreadGraphRefKey(session.anchor)]
        ),
      ]),
    ]);
    if (defaults.length > 0) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => fitWhiteboardRef.current())
      );
    }
  }, [
    autoShownNodeKeys,
    persistenceHydration,
    persistenceProjectId,
    view.nodes,
    viewerSessions,
    viewerSessionsById,
    viewerSessionsReady,
  ]);
  const closeViewer = (viewerId: string) => {
    const viewer = viewers.find((candidate) => candidate.id === viewerId);
    setViewers((current) => current.filter((viewer) => viewer.id !== viewerId));
    if (viewer?.kind === "session") {
      setFocusedKey(viewer.nodeKey);
      requestAnimationFrame(() =>
        nodeRefs.current.get(viewer.nodeKey)?.focus()
      );
    }
  };
  const beginViewerDrag = (
    event: ReactPointerEvent<HTMLElement>,
    viewer: OverviewViewerState,
  ) => {
    if (
      event.button !== 0 || viewer.restoreGeometry ||
      (event.target as Element).closest("button")
    ) return;
    event.stopPropagation();
    dragRef.current = {
      viewerId: viewer.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: viewer.x,
      originY: viewer.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    bringViewerFront(viewer.id);
  };
  const moveViewer = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    setViewers((current) =>
      separateOverviewThreadViewers(
        current.map((viewer) => {
          if (viewer.id !== drag.viewerId) return viewer;
          const delta = overviewThreadViewerScreenDeltaToWorld(
            {
              x: event.clientX - drag.startClientX,
              y: event.clientY - drag.startClientY,
            },
            whiteboardTransform,
          );
          const geometry = normalizeOverviewThreadViewerGeometry(
            {
              ...viewer,
              x: drag.originX + delta.x,
              y: drag.originY + delta.y,
            },
            overviewViewerGeometryConstraints(),
          );
          return { ...viewer, ...geometry };
        }),
        drag.viewerId,
      )
    );
  };
  const endViewerDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const beginViewerResize = (
    event: ReactPointerEvent<HTMLButtonElement>,
    viewer: OverviewViewerState,
  ) => {
    if (viewer.restoreGeometry || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = {
      viewerId: viewer.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originWidth: viewer.width,
      originHeight: viewer.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    bringViewerFront(viewer.id);
  };
  const moveViewerResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    setViewers((current) =>
      separateOverviewThreadViewers(
        current.map((viewer) => {
          if (viewer.id !== resize.viewerId) return viewer;
          const geometry = resizeOverviewThreadViewerByScreenDelta(
            {
              ...viewer,
              width: resize.originWidth,
              height: resize.originHeight,
            },
            {
              x: event.clientX - resize.startClientX,
              y: event.clientY - resize.startClientY,
            },
            whiteboardTransform,
            overviewViewerGeometryConstraints(),
          );
          return { ...viewer, ...geometry };
        }),
        resize.viewerId,
      )
    );
  };
  const endViewerResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (resizeRef.current?.pointerId !== event.pointerId) return;
    resizeRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const beginHullMonitorDrag = (
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (
      event.button !== 0 || !hullMonitor ||
      (event.target as Element).closest("button")
    ) return;
    event.stopPropagation();
    hullMonitorDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: hullMonitor.x,
      originY: hullMonitor.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveHullMonitor = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = hullMonitorDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = overviewThreadViewerScreenDeltaToWorld(
      {
        x: event.clientX - drag.startClientX,
        y: event.clientY - drag.startClientY,
      },
      whiteboardTransform,
    );
    setHullMonitor((current) =>
      current
        ? {
          ...current,
          ...normalizeOverviewThreadViewerGeometry(
            {
              ...current,
              x: drag.originX + delta.x,
              y: drag.originY + delta.y,
            },
            overviewViewerGeometryConstraints(),
          ),
        }
        : current
    );
  };
  const endHullMonitorDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (hullMonitorDragRef.current?.pointerId !== event.pointerId) return;
    hullMonitorDragRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const beginHullMonitorResize = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0 || !hullMonitor) return;
    event.preventDefault();
    event.stopPropagation();
    hullMonitorResizeRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originWidth: hullMonitor.width,
      originHeight: hullMonitor.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveHullMonitorResize = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const resize = hullMonitorResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    setHullMonitor((current) =>
      current
        ? {
          ...current,
          ...resizeOverviewThreadViewerByScreenDelta(
            {
              ...current,
              width: resize.originWidth,
              height: resize.originHeight,
            },
            {
              x: event.clientX - resize.startClientX,
              y: event.clientY - resize.startClientY,
            },
            whiteboardTransform,
            overviewViewerGeometryConstraints(),
          ),
        }
        : current
    );
  };
  const endHullMonitorResize = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (hullMonitorResizeRef.current?.pointerId !== event.pointerId) return;
    hullMonitorResizeRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const moveHullMonitorByKeyboard = (
    direction: OverviewThreadD3FlowMoveDirection,
  ) => {
    const delta = overviewThreadViewerScreenDeltaToWorld(
      overviewDirectionDelta(direction, 18),
      whiteboardTransform,
    );
    setHullMonitor((current) =>
      current
        ? {
          ...current,
          ...normalizeOverviewThreadViewerGeometry(
            {
              ...current,
              x: current.x + delta.x,
              y: current.y + delta.y,
            },
            overviewViewerGeometryConstraints(),
          ),
        }
        : current
    );
  };
  const toggleViewerExpanded = (viewerId: string) => {
    const viewport = viewportRef.current;
    const visibleTopLeft = viewport
      ? overviewThreadViewerScreenPointToWorld(
        { x: OVERVIEW_VIEWER_PADDING, y: OVERVIEW_VIEWER_PADDING },
        whiteboardTransform,
      )
      : { x: OVERVIEW_VIEWER_PADDING, y: OVERVIEW_VIEWER_PADDING };
    const visibleBottomRight = viewport
      ? overviewThreadViewerScreenPointToWorld(
        {
          x: viewport.clientWidth - OVERVIEW_VIEWER_PADDING,
          y: viewport.clientHeight - OVERVIEW_VIEWER_PADDING,
        },
        whiteboardTransform,
      )
      : {
        x: whiteboardWorldSize.width - OVERVIEW_VIEWER_PADDING,
        y: whiteboardWorldSize.height - OVERVIEW_VIEWER_PADDING,
      };
    setViewers((current) =>
      separateOverviewThreadViewers(
        current.map((viewer) => {
          if (viewer.id !== viewerId) return viewer;
          if (viewer.restoreGeometry) {
            return {
              ...viewer,
              ...viewer.restoreGeometry,
              restoreGeometry: undefined,
            };
          }
          const restoreGeometry = overviewViewerGeometry(viewer);
          return {
            ...viewer,
            x: visibleTopLeft.x,
            y: visibleTopLeft.y,
            width: Math.max(
              OVERVIEW_VIEWER_MIN_WIDTH,
              visibleBottomRight.x - visibleTopLeft.x,
            ),
            height: Math.max(
              OVERVIEW_VIEWER_MIN_HEIGHT,
              visibleBottomRight.y - visibleTopLeft.y,
            ),
            restoreGeometry,
          };
        }),
        viewerId,
      )
    );
    bringViewerFront(viewerId);
  };
  const moveViewerByKeyboard = (
    viewerId: string,
    direction: OverviewThreadD3FlowMoveDirection,
  ) => {
    const delta = overviewThreadViewerScreenDeltaToWorld(
      overviewDirectionDelta(direction, 18),
      whiteboardTransform,
    );
    setViewers((current) =>
      separateOverviewThreadViewers(
        current.map((viewer) =>
          viewer.id === viewerId && !viewer.restoreGeometry
            ? {
              ...viewer,
              ...normalizeOverviewThreadViewerGeometry(
                {
                  ...viewer,
                  x: viewer.x + delta.x,
                  y: viewer.y + delta.y,
                },
                overviewViewerGeometryConstraints(),
              ),
            }
            : viewer
        ),
        viewerId,
      )
    );
  };
  const resizeViewerByKeyboard = (
    viewerId: string,
    direction: OverviewThreadD3FlowMoveDirection,
  ) => {
    const delta = overviewThreadViewerScreenDeltaToWorld(
      overviewDirectionDelta(direction, 18),
      whiteboardTransform,
    );
    setViewers((current) =>
      separateOverviewThreadViewers(
        current.map((viewer) =>
          viewer.id === viewerId && !viewer.restoreGeometry
            ? {
              ...viewer,
              ...normalizeOverviewThreadViewerGeometry(
                {
                  ...viewer,
                  width: viewer.width + delta.x,
                  height: viewer.height + delta.y,
                },
                overviewViewerGeometryConstraints(),
              ),
            }
            : viewer
        ),
        viewerId,
      )
    );
  };
  const fitWhiteboard = () => {
    const bounds = readOverviewWhiteboardBounds(
      viewportRef.current,
      worldRef.current,
      viewers,
      layoutMode === "hierarchy" ? flowLayout : undefined,
    );
    if (!bounds) return;
    setWhiteboardTransform(fitOverviewThreadWhiteboardTransform(bounds), {
      touched: false,
    });
  };
  const changeLayoutMode = (next: OverviewWhiteboardLayoutMode) => {
    whiteboard.changeLayoutMode(next);
  };
  fitWhiteboardRef.current = fitWhiteboard;
  const zoomWhiteboard = (factor: number) => {
    const viewport = viewportRef.current;
    const bounds = readOverviewWhiteboardBounds(viewport, worldRef.current);
    if (!viewport || !bounds) return;
    markTouched();
    setWhiteboardTransform((current) =>
      zoomOverviewThreadWhiteboardAt(
        current,
        { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 },
        current.k * factor,
        bounds,
      )
    );
  };
  const resetWhiteboard = () => {
    const bounds = readOverviewWhiteboardBounds(
      viewportRef.current,
      worldRef.current,
    );
    resetLayout(
      bounds
        ? resetOverviewThreadWhiteboardTransform(bounds)
        : OVERVIEW_WHITEBOARD_INITIAL_TRANSFORM,
    );
    requestAnimationFrame(fitWhiteboard);
  };
  const handleWhiteboardWheel = (
    event: OverviewReactWheelEvent,
  ) => {
    if (
      (event.target as Element).closest(
        ".overview-thread-viewer, .overview-thread-hull-monitor, [data-project-whiteboard-host]",
      )
    ) return;
    const viewport = viewportRef.current;
    const bounds = readOverviewWhiteboardBounds(viewport, worldRef.current);
    if (!viewport || !bounds) return;
    event.preventDefault();
    const viewportBounds = viewport.getBoundingClientRect();
    const deltaMultiplier = event.deltaMode === 1
      ? 16
      : event.deltaMode === 2
      ? viewport.clientHeight
      : 1;
    markTouched();
    setWhiteboardTransform((current) =>
      zoomOverviewThreadWhiteboardByWheel(
        current,
        {
          x: event.clientX - viewportBounds.left,
          y: event.clientY - viewportBounds.top,
        },
        event.deltaY * deltaMultiplier,
        { minScale: bounds.minScale, maxScale: bounds.maxScale },
      )
    );
  };
  const beginCanvasPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as Element;
    if (
      target.closest(
        "button, [role='button'], .overview-thread-viewer, .overview-thread-hull-monitor, [data-project-whiteboard-host]",
      )
    ) return;
    markTouched();
    canvasPanRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveCanvasPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = canvasPanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    if (
      !pan.moved &&
      !overviewCanvasPointerBecamePan(
        { x: pan.startClientX, y: pan.startClientY },
        { x: event.clientX, y: event.clientY },
      )
    ) return;
    pan.moved = true;
    const delta = {
      x: event.clientX - pan.lastClientX,
      y: event.clientY - pan.lastClientY,
    };
    pan.lastClientX = event.clientX;
    pan.lastClientY = event.clientY;
    event.preventDefault();
    setWhiteboardTransform((current) =>
      panOverviewThreadWhiteboard(current, delta)
    );
  };
  const endCanvasPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = canvasPanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const wasPan = pan.moved;
    canvasPanRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!wasPan && event.type === "pointerup") clearCanvasSelection();
  };
  const moveFocus = (key: string) => {
    setFocusedKey(key);
    requestAnimationFrame(() => nodeRefs.current.get(key)?.focus());
  };
  const [viewBoxX, viewBoxY, viewBoxWidth, viewBoxHeight] =
    radialLayout.viewBox;
  const unroutedEdgeCount = layoutMode === "hierarchy"
    ? flowLayout.unroutedEdgeKeys.length
    : radialLayout.unroutedEdgeKeys.length;
  const contextTarget = parseOverviewThreadContextTarget(contextTriggerValue);
  const contextNode = contextTarget?.kind === "node"
    ? nodesByKey.get(contextTarget.key)
    : undefined;
  const contextGroup = contextTarget?.kind === "group"
    ? flowLayout.groups.find((group) => group.key === contextTarget.key)
    : contextNode
    ? flowLayout.groups.find((group) =>
      group.key ===
        overviewThreadD3FlowGroupIdentity(
          contextNode.lane,
          contextNode.groupKey,
        )
    )
    : undefined;
  const contextActions = contextNode
    ? overviewNodeContextActions(
      contextNode,
      viewerSessionsByNodeKey,
      viewerAliases,
    )
    : [];
  const selectNode = (key: string) => {
    if (!nodesByKey.has(key)) return;
    setSelectedRowKey(undefined);
    setSelectedKey(key);
    setHoveredKey(key);
    setFocusedKey(key);
    requestAnimationFrame(() => nodeRefs.current.get(key)?.focus());
  };
  const commitContextTargetBeforeOpen = (
    value: string | null | undefined,
  ) => {
    if (!parseOverviewThreadContextTarget(value)) return;
    flushSync(() => setContextTriggerValue(value!));
  };
  const rememberContextPresentationRow = (
    target: Element | null | undefined,
  ) => {
    const fromRow = overviewPresentationRowKeyFromTarget(target);
    if (fromRow) {
      setContextPresentationRowKey(fromRow);
      return;
    }
    if (
      target?.closest(
        ".overview-thread-context-menu, .overview-thread-selection-note, .overview-thread-hull-monitor",
      )
    ) return;
    setContextPresentationRowKey(undefined);
  };
  const monitoredGroup = hullMonitor
    ? flowLayout.groups.find((group) => group.key === hullMonitor.groupKey)
    : undefined;
  const monitoredMembers = monitoredGroup
    ? overviewGroupMembers(monitoredGroup, nodesByKey)
    : [];
  const monitoredAnchor = monitoredGroup
    ? overviewHullAnchorPoint(monitoredGroup, flowLayout, whiteboardWorldSize)
    : undefined;
  const monitoredGeometry = monitoredAnchor && hullMonitor
    ? hullMonitor
    : undefined;
  const monitoredConnector = monitoredAnchor && monitoredGeometry
    ? buildOverviewThreadViewerConnectorGeometry(
      monitoredAnchor,
      monitoredGeometry,
    )
    : undefined;
  return (
    <DropdownMenu
      triggerValue={contextTriggerValue}
      onTriggerValueChange={(details) => {
        if (parseOverviewThreadContextTarget(details.value)) {
          setContextTriggerValue(details.value);
        }
      }}
    >
      <div
        ref={heroRef}
        className={cn(
          "overview-thread-hero",
          immersive && "overview-thread-hero-immersive",
        )}
        data-immersive={immersive ? "true" : undefined}
        onContextMenuCapture={(event) => {
          const target = (event.target as Element).closest(
            "[data-overview-context-target]",
          );
          const value = target?.getAttribute("data-overview-context-target");
          rememberContextPresentationRow(event.target as Element);
          commitContextTargetBeforeOpen(value);
        }}
        onKeyDownCapture={(event) => {
          if (
            event.key !== "ContextMenu" &&
            !(event.shiftKey && event.key === "F10")
          ) return;
          const target = (event.target as Element).closest<HTMLElement>(
            "[data-overview-context-target]",
          );
          if (!target) return;
          rememberContextPresentationRow(target);
          // Chromium on macOS does not synthesize a contextmenu event for
          // Shift+F10, and Ark's ContextTrigger only listens for that event.
          // Reuse the exact same capture/dispatch path as a pointer menu.
          event.preventDefault();
          event.stopPropagation();
          const bounds = target.getBoundingClientRect();
          target.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              clientX: bounds.left + bounds.width / 2,
              clientY: bounds.bottom,
            }),
          );
        }}
        onPointerDownCapture={(event) => {
          const target = event.target as Element;
          const contextValue = target.closest(
            "[data-overview-context-target]",
          )?.getAttribute("data-overview-context-target");
          if (contextValue) setContextTriggerValue(contextValue);
          rememberContextPresentationRow(target);
        }}
      >
        <div
          className={cn(
            "overview-thread-layout-switch",
            whiteboardToolbar,
          )}
          role="group"
          aria-label="Whiteboard controls"
        >
          <button
            type="button"
            className={whiteboardToolbarButton({
              pressed: layoutMode === "hierarchy",
            })}
            aria-pressed={layoutMode === "hierarchy"}
            onClick={() => changeLayoutMode("hierarchy")}
          >
            Hierarchy
          </button>
          <button
            type="button"
            className={whiteboardToolbarButton({
              pressed: layoutMode === "radial",
            })}
            aria-pressed={layoutMode === "radial"}
            onClick={() => changeLayoutMode("radial")}
          >
            Radial
          </button>
          <span
            className={cn(
              "overview-thread-layout-divider",
              whiteboardToolbarPart({ part: "divider" }),
            )}
            aria-hidden="true"
          />
          <button
            type="button"
            className={whiteboardToolbarButton()}
            onClick={() => zoomWhiteboard(0.82)}
          >
            Zoom out
          </button>
          <button
            type="button"
            className={whiteboardToolbarButton()}
            onClick={fitWhiteboard}
          >
            Fit
          </button>
          <button
            type="button"
            className={whiteboardToolbarButton()}
            onClick={() => zoomWhiteboard(1.22)}
          >
            Zoom in
          </button>
          <span
            className={cn(
              "overview-thread-layout-scale",
              whiteboardToolbarPart({ part: "scale" }),
            )}
            aria-label={`Zoom ${
              Math.round(whiteboardTransform.k * 100)
            } percent`}
          >
            {Math.round(whiteboardTransform.k * 100)}%
          </span>
          <button
            type="button"
            className={whiteboardToolbarButton()}
            onClick={resetWhiteboard}
          >
            Reset layout
          </button>
        </div>
        {selectedItem?.kind === "recorded" && (
          <OverviewThreadSelectionNote
            node={selectedItem.node}
            connections={selectedConnections}
            pinned={selectionPinned === true}
            onPinToggle={() => setSelectionPinned(selectionPinned !== true)}
            style={overviewSelectionNoteStyle(selectionNotePlacement)}
            onClose={() => {
              closeSelection();
              nodeRefs.current.get(selectedItem.key)?.focus();
            }}
            onFollow={(reference) => {
              const key = overviewThreadGraphRefKey(reference);
              if (nodesByKey.has(key)) selectNode(key);
              else onOpenEvidence(reference);
            }}
            supplement={
              <>
                <OverviewThreadRequirementsBriefTrace
                  reference={selectedItem.node.ref}
                  traces={requirementsBriefTraces}
                  onFollowBriefSource={(key) => selectNode(key)}
                />
                {selectedHistoricalUnjoined && (
                  <RequirementHistoricalUnjoinedContext
                    value={selectedHistoricalUnjoined.evaluations}
                    chain={selectedHistoricalUnjoined.chain}
                    onFollowEvidence={(reference) => {
                      const key = overviewThreadGraphRefKey(reference);
                      if (nodesByKey.has(key)) selectNode(key);
                      else onOpenEvidence(reference);
                    }}
                  />
                )}
                {selectedSensitivityJourneys.map((journey) => (
                  <OverviewSensitivityJourneyDisclosure
                    key={journey.id}
                    journey={journey}
                  />
                ))}
              </>
            }
          >
            {overviewNodeContextActions(
              selectedItem,
              viewerSessionsByNodeKey,
              viewerAliases,
            )
              .map((action, index) => (
                <button
                  key={overviewContextActionValue(action, index)}
                  type="button"
                  className={whiteboardNoteAction({
                    app: action.kind === "open-session",
                  })}
                  data-app={action.kind === "open-session" ? "true" : undefined}
                  title={action.label}
                  onClick={() => runContextAction(action, selectedRowKey)}
                >
                  {action.kind === "open-session"
                    ? "Open viewer"
                    : action.kind === "open-evidence"
                    ? "Inspect evidence"
                    : action.label}
                </button>
              ))}
          </OverviewThreadSelectionNote>
        )}
        {selectedBriefSection && currentBrief && (
          <section
            className={cn(
              "overview-thread-selection-note",
              whiteboardNote,
              whiteboardNoteState({ pinned: selectionPinned === true }),
            )}
            aria-label={`Read ${selectedBriefSection.label}`}
            data-pinned={selectionPinned === true ? "true" : "false"}
            style={overviewSelectionNoteStyle(selectionNotePlacement)}
          >
            <header className={whiteboardNotePart({ part: "header" })}>
              <span>Selected on the board</span>
              <div className={whiteboardNotePart({ part: "headerActions" })}>
                <button
                  type="button"
                  className={whiteboardNotePin({
                    pressed: selectionPinned === true,
                  })}
                  aria-pressed={selectionPinned === true}
                  aria-label={selectionPinned === true
                    ? "Unpin selection"
                    : "Pin selection"}
                  onClick={() => setSelectionPinned(selectionPinned !== true)}
                >
                  {selectionPinned === true ? "Unpin" : "Pin"}
                </button>
                <button
                  type="button"
                  className={whiteboardNotePart({ part: "close" })}
                  onClick={() => closeSelection()}
                  aria-label="Close selected section"
                >
                  Close
                </button>
              </div>
            </header>
            <div
              className={cn(
                "overview-thread-selection-body",
                whiteboardNotePart({ part: "body" }),
              )}
            >
              <h4 className={whiteboardNotePart({ part: "title" })}>
                {selectedBriefSection.label}
              </h4>
              <p
                className={cn(
                  "overview-thread-selection-meta",
                  whiteboardNotePart({ part: "meta" }),
                )}
              >
                {selectedBriefSection.detail ?? "Current Brief section"}
              </p>
              <div
                className={cn(
                  "overview-thread-selection-actions",
                  whiteboardNotePart({ part: "actions" }),
                )}
              >
                <button
                  type="button"
                  className={whiteboardNoteAction()}
                  onClick={() => openCurrentBriefViewer(selectedRowKey)}
                >
                  Open current Brief
                </button>
              </div>
            </div>
          </section>
        )}
        {selectedItem?.kind === "brief-source" && (
          <OverviewThreadBriefSourceNote
            item={selectedItem}
            pinned={selectionPinned === true}
            onPinToggle={() => setSelectionPinned(selectionPinned !== true)}
            style={overviewSelectionNoteStyle(selectionNotePlacement)}
            onClose={() => {
              closeSelection();
              nodeRefs.current.get(selectedItem.key)?.focus();
            }}
            onSelectRequirement={(requirementId) =>
              selectNode(`requirement:${requirementId}`)}
            onInspectClaim={onOpenEvidence}
          />
        )}
        <div
          ref={viewportRef}
          className="overview-thread-viewport"
          tabIndex={-1}
          data-whiteboard-grid="true"
          aria-label="Digital thread whiteboard"
          style={overviewWhiteboardViewportStyle(whiteboardTransform)}
          onWheel={handleWhiteboardWheel}
          onPointerDown={beginCanvasPan}
          onPointerMove={moveCanvasPan}
          onPointerUp={endCanvasPan}
          onPointerCancel={endCanvasPan}
        >
          <div
            ref={worldRef}
            className="overview-thread-whiteboard-world"
            style={{
              transform:
                `translate3d(${whiteboardTransform.x}px, ${whiteboardTransform.y}px, 0) scale(${whiteboardTransform.k})`,
            }}
          >
            {layoutMode === "hierarchy"
              ? (
                <OverviewThreadD3Flow
                  layout={flowLayout}
                  hullContents={hullContents}
                  pendingHierarchyGroupKeys={pendingHierarchyGroupKeys}
                  rowAnchors={groupRowAnchors}
                  selectedRowKey={selectedRowKey}
                  nativeDetailsByNodeKey={sensitivityVerdictNativeDetails}
                  onActivateHullRow={(row, groupKey) => {
                    const rowKey = overviewHullPresentationRowKey(
                      groupKey,
                      row.key,
                    );
                    const mappedKey = overviewHullMappedGraphKey(
                      groupKey,
                      row,
                      groupRowAnchors,
                      hullContents.get(groupKey)?.rows,
                      nodesByKey,
                    );
                    activateOverviewHullRow(row, {
                      selectNode: (nodeKey) =>
                        apply({
                          type: "row-activated",
                          rowKey,
                          mappedKey: mappedKey ?? nodeKey,
                        }),
                      openSession: (_sessionId, nodeKey) =>
                        apply({
                          type: "row-activated",
                          rowKey,
                          mappedKey: mappedKey ?? nodeKey,
                        }),
                      openCurrentBrief: () => openCurrentBriefViewer(rowKey),
                    });
                  }}
                  nodesByKey={nodesByKey}
                  viewerNodeKeys={viewerNodeKeys}
                  stages={stages}
                  showLaneStrip={!immersive}
                  activeKey={activeKey}
                  selectedKey={selectedKey}
                  hoveredKey={hoveredKey}
                  focusedKey={focusedKey}
                  onHover={setHoveredKey}
                  onFocus={(key) => {
                    setFocusedKey(key);
                    setHoveredKey(key);
                  }}
                  onToggle={(key) => {
                    const item = nodesByKey.get(key);
                    if (item) toggleSelection(item);
                  }}
                  onMoveGroup={(key, position) => {
                    changeHullPlacement(key, position);
                  }}
                  onResizeGroup={(key, size) => {
                    changeHullPlacement(key, size);
                  }}
                  onSetGroupView={(key, view) => {
                    changeHullView(key, view);
                  }}
                  onCycleGroupSort={(key) => {
                    setGroupPlacements((current) => {
                      const order = current[key]?.sort ?? "recorded";
                      const next = order === "recorded"
                        ? "recent"
                        : order === "recent"
                        ? "name"
                        : "recorded";
                      return {
                        ...current,
                        [key]: { ...current[key], sort: next },
                      };
                    });
                  }}
                  onScrollGroup={(key, rows) => {
                    setGroupPlacements((current) => ({
                      ...current,
                      [key]: {
                        ...current[key],
                        scrollRow: Math.max(
                          0,
                          (current[key]?.scrollRow ?? 0) + rows,
                        ),
                      },
                    }));
                  }}
                  onToggleGroupFold={(key) => {
                    changeHullPlacement(key, {
                      collapsed: !groupPlacements[key]?.collapsed,
                    });
                  }}
                  onMoveNode={(key, delta) => {
                    setNodePlacements((current) => ({
                      ...current,
                      [key]: {
                        offsetX: (current[key]?.offsetX ?? 0) + delta.x,
                        offsetY: (current[key]?.offsetY ?? 0) + delta.y,
                      },
                    }));
                  }}
                  boardScale={whiteboardTransform.k}
                  onMove={(key, direction) => {
                    const current = flowLayout.nodes.find((node) =>
                      node.key === key
                    );
                    if (!current) return;
                    const next = directionalOverviewFlowNode(
                      flowLayout.nodes,
                      current,
                      direction,
                    );
                    if (next) moveFocus(next.key);
                  }}
                  refNode={(key, node) => {
                    if (node) nodeRefs.current.set(key, node);
                    else nodeRefs.current.delete(key);
                  }}
                />
              )
              : (
                <div className="overview-thread-map">
                  <svg
                    viewBox={`${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}`}
                    width={viewBoxWidth}
                    height={viewBoxHeight}
                    className="overview-thread-svg"
                    role="group"
                    aria-labelledby={`${OVERVIEW_GRAPH_TITLE_ID} ${OVERVIEW_GRAPH_DESCRIPTION_ID}`}
                  >
                    <title id={OVERVIEW_GRAPH_TITLE_ID}>
                      Project digital thread
                    </title>
                    <desc id={OVERVIEW_GRAPH_DESCRIPTION_ID}>
                      A static D3 hierarchical edge-bundling view of recorded
                      requirements, system model, geometry, physics and
                      verdicts. Use the arrow keys to move between records, then
                      Enter to inspect one.
                    </desc>
                    <g aria-hidden="true" className="overview-thread-lane-arcs">
                      {radialLayout.lanes.map((lane) => (
                        <path
                          key={lane.lane}
                          d={lane.arcD}
                          fill="none"
                          stroke={lane.color}
                          className="overview-thread-lane-arc"
                          vectorEffect="non-scaling-stroke"
                        />
                      ))}
                    </g>
                    <g aria-hidden="true" className="overview-thread-cables">
                      {radialLayout.edges.map((edge) => {
                        const state = overviewEdgeState(edge, activeKey);
                        return (
                          <path
                            key={edge.key}
                            d={edge.d}
                            fill="none"
                            className={cn(
                              "overview-thread-cable",
                              whiteboardFlowCable({ state }),
                            )}
                            data-state={state}
                            strokeWidth={overviewCableWidth(edge.pathCount)}
                            vectorEffect="non-scaling-stroke"
                          />
                        );
                      })}
                    </g>
                    {radialLayout.lanes.map((lane) => {
                      const point = overviewLaneLabelPoint(
                        radialLayout.nodes,
                        lane.labelAngle,
                      );
                      return (
                        <text
                          key={`label:${lane.lane}`}
                          x={point.x}
                          y={point.y}
                          className="overview-thread-lane-label"
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill={lane.color}
                          aria-hidden="true"
                        >
                          {lane.title}
                        </text>
                      );
                    })}
                    {radialLayout.nodes.map((position) => {
                      const item = nodesByKey.get(position.key);
                      if (!item) return null;
                      return (
                        <HeroNode
                          key={item.key}
                          refNode={(node) => {
                            if (node) nodeRefs.current.set(item.key, node);
                            else nodeRefs.current.delete(item.key);
                          }}
                          item={item}
                          position={position}
                          tabIndex={item.key === focusedKey ? 0 : -1}
                          selected={item.key === selectedKey}
                          related={activeKey === undefined ||
                            relatedKeys.has(item.key)}
                          onHoverChange={(hovered) =>
                            setHoveredKey(hovered ? item.key : undefined)}
                          onFocus={() => {
                            setFocusedKey(item.key);
                            setHoveredKey(item.key);
                          }}
                          onToggle={() => toggleSelection(item)}
                          onMove={(key) => {
                            const next = directionalOverviewNode(
                              radialLayout.nodes,
                              position,
                              key,
                            );
                            if (next) moveFocus(next.key);
                          }}
                        />
                      );
                    })}
                  </svg>
                </div>
              )}
          </div>
          <div
            ref={projectHostRef}
            className="project-whiteboard-host"
            data-project-whiteboard-host={projectId}
            style={{
              width: whiteboardWorldSize.width,
              height: whiteboardWorldSize.height,
              transform:
                `translate3d(${whiteboardTransform.x}px, ${whiteboardTransform.y}px, 0) scale(${whiteboardTransform.k})`,
            }}
          />
          {(viewers.length > 0 ||
            (monitoredGroup && monitoredGeometry)) && (
            <div
              className="overview-thread-viewer-layer"
              aria-label="Whiteboard hull monitor and MCP App windows"
              style={{
                width: whiteboardWorldSize.width,
                height: whiteboardWorldSize.height,
                transform:
                  `translate3d(${whiteboardTransform.x}px, ${whiteboardTransform.y}px, 0) scale(${whiteboardTransform.k})`,
              }}
            >
              <svg
                className={cn(
                  "overview-thread-viewer-connectors",
                  whiteboardViewerPart({ part: "connectors" }),
                )}
                viewBox={`0 0 ${whiteboardWorldSize.width} ${whiteboardWorldSize.height}`}
                width="100%"
                height="100%"
                preserveAspectRatio="none"
                aria-hidden="true"
                focusable="false"
              >
                {monitoredConnector && (
                  <g data-hull-monitor={monitoredGroup?.key}>
                    <path
                      className="overview-thread-selection-connector overview-thread-hull-monitor-connector"
                      d={monitoredConnector.d}
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle
                      className="overview-thread-selection-anchor overview-thread-hull-monitor-anchor"
                      cx={monitoredAnchor?.x}
                      cy={monitoredAnchor?.y}
                      r="3.5"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                )}
                {viewers.map((viewer) => {
                  const anchor = overviewViewerAnchorPoint(
                    viewer.kind === "session" ? viewer.nodeKey : "",
                    layoutMode,
                    flowLayout,
                    radialLayout,
                    whiteboardWorldSize,
                    hullContents,
                    viewer.presentationRowKey,
                  );
                  if (!anchor) return null;
                  const connector = buildOverviewThreadViewerConnectorGeometry(
                    anchor,
                    viewer,
                  );
                  return (
                    <g key={viewer.id} data-viewer-id={viewer.id}>
                      <path
                        className="overview-thread-viewer-connector"
                        d={connector.d}
                        vectorEffect="non-scaling-stroke"
                      />
                      <circle
                        className="overview-thread-viewer-anchor"
                        cx={anchor.x}
                        cy={anchor.y}
                        r="3.5"
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  );
                })}
              </svg>
              {monitoredGroup && monitoredGeometry && (
                <OverviewHullMonitorCard
                  group={monitoredGroup}
                  members={monitoredMembers}
                  viewerSessionsByNodeKey={viewerSessionsByNodeKey}
                  viewerAliases={viewerAliases}
                  geometry={monitoredGeometry}
                  onAction={runContextAction}
                  onSelectNode={selectNode}
                  onDragStart={beginHullMonitorDrag}
                  onDrag={moveHullMonitor}
                  onDragEnd={endHullMonitorDrag}
                  onMoveByKeyboard={moveHullMonitorByKeyboard}
                  onResizeStart={beginHullMonitorResize}
                  onResize={moveHullMonitorResize}
                  onResizeEnd={endHullMonitorResize}
                  onDismiss={() => setHullMonitor(undefined)}
                />
              )}
              {viewers.map((viewer) => {
                if (viewer.kind === "current-brief") {
                  if (
                    !currentBrief ||
                    !overviewCurrentBriefMatches(
                      currentBrief,
                      viewer.briefSnapshotId,
                    )
                  ) return null;
                  return (
                    <OverviewFloatingViewer
                      key={viewer.id}
                      refViewer={(node) => {
                        if (node) viewerRefs.current.set(viewer.id, node);
                        else viewerRefs.current.delete(viewer.id);
                      }}
                      viewer={viewer}
                      currentBrief={currentBrief}
                      onBringFront={() => bringViewerFront(viewer.id)}
                      onClose={() => closeViewer(viewer.id)}
                      onToggleExpanded={() => toggleViewerExpanded(viewer.id)}
                      onMoveByKeyboard={(direction) =>
                        moveViewerByKeyboard(viewer.id, direction)}
                      onResizeByKeyboard={(direction) =>
                        resizeViewerByKeyboard(viewer.id, direction)}
                      onDragStart={(event) => beginViewerDrag(event, viewer)}
                      onDrag={moveViewer}
                      onDragEnd={endViewerDrag}
                      onResizeStart={(event) =>
                        beginViewerResize(event, viewer)}
                      onResize={moveViewerResize}
                      onResizeEnd={endViewerResize}
                    />
                  );
                }
                const item = nodesByKey.get(viewer.nodeKey);
                if (!item) return null;
                const viewerSession = item.kind === "recorded"
                  ? viewerSessionsById.get(viewer.sessionId)
                  : undefined;
                return (
                  <OverviewFloatingViewer
                    key={viewer.id}
                    refViewer={(node) => {
                      if (node) viewerRefs.current.set(viewer.id, node);
                      else viewerRefs.current.delete(viewer.id);
                    }}
                    viewer={viewer}
                    item={item}
                    viewerSession={viewerSession}
                    onBringFront={() => bringViewerFront(viewer.id)}
                    onClose={() => closeViewer(viewer.id)}
                    onToggleExpanded={() => toggleViewerExpanded(viewer.id)}
                    onMoveByKeyboard={(direction) =>
                      moveViewerByKeyboard(viewer.id, direction)}
                    onResizeByKeyboard={(direction) =>
                      resizeViewerByKeyboard(viewer.id, direction)}
                    onDragStart={(event) => beginViewerDrag(event, viewer)}
                    onDrag={moveViewer}
                    onDragEnd={endViewerDrag}
                    onResizeStart={(event) => beginViewerResize(event, viewer)}
                    onResize={moveViewerResize}
                    onResizeEnd={endViewerResize}
                  />
                );
              })}
            </div>
          )}
        </div>
        {unroutedEdgeCount > 0 && (
          <p className="m-0 border-t border-border px-4 py-2 text-xs text-warning">
            {unroutedEdgeCount}{" "}
            graph connections unavailable in this projection.
          </p>
        )}
      </div>
      <OverviewThreadContextMenu
        node={contextNode}
        group={contextGroup}
        nodesByKey={recordNodesByKey}
        viewerSessionsByNodeKey={viewerSessionsByNodeKey}
        viewerAliases={viewerAliases}
        content={contextGroup && hullContents.get(contextGroup.key)
          ? {
            ...hullContents.get(contextGroup.key)!,
            records: recordHullContents.get(contextGroup.key)?.records ?? [],
          }
          : undefined}
        viewerSessionsById={viewerSessionsById}
        actions={contextActions}
        presentationRowKey={contextPresentationRowKey}
        onAction={runContextAction}
        onOpenHullMonitor={(groupKey) => {
          const group = flowLayout.groups.find((item) => item.key === groupKey);
          const anchor = group
            ? overviewHullAnchorPoint(
              group,
              flowLayout,
              whiteboardWorldSize,
            )
            : undefined;
          if (anchor) {
            setHullMonitor({
              groupKey,
              ...overviewHullMonitorGeometry(anchor, whiteboardWorldSize),
            });
          }
          closeSelection();
          setHoveredKey(undefined);
        }}
        onSelectNode={selectNode}
      />
    </DropdownMenu>
  );
}

function readOverviewSelectionNotePlacement(
  host: HTMLElement,
  anchor: Element,
  note: Element | null,
): OverviewSelectionNotePlacement {
  const hostBox = host.getBoundingClientRect();
  const anchorBox = anchor.getBoundingClientRect();
  const viewportBox = host.querySelector(".overview-thread-viewport")
    ?.getBoundingClientRect() ?? hostBox;
  const toolbarBox = host.querySelector(".overview-thread-layout-switch")
    ?.getBoundingClientRect();
  let topMargin = OVERVIEW_SELECTION_NOTE_TOP_MARGIN;
  if (toolbarBox) {
    topMargin = Math.max(
      topMargin,
      toolbarBox.bottom - viewportBox.top + OVERVIEW_SELECTION_NOTE_GAP,
    );
  }
  const placement = placeOverviewSelectionNote({
    host: { width: viewportBox.width, height: viewportBox.height },
    anchor: overviewSelectionNoteAnchorFromRects(viewportBox, anchorBox),
    note: {
      height: note instanceof HTMLElement ? note.offsetHeight : 280,
    },
    topMargin,
  });
  // The note is positioned by the hero, but must stay inside its canvas,
  // above the Activity strip and other surrounding controls.
  return {
    ...placement,
    left: placement.left + viewportBox.left - hostBox.left,
    top: placement.top + viewportBox.top - hostBox.top,
  };
}

function overviewSelectionNoteStyle(
  placement: OverviewSelectionNotePlacement | undefined,
): CSSProperties | undefined {
  if (!placement) return undefined;
  return {
    top: placement.top,
    left: placement.left,
    width: placement.width,
    maxHeight: placement.maxHeight,
  };
}

function overviewDirectionDelta(
  direction: OverviewThreadD3FlowMoveDirection,
  step: number,
): { readonly x: number; readonly y: number } {
  if (direction === "ArrowLeft") return { x: -step, y: 0 };
  if (direction === "ArrowRight") return { x: step, y: 0 };
  if (direction === "ArrowUp") return { x: 0, y: -step };
  return { x: 0, y: step };
}

function isOverviewMoveDirection(
  key: string,
): key is OverviewThreadD3FlowMoveDirection {
  return key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" ||
    key === "ArrowDown";
}

function readOverviewWhiteboardBounds(
  viewport: HTMLDivElement | null,
  world: HTMLDivElement | null,
  viewers: readonly OverviewViewerState[] = [],
  flowLayout?: Pick<
    ReturnType<typeof buildOverviewThreadD3FlowLayout>,
    "viewBox" | "groups"
  >,
): OverviewThreadWhiteboardBounds | undefined {
  if (!viewport || !world) return undefined;
  const viewportWidth = viewport.clientWidth;
  const viewportHeight = viewport.clientHeight;
  const worldWidth = world.offsetWidth;
  const worldHeight = world.offsetHeight;
  if (
    viewportWidth <= 0 || viewportHeight <= 0 || worldWidth <= 0 ||
    worldHeight <= 0
  ) return undefined;
  const content = overviewThreadWhiteboardContentBounds(
    { width: worldWidth, height: worldHeight },
    [
      ...overviewThreadFlowSceneRects(flowLayout, {
        width: worldWidth,
        height: worldHeight,
      }),
      ...viewers.map((viewer) =>
        viewer.restoreGeometry ?? overviewViewerGeometry(viewer)
      ),
    ],
  );
  if (!content) return undefined;
  return {
    viewport: { width: viewportWidth, height: viewportHeight },
    content,
    padding: Math.min(36, viewportWidth * 0.045, viewportHeight * 0.045),
    minScale: 0.4,
    maxScale: 3,
  };
}

function overviewThreadFlowSceneRects(
  layout:
    | Pick<
      ReturnType<typeof buildOverviewThreadD3FlowLayout>,
      "viewBox" | "groups"
    >
    | undefined,
  world: { readonly width: number; readonly height: number },
): readonly OverviewThreadViewerGeometry[] {
  if (!layout) return [];
  const [viewBoxX, viewBoxY, viewBoxWidth, viewBoxHeight] = layout.viewBox;
  if (viewBoxWidth <= 0 || viewBoxHeight <= 0) return [];
  const scaleX = world.width / viewBoxWidth;
  const scaleY = world.height / viewBoxHeight;
  return layout.groups.map((group) => ({
    x: (group.x - 7 - viewBoxX) * scaleX,
    y: (group.y - 10 - viewBoxY) * scaleY,
    width: (group.width + 14) * scaleX,
    height: (group.height + 17) * scaleY,
  }));
}

function initialOverviewViewerGeometry(
  anchor: { readonly x: number; readonly y: number },
  size: { readonly width: number; readonly height: number },
  world: { readonly width: number; readonly height: number },
  cascade: number,
): OverviewThreadViewerGeometry {
  const gap = 34 + cascade * 18;
  const rightX = anchor.x + gap;
  const leftX = anchor.x - gap - size.width;
  const rightSpace = world.width - OVERVIEW_VIEWER_PADDING - rightX;
  const leftSpace = leftX - OVERVIEW_VIEWER_PADDING;
  const x = rightSpace >= size.width
    ? rightX
    : leftSpace >= 0
    ? leftX
    : anchor.x - size.width / 2;

  return {
    x,
    y: anchor.y - size.height / 2 + cascade * 12,
    width: size.width,
    height: size.height,
  };
}

function overviewViewerGeometryConstraints(): {
  readonly minWidth: number;
  readonly minHeight: number;
} {
  return {
    minWidth: OVERVIEW_VIEWER_MIN_WIDTH,
    minHeight: OVERVIEW_VIEWER_MIN_HEIGHT,
  };
}

function overviewWhiteboardViewportStyle(
  transform: OverviewThreadWhiteboardTransform,
): CSSProperties {
  const minor = 28 * transform.k;
  const major = minor * 5;
  return {
    "--overview-whiteboard-grid-minor-size": `${minor}px`,
    "--overview-whiteboard-grid-major-size": `${major}px`,
    "--overview-whiteboard-grid-x": `${transform.x}px`,
    "--overview-whiteboard-grid-y": `${transform.y}px`,
  } as CSSProperties;
}

function overviewPresentationRowKeyFromTarget(
  target: Element | null | undefined,
): string | undefined {
  const row = target?.closest(".overview-thread-flow-structure-row");
  if (!row) return undefined;
  const groupKey = row.getAttribute("data-hull-group-key");
  const rowKey = row.getAttribute("data-hull-row-key");
  if (!groupKey || !rowKey) return undefined;
  return overviewHullPresentationRowKey(groupKey, rowKey);
}

function overviewViewerAnchorPoint(
  nodeKey: string,
  layoutMode: OverviewWhiteboardLayoutMode,
  flowLayout: ReturnType<typeof buildOverviewThreadD3FlowLayout>,
  radialLayout: ReturnType<typeof buildOverviewThreadD3Layout>,
  world: { readonly width: number; readonly height: number },
  hullContents?: ReadonlyMap<string, OverviewHullContent>,
  presentationRowKey?: string,
): { readonly x: number; readonly y: number } | undefined {
  if (layoutMode === "hierarchy") {
    const [viewBoxX, viewBoxY, viewBoxWidth, viewBoxHeight] =
      flowLayout.viewBox;
    if (presentationRowKey && hullContents && viewBoxWidth > 0) {
      const found = overviewHullPresentationRowLookup(
        presentationRowKey,
        hullContents,
      );
      if (found) {
        const group = flowLayout.groups.find((candidate) =>
          candidate.key === found.groupKey
        );
        const rows = hullContents.get(found.groupKey)?.rows;
        const position = group && rows
          ? layoutOverviewHullRows(rows, group).find((item) =>
            item.row.key === found.rowKey
          )
          : undefined;
        if (position) {
          return {
            x: (position.x + position.width / 2 - viewBoxX) /
              viewBoxWidth * world.width,
            y: (position.y + position.height / 2 - viewBoxY) /
              viewBoxHeight * world.height,
          };
        }
      }
    }
    const node = flowLayout.nodes.find((candidate) =>
      candidate.key === nodeKey
    );
    if (!node) return undefined;
    return {
      x: (node.centerX - viewBoxX) / viewBoxWidth * world.width,
      y: (node.centerY - viewBoxY) / viewBoxHeight * world.height,
    };
  }
  const node = radialLayout.nodes.find((candidate) =>
    candidate.key === nodeKey
  );
  if (!node) return undefined;
  const [viewBoxX, viewBoxY, viewBoxWidth, viewBoxHeight] =
    radialLayout.viewBox;
  return {
    x: (node.anchorX - viewBoxX) / viewBoxWidth * world.width,
    y: (node.anchorY - viewBoxY) / viewBoxHeight * world.height,
  };
}

function overviewHullAnchorPoint(
  group: OverviewThreadD3FlowGroupLayout,
  layout: ReturnType<typeof buildOverviewThreadD3FlowLayout>,
  world: { readonly width: number; readonly height: number },
): { readonly x: number; readonly y: number } | undefined {
  const [viewBoxX, viewBoxY, viewBoxWidth, viewBoxHeight] = layout.viewBox;
  if (viewBoxWidth <= 0 || viewBoxHeight <= 0) return undefined;
  return {
    x: (group.x + group.width - viewBoxX) / viewBoxWidth * world.width,
    y: (group.y + group.headerHeight / 2 - viewBoxY) / viewBoxHeight *
      world.height,
  };
}

function overviewHullMonitorGeometry(
  anchor: { readonly x: number; readonly y: number },
  world: { readonly width: number; readonly height: number },
): OverviewThreadViewerGeometry {
  const padding = 8;
  const gap = 18;
  const width = Math.min(
    OVERVIEW_HULL_MONITOR_WIDTH,
    Math.max(220, world.width - padding * 2),
  );
  const height = Math.min(
    OVERVIEW_HULL_MONITOR_HEIGHT,
    Math.max(200, world.height - padding * 2),
  );
  const rightX = anchor.x + gap;
  const leftX = anchor.x - gap - width;
  const x = rightX + width <= world.width - padding
    ? rightX
    : leftX >= padding
    ? leftX
    : clamp(anchor.x - width / 2, padding, world.width - width - padding);
  return {
    x,
    y: clamp(
      anchor.y - 30,
      padding,
      Math.max(padding, world.height - height - padding),
    ),
    width,
    height,
  };
}

function overviewRelatedNodeKeys(
  edges: readonly OverviewHeroEdge[],
  activeKey: string | undefined,
): ReadonlySet<string> {
  if (!activeKey) return new Set();
  const keys = new Set([activeKey]);
  for (const edge of edges) {
    if (edge.fromKey === activeKey) keys.add(edge.toKey);
    if (edge.toKey === activeKey) keys.add(edge.fromKey);
  }
  return keys;
}

function overviewCableWidth(pathCount: number): number {
  return 0.75 + Math.min(1.35, Math.log2(pathCount + 1) * 0.42);
}

function overviewEdgeState(
  edge: Pick<OverviewHeroEdge, "emphasis" | "fromKey" | "toKey">,
  activeKey: string | undefined,
): "default" | "emphasis" | "incoming" | "outgoing" | "muted" {
  if (!activeKey) return edge.emphasis ? "emphasis" : "default";
  if (edge.fromKey === activeKey) return "outgoing";
  if (edge.toKey === activeKey) return "incoming";
  return "muted";
}

function overviewD3LayoutOptions(nodeCount: number): {
  readonly innerRadius: number;
  readonly labelColumnX: number;
  readonly height: number;
  readonly labelGap: number;
  readonly bundleBeta: number;
} {
  const innerRadius = clamp(184 + nodeCount * 1.65, 222, 342);
  const rowsPerSide = Math.ceil(nodeCount / 2);
  return {
    innerRadius,
    labelColumnX: innerRadius + 52,
    height: clamp(360 + rowsPerSide * 17, 580, 980),
    labelGap: 17,
    bundleBeta: 0.84,
  };
}

function overviewLaneLabelPoint(
  nodes: readonly OverviewD3Node[],
  angle: number,
): { readonly x: number; readonly y: number } {
  const leafRadius = Math.max(220, ...nodes.map((node) => node.radius));
  const radius = Math.max(96, leafRadius - 54);
  return {
    x: Math.sin(angle) * radius,
    y: -Math.cos(angle) * radius,
  };
}

function directionalOverviewNode(
  nodes: readonly OverviewD3Node[],
  current: OverviewD3Node,
  key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
): OverviewD3Node | undefined {
  const horizontal = key === "ArrowLeft" || key === "ArrowRight";
  const direction = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
  const candidates = nodes.flatMap((candidate) => {
    if (candidate.key === current.key) return [];
    const primary = horizontal
      ? (candidate.labelX - current.labelX) * direction
      : (candidate.labelY - current.labelY) * direction;
    if (primary <= 1) return [];
    const secondary = horizontal
      ? Math.abs(candidate.labelY - current.labelY)
      : Math.abs(candidate.labelX - current.labelX);
    return [{ candidate, score: primary + secondary * 2.5 }];
  }).sort((left, right) =>
    left.score - right.score ||
    left.candidate.key.localeCompare(right.candidate.key)
  );
  if (candidates[0]) return candidates[0].candidate;
  const index = nodes.findIndex((node) => node.key === current.key);
  if (index < 0 || nodes.length < 2) return undefined;
  return nodes[(index + direction + nodes.length) % nodes.length];
}

function directionalOverviewFlowNode(
  nodes: readonly OverviewFlowNode[],
  current: OverviewFlowNode,
  direction: OverviewThreadD3FlowMoveDirection,
): OverviewFlowNode | undefined {
  const horizontal = direction === "ArrowLeft" || direction === "ArrowRight";
  const axisDirection = direction === "ArrowLeft" || direction === "ArrowUp"
    ? -1
    : 1;
  const candidates = nodes.flatMap((candidate) => {
    if (candidate.key === current.key) return [];
    const primary = (horizontal
      ? candidate.centerX - current.centerX
      : candidate.centerY - current.centerY) * axisDirection;
    if (primary <= 0.5) {
      return [];
    }
    const secondary = Math.abs(
      horizontal
        ? candidate.centerY - current.centerY
        : candidate.centerX - current.centerX,
    );
    const distance = Math.hypot(primary, secondary);
    return [{
      candidate,
      primary,
      secondary,
      score: distance + secondary * 1.25,
    }];
  }).sort((left, right) =>
    left.score - right.score ||
    left.secondary - right.secondary ||
    left.primary - right.primary ||
    left.candidate.key.localeCompare(right.candidate.key)
  );
  return candidates[0]?.candidate;
}

function HeroNode({
  item,
  position,
  tabIndex,
  selected,
  related,
  refNode,
  onHoverChange,
  onFocus,
  onToggle,
  onMove,
}: {
  item: OverviewHeroNode;
  position: OverviewD3Node;
  tabIndex: number;
  selected: boolean;
  related: boolean;
  refNode: (node: SVGGElement | null) => void;
  onHoverChange: (hovered: boolean) => void;
  onFocus: () => void;
  onToggle: () => void;
  onMove: (
    key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
  ) => void;
}): JSX.Element {
  const title = item.kind === "activity"
    ? `Project activity · ${item.activity.title} · ${
      overviewActivityStatusCaption(item.activity.status)
    }`
    : item.kind === "brief-source"
    ? `Brief r${item.brief.revision} · ${item.sourceItem.id} · ${item.sourceItem.statement}`
    : `${item.node.label} · ${item.node.ref.id} · ${item.node.summary}`;
  const ariaLabel = item.kind === "activity"
    ? `Project activity ${item.activity.title}, ${
      overviewActivityStatusCaption(item.activity.status)
    }`
    : item.kind === "brief-source"
    ? `Read brief source ${item.sourceItem.id}, brief r${item.brief.revision}`
    : `Inspect ${item.node.label}, ${item.node.freshness}, ${item.node.ref.id}`;
  const hitX = position.textAnchor === "start"
    ? position.labelX - 8
    : position.labelX - 208;
  const markerColor = item.kind === "activity"
    ? OVERVIEW_LANES.find((lane) => lane.id === item.lane)?.color ??
      "currentColor"
    : item.color;
  return (
    <DropdownMenuContextTrigger
      value={overviewThreadNodeContextValue(item.key)}
      asChild
    >
      <g
        ref={refNode}
        role="button"
        tabIndex={tabIndex}
        aria-label={ariaLabel}
        aria-pressed={selected}
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+F10"
        className={cn("overview-thread-node", whiteboardFlowRadialNode)}
        data-state={selected ? "selected" : related ? "related" : "muted"}
        data-kind={item.kind}
        data-overview-context-target={overviewThreadNodeContextValue(item.key)}
        onClick={onToggle}
        onMouseEnter={() => onHoverChange(true)}
        onMouseLeave={() => onHoverChange(false)}
        onFocus={onFocus}
        onBlur={() => onHoverChange(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
            return;
          }
          if (
            event.key === "ArrowUp" || event.key === "ArrowDown" ||
            event.key === "ArrowLeft" || event.key === "ArrowRight"
          ) {
            event.preventDefault();
            onMove(event.key);
          }
        }}
      >
        <title>{title}</title>
        <rect
          x={hitX}
          y={position.labelY - 10}
          width="216"
          height="20"
          fill="transparent"
        />
        <path
          d={position.leaderD}
          fill="none"
          className="overview-thread-node-leader"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={position.anchorX}
          cy={position.anchorY}
          r="8"
          fill="transparent"
          className="overview-thread-node-focus-ring"
          stroke={markerColor}
          vectorEffect="non-scaling-stroke"
        />
        {item.kind === "activity"
          ? (
            <ActivityMarker
              item={item}
              x={position.anchorX}
              y={position.anchorY}
              color={markerColor}
            />
          )
          : item.kind === "brief-source"
          ? (
            <BriefSourceMarker
              item={item}
              x={position.anchorX}
              y={position.anchorY}
            />
          )
          : (
            <RecordedMarker
              item={item}
              x={position.anchorX}
              y={position.anchorY}
            />
          )}
        <text
          x={position.labelX}
          y={position.labelY}
          textAnchor={position.textAnchor}
          dominantBaseline="middle"
          className="overview-thread-node-label"
        >
          {item.label}
        </text>
      </g>
    </DropdownMenuContextTrigger>
  );
}

function RecordedMarker(
  { item, x, y }: { item: OverviewRecordedHeroNode; x: number; y: number },
): JSX.Element {
  return (
    <circle
      cx={x}
      cy={y}
      r={item.emphasis ? 5 : 4}
      fill={item.color}
      stroke="#ffffff"
      strokeWidth={item.emphasis ? 2.5 : 1.5}
      vectorEffect="non-scaling-stroke"
    />
  );
}

function BriefSourceMarker(
  { item, x, y }: {
    readonly item: Extract<OverviewHeroNode, { readonly kind: "brief-source" }>;
    readonly x: number;
    readonly y: number;
  },
): JSX.Element {
  return (
    <path
      d={`M ${x} ${y - 5} L ${x + 5} ${y} L ${x} ${y + 5} L ${x - 5} ${y} Z`}
      fill={item.color}
      stroke="#ffffff"
      strokeWidth={item.emphasis ? 2.5 : 1.5}
      vectorEffect="non-scaling-stroke"
    />
  );
}

function ActivityMarker(
  { item, x, y, color }: {
    item: OverviewActivityHeroNode;
    x: number;
    y: number;
    color: string;
  },
): JSX.Element {
  const status = item.activity.status;
  return (
    <rect
      x={x - 4}
      y={y - 4}
      width="8"
      height="8"
      rx="1.5"
      fill={color}
      stroke="#ffffff"
      strokeWidth="1.5"
      strokeDasharray={status === "planned" ? "2 1.5" : undefined}
      vectorEffect="non-scaling-stroke"
    />
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function overviewNodeContextActions(
  item: OverviewHeroNode,
  viewerSessionsByNodeKey: ReadonlyMap<
    string,
    readonly ThreadViewerSession[]
  > = new Map(),
  viewerAliases: ReadonlyMap<
    string,
    readonly OverviewViewerOpenTarget[]
  > = new Map(),
): readonly OverviewNodeContextAction[] {
  if (item.kind === "activity") {
    return [{ kind: "open-activity", label: "Open Activity" }];
  }
  if (item.kind === "brief-source") return [];

  const actions: OverviewNodeContextAction[] = [];
  const anchoredSessions = [...(viewerSessionsByNodeKey.get(item.key) ?? [])]
    .toSorted((left, right) =>
      left.app.id.localeCompare(right.app.id) ||
      left.app.version.localeCompare(right.app.version) ||
      left.id.localeCompare(right.id)
    );
  for (const session of anchoredSessions) {
    actions.push({
      kind: "open-session",
      nodeKey: item.key,
      sessionId: session.id,
      label: `Open viewer · ${item.label}`,
    });
  }
  if (anchoredSessions.length === 0) {
    for (const alias of viewerAliases.get(item.key) ?? []) {
      actions.push({
        kind: "open-session",
        nodeKey: alias.nodeKey,
        sessionId: alias.sessionId,
        label: `Open viewer · ${item.label}`,
      });
    }
  }
  actions.push({
    kind: "open-evidence",
    reference: item.node.ref,
    label: "Open in Verification",
  });
  return actions;
}

function overviewContextActionValue(
  action: OverviewNodeContextAction,
  index: number,
): string {
  if (action.kind === "open-session") {
    return `${action.kind}:${action.nodeKey}:${action.sessionId}`;
  }
  if (action.kind === "open-evidence") {
    return `${action.kind}:${action.reference.kind}:${action.reference.id}`;
  }
  if ("nodeKey" in action) return `${action.kind}:${action.nodeKey}`;
  return `${action.kind}:${index}`;
}

function overviewThreadGraphRefKey(reference: ThreadGraphRef): string {
  return `${reference.kind}:${reference.id}`;
}

function overviewNodeContextMeta(item: OverviewHeroNode): string {
  if (item.kind === "activity") {
    return `${
      overviewActivityStatusCaption(item.activity.status)
    } · ${item.activity.evidenceCount} evidence`;
  }
  if (item.kind === "brief-source") {
    return `brief r${item.brief.revision} · ${item.sourceItem.id}`;
  }
  return `${item.node.ref.kind}:${item.node.ref.id} · ${
    item.node.artifactKind ?? item.node.entityKind
  }`;
}

function overviewLaneTitle(lane: OverviewHeroNode["lane"]): string {
  return OVERVIEW_LANES.find((candidate) => candidate.id === lane)?.title ??
    lane;
}

function overviewGroupMembers(
  group: OverviewThreadD3FlowGroupLayout,
  nodesByKey: ReadonlyMap<string, OverviewHeroNode>,
): readonly OverviewHeroNode[] {
  return [...nodesByKey.values()].filter((item) =>
    overviewThreadD3FlowGroupIdentity(item.lane, item.groupKey) === group.key
  );
}

function OverviewThreadContextMenu({
  node,
  group,
  nodesByKey,
  viewerSessionsByNodeKey,
  viewerAliases,
  content,
  viewerSessionsById,
  actions,
  presentationRowKey,
  onAction,
  onOpenHullMonitor,
  onSelectNode,
}: {
  readonly node?: OverviewHeroNode;
  readonly group?: OverviewThreadD3FlowGroupLayout;
  readonly nodesByKey: ReadonlyMap<string, OverviewHeroNode>;
  readonly viewerSessionsByNodeKey: ReadonlyMap<
    string,
    readonly ThreadViewerSession[]
  >;
  readonly viewerAliases: ReadonlyMap<
    string,
    readonly OverviewViewerOpenTarget[]
  >;
  readonly content?: OverviewHullContent;
  readonly viewerSessionsById: ReadonlyMap<string, ThreadViewerSession>;
  readonly actions: readonly OverviewNodeContextAction[];
  readonly presentationRowKey?: string;
  readonly onAction: (
    action: OverviewNodeContextAction,
    presentationRowKey?: string,
  ) => void;
  readonly onOpenHullMonitor: (groupKey: string) => void;
  readonly onSelectNode: (key: string) => void;
}): JSX.Element {
  const members = group ? overviewGroupMembers(group, nodesByKey) : [];
  const memberViewerEntries: Array<{
    readonly member: OverviewHeroNode;
    readonly action: OverviewOpenSessionContextAction;
  }> = [];
  for (const member of members) {
    for (
      const action of overviewNodeContextActions(
        member,
        viewerSessionsByNodeKey,
        viewerAliases,
      )
    ) {
      if (action.kind === "open-session") {
        memberViewerEntries.push({ member, action });
      }
    }
  }
  const label = node?.label ?? (group ? flowGroupCaption(group) : "Thread");
  const hierarchyRows = content?.rows ?? [];
  const hierarchySessionIds = new Set(
    hierarchyRows.flatMap((row) => row.sessionIds),
  );
  const actionsBySession = new Map<string, OverviewOpenSessionContextAction>();
  for (const [id, session] of viewerSessionsById) {
    if (session.anchor.kind === "project-review") continue;
    const nodeKey = overviewThreadGraphRefKey(session.anchor);
    if (!nodesByKey.has(nodeKey)) continue;
    actionsBySession.set(id, {
      kind: "open-session",
      nodeKey,
      sessionId: id,
      label: `Open viewer · ${nodesByKey.get(nodeKey)!.label}`,
    });
  }
  return (
    <DropdownMenuContent
      className="overview-thread-context-menu"
      aria-label={`${label} context menu`}
    >
      {node && (
        <DropdownMenuGroup>
          <DropdownMenuLabel>{node.label}</DropdownMenuLabel>
          {actions.length === 0 && (
            <DropdownMenuItem
              value={`select:${node.key}`}
              onSelect={() => onSelectNode(node.key)}
            >
              Show on whiteboard
            </DropdownMenuItem>
          )}
          {actions.map((action, index) => (
            <DropdownMenuItem
              key={overviewContextActionValue(action, index)}
              value={overviewContextActionValue(action, index)}
              onSelect={() => onAction(action, presentationRowKey)}
            >
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      )}
      {group && (
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span>{flowGroupCaption(group)}</span>
            <small>
              {overviewLaneTitle(group.lane)} · {members.length} recorded{" "}
              {members.length === 1 ? "record" : "records"}
            </small>
          </DropdownMenuLabel>
          <DropdownMenuItem
            value={`monitor:${group.key}`}
            onSelect={() => onOpenHullMonitor(group.key)}
          >
            Open hull monitor
          </DropdownMenuItem>
          {hierarchyRows.length > 0 && (
            <DropdownMenuLabel>Navigation</DropdownMenuLabel>
          )}
          {hierarchyRows.map((row) => {
            const rowActions = overviewHullRowActions(row);
            const style = {
              paddingInlineStart: `${0.75 + row.depth * 0.9}rem`,
            };
            const rowPresentationKey = overviewHullPresentationRowKey(
              group.key,
              row.key,
            );
            if (rowActions.length === 0) {
              return (
                <div
                  key={row.key}
                  data-hull-row-key={row.key}
                  data-hull-row-kind={row.kind}
                  className="overview-thread-context-structure"
                  style={style}
                >
                  <OverviewHullMenuRowBody row={row} />
                </div>
              );
            }
            return rowActions.map((action, index) => {
              if (action.kind === "open-current-brief") {
                return (
                  <DropdownMenuItem
                    key={row.key}
                    value={`hull-row-brief:${row.key}`}
                    data-hull-row-key={row.key}
                    data-hull-group-key={group.key}
                    data-hull-row-kind={row.kind}
                    className="overview-thread-context-viewer"
                    style={style}
                    onSelect={() =>
                      onAction({
                        kind: "open-current-brief",
                        label: "Open current Brief",
                      }, rowPresentationKey)}
                  >
                    <OverviewHullMenuRowBody row={row} />
                  </DropdownMenuItem>
                );
              }
              if (action.kind === "open-session") {
                const sessionAction = actionsBySession.get(action.sessionId);
                return (
                  <DropdownMenuItem
                    key={`${row.key}:${action.sessionId}`}
                    value={`hull-row-viewer:${row.key}:${action.sessionId}`}
                    data-hull-row-key={row.key}
                    data-hull-group-key={group.key}
                    data-hull-row-kind={row.kind}
                    className="overview-thread-context-viewer"
                    style={style}
                    onSelect={() =>
                      onAction({
                        kind: "open-session",
                        nodeKey: action.nodeKey,
                        sessionId: action.sessionId,
                        label: sessionAction?.label ??
                          `Open viewer · ${action.nodeKey}`,
                      }, rowPresentationKey)}
                  >
                    <OverviewHullMenuRowBody row={row} />
                  </DropdownMenuItem>
                );
              }
              return (
                <DropdownMenuItem
                  key={`${row.key}:${index}`}
                  value={`hull-row:${row.key}`}
                  data-hull-row-key={row.key}
                  data-hull-row-kind={row.kind}
                  className="overview-thread-context-member"
                  style={style}
                  onSelect={() => onSelectNode(action.nodeKey)}
                >
                  <OverviewHullMenuRowBody row={row} />
                </DropdownMenuItem>
              );
            });
          })}
          {memberViewerEntries.filter(({ action }) =>
            !hierarchySessionIds.has(action.sessionId)
          ).map(({ member, action }, index) => (
            <DropdownMenuItem
              key={`${member.key}:${overviewContextActionValue(action, index)}`}
              value={`hull-viewer:${member.key}:${action.sessionId}`}
              className="overview-thread-context-viewer"
              onSelect={() => onAction(action)}
            >
              <span>{member.label}</span>
              <small>Ouvrir le viewer</small>
            </DropdownMenuItem>
          ))}
          <DropdownMenuLabel>
            Enregistrements · captures et historique
          </DropdownMenuLabel>
          <div className="overview-thread-context-members">
            {(content?.records ?? []).map((row) => {
              const graphRef = overviewHullRowPrimaryGraphRef(row);
              const style = {
                paddingInlineStart: `${0.75 + row.depth * 0.9}rem`,
              };
              if (!graphRef) {
                return (
                  <div
                    key={row.key}
                    data-hull-row-key={row.key}
                    data-hull-row-kind={row.kind}
                    className="overview-thread-context-structure"
                    style={style}
                  >
                    <OverviewHullMenuRowBody row={row} />
                  </div>
                );
              }
              return (
                <DropdownMenuItem
                  key={row.key}
                  value={`member:${row.key}`}
                  data-hull-row-key={row.key}
                  data-hull-row-kind={row.kind}
                  className="overview-thread-context-member"
                  style={style}
                  onSelect={() => onSelectNode(graphRef)}
                >
                  <OverviewHullMenuRowBody row={row} />
                </DropdownMenuItem>
              );
            })}
          </div>
        </DropdownMenuGroup>
      )}
    </DropdownMenuContent>
  );
}

function OverviewHullMonitorCard({
  group,
  members,
  viewerSessionsByNodeKey,
  viewerAliases,
  geometry,
  onAction,
  onSelectNode,
  onDragStart,
  onDrag,
  onDragEnd,
  onMoveByKeyboard,
  onResizeStart,
  onResize,
  onResizeEnd,
  onDismiss,
}: {
  readonly group: OverviewThreadD3FlowGroupLayout;
  readonly members: readonly OverviewHeroNode[];
  readonly viewerSessionsByNodeKey: ReadonlyMap<
    string,
    readonly ThreadViewerSession[]
  >;
  readonly viewerAliases: ReadonlyMap<
    string,
    readonly OverviewViewerOpenTarget[]
  >;
  readonly geometry: OverviewThreadViewerGeometry;
  readonly onAction: (
    action: OverviewNodeContextAction,
    presentationRowKey?: string,
  ) => void;
  readonly onSelectNode: (key: string) => void;
  readonly onDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onDrag: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onDragEnd: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onMoveByKeyboard: (
    direction: OverviewThreadD3FlowMoveDirection,
  ) => void;
  readonly onResizeStart: (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  readonly onResize: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onResizeEnd: (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  readonly onDismiss: () => void;
}): JSX.Element {
  const liveCount =
    members.filter((member) =>
      member.kind === "activity"
        ? member.activity.status === "active"
        : member.kind === "recorded" && member.node.freshness === "running"
    ).length;
  const alertCount =
    members.filter((member) =>
      member.kind === "activity"
        ? member.activity.status === "blocked"
        : member.kind === "recorded" && (member.node.freshness === "failed" ||
          member.node.freshness === "stale")
    ).length;
  const viewerCount = members.reduce(
    (count, member) =>
      count + (viewerSessionsByNodeKey.get(member.key)?.length ?? 0),
    0,
  );
  return (
    <section
      className={cn(
        "overview-thread-hull-monitor",
        whiteboardMonitor,
      )}
      aria-label={`${flowGroupCaption(group)} hull monitor`}
      style={{
        left: geometry.x,
        top: geometry.y,
        width: geometry.width,
        height: geometry.height,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onDismiss();
      }}
    >
      <header
        className={whiteboardMonitorPart({ part: "header" })}
        tabIndex={0}
        aria-label={`Move ${
          flowGroupCaption(group)
        } hull monitor with drag or arrow keys`}
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
        onPointerDown={onDragStart}
        onPointerMove={onDrag}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        onLostPointerCapture={onDragEnd}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (!isOverviewMoveDirection(event.key)) return;
          event.preventDefault();
          onMoveByKeyboard(event.key);
        }}
      >
        <div>
          <p className={cn("m-0", SECTION_LABEL)}>
            {overviewLaneTitle(group.lane)} · Hull monitor
          </p>
          <h4 className={whiteboardMonitorPart({ part: "title" })}>
            {flowGroupCaption(group)}
          </h4>
        </div>
        <button
          type="button"
          className={whiteboardMonitorPart({ part: "close" })}
          onClick={onDismiss}
          aria-label="Close hull monitor"
        >
          Close
        </button>
      </header>
      <div
        className={cn(
          "overview-thread-hull-monitor-metrics",
          whiteboardMonitorPart({ part: "metrics" }),
        )}
      >
        <span className={whiteboardMonitorPart({ part: "metric" })}>
          <strong>{members.length}</strong> nodes
        </span>
        <span
          className={whiteboardMonitorPart({ part: "metric" })}
          data-live={liveCount > 0 ? "true" : undefined}
        >
          <strong>{liveCount}</strong> live
        </span>
        <span
          className={whiteboardMonitorPart({ part: "metric" })}
          data-alert={alertCount > 0 ? "true" : undefined}
        >
          <strong>{alertCount}</strong> alerts
        </span>
        <span className={whiteboardMonitorPart({ part: "metric" })}>
          <strong>{viewerCount}</strong> Apps
        </span>
      </div>
      <div
        className={cn(
          "overview-thread-hull-monitor-list",
          whiteboardMonitorPart({ part: "list" }),
        )}
      >
        {members.map((member) => {
          const memberActions = overviewNodeContextActions(
            member,
            viewerSessionsByNodeKey,
            viewerAliases,
          );
          return (
            <article
              key={member.key}
              className={whiteboardMonitorPart({ part: "item" })}
              data-kind={member.kind}
            >
              <button
                type="button"
                className={cn(
                  "overview-thread-hull-monitor-node",
                  whiteboardMonitorPart({ part: "node" }),
                )}
                onClick={() => onSelectNode(member.key)}
              >
                <span>{member.label}</span>
                <small>{overviewNodeContextMeta(member)}</small>
              </button>
              <div
                className={cn(
                  "overview-thread-hull-monitor-actions",
                  whiteboardMonitorPart({ part: "actions" }),
                )}
              >
                {memberActions.map((action, index) => (
                  <button
                    key={overviewContextActionValue(action, index)}
                    type="button"
                    className={whiteboardMonitorAction({
                      app: action.kind === "open-session",
                    })}
                    data-app={action.kind === "open-session"
                      ? "true"
                      : undefined}
                    onClick={() => onAction(action)}
                  >
                    {action.kind === "open-session"
                      ? action.label.replace("Open App · ", "")
                      : action.label}
                  </button>
                ))}
              </div>
            </article>
          );
        })}
      </div>
      <button
        type="button"
        className={cn(
          "overview-thread-viewer-resize",
          whiteboardViewerPart({ part: "resize" }),
        )}
        aria-label={`Resize ${flowGroupCaption(group)} hull monitor`}
        onPointerDown={onResizeStart}
        onPointerMove={onResize}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        onLostPointerCapture={onResizeEnd}
      >
        Resize
      </button>
    </section>
  );
}

function OverviewFloatingViewer({
  refViewer,
  viewer,
  item,
  viewerSession,
  currentBrief,
  onBringFront,
  onClose,
  onToggleExpanded,
  onMoveByKeyboard,
  onResizeByKeyboard,
  onDragStart,
  onDrag,
  onDragEnd,
  onResizeStart,
  onResize,
  onResizeEnd,
}: {
  readonly refViewer: (node: HTMLElement | null) => void;
  readonly viewer: OverviewViewerState;
  readonly item?: OverviewHeroNode;
  readonly viewerSession?: ThreadViewerSession;
  readonly currentBrief?: ProjectBriefRevision;
  readonly onBringFront: () => void;
  readonly onClose: () => void;
  readonly onToggleExpanded: () => void;
  readonly onMoveByKeyboard: (
    direction: OverviewThreadD3FlowMoveDirection,
  ) => void;
  readonly onResizeByKeyboard: (
    direction: OverviewThreadD3FlowMoveDirection,
  ) => void;
  readonly onDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onDrag: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onDragEnd: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onResizeStart: (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  readonly onResize: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onResizeEnd: (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
}): JSX.Element {
  const title = viewer.kind === "current-brief"
    ? overviewCurrentBriefViewerTitle(currentBrief?.revision ?? 0)
    : overviewViewerTitle(item, viewerSession);
  return (
    <article
      ref={refViewer}
      className={cn(
        "overview-thread-viewer",
        whiteboardViewer({ expanded: Boolean(viewer.restoreGeometry) }),
      )}
      data-viewer-id={viewer.id}
      data-viewer-kind={viewer.kind}
      data-anchor-node={viewer.kind === "session" ? viewer.nodeKey : undefined}
      data-expanded={viewer.restoreGeometry ? "true" : "false"}
      style={{
        left: viewer.x,
        top: viewer.y,
        width: viewer.width,
        height: viewer.height,
        zIndex: viewer.z,
      }}
      tabIndex={-1}
      role="region"
      aria-label={title}
      onPointerDown={onBringFront}
      onFocus={onBringFront}
      onWheel={(event) => event.stopPropagation()}
    >
      <header
        className={cn(
          "overview-thread-viewer-handle",
          whiteboardViewerPart({ part: "handle" }),
        )}
        tabIndex={viewer.restoreGeometry ? -1 : 0}
        aria-label={`Move ${title} with drag or arrow keys`}
        onPointerDown={onDragStart}
        onPointerMove={onDrag}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        onLostPointerCapture={onDragEnd}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (!isOverviewMoveDirection(event.key)) return;
          event.preventDefault();
          onMoveByKeyboard(event.key);
        }}
      >
        <span
          className={cn(
            "overview-thread-viewer-title",
            whiteboardViewerPart({ part: "title" }),
          )}
          title={viewerSession
            ? `${viewerSession.app.id}@${viewerSession.app.version} · ${viewerSession.session.schema}`
            : undefined}
        >
          {title}
        </span>
        <span
          className={cn(
            "overview-thread-viewer-actions",
            whiteboardViewerPart({ part: "actions" }),
          )}
        >
          <button
            type="button"
            className={whiteboardViewerPart({ part: "action" })}
            onClick={onToggleExpanded}
            aria-label={`${
              viewer.restoreGeometry ? "Restore" : "Expand"
            } ${title}`}
          >
            {viewer.restoreGeometry ? "Restore" : "Expand"}
          </button>
          <button
            type="button"
            className={whiteboardViewerPart({ part: "action" })}
            onClick={onClose}
            aria-label={`Close ${title}`}
          >
            Close
          </button>
        </span>
      </header>
      <div
        className={cn(
          "overview-thread-viewer-body",
          whiteboardViewerPart({ part: "body" }),
        )}
      >
        {viewer.kind === "current-brief" && currentBrief
          ? <OverviewCurrentBriefDocument brief={currentBrief} />
          : viewerSession?.kind === "mcp-app"
          ? (
            <McpAppFrame
              className="overview-thread-viewer-app-frame"
              session={viewerSession}
            />
          )
          : (
            <p
              className={cn(
                "overview-thread-viewer-unavailable",
                whiteboardViewerPart({ part: "unavailable" }),
              )}
            >
              Exact viewer session unavailable in this replacement.
            </p>
          )}
      </div>
      <button
        type="button"
        className={cn(
          "overview-thread-viewer-resize",
          whiteboardViewerPart({ part: "resize" }),
        )}
        aria-label={`Resize ${title}`}
        disabled={Boolean(viewer.restoreGeometry)}
        onPointerDown={onResizeStart}
        onPointerMove={onResize}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        onLostPointerCapture={onResizeEnd}
        onKeyDown={(event) => {
          if (!isOverviewMoveDirection(event.key)) return;
          event.preventDefault();
          onResizeByKeyboard(event.key);
        }}
      >
        Resize
      </button>
    </article>
  );
}

function overviewViewerTitle(
  item?: OverviewHeroNode,
  viewerSession?: ThreadViewerSession,
): string {
  if (item?.label) return item.label;
  return viewerSession
    ? `${viewerSession.app.id}@${viewerSession.app.version}`
    : "App session · unavailable";
}
