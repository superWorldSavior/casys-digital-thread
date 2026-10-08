import type { JSX } from "react";
import { recordStatusVariant } from "./record-status.ts";
import type {
  EngineeringPhaseStatus,
  EngineeringProjectPhase,
  EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";
import {
  currentProjectAnswer,
  engineeringProjectFramingStatus,
  projectBriefItems,
  type ProjectBriefRevision,
} from "../../../domain/project/project-brief.ts";
import { cn } from "../lib/utils.ts";
import type { ThreadStreamStatus } from "../thread/client.ts";
import type { ThreadViewerSessionsProjection } from "../thread/viewer-sessions-client.ts";
import type { EngineeringPlanningWorkbenchSnapshot } from "../thread/types.ts";
import { Badge, type BadgeProps } from "../ui/badge.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card.tsx";
import { BaselineRunActivity } from "./baseline-run-activity.tsx";
import { ProjectBriefElicitation } from "./brief-elicitation.tsx";
import { ProjectNavigation, type ProjectWorkspaceView } from "./navigation.tsx";
import { hasDistinctProjectObjectiveStatement } from "./navigation-model.ts";
import {
  buildProjectBrief,
  phaseStatusLabel,
  projectBriefStatusLabel,
  projectStatusTone,
  workOwnerLabel,
  workStatusLabel,
} from "./model.ts";
import { ProjectReviewAppHandoffs } from "./control-center.tsx";
import { buildProjectReviewRecords } from "./review-decision-model.ts";
import { ProjectWhiteboardFrame } from "./project-whiteboard-frame.tsx";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

/**
 * Native project surface for the period between an approved brief and the
 * first documentary baseline. It intentionally renders the durable project path
 * rather than manufacturing an empty graph, component list or tool result.
 */
export function PlanningWorkbench({
  workbench,
  viewerSessions,
  streamStatus,
  activeView,
  onChangeView,
}: {
  workbench: EngineeringPlanningWorkbenchSnapshot;
  viewerSessions?: ThreadViewerSessionsProjection;
  streamStatus: ThreadStreamStatus | "snapshot";
  activeView: ProjectWorkspaceView;
  onChangeView: (view: ProjectWorkspaceView) => void;
}): JSX.Element {
  const project = workbench.project;
  const brief = buildProjectBrief(project);
  const phases = [...brief.phases];
  const items = sortWorkItems(project.workItems, project.phases);
  const hasPath = phases.length > 0;
  const baseline = workbench.planning.technicalBaseline;
  const framing = project.framing;
  const framingStatus = framing
    ? engineeringProjectFramingStatus(framing)
    : undefined;
  const displayedBrief = framing?.proposedBrief ?? framing?.currentBrief;
  const intentStatement = framing?.intent.statement ??
    project.project.objective.statement;
  const displayedObjective =
    (displayedBrief
      ? projectBriefItems(displayedBrief, "objective")[0]?.statement
      : intentStatement) ?? intentStatement;
  const projectStateLabel = framingStatus && framingStatus !== "approved"
    ? framingStatusLabel(framingStatus)
    : projectBriefStatusLabel(brief);
  const projectStateDetail = hasPath
    ? `${brief.completedPhases}/${brief.phases.length} phase gates satisfied`
    : framingStatus === "awaiting-review"
    ? "Review the brief before planning"
    : framingStatus === "revision-requested"
    ? "Continue refining it with the agent"
    : "Shape the brief with the agent";
  const statusTone = projectStatusTone(brief.status);
  const reviewRecords = buildProjectReviewRecords(project);

  return (
    <div className="thread-workbench cockpit-surface planning-workbench">
      <ProjectNavigation
        activeView={activeView}
        onChange={onChangeView}
        disabledViews={["work", "verification", "operations"]}
        status={
          <>
            <span
              className="project-navigation-stream"
              data-state={streamStatus}
              aria-live="polite"
            >
              <i aria-hidden="true" />
              <span className="project-navigation-stream-label">
                {planningStreamLabel(streamStatus)}
              </span>
            </span>
            <time
              className="project-navigation-time"
              dateTime={project.generatedAt}
              title={`Updated ${project.generatedAt}`}
            >
              {formatTime(project.generatedAt)}
            </time>
          </>
        }
      />

      <main
        className="grid gap-4"
        id="project-workspace-panel"
        tabIndex={-1}
      >
        <section
          className="flex flex-col gap-4 border-b border-border pb-4 md:flex-row md:items-start md:justify-between"
          aria-labelledby="project-objective-title"
        >
          <div className="min-w-0 [&>h3]:m-0 [&>h3]:max-w-3xl [&>h3]:text-lg [&>h3]:font-semibold [&>h3]:tracking-tight">
            <p className="text-xs font-medium text-muted-foreground">
              {framingStatus === "awaiting-review"
                ? "Brief proposed for review"
                : framingStatus === "revision-requested"
                ? "Brief revision requested"
                : framingStatus === "approved"
                ? "Canonical project brief"
                : "Initial project intent"}
            </p>
            <h3 id="project-objective-title">
              {displayedObjective}
            </h3>
            {hasDistinctProjectObjectiveStatement(
              displayedObjective,
              intentStatement,
            ) && (
              <blockquote className="mt-3 max-w-3xl text-sm text-muted-foreground">
                {intentStatement}
              </blockquote>
            )}
          </div>
          <div
            className="flex shrink-0 flex-col items-start gap-1.5 md:items-end"
            data-tone={statusTone}
            aria-label={`Project status: ${projectStateLabel}`}
          >
            <Badge
              variant={projectToneVariant(statusTone)}
              className="gap-1.5 px-2.5 py-1 text-sm"
            >
              <i
                aria-hidden="true"
                className={cn(
                  "size-1.5 rounded-full",
                  toneDotClass(statusTone),
                )}
              />
              {projectStateLabel}
            </Badge>
            <p className="text-xs text-muted-foreground">
              {projectStateDetail}
            </p>
          </div>
        </section>

        <ProjectWhiteboardFrame
          key={project.project.id}
          projectId={project.project.id}
        />

        {framing && framingStatus === "approved" && (
          <ProjectFraming
            projectId={project.project.id}
            brief={framing.currentBrief}
            status={framingStatus}
            questions={framing.questions.filter((question) =>
              currentProjectAnswer(framing, question.id) === undefined
            )}
          />
        )}
        {framing && framingStatus !== "approved" && (
          <ProjectBriefElicitation
            projectId={project.project.id}
            framing={framing}
          />
        )}

        <ProjectReviewAppHandoffs
          project={project}
          records={reviewRecords}
          projection={viewerSessions}
        />

        <section
          aria-labelledby="planning-baseline-title"
          role="status"
        >
          <Card>
            <CardHeader>
              <p className="text-xs font-medium text-muted-foreground">
                Before technical evidence
              </p>
              <CardTitle
                id="planning-baseline-title"
                className="text-base"
              >
                {technicalBaselineTitle(baseline.status)}
              </CardTitle>
              <CardDescription>{baseline.message}</CardDescription>
            </CardHeader>
          </Card>
        </section>

        <BaselineRunActivity planning={workbench.planning} />

        <section aria-labelledby="project-phase-title">
          <Card>
            <CardHeader>
              <p className="text-xs font-medium text-muted-foreground">
                Project path
              </p>
              <CardTitle
                id="project-phase-title"
                className="text-base"
              >
                {hasPath ? "Proposed project path" : "No project path yet"}
              </CardTitle>
              <CardDescription>
                {hasPath
                  ? "This path is durable planning intent. It is not proof that a technical operation ran."
                  : "The project brief is being shaped with the agent. No work path or technical evidence is recorded yet."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {hasPath
                ? (
                  <ol
                    className="flex items-start overflow-x-auto"
                    tabIndex={0}
                    aria-label="Project phases, scrolls horizontally"
                  >
                    {phases.map((item, index) => (
                      <li
                        key={item.phase.id}
                        data-state={item.status}
                        className="flex min-w-[8.5rem] flex-1 flex-col gap-1.5"
                      >
                        <div className="flex items-center gap-3">
                          <span
                            aria-hidden="true"
                            className={cn(
                              "size-2 shrink-0 rounded-full",
                              item.status === "completed" ||
                                item.status === "active"
                                ? "bg-success"
                                : "bg-muted-foreground",
                            )}
                          />
                          {index < phases.length - 1 && (
                            <span
                              className="h-px flex-1 bg-border"
                              aria-hidden="true"
                            />
                          )}
                        </div>
                        <span className="text-xs font-medium">
                          {item.phase.name}
                        </span>
                        <p className="text-xs text-muted-foreground">
                          {planningPhaseLabel(item.status)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.phase.description}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.totalWorkItems} planned work
                          {item.requiredDecisions > 0 && (
                            <>
                              {" · "}
                              {item.requiredDecisions} review gates
                            </>
                          )}
                        </p>
                      </li>
                    ))}
                  </ol>
                )
                : (
                  <p className="rounded-lg bg-muted/50 px-4 py-6 text-center text-sm text-muted-foreground">
                    Ask the agent to publish a bounded project path in your
                    paired conversation. The recorded path will appear here.
                  </p>
                )}
            </CardContent>
          </Card>
        </section>

        {hasPath && (
          <section aria-labelledby="planning-work-title">
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-4 max-md:flex-col">
                <div className="min-w-0 space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    Declared work
                  </p>
                  <CardTitle
                    id="planning-work-title"
                    className="text-base"
                  >
                    What the path contains
                  </CardTitle>
                </div>
                <span className="text-xs text-muted-foreground">
                  {items.length} planned item{items.length === 1 ? "" : "s"}
                </span>
              </CardHeader>
              <CardContent>
                <ol className="divide-y divide-border">
                  {items.map((item) => (
                    <PlanningWorkItem
                      key={item.id}
                      item={item}
                      phase={project.phases.find((phase) =>
                        phase.id === item.phaseId
                      )}
                    />
                  ))}
                </ol>
              </CardContent>
            </Card>
          </section>
        )}

        <section aria-labelledby="planning-next-title">
          <Card>
            <CardHeader>
              <p className="text-xs font-medium text-muted-foreground">
                Next human move
              </p>
              <CardTitle id="planning-next-title" className="text-base">
                {nextHumanMoveTitle(baseline.status)}
              </CardTitle>
              <CardDescription>
                {nextHumanMoveMessage(baseline.status)}
              </CardDescription>
            </CardHeader>
          </Card>
        </section>

        {project.plan && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Planning provenance</summary>
            <dl className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <dt>Starting point</dt>
                <dd>
                  {startingPointLabel(project.plan.startingPoint)}
                </dd>
              </div>
              <div>
                <dt>Approved brief</dt>
                <dd className="font-mono text-xs">
                  {`${project.plan.basis.briefId}@${project.plan.basis.briefRevision}`}
                </dd>
              </div>
              <div>
                <dt>Path published</dt>
                <dd className="font-mono text-xs">
                  {formatTime(project.plan.publishedAt)}
                </dd>
              </div>
            </dl>
          </details>
        )}
      </main>
    </div>
  );
}

