import { assertEquals, assertRejects } from "@std/assert";
import {
  GEOMETRY_EXECUTE_ADMITTED_SOURCE_CAPABILITY,
  GEOMETRY_EXPORT_ADMITTED_SOURCE_CAPABILITY,
  GEOMETRY_OBSERVE_ASSEMBLY_INTEGRITY_CAPABILITY,
  MANUFACTURING_RUN_DFM_CHECKS_CAPABILITY,
  MECHANICS_OBSERVE_PRESCRIBED_KINEMATICS_CAPABILITY,
  MECHANICS_OBSERVE_STATIC_STRUCTURAL_SENSITIVITY_CAPABILITY,
  MECHANICS_SOLVE_STATIC_STRUCTURAL_CAPABILITY,
  type RequiredEngineeringCapability,
} from "../../domain/capability/engineering-capability.ts";
import {
  PROJECT_CAPABILITY_DEMAND_SCHEMA_VERSION,
  type ProjectCapabilityDemand,
  type ProjectCapabilityOperationGroup,
} from "../../domain/capability/project-capability-demand.ts";
import {
  CAPABILITY_RUNTIME_ADMIN_LOCK_SCHEMA_VERSION,
  CAPABILITY_RUNTIME_ADMIN_POLICY_SCHEMA_VERSION,
  CAPABILITY_RUNTIME_HOST_OBSERVATION_SCHEMA_VERSION,
  type CapabilityRuntimeCatalog,
  fingerprintAtomicCapabilityRuntimeUnit,
  type ProjectCapabilityPlanningInput,
} from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import { planProjectCapability } from "./plan-project-capability.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "../../adapters/control-plane/first-party-capability-binding-catalog.ts";
import { MCP_BUILD123D_071_IMAGE_REFERENCE } from "../../adapters/control-plane/first-party-capability-runtime-launch-groups.ts";
import {
  validateCapabilityRuntimeAdminLock,
  validateCapabilityRuntimeAdminPolicy,
  validateCapabilityRuntimeHostObservation,
} from "../../adapters/control-plane/capability-runtime-catalog.ts";

Deno.test("project capability planner selects exact trusted bindings and deduplicates images by digest", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const plan = await planProjectCapability(
    await input(catalog, [
      requirement(GEOMETRY_EXPORT_ADMITTED_SOURCE_CAPABILITY, "preparation"),
      requirement(GEOMETRY_OBSERVE_ASSEMBLY_INTEGRITY_CAPABILITY),
      requirement(MECHANICS_SOLVE_STATIC_STRUCTURAL_CAPABILITY),
    ]),
  );

  assertEquals(plan.status, "ready");
  assertEquals(plan.activation, "allowed");
  assertEquals(plan.bindings.map((binding) => binding.binding?.id), [
    "build123d-export-admitted-source",
    "build123d-observe-assembly-integrity",
    "calculix-static-structural",
  ]);
  assertEquals(plan.bindings[0]?.candidate?.adapter, {
    id: "build123d-admitted-geometry-export-adapter",
    version: "1.0.0",
    source: "src/adapters/cad/canonical/admission-backed-geometry-export-adapter.ts",
  });
  assertEquals(
    plan.materials.filter((material) =>
      material.imageReference === MCP_BUILD123D_071_IMAGE_REFERENCE
    ).length,
    2,
  );
  assertEquals(plan.effects.downloadBytes, null);
  assertEquals(plan.effects.storageBytes, null);
  assertEquals(plan.effects.security, "reviewed");
  assertEquals(plan.effects.loopbackPorts, [3014, 3024]);
  assertEquals(plan.effects.privileged, false);
  assertEquals(plan.effects.dockerSocket, false);
  assertEquals(plan.effects.bindMounts, []);
  assertEquals(plan.effects.devices, []);
});

