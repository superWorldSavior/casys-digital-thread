import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import { loadFleetManifest, ManifestError, validateFleetManifest } from "./manifest.ts";
import {
  createFirstPartyCapabilityRuntimeLaunchGroups,
} from "./first-party-capability-runtime-launch-groups.ts";

Deno.test("loadFleetManifest accepts the workspace manifest and preserves posture", async () => {
  const manifest = await loadFleetManifest("config/mcp-fleet.json");
  assertEquals(manifest.version, 1);
  assertEquals(manifest.servers.map((server) => server.id), [
    "syson",
    "build123d",
    "build123d-sandbox",
    "calculix",
    "erpnext",
    "dfm",
    "tolerance",
    "prusaslicer",
    "spice",
  ]);
  assertEquals(manifest.servers[1].network?.exposure, "loopback-only");
  assertEquals(
    manifest.servers[1].trust?.level,
    "first-party-local-privileged",
  );
  assertEquals(manifest.servers[1].trust?.executesArbitraryCode, true);
  for (const serverId of ["build123d", "build123d-sandbox"]) {
    const build123d = manifest.servers.find((server) => server.id === serverId);
    assertEquals(build123d?.expectedTools, [
      "build123d_execute",
      "build123d_export",
      "build123d_observe_assembly_integrity",
      "build123d_project_2d",
    ]);
    assertEquals(build123d?.expectedViews, [
      "ui://mcp-build123d/results-viewer",
      "ui://mcp-build123d/assembly-viewer",
      "ui://mcp-build123d/drawing-viewer",
    ]);
  }
  const erpnext = manifest.servers.find((server) => server.id === "erpnext");
  assertEquals(erpnext?.expectedTools, [
    "erpnext_bom_list",
    "erpnext_bom_get",
    "erpnext_item_get",
    "erpnext_work_order_list",
    "erpnext_job_card_list",
  ]);
  assertEquals(erpnext?.expectedViews, [
    "ui://mcp-erpnext/doclist-viewer",
  ]);
  assertEquals(erpnext?.trust?.level, "first-party-local-privileged");
  assertEquals(erpnext?.trust?.executesArbitraryCode, false);

  const calculix = manifest.servers.find((server) => server.id === "calculix");
  assertEquals(calculix?.expectedTools, [
    "calculix_mesh_preflight",
    "calculix_solve_static",
    "calculix_solve_modal",
    "calculix_solve_buckling",
    "calculix_solve_creep",
    "calculix_solve_coupled_thermal",
    "calculix_solve_static_recorded",
    "calculix_run_get",
  ]);
  assertEquals(calculix?.network?.sharedVolumes, [
    "calculix-inputs:/inputs",
    "calculix-runs:/var/lib/mcp-calculix-runs",
    "calculix-exports:/exports",
  ]);
  assertEquals(calculix?.network?.composeNetwork, undefined);
  assertEquals(calculix?.healthUrl, undefined);
  assertEquals(calculix?.required, false);
});

Deno.test("CalculiX desired identity pins the published 0.8.5 index, labels, and timeout ceiling", async () => {
  const raw = JSON.parse(await Deno.readTextFile("config/mcp-fleet.json")) as {
    servers: Array<Record<string, unknown>>;
  };
  const calculix = raw.servers.find((server) => server.id === "calculix");
  assert(calculix, "fleet manifest is missing CalculiX");
  assertEquals(
    calculix.image,
    "ghcr.io/casys-ai/mcp-calculix@sha256:3fad853cdb720d6d50e4714d23c9e4cf7bb011fec7b10addad5945b045757123",
  );
  assertEquals(calculix.providerIdentity, {
    version: "0.8.5",
    revision: "a98151d505a8851e0021916c5fa0953418fd8cac",
    imageIndexDigest:
      "3fad853cdb720d6d50e4714d23c9e4cf7bb011fec7b10addad5945b045757123",
    ociLabels: {
      "org.opencontainers.image.source": "https://github.com/Casys-AI/mcp-calculix",
      "org.opencontainers.image.title": "mcp-calculix",
      "org.opencontainers.image.version": "0.8.5",
      "org.opencontainers.image.revision": "a98151d505a8851e0021916c5fa0953418fd8cac",
    },
    contractFingerprint:
      "96fcac681292d7d48ca5d11c9e8630ff5bd61b95266f7b1b18f083c6c496b860",
    ordinarySolveTimeoutMaxMs: 120000,
  });
});

