import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "jsr:@std/assert@1.0.14";
import {
  DESKTOP_CATALOGUE_PROTOCOL,
  parseCatalogueSnapshotDto,
} from "../../../src/presentation/desktop/catalogue/contracts.ts";
import type { ChatMcpServerConfig } from "../chat/runtime-port.ts";
import type { ToolRuntimeEngineObservation } from "../tool-runtime/engine.ts";
import type {
  ToolRuntimeMutationOutcome,
  ToolRuntimeToolStatus,
} from "../tool-runtime/backend.ts";
import type {
  LifecycleEnsureOutcome,
  LifecycleToolState,
} from "../tool-runtime/lifecycle.ts";
import type { PreparationOutcome } from "../tool-runtime/preparation.ts";
import {
  type CatalogueBackend,
  CatalogueService,
  loadCatalogueEntries,
} from "./service.ts";

const FLEET_SERVER: ChatMcpServerConfig = {
  id: "build123d",
  displayName: "Build123d",
  description: "Parametric CAD execution",
  transport: "streamable-http",
  mcpUrl: "http://127.0.0.1:3014/mcp",
  healthUrl: "http://127.0.0.1:3014/health",
  expectedTools: ["build123d_execute"],
  expectedViews: ["ui://mcp-build123d/results-viewer"],
};

function engine(
  status: ToolRuntimeEngineObservation["status"] = "ready",
): ToolRuntimeEngineObservation {
  return {
    status,
    detail: `Engine is ${status}.`,
    binaryPresent: true,
    daemonReachable: status === "ready",
    reasons: [],
  };
}

function tool(
  state: ToolRuntimeToolStatus["state"],
  detail = `Tool is ${state}.`,
): ToolRuntimeToolStatus {
  return {
    toolId: "build123d",
    displayName: "Build123d",
    state,
    detail,
    ownedContainers: state === "ready" ? 1 : 0,
    ownedVolumes: [],
  };
}

function backend(options: {
  status?: ToolRuntimeEngineObservation["status"];
  toolState?: ToolRuntimeToolStatus["state"];
  toolDetail?: string;
  tools?: readonly ToolRuntimeToolStatus[];
  prepare?: PreparationOutcome;
  prepareThrows?: unknown;
  statusThrows?: boolean;
  stop?: ToolRuntimeMutationOutcome;
  restart?: LifecycleEnsureOutcome;
  endpoint?: { readonly mcpUrl: string; readonly healthUrl: string };
  lifecycleState?: LifecycleToolState;
}): CatalogueBackend {
  return {
    status: () => {
      if (options.statusThrows) {
        return Promise.reject(new Error("docker is unreachable"));
      }
      return Promise.resolve({
        engine: engine(options.status),
        tools: options.tools ?? [
          tool(options.toolState ?? "never-prepared", options.toolDetail),
        ],
      });
    },
    prepare: (toolId) => {
      if (toolId !== "build123d") {
        return Promise.reject(new TypeError(`Unknown host tool "${toolId}".`));
      }
      if (options.prepareThrows !== undefined) {
        return Promise.reject(options.prepareThrows);
      }
      return Promise.resolve(
        options.prepare ?? { status: "ready", detail: "Prepared and running." },
      );
    },
    stop: () => Promise.resolve(options.stop ?? { status: "done", detail: "Stopped." }),
    restart: () =>
      Promise.resolve(
        options.restart ?? {
          status: "ready",
          binding: {
            schema: "desktop-tool-runtime-binding/1.0",
            toolId: "build123d",
            hostPort: 45678,
            mcpUrl: "http://127.0.0.1:45678/mcp",
            healthUrl: "http://127.0.0.1:45678/health",
            updatedAt: "2026-09-28T00:00:00.000Z",
          },
        },
      ),
    ...(options.endpoint === undefined
      ? {}
      : { resolveEndpoint: () => options.endpoint }),
    ...(options.lifecycleState === undefined
      ? {}
      : { lifecycleState: () => options.lifecycleState as LifecycleToolState }),
  };
}