Deno.test("project capability planner selects the catalogued DFM measured-checks binding", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const plan = await planProjectCapability(
    await input(catalog, [
      requirement(MANUFACTURING_RUN_DFM_CHECKS_CAPABILITY),
    ]),
  );
  assertEquals(plan.status, "ready");
  assertEquals(plan.activation, "allowed");
  assertEquals(plan.bindings.map((binding) => binding.binding?.id), [
    "mcp-dfm-measured-checks",
  ]);
  assertEquals(plan.effects.loopbackPorts, [3018]);
});

Deno.test(
  "project capability planner selects admitted-source preparation without replacing execution",
  async () => {
    const catalog = await createFirstPartyCapabilityRuntimeCatalog();
    const plan = await planProjectCapability(
      await input(catalog, [
        requirement(GEOMETRY_EXECUTE_ADMITTED_SOURCE_CAPABILITY, "preparation"),
        requirement(GEOMETRY_EXECUTE_ADMITTED_SOURCE_CAPABILITY),
      ]),
    );

    assertEquals(plan.status, "ready");
    assertEquals(plan.activation, "allowed");
    assertEquals(
      plan.bindings.map((binding) => ({
        use: binding.requirement.use,
        id: binding.binding?.id,
      })),
      [
        { use: "execution", id: "build123d-execute-admitted-source" },
        { use: "preparation", id: "build123d-execute-admitted-source-preparation" },
      ],
    );
    assertEquals(
      plan.bindings[0]?.candidate?.adapter,
      plan.bindings[1]?.candidate?.adapter,
    );
    assertEquals(
      plan.bindings[0]?.candidate?.profile,
      plan.bindings[1]?.candidate?.profile,
    );
    assertEquals(plan.bindings[0]?.unitIds, ["casys.build123d-isolated-worker"]);
    assertEquals(plan.bindings[1]?.unitIds, ["casys.build123d-isolated-worker"]);
  },
);

Deno.test("project capability planner makes policy, revocation, ambiguity and availability literal", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const required = requirement(MECHANICS_SOLVE_STATIC_STRUCTURAL_CAPABILITY);
  const disabled = await planProjectCapability(
    await input(catalog, [required], {
      disabledBindingIds: ["calculix-static-structural"],
    }),
  );
  assertEquals(disabled.bindings[0]?.status, "disabled");

  const revokedCatalog = mutableCatalog(catalog);
  const binding = revokedCatalog.bindings.find((candidate) =>
    candidate.id === "calculix-static-structural"
  )!;
  (binding as { qualification: string }).qualification = "revoked";
  const revoked = await planProjectCapability(await input(revokedCatalog, [required]));
  assertEquals(revoked.bindings[0]?.status, "revoked");

  const ambiguousCatalog = mutableCatalog(catalog);
  (ambiguousCatalog.bindings as unknown as Array<
    (typeof ambiguousCatalog.bindings)[number]
  >).push({
    ...structuredClone(
      ambiguousCatalog.bindings.find((candidate) =>
        candidate.id === "calculix-static-structural"
      )!,
    ),
    id: "calculix-static-structural-alternative",
  });
  const ambiguous = await planProjectCapability(
    await input(ambiguousCatalog, [required]),
  );
  assertEquals(ambiguous.bindings[0]?.status, "ambiguous");

  const unavailable = await planProjectCapability(
    await input(catalog, [{
      id: "mechanics.unsupported",
      version: "1",
      use: "execution",
      minimumQualification: "qualified",
    }]),
  );
  assertEquals(unavailable.bindings[0]?.status, "unavailable");
  assertEquals(unavailable.activation, "blocked");
});

Deno.test("unqualified Chrono stays unavailable without an exact local attestation", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const plan = await planProjectCapability(
    await input(
      catalog,
      [requirement(MECHANICS_OBSERVE_PRESCRIBED_KINEMATICS_CAPABILITY)],
    ),
  );

  assertEquals(plan.bindings, [{
    requirement: requirement(MECHANICS_OBSERVE_PRESCRIBED_KINEMATICS_CAPABILITY),
    status: "unavailable",
    binding: null,
    unitIds: [],
    reasons: [
      "No enabled, non-revoked binding meets qualified qualification for mechanics.observe-prescribed-kinematics@1/execution.",
    ],
  }]);
  assertEquals(plan.materials, []);
  assertEquals(plan.activation, "blocked");
});

