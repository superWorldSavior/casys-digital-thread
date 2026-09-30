/**
 * App-managed provider lifecycle: demand, idle, drain, reconcile (#57).
 *
 * The Desktop process owns every running engineering provider it starts:
 * it allocates the loopback port, retains the actual binding as host-owned
 * runtime state, tracks demand across conversations and in-flight
 * operations, stops idle providers after a bounded delay, drains owned
 * resources on quit, and reconciles exact owned resources after a crash.
 * Saved source, results, and persistent volumes are always retained;
 * images are never pruned; the shared engine is never stopped.
 *
 * Definitions:
 * - Demand: a set of holder ids (`chat:<conversationId>`, `op:<requestId>`,
 *   `project:<projectId>`). A connected conversation holds demand whether
 *   or not a turn is active, so switching tabs never interrupts work.
 * - Idle: live (adopted or ensured) with zero demand. The idle timer arms
 *   only on the transition to zero and re-arms while an idle stop fails.
 * - Live: the binding file names the last-known address; liveness itself
 *   is in-memory and rebuilt by reconcile() at every startup.
 *
 * Startup protocol: reconcile() first, then syncDemand() unconditionally
 * (even with zero holders when the Chat Host is down, so adopted providers
 * idle-stop instead of leaking). Shutdown protocol: stop the Chat Host
 * first (settles turns, closes relays), then drain().
 */
import type {
  OwnedContainerSummary,
  ToolRuntimeMutationOutcome,
  ToolRuntimeStatus,
} from "./backend.ts";
import { loadToolRuntimeIntent } from "./intent.ts";
import { build123dHostPlan } from "./plans.ts";
import { allocateLoopbackPort } from "./ports.ts";
import type { PreparationOutcome, ToolRuntimeRecoveryCode } from "./preparation.ts";
import {
  clearToolRuntimeBinding,
  loadToolRuntimeBinding,
  loopbackHttpUrl,
  saveToolRuntimeBinding,
  type ToolRuntimeBinding,
} from "./runtime-state.ts";

/** Bounded idle delay before an undemanded provider stops. Documented; injected in tests. */
export const TOOL_RUNTIME_IDLE_DELAY_MS = 180_000;

/** Tool ids the lifecycle drains and reconciles at the app boundary. */
export const MANAGED_TOOL_IDS: readonly string[] = ["build123d"];

export interface LifecycleBackend {
  status(): Promise<ToolRuntimeStatus>;
  prepare(
    toolId: string,
    options?: { readonly hostPort?: number },
  ): Promise<PreparationOutcome>;
  stop(toolId: string): Promise<ToolRuntimeMutationOutcome>;
  listOwned(toolId: string): Promise<readonly OwnedContainerSummary[] | undefined>;
  ownedPort(toolId: string, containerId: string): Promise<number | undefined>;
  ownedImageRef(toolId: string, containerId: string): Promise<string | undefined>;
  removeOwnedContainer(
    toolId: string,
    containerId: string,
  ): Promise<ToolRuntimeMutationOutcome>;
}

export type LifecycleEnsureOutcome =
  | { readonly status: "ready"; readonly binding: ToolRuntimeBinding }
  | {
    readonly status: "needs-action";
    readonly code: string;
    readonly detail: string;
    readonly recovery: string;
  };

export type LifecycleToolState = "running" | "idle" | "stopped";

export interface LifecycleShutdownUnresolved {
  readonly toolId: string;
  readonly detail: string;
}

export interface LifecycleReconcileReport {
  readonly toolId: string;
  readonly adopted: boolean;
  readonly binding?: ToolRuntimeBinding;
  readonly stoppedDuplicates: number;
  readonly removedStale: number;
  readonly priorUnresolved: readonly LifecycleShutdownUnresolved[];
  readonly notes: readonly string[];
}

export interface LifecycleDrainReport {
  readonly at: string;
  readonly stopped: readonly string[];
  readonly unresolved: readonly LifecycleShutdownUnresolved[];
}

