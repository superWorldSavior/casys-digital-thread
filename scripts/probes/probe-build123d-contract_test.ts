import { assertEquals } from "@std/assert";
import {
  BUILD123D_ENDPOINT,
  BUILD123D_EXPECTED_TOOLS,
  BUILD123D_RELEASE,
  build123dContractFingerprint,
  probeBuild123dContract,
} from "./probe-build123d-contract.ts";
import { BUILD123D_EXPORT_TIMEOUT_MS } from "../../src/adapters/cad/canonical/build123d-export-contract.ts";

const MANIFEST = JSON.stringify({
  servers: [
    server("build123d", "mcp-build123d", BUILD123D_ENDPOINT),
    server("build123d-sandbox", "mcp-build123d-sandbox", {
      mcpUrl: "http://127.0.0.1:3024/mcp",
      healthUrl: "http://127.0.0.1:3024/health",
    }),
  ],
});
const HEALTH = { status: "ok", server: "mcp-build123d", version: "0.7.1" };
const DISCOVERY = {
  supportedVersions: ["2026-07-28"],
  serverInfo: { name: "mcp-build123d", version: "0.7.1" },
  resultType: "complete",
};
const RESOURCES = [
  { uri: "ui://mcp-build123d/results-viewer" },
  { uri: "ui://mcp-build123d/assembly-viewer" },
  { uri: "ui://mcp-build123d/drawing-viewer" },
];
const TOOLS = [
  executionTool("build123d_execute", "ui://mcp-build123d/results-viewer"),
  executionTool("build123d_export", "ui://mcp-build123d/results-viewer"),
  assemblyObservationTool(),
  projectionTool(),
];

Deno.test("Build123d preflight uses the read-only discovery surface and accepts its reviewed fingerprint", async () => {
  const fake = new FakeBuild123dFetch();
  const expected = await fixtureFingerprint(TOOLS);
  const result = await probeBuild123dContract({
    manifestText: MANIFEST,
    fetch: fake.fetch,
    now: () => new Date("2026-08-29T00:00:00.000Z"),
    expectedContractSha256: expected,
  });

  assertEquals(result.contract, "current-surface");
  assertEquals(result.observedAt, "2026-08-29T00:00:00.000Z");
  assertEquals(result.observed.contractFingerprint?.digest, expected);
  assertEquals(result.surface.serverFixedCad, "declared");
  assertEquals(result.surface.assemblyIntegrityObservation, "declared");
  assertEquals(fake.calls, [
    { method: "GET", url: BUILD123D_ENDPOINT.healthUrl },
    { method: "server/discover", url: BUILD123D_ENDPOINT.mcpUrl },
    { method: "tools/list", url: BUILD123D_ENDPOINT.mcpUrl },
    { method: "resources/list", url: BUILD123D_ENDPOINT.mcpUrl },
  ]);
});

Deno.test("Build123d preflight rejects fleet drift before network", async () => {
  const fake = new FakeBuild123dFetch();
  const changed = JSON.parse(MANIFEST) as { servers: Array<Record<string, unknown>> };
  changed.servers[1]!.image = "ghcr.io/casys-ai/mcp-build123d:0.7.0";
  const result = await probeBuild123dContract({
    manifestText: JSON.stringify(changed),
    fetch: fake.fetch,
  });

  assertEquals(result.contract, "contract-divergent");
  assertEquals(fake.calls, []);
});

Deno.test("Build123d preflight rejects a changed schema or resource surface", async () => {
  const changedSchema = structuredClone(TOOLS);
  const exportInput = changedSchema[1]!.inputSchema as Record<string, unknown>;
  const properties = exportInput.properties as Record<string, unknown>;
  (properties.timeout_ms as Record<string, unknown>).maximum =
    BUILD123D_EXPORT_TIMEOUT_MS + 1;
  const schemaResult = await probeBuild123dContract({
    manifestText: MANIFEST,
    fetch: new FakeBuild123dFetch({ tools: changedSchema }).fetch,
    expectedContractSha256: await fixtureFingerprint(TOOLS),
  });
  assertEquals(schemaResult.contract, "contract-divergent");

  const resourceResult = await probeBuild123dContract({
    manifestText: MANIFEST,
    fetch: new FakeBuild123dFetch({ resources: [] }).fetch,
    expectedContractSha256: await fixtureFingerprint(TOOLS),
  });
  assertEquals(resourceResult.contract, "contract-divergent");
});