Deno.test("unqualified HTTP CalculiX sensitivity remains unavailable and selects no material", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const sensitivityRequirement = requirement(
    MECHANICS_OBSERVE_STATIC_STRUCTURAL_SENSITIVITY_CAPABILITY,
  );
  const plan = await planProjectCapability(
    await input(catalog, [sensitivityRequirement]),
  );

  assertEquals(plan.bindings, [{
    requirement: sensitivityRequirement,
    status: "unavailable",
    binding: null,
    unitIds: [],
    reasons: [
      "No enabled, non-revoked binding meets qualified qualification for mechanics.observe-static-structural-sensitivity@1/execution.",
    ],
  }]);
  assertEquals(plan.materials, []);
  assertEquals(plan.activation, "blocked");
});

Deno.test("project capability planner reports native, emulated, mismatch, and unknown platform states without inventing a provider", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const required = requirement(MECHANICS_SOLVE_STATIC_STRUCTURAL_CAPABILITY);
  const native = await planProjectCapability(await input(catalog, [required]));
  assertEquals(native.materials[0]?.mode, "native");

  const amd64Catalog = mutableCatalog(catalog);
  const material = amd64Catalog.units.find((unit) =>
    unit.id === "casys.calculix-worker"
  )!.materials[0]!;
  (material as unknown as { platforms: string[] }).platforms = ["linux/amd64"];
  await refreshCatalogUnitFingerprint(amd64Catalog, "casys.calculix-worker");
  const binding = amd64Catalog.bindings.find((candidate) =>
    candidate.id === "calculix-static-structural"
  )!;
  (binding as unknown as {
    runtimeModes: unknown[];
  }).runtimeModes = [{
    material: {
      unitId: "casys.calculix-worker",
      materialId: material.id,
      imageDigest: material.imageReference.slice(
        material.imageReference.lastIndexOf("@sha256:") + 8,
      ),
    },
    targetPlatform: "linux/amd64",
    mode: "emulated",
    qualificationAttestationFingerprint: {
      algorithm: "sha256",
      digest: "e".repeat(64),
    },
  }];
  const emulated = await planProjectCapability(
    await input(amd64Catalog, [required]),
  );
  assertEquals(emulated.materials[0]?.mode, "emulated");

  (binding as unknown as { runtimeModes: unknown[] }).runtimeModes = [];
  const mismatched = await planProjectCapability(await input(amd64Catalog, [required]));
  assertEquals(mismatched.bindings[0]?.status, "incompatible");

  (material as unknown as { platforms: string[] }).platforms = [];
  await refreshCatalogUnitFingerprint(amd64Catalog, "casys.calculix-worker");
  const unknown = await planProjectCapability(await input(amd64Catalog, [required]));
  assertEquals(unknown.bindings[0]?.status, "unavailable");
});

Deno.test("the project capability demand boundary remains provider-neutral", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const projectDemand = demand([
    requirement(MECHANICS_SOLVE_STATIC_STRUCTURAL_CAPABILITY),
  ]);
  const serialized = JSON.stringify(projectDemand);
  for (const forbidden of ["provider", "image", "endpoint", "tool", "args"]) {
    assertEquals(serialized.includes(`\"${forbidden}\"`), false);
  }
  const plan = await planProjectCapability(
    await input(catalog, projectDemand.plannedCeiling.capabilityRequirements),
  );
  assertEquals(plan.bindings[0]?.binding?.id, "calculix-static-structural");
});