function manifestEntry(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "build123d",
    displayName: "Build123d",
    tagline: "Parametric CAD execution, exact geometry metrics and export",
    description: "Run parametric CAD scripts and get exact measurements.",
    tools: [{
      name: "build123d_execute",
      summary: "Execute a script and return exact geometry metrics.",
      inputs: "A script assigning its final shape to `result`.",
      results: "Volume, area, center of mass, bounding box, counts.",
    }],
    examples: [{ title: "Measure a box", summary: "Box(10, 10, 10) reads 1,000 mm³." }],
    viewers: [{
      uri: "ui://mcp-build123d/results-viewer",
      label: "Geometry results",
      hostSupport: "planned",
    }],
    distribution: { version: "0.7.0", release: "v0.7.0", revision: "b831c160" },
    platforms: [{ id: "macOS/arm64", status: "measured", note: "Measured." }],
    guidance: "Use Prepare, then enable the tool in the chat.",
    ...overrides,
  };
}

function manifestWith(
  ...entries: ReadonlyArray<Record<string, unknown>>
): Record<string, unknown> {
  return { schemaVersion: "casys-mcp-catalogue/1.0", entries: [...entries] };
}

async function service(options: {
  manifest?: unknown;
  backend?: CatalogueBackend;
  capable?: boolean;
  defaults?: readonly string[];
  fleetServers?: readonly ChatMcpServerConfig[];
}): Promise<{ service: CatalogueService; defaultsPath: string }> {
  const directory = await Deno.makeTempDir({ prefix: "catalogue-test-" });
  const defaultsPath = `${directory}/catalogue-defaults.json`;
  if (options.defaults !== undefined) {
    await Deno.writeTextFile(
      defaultsPath,
      JSON.stringify({ ids: [...options.defaults] }),
    );
  }
  const capable = options.capable ?? true;
  return {
    defaultsPath,
    service: new CatalogueService({
      manifest: options.manifest ?? manifestWith(manifestEntry()),
      backend: options.backend ?? backend({}),
      fleetServers: options.fleetServers ?? [FLEET_SERVER],
      probe: () =>
        capable
          ? Promise.resolve({ ok: true as const, tools: ["build123d_execute"] })
          : Promise.resolve({ ok: false as const, error: "connection refused" }),
      defaultsPath,
      now: () => "2026-09-28T00:00:00.000Z",
    }),
  };
}

Deno.test("catalogue snapshot joins curated copy with live availability", async () => {
  const { service: catalogue } = await service({
    backend: backend({ toolState: "ready" }),
    defaults: ["build123d"],
  });
  const snapshot = await catalogue.snapshot();
  assertEquals(snapshot.protocol, DESKTOP_CATALOGUE_PROTOCOL);
  assertEquals(snapshot.entries.length, 1);
  const entry = snapshot.entries[0];
  assertEquals(entry.id, "build123d");
  assertEquals(entry.isDefault, true);
  assertEquals(entry.availability.prepared, true);
  assertEquals(entry.availability.running, true);
  assertEquals(entry.availability.capable, true);
  assertEquals(entry.availability.lastProbeAt, "2026-09-28T00:00:00.000Z");
  assertEquals(entry.availability.engine, "ready");
  parseCatalogueSnapshotDto(JSON.parse(JSON.stringify(snapshot)));
});

Deno.test("catalogue snapshot keeps listed/prepared/running/capable distinct", async () => {
  const { service: catalogue } = await service({
    backend: backend({ toolState: "never-prepared" }),
    capable: false,
  });
  const entry = (await catalogue.snapshot()).entries[0];
  assertEquals(entry.displayName, "Build123d");
  assertEquals(entry.availability.prepared, false);
  assertEquals(entry.availability.running, false);
  assertEquals(entry.availability.capable, false);
  assert(entry.availability.detail.includes("Not reachable"));
  const external = await service({
    backend: backend({
      toolState: "never-prepared",
      toolDetail: "This tool was never prepared on this machine.",
    }),
    capable: true,
  });
  assertEquals(
    (await external.service.snapshot()).entries[0].availability.detail,
    "This tool was never prepared on this machine. An external endpoint answers.",
  );
  const stopped = await service({
    backend: backend({
      toolState: "stopped",
      toolDetail: "Prepared but no owned container is running.",
    }),
    capable: true,
  });
  assertEquals(
    (await stopped.service.snapshot()).entries[0].availability.detail,
    "Prepared but no owned container is running. An external endpoint answers.",
  );
});

