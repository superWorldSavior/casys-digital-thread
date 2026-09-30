import { assertEquals } from "jsr:@std/assert@1.0.14";
import type {
  OwnedContainerSummary,
  ToolRuntimeMutationOutcome,
  ToolRuntimeStatus,
} from "./backend.ts";
import { newToolRuntimeIntent, saveToolRuntimeIntent } from "./intent.ts";
import { type LifecycleBackend, ToolRuntimeLifecycle } from "./lifecycle.ts";
import type { PreparationOutcome } from "./preparation.ts";
import { loadToolRuntimeBinding } from "./runtime-state.ts";

const INTENT_REF = "ghcr.io/casys-ai/mcp-build123d@sha256:" + "a".repeat(64);
const STALE_REF = "ghcr.io/casys-ai/mcp-build123d@sha256:" + "b".repeat(64);
const NOW = "2026-09-28T00:00:00.000Z";

interface FakeContainer {
  id: string;
  state: "running" | "exited";
  port?: number;
  imageRef: string;
}

const DONE: ToolRuntimeMutationOutcome = { status: "done", detail: "stopped" };
const READY: PreparationOutcome = { status: "ready", detail: "ready" };

class FakeBackend implements LifecycleBackend {
  containers: FakeContainer[] = [];
  prepareCalls: (number | undefined)[] = [];
  prepareScript: PreparationOutcome[] = [];
  stopCalls = 0;
  stopResult: ToolRuntimeMutationOutcome = DONE;
  blind = false;
  #nextId = 0;

  status(): Promise<ToolRuntimeStatus> {
    throw new Error("not implemented");
  }

  prepare(
    _toolId: string,
    options?: { readonly hostPort?: number },
  ): Promise<PreparationOutcome> {
    this.prepareCalls.push(options?.hostPort);
    const outcome = this.prepareScript.shift() ?? READY;
    if (outcome.status === "ready") {
      const port = options?.hostPort ?? 3014;
      if (this.containers.some((entry) => entry.state === "running")) {
        return Promise.resolve(outcome);
      }
      const existing = this.containers.find((entry) => entry.state === "exited");
      if (existing !== undefined) {
        existing.state = "running";
        existing.port = port;
        existing.imageRef = INTENT_REF;
      } else {
        this.containers.push({
          id: `c${this.#nextId++}`,
          state: "running",
          port,
          imageRef: INTENT_REF,
        });
      }
    }
    return Promise.resolve(outcome);
  }

  stop(_toolId: string): Promise<ToolRuntimeMutationOutcome> {
    this.stopCalls++;
    if (this.stopResult.status === "done") {
      for (const entry of this.containers) entry.state = "exited";
    }
    return Promise.resolve(this.stopResult);
  }

  listOwned(_toolId: string): Promise<readonly OwnedContainerSummary[] | undefined> {
    if (this.blind) return Promise.resolve(undefined);
    return Promise.resolve(
      this.containers.map((entry) => ({ id: entry.id, state: entry.state })),
    );
  }

  ownedPort(_toolId: string, containerId: string): Promise<number | undefined> {
    return Promise.resolve(
      this.containers.find((entry) => entry.id === containerId)?.port,
    );
  }

  ownedImageRef(_toolId: string, containerId: string): Promise<string | undefined> {
    return Promise.resolve(
      this.containers.find((entry) => entry.id === containerId)?.imageRef,
    );
  }

  removeOwnedContainer(
    _toolId: string,
    containerId: string,
  ): Promise<ToolRuntimeMutationOutcome> {
    this.containers = this.containers.filter((entry) => entry.id !== containerId);
    return Promise.resolve(DONE);
  }
}

function manualTimers() {
  const pending: (() => void)[] = [];
  return {
    pending,
    schedule: (callback: () => void, _ms: number) => {
      const fire = () => {
        const at = pending.indexOf(fire);
        if (at >= 0) pending.splice(at, 1);
        callback();
      };
      pending.push(fire);
      return {
        cancel: () => {
          const at = pending.indexOf(fire);
          if (at >= 0) pending.splice(at, 1);
        },
      };
    },
  };
}

interface Harness {
  lifecycle: ToolRuntimeLifecycle;
  backend: FakeBackend;
  timers: ReturnType<typeof manualTimers>;
  allocated: number[];
  stopped: string[];
  directory: string;
}