Deno.test("project capability planning is a pure read-only projection", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const planningInput = await input(catalog, [
    requirement(MECHANICS_SOLVE_STATIC_STRUCTURAL_CAPABILITY),
  ]);
  const before = structuredClone(planningInput);

  const plan = await planProjectCapability(planningInput);

  assertEquals(planningInput, before);
  assertEquals(plan.mutatesRuntime, false);
});

Deno.test("an unresolved actual project demand blocks planning even without capabilities", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const unresolvedGroup: ProjectCapabilityOperationGroup = {
    operation: { id: "operation.not-registered", version: "1" },
    workItemIds: ["work-unresolved"],
    resolution: "unresolved",
    reason: "operation-unregistered",
  };
  const planningInput = await input(catalog, []);

  const plan = await planProjectCapability({
    ...planningInput,
    demand: demand([], [unresolvedGroup]),
  });

  assertEquals(plan.status, "unresolved");
  assertEquals(plan.activation, "blocked");
  assertEquals(plan.bindings, []);
  assertEquals(plan.materials, []);
  assertEquals(plan.blockers, [
    "Operation operation.not-registered@1 is unresolved: operation-unregistered.",
    "Project capability demand is unresolved; no host capability plan may be trusted.",
  ]);
});

Deno.test("planner rejects a stale unit manifest and does not trust a lock by id alone", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const mutatedCatalog = mutableCatalog(catalog);
  const mutableUnit = mutableCatalogUnit(mutatedCatalog, "casys.calculix-worker");
  (mutableUnit.materials[0]!.effects.services[0] as { id: string }).id =
    "calculix-worker-mutated";

  await assertRejects(
    async () =>
      await planProjectCapability(
        {
          ...(await input(catalog, [
            requirement(MECHANICS_SOLVE_STATIC_STRUCTURAL_CAPABILITY),
          ])),
          catalog: mutatedCatalog,
        },
      ),
    TypeError,
    "stale manifest fingerprint",
  );

  const planningInput = await input(catalog, [
    requirement(MECHANICS_SOLVE_STATIC_STRUCTURAL_CAPABILITY),
  ]);
  const staleLock = JSON.parse(
    JSON.stringify(planningInput.lock),
  ) as typeof planningInput.lock;
  (staleLock.units.find((unit) => unit.id === "casys.calculix-worker")!
    .manifestFingerprint as { digest: string }).digest = "0".repeat(64);
  const lockedPlan = await planProjectCapability({ ...planningInput, lock: staleLock });

  assertEquals(lockedPlan.status, "blocked");
  assertEquals(lockedPlan.activation, "blocked");
  assertEquals(lockedPlan.materials[0]?.desired, "absent");
  assertEquals(
    lockedPlan.blockers.some((blocker) =>
      blocker.includes("does not match its exact version and manifest fingerprint")
    ),
    true,
  );
});