Deno.test("catalogue availability reports the demand-aware runtime state", async () => {
  const idle = await service({
    backend: backend({ toolState: "ready", lifecycleState: "idle" }),
  });
  assertEquals((await idle.service.snapshot()).entries[0].availability.runtime, "idle");
  const busy = await service({
    backend: backend({ toolState: "ready", lifecycleState: "running" }),
  });
  assertEquals(
    (await busy.service.snapshot()).entries[0].availability.runtime,
    "running",
  );
  const failed = await service({
    backend: backend({ toolState: "needs-action", lifecycleState: "stopped" }),
  });
  assertEquals(
    (await failed.service.snapshot()).entries[0].availability.runtime,
    "error",
  );
  const plain = await service({ backend: backend({ toolState: "ready" }) });
  assertEquals(
    (await plain.service.snapshot()).entries[0].availability.runtime,
    "running",
  );
  const missing = await service({ backend: backend({ tools: [] }) });
  assertEquals(
    (await missing.service.snapshot()).entries[0].availability.runtime,
    "unknown",
  );
});

Deno.test("catalogue probe follows the assigned runtime endpoint", async () => {
  const directory = await Deno.makeTempDir({ prefix: "catalogue-test-" });
  const probed: ChatMcpServerConfig[] = [];
  const catalogue = new CatalogueService({
    manifest: manifestWith(manifestEntry()),
    backend: backend({
      toolState: "ready",
      endpoint: {
        mcpUrl: "http://127.0.0.1:45678/mcp",
        healthUrl: "http://127.0.0.1:45678/health",
      },
    }),
    fleetServers: [FLEET_SERVER],
    probe: (server) => {
      probed.push(server);
      return Promise.resolve({ ok: true as const, tools: ["build123d_execute"] });
    },
    defaultsPath: `${directory}/catalogue-defaults.json`,
  });
  await catalogue.snapshot();
  assertEquals(probed.length, 1);
  assertEquals(probed[0].mcpUrl, "http://127.0.0.1:45678/mcp");
  assertEquals(probed[0].healthUrl, "http://127.0.0.1:45678/health");
});

Deno.test("catalogue availability detail scrubs runtime identity", async () => {
  const { service: catalogue } = await service({
    backend: backend({
      toolState: "needs-action",
      toolDetail:
        "Could not stop owned container 0272a50fad75: dial 127.0.0.1:45678 refused.",
    }),
  });
  const detail = (await catalogue.snapshot()).entries[0].availability.detail;
  assert(!detail.includes("0272a50fad75"), `id leaked: ${detail}`);
  assert(!detail.includes("45678"), `port leaked: ${detail}`);
});

Deno.test("catalogue runtime stop and restart surface explicit outcomes", async () => {
  const { service: catalogue } = await service({
    backend: backend({
      stop: { status: "done", detail: "Stopped 1 owned container(s)." },
    }),
  });
  const stopped = await catalogue.command({
    protocol: DESKTOP_CATALOGUE_PROTOCOL,
    requestId: "stop-1",
    command: "catalogue.runtime.stop",
    entryId: "build123d",
  });
  assertEquals(stopped.ok, true);
  assertEquals(stopped.detail, "Stopped 1 owned container(s).");
  const restarted = await catalogue.command({
    protocol: DESKTOP_CATALOGUE_PROTOCOL,
    requestId: "restart-1",
    command: "catalogue.runtime.restart",
    entryId: "build123d",
  });
  assertEquals(restarted.ok, true);
  assertEquals(restarted.detail, "Provider restarted and ready.");
  const { service: busy } = await service({
    backend: backend({
      stop: {
        status: "needs-action",
        code: "in-use",
        detail: "2 chat session(s) are using this provider.",
        recovery: "Detach it from every chat first, then stop it.",
      },
    }),
  });
  const refused = await busy.command({
    protocol: DESKTOP_CATALOGUE_PROTOCOL,
    requestId: "stop-2",
    command: "catalogue.runtime.stop",
    entryId: "build123d",
  });
  assertEquals(refused.ok, true);
  assertEquals(refused.detail, "2 chat session(s) are using this provider.");
  assertEquals(refused.recovery, "Detach it from every chat first, then stop it.");
});

