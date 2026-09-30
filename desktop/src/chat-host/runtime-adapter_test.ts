import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "jsr:@std/assert@1.0.14";
import type {
  ChatRuntimePort,
  RuntimeEvent,
  RuntimeHandle,
  RuntimeTurn,
} from "../chat/runtime-port.ts";
import type { McpObservedCall, McpRelayScope } from "./mcp-relay.ts";
import {
  type AcpxRuntimeModule,
  createPinnedRuntimeAdapterWithModule,
  type PinnedRuntimeOptions,
} from "./runtime-adapter.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => resolve = done);
  return { promise, resolve };
}

interface FakeScope extends McpRelayScope {
  readonly closed: boolean;
  emit(call: McpObservedCall): void;
}

function harness(
  capture = true,
  nativeBurst = 0,
  prePromptFailure = false,
  startThrow = false,
  closeGate?: Promise<void>,
  ensureError?: Error,
  agentName = "muse",
) {
  const scopes: FakeScope[] = [];
  const created: Array<{ options: Record<string, unknown>; port: ChatRuntimePort }> =
    [];
  const turns: Array<{
    finish(): void;
    readonly handle: RuntimeHandle;
  }> = [];
  const stores: string[] = [];
  let promptStartedReads = 0;
  let closedSessions = 0;
  let nativeYielded = 0;
  let startCalls = 0;
  const module: AcpxRuntimeModule = {
    createFileSessionStore: ({ stateDir }) => {
      stores.push(stateDir);
      return { stateDir };
    },
    createAgentRegistry: ({ overrides }) => ({ overrides }),
    createAcpRuntime: (options) => {
      const port: ChatRuntimePort = {
        ensureSession: ({ sessionKey }) =>
          ensureError === undefined
            ? Promise.resolve({
              sessionKey,
              backend: "fake",
              runtimeSessionName: sessionKey,
            })
            : Promise.reject(ensureError),
        startTurn({ handle }): RuntimeTurn {
          startCalls++;
          if (startThrow && startCalls === 1) {
            throw new Error("native startTurn failed");
          }
          if (prePromptFailure && startCalls === 1) {
            return {
              events: {
                async *[Symbol.asyncIterator]() {},
              },
              result: Promise.reject(new Error("preprompt result failed")),
              get promptStarted() {
                promptStartedReads++;
                return Promise.reject(new Error("preprompt submission failed"));
              },
              cancel: () => Promise.resolve(),
              closeStream: () => Promise.resolve(),
            };
          }
          const finished = deferred<{ status: "completed" }>();
          turns.push({
            handle,
            finish: () => finished.resolve({ status: "completed" }),
          });
          const nativeEvents: AsyncIterable<RuntimeEvent> = {
            async *[Symbol.asyncIterator]() {
              nativeYielded++;
              yield {
                type: "tool_call",
                text: "MCP card",
                title: "mcp__build123d__build123d_export",
                toolCallId: "native-card",
                status: "completed",
                rawInput: { script: "same" },
                rawOutput: JSON.stringify({ _meta: { ui: { resourceUri: "ui://x" } } }),
              };
              for (let index = 0; index < nativeBurst; index++) {
                nativeYielded++;
                yield { type: "status", text: `native ${index}` };
              }
            },
          };
          return {
            events: nativeEvents,
            result: finished.promise,
            get promptStarted() {
              promptStartedReads++;
              return Promise.resolve();
            },
            cancel: () => Promise.resolve(),
            closeStream: () => Promise.resolve(),
          };
        },
        cancel: () => Promise.resolve(),
        close: () =>
          (closeGate ?? Promise.resolve()).then(() => {
            closedSessions++;
          }),
      };
      created.push({ options, port });
      return port;
    },
  };
  const options: PinnedRuntimeOptions = {
    dataRoot: "/tmp/casys-runtime-adapter-test",
    workspaceRoot: "/tmp/casys-runtime-adapter-test/workspace",
    acpxRuntimeUrl: "unused-in-injected-test",
    agentName,
    agentArgv: ["node", "muse-acp"],
    mcpServers: [{ id: "build123d", name: "build123d", url: "http://127.0.0.1:1/mcp" }],
    sessionStoreDir: "acpx-sessions-casys-muse-standalone-mcp-build123d",
    ...(capture
      ? {
        mcpCapture: {
          openScope(): McpRelayScope {
            const number = scopes.length + 1;
            let closed = false;
            let onResult: ((call: McpObservedCall) => void) | undefined;
            const scope: FakeScope = {
              url: `http://127.0.0.1:1/mcp/scope-${number}`,
              get closed() {
                return closed;
              },
              beginTurn(callback) {
                if (onResult !== undefined) throw new Error("scope used twice");
                onResult = callback;
              },
              close() {
                closed = true;
              },
              emit(call) {
                if (!closed) onResult?.(call);
              },
            };
            scopes.push(scope);
            return scope;
          },
        },
      }
      : {}),
  };
  return {
    adapter: createPinnedRuntimeAdapterWithModule(options, module),
    scopes,
    created,
    turns,
    stores,
    get promptStartedReads() {
      return promptStartedReads;
    },
    get closedSessions() {
      return closedSessions;
    },
    get nativeYielded() {
      return nativeYielded;
    },
  };
}

