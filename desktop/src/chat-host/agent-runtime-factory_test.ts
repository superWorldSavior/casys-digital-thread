import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { join } from "node:path";
import {
  CODEX_AGENT_PROFILE_ID,
  MUSE_AGENT_PROFILE_ID,
} from "../chat/agent-profiles.ts";
import type { ChatRuntimeAdapter } from "../chat/runtime-port.ts";
import type { PinnedRuntimeOptions } from "./runtime-adapter.ts";
import {
  AgentRuntimeFactory,
  type AgentRuntimeFactoryOptions,
} from "./agent-runtime-factory.ts";

function fakeAdapter(tag: string): ChatRuntimeAdapter {
  return {
    tag,
    runtime: undefined,
    setInteractionSink(): void {},
    close: () => Promise.resolve(),
  } as unknown as ChatRuntimeAdapter;
}

function stubMuseDeps(path?: string, version?: string) {
  return {
    isExecutable: (candidate: string) => Promise.resolve(candidate === path),
    readVersion: () => Promise.resolve(version),
    pathSeparator: ":",
  };
}

async function testFactory(options: {
  dataRoot: string;
  appEnv?: Record<string, string | undefined>;
  musePath?: string;
  museVersion?: string;
  relayUrls?: Record<string, string>;
  codexVersion?: string;
  codexMissingReason?: string;
}): Promise<{
  factory: AgentRuntimeFactory;
  profilesError?: string;
  created: PinnedRuntimeOptions[];
}> {
  const created: PinnedRuntimeOptions[] = [];
  const factoryOptions: AgentRuntimeFactoryOptions = {
    dataRoot: options.dataRoot,
    workspaceRoot: join(options.dataRoot, "workspace"),
    runtimeRoot: "/runtime",
    nodeExecutable: "/runtime/node",
    acpxRuntimeUrl: "file:///runtime/acpx/dist/runtime.js",
    codexVersion: options.codexVersion ?? "0.144.6",
    ...(options.codexMissingReason === undefined
      ? {}
      : { codexMissingReason: options.codexMissingReason }),
    projectRelayUrl: "http://127.0.0.1:3020/mcp",
    appEnv: { HOME: "/home/u", ...(options.appEnv ?? {}) },
    mcpDisplayName: (mcpId: string) => `Display ${mcpId}`,
    relayUrl: (mcpId: string) => options.relayUrls?.[mcpId],
    createAdapter: (input: PinnedRuntimeOptions) => {
      created.push(input);
      return Promise.resolve(fakeAdapter(`adapter-${created.length}`));
    },
    museDeps: stubMuseDeps(options.musePath, options.museVersion),
  };
  const { factory, profilesError } = await AgentRuntimeFactory.create(factoryOptions);
  return { factory, profilesError, created };
}

async function tempRoot(): Promise<string> {
  return await Deno.makeTempDir({ prefix: "casys-agent-factory-" });
}

Deno.test("factory starts on built-ins with muse default and resolved host", async () => {
  const dataRoot = await tempRoot();
  try {
    const { factory, profilesError } = await testFactory({
      dataRoot,
      appEnv: { MUSE_CODE_EXECUTABLE: "/muse/bin" },
      musePath: "/muse/bin",
      museVersion: "1.4.0",
    });
    assertEquals(profilesError, undefined);
    assertEquals(factory.definitions.map((entry) => entry.id), [
      MUSE_AGENT_PROFILE_ID,
      CODEX_AGENT_PROFILE_ID,
    ]);
    assertEquals(factory.defaultProfileId(), MUSE_AGENT_PROFILE_ID);
    const muse = factory.statusOf(MUSE_AGENT_PROFILE_ID);
    assertEquals(muse.available, true);
    assertEquals(muse.version, "1.4.0");
    assertEquals(factory.museExecutablePath(), "/muse/bin");
    const codex = factory.statusOf(CODEX_AGENT_PROFILE_ID);
    assertEquals(codex.available, true);
    assertEquals(codex.version, "0.144.6");
  } finally {
    await Deno.remove(dataRoot, { recursive: true });
  }
});