export interface LifecycleTimer {
  cancel(): void;
}

export interface ToolRuntimeLifecycleOptions {
  readonly backend: LifecycleBackend;
  readonly dataDirectory: string;
  readonly idleDelayMs?: number;
  readonly now?: () => string;
  readonly allocatePort?: (preferred: number) => number;
  readonly schedule?: (callback: () => void, ms: number) => LifecycleTimer;
  readonly onProviderStopped?: (toolId: string) => void;
}

const SHUTDOWN_REPORT_SCHEMA = "desktop-tool-runtime-shutdown-report/1.0" as const;
const SHUTDOWN_REPORT_FILE = "tool-runtime-shutdown-report.json";

export class ToolRuntimeLifecycle {
  readonly #backend: LifecycleBackend;
  readonly #dataDirectory: string;
  readonly #idleDelayMs: number;
  readonly #now: () => string;
  readonly #allocatePort: (preferred: number) => number;
  readonly #schedule: (callback: () => void, ms: number) => LifecycleTimer;
  readonly #onProviderStopped?: (toolId: string) => void;
  readonly #gates = new Map<string, Promise<unknown>>();
  readonly #demand = new Map<string, Set<string>>();
  readonly #live = new Set<string>();
  readonly #bindings = new Map<string, ToolRuntimeBinding>();
  readonly #timers = new Map<string, LifecycleTimer>();
  readonly #idleEpochs = new Map<string, number>();

  constructor(options: ToolRuntimeLifecycleOptions) {
    this.#backend = options.backend;
    this.#dataDirectory = options.dataDirectory;
    Deno.mkdirSync(options.dataDirectory, { recursive: true });
    this.#idleDelayMs = options.idleDelayMs ?? TOOL_RUNTIME_IDLE_DELAY_MS;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#allocatePort = options.allocatePort ??
      ((preferred) => allocateLoopbackPort({ preferred }));
    this.#schedule = options.schedule ??
      ((callback, ms) => {
        const timer = setTimeout(callback, ms);
        return { cancel: () => clearTimeout(timer) };
      });
    this.#onProviderStopped = options.onProviderStopped;
  }

  /** Read-only backend status projection source. Never mutates. */
  async status(): Promise<ToolRuntimeStatus> {
    return await this.#backend.status();
  }

  /**
   * Runs explicit preparation through ensure: a first prepare allocates a
   * loopback port, later ones adopt or restart the owned provider. Ready
   * maps to the preparation outcome; failures pass through. The binding
   * never surfaces here: only the curated detail crosses to the renderer.
   */
  async prepare(toolId: string): Promise<PreparationOutcome> {
    const ensured = await this.ensure(toolId);
    if (ensured.status === "ready") {
      return { status: "ready", detail: "Provider is prepared and ready." };
    }
    // ensure() can only fail with engine/ownership/start codes, which the
    // catalogue boundary renders as detail + recovery, never as a code.
    return {
      status: "needs-action",
      code: ensured.code as ToolRuntimeRecoveryCode,
      detail: ensured.detail,
      recovery: ensured.recovery,
    };
  }