Deno.test("catalogue snapshot degrades instead of throwing", async () => {
  const { service: catalogue } = await service({
    backend: backend({ statusThrows: true }),
    capable: false,
  });
  const snapshot = await catalogue.snapshot();
  const entry = snapshot.entries[0];
  assertEquals(entry.availability.prepared, false);
  assertEquals(entry.availability.capable, false);
  assertEquals(entry.availability.engine, "unknown");
  assertEquals(
    entry.availability.detail,
    "Host runtime status is unavailable; flags stay conservative.",
  );
  parseCatalogueSnapshotDto(JSON.parse(JSON.stringify(snapshot)));
});

Deno.test("catalogue snapshot marks entries without backend support", async () => {
  const spice = manifestEntry({
    id: "spice",
    displayName: "SPICE",
    viewers: [],
  });
  const { service: catalogue } = await service({
    manifest: manifestWith(manifestEntry(), spice),
    backend: backend({ toolState: "ready" }),
    fleetServers: [FLEET_SERVER, { ...FLEET_SERVER, id: "spice" }],
  });
  const entries = (await catalogue.snapshot()).entries;
  const unplanned = entries.find((entry) => entry.id === "spice");
  assertEquals(unplanned?.availability.prepared, false);
  assertEquals(
    unplanned?.availability.detail,
    "Host preparation is not implemented for this tool.",
  );
});

Deno.test("catalogue prepare maps outcomes and scrubs digests", async () => {
  const digest = `sha256:${"ab".repeat(32)}`;
  const { service: catalogue } = await service({
    backend: backend({
      prepare: {
        status: "needs-action",
        code: "engine-stopped",
        detail: `Could not pull image ${digest}.`,
        recovery: `Inspect ${digest} explicitly, then retry.`,
      },
    }),
  });
  const outcome = await catalogue.prepare("build123d");
  assertEquals(outcome.outcome, "needs-action");
  assertEquals(outcome.detail, "Could not pull image sha256:<digest>.");
  assertEquals(outcome.recovery, "Inspect sha256:<digest> explicitly, then retry.");
  const ready = await service({});
  assertEquals((await ready.service.prepare("build123d")).outcome, "prepared");
  await assertRejects(
    () => catalogue.prepare("no-such-tool"),
    Error,
    "Unknown catalogue entry.",
  );
  const leakyDigest = `sha256:${"cd".repeat(32)}`;
  const { service: failing } = await service({
    backend: backend({
      prepareThrows: new Error(`docker failed at /private/host/path: ${leakyDigest}`),
    }),
  });
  const thrown = await failing.prepare("build123d").then(
    () => undefined,
    (error: unknown) => error,
  );
  assert(thrown instanceof Error);
  assertEquals(thrown.message, "Host preparation failed before reporting an outcome.");
});

Deno.test("catalogue setDefaults maps filesystem failures to a curated error", async () => {
  const directory = await Deno.makeTempDir({ prefix: "catalogue-test-" });
  const blocker = `${directory}/blocker`;
  await Deno.writeTextFile(blocker, "not a directory");
  const failing = new CatalogueService({
    manifest: manifestWith(manifestEntry()),
    backend: backend({}),
    fleetServers: [FLEET_SERVER],
    probe: () => Promise.resolve({ ok: true as const, tools: ["build123d_execute"] }),
    defaultsPath: `${blocker}/nested/catalogue-defaults.json`,
    now: () => "2026-09-28T00:00:00.000Z",
  });
  const thrown = await failing.setDefaults(["build123d"]).then(
    () => undefined,
    (error: unknown) => error,
  );
  assert(thrown instanceof Error);
  assertEquals(thrown.message, "Catalogue defaults could not be saved.");
  assertEquals(thrown.message.includes(blocker), false);
});

Deno.test("catalogue prepare refuses entries without backend support", async () => {
  const spice = manifestEntry({ id: "spice", displayName: "SPICE", viewers: [] });
  const directory = await Deno.makeTempDir({ prefix: "catalogue-test-" });
  const catalogue = new CatalogueService({
    manifest: manifestWith(manifestEntry(), spice),
    backend: backend({}),
    fleetServers: [
      FLEET_SERVER,
      { ...FLEET_SERVER, id: "spice", expectedTools: [] },
    ],
    probe: () => Promise.resolve({ ok: false as const, error: "down" }),
    defaultsPath: `${directory}/catalogue-defaults.json`,
  });
  await assertRejects(
    () => catalogue.prepare("spice"),
    Error,
    "Host preparation is not implemented for this tool.",
  );
});