Deno.test("missing optional Codex disables only Codex", async () => {
  const dataRoot = await tempRoot();
  try {
    const { factory } = await testFactory({
      dataRoot,
      codexMissingReason: "Optional Codex executable is missing",
      appEnv: { MUSE_CODE_EXECUTABLE: "/muse/bin" },
      musePath: "/muse/bin",
      museVersion: "1.4.0",
    });
    assertEquals(factory.statusOf(MUSE_AGENT_PROFILE_ID).available, true);
    const codex = factory.statusOf(CODEX_AGENT_PROFILE_ID);
    assertEquals(codex.available, false);
    assertEquals(codex.missingReason, "Optional Codex executable is missing");
    await assertRejects(
      () => factory.ensureRuntime(CODEX_AGENT_PROFILE_ID, "standalone"),
      Error,
      "Optional Codex executable is missing",
    );
    await factory.ensureRuntime(MUSE_AGENT_PROFILE_ID, "standalone");
  } finally {
    await Deno.remove(dataRoot, { recursive: true });
  }
});

Deno.test("factory reports a missing muse host explicitly", async () => {
  const dataRoot = await tempRoot();
  try {
    const { factory } = await testFactory({ dataRoot });
    const muse = factory.statusOf(MUSE_AGENT_PROFILE_ID);
    assertEquals(muse.available, false);
    assert((muse.missingReason ?? "").includes("No Muse executable found"));
    await assertRejects(
      () => factory.ensureRuntime(MUSE_AGENT_PROFILE_ID, "standalone"),
      Error,
      "No Muse executable found",
    );
  } finally {
    await Deno.remove(dataRoot, { recursive: true });
  }
});

Deno.test("factory caches one adapter per profiled key with profile wiring", async () => {
  const dataRoot = await tempRoot();
  try {
    const { factory, created } = await testFactory({
      dataRoot,
      appEnv: { MUSE_CODE_EXECUTABLE: "/muse/bin" },
      musePath: "/muse/bin",
      museVersion: "1.4.0",
    });
    const first = await factory.ensureRuntime(MUSE_AGENT_PROFILE_ID, "standalone");
    const second = await factory.ensureRuntime(MUSE_AGENT_PROFILE_ID, "standalone");
    assert(first === second);
    assertEquals(created.length, 1);
    assertEquals(created[0].agentName, "casys-muse");
    assertEquals(created[0].agentArgv, [
      "/runtime/node",
      "/runtime/adapter/node_modules/@bex-co/muse-code-acp/dist/index.js",
    ]);
    assertEquals(created[0].mcpServers, []);
    assertEquals(created[0].sessionStoreDir, "acpx-sessions-casys-muse-standalone");
  } finally {
    await Deno.remove(dataRoot, { recursive: true });
  }
});

Deno.test("factory wires codex with the bundled entry and no muse pin", async () => {
  const dataRoot = await tempRoot();
  try {
    const { factory, created } = await testFactory({ dataRoot });
    await factory.ensureRuntime(CODEX_AGENT_PROFILE_ID, "standalone");
    assertEquals(created[0].agentArgv, [
      "/runtime/node",
      "/runtime/adapter/node_modules/@agentclientprotocol/codex-acp/dist/index.js",
    ]);
  } finally {
    await Deno.remove(dataRoot, { recursive: true });
  }
});

Deno.test("factory attaches relay urls to mcp keys and refuses unattached", async () => {
  const dataRoot = await tempRoot();
  try {
    const { factory, created } = await testFactory({ dataRoot });
    await assertRejects(
      () => factory.ensureRuntime(CODEX_AGENT_PROFILE_ID, "standalone+mcp:build123d"),
      Error,
      'MCP "build123d" is not attached.',
    );
    const { factory: attached, created: attachedCreated } = await testFactory({
      dataRoot,
      relayUrls: { build123d: "http://127.0.0.1:9/mcp" },
    });
    await attached.ensureRuntime(CODEX_AGENT_PROFILE_ID, "standalone+mcp:build123d");
    assertEquals(attachedCreated[0].mcpServers, [{
      name: "Display build123d",
      url: "http://127.0.0.1:9/mcp",
    }]);
    assertEquals(
      attachedCreated[0].sessionStoreDir,
      "acpx-sessions-standalone-build123d",
    );
    assertEquals(created.length, 0);
  } finally {
    await Deno.remove(dataRoot, { recursive: true });
  }
});

