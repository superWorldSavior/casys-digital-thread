import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import {
  type DesktopShutdownSignal,
  drainAndExitDesktop,
  drainDesktopForWindowClose,
  installDesktopShutdownSignals,
  installDesktopWindowClose,
} from "./shutdown.ts";

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  if (resolve === undefined) throw new Error("deferred resolver was not installed");
  return { promise, resolve };
}

Deno.test("process exit waits for both application and server drains", async () => {
  const application = deferred();
  const server = deferred();
  const events: string[] = [];
  const shutdown = drainAndExitDesktop({
    stopApplication: async () => {
      events.push("application-started");
      await application.promise;
      events.push("application-stopped");
    },
    shutdownServer: async () => {
      events.push("server-started");
      await server.promise;
      events.push("server-stopped");
    },
    exitProcess(code) {
      events.push(`process-exited-${code}`);
    },
  });

  await Promise.resolve();
  assertEquals(events, ["application-started", "server-started"]);

  server.resolve();
  await Promise.resolve();
  assertEquals(events, [
    "application-started",
    "server-started",
    "server-stopped",
  ]);

  application.resolve();
  await shutdown;
  assertEquals(events, [
    "application-started",
    "server-started",
    "server-stopped",
    "application-stopped",
    "process-exited-0",
  ]);
});

Deno.test("process exit is withheld when owned termination is unresolved", async () => {
  const events: string[] = [];
  await assertRejects(
    () =>
      drainAndExitDesktop({
        stopApplication: () => {
          events.push("application-unresolved");
          return Promise.reject(new Error("missing terminal status"));
        },
        shutdownServer: () => {
          events.push("server-stopped");
          return Promise.resolve();
        },
        exitProcess() {
          events.push("process-exited");
        },
      }),
    AggregateError,
    "process exit is withheld",
  );
  assertEquals(events, ["application-unresolved", "server-stopped"]);
});

Deno.test("shutdown signals keep swallowing repeats until explicit cleanup", () => {
  const listeners = new Map<DesktopShutdownSignal, () => void>();
  const removed: DesktopShutdownSignal[] = [];
  let shutdowns = 0;
  const cleanup = installDesktopShutdownSignals(() => {
    shutdowns += 1;
  }, {
    add(signal, listener) {
      listeners.set(signal, listener);
    },
    remove(signal, listener) {
      if (listeners.get(signal) === listener) listeners.delete(signal);
      removed.push(signal);
    },
  });

  const interrupt = listeners.get("SIGINT");
  const terminate = listeners.get("SIGTERM");
  if (interrupt === undefined || terminate === undefined) {
    throw new Error("expected both shutdown listeners");
  }
  interrupt();
  assertEquals([...listeners.keys()].sort(), ["SIGINT", "SIGTERM"]);
  listeners.get("SIGTERM")?.();
  assertEquals(shutdowns, 1);
  assertEquals([...listeners.keys()].sort(), ["SIGINT", "SIGTERM"]);

  cleanup();
  cleanup();

  assertEquals(shutdowns, 1);
  assertEquals([...listeners.keys()], []);
  assertEquals(removed.sort(), ["SIGINT", "SIGTERM"]);
});

Deno.test("an unsupported signal does not prevent the supported listener", () => {
  let interrupt: (() => void) | undefined;
  let shutdowns = 0;
  const cleanup = installDesktopShutdownSignals(() => {
    shutdowns += 1;
  }, {
    add(signal, listener) {
      if (signal === "SIGTERM") throw new Error("unsupported");
      interrupt = listener;
    },
    remove() {},
  });

  if (interrupt === undefined) throw new Error("SIGINT listener not installed");
  interrupt();
  cleanup();
  assertEquals(shutdowns, 1);
});

Deno.test("native close dispatches one shutdown request", () => {
  let listener: (() => void) | undefined;
  let requests = 0;
  const window = {
    addEventListener(
      _type: "close",
      next: () => void,
    ) {
      listener = next;
    },
    removeEventListener() {
      listener = undefined;
    },
  };
  const controller = installDesktopWindowClose(window, () => requests++);

  listener?.();
  listener?.();
  assertEquals(requests, 1);
  controller.cleanup();
  assertEquals(listener, undefined);
});

Deno.test("window drain keeps the server live after unresolved stop then terminates", async () => {
  let stopAttempts = 0;
  let serverStops = 0;
  const ports = {
    stopApplication() {
      stopAttempts += 1;
      return stopAttempts === 1
        ? Promise.reject(new Error("Chat Host unresolved"))
        : Promise.resolve();
    },
    shutdownServer() {
      serverStops += 1;
      return Promise.resolve();
    },
  };

  assertEquals(await drainDesktopForWindowClose(ports), {
    status: "unresolved",
    stage: "application",
  });
  assertEquals({ stopAttempts, serverStops }, { stopAttempts: 1, serverStops: 0 });
  assertEquals(await drainDesktopForWindowClose(ports), { status: "drained" });
  assertEquals({ stopAttempts, serverStops }, { stopAttempts: 2, serverStops: 1 });
});

Deno.test("window drain bounds a never-settling resource without closing the server", async () => {
  let serverStops = 0;
  assertEquals(
    await drainDesktopForWindowClose({
      stopApplication: () => new Promise(() => undefined),
      shutdownServer() {
        serverStops += 1;
        return Promise.resolve();
      },
    }, 5),
    { status: "unresolved", stage: "application" },
  );
  assertEquals(serverStops, 0);
});