Deno.test("catalogue probe reports capability with detail", async () => {
  const { service: catalogue } = await service({
    backend: backend({ toolState: "stopped" }),
    capable: true,
  });
  const probed = await catalogue.probe("build123d");
  assertEquals(probed.capable, true);
  await assertRejects(
    () => catalogue.probe("no-such-tool"),
    Error,
    "Unknown catalogue entry.",
  );
});

Deno.test("catalogue defaults round-trip and fail closed", async () => {
  const { service: catalogue, defaultsPath } = await service({});
  assertEquals(await catalogue.getDefaults(), []);
  assertEquals(await catalogue.setDefaults(["build123d", "build123d"]), ["build123d"]);
  assertEquals(await catalogue.getDefaults(), ["build123d"]);
  await assertRejects(
    () => catalogue.setDefaults(["no-such-tool"]),
    Error,
    'Unknown catalogue entry "no-such-tool".',
  );
  await Deno.writeTextFile(defaultsPath, "not json");
  assertEquals(await catalogue.getDefaults(), []);
  await Deno.writeTextFile(
    defaultsPath,
    JSON.stringify({ ids: ["build123d", "ghost"] }),
  );
  assertEquals(await catalogue.getDefaults(), ["build123d"]);
});

Deno.test("bundled curated manifest loads with the Build123d entry", () => {
  const directory = Deno.makeTempDirSync({ prefix: "catalogue-test-" });
  const catalogue = new CatalogueService({
    backend: backend({}),
    fleetServers: [FLEET_SERVER],
    probe: () => Promise.resolve({ ok: true as const, tools: [] }),
    defaultsPath: `${directory}/catalogue-defaults.json`,
  });
  return catalogue.snapshot().then((snapshot) => {
    const entry = snapshot.entries.find((candidate) => candidate.id === "build123d");
    assert(entry !== undefined);
    assertEquals(entry.tools.length, 4);
    assertEquals(entry.examples.length, 2);
    assert(entry.viewers.every((viewer) => viewer.uri.startsWith("ui://")));
    assertEquals(entry.distribution.version, "0.7.1");
    parseCatalogueSnapshotDto(JSON.parse(JSON.stringify(snapshot)));
  });
});

Deno.test("catalogue manifest validation fails closed", () => {
  assertThrows(
    () => loadCatalogueEntries({ schemaVersion: "0.1", entries: [] }),
    TypeError,
    "catalogue manifest schema is not supported",
  );
  assertThrows(
    () => loadCatalogueEntries(manifestWith()),
    TypeError,
    "catalogue manifest entries are invalid",
  );
  assertThrows(
    () => loadCatalogueEntries(manifestWith(manifestEntry(), manifestEntry())),
    TypeError,
    "catalogue manifest entry ids must be unique",
  );
  assertThrows(
    () => loadCatalogueEntries(manifestWith(manifestEntry({ id: "has space" }))),
    TypeError,
    "catalogue entry id is invalid",
  );
  assertThrows(
    () =>
      loadCatalogueEntries(manifestWith(manifestEntry({
        viewers: [{ uri: "ui://x/y", label: "V", hostSupport: "someday" }],
      }))),
    TypeError,
    "catalogue viewer support is invalid",
  );
  assertThrows(
    () =>
      loadCatalogueEntries(
        manifestWith(manifestEntry({ description: "x".repeat(2_001) })),
      ),
    TypeError,
    "catalogue entry description must be non-empty text of at most 2000 characters",
  );
  assertThrows(
    () =>
      new CatalogueService({
        manifest: manifestWith(manifestEntry({ id: "ghost" })),
        backend: backend({}),
        fleetServers: [FLEET_SERVER],
        probe: () => Promise.resolve({ ok: false as const, error: "down" }),
        defaultsPath: "/tmp/catalogue-test-defaults.json",
      }),
    TypeError,
    'Catalogue entry "ghost" has no connectable fleet server.',
  );
});