Deno.test("planner fails closed on runtime conflicts and deduplicates byte estimates by OCI digest", async () => {
  const requirements = [
    requirement(GEOMETRY_EXPORT_ADMITTED_SOURCE_CAPABILITY, "preparation"),
    requirement(GEOMETRY_OBSERVE_ASSEMBLY_INTEGRITY_CAPABILITY),
  ];

  const portConflict = mutableCatalog(await createFirstPartyCapabilityRuntimeCatalog());
  mutableCatalogUnit(portConflict, "casys.mcp-build123d-observation")
    .materials[0]!.effects.loopbackPorts = [3024];
  await refreshCatalogUnitFingerprint(portConflict, "casys.mcp-build123d-observation");
  await assertRejects(
    async () => await planProjectCapability(await input(portConflict, requirements)),
    TypeError,
    "Loopback port 3024",
  );

  const serviceConflict = mutableCatalog(
    await createFirstPartyCapabilityRuntimeCatalog(),
  );
  const service = mutableCatalogUnit(serviceConflict, "casys.mcp-build123d-observation")
    .materials[0]!.effects.services[0] as { id: string; lifecycle: string };
  service.id = "mcp-build123d-sandbox";
  service.lifecycle = "ephemeral";
  await refreshCatalogUnitFingerprint(
    serviceConflict,
    "casys.mcp-build123d-observation",
  );
  await assertRejects(
    async () => await planProjectCapability(await input(serviceConflict, requirements)),
    TypeError,
    "Runtime service mcp-build123d-sandbox has contradictory declarations",
  );

  const volumeConflict = mutableCatalog(
    await createFirstPartyCapabilityRuntimeCatalog(),
  );
  const volume = mutableCatalogUnit(volumeConflict, "casys.mcp-build123d-observation")
    .materials[0]!.effects.volumes[0] as {
      id: string;
      access: "read-only" | "read-write";
    };
  volume.id = "build123d-sandbox-exports";
  volume.access = "read-only";
  await refreshCatalogUnitFingerprint(
    volumeConflict,
    "casys.mcp-build123d-observation",
  );
  await assertRejects(
    async () => await planProjectCapability(await input(volumeConflict, requirements)),
    TypeError,
    "Runtime volume build123d-sandbox-exports has contradictory declarations",
  );

  const digestDeduplication = mutableCatalog(
    await createFirstPartyCapabilityRuntimeCatalog(),
  );
  const sandbox = mutableCatalogUnit(
    digestDeduplication,
    "casys.mcp-build123d-sandbox",
  );
  const observer = mutableCatalogUnit(
    digestDeduplication,
    "casys.mcp-build123d-observation",
  );
  (sandbox.materials[0]!.effects as { downloadBytes: number; storageBytes: number })
    .downloadBytes = 4;
  (sandbox.materials[0]!.effects as { downloadBytes: number; storageBytes: number })
    .storageBytes = 5;
  (observer.materials[0]!.effects as { downloadBytes: number; storageBytes: number })
    .downloadBytes = 4;
  (observer.materials[0]!.effects as { downloadBytes: number; storageBytes: number })
    .storageBytes = 5;
  (observer.materials[0] as { imageReference: string }).imageReference = observer
    .materials[0]!.imageReference.replace(
      "ghcr.io/casys-ai",
      "mirror.example.test",
    );
  await refreshCatalogUnitFingerprint(
    digestDeduplication,
    "casys.mcp-build123d-sandbox",
  );
  await refreshCatalogUnitFingerprint(
    digestDeduplication,
    "casys.mcp-build123d-observation",
  );
  const deduplicatedPlan = await planProjectCapability(
    await input(digestDeduplication, requirements),
  );
  assertEquals(deduplicatedPlan.effects.downloadBytes, 4);
  assertEquals(deduplicatedPlan.effects.storageBytes, 5);
});

async function input(
  catalog: CapabilityRuntimeCatalog,
  requirements: readonly RequiredEngineeringCapability[],
  options: {
    readonly disabledBindingIds?: readonly string[];
  } = {},
): Promise<ProjectCapabilityPlanningInput> {
  const references = [
    ...new Set(
      catalog.units.flatMap((unit) =>
        unit.materials.map((material) => material.imageReference)
      ),
    ),
  ];
  return {
    demand: demand(requirements),
    catalog,
    policy: validateCapabilityRuntimeAdminPolicy({
      schemaVersion: CAPABILITY_RUNTIME_ADMIN_POLICY_SCHEMA_VERSION,
      disabledBindingIds: options.disabledBindingIds ?? [],
      preferences: [],
    }, catalog),
    host: validateCapabilityRuntimeHostObservation({
      schemaVersion: CAPABILITY_RUNTIME_HOST_OBSERVATION_SCHEMA_VERSION,
      identityFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      platform: "linux/arm64",
      images: references.map((reference) => ({ reference, sizeBytes: null })),
    }),
    lock: await validateCapabilityRuntimeAdminLock({
      schemaVersion: CAPABILITY_RUNTIME_ADMIN_LOCK_SCHEMA_VERSION,
      revision: 1,
      previous: { algorithm: "sha256", digest: "a".repeat(64) },
      units: catalog.units.map((unit) => ({
        id: unit.id,
        version: unit.version,
        manifestFingerprint: unit.manifestFingerprint,
        desired: "active",
      })),
    }, catalog),
  };
}