async function harness(): Promise<Harness> {
  const directory = await Deno.makeTempDir({ prefix: "lifecycle-" });
  const backend = new FakeBackend();
  const timers = manualTimers();
  const allocated: number[] = [];
  const stopped: string[] = [];
  const lifecycle = new ToolRuntimeLifecycle({
    backend,
    dataDirectory: directory,
    idleDelayMs: 1_000,
    now: () => NOW,
    allocatePort: (preferred) => {
      allocated.push(preferred);
      return preferred === 3014 ? 45678 : preferred;
    },
    schedule: timers.schedule,
    onProviderStopped: (toolId) => stopped.push(toolId),
  });
  return { lifecycle, backend, timers, allocated, stopped, directory };
}

async function writeIntent(directory: string): Promise<void> {
  await saveToolRuntimeIntent(
    `${directory}/build123d`,
    newToolRuntimeIntent({
      toolId: "build123d",
      imageRef: INTENT_REF,
      platform: "linux/arm64",
      now: NOW,
    }),
  );
}

async function bindingPort(directory: string): Promise<number | undefined> {
  return (await loadToolRuntimeBinding(`${directory}/build123d`, "build123d"))
    ?.hostPort;
}

Deno.test("ensure prepares fresh on an allocated port and goes idle without demand", async () => {
  const { lifecycle, backend, timers, directory } = await harness();
  try {
    const outcome = await lifecycle.ensure("build123d");
    assertEquals(outcome.status, "ready");
    assertEquals(backend.prepareCalls, [45678]);
    assertEquals(await bindingPort(directory), 45678);
    assertEquals(lifecycle.lifecycleState("build123d"), "idle");
    assertEquals(timers.pending.length, 1);
    assertEquals(await lifecycle.resolveEndpoint("build123d"), {
      mcpUrl: "http://127.0.0.1:45678/mcp",
      healthUrl: "http://127.0.0.1:45678/health",
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("prepare resets an elapsed startup idle timer and stops after its own delay", async () => {
  const { lifecycle, backend, timers, directory } = await harness();
  try {
    lifecycle.syncDemand("build123d", []);
    const startupTimer = timers.pending[0];
    startupTimer();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assertEquals(timers.pending.length, 0);

    assertEquals((await lifecycle.prepare("build123d")).status, "ready");
    assertEquals(lifecycle.lifecycleState("build123d"), "idle");
    assertEquals(timers.pending.length, 1);
    assertEquals(backend.stopCalls, 0);

    timers.pending[0]();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assertEquals(backend.stopCalls, 1);
    assertEquals(lifecycle.lifecycleState("build123d"), "stopped");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("a queued startup timer cannot stop a newly prepared provider", async () => {
  const { lifecycle, backend, timers, directory } = await harness();
  const entered = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const prepare = backend.prepare.bind(backend);
  backend.prepare = async (toolId, options) => {
    entered.resolve();
    await resume.promise;
    return await prepare(toolId, options);
  };
  try {
    lifecycle.syncDemand("build123d", []);
    const startupTimer = timers.pending[0];
    const preparing = lifecycle.prepare("build123d");
    await entered.promise;
    startupTimer(); // Its stop queues behind the in-progress preparation.
    resume.resolve();
    assertEquals((await preparing).status, "ready");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assertEquals(backend.stopCalls, 0);
    assertEquals(lifecycle.lifecycleState("build123d"), "idle");
    assertEquals(timers.pending.length, 1);
  } finally {
    resume.resolve();
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("ensure adopts a running owned provider without allocating", async () => {
  const { lifecycle, backend, allocated, directory } = await harness();
  await writeIntent(directory);
  backend.containers.push({
    id: "c0",
    state: "running",
    port: 49999,
    imageRef: INTENT_REF,
  });
  try {
    const outcome = await lifecycle.ensure("build123d");
    assertEquals(outcome.status, "ready");
    assertEquals(allocated, [], "allocator ran for an adopted provider");
    assertEquals(backend.prepareCalls, [49999]);
    assertEquals(await bindingPort(directory), 49999);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("ensure restarts a stopped owned provider and retries a squatted port", async () => {
  const { lifecycle, backend, directory } = await harness();
  await writeIntent(directory);
  backend.containers.push({
    id: "c0",
    state: "exited",
    port: 3014,
    imageRef: INTENT_REF,
  });
  backend.prepareScript.push({
    status: "needs-action",
    code: "port-conflict",
    detail: "occupied",
    recovery: "retry",
  });
  try {
    const outcome = await lifecycle.ensure("build123d");
    assertEquals(outcome.status, "ready");
    assertEquals(backend.containers.length, 1);
    assertEquals(backend.containers[0].state, "running");
    assertEquals(backend.prepareCalls[0], 3014);
    assertEquals(backend.prepareCalls.length, 2);
    assertEquals(await bindingPort(directory), backend.prepareCalls[1]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("ensure replaces providers whose image predates the intent", async () => {
  const { lifecycle, backend, directory } = await harness();
  await writeIntent(directory);
  backend.containers.push({
    id: "c0",
    state: "running",
    port: 3014,
    imageRef: STALE_REF,
  });
  try {
    const outcome = await lifecycle.ensure("build123d");
    assertEquals(outcome.status, "ready");
    assertEquals(backend.stopCalls, 1);
    assertEquals(backend.containers.length, 1);
    assertEquals(backend.containers[0].imageRef, INTENT_REF);
    assertEquals(backend.containers[0].state, "running");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("ensure refuses to act blind", async () => {
  const { lifecycle, backend, directory } = await harness();
  backend.blind = true;
  try {
    const outcome = await lifecycle.ensure("build123d");
    assertEquals(outcome.status, "needs-action");
    assertEquals(backend.prepareCalls, []);
    assertEquals(lifecycle.lifecycleState("build123d"), "stopped");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("demand across chats shares one provider; last release idles then stops", async () => {
  const { lifecycle, backend, timers, stopped, directory } = await harness();
  try {
    assertEquals((await lifecycle.ensure("build123d")).status, "ready");
    lifecycle.acquire("build123d", "chat:a");
    lifecycle.acquire("build123d", "chat:b");
    assertEquals(lifecycle.lifecycleState("build123d"), "running");
    lifecycle.release("build123d", "chat:a");
    assertEquals(lifecycle.lifecycleState("build123d"), "running");
    assertEquals(timers.pending.length, 0);
    lifecycle.release("build123d", "chat:b");
    assertEquals(lifecycle.lifecycleState("build123d"), "idle");
    assertEquals(timers.pending.length, 1);
    assertEquals(backend.stopCalls, 0);
    timers.pending[0]();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assertEquals(backend.stopCalls, 1);
    assertEquals(stopped, ["build123d"]);
    assertEquals(lifecycle.lifecycleState("build123d"), "stopped");
    assertEquals(await lifecycle.resolveEndpoint("build123d"), undefined);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("demand during the idle window disarms the stop", async () => {
  const { lifecycle, backend, timers, directory } = await harness();
  try {
    assertEquals((await lifecycle.ensure("build123d")).status, "ready");
    lifecycle.acquire("build123d", "chat:a");
    lifecycle.release("build123d", "chat:a");
    assertEquals(timers.pending.length, 1);
    const armed = timers.pending[0];
    lifecycle.acquire("build123d", "op:viewer-1");
    assertEquals(timers.pending.length, 0);
    armed();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assertEquals(backend.stopCalls, 0);
    assertEquals(lifecycle.lifecycleState("build123d"), "running");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("failed idle stop re-arms instead of dropping liveness", async () => {
  const { lifecycle, backend, timers, directory } = await harness();
  backend.stopResult = {
    status: "needs-action",
    code: "engine-unavailable",
    detail: "down",
    recovery: "retry",
  };
  try {
    assertEquals((await lifecycle.ensure("build123d")).status, "ready");
    lifecycle.syncDemand("build123d", []);
    assertEquals(timers.pending.length, 1);
    timers.pending[0]();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assertEquals(lifecycle.lifecycleState("build123d"), "idle");
    assertEquals(timers.pending.length, 1, "idle stop was not retried");
    backend.stopResult = DONE;
    timers.pending[0]();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assertEquals(lifecycle.lifecycleState("build123d"), "stopped");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("explicit stop refuses in-use providers and stops idle ones", async () => {
  const { lifecycle, backend, stopped, directory } = await harness();
  try {
    assertEquals((await lifecycle.ensure("build123d")).status, "ready");
    lifecycle.acquire("build123d", "chat:a");
    const refused = await lifecycle.stop("build123d");
    assertEquals(refused.status, "needs-action");
    assertEquals((refused as { code: string }).code, "in-use");
    assertEquals(backend.stopCalls, 0);
    lifecycle.release("build123d", "chat:a");
    const stoppedOutcome = await lifecycle.stop("build123d");
    assertEquals(stoppedOutcome.status, "done");
    assertEquals(stopped, ["build123d"]);
    assertEquals(lifecycle.lifecycleState("build123d"), "stopped");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("drain stops providers and persists the report for reconcile", async () => {
  const { lifecycle, backend, directory } = await harness();
  try {
    assertEquals((await lifecycle.ensure("build123d")).status, "ready");
    lifecycle.acquire("build123d", "chat:a");
    const report = await lifecycle.drain();
    assertEquals(report.stopped, ["build123d"]);
    assertEquals(report.unresolved, []);
    assertEquals(backend.stopCalls, 1);
    assertEquals(lifecycle.lifecycleState("build123d"), "stopped");
    const reconciled = await lifecycle.reconcile("build123d");
    assertEquals(reconciled.priorUnresolved, []);
    const reportPath = `${directory}/tool-runtime-shutdown-report.json`;
    let exists = true;
    try {
      await Deno.stat(reportPath);
    } catch {
      exists = false;
    }
    assertEquals(exists, false, "shutdown report was not consumed");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("drain records unresolved stops honestly", async () => {
  const { lifecycle, backend, directory } = await harness();
  backend.stopResult = {
    status: "needs-action",
    code: "engine-unavailable",
    detail: "daemon gone",
    recovery: "retry",
  };
  try {
    const report = await lifecycle.drain();
    assertEquals(report.stopped, []);
    assertEquals(report.unresolved, [{ toolId: "build123d", detail: "daemon gone" }]);
    const reconciled = await lifecycle.reconcile("build123d");
    assertEquals(reconciled.priorUnresolved, [{
      toolId: "build123d",
      detail: "daemon gone",
    }]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("explicit prepare allocates on first use and adopts later", async () => {
  const { lifecycle, backend, directory } = await harness();
  try {
    const first = await lifecycle.prepare("build123d");
    assertEquals(first.status, "ready");
    assertEquals(backend.prepareCalls, [45678]);
    const second = await lifecycle.prepare("build123d");
    assertEquals(second.status, "ready");
    assertEquals(backend.containers.length, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("reconcile adopts the exact running provider", async () => {
  const { lifecycle, backend, directory } = await harness();
  await writeIntent(directory);
  backend.containers.push({
    id: "c0",
    state: "running",
    port: 48888,
    imageRef: INTENT_REF,
  });
  try {
    const report = await lifecycle.reconcile("build123d");
    assertEquals(report.adopted, true);
    assertEquals(report.binding?.hostPort, 48888);
    assertEquals(backend.stopCalls, 0);
    assertEquals(await lifecycle.resolveEndpoint("build123d"), {
      mcpUrl: "http://127.0.0.1:48888/mcp",
      healthUrl: "http://127.0.0.1:48888/health",
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("reconcile stops stale generations and prunes stale stopped containers", async () => {
  const { lifecycle, backend, directory } = await harness();
  await writeIntent(directory);
  backend.containers.push(
    { id: "c0", state: "running", port: 3014, imageRef: STALE_REF },
    { id: "c1", state: "exited", port: 3015, imageRef: STALE_REF },
  );
  try {
    const report = await lifecycle.reconcile("build123d");
    assertEquals(report.adopted, false);
    assertEquals(backend.stopCalls, 1);
    assertEquals(backend.containers.find((entry) => entry.id === "c1"), undefined);
    assertEquals(report.removedStale >= 1, true);
    assertEquals(lifecycle.lifecycleState("build123d"), "stopped");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("lifecycle creates its data directory", async () => {
  const parent = await Deno.makeTempDir({ prefix: "lifecycle-mkdir-" });
  try {
    const directory = `${parent}/nested/tool-runtime`;
    new ToolRuntimeLifecycle({ backend: new FakeBackend(), dataDirectory: directory });
    const stat = await Deno.stat(directory);
    assertEquals(stat.isDirectory, true);
  } finally {
    await Deno.remove(parent, { recursive: true });
  }
});

Deno.test("reconcile reports an unstoppable stale provider honestly", async () => {
  const { lifecycle, backend, directory } = await harness();
  await writeIntent(directory);
  backend.containers.push({
    id: "c0",
    state: "running",
    port: 3014,
    imageRef: STALE_REF,
  });
  backend.stopResult = {
    status: "needs-action",
    code: "engine-unavailable",
    detail: "daemon unreachable",
    recovery: "retry",
  };
  try {
    const report = await lifecycle.reconcile("build123d");
    assertEquals(report.adopted, false);
    assertEquals(
      report.notes.some((note) => note.includes("could not be stopped")),
      true,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("concurrent ensures share one provider", async () => {
  const { lifecycle, backend, directory } = await harness();
  await writeIntent(directory);
  try {
    const [first, second] = await Promise.all([
      lifecycle.ensure("build123d"),
      lifecycle.ensure("build123d"),
    ]);
    assertEquals(first.status, "ready");
    assertEquals(second.status, "ready");
    assertEquals(backend.containers.length, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
