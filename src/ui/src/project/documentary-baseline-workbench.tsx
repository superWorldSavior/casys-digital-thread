import type { JSX } from "react";
import { cn } from "../lib/utils.ts";
import type { ThreadStreamStatus } from "../thread/client.ts";
import type { ThreadViewerSessionsProjection } from "../thread/viewer-sessions-client.ts";
import type { EngineeringDocumentaryWorkbenchSnapshot } from "../thread/types.ts";
import { Badge, type BadgeProps } from "../ui/badge.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card.tsx";
import { DocumentaryTechnicalStartActivity } from "./documentary-technical-start-activity.tsx";
import {
  buildProjectBrief,
  phaseStatusLabel,
  type ProjectBrief,
  projectBriefStatusLabel,
  projectStatusTone,
} from "./model.ts";
import { ProjectNavigation, type ProjectWorkspaceView } from "./navigation.tsx";
import { hasDistinctProjectObjectiveStatement } from "./navigation-model.ts";
import { ProjectWorkRibbon } from "./work.tsx";
import { ProjectReviewAppHandoffs } from "./control-center.tsx";
import { buildProjectReviewRecords } from "./review-decision-model.ts";
import { ProjectWhiteboardFrame } from "./project-whiteboard-frame.tsx";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

/**
 * The pre-technical state of the same project cockpit. A documentary starting
 * record does not get a second UI: it keeps the standard project navigation,
 * while the technical areas honestly explain what has not been recorded yet.
 */