Deno.test("Build123d desired identities pin the dedicated 0.7.1 multi-arch provider contract", async () => {
  const raw = JSON.parse(await Deno.readTextFile("config/mcp-fleet.json")) as {
    servers: Array<Record<string, unknown>>;
  };
  const expectedImage =
    "ghcr.io/casys-ai/mcp-build123d@sha256:6ca7396795de60db038f943cd5df8582c0e5538910d0b56da652bbd461865af4";
  const expectedIdentity = {
    releaseTag: "v0.7.1",
    version: "0.7.1",
    revision: "8f05e216dfea26339dc2c50e2a48060bf8a4d51a",
    imageIndexDigest:
      "6ca7396795de60db038f943cd5df8582c0e5538910d0b56da652bbd461865af4",
    platformManifests: {
      "linux/amd64": "91b30048f0f74b67c3c4ed3e874652db95502b6cd1db58ec0a30f35fa4546946",
      "linux/arm64": "66c14c537f31205043b7eca4c4dd2a27a308464e71b3a4809ff07ba9f0641e07",
    },
    ociLabels: {
      "org.opencontainers.image.created": "2026-09-29T03:22:05Z",
      "org.opencontainers.image.description": "Qualified Build123d MCP provider",
      "org.opencontainers.image.licenses": "MIT",
      "org.opencontainers.image.revision": "8f05e216dfea26339dc2c50e2a48060bf8a4d51a",
      "org.opencontainers.image.source": "https://github.com/Casys-AI/mcp-build123d",
      "org.opencontainers.image.title": "mcp-build123d",
      "org.opencontainers.image.url": "https://github.com/denoland/deno_docker",
      "org.opencontainers.image.version": "0.7.1",
    },
    contractFingerprint:
      "28e6c8c95c929513bcc1db87dd04bd8fb9dc98fe53c1e12dddd75bb6dc6fcd79",
  };
  for (const id of ["build123d", "build123d-sandbox"]) {
    const build123d = raw.servers.find((server) => server.id === id);
    assert(build123d, `fleet manifest is missing ${id}`);
    assertEquals(build123d.image, expectedImage);
    assertEquals(build123d.providerIdentity, expectedIdentity);
  }
});

Deno.test("toolchain Compose defaults remain in parity with fleet desired images", async () => {
  const [manifest, composeSource] = await Promise.all([
    loadFleetManifest("config/mcp-fleet.json"),
    Deno.readTextFile("docker-compose.yml"),
  ]);
  const compose = record(parseYaml(composeSource), "docker-compose.yml");
  const services = record(compose.services, "docker-compose.yml.services");

  for (
    const [serverId, imageVariable] of [
      ["syson", "MCP_SYSON_IMAGE"],
      ["build123d", "MCP_BUILD123D_IMAGE"],
      ["build123d-sandbox", "MCP_BUILD123D_IMAGE"],
      ["spice", "MCP_SPICE_IMAGE"],
    ] as const
  ) {
    const server = manifest.servers.find((candidate) => candidate.id === serverId);
    assert(server, `fleet manifest is missing ${serverId}`);

    const service = record(
      services[server.serviceName],
      `docker-compose.yml.services.${server.serviceName}`,
    );
    assertEquals(
      composeImageDefault(service.image, server.serviceName, imageVariable)
        .defaultImage,
      server.image,
      `${server.serviceName} Compose default must match ${serverId} fleet image`,
    );
  }

  const syson = record(services["mcp-syson"], "docker-compose.yml.services.mcp-syson");
  assertEquals(syson.command, ["--port=3009", "--hostname=0.0.0.0"]);
  assertEquals(
    composeImageDefault(syson.image, "mcp-syson", "MCP_SYSON_IMAGE").defaultImage,
    "ghcr.io/casys-ai/mcp-syson@sha256:df00198b1fd33504871e93834bc6616bcfcc09a85d4cd8f6348434c38c09c0ab",
  );

  for (const serviceName of ["mcp-build123d", "mcp-build123d-sandbox"]) {
    const build123d = record(services[serviceName], serviceName);
    assertEquals(build123d.command, undefined);
  }
});

