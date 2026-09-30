import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1.0.14";
import { ChatCoordinator } from "./coordinator.ts";
import {
  type ChatCommandRequest,
  DESKTOP_CHAT_PROTOCOL,
  parseChatCommandResponse,
} from "../../../src/presentation/desktop/chat/contracts.ts";
import {
  type ChatMcpProbeOutcome,
  type ChatMcpServerConfig,
  type ChatRuntimeAdapter,
  chatRuntimeKey,
  type ChatRuntimePort,
  type RuntimeElicitationResponse,
  type RuntimeEvent,
  type RuntimeHandle,
  type RuntimeInteractionSink,
  type RuntimeTurn,
  type RuntimeTurnResult,
} from "./runtime-port.ts";
import { MemoryChatConversationStore, type StoredConversation } from "./store.ts";
import {
  canonicalJson,
  createMcpCallTap,
  type McpTapQuery,
  type McpTapRecord,
} from "./mcp-tap.ts";
import type { ChatViewerBackend } from "./viewer-backend.ts";
import { parseChatSnapshotDto } from "../../../src/presentation/desktop/chat/contracts.ts";
import {
  type AgentProfileDefinition,
  type AgentProfileHost,
  BUILTIN_AGENT_PROFILES,
  CODEX_AGENT_NAME,
  CODEX_AGENT_PROFILE_ID,
  CODEX_AUTH_RECOVERY,
  MUSE_AGENT_NAME,
  MUSE_AGENT_PROFILE_ID,
  MUSE_AUTH_RECOVERY,
} from "./agent-profiles.ts";

Deno.test("ChatCoordinator binds one project, streams sanitized events, and preserves FIFO", async () => {
  const adapter = new FakeRuntimeAdapter();
  const coordinator = await coordinatorWith(adapter);
  const conversationId = await createConversation(coordinator, "coffee-machine");

  await coordinator.command(send("r1", conversationId, "First"));
  await coordinator.command(send("r2", conversationId, "Second"));
  await until(() => adapter.turns.length === 1);
  assertEquals(
    adapter.turns[0].text,
    "Bound Casys projectId: coffee-machine\n\nHuman message:\nFirst",
  );
  adapter.turns[0].events.push({ type: "text_delta", text: "Answer one" });
  adapter.turns[0].finish({ status: "completed" });

  await until(() => adapter.turns.length === 2);
  assertEquals(adapter.maxConcurrent, 1);
  adapter.turns[1].events.push({
    type: "tool_call",
    text: "ignored raw summary",
    title: "Review project brief",
    status: "completed",
    kind: "read",
  });
  adapter.turns[1].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );

  const conversation = coordinator.snapshot(conversationId).conversations[0];
  assertEquals(conversation.projectId, "coffee-machine");
  assertEquals(conversation.messages.map((message) => message.text), [
    "First",
    "Second",
    "Answer one",
    "Review project brief — completed",
  ]);
  assertEquals(
    adapter.ensureInputs[0].sessionKey.startsWith(
      "casys-desktop-exclusive/coffee-machine/conversation:",
    ),
    true,
  );
  assertMatch(
    adapter.ensureInputs[0].sessionOptions.systemPrompt,
    /exclusively bound to projectId coffee-machine/,
  );
  await coordinator.stop();
});

Deno.test("turn-scoped runtime closes its handle and re-ensures for the next turn", async () => {
  const adapter = new FakeRuntimeAdapter("turn-scoped", true);
  const coordinator = await coordinatorWith(adapter);
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(send("turn-one", conversationId, "First"));
  await until(() => adapter.turns.length === 1);
  adapter.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle" &&
    adapter.closedHandles.length === 1
  );
  await coordinator.command(send("turn-two", conversationId, "Second"));
  await until(() => adapter.turns.length === 2);
  adapter.turns[1].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle" &&
    adapter.closedHandles.length === 2
  );
  assertEquals(adapter.ensureInputs.length, 2);
  assertEquals(adapter.ensureInputs[0].sessionKey, adapter.ensureInputs[1].sessionKey);
  assertEquals(adapter.turns.length, 2);
  await coordinator.stop();
});

Deno.test("bex pseudo-tool housekeeping never lands in the transcript", async () => {
  const adapter = new FakeRuntimeAdapter();
  const coordinator = await coordinatorWith(adapter);
  const conversationId = await createConversation(coordinator, "coffee-machine");

  await coordinator.command(send("r1", conversationId, "Build it"));
  await until(() => adapter.turns.length === 1);
  adapter.turns[0].events.push({
    type: "tool_call",
    text: "reminderChild: inProgress (in_progress): Reminder child session",
    title: "reminderChild: inProgress",
    toolCallId: "ee959abe-c75f-4c67-96ec-700175d5381f",
    status: "in_progress",
    kind: "other",
  });
  adapter.turns[0].events.push({
    type: "tool_call",
    text: "mcp__build123d__build123d_execute (completed)",
    title: "mcp__build123d__build123d_execute",
    toolCallId: "call_real",
    status: "completed",
    kind: "other",
  });
  adapter.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );

  const conversation = coordinator.snapshot(conversationId).conversations[0];
  assertEquals(conversation.messages.map((message) => message.text), [
    "Build it",
    "mcp__build123d__build123d_execute — completed",
  ]);
  await coordinator.stop();
});

Deno.test("permission is separate from MRTR, correlated, and late replies fail closed", async () => {
  const adapter = new FakeRuntimeAdapter();
  const coordinator = await coordinatorWith(adapter);
  const conversationId = await createConversation(coordinator, "coffee-machine");
  await coordinator.command(send("r1", conversationId, "Inspect the project"));
  await until(() => adapter.turns.length === 1);

  const permission = coordinator.requestPermission({
    sessionId: "agent-session-1",
    inferredKind: "read",
    raw: {
      toolCall: {
        toolCallId: "tool-1",
        title: "Read project status",
        kind: "read",
      },
      options: [
        { name: "Allow once", kind: "allow_once" },
        { name: "Reject", kind: "reject_once" },
      ],
    },
  }, new AbortController().signal);
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].pendingInteraction !==
      undefined
  );
  const pending = coordinator.snapshot(conversationId).conversations[0]
    .pendingInteraction;
  assertEquals(pending?.type, "permission");
  if (pending?.type !== "permission") throw new Error("missing permission");
  assertMatch(pending.detail, /not an MRTR engineering decision/);

  const response = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "permission-reply",
    command: "permission.resolve",
    conversationId,
    correlationId: pending.correlationId,
    decision: "allow_once",
  });
  assert(response.ok);
  assertEquals(await permission, { outcome: "allow_once" });

  const late = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "late-reply",
    command: "permission.resolve",
    conversationId,
    correlationId: pending.correlationId,
    decision: "allow_once",
  });
  assertEquals(late.ok, false);
  adapter.turns[0].finish({ status: "completed" });
  await coordinator.stop();
});

Deno.test("form and URL elicitation accept, abort, and reject stale replies", async () => {
  const adapter = new FakeRuntimeAdapter();
  const coordinator = await coordinatorWith(adapter);
  const conversationId = await createConversation(coordinator, "coffee-machine");
  await coordinator.command(send("r1", conversationId, "Approve a decision"));
  await until(() => adapter.turns.length === 1);
  const turn = adapter.turns[0];

  assertEquals(
    await turn.elicit({
      mode: "form",
      message: "Wrong session",
      sessionId: "foreign-session",
      requestedSchema: { type: "object", properties: {} },
    }, "rpc-mismatch"),
    { action: "cancel" },
  );
  assertEquals(
    await turn.elicit({
      mode: "form",
      message: "Unsafe schema",
      sessionId: "agent-session-1",
      requestedSchema: {
        type: "object",
        properties: { value: { type: "string", pattern: "(a|aa)+$" } },
      },
    }, "rpc-unsafe-pattern"),
    { action: "cancel" },
  );

  const formPromise = turn.elicit({
    mode: "form",
    message: "Confirm the server-validated decision",
    sessionId: "agent-session-1",
    requestedSchema: {
      type: "object",
      properties: {
        confirmed: {
          type: "boolean",
          title: "Confirm decision",
        },
      },
      required: ["confirmed"],
    },
  }, "rpc-form");
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].pendingInteraction
      ?.type === "elicitation-form"
  );
  const form = coordinator.snapshot(conversationId).conversations[0]
    .pendingInteraction;
  if (form?.type !== "elicitation-form") throw new Error("missing form");
  const accepted = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "form-reply",
    command: "elicitation.resolve",
    conversationId,
    correlationId: form.correlationId,
    action: "accept",
    content: { confirmed: true },
  });
  assert(accepted.ok);
  assertEquals(await formPromise, {
    action: "accept",
    content: { confirmed: true },
  });

  const declinePromise = turn.elicit({
    mode: "form",
    message: "Optional follow-up",
    sessionId: "agent-session-1",
    requestedSchema: { type: "object", properties: {} },
  }, "rpc-decline");
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].pendingInteraction
      ?.type === "elicitation-form"
  );
  const decline = coordinator.snapshot(conversationId).conversations[0]
    .pendingInteraction;
  if (decline?.type !== "elicitation-form") throw new Error("missing decline form");
  const declined = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "form-decline",
    command: "elicitation.resolve",
    conversationId,
    correlationId: decline.correlationId,
    action: "decline",
  });
  assert(declined.ok);
  assertEquals(await declinePromise, { action: "decline" });

  const abort = new AbortController();
  const urlPromise = turn.elicit(
    {
      mode: "url",
      message: "Complete sign-in, then return",
      sessionId: "agent-session-1",
      elicitationId: "url-1",
      url: "https://identity.example.test/authorize",
    },
    "rpc-url",
    abort,
  );
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].pendingInteraction
      ?.type === "elicitation-url"
  );
  const url = coordinator.snapshot(conversationId).conversations[0]
    .pendingInteraction;
  if (url?.type !== "elicitation-url") throw new Error("missing URL");
  assertEquals(url.url, "https://identity.example.test/authorize");
  abort.abort();
  assertEquals(await urlPromise, { action: "cancel" });
  const late = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "url-late",
    command: "elicitation.resolve",
    conversationId,
    correlationId: url.correlationId,
    action: "accept",
  });
  assertEquals(late.ok, false);

  turn.finish({ status: "completed" });
  await coordinator.stop();
});

Deno.test("invalid elicitation content cancels the ACP request instead of orphaning it", async () => {
  const adapter = new FakeRuntimeAdapter();
  const coordinator = await coordinatorWith(adapter);
  const conversationId = await createConversation(coordinator, "coffee-machine");
  await coordinator.command(send("r1", conversationId, "Approve a decision"));
  await until(() => adapter.turns.length === 1);

  const formPromise = adapter.turns[0].elicit({
    mode: "form",
    message: "Confirm the server-validated decision",
    sessionId: "agent-session-1",
    requestedSchema: {
      type: "object",
      properties: { confirmed: { type: "boolean", title: "Confirm" } },
      required: ["confirmed"],
    },
  }, "rpc-invalid");
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].pendingInteraction
      ?.type === "elicitation-form"
  );
  const pending = coordinator.snapshot(conversationId).conversations[0]
    .pendingInteraction;
  if (pending?.type !== "elicitation-form") throw new Error("missing form");

  const response = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "invalid-form-reply",
    command: "elicitation.resolve",
    conversationId,
    correlationId: pending.correlationId,
    action: "accept",
    content: {},
  });
  assertEquals(response.ok, false);
  assertEquals(await formPromise, { action: "cancel" });
  adapter.turns[0].finish({ status: "completed" });
  await coordinator.stop();
});

Deno.test("standalone chat runs on the zero-MCP runtime without project binding", async () => {
  const pool = standalonePool();
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(send("r1", conversationId, "Hello agent"));
  await until(() => pool.standalone.turns.length === 1);
  assertEquals(pool.project.turns.length, 0);
  assertEquals(pool.standalone.turns[0].text, "Hello agent");
  const ensured = pool.standalone.ensureInputs[0];
  assertEquals(
    ensured.sessionKey.startsWith("casys-desktop-exclusive/standalone/conversation:"),
    true,
  );
  assertMatch(ensured.sessionOptions.systemPrompt, /standalone conversation/);
  assertEquals(ensured.sessionOptions.systemPrompt.includes("projectId"), false);
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const conversation = coordinator.snapshot(conversationId).conversations[0];
  assertEquals(conversation.kind, "standalone");
  assertEquals(conversation.projectId, undefined);
  assertEquals(conversation.mcp, undefined);
  const advertised = coordinator.snapshot(conversationId).connectableMcps;
  assertEquals(advertised.map((entry) => entry.id), ["build123d"]);
  assertEquals(JSON.stringify(advertised).includes("127.0.0.1"), false);
  await coordinator.stop();
});

Deno.test("mcp.enable probes, then restarts the session on the MCP runtime", async () => {
  const pool = standalonePool({ probeTools: ["t_one", "t_two"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(send("r1", conversationId, "First"));
  await until(() => pool.standalone.turns.length === 1);
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );

  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  assertEquals(pool.probeCalls, 1);
  assertEquals(pool.standalone.closedHandles, ["casys-codex"]);
  const attached = coordinator.snapshot(conversationId).conversations[0].mcp;
  assertEquals(attached?.status, "connected");
  assertEquals(attached?.displayName, "Build123d");
  assertEquals([...(attached?.tools ?? [])], ["t_one", "t_two"]);

  await coordinator.command(send("r2", conversationId, "Second"));
  await until(() => pool.mcp.turns.length === 1);
  assertEquals(pool.standalone.turns.length, 1);
  assertEquals(
    pool.mcp.ensureInputs[0].sessionKey.includes("/mcp/build123d"),
    true,
  );
  assertMatch(
    pool.mcp.ensureInputs[0].sessionOptions.systemPrompt,
    /MCP server is connected/,
  );
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const messages = coordinator.snapshot(conversationId).conversations[0].messages;
  assert(
    messages.some((message) => message.text.includes("Build123d connected (2 tools)")),
  );
  await coordinator.stop();
});

Deno.test("mcp.enable seeds the new agent session with prior context", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(
    send(
      "r1",
      conversationId,
      "The part ZR-AXLE-BRACKET is 37.125 mm wide. Acknowledge.",
    ),
  );
  await until(() => pool.standalone.turns.length === 1);
  pool.standalone.turns[0].events.push({
    type: "text_delta",
    text: "Acknowledged ZR-AXLE-BRACKET at 37.125 mm.",
  });
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  await coordinator.command(send("r2", conversationId, "Create the part now."));
  await until(() => pool.mcp.turns.length === 1);
  const seed = pool.mcp.turns[0].text;
  assertMatch(seed, /Prior conversation context follows/);
  assertMatch(seed, /do not re-execute/);
  assert(seed.includes("ZR-AXLE-BRACKET"), "seed misses the part name");
  assert(seed.includes("37.125"), "seed misses the width");
  assert(seed.includes("Build123d connected"), "seed misses the attach notice");
  assert(seed.endsWith("Create the part now."), "seed buries the current turn");
  assert(
    seed.indexOf("37.125") < seed.indexOf("Create the part now."),
    "seed follows the current turn instead of preceding it",
  );
  pool.mcp.turns[0].events.push({
    type: "text_delta",
    text: "MCP-ERA volume 3712.5 mm3.",
  });
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const disabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "disable-1",
    command: "mcp.disable",
    conversationId,
  });
  assert(disabled.ok);
  await coordinator.command(send("r3", conversationId, "What was the width?"));
  await until(() => pool.standalone.turns.length === 2);
  const reseed = pool.standalone.turns[1].text;
  assertMatch(reseed, /Prior conversation context follows/);
  assert(reseed.includes("3712.5"), "reseed misses the MCP-era delta");
  assert(reseed.includes("detached"), "reseed misses the detach notice");
  assert(reseed.includes("connected"), "reseed misses the attach notice");
  assert(reseed.endsWith("What was the width?"), "reseed buries the current turn");
  assertEquals(
    reseed.includes("Acknowledged ZR-AXLE-BRACKET"),
    false,
    "reseed duplicates what the base session already holds",
  );
  pool.standalone.turns[1].events.push({
    type: "text_delta",
    text: "BASE-ERA reply done.",
  });
  pool.standalone.turns[1].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const reenabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-2",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(reenabled.ok);
  await coordinator.command(send("r4", conversationId, "Again."));
  await until(() => pool.mcp.turns.length === 2);
  const reseedMcp = pool.mcp.turns[1].text;
  assertMatch(reseedMcp, /Prior conversation context follows/);
  assert(reseedMcp.includes("BASE-ERA reply done."), "reseed misses base-era delta");
  assert(
    reseedMcp.includes("What was the width?"),
    "reseed misses the base-era question",
  );
  assert(reseedMcp.endsWith("Again."), "reseed buries the current turn");
  assertEquals(
    reseedMcp.includes("3712.5"),
    false,
    "reseed duplicates what the MCP session already holds",
  );
  pool.mcp.turns[1].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  await coordinator.stop();
});