Deno.test("factory keeps legacy store names and wires the project server", async () => {
  const dataRoot = await tempRoot();
  try {
    const { factory, created } = await testFactory({
      dataRoot,
      appEnv: { MUSE_CODE_EXECUTABLE: "/muse/bin" },
      musePath: "/muse/bin",
      museVersion: "1.4.0",
      relayUrls: { build123d: "http://127.0.0.1:9/mcp" },
    });
    await factory.ensureRuntime(CODEX_AGENT_PROFILE_ID, "project");
    await factory.ensureRuntime(CODEX_AGENT_PROFILE_ID, "standalone");
    await factory.ensureRuntime(MUSE_AGENT_PROFILE_ID, "project");
    assertEquals(created[0].sessionStoreDir, "acpx-sessions");
    assertEquals(created[0].mcpServers, [{
      name: "casys-digital-thread",
      url: "http://127.0.0.1:3020/mcp",
    }]);
    assertEquals(created[1].sessionStoreDir, "acpx-sessions-standalone");
    assertEquals(created[2].sessionStoreDir, "acpx-sessions-casys-muse-project");
    assertEquals(created[2].mcpServers, [{
      name: "casys-digital-thread",
      url: "http://127.0.0.1:3020/mcp",
    }]);
  } finally {
    await Deno.remove(dataRoot, { recursive: true });
  }
});

Deno.test("factory releases every profiled standalone adapter", async () => {
  const dataRoot = await tempRoot();
  try {
    const { factory } = await testFactory({
      dataRoot,
      appEnv: { MUSE_CODE_EXECUTABLE: "/muse/bin" },
      musePath: "/muse/bin",
      museVersion: "1.4.0",
      relayUrls: { build123d: "http://127.0.0.1:9/mcp" },
    });
    const codex = await factory.ensureRuntime(
      CODEX_AGENT_PROFILE_ID,
      "standalone+mcp:build123d",
    );
    const muse = await factory.ensureRuntime(
      MUSE_AGENT_PROFILE_ID,
      "standalone+mcp:build123d",
    );
    let closed = 0;
    for (const adapter of [codex, muse]) {
      const close = adapter.close.bind(adapter);
      adapter.close = () => {
        closed++;
        return close();
      };
    }
    const released = await factory.releaseStandalone("build123d");
    assertEquals(released, [
      `standalone+mcp:build123d@${MUSE_AGENT_PROFILE_ID}`,
      "standalone+mcp:build123d",
    ]);
    assertEquals(closed, 2);
    assertEquals(await factory.releaseStandalone("build123d"), []);
    assertEquals(closed, 2);
  } finally {
    await Deno.remove(dataRoot, { recursive: true });
  }
});

Deno.test("factory rejects unknown profiles and malformed keys", async () => {
  const dataRoot = await tempRoot();
  try {
    const { factory } = await testFactory({ dataRoot });
    await assertRejects(
      () => factory.ensureRuntime("nope", "standalone"),
      Error,
      "agent profile is unknown",
    );
    await assertRejects(
      () => factory.ensureRuntime(CODEX_AGENT_PROFILE_ID, "standalone+mcp:"),
      Error,
      "runtime key is invalid",
    );
  } finally {
    await Deno.remove(dataRoot, { recursive: true });
  }
});

Deno.test("factory loads customs and checks their entries", async () => {
  const dataRoot = await tempRoot();
  try {
    const entry = join(dataRoot, "lab-acp.mjs");
    await Deno.writeTextFile(entry, "export {};\n");
    await Deno.writeTextFile(
      join(dataRoot, "agent-profiles.json"),
      JSON.stringify({
        defaultProfileId: "lab",
        profiles: [
          {
            id: "lab",
            displayName: "Lab",
            agentName: "lab",
            launch: { kind: "node-entry", entry },
            authRecovery: "Sign in, then retry.",
            modelsExposed: false,
          },
          {
            id: "gone",
            displayName: "Gone",
            agentName: "gone",
            launch: { kind: "command", path: "/nonexistent/acp", args: [] },
            authRecovery: "Sign in, then retry.",
            modelsExposed: false,
          },
        ],
      }),
    );
    const { factory, profilesError } = await testFactory({ dataRoot });
    assertEquals(profilesError, undefined);
    assertEquals(factory.defaultProfileId(), "lab");
    assertEquals(factory.statusOf("lab").available, true);
    const gone = factory.statusOf("gone");
    assertEquals(gone.available, false);
    assert((gone.missingReason ?? "").includes("does not exist"));
    const { created } = await testFactory({ dataRoot }).then(async (second) => {
      await second.factory.ensureRuntime("lab", "standalone");
      return second;
    });
    assertEquals(created[0].agentArgv, ["/runtime/node", entry]);
    assertEquals(created[0].agentName, "lab");
  } finally {
    await Deno.remove(dataRoot, { recursive: true });
  }
});

