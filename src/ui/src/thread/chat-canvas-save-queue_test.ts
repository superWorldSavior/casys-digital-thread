import { assertEquals } from "@std/assert";
import type { ChatCanvasLayoutDto } from "../../../presentation/desktop/chat/contracts.ts";
import { ChatCanvasSaveQueue } from "./chat-canvas-save-queue.ts";

function layout(text: string): ChatCanvasLayoutDto {
  return {
    version: 1,
    groups: [],
    nodes: [{ id: "note:1", kind: "note", x: 24, y: 24, z: 1, text }],
  };
}

function gate(): {
  readonly promise: Promise<void>;
  readonly release: () => void;
} {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

Deno.test("Canvas exit flushes a pending edit before its debounce deadline", async () => {
  const sent: ChatCanvasLayoutDto[] = [];
  const queue = new ChatCanvasSaveQueue(
    (next) => {
      sent.push(next);
      return Promise.resolve();
    },
    () => {},
    60_000,
  );
  const edited = layout("Remember this");
  queue.schedule(edited);
  assertEquals(queue.hasPending, true);
  assertEquals(await queue.flush(), true);
  assertEquals(sent, [edited]);
  assertEquals(queue.hasPending, false);
});

Deno.test("Canvas writes stay ordered when a newer edit arrives during an in-flight save", async () => {
  const first = gate();
  const sent: string[] = [];
  const queue = new ChatCanvasSaveQueue(
    async (next) => {
      sent.push(next.nodes[0]?.text ?? "");
      if (sent.length === 1) await first.promise;
    },
    () => {},
    60_000,
  );
  queue.schedule(layout("first"));
  const savingFirst = queue.flush();
  queue.schedule(layout("second"));
  const savingLatest = queue.flush();
  assertEquals(sent, ["first"]);
  first.release();
  assertEquals(await savingFirst, true);
  assertEquals(await savingLatest, true);
  assertEquals(sent, ["first", "second"]);
  assertEquals(queue.hasPending, false);
});

Deno.test("Canvas retains a failed layout for explicit retry", async () => {
  const errors: string[] = [];
  const visibleErrors: (string | undefined)[] = [];
  const sent: string[] = [];
  let fail = true;
  const queue = new ChatCanvasSaveQueue(
    (next) => {
      if (fail) return Promise.reject(new Error("disk unavailable"));
      sent.push(next.nodes[0]?.text ?? "");
      return Promise.resolve();
    },
    (message) => errors.push(message),
    60_000,
  );
  const unsubscribe = queue.subscribe((message) => visibleErrors.push(message));
  queue.schedule(layout("keep me"));
  assertEquals(await queue.flush(), false);
  assertEquals(queue.hasPending, true);
  assertEquals(queue.layout?.nodes[0]?.text, "keep me");
  assertEquals(queue.error, "disk unavailable");
  assertEquals(errors, ["disk unavailable"]);
  assertEquals(visibleErrors.at(-1), "disk unavailable");
  fail = false;
  assertEquals(await queue.flush(), true);
  assertEquals(sent, ["keep me"]);
  assertEquals(queue.hasPending, false);
  assertEquals(queue.error, undefined);
  assertEquals(visibleErrors.at(-1), undefined);
  unsubscribe();
});