Deno.test("restored watermarks prevent duplicate seeding after restart", async () => {
  const store = new MemoryChatConversationStore();
  const pool = standalonePool({ probeTools: ["t_one"], store });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(send("r1", conversationId, "Remember RED-SEED-MARKER."));
  await until(() => pool.standalone.turns.length === 1);
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  await coordinator.stop();
  const second = standalonePool({ probeTools: ["t_one"], store });
  const resumed = await second.coordinator();
  await resumed.command(send("r2", conversationId, "Continue."));
  await until(() => second.standalone.turns.length === 1);
  assertEquals(
    second.standalone.turns[0].text,
    "Continue.",
    "restart re-seeds what the resumed session already holds",
  );
  second.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    resumed.snapshot(conversationId).conversations[0].status === "idle"
  );
  await resumed.stop();
});

Deno.test("context seeding truncates old messages with a note", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  for (let i = 0; i < 35; i++) {
    await coordinator.command(send(`bulk-${i}`, conversationId, `bulk message ${i}`));
    await until(() => pool.standalone.turns.length === i + 1);
    pool.standalone.turns[i].finish({ status: "completed" });
    await until(() =>
      coordinator.snapshot(conversationId).conversations[0].status === "idle"
    );
  }
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  await coordinator.command(send("r-final", conversationId, "Summarize."));
  await until(() => pool.mcp.turns.length === 1);
  const seed = pool.mcp.turns[0].text;
  assertMatch(seed, /6 earlier message\(s\) truncated/);
  assert(seed.includes("bulk message 34"), "seed misses the latest message");
  assert(seed.endsWith("Summarize."), "seed buries the current turn");
  assertEquals(seed.includes("bulk message 0"), false, "seed keeps truncated history");
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  await coordinator.stop();
});

Deno.test("context seeding drops oldest messages past the char budget", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  for (let i = 0; i < 10; i++) {
    await coordinator.command(
      send(`char-${i}`, conversationId, `char-bulk ${i} ${"x".repeat(1400)}`),
    );
    await until(() => pool.standalone.turns.length === i + 1);
    pool.standalone.turns[i].finish({ status: "completed" });
    await until(() =>
      coordinator.snapshot(conversationId).conversations[0].status === "idle"
    );
  }
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  await coordinator.command(send("r-final", conversationId, "Summarize."));
  await until(() => pool.mcp.turns.length === 1);
  const seed = pool.mcp.turns[0].text;
  assertMatch(seed, /earlier message\(s\) truncated/);
  assertEquals(
    seed.includes("char-bulk 0"),
    false,
    "seed keeps char-truncated history",
  );
  assert(seed.includes("char-bulk 9"), "seed misses the latest message");
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  await coordinator.stop();
});

Deno.test("context seeding slices single messages past the per-message cap", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(
    send("r1", conversationId, `head ${"A".repeat(1000)} tail ${"B".repeat(1000)}`),
  );
  await until(() => pool.standalone.turns.length === 1);
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  await coordinator.command(send("r2", conversationId, "Next."));
  await until(() => pool.mcp.turns.length === 1);
  const seed = pool.mcp.turns[0].text;
  assert(seed.includes("A".repeat(1000)), "seed misses the message head");
  assertEquals(
    seed.includes("B".repeat(600)),
    false,
    "seed keeps text past the per-message cap",
  );
  assert(seed.includes("…[truncated]"), "seed hides the per-message cut");
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  await coordinator.stop();
});

Deno.test("cancelled turn output reseeds into the switched session", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(send("r1", conversationId, "Interrupted request."));
  await until(() => pool.standalone.turns.length === 1);
  pool.standalone.turns[0].events.push({
    type: "text_delta",
    text: "Partial before cancel.",
  });
  pool.standalone.turns[0].finish({ status: "cancelled" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  await coordinator.command(send("r2", conversationId, "Continue with the tool."));
  await until(() => pool.mcp.turns.length === 1);
  const seed = pool.mcp.turns[0].text;
  assert(seed.includes("Interrupted request."), "seed misses the cancelled request");
  assert(seed.includes("Partial before cancel."), "seed misses partial output");
  assert(seed.includes("Turn cancelled."), "seed misses the cancel notice");
  assert(seed.endsWith("Continue with the tool."), "seed buries the current turn");
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  await coordinator.stop();
});

Deno.test("startTurn failure drops the pinned handle so the retry reseeds", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const innerStartTurn = pool.standalone.runtime.startTurn;
  let failuresLeft = 1;
  pool.standalone.runtime.startTurn = (input) => {
    if (failuresLeft > 0) {
      failuresLeft -= 1;
      throw new Error("startTurn blew up");
    }
    return innerStartTurn(input);
  };
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(send("r1", conversationId, "First context held."));
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "failed"
  );
  assertEquals(pool.standalone.ensureInputs.length, 1);
  assertEquals(pool.standalone.turns.length, 0);
  await coordinator.command(send("r2", conversationId, "Retry now."));
  await until(() => pool.standalone.turns.length === 1);
  assertEquals(
    pool.standalone.ensureInputs.length,
    2,
    "retry reused the pinned handle instead of re-ensuring",
  );
  const retry = pool.standalone.turns[0].text;
  assert(retry.includes("First context held."), "retry lost the unmarked seed");
  assert(retry.endsWith("Retry now."), "retry buries the current turn");
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  await coordinator.stop();
});

Deno.test("pre-submit cancel keeps seeded context unmarked so the retry reseeds", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(
    send(
      "r1",
      conversationId,
      "The part ZR-CANCEL-FACT is 37.125 mm wide. Acknowledge.",
    ),
  );
  await until(() => pool.standalone.turns.length === 1);
  pool.standalone.turns[0].events.push({ type: "text_delta", text: "Acknowledged." });
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  // True async runtime semantics: the first MCP turn submits only when
  // promptStarted resolves; a pre-submit cancel rejects it with zero
  // session/prompt calls, like the pinned acpx runtime.
  const gate = Promise.withResolvers<void>();
  const innerStartTurn = pool.mcp.runtime.startTurn;
  pool.mcp.runtime.startTurn = (input) => {
    const turn = innerStartTurn(input) as FakeTurn;
    if (pool.mcp.turns.length > 1) return turn;
    turn.promptStarted = gate.promise;
    const innerCancel = turn.cancel.bind(turn);
    turn.cancel = async () => {
      await innerCancel();
      gate.reject(new Error("ACP turn cancelled before prompt submission."));
    };
    return turn;
  };
  await coordinator.command(
    send("r2", conversationId, "Create the part with the width I gave you."),
  );
  await until(() => pool.mcp.turns.length === 1);
  assert(
    pool.mcp.turns[0].text.includes("ZR-CANCEL-FACT"),
    "seed was never computed for the first MCP turn",
  );
  const cancelled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "cancel-1",
    command: "turn.cancel",
    conversationId,
  });
  assert(cancelled.ok);
  // Covers the interleave where cancel lands before the coordinator pins
  // the turn: the runtime rejects submission either way.
  gate.reject(new Error("ACP turn cancelled before prompt submission."));
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  assertEquals(pool.mcp.ensureInputs.length, 1);
  await coordinator.command(send("r3", conversationId, "Retry the part now."));
  await until(() => pool.mcp.turns.length === 2);
  assertEquals(
    pool.mcp.ensureInputs.length,
    2,
    "retry reused the pinned handle instead of re-ensuring",
  );
  const retry = pool.mcp.turns[1].text;
  assertMatch(retry, /Prior conversation context follows/);
  assertMatch(retry, /do not re-execute/);
  assert(retry.includes("ZR-CANCEL-FACT"), "retry lost the untransmitted fact");
  assert(retry.includes("37.125"), "retry lost the untransmitted width");
  assert(retry.endsWith("Retry the part now."), "retry buries the current turn");
  pool.mcp.turns[1].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  await coordinator.stop();
});

Deno.test("pre-submit failure keeps seeded context unmarked and fails the turn", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(
    send("r1", conversationId, "The part ZR-FAIL-FACT is 12.5 mm wide. Acknowledge."),
  );
  await until(() => pool.standalone.turns.length === 1);
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  const gate = Promise.withResolvers<void>();
  const innerStartTurn = pool.mcp.runtime.startTurn;
  pool.mcp.runtime.startTurn = (input) => {
    const turn = innerStartTurn(input) as FakeTurn;
    if (pool.mcp.turns.length > 1) return turn;
    turn.promptStarted = gate.promise;
    return turn;
  };
  await coordinator.command(
    send("r2", conversationId, "Create the part with the width I gave you."),
  );
  await until(() => pool.mcp.turns.length === 1);
  gate.reject(new Error("submitter blew up"));
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "failed"
  );
  await coordinator.command(send("r3", conversationId, "Retry the part now."));
  await until(() => pool.mcp.turns.length === 2);
  const retry = pool.mcp.turns[1].text;
  assert(retry.includes("ZR-FAIL-FACT"), "retry lost the untransmitted fact");
  assert(retry.includes("12.5"), "retry lost the untransmitted width");
  pool.mcp.turns[1].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  await coordinator.stop();
});

Deno.test("context marking waits for confirmed prompt submission", async () => {
  const store = new MemoryChatConversationStore();
  const pool = standalonePool({ probeTools: ["t_one"], store });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  const gate = Promise.withResolvers<void>();
  const innerStartTurn = pool.standalone.runtime.startTurn;
  pool.standalone.runtime.startTurn = (input) => {
    const turn = innerStartTurn(input) as FakeTurn;
    turn.promptStarted = gate.promise;
    return turn;
  };
  await coordinator.command(send("r1", conversationId, "Remember PRE-SUBMIT-MARKER."));
  await until(() => pool.standalone.turns.length === 1);
  const userId = coordinator.snapshot(conversationId).conversations[0]
    .messages[0].id;
  const markedBefore = Object.values(
    (await store.load())[0].knownMessageIdsByKey ?? {},
  ).flat();
  assertEquals(
    markedBefore.includes(userId),
    false,
    "user message marked known before submission",
  );
  gate.resolve();
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const markedAfter = Object.values(
    (await store.load())[0].knownMessageIdsByKey ?? {},
  ).flat();
  assertEquals(
    markedAfter.includes(userId),
    true,
    "user message not marked after confirmed submission",
  );
  await coordinator.stop();
});

Deno.test("pre-submit cancel against a per-read promptStarted getter leaves no orphan rejection", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(
    send(
      "r1",
      conversationId,
      "The part ZR-GETTER-FACT is 37.125 mm wide. Acknowledge.",
    ),
  );
  await until(() => pool.standalone.turns.length === 1);
  pool.standalone.turns[0].events.push({ type: "text_delta", text: "Acknowledged." });
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  // Pinned acpx semantics (runtime.js:2068-2069): promptStarted is a getter
  // returning a NEW promise per read. Every read follows the same outcome,
  // so an abandoned first read rejects without a handler and kills the host
  // (Node 26 default: exit 1 on unhandled rejection).
  const gate = Promise.withResolvers<void>();
  let reads = 0;
  const orphans: unknown[] = [];
  const onUnhandled = (event: PromiseRejectionEvent) => {
    orphans.push(event.reason);
    event.preventDefault();
  };
  globalThis.addEventListener("unhandledrejection", onUnhandled);
  try {
    const innerStartTurn = pool.mcp.runtime.startTurn;
    pool.mcp.runtime.startTurn = (input) => {
      const turn = innerStartTurn(input) as FakeTurn;
      if (pool.mcp.turns.length > 1) return turn;
      Object.defineProperty(turn, "promptStarted", {
        configurable: true,
        get() {
          reads++;
          return gate.promise.then(() => {});
        },
      });
      const innerCancel = turn.cancel.bind(turn);
      turn.cancel = async () => {
        await innerCancel();
        gate.reject(new Error("ACP turn cancelled before prompt submission."));
      };
      return turn;
    };
    await coordinator.command(
      send("r2", conversationId, "Create the part with the width I gave you."),
    );
    await until(() => pool.mcp.turns.length === 1);
    const cancelled = await coordinator.command({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: "cancel-1",
      command: "turn.cancel",
      conversationId,
    });
    assert(cancelled.ok);
    gate.reject(new Error("ACP turn cancelled before prompt submission."));
    await until(() =>
      coordinator.snapshot(conversationId).conversations[0].status === "idle"
    );
    // Flush the orphan window: the abandoned promise (if any) rejects on
    // microtasks, the runtime surfaces it on a later macrotask.
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assertEquals(reads, 1, "promptStarted getter read more than once");
    assertEquals(orphans, [], "orphan promptStarted rejection escaped the turn");
    await coordinator.command(send("r3", conversationId, "Retry the part now."));
    await until(() => pool.mcp.turns.length === 2);
    const retry = pool.mcp.turns[1].text;
    assert(retry.includes("ZR-GETTER-FACT"), "retry lost the untransmitted fact");
    assert(retry.includes("37.125"), "retry lost the untransmitted width");
    pool.mcp.turns[1].finish({ status: "completed" });
    await until(() =>
      coordinator.snapshot(conversationId).conversations[0].status === "idle"
    );
  } finally {
    globalThis.removeEventListener("unhandledrejection", onUnhandled);
  }
  await coordinator.stop();
});

Deno.test("mcp.enable probes the assigned runtime endpoint", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const probed: ChatMcpServerConfig[] = [];
  const coordinator = await coordinatorWith(pool.standalone, {
    runtimes: new Map([
      [chatRuntimeKey("project"), pool.project],
      [chatRuntimeKey("standalone"), pool.standalone],
      [chatRuntimeKey("standalone", "build123d"), pool.mcp],
    ]),
    mcpServers: [TEST_MCP_SERVER],
    probeMcp: (server) => {
      probed.push(server);
      return Promise.resolve<ChatMcpProbeOutcome>({ ok: true, tools: ["t_one"] });
    },
    resolveMcpEndpoint: () => ({
      mcpUrl: "http://127.0.0.1:45678/mcp",
      healthUrl: "http://127.0.0.1:45678/health",
    }),
  });
  const conversationId = await createStandaloneConversation(coordinator);
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  assertEquals(probed.length, 1);
  assertEquals(probed[0].mcpUrl, "http://127.0.0.1:45678/mcp");
  assertEquals(probed[0].healthUrl, "http://127.0.0.1:45678/health");
  assertEquals(probed[0].expectedTools, ["t_one"]);
  await coordinator.stop();
});

Deno.test("mcp.enable fails closed without an assigned endpoint", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  let probeCalls = 0;
  const coordinator = await coordinatorWith(pool.standalone, {
    runtimes: new Map([
      [chatRuntimeKey("project"), pool.project],
      [chatRuntimeKey("standalone"), pool.standalone],
      [chatRuntimeKey("standalone", "build123d"), pool.mcp],
    ]),
    mcpServers: [TEST_MCP_SERVER],
    probeMcp: () => {
      probeCalls++;
      return Promise.resolve<ChatMcpProbeOutcome>({ ok: true, tools: ["t_one"] });
    },
    resolveMcpEndpoint: () => undefined,
  });
  const conversationId = await createStandaloneConversation(coordinator);
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assertEquals(enabled.ok, false);
  assert((enabled.error ?? "").includes("no assigned provider endpoint"));
  assertEquals(probeCalls, 0);
  await coordinator.stop();
});

Deno.test("late-registered runtimes serve turns; refused factories fail turns", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const agents = new FakeAgentProfileHost();
  const coordinator = await coordinatorWith(pool.standalone, {
    agents,
    runtimes: new Map([
      [chatRuntimeKey("project"), pool.project],
      [chatRuntimeKey("standalone"), pool.standalone],
    ]),
    mcpServers: [TEST_MCP_SERVER],
    probeMcp: () =>
      Promise.resolve<ChatMcpProbeOutcome>({ ok: true, tools: ["t_one"] }),
  });
  const conversationId = await createStandaloneConversation(coordinator);
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  coordinator.registerRuntime(chatRuntimeKey("standalone", "build123d"), pool.mcp);
  assert(pool.mcp.sink !== undefined, "late runtime missed its sink");
  await coordinator.command(send("r2", conversationId, "Run with the late runtime."));
  await until(() => pool.mcp.turns.length === 1);
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  coordinator.unregisterRuntime(chatRuntimeKey("standalone", "build123d"));
  agents.ensureFailures.set(CODEX_AGENT_PROFILE_ID, "mcp runtime is not configured");
  await coordinator.command(send("r3", conversationId, "Run after release."));
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "failed"
  );
  const texts = coordinator.snapshot(conversationId).conversations[0].messages.map(
    (message) => message.text,
  );
  assertEquals(texts[texts.length - 1], "mcp runtime is not configured");
  await coordinator.stop();
});