function ProjectFraming({
  projectId,
  brief,
  status,
  questions,
}: {
  projectId: string;
  brief?: ProjectBriefRevision;
  status: ReturnType<typeof engineeringProjectFramingStatus>;
  questions: NonNullable<
    EngineeringPlanningWorkbenchSnapshot["project"]["framing"]
  >["questions"];
}): JSX.Element {
  const sections = brief
    ? [{
      title: "Mission",
      items: projectBriefItems(brief, "mission-scenario"),
    }, {
      title: "Success criteria",
      items: projectBriefItems(brief, "success-criterion"),
    }, {
      title: "Constraints",
      items: projectBriefItems(brief, "constraint"),
    }, {
      title: "Out of scope",
      items: projectBriefItems(brief, "exclusion"),
    }, {
      title: "Assumptions to verify",
      items: projectBriefItems(brief, "assumption"),
    }, {
      title: "Compliance targets",
      items: projectBriefItems(brief, "compliance-target"),
    }].filter((section) => section.items.length > 0)
    : [];
  return (
    <section aria-labelledby="project-framing-title">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 max-md:flex-col">
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Living project brief
            </p>
            <CardTitle id="project-framing-title" className="text-base">
              One project, from first intent onward
            </CardTitle>
          </div>
          <Badge variant={framingStatusVariant(status)} data-state={status}>
            {framingStatusLabel(status)}
          </Badge>
        </CardHeader>
        <CardContent className="grid gap-6">
          {brief
            ? (
              <>
                <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
                  {sections.map((section) => (
                    <section key={section.title}>
                      <h4 className="text-sm font-semibold">
                        {section.title}
                      </h4>
                      <ul className="mt-2 list-none space-y-1.5 text-sm text-muted-foreground">
                        {section.items.map((item) => (
                          <li
                            key={item.id}
                            className="before:mr-2 before:text-muted-foreground/60 before:content-['•']"
                          >
                            {item.statement}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">
                  {status === "awaiting-review"
                    ? "Review this proposal in the paired conversation. It does not replace the canonical brief until you confirm the exact revision."
                    : status === "revision-requested"
                    ? "Continue the conversation with the agent; the last approved brief remains canonical while this proposal is corrected."
                    : "This approved brief anchors planning. Later technical facts stay in SysML, CAD, simulation and evidence records linked to this project."}
                </p>
              </>
            )
            : (
              <p className="rounded-lg bg-muted/50 px-4 py-6 text-center text-sm text-muted-foreground">
                Project {projectId}{" "}
                already exists. Continue describing the product in the paired
                conversation; the agent will add focused questions and
                consolidate the first reviewable brief here.
              </p>
            )}
          {questions.length > 0 && (
            <section>
              <p className="text-xs font-medium text-muted-foreground">
                Questions to discuss with the agent
              </p>
              <ol className="mt-2 divide-y divide-border">
                {questions.slice(0, 3).map((question) => (
                  <li
                    key={question.id}
                    className="py-3 first:pt-0 last:pb-0"
                  >
                    <p className="text-sm font-semibold">{question.prompt}</p>
                    <p className="text-sm text-muted-foreground">
                      {question.whyItMatters}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function framingStatusLabel(
  status: ReturnType<typeof engineeringProjectFramingStatus>,
): string {
  if (status === "awaiting-review") return "Ready for conversation review";
  if (status === "revision-requested") return "Revision requested";
  if (status === "approved") return "Approved intent";
  return "Framing with agent";
}

function framingStatusVariant(
  status: ReturnType<typeof engineeringProjectFramingStatus>,
): BadgeVariant {
  if (status === "approved") return "success";
  if (
    status === "awaiting-review" || status === "revision-requested"
  ) {
    return "warning";
  }
  return "secondary";
}

function PlanningWorkItem({
  item,
  phase,
}: {
  item: EngineeringWorkItem;
  phase?: EngineeringProjectPhase;
}): JSX.Element {
  return (
    <li
      data-state={item.status}
      className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">
          {phase?.name ?? item.phaseId}
        </p>
        <p className="text-sm font-semibold">{item.title}</p>
        <p className="text-sm text-muted-foreground">{item.description}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {workOwnerLabel(item.owner)} · {item.kind}
          {item.operation && (
            <>
              {" · reviewed "}
              <span className="font-mono">
                {item.operation.id}@{item.operation.version}
              </span>
            </>
          )}
        </p>
      </div>
      <Badge variant={recordStatusVariant(item.status)}>
        {sentenceLabel(workStatusLabel(item.status))}
      </Badge>
    </li>
  );
}

function sortWorkItems(
  items: readonly EngineeringWorkItem[],
  phases: readonly EngineeringProjectPhase[],
): EngineeringWorkItem[] {
  const phaseOrder = new Map(phases.map((phase) => [phase.id, phase.order]));
  return [...items].sort((left, right) =>
    (phaseOrder.get(left.phaseId) ?? Number.MAX_SAFE_INTEGER) -
      (phaseOrder.get(right.phaseId) ?? Number.MAX_SAFE_INTEGER) ||
    left.title.localeCompare(right.title)
  );
}

function planningPhaseLabel(status: EngineeringPhaseStatus): string {
  if (status === "blocked") return "Needs review";
  if (status === "planned") return "Planned";
  return phaseStatusLabel(status);
}

function technicalBaselineTitle(status: string): string {
  if (status === "queued") return "Documentary baseline queued";
  if (status === "running") return "Documentary baseline in preparation";
  if (status === "publishing") return "Documentary baseline publishing";
  if (status === "failed") return "Documentary baseline needs review";
  return "Documentary baseline not created yet";
}

function nextHumanMoveTitle(status: string): string {
  if (status === "queued" || status === "running" || status === "publishing") {
    return "Follow the first baseline with your agent";
  }
  if (status === "failed") return "Review the stopped run with your agent";
  return "Review the path with your agent";
}

function nextHumanMoveMessage(status: string): string {
  if (status === "queued" || status === "running" || status === "publishing") {
    return "Keep the intent under review. The baseline will appear here once it is durably published; technical evidence still requires a later bounded operation.";
  }
  if (status === "failed") {
    return "Review the stopped run with the agent before authorizing another bounded operation. This page deliberately does not expose provider diagnostics as evidence.";
  }
  return "Review the project intent with the agent. A documentary baseline comes first; technical evidence remains a later, linked result.";
}

function planningStreamLabel(status: ThreadStreamStatus | "snapshot"): string {
  if (status === "live") return "Path updates are live";
  if (status === "connecting") return "Connecting to project updates";
  if (status === "reconnecting") return "Restoring project updates";
  return "Project path snapshot";
}

function startingPointLabel(value: string): string {
  if (value === "existing-cad") return "Existing CAD";
  if (value === "existing-product") return "Existing product";
  return "Idea or specification";
}

function projectToneVariant(
  tone: ReturnType<typeof projectStatusTone>,
): BadgeVariant {
  if (tone === "active" || tone === "complete") return "success";
  if (tone === "attention") return "warning";
  if (tone === "blocked") return "destructive";
  // Le ton neutre (Planned…) doit rester lisible sur le fond canvas : une
  // bordure, pas un fond gris quasi invisible.
  return "outline";
}

function toneDotClass(tone: ReturnType<typeof projectStatusTone>): string {
  if (tone === "active" || tone === "complete") return "bg-success";
  if (tone === "attention") return "bg-warning";
  if (tone === "blocked") return "bg-destructive";
  return "bg-muted-foreground";
}

function sentenceLabel(value: string): string {
  const label = value.replaceAll("-", " ");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
