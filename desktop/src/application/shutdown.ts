export type DesktopShutdownSignal = "SIGINT" | "SIGTERM";

export interface DesktopSignalPorts {
  readonly add: (
    signal: DesktopShutdownSignal,
    listener: () => void,
  ) => void;
  readonly remove: (
    signal: DesktopShutdownSignal,
    listener: () => void,
  ) => void;
}

export interface DesktopDrainPorts {
  /** Resolves only after the owned in-memory child, if any, has exited. */
  readonly stopApplication: () => Promise<void>;
  /** Resolves only after the renderer HTTP listener has drained. */
  readonly shutdownServer: () => Promise<void>;
  /** Terminates the Deno Desktop process after both owned drains settle. */
  readonly exitProcess: (code: number) => void;
}

export interface DesktopWindowClosePort {
  addEventListener(
    type: "close",
    listener: () => void,
  ): void;
  removeEventListener(
    type: "close",
    listener: () => void,
  ): void;
}

export interface DesktopWindowCloseController {
  cleanup(): void;
}

/**
 * Converts the one-way native close notification into one shutdown request.
 *
 * Deno Desktop 2.9.6 removes the native window before dispatching this event;
 * the JavaScript event is not cancelable and cannot be acknowledged or retried.
 * Resource draining therefore happens after the window has closed, and the
 * process owner must terminate explicitly once that bounded attempt settles.
 */
export function installDesktopWindowClose(
  window: DesktopWindowClosePort,
  onShutdown: () => void,
): DesktopWindowCloseController {
  let requested = false;
  let cleaned = false;
  const listener = () => {
    if (requested) return;
    requested = true;
    onShutdown();
  };
  window.addEventListener("close", listener);
  return Object.freeze({
    cleanup(): void {
      if (cleaned) return;
      cleaned = true;
      window.removeEventListener("close", listener);
    },
  });
}

export interface DesktopWindowDrainPorts {
  /** Stops Chat Host and Workbench/application resources as one bounded attempt. */
  readonly stopApplication: () => Promise<void>;
  readonly shutdownServer: () => Promise<void>;
}

export type DesktopWindowDrainResult =
  | { readonly status: "drained" }
  | {
    readonly status: "unresolved";
    readonly stage: "application" | "server";
  };

/** The server is closed only after every owned application resource stopped. */
export async function drainDesktopForWindowClose(
  ports: DesktopWindowDrainPorts,
  timeoutMs = 12_000,
): Promise<DesktopWindowDrainResult> {
  try {
    await within(ports.stopApplication(), timeoutMs, "Desktop application drain");
  } catch {
    return { status: "unresolved", stage: "application" };
  }
  try {
    await within(ports.shutdownServer(), timeoutMs, "Desktop server drain");
    return { status: "drained" };
  } catch {
    return { status: "unresolved", stage: "server" };
  }
}

async function within<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Drains every process-owned resource before terminating the Desktop process.
 * Both drains are attempted, but explicit process exit is forbidden until each
 * drain has resolved successfully.
 */
export async function drainAndExitDesktop(
  ports: DesktopDrainPorts,
): Promise<void> {
  const results = await Promise.allSettled([
    ports.stopApplication(),
    ports.shutdownServer(),
  ]);
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "Desktop shutdown remains unresolved; process exit is withheld.",
    );
  }
  ports.exitProcess(0);
}

/** Installs one idempotent shutdown edge and returns an idempotent cleanup. */
export function installDesktopShutdownSignals(
  onShutdown: () => void,
  ports: DesktopSignalPorts,
): () => void {
  const removers: Array<() => void> = [];
  let requested = false;
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    for (const remove of removers) remove();
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const listener = () => {
      if (requested) return;
      requested = true;
      onShutdown();
    };
    try {
      ports.add(signal, listener);
      removers.push(() => {
        try {
          ports.remove(signal, listener);
        } catch {
          // Already removed or unsupported by this platform.
        }
      });
    } catch {
      // The current platform does not expose this signal.
    }
  }

  return cleanup;
}