function turnInput(handle: RuntimeHandle) {
  return {
    handle,
    text: "export the box",
    mode: "prompt" as const,
    requestId: "turn-1",
    signal: new AbortController().signal,
    onElicitation: () => Promise.resolve({ action: "cancel" as const }),
  };
}

async function collect(events: AsyncIterable<RuntimeEvent>): Promise<RuntimeEvent[]> {
  const collected: RuntimeEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

Deno.test("scoped adapter captures two identical calls without ACP viewer duplication", async () => {
  const h = harness();
  const handle = await h.adapter.runtime.ensureSession({
    sessionKey: "conversation-a",
    agent: "muse",
    mode: "persistent",
    cwd: "/tmp/workspace",
    sessionOptions: { systemPrompt: "test" },
  });
  const turn = h.adapter.runtime.startTurn(turnInput(handle));
  const collected = collect(turn.events);
  h.scopes[0].emit({
    callId: "mcp:one",
    tool: "build123d_export",
    args: { script: "same" },
    result: { one: true },
  });
  h.scopes[0].emit({
    callId: "mcp:two",
    tool: "build123d_export",
    args: { script: "same" },
    result: { two: true },
  });
  h.turns[0].finish();
  await turn.result;
  const events = await collected;
  const captured = events.filter((event) =>
    event.type === "tool_call" && event.rawOutput !== undefined
  );
  assertEquals(
    captured.map((event) => event.type === "tool_call" ? event.toolCallId : ""),
    ["mcp:one", "mcp:two"],
  );
  const native = events.find((event) =>
    event.type === "tool_call" && event.toolCallId === "native-card"
  );
  assert(native?.type === "tool_call");
  assertEquals(native.rawInput, undefined);
  assertEquals(native.rawOutput, undefined);
  assertEquals(h.promptStartedReads, 1);
  assertEquals(h.scopes[0].closed, true);
  await h.adapter.runtime.close({ handle, reason: "turn complete" });
});

Deno.test("scopes isolate concurrent conversations and revoke cancelled calls", async () => {
  const h = harness();
  const input = (sessionKey: string) => ({
    sessionKey,
    agent: "muse",
    mode: "persistent" as const,
    cwd: "/tmp/workspace",
    sessionOptions: { systemPrompt: "test" },
  });
  const first = await h.adapter.runtime.ensureSession(input("conversation-a"));
  const second = await h.adapter.runtime.ensureSession(input("conversation-b"));
  const firstTurn = h.adapter.runtime.startTurn(turnInput(first));
  const secondTurn = h.adapter.runtime.startTurn(turnInput(second));
  const firstEvents = collect(firstTurn.events);
  const secondEvents = collect(secondTurn.events);
  h.scopes[0].emit({
    callId: "mcp:a",
    tool: "build123d_export",
    args: {},
    result: { owner: "a" },
  });
  h.scopes[1].emit({
    callId: "mcp:b",
    tool: "build123d_export",
    args: {},
    result: { owner: "b" },
  });
  await firstTurn.cancel();
  h.scopes[0].emit({
    callId: "mcp:late",
    tool: "build123d_export",
    args: {},
    result: { owner: "late" },
  });
  h.turns[0].finish();
  h.turns[1].finish();
  await Promise.all([firstTurn.result, secondTurn.result]);
  const a = (await firstEvents).filter((event) =>
    event.type === "tool_call" && event.rawOutput !== undefined
  );
  const b = (await secondEvents).filter((event) =>
    event.type === "tool_call" && event.rawOutput !== undefined
  );
  assertEquals(a.map((event) => event.type === "tool_call" ? event.toolCallId : ""), [
    "mcp:a",
  ]);
  assertEquals(b.map((event) => event.type === "tool_call" ? event.toolCallId : ""), [
    "mcp:b",
  ]);
  assert(h.scopes[0].url !== h.scopes[1].url);
  await h.adapter.runtime.close({ handle: first, reason: "cancelled" });
  await h.adapter.runtime.close({ handle: second, reason: "completed" });
});

Deno.test("next turn gets a new relay URL with the same persistent store and rejects stale handles", async () => {
  const h = harness();
  const input = {
    sessionKey: "conversation-a",
    agent: "muse",
    mode: "persistent" as const,
    cwd: "/tmp/workspace",
    sessionOptions: { systemPrompt: "test" },
  };
  const first = await h.adapter.runtime.ensureSession(input);
  const firstTurn = h.adapter.runtime.startTurn(turnInput(first));
  const firstEvents = collect(firstTurn.events);
  h.turns[0].finish();
  await firstTurn.result;
  await firstEvents;
  await h.adapter.runtime.close({
    handle: first,
    reason: "turn complete",
    discardPersistentState: false,
  });
  const second = await h.adapter.runtime.ensureSession(input);
  assertEquals(h.stores.length, 2);
  assertEquals(h.stores[0], h.stores[1]);
  assert(h.scopes[0].url !== h.scopes[1].url);
  assertEquals(
    (h.created[0].options.mcpServers as Array<{ url: string }>)[0].url,
    h.scopes[0].url,
  );
  assertEquals(
    (h.created[1].options.mcpServers as Array<{ url: string }>)[0].url,
    h.scopes[1].url,
  );
  await assertRejects(
    () => h.adapter.runtime.cancel({ handle: first }),
    Error,
    "stale",
  );
  await h.adapter.runtime.close({ handle: second, reason: "done" });
  assertEquals(h.closedSessions, 2);
});

Deno.test("legacy adapter keeps its shared runtime without opening a scope", async () => {
  const h = harness(false);
  assertEquals(h.adapter.refreshSessionPerTurn, undefined);
  assertEquals(h.created.length, 1);
  assertEquals(h.scopes.length, 0);
  await h.adapter.close();
});

Deno.test("native burst waits for capacity and relay overflow is reported without failing RPC", async () => {
  const h = harness(true, 200);
  const handle = await h.adapter.runtime.ensureSession({
    sessionKey: "conversation-burst",
    agent: "muse",
    mode: "persistent",
    cwd: "/tmp/workspace",
    sessionOptions: { systemPrompt: "test" },
  });
  const turn = h.adapter.runtime.startTurn(turnInput(handle));
  // No consumer yet. The native producer may fill the 64-entry buffer and
  // yield one pending item, but it must never run through the entire burst.
  for (let attempt = 0; attempt < 20 && h.nativeYielded < 65; attempt++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  assertEquals(h.nativeYielded, 65);
  for (let index = 0; index < 100; index++) {
    h.scopes[0].emit({
      callId: `mcp:burst-${index}`,
      tool: "build123d_export",
      args: {},
      result: { index },
    });
  }
  const collected = collect(turn.events);
  h.turns[0].finish();
  await turn.result;
  const events = await collected;
  assertEquals(h.nativeYielded, 201);
  assert(
    events.some((event) =>
      event.type === "status" && event.text.includes("100 MCP result(s) not retained")
    ),
  );
  assertEquals(
    events.filter((event) =>
      event.type === "tool_call" && event.rawOutput !== undefined
    ).length,
    0,
  );
  await h.adapter.runtime.close({ handle, reason: "done" });
});

Deno.test("preprompt failure closes scope without an orphan result rejection", async () => {
  const h = harness(true, 0, true);
  const handle = await h.adapter.runtime.ensureSession({
    sessionKey: "conversation-preprompt",
    agent: "muse",
    mode: "persistent",
    cwd: "/tmp/workspace",
    sessionOptions: { systemPrompt: "test" },
  });
  const turn = h.adapter.runtime.startTurn(turnInput(handle));
  await assertRejects(() => turn.promptStarted!, Error, "preprompt submission failed");
  // The caller intentionally returns before reading turn.result, as the
  // coordinator does after a rejected promptStarted promise.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assertEquals(h.scopes[0].closed, true);
  assertEquals(h.promptStartedReads, 1);
  assertEquals(h.closedSessions, 1);
  const retry = await h.adapter.runtime.ensureSession({
    sessionKey: "conversation-preprompt",
    agent: "muse",
    mode: "persistent",
    cwd: "/tmp/workspace",
    sessionOptions: { systemPrompt: "test" },
  });
  assertEquals(h.created.length, 2);
  assertEquals(h.stores[0], h.stores[1]);
  assert(h.scopes[0].url !== h.scopes[1].url);
  await assertRejects(() => h.adapter.runtime.cancel({ handle }), Error, "stale");
  await h.adapter.runtime.close({ handle: retry, reason: "done" });
});

Deno.test("synchronous startTurn failure closes owner before same-key retry", async () => {
  const gate = deferred<void>();
  const h = harness(true, 0, false, true, gate.promise);
  const input = {
    sessionKey: "conversation-start-throw",
    agent: "muse",
    mode: "persistent" as const,
    cwd: "/tmp/workspace",
    sessionOptions: { systemPrompt: "test" },
  };
  const first = await h.adapter.runtime.ensureSession(input);
  assertThrows(
    () => h.adapter.runtime.startTurn(turnInput(first)),
    Error,
    "native startTurn failed",
  );
  const retry = h.adapter.runtime.ensureSession(input);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assertEquals(h.created.length, 1);
  assertEquals(h.closedSessions, 0);
  gate.resolve();
  const second = await retry;
  assertEquals(h.closedSessions, 1);
  assertEquals(h.created.length, 2);
  assertEquals(h.scopes[0].closed, true);
  assert(h.scopes[0].url !== h.scopes[1].url);
  assertEquals(h.stores[0], h.stores[1]);
  await h.adapter.runtime.close({ handle: second, reason: "done" });
});

Deno.test("cancel releases a native producer blocked by the full buffer", async () => {
  const h = harness(true, 200);
  const handle = await h.adapter.runtime.ensureSession({
    sessionKey: "conversation-cancel-burst",
    agent: "muse",
    mode: "persistent",
    cwd: "/tmp/workspace",
    sessionOptions: { systemPrompt: "test" },
  });
  const turn = h.adapter.runtime.startTurn(turnInput(handle));
  for (let attempt = 0; attempt < 20 && h.nativeYielded < 65; attempt++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  assertEquals(h.nativeYielded, 65);
  await turn.cancel();
  for (let attempt = 0; attempt < 20 && h.nativeYielded < 201; attempt++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  assertEquals(h.nativeYielded, 201);
  h.turns[0].finish();
  await turn.result;
  await h.adapter.runtime.close({ handle, reason: "cancelled" });
});

Deno.test("Codex config parse errors get a fixed safe message on legacy and scoped sessions", async () => {
  const sensitive = "/private/user/home/config.toml:13 invalid type integer 6";
  const nativeError = Object.assign(new Error("Internal error"), {
    name: "RequestError",
    code: -32603,
    data: `Error loading configuration: ${sensitive}`,
  });
  for (const capture of [false, true]) {
    const h = harness(capture, 0, false, false, undefined, nativeError, "casys-codex");
    const error = await assertRejects(() =>
      h.adapter.runtime.ensureSession({
        sessionKey: `codex-${capture}`,
        agent: "casys-codex",
        mode: "persistent",
        cwd: "/tmp/workspace",
        sessionOptions: { systemPrompt: "test" },
      })
    );
    assert(error instanceof Error);
    assertEquals(
      error.message,
      "Codex configuration is incompatible with the bundled Codex version. Use a compatible Codex configuration for this profile.",
    );
    assert(!error.message.includes(sensitive));
    if (capture) assertEquals(h.scopes[0].closed, true);
    await h.adapter.close();
  }
});

Deno.test("unrelated ACP failures and non-Codex profiles retain their original error", async () => {
  const input = {
    sessionKey: "error-check",
    agent: "casys-codex",
    mode: "persistent" as const,
    cwd: "/tmp/workspace",
    sessionOptions: { systemPrompt: "test" },
  };
  const unrelated = Object.assign(new Error("Internal error"), {
    name: "RequestError",
    code: -32603,
    data: "upstream request failed",
  });
  const codex = harness(false, 0, false, false, undefined, unrelated, "casys-codex");
  assert(
    (await assertRejects(() => codex.adapter.runtime.ensureSession(input))) ===
      unrelated,
  );
  const configError = Object.assign(new Error("Internal error"), {
    name: "RequestError",
    code: -32603,
    data: "configuration invalid type integer",
  });
  const muse = harness(true, 0, false, false, undefined, configError, "casys-muse");
  assert(
    (await assertRejects(() =>
      muse.adapter.runtime.ensureSession({ ...input, agent: "casys-muse" })
    )) === configError,
  );
  assertEquals(muse.scopes[0].closed, true);
});