export function DocumentaryBaselineWorkbench({
  workbench,
  viewerSessions,
  streamStatus,
  activeView,
  onChangeView,
}: {
  workbench: EngineeringDocumentaryWorkbenchSnapshot;
  viewerSessions?: ThreadViewerSessionsProjection;
  streamStatus: ThreadStreamStatus | "snapshot";
  activeView: ProjectWorkspaceView;
  onChangeView: (view: ProjectWorkspaceView) => void;
}): JSX.Element {
  const project = workbench.project;
  const brief = buildProjectBrief(project);
  const { documentary } = workbench;
  const { record } = documentary;
  const technicalStart = documentary.technicalStart;
  const statusSeal = documentaryProjectStatusSeal(brief, technicalStart);
  const reviewRecords = buildProjectReviewRecords(project);
  return (
    <div className="thread-workbench cockpit-surface">
      <ProjectNavigation
        activeView={activeView}
        onChange={onChangeView}
        status={
          <>
            <span
              className="project-navigation-stream"
              data-state={streamStatus}
              aria-live="polite"
            >
              <i aria-hidden="true" />
              <span className="project-navigation-stream-label">
                {documentaryStreamLabel(streamStatus)}
              </span>
            </span>
            <time
              className="project-navigation-time"
              dateTime={record.recordedAt}
              title={`Recorded ${record.recordedAt}`}
            >
              {formatTime(record.recordedAt)}
            </time>
          </>
        }
      />

      {activeView === "overview"
        ? (
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
                  Project objective
                </p>
                <h3 id="project-objective-title">
                  {project.project.objective.title}
                </h3>
                {hasDistinctProjectObjectiveStatement(
                  project.project.objective.title,
                  project.project.objective.statement,
                ) && (
                  <blockquote className="mt-3 max-w-3xl text-sm text-muted-foreground">
                    {project.project.objective.statement}
                  </blockquote>
                )}
              </div>
              <div
                className="flex shrink-0 flex-col items-start gap-1.5 md:items-end"
                data-tone={statusSeal.tone}
                aria-label={`Project status: ${statusSeal.label}`}
              >
                <Badge
                  variant={projectToneVariant(statusSeal.tone)}
                  className="gap-1.5 px-2.5 py-1 text-sm"
                >
                  <i
                    aria-hidden="true"
                    className={cn(
                      "size-1.5 rounded-full",
                      toneDotClass(statusSeal.tone),
                    )}
                  />
                  {statusSeal.label}
                </Badge>
                <p className="text-xs text-muted-foreground">
                  {brief.completedPhases}/{brief.phases.length}{" "}
                  phase gates satisfied
                </p>
              </div>
            </section>

            <ProjectWorkRibbon project={project} />

            <ProjectWhiteboardFrame
              key={project.project.id}
              projectId={project.project.id}
            />

            <ProjectReviewAppHandoffs
              project={project}
              records={reviewRecords}
              projection={viewerSessions}
            />

            <DocumentaryProjectPath brief={brief} />

            {technicalStart && (
              <DocumentaryTechnicalStartActivity
                technicalStart={technicalStart}
              />
            )}

            <section
              aria-labelledby="documentary-baseline-title"
              role="status"
            >
              <Card>
                <CardHeader>
                  <p className="text-xs font-medium text-muted-foreground">
                    Durable starting record
                  </p>
                  <CardTitle
                    id="documentary-baseline-title"
                    className="text-base"
                  >
                    Your reviewed starting point is now traceable
                  </CardTitle>
                  <CardDescription>{documentary.message}</CardDescription>
                </CardHeader>
              </Card>
            </section>

            <section aria-labelledby="documentary-record-title">
              <Card>
                <CardHeader className="flex-row items-start justify-between gap-4 max-md:flex-col">
                  <div className="min-w-0 space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">
                      Recorded provenance
                    </p>
                    <CardTitle
                      id="documentary-record-title"
                      className="text-base"
                    >
                      {record.label}
                    </CardTitle>
                  </div>
                  <Badge variant="success">Immutable record</Badge>
                </CardHeader>
                <CardContent>
                  <dl className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Record type
                      </dt>
                      <dd className="text-sm">
                        Approved project brief and reviewed path
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Snapshot
                      </dt>
                      <dd className="font-mono text-xs text-muted-foreground">
                        Revision {record.snapshotRevision}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Fingerprint
                      </dt>
                      <dd className="font-mono text-xs text-muted-foreground">
                        {shortFingerprint(record.fingerprint)}
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            </section>

            <section
              className="grid gap-4 md:grid-cols-2"
              aria-label="Meaning of the documentary baseline"
            >
              <Card>
                <CardHeader>
                  <p className="text-xs font-medium text-muted-foreground">
                    What is now durable
                  </p>
                  <CardTitle className="text-base">
                    The project’s approved starting point
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="list-none space-y-1.5 text-sm text-muted-foreground">
                    <li className="before:mr-2 before:text-success before:content-['•']">
                      The approved project brief is retained with its project
                      path.
                    </li>
                    <li className="before:mr-2 before:text-success before:content-['•']">
                      The record has one exact, checkable fingerprint.
                    </li>
                    <li className="before:mr-2 before:text-success before:content-['•']">
                      Later technical work can name this starting record.
                    </li>
                  </ul>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <p className="text-xs font-medium text-muted-foreground">
                    What this does not prove
                  </p>
                  <CardTitle className="text-base">
                    Engineering claims still need a bounded run
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="list-none space-y-1.5 text-sm text-muted-foreground">
                    <li className="before:mr-2 before:text-warning before:content-['•']">
                      No SysML model or CAD geometry is recorded.
                    </li>
                    <li className="before:mr-2 before:text-warning before:content-['•']">
                      No simulation, measurement or physical behaviour is
                      recorded.
                    </li>
                    <li className="before:mr-2 before:text-warning before:content-['•']">
                      No requirement, compliance or certification verdict
                      exists.
                    </li>
                  </ul>
                </CardContent>
              </Card>
            </section>

            <section aria-labelledby="documentary-next-step-title">
              <Card>
                <CardHeader>
                  <p className="text-xs font-medium text-muted-foreground">
                    Next with your agent
                  </p>
                  <CardTitle
                    id="documentary-next-step-title"
                    className="text-base"
                  >
                    {technicalStart
                      ? "Follow the bounded technical start"
                      : "Choose the first bounded technical operation"}
                  </CardTitle>
                  <CardDescription>
                    {technicalStart
                      ? "The activity above is the only live view of this narrow operation. It remains provisional until a read-back, hash-addressed record becomes the next thread revision."
                      : (
                        <>
                          {documentary.technicalEvidence.message}{" "}
                          Ask the agent to propose a concrete model, CAD or
                          analysis step in your paired conversation. Its
                          recorded scope and results will appear here.
                        </>
                      )}
                  </CardDescription>
                </CardHeader>
              </Card>
            </section>

            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">
                Exact documentary record
              </summary>
              <dl className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <dt>Snapshot</dt>
                  <dd className="font-mono text-xs">
                    {record.snapshotId}@{record.snapshotRevision}
                  </dd>
                </div>
                <div>
                  <dt>Artifact</dt>
                  <dd className="font-mono text-xs">{record.artifactId}</dd>
                </div>
                <div>
                  <dt>Fingerprint</dt>
                  <dd className="font-mono text-xs">{record.fingerprint}</dd>
                </div>
                <div>
                  <dt>Captured</dt>
                  <dd className="font-mono text-xs">
                    {formatDateTime(record.recordedAt)}
                  </dd>
                </div>
                {record.uri && (
                  <div>
                    <dt>Record URI</dt>
                    <dd className="font-mono text-xs">{record.uri}</dd>
                  </div>
                )}
              </dl>
            </details>
          </main>
        )
        : (
          <DocumentaryWorkspace
            activeView={activeView}
            project={project}
            technicalStart={technicalStart}
            technicalEvidenceMessage={documentary.technicalEvidence.message}
          />
        )}
    </div>
  );
}