  lifecycleState(toolId: string): LifecycleToolState {
    if (!this.#live.has(toolId)) return "stopped";
    return (this.#demand.get(toolId)?.size ?? 0) > 0 ? "running" : "idle";
  }

  demand(toolId: string): readonly string[] {
    return [...(this.#demand.get(toolId) ?? [])];
  }

  acquire(toolId: string, holder: string): void {
    let holders = this.#demand.get(toolId);
    if (holders === undefined) {
      holders = new Set();
      this.#demand.set(toolId, holders);
    }
    holders.add(holder);
    this.#disarm(toolId);
  }

  release(toolId: string, holder: string): void {
    this.#demand.get(toolId)?.delete(holder);
    if ((this.#demand.get(toolId)?.size ?? 0) === 0) this.#arm(toolId);
  }

  /** Sets the exact demand set, e.g. from a startup snapshot. Always call at startup. */
  syncDemand(toolId: string, holders: readonly string[]): void {
    this.#demand.set(toolId, new Set(holders));
    if (holders.length === 0) this.#arm(toolId);
    else this.#disarm(toolId);
  }

  /** Current runtime endpoint, or undefined when the provider is not live. */
  resolveEndpoint(
    toolId: string,
  ): { readonly mcpUrl: string; readonly healthUrl: string } | undefined {
    if (!this.#live.has(toolId)) return undefined;
    const binding = this.#bindings.get(toolId);
    if (binding === undefined) return undefined;
    return { mcpUrl: binding.mcpUrl, healthUrl: binding.healthUrl };
  }

  /**
   * Makes a provider usable: adopts a running owned container, restarts a
   * stopped one, or prepares fresh on an allocated port. Only containers
   * whose creation image matches the durable intent are adopted or
   * restarted; anything else is stopped or pruned first. Exactly one retry
   * on a port conflict; every other failure is reported, never recycled.
   */
  async ensure(toolId: string): Promise<LifecycleEnsureOutcome> {
    return await this.#exclusive(toolId, async () => {
      let intent: string | undefined;
      try {
        intent = (await loadToolRuntimeIntent(this.#toolDir(toolId), toolId))?.imageRef;
      } catch {
        return {
          status: "needs-action",
          code: "image-unverified",
          detail: "The preparation intent is corrupt.",
          recovery: "Delete the corrupt intent file explicitly to start fresh.",
        } as const;
      }
      let current = await this.#backend.listOwned(toolId);
      if (current === undefined) {
        return this.#refuse(
          "Owned containers could not be listed; refusing to act blindly.",
        );
      }
      const exact = async (id: string): Promise<boolean> =>
        intent !== undefined &&
        (await this.#backend.ownedImageRef(toolId, id)) === intent;
      let running = current.filter((entry) => entry.state === "running");
      let inexactRunning = false;
      for (const entry of running) {
        if (!(await exact(entry.id))) inexactRunning = true;
      }
      if (running.length > 1 || inexactRunning) {
        const stopped = await this.#backend.stop(toolId);
        if (stopped.status !== "done") {
          return this.#passthrough(stopped);
        }
        const relisted = await this.#backend.listOwned(toolId);
        if (relisted === undefined) {
          return this.#refuse(
            "Owned containers could not be re-listed; refusing to act blindly.",
          );
        }
        current = relisted;
        running = current.filter((entry) => entry.state === "running");
        if (running.length > 0) {
          return this.#refuse(
            "Unexpected owned providers keep running; inspect them explicitly.",
          );
        }
      }
      if (running.length === 1) {
        return await this.#adoptRunning(toolId, running[0].id);
      }
      const stopped = current.filter((entry) => entry.state !== "running");
      const exactStopped: string[] = [];
      for (const entry of stopped) {
        if (await exact(entry.id)) exactStopped.push(entry.id);
        else {
          const removed = await this.#backend.removeOwnedContainer(toolId, entry.id);
          if (removed.status !== "done") return this.#passthrough(removed);
        }
      }
      if (exactStopped.length === 1) {
        return await this.#restartStopped(toolId, exactStopped[0]);
      }
      if (exactStopped.length > 1) {
        for (const id of exactStopped) {
          const removed = await this.#backend.removeOwnedContainer(toolId, id);
          if (removed.status !== "done") return this.#passthrough(removed);
        }
      }
      return await this.#prepareFresh(toolId);
    });
  }

  /**
   * Explicit stop. Refuses while demand holds so an operator click never
   * interrupts active or shared work; volumes and images are retained.
   */
  async stop(toolId: string): Promise<ToolRuntimeMutationOutcome> {
    return await this.#exclusive(toolId, async () => {
      const holders = this.#demand.get(toolId)?.size ?? 0;
      if (holders > 0) {
        return {
          status: "needs-action",
          code: "in-use",
          detail: `${holders} chat session(s) are using this provider.`,
          recovery: "Detach it from every chat first, then stop it.",
        } as const;
      }
      const stopped = await this.#backend.stop(toolId);
      if (stopped.status !== "done") return stopped;
      this.#live.delete(toolId);
      this.#disarm(toolId);
      this.#notifyStopped(toolId);
      return stopped;
    });
  }

  /** Explicit restart: gated stop followed by ensure. */
  async restart(toolId: string): Promise<LifecycleEnsureOutcome> {
    const stopped = await this.stop(toolId);
    if (stopped.status !== "done") return this.#passthrough(stopped);
    return await this.ensure(toolId);
  }

  /**
   * Stops every known owned provider for application shutdown. Timers are
   * disarmed first; every tool is attempted even when a sibling fails; the
   * report persists for the next reconcile. Volumes and images retained.
   */
  async drain(): Promise<LifecycleDrainReport> {
    const stopped: string[] = [];
    const unresolved: LifecycleShutdownUnresolved[] = [];
    for (const toolId of MANAGED_TOOL_IDS) {
      this.#disarm(toolId);
      const outcome = await this.#exclusive(toolId, () => this.#backend.stop(toolId));
      this.#live.delete(toolId);
      if (outcome.status === "done") {
        stopped.push(toolId);
        try {
          this.#onProviderStopped?.(toolId);
        } catch (error) {
          unresolved.push({
            toolId,
            detail: `Stop notification failed: ${safeReason(error)}`,
          });
        }
      } else {
        unresolved.push({ toolId, detail: outcome.detail });
      }
    }
    const report: LifecycleDrainReport = {
      at: this.#now(),
      stopped,
      unresolved,
    };
    await this.#saveShutdownReport(report);
    return report;
  }

  /**
   * Reconciles exact owned resources after a (re)start, before any reuse.
   * Adopts at most one running provider whose creation image matches the
   * durable intent and whose loopback port inspects cleanly; stops
   * duplicates, stale generations, and addressless runners; prunes stale
   * stopped containers. Never executes provider tools. Surfaces the prior
   * shutdown report, then clears it.
   */
  async reconcile(toolId: string): Promise<LifecycleReconcileReport> {
    return await this.#exclusive(toolId, async () => {
      const notes: string[] = [];
      let removedStale = 0;
      let stoppedDuplicates = 0;
      const priorUnresolved = await this.#takeShutdownReport();
      try {
        await loadToolRuntimeBinding(this.#toolDir(toolId), toolId);
      } catch {
        await clearToolRuntimeBinding(this.#toolDir(toolId), toolId);
        notes.push("Corrupt binding discarded; the next use allocates fresh.");
      }
      let intent: Awaited<ReturnType<typeof loadToolRuntimeIntent>>;
      try {
        intent = await loadToolRuntimeIntent(this.#toolDir(toolId), toolId);
      } catch {
        const stopped = await this.#backend.stop(toolId);
        this.#live.delete(toolId);
        notes.push(
          stopped.status === "done"
            ? "Preparation intent is unreadable; owned providers stopped, re-prepare to recover."
            : `Preparation intent is unreadable; owned providers could not be stopped (${stopped.detail}).`,
        );
        return {
          toolId,
          adopted: false,
          stoppedDuplicates,
          removedStale,
          priorUnresolved,
          notes,
        };
      }
      const owned = await this.#backend.listOwned(toolId);
      if (owned === undefined) {
        this.#live.delete(toolId);
        notes.push("Owned containers could not be listed; nothing adopted.");
        return {
          toolId,
          adopted: false,
          stoppedDuplicates,
          removedStale,
          priorUnresolved,
          notes,
        };
      }
      if (intent === undefined) {
        if (owned.length > 0) {
          const stopped = await this.#backend.stop(toolId);
          notes.push(
            stopped.status === "done"
              ? "No preparation intent; owned providers stopped, next use re-prepares."
              : `No preparation intent; owned providers could not be stopped (${stopped.detail}).`,
          );
        }
        this.#live.delete(toolId);
        return {
          toolId,
          adopted: false,
          stoppedDuplicates,
          removedStale,
          priorUnresolved,
          notes,
        };
      }
      let running = owned.filter((entry) => entry.state === "running");
      let stoppedSomething = false;
      if (running.length > 1) {
        const stopped = await this.#backend.stop(toolId);
        stoppedDuplicates = running.length;
        stoppedSomething = true;
        running = [];
        notes.push(
          stopped.status === "done"
            ? `Stopped ${stoppedDuplicates} duplicate owned providers.`
            : "Duplicate owned providers could not be stopped; inspect them explicitly.",
        );
      }
      let adopted: ToolRuntimeBinding | undefined;
      if (running.length === 1) {
        const id = running[0].id;
        const imageRef = await this.#backend.ownedImageRef(toolId, id);
        if (imageRef !== intent.imageRef) {
          const stopped = await this.#backend.stop(toolId);
          stoppedSomething = true;
          notes.push(
            stopped.status === "done"
              ? "Running provider predates the durable intent; stopped, next use re-prepares."
              : `Running provider predates the durable intent and could not be stopped (${stopped.detail}).`,
          );
        } else {
          const port = await this.#backend.ownedPort(toolId, id);
          if (port === undefined) {
            const stopped = await this.#backend.stop(toolId);
            stoppedSomething = true;
            notes.push(
              stopped.status === "done"
                ? "Running provider exposes no loopback binding; stopped."
                : `Running provider exposes no loopback binding and could not be stopped (${stopped.detail}).`,
            );
          } else {
            adopted = await this.#persistBinding(toolId, port);
            this.#live.add(toolId);
            notes.push("Adopted the running owned provider at its inspected binding.");
          }
        }
      }
      const relisted = stoppedSomething
        ? (await this.#backend.listOwned(toolId) ?? [])
        : owned;
      const stopped = relisted.filter((entry) => entry.state !== "running");
      const kept: string[] = [];
      for (const entry of stopped) {
        const imageRef = await this.#backend.ownedImageRef(toolId, entry.id);
        if (imageRef !== intent.imageRef) {
          const removed = await this.#backend.removeOwnedContainer(toolId, entry.id);
          if (removed.status === "done") removedStale++;
          else {notes.push(
              `Stale owned container could not be removed; inspect it explicitly.`,
            );}
        } else {
          kept.push(entry.id);
        }
      }
      if (kept.length > 1) {
        for (const id of kept) {
          const removed = await this.#backend.removeOwnedContainer(toolId, id);
          if (removed.status === "done") removedStale++;
          else {
            notes.push(
              "Duplicate stopped providers could not be cleared; inspect them explicitly.",
            );
            break;
          }
        }
        if (removedStale > 0) {
          notes.push("Cleared duplicate stopped providers; next use prepares fresh.");
        }
      }
      if (adopted === undefined) this.#live.delete(toolId);
      return {
        toolId,
        adopted: adopted !== undefined,
        ...(adopted === undefined ? {} : { binding: adopted }),
        stoppedDuplicates,
        removedStale,
        priorUnresolved,
        notes,
      };
    });
  }

  async #adoptRunning(toolId: string, id: string): Promise<LifecycleEnsureOutcome> {
    const port = await this.#backend.ownedPort(toolId, id);
    if (port === undefined) {
      return this.#refuse(
        "The running owned provider exposes no loopback binding; inspect it explicitly.",
      );
    }
    const outcome = await this.#backend.prepare(toolId, { hostPort: port });
    if (outcome.status !== "ready") return this.#passthroughOutcome(outcome);
    const binding = await this.#persistBinding(toolId, port);
    this.#markReady(toolId);
    return { status: "ready", binding };
  }

  async #restartStopped(toolId: string, id: string): Promise<LifecycleEnsureOutcome> {
    const port = await this.#backend.ownedPort(toolId, id);
    if (port === undefined) {
      const removed = await this.#backend.removeOwnedContainer(toolId, id);
      if (removed.status !== "done") return this.#passthrough(removed);
      return await this.#prepareFresh(toolId);
    }
    const outcome = await this.#backend.prepare(toolId, { hostPort: port });
    if (outcome.status === "ready") {
      const binding = await this.#persistBinding(toolId, port);
      this.#markReady(toolId);
      return { status: "ready", binding };
    }
    if (outcome.code === "port-conflict") {
      const removed = await this.#backend.removeOwnedContainer(toolId, id);
      if (removed.status !== "done") return this.#passthrough(removed);
      return await this.#prepareFresh(toolId);
    }
    return this.#passthroughOutcome(outcome);
  }

  async #prepareFresh(toolId: string): Promise<LifecycleEnsureOutcome> {
    let preferred: number;
    try {
      preferred =
        (await loadToolRuntimeBinding(this.#toolDir(toolId), toolId))?.hostPort ??
          this.#fleetDefaultPort(toolId);
    } catch {
      await clearToolRuntimeBinding(this.#toolDir(toolId), toolId);
      preferred = this.#fleetDefaultPort(toolId);
    }
    const port = this.#allocatePort(preferred);
    const outcome = await this.#backend.prepare(toolId, { hostPort: port });
    if (outcome.status === "ready") {
      const binding = await this.#persistBinding(toolId, port);
      this.#markReady(toolId);
      return { status: "ready", binding };
    }
    if (outcome.code !== "port-conflict") return this.#passthroughOutcome(outcome);
    // Probe/use race: re-allocate (the held port probes occupied, so the
    // allocator falls through to ephemeral) and retry exactly once.
    const retryPort = this.#allocatePort(port);
    const retry = await this.#backend.prepare(toolId, { hostPort: retryPort });
    if (retry.status !== "ready") return this.#passthroughOutcome(retry);
    const binding = await this.#persistBinding(toolId, retryPort);
    this.#markReady(toolId);
    return { status: "ready", binding };
  }

  #markReady(toolId: string): void {
    this.#live.add(toolId);
    // Preparation without an attachment is idle from this successful ensure.
    // Re-arm here even if startup had already scheduled (or spent) a timer.
    if ((this.#demand.get(toolId)?.size ?? 0) === 0) this.#arm(toolId);
    else this.#disarm(toolId);
  }

  #fleetDefaultPort(toolId: string): number {
    if (toolId !== "build123d") throw new TypeError(`Unknown host tool "${toolId}".`);
    return build123dHostPlan({ workdir: this.#toolDir(toolId) }).hostPort;
  }

  async #persistBinding(toolId: string, hostPort: number): Promise<ToolRuntimeBinding> {
    const binding = {
      toolId,
      hostPort,
      mcpUrl: loopbackHttpUrl(hostPort, "/mcp"),
      healthUrl: loopbackHttpUrl(hostPort, "/health"),
      updatedAt: this.#now(),
    };
    await saveToolRuntimeBinding(this.#toolDir(toolId), binding);
    const persisted: ToolRuntimeBinding = {
      schema: "desktop-tool-runtime-binding/1.0",
      ...binding,
    };
    this.#bindings.set(toolId, persisted);
    return persisted;
  }

  #arm(toolId: string): void {
    this.#disarm(toolId);
    const epoch = this.#idleEpochs.get(toolId) ?? 0;
    this.#timers.set(
      toolId,
      this.#schedule(() => void this.#onIdleExpired(toolId, epoch), this.#idleDelayMs),
    );
  }

  #disarm(toolId: string): void {
    this.#timers.get(toolId)?.cancel();
    this.#timers.delete(toolId);
    this.#idleEpochs.set(toolId, (this.#idleEpochs.get(toolId) ?? 0) + 1);
  }

  async #onIdleExpired(toolId: string, epoch: number): Promise<void> {
    if (this.#idleEpochs.get(toolId) !== epoch) return;
    this.#timers.delete(toolId);
    await this.#exclusive(toolId, async () => {
      if (this.#idleEpochs.get(toolId) !== epoch) return;
      if ((this.#demand.get(toolId)?.size ?? 0) > 0) return;
      if (!this.#live.has(toolId)) return;
      const stopped = await this.#backend.stop(toolId);
      if (stopped.status !== "done") {
        // Engine outage, not idleness end: retry at the next delay.
        this.#arm(toolId);
        return;
      }
      this.#live.delete(toolId);
      this.#notifyStopped(toolId);
    });
  }

  #notifyStopped(toolId: string): void {
    try {
      this.#onProviderStopped?.(toolId);
    } catch {
      // Notification failures must not fail the stop itself; drain records
      // them explicitly, idle stops stay silent and truthful.
    }
  }

  async #exclusive<T>(toolId: string, work: () => Promise<T>): Promise<T> {
    const prior = this.#gates.get(toolId) ?? Promise.resolve();
    const pending = prior.catch(() => {}).then(() => work());
    const tracked: Promise<unknown> = pending.catch(() => {});
    this.#gates.set(toolId, tracked);
    try {
      return await pending;
    } finally {
      if (this.#gates.get(toolId) === tracked) this.#gates.delete(toolId);
    }
  }

  #toolDir(toolId: string): string {
    return `${this.#dataDirectory}/${toolId}`;
  }

  #refuse(detail: string): LifecycleEnsureOutcome {
    return {
      status: "needs-action",
      code: "engine-unavailable",
      detail,
      recovery: "Inspect the engine explicitly, then retry.",
    };
  }

  #passthrough(
    outcome: Extract<ToolRuntimeMutationOutcome, { status: "needs-action" }>,
  ): LifecycleEnsureOutcome {
    return {
      status: "needs-action",
      code: outcome.code,
      detail: outcome.detail,
      recovery: outcome.recovery,
    };
  }

  #passthroughOutcome(
    outcome: Extract<PreparationOutcome, { status: "needs-action" }>,
  ): LifecycleEnsureOutcome {
    return {
      status: "needs-action",
      code: outcome.code,
      detail: outcome.detail,
      recovery: outcome.recovery,
    };
  }