function requirement(
  capability: { readonly id: string; readonly version: string },
  use: "preparation" | "execution" = "execution",
): RequiredEngineeringCapability {
  return { ...capability, use, minimumQualification: "qualified" };
}

function demand(
  requirements: readonly RequiredEngineeringCapability[],
  unresolvedOperationGroups: readonly ProjectCapabilityOperationGroup[] = [],
): ProjectCapabilityDemand {
  const plannedCeiling = {
    status: unresolvedOperationGroups.length === 0
      ? "resolved" as const
      : "unresolved" as const,
    operationGroups: unresolvedOperationGroups,
    capabilityRequirements: requirements,
  };
  const approvedBriefBasis = {
    kind: "approved-brief" as const,
    projectId: "capability-plan-test",
    projectSnapshotId: "capability-plan-test:r2",
    projectRevision: 2,
    briefId: "capability-plan-test:brief",
    briefSnapshotId: "capability-plan-test:brief:r1",
    briefRevision: 1,
    approvedBriefFingerprint: { algorithm: "sha256" as const, digest: "c".repeat(64) },
  };
  return {
    schemaVersion: PROJECT_CAPABILITY_DEMAND_SCHEMA_VERSION,
    mutatesRuntime: false,
    status: plannedCeiling.status,
    projectSnapshot: {
      projectId: "capability-plan-test",
      snapshotId: "capability-plan-test:r3",
      revision: 3,
    },
    approvedBriefBasis,
    plan: {
      startingPoint: "idea-or-spec",
      basis: approvedBriefBasis,
      publishedAt: "2026-08-29T00:00:00.000Z",
      publishedBy: { id: "agent:capability-planner", origin: "agent" },
    },
    workItemHistory: [],
    plannedCeiling,
    jitDemand: {
      status: "resolved",
      operationGroups: [],
      capabilityRequirements: [],
    },
    historyPathFingerprint: { algorithm: "sha256", digest: "9".repeat(64) },
    plannedCeilingFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
    jitDemandFingerprint: { algorithm: "sha256", digest: "8".repeat(64) },
    registryFingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
  } satisfies ProjectCapabilityDemand;
}

function mutableCatalogUnit(
  catalog: CapabilityRuntimeCatalog,
  id: string,
): {
  id: string;
  version: string;
  manifestFingerprint: { algorithm: "sha256"; digest: string };
  materials: Array<{
    id: string;
    kind: string;
    imageReference: string;
    platforms: string[];
    lifecycle: string;
    effects: {
      downloadBytes: number | null;
      storageBytes: number | null;
      services: Array<{ id: string; lifecycle: string }>;
      volumes: Array<{
        id: string;
        access: "read-only" | "read-write";
        preservation: string;
      }>;
      loopbackPorts: number[];
    };
  }>;
} {
  const unit = (catalog.units as unknown as Array<unknown>).find((candidate) =>
    (candidate as { id: string }).id === id
  );
  if (!unit) throw new TypeError(`Test catalogue has no ${id}.`);
  return unit as ReturnType<typeof mutableCatalogUnit>;
}

function mutableCatalog(catalog: CapabilityRuntimeCatalog): CapabilityRuntimeCatalog {
  return JSON.parse(JSON.stringify(catalog)) as CapabilityRuntimeCatalog;
}

async function refreshCatalogUnitFingerprint(
  catalog: CapabilityRuntimeCatalog,
  id: string,
): Promise<void> {
  const unit = mutableCatalogUnit(catalog, id);
  unit.manifestFingerprint = await fingerprintAtomicCapabilityRuntimeUnit(
    unit as unknown as import("../../domain/capability/runtime/capability-runtime-catalog.ts").AtomicCapabilityRuntimeUnit,
  );
}