function DocumentaryProjectPath(
  { brief }: { brief: ProjectBrief },
): JSX.Element {
  return (
    <section aria-labelledby="documentary-project-path-title">
      <Card>
        <CardHeader>
          <p className="text-xs font-medium text-muted-foreground">
            Project path
          </p>
          <CardTitle
            id="documentary-project-path-title"
            className="text-base"
          >
            Intent to technical proof
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol
            className="flex items-start overflow-x-auto"
            tabIndex={0}
            aria-label="Project phases, scrolls horizontally"
          >
            {brief.phases.map((item, index) => (
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
                  {index < brief.phases.length - 1 && (
                    <span
                      className="h-px flex-1 bg-border"
                      aria-hidden="true"
                    />
                  )}
                </div>
                <span className="text-xs font-medium">{item.phase.name}</span>
                <p className="text-xs text-muted-foreground">
                  {phaseStatusLabel(item.status)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.phase.description}
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.completedWorkItems}/{item.totalWorkItems} work ·{" "}
                  {item.evidenceCount} evidence
                </p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </section>
  );
}

function DocumentaryWorkspace({
  activeView,
  project,
  technicalStart,
  technicalEvidenceMessage,
}: {
  activeView: Exclude<ProjectWorkspaceView, "overview">;
  project: EngineeringDocumentaryWorkbenchSnapshot["project"];
  technicalStart:
    EngineeringDocumentaryWorkbenchSnapshot["documentary"]["technicalStart"];
  technicalEvidenceMessage: string;
}): JSX.Element {
  const copy = documentaryWorkspaceCopy(activeView);
  return (
    <main
      className="grid gap-4"
      id="project-workspace-panel"
      tabIndex={-1}
      aria-labelledby="documentary-workspace-title"
    >
      <div>
        <h3
          id="documentary-workspace-title"
          className="text-lg font-semibold tracking-tight"
        >
          {copy.title}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {copy.description}
        </p>
      </div>
      {activeView === "work"
        ? (
          <>
            <ProjectWorkRibbon project={project} />
            {technicalStart
              ? (
                <DocumentaryTechnicalStartActivity
                  technicalStart={technicalStart}
                />
              )
              : (
                <DocumentaryUnavailable
                  title="No live engineering activity yet"
                  detail={technicalEvidenceMessage}
                />
              )}
          </>
        )
        : activeView === "operations"
        ? <DocumentaryExecution project={project} />
        : (
          <DocumentaryUnavailable
            title={copy.unavailableTitle}
            detail={copy.unavailableDetail}
          />
        )}
    </main>
  );
}

function DocumentaryUnavailable({ title, detail }: {
  title: string;
  detail: string;
}): JSX.Element {
  return (
    <Card role="status">
      <CardHeader>
        <p className="text-xs font-medium text-muted-foreground">
          Not recorded yet
        </p>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{detail}</CardDescription>
        <CardDescription>
          Ask your agent to propose the next bounded operation; its recorded
          result will appear in this project cockpit.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

function DocumentaryExecution({ project }: {
  project: EngineeringDocumentaryWorkbenchSnapshot["project"];
}): JSX.Element {
  return (
    <div className="grid gap-4">
      <ProjectWorkRibbon project={project} />
      <section aria-labelledby="documentary-execution-title">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4 max-md:flex-col">
            <div className="min-w-0 space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                Recorded execution
              </p>
              <CardTitle
                id="documentary-execution-title"
                className="text-base"
              >
                Project run journal
              </CardTitle>
            </div>
            <span className="text-xs text-muted-foreground">
              {project.agentRuns.length} recorded
            </span>
          </CardHeader>
          <CardContent>
            <p className="rounded-lg bg-muted/50 px-4 py-6 text-center text-sm text-muted-foreground">
              This project has a durable starting record. No technical tool run
              has produced evidence yet.
            </p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function documentaryWorkspaceCopy(
  view: Exclude<ProjectWorkspaceView, "overview">,
): {
  title: string;
  description: string;
  unavailableTitle: string;
  unavailableDetail: string;
} {
  if (view === "work") {
    return {
      title: "Activity",
      description: "Recorded activity only; no technical evidence yet.",
      unavailableTitle: "No live engineering activity yet",
      unavailableDetail:
        "The documentary baseline is complete; the next technical operation has not been recorded.",
    };
  }
  if (view === "verification") {
    return {
      title: "Evidence map",
      description: "Traceability appears after a bounded technical result.",
      unavailableTitle: "No verification chain is recorded yet",
      unavailableDetail:
        "There are no requirements, measurements or evidence relations to trace from the documentary baseline.",
    };
  }
  return {
    title: "Execution record",
    description: "Recorded runs and explicitly planned work.",
    unavailableTitle: "No technical execution is recorded yet",
    unavailableDetail:
      "The only recorded operation established the approved starting point; it did not produce technical evidence.",
  };
}

/**
 * A live technical-start failure is a narrower, more immediate review signal
 * than the aggregate project status. Keep the domain run unchanged: this is
 * only the documentary surface refusing to present an active seal while its
 * one visible operation needs human attention.
 */
function documentaryProjectStatusSeal(
  brief: ProjectBrief,
  technicalStart:
    EngineeringDocumentaryWorkbenchSnapshot["documentary"]["technicalStart"],
): {
  readonly tone: ReturnType<typeof projectStatusTone>;
  readonly label: string;
} {
  if (technicalStart?.state === "failed") {
    return { tone: "attention", label: "Review required" };
  }
  return {
    tone: projectStatusTone(brief.status),
    label: projectBriefStatusLabel(brief),
  };
}

function documentaryStreamLabel(
  status: ThreadStreamStatus | "snapshot",
): string {
  if (status === "live") return "Project record is current";
  if (status === "connecting") return "Connecting to project updates";
  if (status === "reconnecting") return "Restoring project updates";
  return "Durable project record";
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

function shortFingerprint(value: string): string {
  if (value.length <= 20) return value;
  return `${value.slice(0, 12)}…${value.slice(-7)}`;
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

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}