Deno.test("a later-queued message never leaks into the earlier turn seed", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  const first = coordinator.command(send("r1", conversationId, "First message."));
  const second = coordinator.command(send("r2", conversationId, "Second message."));
  await first;
  await second;
  await until(() => pool.standalone.turns.length === 1);
  assertEquals(
    pool.standalone.turns[0].text,
    "First message.",
    "later-queued message leaked into the earlier seed",
  );
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() => pool.standalone.turns.length === 2);
  assertEquals(pool.standalone.turns[1].text, "Second message.");
  pool.standalone.turns[1].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  await coordinator.stop();
});

Deno.test("known-id serialization respects the file-store retention cap", async () => {
  const store = new MemoryChatConversationStore();
  const pool = standalonePool({ probeTools: ["t_one"], store });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  for (let i = 0; i < 401; i++) {
    await coordinator.command(send(`cap-${i}`, conversationId, `cap message ${i}`));
    await until(() => pool.standalone.turns.length === i + 1);
    pool.standalone.turns[i].finish({ status: "completed" });
    await until(() =>
      coordinator.snapshot(conversationId).conversations[0].status === "idle"
    );
  }
  const saved = (await store.load()).find((entry) => entry.id === conversationId);
  const ids = Object.values(saved?.knownMessageIdsByKey ?? {}).flat();
  assert(ids.length > 0, "no known ids persisted");
  assert(ids.length <= 400, `known ids exceed retention cap: ${ids.length}`);
  await coordinator.stop();
  const second = standalonePool({ probeTools: ["t_one"], store });
  const resumed = await second.coordinator();
  await resumed.command(send("r-resume", conversationId, "After restart."));
  await until(() => second.standalone.turns.length === 1);
  const reseed = second.standalone.turns[0].text;
  assert(
    reseed.includes("cap message 0"),
    "pruned oldest id does not reseed after restart",
  );
  assertEquals(
    reseed.includes("cap message 400"),
    false,
    "retained recent id reseeds after restart",
  );
  assertEquals(
    reseed.includes("truncated"),
    false,
    "single-message reseed carries a truncation note",
  );
  second.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    resumed.snapshot(conversationId).conversations[0].status === "idle"
  );
  await resumed.stop();
});

Deno.test("failed turn output reseeds into the switched session", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(send("r1", conversationId, "Doomed request."));
  await until(() => pool.standalone.turns.length === 1);
  pool.standalone.turns[0].events.push({
    type: "text_delta",
    text: "Partial output here.",
  });
  pool.standalone.turns[0].finish({ status: "failed", error: { message: "boom" } });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "failed"
  );
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  await coordinator.command(send("r2", conversationId, "Try with the tool."));
  await until(() => pool.mcp.turns.length === 1);
  const seed = pool.mcp.turns[0].text;
  assert(seed.includes("Doomed request."), "seed misses the failed user message");
  assert(seed.includes("Partial output here."), "seed misses partial output");
  assert(seed.includes("boom"), "seed misses the failure notice");
  assert(seed.endsWith("Try with the tool."), "seed buries the current turn");
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  await coordinator.stop();
});

Deno.test("failed turn with ACP authRequired appends sign-in recovery", async () => {
  const pool = standalonePool();
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(send("r1", conversationId, "Hello."));
  await until(() => pool.standalone.turns.length === 1);
  pool.standalone.turns[0].finish({
    status: "failed",
    error: { message: "Authentication required: no valid session" },
  });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "failed"
  );
  const texts = coordinator.snapshot(conversationId).conversations[0].messages
    .map((message) => message.text);
  assertEquals(texts, [
    "Hello.",
    "Authentication required: no valid session",
    CODEX_AUTH_RECOVERY,
  ]);
  await coordinator.stop();
});

Deno.test("failed turn with other errors appends no recovery", async () => {
  const pool = standalonePool();
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(send("r1", conversationId, "Hello."));
  await until(() => pool.standalone.turns.length === 1);
  pool.standalone.turns[0].finish({
    status: "failed",
    error: { message: "Authentication requiredish" },
  });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "failed"
  );
  const texts = coordinator.snapshot(conversationId).conversations[0].messages
    .map((message) => message.text);
  assertEquals(texts, ["Hello.", "Authentication requiredish"]);
  await coordinator.stop();
});

Deno.test("new conversations use the default profile with namespaced keys", async () => {
  const pool = standalonePool({
    agents: new FakeAgentProfileHost({ defaultId: MUSE_AGENT_PROFILE_ID }),
  });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  assertEquals(
    coordinator.snapshot(conversationId).conversations[0].agentProfileId,
    MUSE_AGENT_PROFILE_ID,
  );
  await coordinator.command(send("r1", conversationId, "Hello."));
  const museAdapter = pool.agents.created.get(`standalone@${MUSE_AGENT_PROFILE_ID}`)!;
  await until(() => museAdapter.turns.length === 1);
  assertEquals(museAdapter.ensureInputs[0].agent, MUSE_AGENT_NAME);
  assert(museAdapter.ensureInputs[0].sessionKey.includes("/agent/casys-muse"));
  assertEquals(pool.standalone.turns.length, 0);
  museAdapter.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  await coordinator.stop();
});

Deno.test("agent.select switches profile preserving history without replay", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(send("r1", conversationId, "Remember REDWOOD."));
  await until(() => pool.standalone.turns.length === 1);
  pool.standalone.turns[0].events.push({ type: "text_delta", text: "Noted REDWOOD." });
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const selected = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "sel-1",
    command: "agent.select",
    conversationId,
    profileId: MUSE_AGENT_PROFILE_ID,
  });
  assert(selected.ok);
  const after = coordinator.snapshot(conversationId).conversations[0];
  assertEquals(after.agentProfileId, MUSE_AGENT_PROFILE_ID);
  assert(after.messages.some((message) => message.text.includes("Switched to Muse")));
  await coordinator.command(send("r2", conversationId, "What did I ask to remember?"));
  const museAdapter = pool.agents.created.get(`standalone@${MUSE_AGENT_PROFILE_ID}`)!;
  await until(() => museAdapter.turns.length === 1);
  assert(museAdapter.turns[0].text.includes("REDWOOD"), "seed misses prior context");
  assertMatch(museAdapter.turns[0].text, /do not re-execute/);
  assertEquals(pool.standalone.turns.length, 1, "codex turn replayed");
  museAdapter.turns[0].events.push({ type: "text_delta", text: "REDWOOD it is." });
  museAdapter.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const tagged = coordinator.snapshot(conversationId).conversations[0].messages.map(
    (message) => [message.text, message.agent] as const,
  );
  assertEquals(tagged, [
    ["Remember REDWOOD.", undefined],
    ["Noted REDWOOD.", CODEX_AGENT_PROFILE_ID],
    [tagged[2][0], MUSE_AGENT_PROFILE_ID],
    ["What did I ask to remember?", undefined],
    ["REDWOOD it is.", MUSE_AGENT_PROFILE_ID],
  ]);
  assert(tagged[2][0].includes("Switched to Muse"));
  await coordinator.stop();
});

Deno.test("agent.select refuses during an active turn or pending permission", async () => {
  const adapter = new FakeRuntimeAdapter();
  const coordinator = await coordinatorWith(adapter);
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(send("r1", conversationId, "First."));
  await until(() => adapter.turns.length === 1);
  const refused = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "sel-busy",
    command: "agent.select",
    conversationId,
    profileId: MUSE_AGENT_PROFILE_ID,
  });
  assertEquals(refused.ok, false);
  adapter.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  await coordinator.command(send("r2", conversationId, "Second."));
  await until(() => adapter.turns.length === 2);
  const permission = coordinator.requestPermission({
    sessionId: "agent-session-1",
    inferredKind: "read",
    raw: {
      toolCall: { toolCallId: "tool-1", title: "Read", kind: "read" },
      options: [{ name: "Allow once", kind: "allow_once" }],
    },
  }, new AbortController().signal);
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].pendingInteraction !==
      undefined
  );
  const refusedPending = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "sel-pending",
    command: "agent.select",
    conversationId,
    profileId: MUSE_AGENT_PROFILE_ID,
  });
  assertEquals(refusedPending.ok, false);
  const pending = coordinator.snapshot(conversationId).conversations[0]
    .pendingInteraction!;
  if (pending.type !== "permission") throw new Error("missing permission");
  const resolved = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "perm-1",
    command: "permission.resolve",
    conversationId,
    correlationId: pending.correlationId,
    decision: "allow_once",
  });
  assert(resolved.ok);
  assertEquals(await permission, { outcome: "allow_once" });
  adapter.turns[1].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const selected = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "sel-ok",
    command: "agent.select",
    conversationId,
    profileId: MUSE_AGENT_PROFILE_ID,
  });
  assert(selected.ok);
  assertEquals(
    coordinator.snapshot(conversationId).conversations[0].agentProfileId,
    MUSE_AGENT_PROFILE_ID,
  );
  await coordinator.stop();
});

Deno.test("agent.select to an unknown profile fails without mutation", async () => {
  const pool = standalonePool();
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  const before = coordinator.snapshot(conversationId).conversations[0];
  const selected = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "sel-unknown",
    command: "agent.select",
    conversationId,
    profileId: "nope",
  });
  assertEquals(selected.ok, false);
  const after = coordinator.snapshot(conversationId).conversations[0];
  assertEquals(after.agentProfileId, before.agentProfileId);
  assertEquals(after.messages.length, before.messages.length);
  await coordinator.stop();
});

Deno.test("agent.select with a failing factory keeps the old profile explicitly", async () => {
  const pool = standalonePool();
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  pool.agents.ensureFailures.set(MUSE_AGENT_PROFILE_ID, "No Muse executable found");
  const selected = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "sel-fail",
    command: "agent.select",
    conversationId,
    profileId: MUSE_AGENT_PROFILE_ID,
  });
  assertEquals(selected.ok, false);
  const after = coordinator.snapshot(conversationId).conversations[0];
  assertEquals(after.agentProfileId, CODEX_AGENT_PROFILE_ID);
  const last = after.messages[after.messages.length - 1].text;
  assert(last.includes("No Muse executable found"));
  assert(last.includes("keeps running on Codex"));
  await coordinator.command(send("r1", conversationId, "Still here."));
  await until(() => pool.standalone.turns.length === 1);
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  await coordinator.stop();
});

Deno.test("agent.set-default persists without touching conversations", async () => {
  const pool = standalonePool();
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  const set = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "def-1",
    command: "agent.set-default",
    profileId: MUSE_AGENT_PROFILE_ID,
  });
  assert(set.ok);
  assertEquals(pool.agents.savedDefaults, [MUSE_AGENT_PROFILE_ID]);
  assertEquals(
    coordinator.snapshot(conversationId).conversations[0].agentProfileId,
    CODEX_AGENT_PROFILE_ID,
  );
  const freshId = await createStandaloneConversation(coordinator);
  assertEquals(
    coordinator.snapshot(freshId).conversations[0].agentProfileId,
    MUSE_AGENT_PROFILE_ID,
  );
  const unknown = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "def-2",
    command: "agent.set-default",
    profileId: "nope",
  });
  assertEquals(unknown.ok, false);
  await coordinator.stop();
});

Deno.test("agent.reload-profiles surfaces host errors", async () => {
  const pool = standalonePool();
  const coordinator = await pool.coordinator();
  const ok = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "rel-1",
    command: "agent.reload-profiles",
  });
  assert(ok.ok);
  pool.agents.reloadOutcome = {
    ok: false,
    error: "agent profiles file is not valid JSON",
  };
  const failed = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "rel-2",
    command: "agent.reload-profiles",
  });
  assertEquals(failed.ok, false);
  assertEquals(pool.agents.reloadCalls, 2);
  await coordinator.stop();
});

Deno.test("reload replaces an idle changed-profile runtime and session", async () => {
  const agents = new FakeAgentProfileHost({ defaultId: MUSE_AGENT_PROFILE_ID });
  const pool = standalonePool({ agents });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(send("before-reload", conversationId, "Before"));
  const key = `${chatRuntimeKey("standalone")}@${MUSE_AGENT_PROFILE_ID}`;
  const oldRuntime = agents.created.get(key);
  assert(oldRuntime !== undefined);
  await until(() => oldRuntime.turns.length === 1);
  oldRuntime.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const oldSessionKey = oldRuntime.ensureInputs[0].sessionKey;
  agents.created.delete(key); // The factory invalidates its own cache on reload.
  agents.reloadOutcome = { ok: true, invalidatedRuntimeKeys: [key] };
  const reloaded = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "reload-changed-profile",
    command: "agent.reload-profiles",
  });
  assert(reloaded.ok);
  assertEquals(oldRuntime.closedHandles.length, 1);
  assertEquals(oldRuntime.closed, true);
  await coordinator.command(send("after-reload", conversationId, "After"));
  const newRuntime = agents.created.get(key);
  assert(newRuntime !== undefined && newRuntime !== oldRuntime);
  await until(() => newRuntime.turns.length === 1);
  assert(newRuntime.ensureInputs[0].sessionKey !== oldSessionKey);
  newRuntime.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  await coordinator.stop();
});

Deno.test("reload remaps conversations on removed profiles to legacy", async () => {
  const custom: AgentProfileDefinition = {
    id: "lab",
    displayName: "Lab",
    agentName: "lab",
    builtin: null,
    launch: { kind: "command", path: "/usr/local/bin/lab-acp", args: [] },
    authRecovery: "Sign in, then retry.",
    modelsExposed: false,
  };
  const agents = new FakeAgentProfileHost({
    definitions: [...BUILTIN_AGENT_PROFILES, custom],
  });
  const pool = standalonePool({ agents });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  const selected = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "sel-lab",
    command: "agent.select",
    conversationId,
    profileId: "lab",
  });
  assert(selected.ok);
  await coordinator.command(send("r1", conversationId, "Hello lab."));
  const labAdapter = agents.created.get("standalone@lab")!;
  await until(() => labAdapter.turns.length === 1);
  labAdapter.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  agents.nextDefinitions = BUILTIN_AGENT_PROFILES;
  const reloaded = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "rel-lab",
    command: "agent.reload-profiles",
  });
  assert(reloaded.ok);
  const after = coordinator.snapshot(conversationId).conversations[0];
  assertEquals(after.agentProfileId, CODEX_AGENT_PROFILE_ID);
  assert(
    after.messages.some((message) => message.text.includes("no longer available")),
  );
  await coordinator.command(send("r2", conversationId, "Hello again."));
  await until(() => pool.standalone.turns.length === 1);
  assertEquals(labAdapter.turns.length, 1, "turn landed on the orphaned runtime");
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  await coordinator.stop();
});

Deno.test("restore remaps unknown stored profiles once with a note", async () => {
  const store = new MemoryChatConversationStore();
  await store.save([{
    id: "conversation:old",
    kind: "standalone",
    agentProfileId: "deleted-x",
    sessionKey: "casys-desktop-exclusive/standalone/conversation:old/agent/deleted-x",
    title: "Old",
    status: "idle",
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
    messages: [],
  }]);
  const first = await coordinatorWith(new FakeRuntimeAdapter(), { store });
  const restored = first.snapshot("conversation:old").conversations[0];
  assertEquals(restored.agentProfileId, CODEX_AGENT_PROFILE_ID);
  assertEquals(restored.messages.length, 1);
  assert(restored.messages[0].text.includes("no longer available"));
  await first.stop();
  const second = await coordinatorWith(new FakeRuntimeAdapter(), { store });
  assertEquals(
    second.snapshot("conversation:old").conversations[0].messages.length,
    1,
    "remap note duplicated",
  );
  await second.stop();
});

Deno.test("restore keeps legacy conversations on bare codex keys", async () => {
  const store = new MemoryChatConversationStore();
  const bareKey = "casys-desktop-exclusive/standalone/conversation:legacy";
  await store.save([{
    id: "conversation:legacy",
    kind: "standalone",
    sessionKey: bareKey,
    title: "Legacy",
    status: "idle",
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
    messages: [],
  }]);
  const pool = standalonePool({ store });
  const coordinator = await pool.coordinator();
  assertEquals(
    coordinator.snapshot("conversation:legacy").conversations[0].agentProfileId,
    CODEX_AGENT_PROFILE_ID,
  );
  await coordinator.command(send("r1", "conversation:legacy", "Hello again."));
  await until(() => pool.standalone.turns.length === 1);
  assertEquals(pool.standalone.ensureInputs[0].agent, CODEX_AGENT_NAME);
  assertEquals(pool.standalone.ensureInputs[0].sessionKey, bareKey);
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot("conversation:legacy").conversations[0].status === "idle"
  );
  await coordinator.stop();
});