Deno.test("Build123d export timeout cannot exceed its published 60-second ceiling", () => {
  assertEquals(BUILD123D_EXPORT_TIMEOUT_MS, 60_000);
});

Deno.test("Build123d preflight classifies transport failure as unavailable", async () => {
  const result = await probeBuild123dContract({
    manifestText: MANIFEST,
    fetch: (() => Promise.reject(new Error("offline"))) as typeof fetch,
  });
  assertEquals(result.contract, "unavailable");
});

function server(
  id: string,
  serviceName: string,
  endpoint: { mcpUrl: string; healthUrl: string },
): Record<string, unknown> {
  return {
    id,
    serviceName,
    ...endpoint,
    image: BUILD123D_RELEASE.image,
    providerIdentity: {
      ...BUILD123D_RELEASE,
      contractFingerprint:
        "28e6c8c95c929513bcc1db87dd04bd8fb9dc98fe53c1e12dddd75bb6dc6fcd79",
    },
    expectedTools: BUILD123D_EXPECTED_TOOLS,
    expectedViews: [
      "ui://mcp-build123d/results-viewer",
      "ui://mcp-build123d/assembly-viewer",
      "ui://mcp-build123d/drawing-viewer",
    ],
  };
}

function executionTool(name: string, resourceUri: string): Record<string, unknown> {
  return {
    name,
    inputSchema: {
      type: "object",
      properties: {
        timeout_ms: {
          type: "integer",
          minimum: 1,
          maximum: BUILD123D_EXPORT_TIMEOUT_MS,
        },
      },
    },
    outputSchema: { type: "object", properties: {} },
    _meta: { ui: { resourceUri } },
  };
}

function assemblyObservationTool(): Record<string, unknown> {
  return {
    name: "build123d_observe_assembly_integrity",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      minProperties: 1,
      maxProperties: 1,
      properties: { step: { type: "object" }, stepResource: { type: "object" } },
    },
    outputSchema: {
      type: "object",
      properties: {
        producer: { properties: { packageVersion: { const: "0.7.1" } } },
        method: { properties: { id: { const: "occt-assembly-integrity-v1" } } },
      },
    },
    _meta: { ui: { resourceUri: "ui://mcp-build123d/assembly-viewer" } },
  };
}

function projectionTool(): Record<string, unknown> {
  return {
    name: "build123d_project_2d",
    inputSchema: {
      oneOf: [
        { type: "object", required: ["step"] },
        { type: "object", required: ["stepResource"] },
      ],
    },
    outputSchema: {
      type: "object",
      required: [
        "schemaVersion",
        "kind",
        "sourceStep",
        "engine",
        "method",
        "envelopeMm",
        "views",
      ],
      properties: {
        schemaVersion: { const: "io.casys.mcp-build123d.drawing-projection/1.0" },
        kind: { const: "drawing-projection" },
      },
    },
    _meta: { ui: { resourceUri: "ui://mcp-build123d/drawing-viewer" } },
  };
}

async function fixtureFingerprint(tools: Record<string, unknown>[]): Promise<string> {
  return (await build123dContractFingerprint(HEALTH, DISCOVERY, tools)).digest;
}

class FakeBuild123dFetch {
  readonly calls: Array<{ method: string; url: string }> = [];
  readonly #tools: Record<string, unknown>[];
  readonly #resources: Record<string, unknown>[];

  constructor(options: {
    tools?: Record<string, unknown>[];
    resources?: Record<string, unknown>[];
  } = {}) {
    this.#tools = options.tools ?? TOOLS;
    this.#resources = options.resources ?? RESOURCES;
  }

  readonly fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === BUILD123D_ENDPOINT.healthUrl) {
      this.calls.push({ method: "GET", url });
      return Promise.resolve(Response.json(HEALTH));
    }
    const body = JSON.parse(String(init?.body)) as { id: number; method: string };
    this.calls.push({ method: body.method, url });
    if (body.method === "server/discover") {
      return Promise.resolve(rpc(body.id, DISCOVERY));
    }
    if (body.method === "tools/list") {
      return Promise.resolve(rpc(body.id, { tools: this.#tools }));
    }
    if (body.method === "resources/list") {
      return Promise.resolve(rpc(body.id, { resources: this.#resources }));
    }
    throw new Error(`Unexpected method ${body.method}`);
  }) as typeof fetch;
}

function rpc(id: number, result: Record<string, unknown>): Response {
  return Response.json({
    jsonrpc: "2.0",
    id,
    result: { resultType: "complete", ...result },
  });
}
