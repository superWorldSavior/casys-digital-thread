import { assertEquals } from "@std/assert";
import { startDesktopChatPolling } from "./src/thread/desktop-chat-polling.ts";

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((done) => resolve = done);
  if (resolve === undefined) throw new Error("missing resolver");
  return { promise, resolve };
}

Deno.test("Desktop Chat polling waits for refresh before scheduling the next one", async () => {
  const first = deferred();
  const timers: Array<{ callback: () => void; milliseconds: number }> = [];
  let refreshes = 0;
  const stop = startDesktopChatPolling({
    refresh: () => {
      refreshes += 1;
      return refreshes === 1 ? first.promise : Promise.resolve();
    },
    intervalMs: () => 250,
    setTimer(callback, milliseconds) {
      timers.push({ callback, milliseconds });
      return timers.length;
    },
    clearTimer() {},
  });

  await Promise.resolve();
  assertEquals({ refreshes, timers: timers.length }, {
    refreshes: 1,
    timers: 0,
  });

  first.resolve();
  await first.promise;
  await Promise.resolve();
  assertEquals(timers.map((timer) => timer.milliseconds), [250]);

  timers.shift()?.callback();
  await Promise.resolve();
  assertEquals(refreshes, 2);
  stop();
});

Deno.test("Desktop Chat polling cancellation suppresses a late timer", async () => {
  const pending = deferred();
  const timers: Array<() => void> = [];
  const stop = startDesktopChatPolling({
    refresh: () => pending.promise,
    intervalMs: () => 1_000,
    setTimer(callback) {
      timers.push(callback);
      return timers.length;
    },
    clearTimer() {},
  });

  stop();
  pending.resolve();
  await pending.promise;
  await Promise.resolve();
  assertEquals(timers, []);
});