Deno.test("CalculiX sensitivity is absent from root Compose and has one sealed private capability group", async () => {
  const [composeSource, sensitivityCompositionSource] = await Promise.all([
    Deno.readTextFile("docker-compose.yml"),
    Deno.readTextFile("src/adapters/sensitivity/server-composition.ts"),
  ]);
  const compose = record(parseYaml(composeSource), "docker-compose.yml");
  const services = record(compose.services, "docker-compose.yml.services");
  assertEquals("mcp-calculix" in services, false);
  const group = (await createFirstPartyCapabilityRuntimeLaunchGroups()).find(
    (candidate) => candidate.id === "casys-mcp-calculix",
  );
  assert(group, "CalculiX launch group is absent");
  const descriptor = JSON.parse(group.compose.content) as {
    services: { "mcp-calculix": Record<string, unknown> };
  };
  const calculix = descriptor.services["mcp-calculix"];
  assertEquals(calculix.command, ["http"]);
  assertEquals(calculix.healthcheck, undefined);
  assertEquals(calculix.volumes, [
    "calculix-inputs:/inputs",
    "calculix-runs:/var/lib/mcp-calculix-runs",
    "calculix-exports:/exports",
  ]);
  assertEquals(calculix.ports, ["127.0.0.1:3015:3015"]);
  assertEquals(group.version, "1.0.0");
  assertEquals(group.acquisition.projectName, "casys-mcp-calculix-v1");
  assertEquals(group.readiness, {
    kind: "mcp-tools-list",
    timeoutMs: 15_000,
    attemptTimeoutMs: 1_000,
    retryIntervalMs: 250,
  });
  assertEquals(group.security, "reviewed");
  assertEquals(/DockerVolumeAssetStager/.test(sensitivityCompositionSource), false);
});

Deno.test("validateFleetManifest ignores documentation extensions", () => {
  const manifest = validateFleetManifest({
    version: 1,
    documentation: { owner: "systems" },
    servers: [serverFixture()],
  });
  assertEquals(manifest.servers.length, 1);
  assertEquals(manifest.servers[0].id, "test");
});

Deno.test("validateFleetManifest accepts a provider without a published health endpoint", () => {
  const { healthUrl: _healthUrl, ...server } = serverFixture();
  const manifest = validateFleetManifest({
    version: 1,
    servers: [server],
  });

  assertEquals(manifest.servers[0]?.healthUrl, undefined);
});

Deno.test("loadFleetManifest reports path and JSON errors", async () => {
  const error = await assertRejects(
    () =>
      loadFleetManifest("broken.json", {
        readTextFile: () => Promise.resolve("{"),
      }),
    ManifestError,
  );
  assertStringIncludes(error.message, "broken.json");
  assertStringIncludes(error.message, "Invalid JSON");
});

Deno.test("validateFleetManifest rejects duplicate ids", () => {
  assertThrows(
    () =>
      validateFleetManifest({
        version: 1,
        servers: [serverFixture(), serverFixture()],
      }),
    ManifestError,
    "Duplicate server id",
  );
});

function serverFixture() {
  return {
    id: "test",
    displayName: "Test",
    role: "test",
    serviceName: "mcp-test",
    transport: "streamable-http",
    mcpUrl: "http://127.0.0.1:3999/mcp",
    healthUrl: "http://127.0.0.1:3999/health",
    image: "example.test/toolchain:1",
    required: true,
    expectedTools: ["test_read"],
  };
}

function record(value: unknown, path: string): Record<string, unknown> {
  assert(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${path} must be an object`,
  );
  return value as Record<string, unknown>;
}

function composeImageDefault(
  image: unknown,
  serviceName: string,
  imageVariable: string,
): { readonly imageVariable: string; readonly defaultImage: string } {
  assert(
    typeof image === "string",
    `${serviceName}.image must be a string`,
  );
  const match = new RegExp(`^\\$\\{${imageVariable}:-(.+)\\}$`).exec(image);
  assert(
    match,
    `${serviceName}.image must use ${imageVariable} with a committed default`,
  );
  return { imageVariable, defaultImage: match[1]! };
}