Deno.test("close releases only the unused mcp runtime", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  assertEquals(pool.mcp.closed, false);
  const closed = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "close-1",
    command: "conversation.close",
    conversationId,
  });
  assert(closed.ok);
  assertEquals(pool.mcp.closed, true);
  assertEquals(pool.standalone.closed, false);
  await coordinator.stop();
});

Deno.test("muse turn auth failure appends the muse recovery", async () => {
  const pool = standalonePool({
    agents: new FakeAgentProfileHost({ defaultId: MUSE_AGENT_PROFILE_ID }),
  });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(send("r1", conversationId, "Hello."));
  const museAdapter = pool.agents.created.get(`standalone@${MUSE_AGENT_PROFILE_ID}`)!;
  await until(() => museAdapter.turns.length === 1);
  museAdapter.turns[0].finish({
    status: "failed",
    error: { message: "Authentication required: not logged in" },
  });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "failed"
  );
  const texts = coordinator.snapshot(conversationId).conversations[0].messages
    .map((message) => message.text);
  assertEquals(texts, [
    "Hello.",
    "Authentication required: not logged in",
    MUSE_AUTH_RECOVERY,
  ]);
  await coordinator.stop();
});

Deno.test("pre-seeding store entries reseed full history once (fail-safe)", async () => {
  const store = new MemoryChatConversationStore();
  await store.save([{
    id: "conversation:legacy-seed",
    kind: "standalone",
    sessionKey: "casys-desktop-exclusive/standalone/conversation:legacy-seed",
    title: "Legacy",
    status: "idle",
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    messages: [
      {
        id: "message:legacy-1",
        role: "user",
        kind: "text",
        text: "LEGACY-MARKER question.",
        createdAt: "2026-08-23T00:00:00.000Z",
      },
      {
        id: "message:legacy-2",
        role: "assistant",
        kind: "text",
        text: "LEGACY-MARKER answer.",
        createdAt: "2026-08-23T00:00:00.000Z",
      },
    ],
  }]);
  const pool = standalonePool({ probeTools: ["t_one"], store });
  const coordinator = await pool.coordinator();
  await coordinator.command(send("r1", "conversation:legacy-seed", "Continue."));
  await until(() => pool.standalone.turns.length === 1);
  const seed = pool.standalone.turns[0].text;
  assert(seed.includes("LEGACY-MARKER question."), "upgrade lost user history");
  assert(seed.includes("LEGACY-MARKER answer."), "upgrade lost assistant history");
  assert(seed.endsWith("Continue."), "seed buries the current turn");
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot("conversation:legacy-seed").conversations[0].status === "idle"
  );
  await coordinator.stop();
});

Deno.test("mcp.enable records connection failure without touching the agent session", async () => {
  const pool = standalonePool({ probeError: "connection refused" });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(send("r1", conversationId, "First"));
  await until(() => pool.standalone.turns.length === 1);
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );

  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assertEquals(enabled.ok, false);
  assertMatch(enabled.error ?? "", /MCP connection failed/);
  assertEquals(pool.standalone.closedHandles, []);
  const attached = coordinator.snapshot(conversationId).conversations[0].mcp;
  assertEquals(attached?.status, "failed");

  await coordinator.command(send("r2", conversationId, "Second"));
  await until(() => pool.standalone.turns.length === 2);
  assertEquals(pool.mcp.turns.length, 0);
  pool.standalone.turns[1].finish({ status: "completed" });
  await coordinator.stop();
});

Deno.test("mcp.enable re-probes as the reconnect path", async () => {
  const pool = standalonePool({ probeError: "connection refused" });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  const first = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assertEquals(first.ok, false);

  pool.probeError = undefined;
  pool.probeTools = ["t_one"];
  const second = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-2",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(second.ok);
  assertEquals(pool.probeCalls, 2);
  assertEquals(
    coordinator.snapshot(conversationId).conversations[0].mcp?.status,
    "connected",
  );
  await coordinator.stop();
});

Deno.test("mcp.disable detaches and restarts without the MCP", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  await coordinator.command(send("r1", conversationId, "First"));
  await until(() => pool.mcp.turns.length === 1);
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );

  const disabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "disable-1",
    command: "mcp.disable",
    conversationId,
  });
  assert(disabled.ok);
  assertEquals(pool.mcp.closedHandles, ["casys-codex"]);
  assertEquals(
    coordinator.snapshot(conversationId).conversations[0].mcp,
    undefined,
  );
  await coordinator.command(send("r2", conversationId, "Second"));
  await until(() => pool.standalone.turns.length === 1);
  assertEquals(
    pool.standalone.ensureInputs[0].sessionKey.includes("/mcp/"),
    false,
  );
  pool.standalone.turns[0].finish({ status: "completed" });
  await coordinator.stop();
});

Deno.test("project conversations refuse MCP attachment changes", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createConversation(coordinator, "coffee-machine");
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assertEquals(enabled.ok, false);
  const disabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "disable-1",
    command: "mcp.disable",
    conversationId,
  });
  assertEquals(disabled.ok, false);
  assertEquals(pool.probeCalls, 0);
  await coordinator.stop();
});

Deno.test("unknown MCP ids are refused before probing", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "no-such-mcp",
  });
  assertEquals(enabled.ok, false);
  assertEquals(pool.probeCalls, 0);
  await coordinator.stop();
});

Deno.test("MCP switch refuses while a turn is active", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(send("r1", conversationId, "Keep running"));
  await until(() => pool.standalone.turns.length === 1);
  const refused = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assertEquals(refused.ok, false);
  assertEquals(pool.probeCalls, 0);
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-2",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  await coordinator.stop();
});

Deno.test("MCP switch refuses while a turn is queued", async () => {
  const store = new GatedSaveStore();
  const pool = standalonePool({ probeTools: ["t_one"], store });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  const release = store.hold();
  const sending = coordinator.command(send("r1", conversationId, "Queue me"));
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "queued"
  );
  assertEquals(pool.standalone.turns.length, 0);
  const enableRefused = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assertEquals(enableRefused.ok, false);
  const disableRefused = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "disable-1",
    command: "mcp.disable",
    conversationId,
  });
  assertEquals(disableRefused.ok, false);
  assertEquals(pool.probeCalls, 0);
  release();
  await sending;
  await until(() => pool.standalone.turns.length === 1);
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  await coordinator.stop();
});

Deno.test("turn.cancel drops a turn queued behind a running turn", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command(send("r1", conversationId, "First"));
  await until(() => pool.standalone.turns.length === 1);
  await coordinator.command(send("r2", conversationId, "Second"));
  const cancelled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "cancel-1",
    command: "turn.cancel",
    conversationId,
  });
  assert(cancelled.ok);
  pool.standalone.turns[0].finish({ status: "cancelled" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  assertEquals(pool.standalone.turns.length, 1);
  await coordinator.stop();
});

Deno.test("turn.cancel before the queued turn chains never executes it", async () => {
  const store = new GatedSaveStore();
  const pool = standalonePool({ probeTools: ["t_one"], store });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  const release = store.hold();
  const sending = coordinator.command(send("r1", conversationId, "Queue me"));
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "queued"
  );
  const cancelled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "cancel-1",
    command: "turn.cancel",
    conversationId,
  });
  assert(cancelled.ok);
  release();
  await sending;
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  assertEquals(pool.standalone.turns.length, 0);
  await coordinator.stop();
});

Deno.test("failed re-enable from connected detaches and routes back to zero MCP", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  await coordinator.command(send("r1", conversationId, "Use MCP"));
  await until(() => pool.mcp.turns.length === 1);
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  pool.probeError = "connection refused";
  const reenabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-2",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assertEquals(reenabled.ok, false);
  const failed = coordinator.snapshot(conversationId).conversations[0];
  assertEquals(failed.mcp?.status, "failed");
  assertEquals(pool.mcp.closedHandles, ["casys-codex"]);
  assertEquals(pool.standalone.closedHandles, []);
  await coordinator.command(send("r2", conversationId, "Resume"));
  await until(() => pool.standalone.turns.length === 1);
  assertEquals(pool.mcp.turns.length, 1);
  const reseed = pool.standalone.turns[0].text;
  assertMatch(reseed, /Prior conversation context follows/);
  assert(reseed.includes("Use MCP"), "reseed misses the MCP-era request");
  assert(reseed.includes("MCP connection failed"), "reseed misses the failure notice");
  assert(reseed.endsWith("Resume"), "reseed buries the current turn");
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const disabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "disable-1",
    command: "mcp.disable",
    conversationId,
  });
  assert(disabled.ok);
  assertEquals(pool.mcp.closedHandles, ["casys-codex"]);
  await coordinator.stop();
});

Deno.test("legacy project entries restore as project conversations", async () => {
  const store = new MemoryChatConversationStore();
  await store.save([{
    id: "conversation:legacy",
    projectId: "coffee-machine",
    sessionKey: "casys-desktop-exclusive/coffee-machine/conversation:legacy",
    title: "Project coffee-machine",
    status: "idle",
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    messages: [],
  }]);
  const adapter = new FakeRuntimeAdapter();
  const coordinator = await coordinatorWith(adapter, { store });
  const conversation = coordinator.snapshot("conversation:legacy").conversations[0];
  assertEquals(conversation.kind, "project");
  assertEquals(conversation.projectId, "coffee-machine");
  await coordinator.command(send("r1", "conversation:legacy", "Resume"));
  await until(() => adapter.turns.length === 1);
  assertEquals(
    adapter.turns[0].text,
    "Bound Casys projectId: coffee-machine\n\nHuman message:\nResume",
  );
  adapter.turns[0].finish({ status: "completed" });
  await coordinator.stop();
});

Deno.test("standalone attachment restores across coordinator restarts", async () => {
  const store = new MemoryChatConversationStore();
  const first = standalonePool({ probeTools: ["t_one"], store });
  const coordinator = await first.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-1",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  assert(enabled.ok);
  await coordinator.stop();

  const second = standalonePool({ probeTools: ["t_one"], store });
  const resumed = await second.coordinator();
  const restored = resumed.snapshot(conversationId).conversations[0];
  assertEquals(restored.kind, "standalone");
  assertEquals(restored.mcp?.status, "connected");
  await resumed.command(send("r1", conversationId, "Resume"));
  await until(() => second.mcp.turns.length === 1);
  assertEquals(second.standalone.turns.length, 0);
  second.mcp.turns[0].finish({ status: "completed" });
  await resumed.stop();
});

Deno.test("restore strips MCP fields from project entries", async () => {
  const store = new MemoryChatConversationStore();
  await store.save([{
    id: "conversation:poisoned",
    kind: "project",
    projectId: "coffee-machine",
    mcpId: "build123d",
    mcpStatus: "connected",
    mcpTools: ["t_one"],
    sessionKey: "casys-desktop-exclusive/coffee-machine/conversation:poisoned",
    title: "Project coffee-machine",
    status: "idle",
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    messages: [],
  }]);
  const adapter = new FakeRuntimeAdapter();
  const coordinator = await coordinatorWith(adapter, { store });
  const restored = coordinator.snapshot("conversation:poisoned").conversations[0];
  assertEquals(restored.kind, "project");
  assertEquals(restored.mcp, undefined);
  parseChatSnapshotDto(JSON.parse(JSON.stringify(coordinator.snapshot())));
  await coordinator.stop();
});

Deno.test("restore keeps the conversation but drops unpaired standalone MCP fields", async () => {
  const store = new MemoryChatConversationStore();
  await store.save([{
    id: "conversation:half",
    kind: "standalone",
    mcpId: "build123d",
    sessionKey: "casys-desktop-exclusive/standalone/conversation:half",
    title: "Half attached",
    status: "idle",
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    messages: [],
  }]);
  const pool = standalonePool({ probeTools: ["t_one"], store });
  const coordinator = await pool.coordinator();
  const restored = coordinator.snapshot("conversation:half").conversations[0];
  assertEquals(restored.kind, "standalone");
  assertEquals(restored.mcp, undefined);
  parseChatSnapshotDto(JSON.parse(JSON.stringify(coordinator.snapshot())));
  await coordinator.command(send("r1", "conversation:half", "Resume"));
  await until(() => pool.standalone.turns.length === 1);
  pool.standalone.turns[0].finish({ status: "completed" });
  await coordinator.stop();
});

Deno.test("shutdown cancels the active turn and closes every retained session", async () => {
  const adapter = new FakeRuntimeAdapter();
  const coordinator = await coordinatorWith(adapter);
  const conversationId = await createConversation(coordinator, "coffee-machine");
  await coordinator.command(send("r1", conversationId, "Keep running"));
  await until(() => adapter.turns.length === 1);
  const turn = adapter.turns[0];
  const stopped = coordinator.stop();
  await until(() => turn.cancelled);
  turn.finish({ status: "cancelled" });
  await stopped;
  assertEquals(adapter.closedHandles, ["casys-codex"]);
  assertEquals(adapter.closed, true);
  assertEquals(coordinator.snapshot(conversationId).host, "shutting-down");
});

function send(
  requestId: string,
  conversationId: string,
  text: string,
): ChatCommandRequest {
  return {
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId,
    command: "message.send",
    conversationId,
    text,
  };
}

async function createConversation(
  coordinator: ChatCoordinator,
  projectId: string,
): Promise<string> {
  const result = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "create",
    command: "conversation.create",
    projectId,
  });
  if (!result.ok || result.conversationId === undefined) {
    throw new Error("create failed");
  }
  return result.conversationId;
}

async function createStandaloneConversation(
  coordinator: ChatCoordinator,
): Promise<string> {
  const result = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "create",
    command: "conversation.create",
  });
  if (!result.ok || result.conversationId === undefined) {
    throw new Error("create failed");
  }
  return result.conversationId;
}

const TEST_MCP_SERVER: ChatMcpServerConfig = {
  id: "build123d",
  displayName: "Build123d",
  description: "Parametric CAD execution",
  transport: "streamable-http",
  mcpUrl: "http://127.0.0.1:3014/mcp",
  healthUrl: "http://127.0.0.1:3014/health",
  expectedTools: ["t_one"],
  expectedViews: ["ui://mcp-build123d/results-viewer"],
};

function standalonePool(options: {
  probeTools?: readonly string[];
  probeError?: string;
  store?: MemoryChatConversationStore;
  viewerBackend?: ChatViewerBackend;
  agents?: AgentProfileHost;
  findMcpTapCall?: (mcpId: string, query: McpTapQuery) => McpTapRecord | undefined;
} = {}): {
  readonly project: FakeRuntimeAdapter;
  readonly standalone: FakeRuntimeAdapter;
  readonly mcp: FakeRuntimeAdapter;
  readonly agents: FakeAgentProfileHost;
  probeTools: readonly string[] | undefined;
  probeError: string | undefined;
  probeCalls: number;
  coordinator(): Promise<ChatCoordinator>;
} {
  const project = new FakeRuntimeAdapter("project");
  const standalone = new FakeRuntimeAdapter("standalone");
  const mcp = new FakeRuntimeAdapter("mcp");
  const agents = options.agents instanceof FakeAgentProfileHost
    ? options.agents
    : new FakeAgentProfileHost();
  // The production factory caches one adapter per key; seed the fake the
  // same way so release/re-ensure round-trips keep adapter identity.
  agents.created.set(`${chatRuntimeKey("project")}@${CODEX_AGENT_PROFILE_ID}`, project);
  agents.created.set(
    `${chatRuntimeKey("standalone")}@${CODEX_AGENT_PROFILE_ID}`,
    standalone,
  );
  agents.created.set(
    `${chatRuntimeKey("standalone", "build123d")}@${CODEX_AGENT_PROFILE_ID}`,
    mcp,
  );
  const state = {
    project,
    standalone,
    mcp,
    agents,
    probeTools: options.probeTools,
    probeError: options.probeError,
    probeCalls: 0,
    coordinator(): Promise<ChatCoordinator> {
      return coordinatorWith(project, {
        agents,
        runtimes: new Map([
          [chatRuntimeKey("project"), project],
          [chatRuntimeKey("standalone"), standalone],
          [chatRuntimeKey("standalone", "build123d"), mcp],
        ]),
        mcpServers: [TEST_MCP_SERVER],
        probeMcp: () => {
          state.probeCalls += 1;
          if (state.probeError !== undefined) {
            return Promise.resolve<ChatMcpProbeOutcome>({
              ok: false,
              error: state.probeError,
            });
          }
          return Promise.resolve<ChatMcpProbeOutcome>({
            ok: true,
            tools: [...(state.probeTools ?? [])],
          });
        },
        ...(options.store === undefined ? {} : { store: options.store }),
        ...(options.viewerBackend === undefined
          ? {}
          : { viewerBackend: options.viewerBackend }),
        ...(options.findMcpTapCall === undefined
          ? {}
          : { findMcpTapCall: options.findMcpTapCall }),
      });
    },
  };
  return state;
}