  async #saveShutdownReport(report: LifecycleDrainReport): Promise<void> {
    await Deno.mkdir(this.#dataDirectory, { recursive: true });
    const path = `${this.#dataDirectory}/${SHUTDOWN_REPORT_FILE}`;
    const tmp = `${path}.${crypto.randomUUID()}.tmp`;
    await Deno.writeTextFile(
      tmp,
      JSON.stringify({ schema: SHUTDOWN_REPORT_SCHEMA, ...report }, null, 2),
    );
    await Deno.rename(tmp, path);
  }

  async #takeShutdownReport(): Promise<readonly LifecycleShutdownUnresolved[]> {
    const path = `${this.#dataDirectory}/${SHUTDOWN_REPORT_FILE}`;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await Deno.readTextFile(path));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return [];
      await Deno.remove(path).catch(() => {});
      return [];
    }
    await Deno.remove(path).catch(() => {});
    if (typeof parsed !== "object" || parsed === null) return [];
    const unresolved = (parsed as { unresolved?: unknown }).unresolved;
    if (!Array.isArray(unresolved)) return [];
    return unresolved.filter((entry): entry is LifecycleShutdownUnresolved =>
      typeof entry === "object" && entry !== null &&
      typeof (entry as { toolId?: unknown }).toolId === "string" &&
      typeof (entry as { detail?: unknown }).detail === "string"
    );
  }
}

function safeReason(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}
