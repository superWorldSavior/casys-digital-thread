import { assertEquals, assertRejects } from "@std/assert";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import {
  CAPABILITY_RUNTIME_LAUNCH_GROUP_SCHEMA_VERSION,
  capabilityRuntimeLaunchGroupPublishedLoopbackHostPorts,
  capabilityRuntimeLaunchGroupReference,
  fingerprintCapabilityRuntimeComposeContent,
  fingerprintCapabilityRuntimeLaunchGroup,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import {
  createFirstPartyCapabilityRuntimeLaunchGroups,
} from "../../adapters/control-plane/first-party-capability-runtime-launch-groups.ts";
import { FixedCapabilityRuntimeLaunchGroupRegistry } from "./capability-runtime-launch-group-registry.ts";

Deno.test("launch-group registry resolves only the exact sealed SysON group reference", async () => {
  const [group] = await createFirstPartyCapabilityRuntimeLaunchGroups();
  const registry = new FixedCapabilityRuntimeLaunchGroupRegistry([group]);
  const reference = capabilityRuntimeLaunchGroupReference(group!);

  assertEquals((await registry.require(reference)).id, "casys-syson");
  await assertRejects(
    () => registry.require({ ...reference, version: "9.9.9" }),
    TypeError,
    "0 exact matches",
  );
});

Deno.test("Build123d launch groups pin the reviewed image, private loopback ports, retained exports and no shared network", async () => {
  const groups = await createFirstPartyCapabilityRuntimeLaunchGroups();
  const expected = [{
    id: "casys-build123d-sandbox",
    service: "mcp-build123d-sandbox",
    port: "127.0.0.1:3024:3014",
    volume: "build123d-sandbox-exports:/exports",
  }, {
    id: "casys-build123d-observation",
    service: "mcp-build123d",
    port: "127.0.0.1:3014:3014",
    volume: "exports:/exports",
  }];
  for (const requirement of expected) {
    const group = groups.find((candidate) => candidate.id === requirement.id)!;
    const descriptor = JSON.parse(group.compose.content) as {
      services: Record<string, Record<string, unknown>>;
    };
    const service = descriptor.services[requirement.service]!;
    assertEquals(group.version, "1.0.0");
    assertEquals(
      group.materials[0]?.imageReference,
      "ghcr.io/casys-ai/mcp-build123d@sha256:6ca7396795de60db038f943cd5df8582c0e5538910d0b56da652bbd461865af4",
    );
    assertEquals(service.ports, [requirement.port]);
    assertEquals(service.volumes, [requirement.volume]);
    assertEquals(service.mem_limit, "2g");
    assertEquals(service.cpus, 2);
    assertEquals(service.pids_limit, 128);
    assertEquals(service.security_opt, ["no-new-privileges:true"]);
    assertEquals(service.cap_drop, ["ALL"]);
    assertEquals("healthcheck" in service, false);
    assertEquals("networks" in descriptor, false);
    assertEquals("networks" in service, false);
    assertEquals(group.retention, {
      containers: "stop-only",
      images: "preserve",
      volumes: "preserve",
    });
  }
});

Deno.test("first-party launch groups publish distinct loopback host ports", async () => {
  const groups = await createFirstPartyCapabilityRuntimeLaunchGroups();
  const registry = new FixedCapabilityRuntimeLaunchGroupRegistry(groups);
  const listed = await registry.list();
  assertEquals(listed.map((group) => group.id), [
    "casys-build123d-observation",
    "casys-build123d-sandbox",
    "casys-chrono",
    "casys-mcp-calculix",
    "casys-mcp-dfm",
    "casys-syson",
  ]);
  const published = listed.flatMap((group) =>
    capabilityRuntimeLaunchGroupPublishedLoopbackHostPorts(group)
  );
  assertEquals(published.toSorted((left, right) => left - right), [
    3009,
    3014,
    3015,
    3018,
    3024,
    3025,
  ]);
  assertEquals(new Set(published).size, published.length);
});

Deno.test("launch-group registry rejects the same loopback host port on two groups", async () => {
  const left = await publishedGroup({
    id: "casys.port-left",
    projectName: "casys-port-left",
    hostPort: 3456,
    digest: "c".repeat(64),
  });
  const right = await publishedGroup({
    id: "casys.port-right",
    projectName: "casys-port-right",
    hostPort: 3456,
    digest: "d".repeat(64),
  });
  const registry = new FixedCapabilityRuntimeLaunchGroupRegistry([left, right]);
  await assertRejects(
    () => registry.list(),
    TypeError,
    "loopback host port 3456 from both casys.port-left@1.0.0 and casys.port-right@1.0.0",
  );
});

async function publishedGroup(input: {
  readonly id: string;
  readonly projectName: string;
  readonly hostPort: number;
  readonly digest: string;
}): Promise<unknown> {
  const materials = [{
    material: {
      unitId: input.id,
      materialId: "worker-image",
      imageDigest: input.digest,
    },
    serviceName: "worker",
    imageReference: `ghcr.io/casys-ai/worker@sha256:${input.digest}`,
    ownership: [
      { key: "com.docker.compose.project", value: input.projectName },
      { key: "com.docker.compose.service", value: "worker" },
    ],
  }];
  const content = deterministicJson({
    services: {
      worker: {
        image: materials[0]!.imageReference,
        ports: [`127.0.0.1:${input.hostPort}:${input.hostPort}`],
      },
    },
    volumes: {},
  });
  const body = {
    schemaVersion: CAPABILITY_RUNTIME_LAUNCH_GROUP_SCHEMA_VERSION,
    id: input.id,
    version: "1.0.0",
    activationPolicy: "persistent" as const,
    acquisition: { kind: "compose" as const, projectName: input.projectName },
    materials,
    compose: {
      schemaVersion: "capability-runtime-compose-descriptor/1.0" as const,
      content,
      fingerprint: await fingerprintCapabilityRuntimeComposeContent(content),
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
