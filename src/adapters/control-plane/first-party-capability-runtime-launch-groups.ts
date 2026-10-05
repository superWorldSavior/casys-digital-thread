/** Exact first-party persistent topology registry. */

import {
  type CapabilityRuntimeLaunchGroup,
  capabilityRuntimeLaunchGroupReference,
  fingerprintCapabilityRuntimeComposeContent,
  fingerprintCapabilityRuntimeLaunchGroup,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import { FixedCapabilityRuntimeLaunchGroupRegistry } from "../../application/control-plane/capability-runtime-launch-group-registry.ts";
import {
  MCP_CALCULIX_085_IMAGE_REFERENCE,
  MCP_CHRONO_035_IMAGE_REFERENCE,
  MCP_DFM_030_IMAGE_REFERENCE,
} from "./first-party-capability-runtime-identities.ts";

export const POSTGRES_IMAGE_REFERENCE =
  "docker.io/library/postgres@sha256:926f8799aef36e00001cfe15fba7abbd37d3c5224ea57e4c858e4bb670f10561" as const;
export const SYSON_IMAGE_REFERENCE =
  "ghcr.io/casys-ai/syson@sha256:d372ae26e5d32e5c599fa7c1599d42c73cf9a54e101cfe6f77175f313d7d84e9" as const;
export const MCP_SYSON_IMAGE_REFERENCE =
  "ghcr.io/casys-ai/mcp-syson@sha256:df00198b1fd33504871e93834bc6616bcfcc09a85d4cd8f6348434c38c09c0ab" as const;
export const MCP_BUILD123D_071_IMAGE_REFERENCE =
  "ghcr.io/casys-ai/mcp-build123d@sha256:6ca7396795de60db038f943cd5df8582c0e5538910d0b56da652bbd461865af4" as const;

/**
 * SysON is only exposed through mcp-syson on 3009. The UI's historical 8180
 * mapping is intentionally absent: it is neither needed by FEA nor approved
 * by this capability group. No shared Compose network is named; Compose uses
 * the project-scoped default network derived from `casys-syson`.
 */
export async function createFirstPartyCapabilityRuntimeLaunchGroups(): Promise<
  readonly CapabilityRuntimeLaunchGroup[]
> {
  const syson = await createFirstPartySysonLaunchGroup();
  const build123dSandbox = await build123dLaunchGroup({
    id: "casys-build123d-sandbox",
    projectName: "casys-build123d-sandbox",
    unitId: "casys.mcp-build123d-sandbox",
    materialId: "mcp-build123d-sandbox-image",
    serviceName: "mcp-build123d-sandbox",
    port: 3024,
    volume: "build123d-sandbox-exports",
  });
  const build123dObservation = await build123dLaunchGroup({
    id: "casys-build123d-observation",
    projectName: "casys-build123d-observation",
    unitId: "casys.mcp-build123d-observation",
    materialId: "mcp-build123d-observation-image",
    serviceName: "mcp-build123d",
    port: 3014,
    volume: "exports",
  });
  const chrono = await createFirstPartyChronoLaunchGroup();

  // CalculiX sensitivity is a deliberately independent, single-service
  // topology. It has no CAD exchange mount: the server-owned staging adapter
  // writes only the exact input bytes into its private retained volume, while
  // recorded provider resources are reread through MCP and captured into CAS.
  // This descriptor is a sealed launch recipe, not a qualification claim.
  const calculixComposeContent = deterministicJson({
    services: {
      "mcp-calculix": {
        image: MCP_CALCULIX_085_IMAGE_REFERENCE,
        // mcp-calculix 0.8.5 owns HTTP startup through its published `http`
        // mode. H1 proves lifecycle readiness through the sealed read-only MCP
        // tools/list handshake below; provider health never becomes a
        // qualification or engineering verdict.
        command: ["http"],
        environment: {
          CALCULIX_MAX_RECORDED_RUNS: "24",
          CALCULIX_RUNS_DIRECTORY: "/var/lib/mcp-calculix-runs",
        },
        ports: ["127.0.0.1:3015:3015"],
        volumes: [
          "calculix-inputs:/inputs",
          "calculix-runs:/var/lib/mcp-calculix-runs",
          "calculix-exports:/exports",
        ],
      },
    },
    volumes: {
      "calculix-inputs": {},
      "calculix-runs": {},
      "calculix-exports": {},
    },
  });
  const calculixCompose = {
    schemaVersion: "capability-runtime-compose-descriptor/1.0" as const,
    content: calculixComposeContent,
    fingerprint: await fingerprintCapabilityRuntimeComposeContent(
      calculixComposeContent,
    ),
  };
  const calculixBody = {
    schemaVersion: "capability-runtime-launch-group/2.0" as const,
    id: "casys-mcp-calculix",
    version: "1.0.0",
    activationPolicy: "persistent" as const,
    acquisition: {
      kind: "compose" as const,
      projectName: "casys-mcp-calculix-v1",
    },
    materials: [
      material(
        "casys.mcp-calculix",
        "mcp-calculix-image",
        MCP_CALCULIX_085_IMAGE_REFERENCE,
        "mcp-calculix",
        "casys-mcp-calculix-v1",
      ),
    ],
    compose: calculixCompose,
    retention: {
      containers: "stop-only" as const,
      images: "preserve" as const,
      volumes: "preserve" as const,
    },
    secretSlots: [],
    readiness: {
      kind: "mcp-tools-list" as const,
      timeoutMs: 15_000,
      attemptTimeoutMs: 1_000,
      retryIntervalMs: 250,
    },
    security: "reviewed" as const,
  };
  const calculix = {
    ...calculixBody,
    fingerprint: await fingerprintCapabilityRuntimeLaunchGroup(calculixBody),
  } as const;
  const dfm = await createFirstPartyDfmLaunchGroup();
  return [syson, build123dSandbox, build123dObservation, chrono, calculix, dfm];
}

async function createFirstPartyDfmLaunchGroup(): Promise<
  CapabilityRuntimeLaunchGroup
> {
  const image = MCP_DFM_030_IMAGE_REFERENCE;
  const composeContent = deterministicJson({
    services: {
      "mcp-dfm": {
        image,
        ports: ["127.0.0.1:3018:3018"],
        volumes: ["dfm-exports:/exports:ro"],
        cap_drop: ["ALL"],
        security_opt: ["no-new-privileges:true"],
      },
    },
    volumes: { "dfm-exports": {} },
  });
  const compose = {
    schemaVersion: "capability-runtime-compose-descriptor/1.0" as const,
    content: composeContent,
    fingerprint: await fingerprintCapabilityRuntimeComposeContent(composeContent),
  };
  const body = {
    schemaVersion: "capability-runtime-launch-group/2.0" as const,
    id: "casys-mcp-dfm",
    version: "1.0.0",
    activationPolicy: "persistent" as const,
    acquisition: { kind: "compose" as const, projectName: "casys-mcp-dfm-v1" },
    materials: [
      material(
        "casys.mcp-dfm",
        "mcp-dfm-image",
        image,
        "mcp-dfm",
        "casys-mcp-dfm-v1",
      ),
    ],
    compose,
    retention: {
      containers: "stop-only" as const,
      images: "preserve" as const,
      volumes: "preserve" as const,
    },
    secretSlots: [],
    readiness: {
      kind: "mcp-tools-list" as const,
      timeoutMs: 15_000,
      attemptTimeoutMs: 1_000,
      retryIntervalMs: 250,
    },
    security: "reviewed" as const,
  };
  return {
    ...body,
    fingerprint: await fingerprintCapabilityRuntimeLaunchGroup(body),
  };
}

async function createFirstPartyChronoLaunchGroup(): Promise<
  CapabilityRuntimeLaunchGroup
> {
  const image = MCP_CHRONO_035_IMAGE_REFERENCE;
  const chronoComposeContent = deterministicJson({
    services: {
      "mcp-chrono": {
        image,
        platform: "linux/amd64",
        volumes: ["chrono-data:/data"],
        ports: ["127.0.0.1:3025:3025"],
        cap_drop: ["ALL"],
        security_opt: ["no-new-privileges:true"],
        // The token is read only inside the container from the closed runtime
        // overlay. It is neither a Compose interpolation nor sealed content.
        healthcheck: {
          test: [
            "CMD",
            "python",
            "-c",
            "import os, urllib.request; token = os.environ.get('MCP_BEARER_TOKEN'); assert token; request = urllib.request.Request('http://127.0.0.1:3025/healthz', headers={'Authorization': 'Bearer ' + token}); urllib.request.urlopen(request, timeout=3).read()",
          ],
          interval: "30s",
          timeout: "5s",
          retries: 3,
          start_period: "20s",
        },
      },
    },
    volumes: { "chrono-data": {} },
  });
  const compose = {
    schemaVersion: "capability-runtime-compose-descriptor/1.0" as const,
    content: chronoComposeContent,
    fingerprint: await fingerprintCapabilityRuntimeComposeContent(
      chronoComposeContent,
    ),
  };
  const body = {
    schemaVersion: "capability-runtime-launch-group/2.0" as const,
    id: "casys-chrono",
    version: "1.0.0",
    activationPolicy: "persistent" as const,
    acquisition: { kind: "compose" as const, projectName: "casys-chrono" },
    materials: [
      material(
        "casys.mcp-chrono",
        "mcp-chrono-image",
        image,
        "mcp-chrono",
        "casys-chrono",
      ),
    ],
    compose,
    retention: {
      containers: "stop-only" as const,
      images: "preserve" as const,
      volumes: "preserve" as const,
    },
    secretSlots: ["chrono-mcp-bearer-token"],
    security: "reviewed" as const,
  };
  return {
    ...body,
    fingerprint: await fingerprintCapabilityRuntimeLaunchGroup(body),
  };
}

async function createFirstPartySysonLaunchGroup(): Promise<
  CapabilityRuntimeLaunchGroup
> {
  const image = SYSON_IMAGE_REFERENCE;
  const version = "1.0.1";
  const sysonComposeContent = deterministicJson({
    services: {
      "syson-db": {
        image: POSTGRES_IMAGE_REFERENCE,
        environment: {
          POSTGRES_DB: "syson",
          POSTGRES_PASSWORD: "syson",
          POSTGRES_USER: "syson",
        },
        volumes: ["syson-db-data:/var/lib/postgresql/data"],
        healthcheck: {
          test: ["CMD-SHELL", "pg_isready -U syson -d syson"],
          interval: "5s",
          timeout: "5s",
          retries: 10,
        },
      },
      "syson-app": {
        image,
        environment: {
          MANAGEMENT_HEALTH_ELASTICSEARCH_ENABLED: "false",
          SERVER_PORT: "8080",
          SIRIUS_COMPONENTS_CORS_ALLOWEDORIGINPATTERNS: "*",
          SPRING_DATASOURCE_PASSWORD: "syson",
          SPRING_DATASOURCE_URL: "jdbc:postgresql://syson-db/syson",
          SPRING_DATASOURCE_USERNAME: "syson",
        },
        depends_on: { "syson-db": { condition: "service_healthy" } },
        healthcheck: {
          test: [
            "CMD",
            "wget",
            "-q",
            "--spider",
            "http://localhost:8080/actuator/health",
          ],
          interval: "10s",
          timeout: "5s",
          retries: 20,
          start_period: "240s",
        },
      },
      "mcp-syson": {
        image: MCP_SYSON_IMAGE_REFERENCE,
        command: ["--port=3009", "--hostname=0.0.0.0"],
        environment: { SYSON_URL: "http://syson-app:8080" },
        depends_on: { "syson-app": { condition: "service_healthy" } },
        ports: ["127.0.0.1:3009:3009"],
        healthcheck: {
          test: [
            "CMD",
            "deno",
            "eval",
            "--allow-net=127.0.0.1:3009",
            "const r=await fetch('http://127.0.0.1:3009/health');if(!r.ok)Deno.exit(1)",
          ],
          interval: "10s",
          timeout: "5s",
          retries: 12,
          start_period: "10s",
        },
      },
    },
    volumes: { "syson-db-data": {} },
  });
  const compose = {
    schemaVersion: "capability-runtime-compose-descriptor/1.0" as const,
    content: sysonComposeContent,
    fingerprint: await fingerprintCapabilityRuntimeComposeContent(sysonComposeContent),
  };
  const body = {
    schemaVersion: "capability-runtime-launch-group/2.0" as const,
    id: "casys-syson",
    version,
    activationPolicy: "persistent" as const,
    acquisition: { kind: "compose" as const, projectName: "casys-syson" },
    materials: [
      material(
        "casys.syson-stack",
        "syson-db-image",
        POSTGRES_IMAGE_REFERENCE,
        "syson-db",
        "casys-syson",
      ),
      material(
        "casys.syson-stack",
        "syson-app-image",
        image,
        "syson-app",
        "casys-syson",
      ),
      material(
        "casys.syson-stack",
        "mcp-syson-image",
        MCP_SYSON_IMAGE_REFERENCE,
        "mcp-syson",
        "casys-syson",
      ),
    ],
    compose,
    retention: {
      containers: "stop-only" as const,
      images: "preserve" as const,
      volumes: "preserve" as const,
    },
    secretSlots: [],
    security: "reviewed" as const,
  };
  const syson = {
    ...body,
    fingerprint: await fingerprintCapabilityRuntimeLaunchGroup(body),
  } as const;
  return syson;
}

export async function createFirstPartyCapabilityRuntimeLaunchGroupRegistry(): Promise<
  FixedCapabilityRuntimeLaunchGroupRegistry
> {
  return new FixedCapabilityRuntimeLaunchGroupRegistry(
    await createFirstPartyCapabilityRuntimeLaunchGroups(),
  );
}

export async function firstPartySysonLaunchGroupReference() {
  const groups = await createFirstPartyCapabilityRuntimeLaunchGroups();
  return capabilityRuntimeLaunchGroupReference(requireGroup(groups, "casys-syson"));
}

export async function firstPartyCalculixLaunchGroupReference() {
  const groups = await createFirstPartyCapabilityRuntimeLaunchGroups();
  return capabilityRuntimeLaunchGroupReference(
    requireGroup(groups, "casys-mcp-calculix"),
  );
}

export async function firstPartyBuild123dSandboxLaunchGroupReference() {
  const groups = await createFirstPartyCapabilityRuntimeLaunchGroups();
  return capabilityRuntimeLaunchGroupReference(
    requireGroup(groups, "casys-build123d-sandbox"),
  );
}

export async function firstPartyBuild123dObservationLaunchGroupReference() {
  const groups = await createFirstPartyCapabilityRuntimeLaunchGroups();
  return capabilityRuntimeLaunchGroupReference(
    requireGroup(groups, "casys-build123d-observation"),
  );
}

async function build123dLaunchGroup(input: {
  readonly id: "casys-build123d-sandbox" | "casys-build123d-observation";
  readonly projectName: "casys-build123d-sandbox" | "casys-build123d-observation";
  readonly unitId:
    | "casys.mcp-build123d-sandbox"
    | "casys.mcp-build123d-observation";
  readonly materialId:
    | "mcp-build123d-sandbox-image"
    | "mcp-build123d-observation-image";
  readonly serviceName: "mcp-build123d-sandbox" | "mcp-build123d";
  readonly port: 3024 | 3014;
  readonly volume: "build123d-sandbox-exports" | "exports";
}): Promise<CapabilityRuntimeLaunchGroup> {
  const composeContent = deterministicJson({
    services: {
      [input.serviceName]: {
        image: MCP_BUILD123D_071_IMAGE_REFERENCE,
        ports: [`127.0.0.1:${input.port}:3014`],
        volumes: [`${input.volume}:/exports`],
        // Exact limits from the reviewed provider Compose contract. The image
        // does not declare a Docker healthcheck; launch-group readiness below
        // therefore verifies the already-published MCP protocol in read-only
        // mode before H1 delivers a runtime lease.
        mem_limit: "2g",
        cpus: 2,
        pids_limit: 128,
        security_opt: ["no-new-privileges:true"],
        cap_drop: ["ALL"],
      },
    },
    volumes: { [input.volume]: {} },
  });
  const compose = {
    schemaVersion: "capability-runtime-compose-descriptor/1.0" as const,
    content: composeContent,
    fingerprint: await fingerprintCapabilityRuntimeComposeContent(composeContent),
  };
  const body = {
    schemaVersion: "capability-runtime-launch-group/2.0" as const,
    id: input.id,
    version: "1.0.0",
    activationPolicy: "persistent" as const,
    acquisition: { kind: "compose" as const, projectName: input.projectName },
    materials: [
      material(
        input.unitId,
        input.materialId,
        MCP_BUILD123D_071_IMAGE_REFERENCE,
        input.serviceName,
        input.projectName,
      ),
    ],
    compose,
    readiness: {
      kind: "mcp-tools-list" as const,
      timeoutMs: 15_000,
      attemptTimeoutMs: 1_000,
      retryIntervalMs: 250,
    },
    retention: {
      containers: "stop-only" as const,
      images: "preserve" as const,
      volumes: "preserve" as const,
    },
    secretSlots: [],
    security: "reviewed" as const,
  };
  return {
    ...body,
    fingerprint: await fingerprintCapabilityRuntimeLaunchGroup(body),
  };
}

function requireGroup(
  groups: readonly CapabilityRuntimeLaunchGroup[],
  id: string,
): CapabilityRuntimeLaunchGroup {
  const matches = groups.filter((group) => group.id === id);
  if (matches.length !== 1) {
    throw new TypeError(`First-party launch group ${id} is not unique.`);
  }
  return matches[0]!;
}

export async function firstPartyChronoLaunchGroupReference() {
  const groups = await createFirstPartyCapabilityRuntimeLaunchGroups();
  return capabilityRuntimeLaunchGroupReference(requireGroup(groups, "casys-chrono"));
}

export async function firstPartyDfmLaunchGroupReference() {
  const groups = await createFirstPartyCapabilityRuntimeLaunchGroups();
  return capabilityRuntimeLaunchGroupReference(requireGroup(groups, "casys-mcp-dfm"));
}

function material(
  unitId: string,
  materialId: string,
  imageReference: string,
  serviceName: string,
  projectName = "casys-syson",
) {
  const digest = imageReference.slice(
    imageReference.lastIndexOf("@sha256:") + "@sha256:".length,
  );
  return {
    material: { unitId, materialId, imageDigest: digest },
    serviceName,
    imageReference,
    ownership: [
      { key: "com.docker.compose.project", value: projectName },
      { key: "com.docker.compose.service", value: serviceName },
    ],
  } as const;
}