class FakeAgentProfileHost implements AgentProfileHost {
  definitions: readonly AgentProfileDefinition[];
  readonly created = new Map<string, FakeRuntimeAdapter>();
  readonly savedDefaults: string[] = [];
  nextDefinitions?: readonly AgentProfileDefinition[];
  reloadCalls = 0;
  reloadOutcome: {
    readonly ok: true;
    readonly invalidatedRuntimeKeys: readonly string[];
  } | {
    readonly ok: false;
    readonly error: string;
  } = {
    ok: true,
    invalidatedRuntimeKeys: [],
  };
  ensureFailures = new Map<string, string>();
  #defaultId: string;

  constructor(options: {
    definitions?: readonly AgentProfileDefinition[];
    defaultId?: string;
  } = {}) {
    this.definitions = options.definitions ?? BUILTIN_AGENT_PROFILES;
    this.#defaultId = options.defaultId ?? CODEX_AGENT_PROFILE_ID;
  }

  defaultProfileId(): string {
    return this.#defaultId;
  }

  statusOf(profileId: string) {
    const definition = this.definitions.find((entry) => entry.id === profileId)!;
    const failure = this.ensureFailures.get(profileId);
    return {
      definition,
      available: failure === undefined,
      ...(failure === undefined ? { version: "test-1" } : { missingReason: failure }),
    };
  }

  ensureRuntime(
    profileId: string,
    baseRuntimeKey: string,
  ): Promise<ChatRuntimeAdapter> {
    const failure = this.ensureFailures.get(profileId);
    if (failure !== undefined) return Promise.reject(new Error(failure));
    const key = `${baseRuntimeKey}@${profileId}`;
    let adapter = this.created.get(key);
    if (adapter === undefined) {
      adapter = new FakeRuntimeAdapter(`factory:${key}`);
      this.created.set(key, adapter);
    }
    return Promise.resolve(adapter);
  }

  saveDefault(profileId: string): Promise<void> {
    this.savedDefaults.push(profileId);
    this.#defaultId = profileId;
    return Promise.resolve();
  }

  reload(): Promise<
    | { readonly ok: true; readonly invalidatedRuntimeKeys: readonly string[] }
    | { readonly ok: false; readonly error: string }
  > {
    this.reloadCalls += 1;
    if (this.reloadOutcome.ok && this.nextDefinitions !== undefined) {
      this.definitions = this.nextDefinitions;
    }
    return Promise.resolve(this.reloadOutcome);
  }
}

function coordinatorWith(
  adapter: FakeRuntimeAdapter,
  options: {
    runtimes?: ReadonlyMap<string, FakeRuntimeAdapter>;
    mcpServers?: readonly ChatMcpServerConfig[];
    probeMcp?: (server: ChatMcpServerConfig) => Promise<ChatMcpProbeOutcome>;
    resolveMcpEndpoint?: (
      mcpId: string,
    ) => { readonly mcpUrl: string; readonly healthUrl: string } | undefined;
    store?: MemoryChatConversationStore;
    viewerBackend?: ChatViewerBackend;
    agents?: AgentProfileHost;
    findMcpTapCall?: (mcpId: string, query: McpTapQuery) => McpTapRecord | undefined;
  } = {},
): Promise<ChatCoordinator> {
  let sequence = 0;
  return ChatCoordinator.create({
    agents: options.agents ?? new FakeAgentProfileHost(),
    runtimes: options.runtimes ??
      new Map([
        [chatRuntimeKey("project"), adapter],
        [chatRuntimeKey("standalone"), adapter],
      ]),
    mcpServers: options.mcpServers ?? [],
    probeMcp: options.probeMcp ??
      (() =>
        Promise.resolve<ChatMcpProbeOutcome>({
          ok: false,
          error: "no MCP configured",
        })),
    store: options.store ?? new MemoryChatConversationStore(),
    ...(options.viewerBackend === undefined
      ? {}
      : { viewerBackend: options.viewerBackend }),
    ...(options.resolveMcpEndpoint === undefined
      ? {}
      : { resolveMcpEndpoint: options.resolveMcpEndpoint }),
    ...(options.findMcpTapCall === undefined
      ? {}
      : { findMcpTapCall: options.findMcpTapCall }),
    workspaceRoot: "/private/chat-workspace",
    now: () => new Date(1_700_000_000_000 + sequence++),
    newId: () => String(sequence++),
  });
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("condition was not reached");
}

class GatedSaveStore extends MemoryChatConversationStore {
  #gate: Promise<void> = Promise.resolve();

  hold(): () => void {
    let release!: () => void;
    this.#gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  }

  override async save(
    conversations: readonly StoredConversation[],
  ): Promise<void> {
    await this.#gate;
    await super.save(conversations);
  }
}

class AsyncEventQueue implements AsyncIterable<RuntimeEvent> {
  readonly #values: RuntimeEvent[] = [];
  readonly #waiters: ((value: IteratorResult<RuntimeEvent>) => void)[] = [];
  #done = false;

  push(value: RuntimeEvent): void {
    const waiter = this.#waiters.shift();
    if (waiter !== undefined) waiter({ value, done: false });
    else this.#values.push(value);
  }

  close(): void {
    this.#done = true;
    for (const waiter of this.#waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<RuntimeEvent> {
    return {
      next: () => {
        const value = this.#values.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.#done) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve) => this.#waiters.push(resolve));
      },
    };
  }
}

class FakeTurn implements RuntimeTurn {
  readonly events = new AsyncEventQueue();
  readonly result: Promise<RuntimeTurnResult>;
  readonly text: string;
  promptStarted?: Promise<void>;
  readonly #onElicitation: Parameters<ChatRuntimePort["startTurn"]>[0][
    "onElicitation"
  ];
  readonly #finish: (result: RuntimeTurnResult) => void;
  readonly #onFinished: () => void;
  cancelled = false;

  constructor(
    input: Parameters<ChatRuntimePort["startTurn"]>[0],
    onFinished: () => void,
  ) {
    this.text = input.text;
    this.#onElicitation = input.onElicitation;
    this.#onFinished = onFinished;
    const deferred = Promise.withResolvers<RuntimeTurnResult>();
    this.result = deferred.promise;
    this.#finish = deferred.resolve;
  }

  finish(result: RuntimeTurnResult): void {
    this.events.close();
    this.#finish(result);
    this.#onFinished();
  }

  elicit(
    request: Parameters<
      Parameters<ChatRuntimePort["startTurn"]>[0]["onElicitation"]
    >[0],
    requestId: string,
    controller = new AbortController(),
  ): Promise<RuntimeElicitationResponse> {
    return this.#onElicitation(request, {
      requestId,
      signal: controller.signal,
    });
  }

  cancel(): Promise<void> {
    this.cancelled = true;
    return Promise.resolve();
  }

  closeStream(): Promise<void> {
    this.events.close();
    return Promise.resolve();
  }
}

class FakeRuntimeAdapter implements ChatRuntimeAdapter {
  readonly refreshSessionPerTurn?: boolean;
  readonly turns: FakeTurn[] = [];
  readonly ensureInputs: Parameters<ChatRuntimePort["ensureSession"]>[0][] = [];
  readonly closedHandles: string[] = [];
  readonly runtime: ChatRuntimePort;
  sink?: RuntimeInteractionSink;
  active = 0;
  maxConcurrent = 0;
  closed = false;

  constructor(tag = "1", refreshSessionPerTurn = false) {
    this.refreshSessionPerTurn = refreshSessionPerTurn;
    this.runtime = {
      ensureSession: (input) => {
        this.ensureInputs.push(input);
        return Promise.resolve<RuntimeHandle>({
          sessionKey: input.sessionKey,
          backend: "casys-codex",
          runtimeSessionName: input.sessionKey,
          backendSessionId: `backend-session-${tag}`,
          agentSessionId: `agent-session-${tag}`,
        });
      },
      startTurn: (input) => {
        this.active++;
        this.maxConcurrent = Math.max(this.maxConcurrent, this.active);
        const turn = new FakeTurn(input, () => this.active--);
        this.turns.push(turn);
        return turn;
      },
      cancel: () => Promise.resolve(),
      close: (input) => {
        this.closedHandles.push(input.handle.backend);
        return Promise.resolve();
      },
    };
  }

  setInteractionSink(sink: RuntimeInteractionSink): void {
    this.sink = sink;
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

const VIEWER_APP_URI = "ui://mcp-build123d/results-viewer";
const VIEWER_APP_HTML = "<!doctype html><html><body>viewer</body></html>";

class FakeViewerBackend implements ChatViewerBackend {
  readonly appCalls: Array<{ server: string; uri: string }> = [];
  readonly toolCalls: Array<{ server: string; name: string }> = [];
  readonly resourceCalls: Array<{ server: string; uri: string }> = [];

  resolveApp(server: string, uri: string) {
    this.appCalls.push({ server, uri });
    const bytes = new TextEncoder().encode(VIEWER_APP_HTML);
    return Promise.resolve({
      uri,
      mimeType: "text/html;profile=mcp-app",
      bytes,
      fingerprint: `sha256:${"01".repeat(32)}`,
    });
  }

  callTool(server: string, name: string, _args: unknown): Promise<unknown> {
    this.toolCalls.push({ server, name });
    return Promise.resolve({ echoed: name });
  }

  readResource(server: string, uri: string): Promise<unknown> {
    this.resourceCalls.push({ server, uri });
    return Promise.resolve({
      contents: [{
        uri,
        mimeType: "model/step",
        blob: "c3RlcA==",
      }],
    });
  }
}

async function enableTestMcp(
  coordinator: ChatCoordinator,
  conversationId: string,
): Promise<void> {
  const enabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "enable-viewer",
    command: "mcp.enable",
    conversationId,
    mcpId: "build123d",
  });
  if (!enabled.ok) throw new Error("mcp.enable failed");
}

function viewerToolResult(volume: number): Record<string, unknown> {
  return {
    volume,
    _meta: { ui: { resourceUri: VIEWER_APP_URI } },
  };
}

Deno.test("dev tap attributes an output-less namespaced tool event", async () => {
  const backend = new FakeViewerBackend();
  const tap = createMcpCallTap();
  const pool = standalonePool({
    probeTools: ["t_one"],
    viewerBackend: backend,
    findMcpTapCall: (_mcpId, query) => tap.takeMatch(query),
  });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  await coordinator.command(send("r1", conversationId, "Model a box"));
  await until(() => pool.mcp.turns.length === 1);
  // Relay-side key order differs from the event: canonicalization matches.
  tap.record({
    tool: "t_one",
    argsJson: canonicalJson({ b: 1, a: 2 }),
    resultJson: canonicalJson(viewerToolResult(1000)),
    failed: false,
    at: 1_700_000_000_000 + 50_000,
  });
  pool.mcp.turns[0].events.push({
    type: "tool_call",
    text: "mcp__build123d__t_one (completed)",
    title: "mcp__build123d__t_one",
    toolCallId: "tool-call-tap",
    status: "completed",
    rawInput: { a: 2, b: 1 },
  });
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const viewers = coordinator.snapshot(conversationId).conversations[0].viewers;
  assertEquals(viewers.length, 1);
  assertEquals(viewers[0]?.toolCallId, "tool-call-tap");
  assertEquals(viewers[0]?.tool, "t_one");
  assertEquals(viewers[0]?.appUri, VIEWER_APP_URI);
  await coordinator.stop();
});

Deno.test("dev tap skips on ambiguity and foreign titles", async () => {
  const tap = createMcpCallTap();
  const pool = standalonePool({
    probeTools: ["t_one"],
    findMcpTapCall: (_mcpId, query) => tap.takeMatch(query),
  });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  await coordinator.command(send("r1", conversationId, "Model a box"));
  await until(() => pool.mcp.turns.length === 1);
  const at = 1_700_000_000_000 + 50_000;
  tap.record({
    tool: "t_one",
    argsJson: canonicalJson({}),
    resultJson: "{}",
    failed: false,
    at,
  });
  tap.record({
    tool: "t_one",
    argsJson: canonicalJson({}),
    resultJson: "{}",
    failed: false,
    at,
  });
  pool.mcp.turns[0].events.push({
    type: "tool_call",
    text: "mcp__build123d__t_one (completed)",
    title: "mcp__build123d__t_one",
    toolCallId: "tool-call-ambiguous",
    status: "completed",
    rawInput: {},
  });
  pool.mcp.turns[0].events.push({
    type: "tool_call",
    text: "mcp__foreign__t_one (completed)",
    title: "mcp__foreign__t_one",
    toolCallId: "tool-call-foreign",
    status: "completed",
    rawInput: {},
  });
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  assertEquals(
    coordinator.snapshot(conversationId).conversations[0].viewers,
    [],
  );
  await coordinator.stop();
});

Deno.test("claude-style tool events capture the string result without a tap", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  await coordinator.command(send("r1", conversationId, "Model a box"));
  await until(() => pool.mcp.turns.length === 1);
  pool.mcp.turns[0].events.push({
    type: "tool_call",
    text: "mcp__build123d__t_one (completed)",
    title: "mcp__build123d__t_one",
    toolCallId: "tool-call-claude",
    status: "completed",
    rawInput: { script: "result = 1" },
    rawOutput: JSON.stringify(viewerToolResult(1000)),
  });
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const viewers = coordinator.snapshot(conversationId).conversations[0].viewers;
  assertEquals(viewers.length, 1);
  assertEquals(viewers[0]?.toolCallId, "tool-call-claude");
  assertEquals(viewers[0]?.tool, "t_one");
  assertEquals(viewers[0]?.appUri, VIEWER_APP_URI);
  await coordinator.stop();
});

Deno.test("claude-style capture accepts a single text block array", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  await coordinator.command(send("r1", conversationId, "Model a box"));
  await until(() => pool.mcp.turns.length === 1);
  pool.mcp.turns[0].events.push({
    type: "tool_call",
    text: "mcp__build123d__t_one (completed)",
    title: "mcp__build123d__t_one",
    toolCallId: "tool-call-claude-blocks",
    status: "completed",
    rawInput: { script: "result = 1" },
    rawOutput: [{ type: "text", text: JSON.stringify(viewerToolResult(1000)) }],
  });
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  assertEquals(
    coordinator.snapshot(conversationId).conversations[0].viewers.length,
    1,
  );
  await coordinator.stop();
});

Deno.test("claude-style capture ignores foreign and unparsable shapes", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  await coordinator.command(send("r1", conversationId, "Model a box"));
  await until(() => pool.mcp.turns.length === 1);
  pool.mcp.turns[0].events.push({
    type: "tool_call",
    text: "mcp__foreign__t_one (completed)",
    title: "mcp__foreign__t_one",
    toolCallId: "tool-call-foreign",
    status: "completed",
    rawInput: { script: "result = 1" },
    rawOutput: JSON.stringify(viewerToolResult(1000)),
  });
  pool.mcp.turns[0].events.push({
    type: "tool_call",
    text: "mcp__build123d__t_one (completed)",
    title: "mcp__build123d__t_one",
    toolCallId: "tool-call-garbage",
    status: "completed",
    rawInput: { script: "result = 1" },
    rawOutput: "not json",
  });
  pool.mcp.turns[0].events.push({
    type: "tool_call",
    text: "mcp__build123d__t_one (completed)",
    title: "mcp__build123d__t_one",
    toolCallId: "tool-call-scalar",
    status: "completed",
    rawInput: { script: "result = 1" },
    rawOutput: JSON.stringify(42),
  });
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  assertEquals(
    coordinator.snapshot(conversationId).conversations[0].viewers,
    [],
  );
  await coordinator.stop();
});

