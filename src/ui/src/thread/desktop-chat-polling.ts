export interface DesktopChatPollingOptions {
  readonly refresh: () => Promise<void>;
  readonly intervalMs: () => number;
  readonly setTimer?: (
    callback: () => void,
    milliseconds: number,
  ) => DesktopChatTimer;
  readonly clearTimer?: (timer: DesktopChatTimer) => void;
}

export type DesktopChatTimer =
  | number
  | ReturnType<typeof globalThis.setTimeout>;

/**
 * Runs one refresh at a time and schedules the next only after it settles.
 * Snapshot object identity must never drive polling cadence.
 */
export function startDesktopChatPolling(
  options: DesktopChatPollingOptions,
): () => void {
  const setTimer = options.setTimer ??
    ((callback, milliseconds) => globalThis.setTimeout(callback, milliseconds));
  const clearTimer = options.clearTimer ??
    ((handle) =>
      globalThis.clearTimeout(
        handle as ReturnType<typeof globalThis.setTimeout>,
      ));
  let stopped = false;
  let timer: DesktopChatTimer | undefined;

  const poll = async (): Promise<void> => {
    try {
      await options.refresh();
    } catch {
      // The renderer refresh maps its own bounded error state. Keep polling so
      // a transient native binding failure can recover.
    }
    if (stopped) return;
    timer = setTimer(() => void poll(), options.intervalMs());
  };

  void poll();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimer(timer);
  };
}