Deno.test("factory keeps built-ins on an invalid profiles file", async () => {
  const dataRoot = await tempRoot();
  try {
    await Deno.writeTextFile(join(dataRoot, "agent-profiles.json"), "{nope");
    const { factory, profilesError } = await testFactory({ dataRoot });
    assert((profilesError ?? "").includes("not valid JSON"));
    assertEquals(factory.definitions.length, 2);
    assertEquals(factory.defaultProfileId(), MUSE_AGENT_PROFILE_ID);
  } finally {
    await Deno.remove(dataRoot, { recursive: true });
  }
});

Deno.test("factory persists the default and reloads the file", async () => {
  const dataRoot = await tempRoot();
  try {
    const { factory } = await testFactory({ dataRoot });
    await assertRejects(
      () => factory.saveDefault("nope"),
      Error,
      "agent profile is unknown",
    );
    await factory.saveDefault(CODEX_AGENT_PROFILE_ID);
    assertEquals(factory.defaultProfileId(), CODEX_AGENT_PROFILE_ID);
    const entry = join(dataRoot, "lab-acp.mjs");
    await Deno.writeTextFile(entry, "export {};\n");
    await Deno.writeTextFile(
      join(dataRoot, "agent-profiles.json"),
      JSON.stringify({
        defaultProfileId: "lab",
        profiles: [{
          id: "lab",
          displayName: "Lab",
          agentName: "lab",
          launch: { kind: "node-entry", entry },
          authRecovery: "Sign in, then retry.",
          modelsExposed: false,
        }],
      }),
    );
    const reloaded = await factory.reload();
    assertEquals(reloaded, { ok: true, invalidatedRuntimeKeys: [] });
    assertEquals(factory.defaultProfileId(), "lab");
    await factory.ensureRuntime("lab", "standalone");
    await Deno.writeTextFile(join(dataRoot, "agent-profiles.json"), "{nope");
    const failed = await factory.reload();
    assertEquals(failed.ok, false);
    assertEquals(factory.defaultProfileId(), "lab");
  } finally {
    await Deno.remove(dataRoot, { recursive: true });
  }
});

Deno.test("reload invalidates a changed custom command before the next runtime", async () => {
  const dataRoot = await tempRoot();
  try {
    const oldEntry = join(dataRoot, "old.mjs");
    const newEntry = join(dataRoot, "new.mjs");
    await Deno.writeTextFile(oldEntry, "export {};\n");
    await Deno.writeTextFile(newEntry, "export {};\n");
    const file = join(dataRoot, "agent-profiles.json");
    const custom = (entry: string) => ({
      id: "lab",
      displayName: "Lab",
      agentName: "lab",
      launch: { kind: "node-entry", entry },
      authRecovery: "Sign in, then retry.",
      modelsExposed: false,
    });
    await Deno.writeTextFile(file, JSON.stringify({ profiles: [custom(oldEntry)] }));
    const { factory, created } = await testFactory({ dataRoot });
    const oldAdapter = await factory.ensureRuntime("lab", "standalone");
    let closed = false;
    oldAdapter.close = () => {
      closed = true;
      return Promise.resolve();
    };
    await Deno.writeTextFile(file, JSON.stringify({ profiles: [custom(newEntry)] }));
    assertEquals(await factory.reload(), {
      ok: true,
      invalidatedRuntimeKeys: ["standalone@lab"],
    });
    assertEquals(closed, false, "coordinator still owns the old adapter");
    await factory.ensureRuntime("lab", "standalone");
    assertEquals(created.map((entry) => entry.agentArgv[1]), [oldEntry, newEntry]);
  } finally {
    await Deno.remove(dataRoot, { recursive: true });
  }
});

Deno.test("failed default persistence leaves the effective default unchanged", async () => {
  const nonDirectory = await Deno.makeTempFile({ prefix: "casys-agent-default-" });
  try {
    const { factory } = await testFactory({ dataRoot: nonDirectory });
    assertEquals(factory.defaultProfileId(), MUSE_AGENT_PROFILE_ID);
    await assertRejects(() => factory.saveDefault(CODEX_AGENT_PROFILE_ID));
    assertEquals(factory.defaultProfileId(), MUSE_AGENT_PROFILE_ID);
  } finally {
    await Deno.remove(nonDirectory);
  }
});