Deno.test("canvas layout round-trips and reconciles against retained results", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  await coordinator.command(send("r1", conversationId, "Model a box"));
  await until(() => pool.mcp.turns.length === 1);
  pool.mcp.turns[0].events.push({
    type: "tool_call",
    text: "t_one (completed)",
    toolCallId: "tool-call-canvas",
    status: "completed",
    rawInput: { server: "build123d", tool: "t_one", arguments: {} },
    rawOutput: { result: viewerToolResult(1000) },
  });
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const set = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "canvas-set-1",
    command: "canvas.set-layout",
    conversationId,
    layout: {
      version: 1,
      nodes: [
        {
          id: "node-kept",
          kind: "viewer",
          x: 10,
          y: 20,
          z: 1,
          toolCallId: "tool-call-canvas",
        },
        {
          id: "node-dropped",
          kind: "viewer",
          x: 300,
          y: 20,
          z: 2,
          toolCallId: "tool-call-gone",
        },
        {
          id: "node-note",
          kind: "note",
          x: 10,
          y: 300,
          z: 3,
          text: "Review wall",
        },
      ],
      groups: [{ id: "group-1", title: "Review" }],
    },
  });
  assert(set.ok);
  const got = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "canvas-get-1",
    command: "canvas.get-layout",
    conversationId,
  });
  assert(got.ok);
  assertEquals(
    got.layout?.nodes.map((node) => node.id),
    ["node-kept", "node-note"],
  );
  assertEquals(
    got.layout?.nodes[0]?.viewerId,
    coordinator.snapshot(conversationId).conversations[0].viewers[0]?.viewerId,
  );
  assertEquals(got.layout?.nodes[0]?.toolCallId, undefined);
  assertEquals(got.layout?.groups.length, 1);
  await coordinator.stop();
});

Deno.test("canvas layout persists across restarts per conversation", async () => {
  const store = new MemoryChatConversationStore();
  const pool = standalonePool({ probeTools: ["t_one"], store });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  const set = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "canvas-set-1",
    command: "canvas.set-layout",
    conversationId,
    layout: {
      version: 1,
      nodes: [{
        id: "node-note",
        kind: "note",
        x: 5,
        y: 5,
        z: 0,
        text: "Survives restart",
      }],
      groups: [],
    },
  });
  assert(set.ok);
  await coordinator.stop();
  const second = standalonePool({ probeTools: ["t_one"], store });
  const resumed = await second.coordinator();
  const got = await resumed.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "canvas-get-2",
    command: "canvas.get-layout",
    conversationId,
  });
  assert(got.ok);
  assertEquals(got.layout?.nodes.length, 1);
  assertEquals(
    (got.layout?.nodes[0] as { text?: string }).text,
    "Survives restart",
  );
  await resumed.stop();
});

Deno.test("canvas set-layout refuses closed conversations", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "close-1",
    command: "conversation.close",
    conversationId,
  });
  const set = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "canvas-set-1",
    command: "canvas.set-layout",
    conversationId,
    layout: { version: 1, nodes: [], groups: [] },
  });
  assertEquals(set.ok, false);
  await coordinator.stop();
});

Deno.test("output-less tool events capture nothing without a tap", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  await coordinator.command(send("r1", conversationId, "Model a box"));
  await until(() => pool.mcp.turns.length === 1);
  pool.mcp.turns[0].events.push({
    type: "tool_call",
    text: "mcp__build123d__t_one (completed)",
    title: "mcp__build123d__t_one",
    toolCallId: "tool-call-plain",
    status: "completed",
    rawInput: { script: "result = 1" },
  });
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  assertEquals(
    coordinator.snapshot(conversationId).conversations[0].viewers,
    [],
  );
  await coordinator.stop();
});

Deno.test("viewer captures the exact tool result and opens the expected App", async () => {
  const backend = new FakeViewerBackend();
  const pool = standalonePool({ probeTools: ["t_one"], viewerBackend: backend });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  await coordinator.command(send("r1", conversationId, "Model a box"));
  await until(() => pool.mcp.turns.length === 1);
  pool.mcp.turns[0].events.push({
    type: "tool_call",
    text: "t_one",
    toolCallId: "tool-call-1",
    rawInput: {
      server: "build123d",
      tool: "t_one",
      arguments: { script: "result = 1" },
    },
    rawOutput: { result: viewerToolResult(1000) },
  });
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );

  const viewers = coordinator.snapshot(conversationId).conversations[0].viewers;
  assertEquals(viewers.length, 1);
  assertEquals(viewers[0]?.toolCallId, "tool-call-1");
  assertEquals(viewers[0]?.tool, "t_one");
  assertEquals(viewers[0]?.appUri, VIEWER_APP_URI);

  const opened = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "open-1",
    command: "viewer.open",
    conversationId,
    toolCallId: "tool-call-1",
  });
  assert(opened.ok);
  assertEquals(opened.viewer?.app.uri, VIEWER_APP_URI);
  assertEquals(
    opened.viewer?.app.bytes,
    new TextEncoder().encode(VIEWER_APP_HTML).length,
  );
  assertEquals(opened.viewer?.toolInput, { script: "result = 1" });
  assertEquals<unknown>(opened.viewer?.toolResult, viewerToolResult(1000));
  assertEquals(opened.viewer?.serverTools, ["t_one"]);
  assertEquals(backend.appCalls, [{ server: "build123d", uri: VIEWER_APP_URI }]);

  const called = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "call-1",
    command: "viewer.tool-call",
    conversationId,
    toolCallId: "tool-call-1",
    name: "t_one",
    arguments: {},
  });
  assert(called.ok);
  assertEquals(called.viewerResult, { echoed: "t_one" });

  const read = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "read-1",
    command: "viewer.resource-read",
    conversationId,
    toolCallId: "tool-call-1",
    uri: "ui://mcp-build123d/exports/box.step",
  });
  assert(read.ok);
  assertEquals(read.viewerResource?.mimeType, "model/step");
  assertEquals(read.viewerResource?.data, "c3RlcA==");
  await coordinator.stop();
});

Deno.test("viewer ignores results outside the owning server or expected views", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  await coordinator.command(send("r1", conversationId, "Model a box"));
  await until(() => pool.mcp.turns.length === 1);
  pool.mcp.turns[0].events.push({
    type: "tool_call",
    text: "foreign",
    toolCallId: "tool-call-foreign",
    rawInput: { server: "other", tool: "t_one", arguments: {} },
    rawOutput: { result: viewerToolResult(1) },
  });
  pool.mcp.turns[0].events.push({
    type: "tool_call",
    text: "unknown-view",
    toolCallId: "tool-call-unknown-view",
    rawInput: { server: "build123d", tool: "t_one", arguments: {} },
    rawOutput: {
      result: {
        volume: 2,
        _meta: { ui: { resourceUri: "ui://mcp-build123d/unknown-viewer" } },
      },
    },
  });
  pool.mcp.turns[0].events.push({
    type: "tool_call",
    text: "no-view",
    toolCallId: "tool-call-no-view",
    rawInput: { server: "build123d", tool: "t_one", arguments: {} },
    rawOutput: { result: { volume: 3 } },
  });
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  assertEquals(
    coordinator.snapshot(conversationId).conversations[0].viewers,
    [],
  );
  await coordinator.stop();
});

Deno.test("viewer refuses unknown sessions, tools, and out-of-scope resources", async () => {
  const backend = new FakeViewerBackend();
  const pool = standalonePool({ probeTools: ["t_one"], viewerBackend: backend });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  await coordinator.command(send("r1", conversationId, "Model a box"));
  await until(() => pool.mcp.turns.length === 1);
  pool.mcp.turns[0].events.push({
    type: "tool_call",
    text: "t_one",
    toolCallId: "tool-call-1",
    rawInput: { server: "build123d", tool: "t_one", arguments: {} },
    rawOutput: { result: viewerToolResult(1000) },
  });
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );

  const unknown = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "open-unknown",
    command: "viewer.open",
    conversationId,
    toolCallId: "tool-call-missing",
  });
  assertEquals(unknown.ok, false);
  assertEquals(backend.appCalls.length, 0);

  const foreignTool = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "call-foreign",
    command: "viewer.tool-call",
    conversationId,
    toolCallId: "tool-call-1",
    name: "t_two",
    arguments: {},
  });
  assertEquals(foreignTool.ok, false);
  assertEquals(backend.toolCalls.length, 0);

  const foreignResource = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "read-foreign",
    command: "viewer.resource-read",
    conversationId,
    toolCallId: "tool-call-1",
    uri: "ui://mcp-other/exports/box.step",
  });
  assertEquals(foreignResource.ok, false);
  assertEquals(backend.resourceCalls.length, 0);

  const artifact = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "read-artifact",
    command: "viewer.resource-read",
    conversationId,
    toolCallId: "tool-call-1",
    uri: "casys://build123d/artifacts/abc.glb",
  });
  assert(artifact.ok);
  assertEquals(backend.resourceCalls.length, 1);
  await coordinator.stop();
});

Deno.test("viewer sessions stay bound to their conversation", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const first = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, first);
  await coordinator.command(send("r1", first, "Model a box"));
  await until(() => pool.mcp.turns.length === 1);
  pool.mcp.turns[0].events.push({
    type: "tool_call",
    text: "t_one",
    toolCallId: "tool-call-1",
    rawInput: { server: "build123d", tool: "t_one", arguments: {} },
    rawOutput: { result: viewerToolResult(1000) },
  });
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() => coordinator.snapshot(first).conversations[0].status === "idle");

  const second = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, second);
  const crossed = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "open-crossed",
    command: "viewer.open",
    conversationId: second,
    toolCallId: "tool-call-1",
  });
  assertEquals(crossed.ok, false);
  assertEquals(coordinator.snapshot(second).conversations[0].viewers, []);
  await coordinator.stop();
});

Deno.test("oversize tool results are not captured for the viewer", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  await coordinator.command(send("r1", conversationId, "Model a box"));
  await until(() => pool.mcp.turns.length === 1);
  pool.mcp.turns[0].events.push({
    type: "tool_call",
    text: "t_one",
    toolCallId: "tool-call-big",
    rawInput: { server: "build123d", tool: "t_one", arguments: {} },
    rawOutput: {
      result: {
        blob: "x".repeat(300_000),
        _meta: { ui: { resourceUri: VIEWER_APP_URI } },
      },
    },
  });
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  assertEquals(
    coordinator.snapshot(conversationId).conversations[0].viewers,
    [],
  );
  await coordinator.stop();
});

Deno.test("viewer commands refuse without a connected MCP session", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  const opened = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "open-detached",
    command: "viewer.open",
    conversationId,
    toolCallId: "tool-call-1",
  });
  assertEquals(opened.ok, false);
  await coordinator.stop();
});

async function captureViewerResult(
  pool: ReturnType<typeof standalonePool>,
  coordinator: ChatCoordinator,
  conversationId: string,
  calls: ReadonlyArray<{
    toolCallId: string;
    tool: string;
    result?: Record<string, unknown>;
  }>,
): Promise<void> {
  await coordinator.command(send("r1", conversationId, "Model a box"));
  await until(() => pool.mcp.turns.length === 1);
  for (const call of calls) {
    pool.mcp.turns[0].events.push({
      type: "tool_call",
      text: call.tool,
      toolCallId: call.toolCallId,
      rawInput: { server: "build123d", tool: call.tool, arguments: {} },
      rawOutput: { result: call.result ?? viewerToolResult(11) },
    });
  }
  pool.mcp.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
}

Deno.test("viewer capture ignores provider tool names outside the renderer shape", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  await captureViewerResult(pool, coordinator, conversationId, [
    { toolCallId: "tool-call-hostile", tool: "evil tool/x" },
    { toolCallId: "tool-call-1", tool: "t_one" },
  ]);
  const snapshot = coordinator.snapshot(conversationId);
  assertEquals(
    snapshot.conversations[0].viewers.map((viewer) => viewer.toolCallId),
    ["tool-call-1"],
  );
  parseChatSnapshotDto(snapshot);
  await coordinator.stop();
});

Deno.test("probe and restore keep only DTO-admitted tool names", async () => {
  const store = new MemoryChatConversationStore();
  const pool = standalonePool({
    probeTools: ["t_one", "", "bad name/x", "y".repeat(129)],
    store,
  });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  const snapshot = coordinator.snapshot(conversationId);
  // The conversation list admits display names (text ≤128); only empty
  // and oversize names drop. Viewer paths enforce the strict regex.
  assertEquals(snapshot.conversations[0].mcp?.tools, ["t_one", "bad name/x"]);
  parseChatSnapshotDto(snapshot);
  await coordinator.stop();

  const validResult = {
    toolCallId: "tool-call-1",
    server: "build123d",
    tool: "t_one",
    messageId: "message-1",
    appUri: VIEWER_APP_URI,
    failed: false,
    input: {},
    result: viewerToolResult(3),
    capturedAt: "2026-09-27T00:00:00.000Z",
  };
  await store.save([{
    id: conversationId,
    kind: "standalone",
    sessionKey: `casys-desktop-exclusive/standalone/${conversationId}/mcp/build123d`,
    title: "Standalone",
    status: "idle",
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
    messages: [],
    mcpId: "build123d",
    mcpStatus: "connected",
    mcpTools: ["t_one", "", "bad name", 42],
    toolResults: [
      validResult,
      { ...validResult, toolCallId: "tool-call-bad-tool", tool: "evil tool" },
      { ...validResult, toolCallId: "bad id" },
      {
        ...validResult,
        toolCallId: "tool-call-bad-uri",
        appUri: "https://example.com/evil.html",
      },
    ],
  } as unknown as StoredConversation]);
  const revived = await standalonePool({ store }).coordinator();
  const revivedSnapshot = revived.snapshot(conversationId);
  assertEquals(revivedSnapshot.conversations[0].mcp?.tools, ["t_one", "bad name"]);
  assertEquals(
    revivedSnapshot.conversations[0].viewers.map((viewer) => viewer.toolCallId),
    ["tool-call-1"],
  );
  parseChatSnapshotDto(revivedSnapshot);
  await revived.stop();
});

Deno.test("viewer.open advertises only renderer-shaped server tools within the cap", async () => {
  const tools = [
    "t_one",
    "bad name/x",
    ...Array.from(
      { length: 70 },
      (_, index) => `t_${String(index).padStart(2, "0")}`,
    ),
  ];
  const backend = new FakeViewerBackend();
  const pool = standalonePool({ probeTools: tools, viewerBackend: backend });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  await captureViewerResult(pool, coordinator, conversationId, [
    { toolCallId: "tool-call-1", tool: "t_one" },
  ]);
  const opened = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "open-1",
    command: "viewer.open",
    conversationId,
    toolCallId: "tool-call-1",
  });
  assert(opened.ok);
  const serverTools = opened.viewer?.serverTools ?? [];
  assertEquals(serverTools.length, 64);
  assertEquals(serverTools[0], "t_one");
  assertEquals(serverTools.includes("bad name/x"), false);
  parseChatCommandResponse(opened);
  await coordinator.stop();
});

Deno.test("saved work stays listed while its live viewer is detached", async () => {
  const backend = new FakeViewerBackend();
  const pool = standalonePool({ probeTools: ["t_one"], viewerBackend: backend });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  await captureViewerResult(pool, coordinator, conversationId, [
    { toolCallId: "tool-call-1", tool: "t_one" },
  ]);
  assertEquals(
    coordinator.snapshot(conversationId).conversations[0].viewers.length,
    1,
  );
  const disabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "disable-1",
    command: "mcp.disable",
    conversationId,
  });
  assert(disabled.ok);
  assertEquals(
    coordinator.snapshot(conversationId).conversations[0].viewers.length,
    1,
  );
  const offlineApp = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "offline-app",
    command: "viewer.open",
    conversationId,
    toolCallId: "tool-call-1",
  });
  assertEquals(offlineApp.ok, false);
  await enableTestMcp(coordinator, conversationId);
  assertEquals(
    coordinator.snapshot(conversationId).conversations[0].viewers.length,
    1,
  );
  const opened = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "open-again",
    command: "viewer.open",
    conversationId,
    toolCallId: "tool-call-1",
  });
  assert(opened.ok);
  await coordinator.stop();
});

class HugeMimeViewerBackend extends FakeViewerBackend {
  override readResource(_server: string, uri: string): Promise<unknown> {
    return Promise.resolve({
      contents: [{ uri, mimeType: "x".repeat(201), blob: "c3RlcA==" }],
    });
  }
}

async function sha256OfText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function viewerExportResult(
  records: ReadonlyArray<{
    uri: string;
    mimeType: string;
    bytes: number;
    sha256: string;
  }>,
): Record<string, unknown> {
  return {
    ...viewerToolResult(11),
    structuredContent: {
      files: records.map((record) => ({
        artifact: {
          schemaVersion: "build123d-export-artifact/1.0",
          ...record,
        },
      })),
    },
  };
}

Deno.test("capture archives export bytes with revision and digest", async () => {
  const backend = new FakeViewerBackend();
  const store = new MemoryChatConversationStore();
  const pool = standalonePool({
    probeTools: ["t_one"],
    viewerBackend: backend,
    store,
  });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  const sha256 = await sha256OfText("step");
  const uri = `casys://build123d/artifacts/${sha256}.step`;
  await captureViewerResult(pool, coordinator, conversationId, [
    {
      toolCallId: "tool-call-1",
      tool: "t_one",
      result: viewerExportResult([{ uri, mimeType: "model/step", bytes: 4, sha256 }]),
    },
  ]);
  const snapshot = coordinator.snapshot(conversationId);
  const archive = snapshot.conversations[0].viewers[0]?.archive;
  assertEquals(archive?.revision, 1);
  assertEquals(archive?.resultDigest?.startsWith("sha256:"), true);
  assertEquals(archive?.artifacts.length, 1);
  assertEquals(archive?.artifacts[0]?.state, "saved");
  assertEquals(archive?.artifacts[0]?.fileName, `${sha256}.step`);
  assertEquals(backend.resourceCalls.length, 1);
  assertEquals(await store.loadArtifact(sha256), new TextEncoder().encode("step"));
  assertEquals(snapshot.retention, undefined);
  parseChatSnapshotDto(snapshot);
  await coordinator.stop();
});

Deno.test("capture names extension-less stl artifacts with the stl suffix", async () => {
  const backend = new FakeViewerBackend();
  const pool = standalonePool({ probeTools: ["t_one"], viewerBackend: backend });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  const sha256 = await sha256OfText("stl");
  const uri = `casys://build123d/artifacts/${sha256}`;
  await captureViewerResult(pool, coordinator, conversationId, [
    {
      toolCallId: "tool-call-1",
      tool: "t_one",
      result: viewerExportResult([{ uri, mimeType: "model/stl", bytes: 3, sha256 }]),
    },
  ]);
  const snapshot = coordinator.snapshot(conversationId);
  const archive = snapshot.conversations[0].viewers[0]?.archive;
  assertEquals(archive?.artifacts[0]?.fileName, "t_one-v1.stl");
  parseChatSnapshotDto(snapshot);
  await coordinator.stop();
});

Deno.test("resource-read serves retained bytes without touching the provider", async () => {
  const backend = new FakeViewerBackend();
  const pool = standalonePool({ probeTools: ["t_one"], viewerBackend: backend });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  const sha256 = await sha256OfText("step");
  const uri = `casys://build123d/artifacts/${sha256}.step`;
  await captureViewerResult(pool, coordinator, conversationId, [
    {
      toolCallId: "tool-call-1",
      tool: "t_one",
      result: viewerExportResult([{ uri, mimeType: "model/step", bytes: 4, sha256 }]),
    },
  ]);
  assertEquals(backend.resourceCalls.length, 1);
  const read = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "read-saved",
    command: "viewer.resource-read",
    conversationId,
    toolCallId: "tool-call-1",
    uri,
  });
  assert(read.ok);
  assertEquals(read.viewerResource?.source, "saved");
  assertEquals(read.viewerResource?.data, "c3RlcA==");
  assertEquals(backend.resourceCalls.length, 1);
  parseChatCommandResponse(read);
  await coordinator.stop();
});

class FailingResourceBackend extends FakeViewerBackend {
  override readResource(server: string, uri: string): Promise<unknown> {
    if (uri.includes("unreadable")) {
      return Promise.reject(new Error("provider forgot the export"));
    }
    if (uri.includes("multiblock")) {
      return Promise.resolve({
        contents: [
          { uri, mimeType: "model/step", blob: "c3RlcA==" },
          { uri, mimeType: "model/step", blob: "c3RlcA==" },
        ],
      });
    }
    return super.readResource(server, uri);
  }
}

Deno.test("capture records missing artifacts with explicit reasons", async () => {
  const backend = new FailingResourceBackend();
  const pool = standalonePool({ probeTools: ["t_one"], viewerBackend: backend });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  const sha256 = await sha256OfText("step");
  await captureViewerResult(pool, coordinator, conversationId, [
    {
      toolCallId: "tool-call-1",
      tool: "t_one",
      result: viewerExportResult([
        {
          uri: "casys://build123d/artifacts/huge.step",
          mimeType: "model/step",
          bytes: 600_000,
          sha256: "ee".repeat(32),
        },
        {
          uri: "casys://build123d/artifacts/unreadable.step",
          mimeType: "model/step",
          bytes: 4,
          sha256,
        },
        {
          uri: "casys://build123d/artifacts/tampered.step",
          mimeType: "model/step",
          bytes: 4,
          sha256: "ff".repeat(32),
        },
        {
          uri: "casys://build123d/artifacts/resized.step",
          mimeType: "model/step",
          bytes: 5,
          sha256,
        },
        {
          uri: "casys://build123d/artifacts/multiblock.step",
          mimeType: "model/step",
          bytes: 4,
          sha256,
        },
      ]),
    },
  ]);
  const snapshot = coordinator.snapshot(conversationId);
  assertEquals(snapshot.conversations[0].status, "idle");
  const artifacts = snapshot.conversations[0].viewers[0]?.archive?.artifacts ?? [];
  assertEquals(artifacts.map((artifact) => artifact.state), [
    "missing",
    "missing",
    "missing",
    "missing",
    "missing",
  ]);
  assertEquals(
    artifacts[0]?.reason,
    "The export exceeds the 512 KiB retained-bytes cap.",
  );
  assertEquals(
    artifacts[1]?.reason,
    "The provider read failed before the bytes were retained.",
  );
  assertEquals(
    artifacts[2]?.reason,
    "The provider's export failed the digest check.",
  );
  assertEquals(
    artifacts[3]?.reason,
    "The provider's export changed size before it was retained.",
  );
  assertEquals(
    artifacts[4]?.reason,
    "Resource read returned multiple content blocks.",
  );
  parseChatSnapshotDto(snapshot);
  await coordinator.stop();
});

Deno.test("exact same-id redelivery is idempotent", async () => {
  const backend = new FakeViewerBackend();
  const pool = standalonePool({ probeTools: ["t_one"], viewerBackend: backend });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  await captureViewerResult(pool, coordinator, conversationId, [
    { toolCallId: "tool-call-1", tool: "t_one" },
    { toolCallId: "tool-call-1", tool: "t_one" },
  ]);
  const viewers = coordinator.snapshot(conversationId).conversations[0].viewers;
  assertEquals(viewers.length, 1);
  assertEquals(viewers[0]?.archive?.revision, 1);
  assertEquals(
    coordinator.snapshot(conversationId).conversations[0].messages.filter((message) =>
      message.kind === "tool"
    ).length,
    1,
  );
  await coordinator.stop();
});

Deno.test("changed result under one native id becomes a new version", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  await captureViewerResult(pool, coordinator, conversationId, [
    { toolCallId: "same-native-id", tool: "t_one", result: viewerToolResult(11) },
    { toolCallId: "same-native-id", tool: "t_one", result: viewerToolResult(22) },
  ]);
  const viewers = coordinator.snapshot(conversationId).conversations[0].viewers;
  assertEquals(viewers.map((viewer) => viewer.archive?.revision), [1, 2]);
  assert(viewers[0].viewerId !== viewers[1].viewerId);
  await coordinator.stop();
});

Deno.test("same native id and bytes on a later turn is a new call", async () => {
  const pool = standalonePool({ probeTools: ["t_one"] });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  await captureViewerResult(pool, coordinator, conversationId, [
    { toolCallId: "reused-id", tool: "t_one", result: viewerToolResult(11) },
  ]);
  await coordinator.command(send("next-turn-same-id", conversationId, "Repeat"));
  await until(() => pool.mcp.turns.length === 2);
  pool.mcp.turns[1].events.push({
    type: "tool_call",
    text: "t_one (completed)",
    toolCallId: "reused-id",
    status: "completed",
    rawInput: { server: "build123d", tool: "t_one", arguments: {} },
    rawOutput: { result: viewerToolResult(11) },
  });
  pool.mcp.turns[1].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  assertEquals(
    coordinator.snapshot(conversationId).conversations[0].viewers.map((viewer) =>
      viewer.archive?.revision
    ),
    [1, 2],
  );
  await coordinator.stop();
});

Deno.test("same native call id across agents keeps two exact saved versions", async () => {
  const backend = new FakeViewerBackend();
  const store = new MemoryChatConversationStore();
  const pool = standalonePool({ probeTools: ["t_one"], viewerBackend: backend, store });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  const firstSha = await sha256OfText("one");
  const secondSha = await sha256OfText("two");
  const firstUri = `casys://build123d/artifacts/${firstSha}.step`;
  const secondUri = `casys://build123d/artifacts/${secondSha}.step`;
  backend.readResource = (_server, uri) =>
    Promise.resolve({
      contents: [{
        uri,
        mimeType: "model/step",
        blob: btoa(uri === firstUri ? "one" : "two"),
      }],
    });
  await captureViewerResult(pool, coordinator, conversationId, [{
    toolCallId: "reused-native-id",
    tool: "t_one",
    result: viewerExportResult([{
      uri: firstUri,
      mimeType: "model/step",
      bytes: 3,
      sha256: firstSha,
    }]),
  }]);
  const switched = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "agent-switch-between-results",
    command: "agent.select",
    conversationId,
    profileId: MUSE_AGENT_PROFILE_ID,
  });
  assert(switched.ok);
  const muse = pool.agents.created.get(
    `${chatRuntimeKey("standalone", "build123d")}@${MUSE_AGENT_PROFILE_ID}`,
  );
  assert(muse !== undefined);
  await coordinator.command(send("muse-result", conversationId, "Second tool call"));
  await until(() => muse.turns.length === 1);
  muse.turns[0].events.push({
    type: "tool_call",
    text: "t_one (completed)",
    toolCallId: "reused-native-id",
    status: "completed",
    rawInput: { server: "build123d", tool: "t_one", arguments: {} },
    rawOutput: {
      result: viewerExportResult([{
        uri: secondUri,
        mimeType: "model/step",
        bytes: 3,
        sha256: secondSha,
      }]),
    },
  });
  muse.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const viewers = coordinator.snapshot(conversationId).conversations[0].viewers;
  assertEquals(viewers.map((viewer) => viewer.archive?.revision), [1, 2]);
  assertEquals(viewers.map((viewer) => viewer.toolCallId), [
    "reused-native-id",
    "reused-native-id",
  ]);
  assert(viewers[0].viewerId !== viewers[1].viewerId);
  const set = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "place-both-versions",
    command: "canvas.set-layout",
    conversationId,
    layout: {
      version: 1,
      nodes: viewers.map((viewer, index) => ({
        id: `node-${index}`,
        kind: "viewer" as const,
        viewerId: viewer.viewerId,
        x: index * 100,
        y: 0,
        z: index,
      })),
      groups: [],
    },
  });
  assert(set.ok);
  const layout = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "read-both-nodes",
    command: "canvas.get-layout",
    conversationId,
  });
  assertEquals(
    layout.layout?.nodes.map((node) => node.viewerId),
    viewers.map((viewer) => viewer.viewerId),
  );
  const disabled = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "detach-after-both-results",
    command: "mcp.disable",
    conversationId,
  });
  assert(disabled.ok);
  assertEquals(coordinator.snapshot(conversationId).conversations[0].viewers.length, 2);
  for (const [index, uri] of [firstUri, secondUri].entries()) {
    const capture = await coordinator.command({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: `archive-${index}`,
      command: "viewer.archive-read",
      conversationId,
      viewerId: viewers[index].viewerId,
    });
    assert(capture.ok);
    assertEquals(capture.viewerCapture?.viewerId, viewers[index].viewerId);
    const read = await coordinator.command({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: `saved-${index}`,
      command: "viewer.resource-read",
      conversationId,
      toolCallId: viewers[index].viewerId,
      uri,
    });
    assert(read.ok);
    assertEquals(read.viewerResource?.source, "saved");
    assertEquals(read.viewerResource?.data, btoa(index === 0 ? "one" : "two"));
  }
  assertEquals(await store.loadArtifact(firstSha), new TextEncoder().encode("one"));
  assertEquals(await store.loadArtifact(secondSha), new TextEncoder().encode("two"));
  await coordinator.stop();
  const revived = await standalonePool({ store, viewerBackend: backend }).coordinator();
  assertEquals(
    revived.snapshot(conversationId).conversations[0].viewers.map((viewer) =>
      viewer.viewerId
    ),
    viewers.map((viewer) => viewer.viewerId),
  );
  const revivedLayout = await revived.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "read-both-nodes-after-restart",
    command: "canvas.get-layout",
    conversationId,
  });
  assertEquals(
    revivedLayout.layout?.nodes.map((node) => node.viewerId),
    viewers.map((viewer) => viewer.viewerId),
  );
  await revived.stop();
});

class GatedMemoryStore extends MemoryChatConversationStore {
  gated = false;
  saveCalls = 0;
  #release: (() => void) | undefined;
  #held: Promise<void> | undefined;

  override async save(
    conversations: readonly StoredConversation[],
  ): Promise<void> {
    this.saveCalls += 1;
    if (this.gated) {
      this.#held ??= new Promise<void>((resolve) => {
        this.#release = resolve;
      });
      await this.#held;
    }
    return super.save(conversations);
  }

  release(): void {
    this.gated = false;
    this.#release?.();
  }
}

class CountingResourceBackend extends FakeViewerBackend {
  completedReads = 0;

  override readResource(server: string, uri: string): Promise<unknown> {
    return super.readResource(server, uri).then((result) => {
      this.completedReads += 1;
      return result;
    });
  }
}

Deno.test("stale persist queued during archival cannot prune new bytes", async () => {
  const backend = new CountingResourceBackend();
  const store = new GatedMemoryStore();
  const pool = standalonePool({
    probeTools: ["t_one"],
    viewerBackend: backend,
    store,
  });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  const sha256 = await sha256OfText("step");
  const uri = `casys://build123d/artifacts/${sha256}.step`;
  await coordinator.command(send("r1", conversationId, "Model a box"));
  await until(() => pool.mcp.turns.length === 1);
  // Queue a stale persist FIRST and hold its execution: the snapshot cannot
  // reference the entry captured below. The archival commit must land behind
  // it (bytes, then manifest), so the stale save runs while the bytes are
  // still absent. Pre-fix code wrote bytes outside the tail: they landed
  // during the hold and the stale save pruned them.
  const permission = coordinator.requestPermission({
    sessionId: "agent-session-mcp",
    inferredKind: "read",
    raw: {
      toolCall: {
        toolCallId: "tool-1",
        title: "Read project status",
        kind: "read",
      },
      options: [
        { name: "Allow once", kind: "allow_once" },
        { name: "Reject", kind: "reject_once" },
      ],
    },
  }, new AbortController().signal);
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].pendingInteraction !==
      undefined
  );
  const pending =
    coordinator.snapshot(conversationId).conversations[0].pendingInteraction;
  if (pending?.type !== "permission") throw new Error("missing permission");
  store.gated = true;
  const resolved = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "permission-during-capture",
    command: "permission.resolve",
    conversationId,
    correlationId: pending.correlationId,
    decision: "allow_once",
  });
  assert(resolved.ok);
  assertEquals(await permission, { outcome: "allow_once" });
  pool.mcp.turns[0].events.push({
    type: "tool_call",
    text: "t_one",
    toolCallId: "tool-call-1",
    rawInput: { server: "build123d", tool: "t_one", arguments: {} },
    rawOutput: {
      result: viewerExportResult([{ uri, mimeType: "model/step", bytes: 4, sha256 }]),
    },
  });
  pool.mcp.turns[0].finish({ status: "completed" });
  // Wait for the archival fetch to complete: the until() poll gap drains
  // every pending microtask, so pre-fix code has necessarily landed its
  // bytes (outside the tail) while the stale save is still held. Releasing
  // then forces the stale save to run over landed-but-unreferenced bytes:
  // pre-fix code prunes them (test fails); the tail commit orders the stale
  // save first, then bytes, then manifest (test passes).
  await until(() => backend.completedReads > 0);
  store.release();
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  assertEquals(
    await store.loadArtifact(sha256),
    new TextEncoder().encode("step"),
  );
  const snapshot = coordinator.snapshot(conversationId);
  assertEquals(
    snapshot.conversations[0].viewers[0]?.archive?.artifacts[0]?.state,
    "saved",
  );
  parseChatSnapshotDto(snapshot);
  await coordinator.stop();
});

class FailingOnceStore extends MemoryChatConversationStore {
  failNextSave = false;

  override save(
    conversations: readonly StoredConversation[],
  ): Promise<void> {
    if (this.failNextSave) {
      this.failNextSave = false;
      return Promise.reject(new Error("disk is full"));
    }
    return super.save(conversations);
  }
}

Deno.test("one failed persist never bricks later persistence", async () => {
  const store = new FailingOnceStore();
  const pool = standalonePool({ probeTools: ["t_one"], store });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  store.failNextSave = true;
  const failed = await coordinator.command(send("r1", conversationId, "First"));
  assertEquals(failed.ok, false);
  const recovered = await coordinator.command(send("r2", conversationId, "Second"));
  assert(recovered.ok);
  await until(() => pool.standalone.turns.length === 1);
  pool.standalone.turns[0].finish({ status: "completed" });
  await until(() =>
    coordinator.snapshot(conversationId).conversations[0].status === "idle"
  );
  const stored = await store.load();
  assertEquals(
    stored[0].messages.filter((message) => message.role === "user").map((message) =>
      message.text
    ),
    ["First", "Second"],
  );
  await coordinator.stop();
});

Deno.test("reopened work serves saved bytes with zero solver calls", async () => {
  const backend = new FakeViewerBackend();
  const store = new MemoryChatConversationStore();
  const sha256 = await sha256OfText("step");
  const uri = `casys://build123d/artifacts/${sha256}.step`;
  const coordinator = await standalonePool({ store }).coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  // Bytes first, then the referencing manifest: the store prunes anything
  // unreferenced on save, so the order is the honest lifecycle.
  await store.saveArtifact(sha256, new TextEncoder().encode("step"));
  await store.save([{
    id: conversationId,
    kind: "standalone",
    sessionKey: `casys-desktop-exclusive/standalone/${conversationId}/mcp/build123d`,
    title: "Standalone",
    status: "idle",
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
    messages: [],
    mcpId: "build123d",
    mcpStatus: "connected",
    mcpTools: ["t_one"],
    toolResults: [{
      toolCallId: "tool-call-1",
      server: "build123d",
      tool: "t_one",
      messageId: "message-1",
      appUri: VIEWER_APP_URI,
      failed: false,
      input: {},
      result: viewerToolResult(11),
      capturedAt: "2026-09-27T00:00:00.000Z",
      revision: 1,
      resultDigest: `sha256:${"cd".repeat(32)}`,
      artifacts: [{
        uri,
        fileName: `${sha256}.step`,
        mimeType: "model/step",
        bytes: 4,
        sha256,
        state: "saved",
      }],
    }],
  } as unknown as StoredConversation]);
  // A fresh coordinator over the same store is the restart: open the viewer
  // and read the export without any solver (tool-call) invocation.
  const revived = await standalonePool({
    probeTools: ["t_one"],
    viewerBackend: backend,
    store,
  })
    .coordinator();
  const opened = await revived.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "reopen-1",
    command: "viewer.open",
    conversationId,
    toolCallId: "tool-call-1",
  });
  assert(opened.ok);
  const read = await revived.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "reopen-read-1",
    command: "viewer.resource-read",
    conversationId,
    toolCallId: "tool-call-1",
    uri,
  });
  assert(read.ok);
  assertEquals(read.viewerResource?.source, "saved");
  assertEquals(backend.toolCalls.length, 0);
  assertEquals(backend.resourceCalls.length, 0);
  assertEquals(backend.appCalls.length, 1);
  await coordinator.stop();
  await revived.stop();
});

Deno.test("removed provider still allows exact archive and saved file read", async () => {
  const backend = new FakeViewerBackend();
  const store = new MemoryChatConversationStore();
  const pool = standalonePool({ probeTools: ["t_one"], viewerBackend: backend, store });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  const sha256 = await sha256OfText("step");
  const uri = `casys://build123d/artifacts/${sha256}.step`;
  await captureViewerResult(pool, coordinator, conversationId, [{
    toolCallId: "tool-call-removed-provider",
    tool: "t_one",
    result: viewerExportResult([{ uri, mimeType: "model/step", bytes: 4, sha256 }]),
  }]);
  await coordinator.stop();
  const revived = await coordinatorWith(new FakeRuntimeAdapter(), {
    store,
    mcpServers: [],
    viewerBackend: backend,
  });
  const viewer = revived.snapshot(conversationId).conversations[0].viewers[0];
  assert(viewer !== undefined);
  const beforeReads = backend.resourceCalls.length;
  const archive = await revived.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "archive-without-provider",
    command: "viewer.archive-read",
    conversationId,
    viewerId: viewer.viewerId,
  });
  assert(archive.ok);
  assertEquals(archive.viewerCapture?.toolInput, {});
  const file = await revived.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "file-without-provider",
    command: "viewer.resource-read",
    conversationId,
    toolCallId: viewer.viewerId,
    uri,
  });
  assert(file.ok);
  assertEquals(file.viewerResource?.source, "saved");
  assertEquals(file.viewerResource?.data, "c3RlcA==");
  assertEquals(backend.resourceCalls.length, beforeReads);
  const live = await revived.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "app-without-provider",
    command: "viewer.open",
    conversationId,
    toolCallId: viewer.viewerId,
  });
  assertEquals(live.ok, false);
  await revived.stop();
});

Deno.test("resource-read falls back live when retained bytes are gone", async () => {
  const backend = new FakeViewerBackend();
  const store = new MemoryChatConversationStore();
  const pool = standalonePool({
    probeTools: ["t_one"],
    viewerBackend: backend,
    store,
  });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  const sha256 = await sha256OfText("step");
  const uri = `casys://build123d/artifacts/${sha256}.step`;
  await store.save([{
    id: conversationId,
    kind: "standalone",
    sessionKey: `casys-desktop-exclusive/standalone/${conversationId}/mcp/build123d`,
    title: "Standalone",
    status: "idle",
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
    messages: [],
    mcpId: "build123d",
    mcpStatus: "connected",
    mcpTools: ["t_one"],
    toolResults: [{
      toolCallId: "tool-call-1",
      server: "build123d",
      tool: "t_one",
      messageId: "message-1",
      appUri: VIEWER_APP_URI,
      failed: false,
      input: {},
      result: viewerToolResult(11),
      capturedAt: "2026-09-27T00:00:00.000Z",
      revision: 1,
      resultDigest: `sha256:${"cd".repeat(32)}`,
      artifacts: [{
        uri,
        fileName: `${sha256}.step`,
        mimeType: "model/step",
        bytes: 4,
        sha256,
        state: "saved",
      }],
    }],
  } as unknown as StoredConversation]);
  const revived = await standalonePool({
    probeTools: ["t_one"],
    viewerBackend: backend,
    store,
  })
    .coordinator();
  const read = await revived.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "read-stale",
    command: "viewer.resource-read",
    conversationId,
    toolCallId: "tool-call-1",
    uri,
  });
  assert(read.ok);
  assertEquals(read.viewerResource?.source, "live");
  assertEquals(backend.resourceCalls.length, 1);
  const snapshot = revived.snapshot(conversationId);
  assertEquals(
    snapshot.conversations[0].viewers[0]?.archive?.artifacts[0]?.state,
    "missing",
  );
  await coordinator.stop();
  await revived.stop();
});

Deno.test("resource-read refuses live bytes that fail the version digest", async () => {
  const backend = new FakeViewerBackend();
  const store = new MemoryChatConversationStore();
  const pool = standalonePool({
    probeTools: ["t_one"],
    viewerBackend: backend,
    store,
  });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  const sha256 = await sha256OfText("step");
  const uri = `casys://build123d/artifacts/${sha256}.step`;
  await store.save([{
    id: conversationId,
    kind: "standalone",
    sessionKey: `casys-desktop-exclusive/standalone/${conversationId}/mcp/build123d`,
    title: "Standalone",
    status: "idle",
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
    messages: [],
    mcpId: "build123d",
    mcpStatus: "connected",
    mcpTools: ["t_one"],
    toolResults: [{
      toolCallId: "tool-call-1",
      server: "build123d",
      tool: "t_one",
      messageId: "message-1",
      appUri: VIEWER_APP_URI,
      failed: false,
      input: {},
      result: viewerToolResult(11),
      capturedAt: "2026-09-27T00:00:00.000Z",
      revision: 1,
      resultDigest: `sha256:${"cd".repeat(32)}`,
      artifacts: [{
        uri,
        fileName: `${sha256}.step`,
        mimeType: "model/step",
        bytes: 4,
        sha256,
        state: "saved",
      }],
    }],
  } as unknown as StoredConversation]);
  // The sidecar is gone and the provider now serves different bytes under
  // the original URI: the version identity must refuse them.
  backend.readResource = (server: string, resourceUri: string) => {
    backend.resourceCalls.push({ server, uri: resourceUri });
    return Promise.resolve({
      contents: [{ uri: resourceUri, mimeType: "model/step", blob: "ZXZpbA==" }],
    });
  };
  const revived = await standalonePool({
    probeTools: ["t_one"],
    viewerBackend: backend,
    store,
  }).coordinator();
  const read = await revived.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "read-diverged",
    command: "viewer.resource-read",
    conversationId,
    toolCallId: "tool-call-1",
    uri,
  });
  assertEquals(read.ok, false, "diverged live bytes were served as the version");
  assertMatch(read.error ?? "", /digest check/);
  await coordinator.stop();
  await revived.stop();
});

Deno.test("resource-read refuses live bytes that changed size on the version", async () => {
  const backend = new FakeViewerBackend();
  const store = new MemoryChatConversationStore();
  const pool = standalonePool({
    probeTools: ["t_one"],
    viewerBackend: backend,
    store,
  });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  const sha256 = await sha256OfText("step");
  const uri = `casys://build123d/artifacts/${sha256}.step`;
  await store.save([{
    id: conversationId,
    kind: "standalone",
    sessionKey: `casys-desktop-exclusive/standalone/${conversationId}/mcp/build123d`,
    title: "Standalone",
    status: "idle",
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
    messages: [],
    mcpId: "build123d",
    mcpStatus: "connected",
    mcpTools: ["t_one"],
    toolResults: [{
      toolCallId: "tool-call-1",
      server: "build123d",
      tool: "t_one",
      messageId: "message-1",
      appUri: VIEWER_APP_URI,
      failed: false,
      input: {},
      result: viewerToolResult(11),
      capturedAt: "2026-09-27T00:00:00.000Z",
      revision: 1,
      resultDigest: `sha256:${"cd".repeat(32)}`,
      artifacts: [{
        uri,
        fileName: `${sha256}.step`,
        mimeType: "model/step",
        bytes: 4,
        sha256,
        state: "saved",
      }],
    }],
  } as unknown as StoredConversation]);
  backend.readResource = (server: string, resourceUri: string) => {
    backend.resourceCalls.push({ server, uri: resourceUri });
    return Promise.resolve({
      contents: [{
        uri: resourceUri,
        mimeType: "model/step",
        blob: "ZXZpbC1sb25nZXI=",
      }],
    });
  };
  const revived = await standalonePool({
    probeTools: ["t_one"],
    viewerBackend: backend,
    store,
  }).coordinator();
  const read = await revived.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "read-resized",
    command: "viewer.resource-read",
    conversationId,
    toolCallId: "tool-call-1",
    uri,
  });
  assertEquals(read.ok, false, "resized live bytes were served as the version");
  assertMatch(read.error ?? "", /changed size/);
  await coordinator.stop();
  await revived.stop();
});

Deno.test("revisions increment across captures and survive restore", async () => {
  const backend = new FakeViewerBackend();
  const store = new MemoryChatConversationStore();
  const pool = standalonePool({
    probeTools: ["t_one"],
    viewerBackend: backend,
    store,
  });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  await captureViewerResult(pool, coordinator, conversationId, [
    { toolCallId: "tool-call-1", tool: "t_one" },
    { toolCallId: "tool-call-2", tool: "t_one" },
  ]);
  assertEquals(
    coordinator.snapshot(conversationId).conversations[0].viewers.map((viewer) =>
      viewer.archive?.revision
    ),
    [1, 2],
  );
  const revived = await standalonePool({ store }).coordinator();
  assertEquals(
    revived.snapshot(conversationId).conversations[0].viewers.map((viewer) =>
      viewer.archive?.revision
    ),
    [1, 2],
  );
  await coordinator.stop();
  await revived.stop();
});

class BoundedMemoryStore extends MemoryChatConversationStore {
  override retention(): { days: number; maxConversations: number } {
    return { days: 30, maxConversations: 50 };
  }
}

Deno.test("the 21st capture retires v1 with a transcript notice", async () => {
  const backend = new FakeViewerBackend();
  const store = new BoundedMemoryStore();
  const pool = standalonePool({
    probeTools: ["t_one"],
    viewerBackend: backend,
    store,
  });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  backend.readResource = (server: string, uri: string) => {
    backend.resourceCalls.push({ server, uri });
    const text = (uri.split("/").pop() ?? "").replace(/\.step$/, "");
    return Promise.resolve({
      contents: [{ uri, mimeType: "model/step", blob: btoa(text) }],
    });
  };
  const calls = [];
  const shas: string[] = [];
  for (let index = 0; index < 21; index += 1) {
    const text = `payload-${index}`;
    const sha = await sha256OfText(text);
    shas.push(sha);
    calls.push({
      toolCallId: `tool-call-${index + 1}`,
      tool: "t_one",
      result: viewerExportResult([{
        uri: `casys://build123d/artifacts/${text}.step`,
        mimeType: "model/step",
        bytes: text.length,
        sha256: sha,
      }]),
    });
  }
  await captureViewerResult(pool, coordinator, conversationId, calls);
  const snapshot = coordinator.snapshot(conversationId);
  const viewers = snapshot.conversations[0].viewers;
  assertEquals(viewers.length, 20);
  assertEquals(viewers[0]?.archive?.revision, 2);
  assertEquals(viewers[19]?.archive?.revision, 21);
  assertEquals(
    snapshot.conversations[0].messages.some((message) =>
      message.role === "system" && message.kind === "status" &&
      message.text.includes("Retired v1:") &&
      message.text.includes("keeps the last 20 tool versions")
    ),
    true,
    "evicted v1 was retired without a transcript notice",
  );
  assertEquals(
    snapshot.retention,
    { days: 30, maxConversations: 50, maxVersions: 20 },
  );
  assertEquals(await store.loadArtifact(shas[0]), undefined);
  assertEquals(
    await store.loadArtifact(shas[20]),
    new TextEncoder().encode("payload-20"),
  );
  parseChatSnapshotDto(snapshot);
  await coordinator.stop();
});

Deno.test("tampered archive manifest degrades to unsaved without dropping the viewer", async () => {
  const store = new MemoryChatConversationStore();
  const coordinator = await standalonePool({ store }).coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await store.save([{
    id: conversationId,
    kind: "standalone",
    sessionKey: `casys-desktop-exclusive/standalone/${conversationId}/mcp/build123d`,
    title: "Standalone",
    status: "idle",
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
    messages: [],
    mcpId: "build123d",
    mcpStatus: "connected",
    mcpTools: ["t_one"],
    toolResults: [{
      toolCallId: "tool-call-1",
      server: "build123d",
      tool: "t_one",
      messageId: "message-1",
      appUri: VIEWER_APP_URI,
      failed: false,
      input: {},
      result: viewerToolResult(11),
      capturedAt: "2026-09-27T00:00:00.000Z",
      revision: 1,
      resultDigest: `sha256:${"cd".repeat(32)}`,
      artifacts: [{
        uri: "casys://build123d/artifacts/x.step",
        fileName: "../escape.step",
        mimeType: "model/step",
        bytes: 4,
        sha256: "ab".repeat(32),
        state: "saved",
      }],
    }],
  } as unknown as StoredConversation]);
  const revived = await standalonePool({ store }).coordinator();
  const snapshot = revived.snapshot(conversationId);
  assertEquals(snapshot.conversations[0].viewers.length, 1);
  assertEquals(
    snapshot.conversations[0].viewers[0]?.archive,
    undefined,
  );
  parseChatSnapshotDto(snapshot);
  await coordinator.stop();
  await revived.stop();
});

Deno.test("viewer resource-read refuses oversized provider media types", async () => {
  const backend = new HugeMimeViewerBackend();
  const pool = standalonePool({ probeTools: ["t_one"], viewerBackend: backend });
  const coordinator = await pool.coordinator();
  const conversationId = await createStandaloneConversation(coordinator);
  await enableTestMcp(coordinator, conversationId);
  await captureViewerResult(pool, coordinator, conversationId, [
    { toolCallId: "tool-call-1", tool: "t_one" },
  ]);
  const read = await coordinator.command({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "read-1",
    command: "viewer.resource-read",
    conversationId,
    toolCallId: "tool-call-1",
    uri: "ui://mcp-build123d/exports/box.step",
  });
  assertEquals(read.ok, false);
  await coordinator.stop();
});
