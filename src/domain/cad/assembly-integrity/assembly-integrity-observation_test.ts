import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import { fingerprintResourceBytes } from "../../compile/source/provider-resource-reader.ts";
import {
  GEOMETRY_MODULE_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
  GEOMETRY_MODULE_PLACEMENT_CONVENTION,
  GEOMETRY_MODULE_UNIT_SYSTEM,
} from "../geometry-module-contract.ts";
import {
  GEOMETRY_MODULE_ASSEMBLY_ASSETS,
  GEOMETRY_MODULE_ASSEMBLY_RECEIPT_SCHEMA,
} from "../module-assembly/geometry-module-assembly-receipt.ts";
import { GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY } from "../../capability/engineering-capability.ts";
import { createGeometryModuleInputBundle } from "../module-assembly/geometry-module-input-bundle.ts";
import { parseGeometryModuleCapture } from "../canonical/geometry-module-capture.ts";
import {
  ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA,
  createAssemblyIntegrityInputBundle,
  parseAssemblyIntegrityInputBundle,
} from "./assembly-integrity-input-bundle.ts";
import {
  ASSEMBLY_INTEGRITY_OBSERVATION_SCHEMA,
  assemblyIntegrityExpectedPlacementMatrix,
  parseAssemblyIntegrityObservation,
  parseAssemblyIntegrityTransformMatrix,
  VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
} from "./assembly-integrity-observation.ts";
import { createAssemblyIntegrityObserverProfile } from "./assembly-integrity-observer-profile.ts";
import {
  ExactAssemblyIntegrityInputReopener,
  ExactAssemblyIntegrityInputResolutionError,
} from "../../../adapters/cad/assembly-integrity/exact-assembly-integrity-input-reopener.ts";
import {
  ExactStaticAssemblyBasisReopener,
} from "../../../adapters/cad/canonical/exact-static-assembly-basis-reopener.ts";
import {
  FixedAssemblyIntegrityObserverProfileCatalog,
} from "../../../adapters/cad/assembly-integrity/fixed-assembly-integrity-observer-profile-catalog.ts";
import {
  McpBuild123dAssemblyIntegrityObserver,
} from "../../../adapters/cad/assembly-integrity/mcp-build123d-assembly-integrity-observer.ts";
import { FileCanonicalAssetReader } from "../../../adapters/assets/canonical-asset-reader.ts";
import {
  GEOMETRY_MODULE_ASSET_DERIVATION_RATIONALE,
  geometryModuleAssemblyStepArtifactId,
  geometryModuleBinaryProducer,
} from "../../../adapters/cad/canonical/design-write-geometry-module-seal.ts";
import { GEOMETRY_CAPTURE_URI_PREFIX } from "../../../adapters/shared/cas/file-capture-store.ts";
import {
  GEOMETRY_BINARY_CAPTURE_USE_RATIONALE,
  GEOMETRY_BINARY_TRACE_RATIONALE,
} from "../canonical/geometry-bundle.ts";
import type { McpToolClient } from "../../../application/ports/out/mcp-tool-client.ts";
import type { ThreadSnapshot } from "../../thread/thread-snapshot.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);

Deno.test("assembly-integrity bundle binds one exact canonical module capture and STEP", async () => {
  const { source, stepBytes } = await validSource();
  const bundle = await createAssemblyIntegrityInputBundle(source);
  const reopened = await parseAssemblyIntegrityInputBundle(bundle.bytes.copy());

  assertEquals(reopened.manifest.schemaVersion, ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA);
  assertEquals(
    {
      schemaVersion: reopened.manifest.geometryModule.schemaVersion,
      artifactId: reopened.manifest.geometryModule.artifactId,
      fingerprint: reopened.manifest.geometryModule.fingerprint,
    },
    source.geometryModule,
  );
  assertEquals(reopened.manifest.assemblyStep.byteOffset, 0);
  assertEquals(reopened.manifest.assemblyStep.byteCount, stepBytes.byteLength);
  assertEquals(
    reopened.manifest.occurrences.map((occurrence) => occurrence.usageElementId),
    ["usage-arm", "usage-base"],
  );
  assertEquals(reopened.manifest.method, source.method);
  assertEquals(reopened.assemblyStep.copy(), stepBytes);

  const tampered = bundle.bytes.copy();
  tampered[tampered.byteLength - 1] ^= 1;
  await assertRejects(
    () => parseAssemblyIntegrityInputBundle(tampered),
    TypeError,
    "failed exact rehash",
  );
});

Deno.test("assembly-integrity observations preserve facts without creating a verdict", async () => {
  const { source } = await validSource();
  const bundle = await createAssemblyIntegrityInputBundle(source);
  const observation = observedResult(bundle);
  const parsed = parseAssemblyIntegrityObservation(observation, bundle);

  assertEquals(parsed.operation, VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION);
  assertEquals(parsed.importability, { status: "observed", value: "imported" });
  assertEquals(parsed.importFacts, {
    unitSystem: { status: "observed", value: "mm" },
    solidCount: { status: "observed", value: 2 },
  });
  assertEquals(parsed.topology.brepValidity, { status: "observed", value: "valid" });
  assertEquals(parsed.occurrences[0]?.usageElementId, "usage-arm");
  assertEquals(parsed.pairs, [{
    firstUsageElementId: "usage-arm",
    secondUsageElementId: "usage-base",
    linearToleranceMm: 0.01,
    minimumDistanceMm: { status: "observed", value: 1.5 },
    intersectionVolumeMm3: { status: "observed", value: 0 },
    contact: { status: "observed", value: "no-contact" },
  }]);

  assertThrows(
    () =>
      parseAssemblyIntegrityObservation({ ...observation, verdict: "pass" }, bundle),
    TypeError,
    "unsupported field verdict",
  );
  assertThrows(
    () =>
      parseAssemblyIntegrityObservation({
        ...observation,
        inputBundle: { ...observation.inputBundle, fingerprint: fp(A) },
      }, bundle),
    TypeError,
    "exact packed bundle",
  );
  assertThrows(
    () =>
      parseAssemblyIntegrityObservation({
        ...observation,
        method: { ...observation.method, version: "2.0.0" },
      }, bundle),
    TypeError,
    "exact bound method",
  );
  assertThrows(
    () =>
      parseAssemblyIntegrityObservation({
        ...observation,
        pairs: [{
          ...observation.pairs[0],
          firstUsageElementId: "usage-base",
          secondUsageElementId: "usage-arm",
        }],
      }, bundle),
    TypeError,
    "exact canonical pair order",
  );
  assertThrows(
    () =>
      parseAssemblyIntegrityObservation({
        ...observation,
        occurrences: Array.from({ length: 33 }, () => observation.occurrences[0]),
      }, bundle),
    TypeError,
    "occurrence ceiling",
  );
  assertThrows(
    () =>
      parseAssemblyIntegrityObservation({
        ...observation,
        pairs: Array.from({ length: 497 }, () => observation.pairs[0]),
      }, bundle),
    TypeError,
    "pair ceiling",
  );
});

Deno.test("assembly-integrity failed imports retain expected-sized literal observability gaps", async () => {
  const { source } = await validSource();
  const bundle = await createAssemblyIntegrityInputBundle(source);
  const observation = observedResult(bundle);
  const incomplete = {
    ...observation,
    importability: { status: "observed" as const, value: "failed" as const },
    importFacts: {
      unitSystem: {
        status: "unresolved" as const,
        reason: "observability-missing" as const,
      },
      solidCount: {
        status: "unresolved" as const,
        reason: "observability-missing" as const,
      },
    },
    topology: {
      brepValidity: {
        status: "unresolved" as const,
        reason: "observability-missing" as const,
      },
      degenerateEdgeCount: {
        status: "unresolved" as const,
        reason: "observability-missing" as const,
      },
      freeEdgeCount: {
        status: "unresolved" as const,
        reason: "observability-missing" as const,
      },
      shellCount: {
        status: "unresolved" as const,
        reason: "observability-missing" as const,
      },
    },
    occurrences: observation.occurrences.map((occurrence) => ({
      ...occurrence,
      target: {
        status: "unresolved" as const,
        reason: "observability-missing" as const,
      },
      transform: {
        status: "unresolved" as const,
        reason: "observability-missing" as const,
      },
    })),
    pairs: observation.pairs.map((pair) => ({
      ...pair,
      minimumDistanceMm: {
        status: "unresolved" as const,
        reason: "observability-missing" as const,
      },
      intersectionVolumeMm3: {
        status: "unresolved" as const,
        reason: "observability-missing" as const,
      },
      contact: {
        status: "unresolved" as const,
        reason: "observability-missing" as const,
      },
    })),
  };
  const parsed = parseAssemblyIntegrityObservation(incomplete, bundle);
  assertEquals(parsed.importability, { status: "observed", value: "failed" });
  assertEquals(parsed.importFacts.unitSystem.status, "unresolved");
  assertEquals(parsed.topology.brepValidity.status, "unresolved");
  assertEquals(parsed.occurrences[0]?.target.status, "unresolved");
  assertEquals(parsed.pairs[0]?.intersectionVolumeMm3.status, "unresolved");

  assertThrows(
    () =>
      parseAssemblyIntegrityObservation({
        ...incomplete,
        topology: {
          ...incomplete.topology,
          freeEdgeCount: { status: "unavailable", reason: "unsupported" },
        },
      }, bundle),
    TypeError,
    "must remain unresolved",
  );
});

Deno.test("assembly-integrity transforms recross expected XYZ and reject non-rigid observations", async () => {
  const { source } = await validSource();
  const bundle = await createAssemblyIntegrityInputBundle(source);
  const observation = observedResult(bundle);
  const arm = bundle.manifest.occurrences[0]!;
  assertEquals(arm.usageElementId, "usage-arm");
  const expectedMatrix = assemblyIntegrityExpectedPlacementMatrix(
    arm.expectedPlacement,
  );
  assertEquals(expectedMatrix[2], 1);
  assertEquals(expectedMatrix[8], -1);
  assertEquals(expectedMatrix.slice(12), [0, 0, 0, 1]);
  assertEquals(Math.abs(expectedMatrix[0]!) < 1e-12, true);
  const normalizedZero = parseAssemblyIntegrityTransformMatrix([
    1,
    -0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
  ]);
  assertEquals(Object.is(normalizedZero[1], -0), false);
  assertThrows(
    () =>
      parseAssemblyIntegrityObservation({
        ...observation,
        occurrences: observation.occurrences.map((occurrence, index) =>
          index === 0
            ? {
              ...occurrence,
              transform: {
                status: "observed" as const,
                value: {
                  ...occurrence.transform.value,
                  observedMatrix: [
                    2,
                    0,
                    0,
                    0,
                    0,
                    1,
                    0,
                    0,
                    0,
                    0,
                    1,
                    0,
                    0,
                    0,
                    0,
                    1,
                  ],
                },
              },
            }
            : occurrence
        ),
      }, bundle),
    TypeError,
    "not unit length",
  );
});

Deno.test("assembly-integrity transforms recross the Build123d multi-axis placement order", async () => {
  const placement = {
    translationMm: [4, 5, 6] as const,
    rotationDeg: [10, 20, 30] as const,
  };
  const matrix = assemblyIntegrityExpectedPlacementMatrix(placement);
  const expectedRow = [
    0.8137976813493738,
    -0.46984631039295416,
    0.3420201433256687,
  ];
  for (const [index, value] of expectedRow.entries()) {
    assertEquals(Math.abs(matrix[index]! - value) < 1e-12, true);
  }
  assertEquals(matrix.slice(3, 4), [4]);
  assertEquals(matrix.slice(7, 8), [5]);
  assertEquals(matrix.slice(11), [6, 0, 0, 0, 1]);

  const { source } = await validSource({ armPlacement: placement });
  const bundle = await createAssemblyIntegrityInputBundle(source);
  const observation = observedResult(bundle);
  const parsed = parseAssemblyIntegrityObservation(observation, bundle);
  const arm = parsed.occurrences.find((occurrence) =>
    occurrence.usageElementId === "usage-arm"
  );
  assertEquals(arm?.transform, {
    status: "observed",
    value: {
      expectedPlacement: placement,
      expectedMatrix: matrix,
      observedMatrix: matrix,
    },
  });

  const oldRzRyRx = [
    0.8137976813493738,
    -0.44096961052988237,
    0.37852230636979245,
    4,
    0.46984631039295416,
    0.8825641192593856,
    0.01802831123629725,
    5,
    -0.3420201433256687,
    0.16317591116653482,
    0.9254165783983234,
    6,
    0,
    0,
    0,
    1,
  ];
  assertThrows(
    () =>
      parseAssemblyIntegrityObservation({
        ...observation,
        occurrences: observation.occurrences.map((occurrence) =>
          occurrence.usageElementId === "usage-arm"
            ? {
              ...occurrence,
              transform: {
                status: "observed" as const,
                value: {
                  ...occurrence.transform.value,
                  expectedMatrix: oldRzRyRx,
                },
              },
            }
            : occurrence
        ),
      }, bundle),
    TypeError,
    "must be derived from the exact bundle placement",
  );
});

Deno.test("mcp-build123d adapter sends only exact STEP and normalizes factual provenance", async () => {
  const { source } = await validSource();
  const profiles = new FixedAssemblyIntegrityObserverProfileCatalog({
    imageDigest: fp(A),
  });
  const profile = await profiles.initial();
  const bundle = await createAssemblyIntegrityInputBundle({
    ...source,
    method: profile.method,
  });
  const calls: Parameters<McpToolClient["callTool"]>[0][] = [];
  const client: McpToolClient = {
    callTool(call) {
      calls.push(call);
      return Promise.resolve({
        structuredContent: rawObservedResult(bundle),
        text: "observed",
      });
    },
    callToolTextResult() {
      return Promise.reject(
        new Error("text result is not part of this fixed adapter contract"),
      );
    },
  };
  const observer = new McpBuild123dAssemblyIntegrityObserver({ client });
  const result = await observer.observe({
    inputBundle: bundle,
    profile,
  });

  assertEquals(calls.length, 1);
  assertEquals(calls[0]?.name, "build123d_observe_assembly_integrity");
  assertEquals(Object.keys(calls[0]?.arguments ?? {}), ["step"]);
  assertEquals(calls[0]?.arguments, {
    step: {
      mimeType: "model/step",
      sha256: bundle.manifest.assemblyStep.sha256,
      bytes: bundle.assemblyStep.byteLength,
      blob: bundle.assemblyStep.copy().toBase64(),
    },
  });
  assertEquals(result.execution.profile.fingerprint, profile.profileFingerprint);
  assertEquals(result.execution.raw.producer, {
    service: "mcp-build123d",
    packageVersion: "0.7.1",
    tool: "build123d_observe_assembly_integrity",
    engine: { id: "cadquery-ocp", version: "7.9.3.1" },
  });
  assertEquals(result.observation.importability, {
    status: "observed",
    value: "imported",
  });
  assertEquals(
    result.observation.occurrences[0]?.transform.status,
    "observed",
  );

  const failedClient: McpToolClient = {
    callTool() {
      return Promise.resolve({
        structuredContent: rawFailedResult(bundle),
        text: "failed",
      });
    },
    callToolTextResult() {
      return Promise.reject(
        new Error("text result is not part of this fixed adapter contract"),
      );
    },
  };
  const failed = await new McpBuild123dAssemblyIntegrityObserver({
    client: failedClient,
  }).observe({
    inputBundle: bundle,
    profile,
  });
  assertEquals(failed.observation.importability, {
    status: "observed",
    value: "failed",
  });
  assertEquals(
    failed.observation.occurrences.length,
    bundle.manifest.occurrences.length,
  );
  assertEquals(failed.observation.occurrences[0]?.transform, {
    status: "unresolved",
    reason: "observability-missing",
  });
});

Deno.test("mcp-build123d adapter refuses a divergent exact profile before dispatch", async () => {
  const { source } = await validSource();
  const profiles = new FixedAssemblyIntegrityObserverProfileCatalog({
    imageDigest: fp(A),
  });
  const profile = await profiles.initial();
  const bundle = await createAssemblyIntegrityInputBundle({
    ...source,
    method: profile.method,
  });
  const divergentProfile = await createAssemblyIntegrityObserverProfile({
    schemaVersion: profile.schemaVersion,
    profile: profile.profile,
    capability: profile.capability,
    method: profile.method,
    producer: {
      rawSchemaVersion: profile.producer.rawSchemaVersion,
      engine: profile.producer.engine,
      package: { id: profile.producer.package.id, version: "0.5.1" },
    },
    configuredRuntime: profile.configuredRuntime,
    maximumStepBytes: profile.maximumStepBytes,
    maximumOccurrences: profile.maximumOccurrences,
    maximumPairs: profile.maximumPairs,
  });
  let calls = 0;
  const observer = new McpBuild123dAssemblyIntegrityObserver({
    client: {
      callTool() {
        calls += 1;
        return Promise.resolve({ structuredContent: {}, text: "unexpected" });
      },
      callToolTextResult() {
        return Promise.reject(new Error("unexpected text result"));
      },
    },
  });

  await assertRejects(
    () => observer.observe({ inputBundle: bundle, profile: divergentProfile }),
    TypeError,
    "does not match the fixed mcp-build123d adapter contract",
  );
  assertEquals(calls, 0);
});

Deno.test("exact reopener recrosses geometry-module primary, sealed STEP graph, and signed profile", async () => {
  const { source, stepBytes } = await validSource();
  const capture = await parseGeometryModuleCapture(source.geometryModuleCapture);
  const primary = {
    id: source.geometryModule.artifactId,
    name: "Canonical module capture",
    kind: "cad-model" as const,
    version: source.geometryModule.fingerprint.digest,
    fingerprint: source.geometryModule.fingerprint,
    uri:
      `${GEOMETRY_CAPTURE_URI_PREFIX}sha256/${source.geometryModule.fingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "design.write-geometry@1",
      runId: capture.trustedRunId,
    },
    inputArtifactIds: [],
    freshness: {
      status: "fresh" as const,
      changedAt: capture.sealedAt,
      invalidatedByChangeIds: [],
    },
  };
  const stepId = geometryModuleAssemblyStepArtifactId(
    primary.fingerprint.digest,
    capture.assemblyStep.fingerprint.digest,
  );
  const step = {
    id: stepId,
    name: `Authoritative STEP: ${capture.manifest.target.label}`,
    kind: "step" as const,
    version: capture.assemblyStep.fingerprint.digest,
    fingerprint: capture.assemblyStep.fingerprint,
    uri: `/api/thread/assets/${capture.assemblyStep.fingerprint.digest}.step`,
    mediaType: "model/step",
    producer: geometryModuleBinaryProducer(capture.receipt),
    inputArtifactIds: [primary.id],
    freshness: {
      status: "fresh" as const,
      changedAt: capture.sealedAt,
      invalidatedByChangeIds: [],
    },
  };
  const consumptionId = `consume-${primary.id}-by-${step.id}`;
  const snapshot = {
    id: "assembly-integrity-basis",
    revision: 1,
    subject: { id: "assembly-subject" },
    artifacts: [primary, step],
    consumptions: [{
      id: consumptionId,
      artifactId: primary.id,
      consumer: step.producer,
      observedFingerprint: primary.fingerprint,
      verifiedAt: capture.sealedAt,
      status: "verified" as const,
    }],
    provenance: [
      {
        id: `traces-${step.id}-from-${primary.id}`,
        relation: "traces_to" as const,
        from: { kind: "artifact" as const, id: step.id },
        to: { kind: "artifact" as const, id: primary.id },
        rationale: GEOMETRY_BINARY_TRACE_RATIONALE,
      },
      {
        id: `uses-${consumptionId}`,
        relation: "uses" as const,
        from: { kind: "consumption" as const, id: consumptionId },
        to: { kind: "artifact" as const, id: primary.id },
        rationale: GEOMETRY_BINARY_CAPTURE_USE_RATIONALE,
      },
      {
        id: `derived-from-module-primary-${step.id}`,
        relation: "derived_from" as const,
        from: { kind: "artifact" as const, id: step.id },
        to: { kind: "artifact" as const, id: primary.id },
        rationale: GEOMETRY_MODULE_ASSET_DERIVATION_RATIONALE,
      },
    ],
    changeSet: { changes: [] },
  } as unknown as ThreadSnapshot;
  const directory = await Deno.makeTempDir({ prefix: "assembly-integrity-step-" });
  try {
    await Deno.writeFile(
      `${directory}/${capture.assemblyStep.fingerprint.digest}.step`,
      stepBytes,
    );
    const profiles = new FixedAssemblyIntegrityObserverProfileCatalog({
      imageDigest: fp(A),
    });
    const profile = await profiles.initial();
    const staticBasis = new ExactStaticAssemblyBasisReopener({
      geometryCaptures: {
        read(fingerprint) {
          return Promise.resolve(
            fingerprint.digest === source.geometryModule.fingerprint.digest
              ? deterministicJson(capture)
              : undefined,
          );
        },
      },
      stepAssets: new FileCanonicalAssetReader({ directory }),
    });
    const resolvedBasis = await staticBasis.resolve({
      basis: {
        snapshotId: snapshot.id,
        revision: snapshot.revision,
        subjectId: snapshot.subject.id,
      },
      snapshot,
      geometryModule: source.geometryModule,
    });
    const mutatedStepCopy = resolvedBasis.assemblyStepBytes.copy();
    mutatedStepCopy[0] = 0;
    assertEquals(resolvedBasis.primary.id, primary.id);
    assertEquals(resolvedBasis.assemblyStep.id, step.id);
    assertEquals(resolvedBasis.assemblyStepBytes.copy(), stepBytes);

    const reopener = new ExactAssemblyIntegrityInputReopener({
      basis: staticBasis,
      profiles,
    });
    const resolved = await reopener.resolve({
      basis: {
        snapshotId: snapshot.id,
        revision: snapshot.revision,
        subjectId: snapshot.subject.id,
      },
      snapshot,
      geometryModule: source.geometryModule,
      observerProfile: {
        profile: profile.profile,
        fingerprint: profile.profileFingerprint,
      },
    });
    assertEquals(resolved.primary.id, primary.id);
    assertEquals(resolved.assemblyStep.id, step.id);
    assertEquals(resolved.inputBundle.manifest.method, profile.method);
    assertEquals(resolved.observerProfile.fingerprint, profile.profileFingerprint);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("exact assembly-integrity input validates the named basis before profile I/O", async () => {
  let profileReads = 0;
  const reopener = new ExactAssemblyIntegrityInputReopener({
    basis: {
      resolve() {
        return Promise.reject(new Error("static basis must not run"));
      },
    },
    profiles: {
      initial() {
        profileReads += 1;
        return Promise.reject(new Error("profile.initial must not run"));
      },
      resolve() {
        profileReads += 1;
        return Promise.reject(new Error("profile.resolve must not run"));
      },
    },
  });
  await assertRejects(
    () =>
      reopener.resolve({
        basis: { snapshotId: "snap-1", revision: 1, subjectId: "subject-1" },
        snapshot: { id: "snap-1", revision: 1 } as unknown as ThreadSnapshot,
        geometryModule: {
          schemaVersion: GEOMETRY_MODULE_CAPTURE_SCHEMA,
          artifactId: "geometry-module",
          fingerprint: fp(A),
        },
        observerProfile: {
          profile: { id: "assembly-integrity-observer", version: "1.0.0" },
          fingerprint: fp(B),
        },
      }),
    ExactAssemblyIntegrityInputResolutionError,
    "persisted Thread snapshot",
  );
  await assertRejects(
    () =>
      reopener.resolve({
        basis: { snapshotId: "snap-1", revision: 1, subjectId: "subject-1" },
        snapshot: {
          id: "snap-1",
          revision: 1,
          subject: { id: "subject-1" },
        } as unknown as ThreadSnapshot,
        geometryModule: {
          schemaVersion: "geometry-part-capture/1.0",
          artifactId: "geometry-module",
          fingerprint: fp(A),
        } as never,
        observerProfile: {
          profile: { id: "assembly-integrity-observer", version: "1.0.0" },
          fingerprint: fp(B),
        },
      }),
    TypeError,
    'schemaVersion must equal "geometry-module-capture/1.0"',
  );
  assertEquals(profileReads, 0);
});

Deno.test("exact assembly-integrity input refuses a static basis that diverges from the named identity", async () => {
  const profiles = new FixedAssemblyIntegrityObserverProfileCatalog({
    imageDigest: fp(A),
  });
  const profile = await profiles.initial();
  const geometryModule = {
    schemaVersion: GEOMETRY_MODULE_CAPTURE_SCHEMA,
    artifactId: "geometry-module",
    fingerprint: fp(A),
  };
  const snapshot = {
    id: "snap-1",
    revision: 1,
    subject: { id: "subject-1" },
  } as unknown as ThreadSnapshot;
  const reopener = new ExactAssemblyIntegrityInputReopener({
    basis: {
      resolve() {
        return Promise.resolve({
          basis: { snapshotId: "snap-other", revision: 1, subjectId: "subject-1" },
          geometryModule,
          primary: { id: "geometry-module" },
          assemblyStep: { id: "step-1" },
          capture: {},
          assemblyStepBytes: {
            byteLength: 1,
            copy: () => new Uint8Array([1]),
          },
        } as never);
      },
    },
    profiles,
  });
  await assertRejects(
    () =>
      reopener.resolve({
        basis: { snapshotId: "snap-1", revision: 1, subjectId: "subject-1" },
        snapshot,
        geometryModule,
        observerProfile: {
          profile: profile.profile,
          fingerprint: profile.profileFingerprint,
        },
      }),
    ExactAssemblyIntegrityInputResolutionError,
    "diverges from the requested canonical geometry identity",
  );
});

async function validSource(
  options: {
    readonly armPlacement?: {
      readonly translationMm: readonly [number, number, number];
      readonly rotationDeg: readonly [number, number, number];
    };
  } = {},
) {
  const childArm = step("CHILD ARM");
  const childBase = step("CHILD BASE");
  const assemblyStep = step("ASSEMBLY");
  const assemblyGlb = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 1, 2, 3, 4]);
  const armPlacement = options.armPlacement ?? {
    translationMm: [0, 0, 0] as const,
    rotationDeg: [0, 90, 0] as const,
  };
  const childBundle = await createGeometryModuleInputBundle([
    {
      usageElementId: "usage-base",
      partDefinitionElementId: "definition-base",
      placement: { translationMm: [10, 0, 0], rotationDeg: [0, 0, 0] },
      childCapture: {
        schemaVersion: "geometry-part-capture/1.0",
        artifactId: "geometry-part-base",
        fingerprint: fp(C),
      },
      stepBytes: childBase,
    },
    {
      usageElementId: "usage-arm",
      partDefinitionElementId: "definition-arm",
      placement: armPlacement,
      childCapture: {
        schemaVersion: "geometry-part-capture/1.0",
        artifactId: "geometry-part-arm",
        fingerprint: fp(D),
      },
      stepBytes: childArm,
    },
  ]);
  const armStepSha = await fingerprintResourceBytes(childArm);
  const baseStepSha = await fingerprintResourceBytes(childBase);
  const assemblyStepSha = await fingerprintResourceBytes(assemblyStep);
  const assemblyGlbSha = await fingerprintResourceBytes(assemblyGlb);
  const runId = "run-module-assembly";
  const receipt = {
    schemaVersion: GEOMETRY_MODULE_ASSEMBLY_RECEIPT_SCHEMA,
    capability: GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY,
    runId,
    inputBundle: {
      fingerprint: childBundle.fingerprint,
      byteCount: childBundle.bytes.byteLength,
    },
    assembly: {
      step: {
        ...GEOMETRY_MODULE_ASSEMBLY_ASSETS.step,
        fingerprint: fp(assemblyStepSha),
        byteCount: assemblyStep.byteLength,
      },
      glb: {
        ...GEOMETRY_MODULE_ASSEMBLY_ASSETS.glb,
        fingerprint: fp(assemblyGlbSha),
        byteCount: assemblyGlb.byteLength,
      },
    },
    implementation: {
      id: "fixture-neutral-cad-assembler",
      version: "2026.1",
      evidenceFingerprint: fp(B),
    },
  } as const;
  const children = childBundle.manifest.occurrences.map((occurrence) => ({
    usageElementId: occurrence.usageElementId,
    partDefinitionElementId: occurrence.partDefinitionElementId,
    placement: occurrence.placement,
    placementCapture: fp(B),
    childGeometry: occurrence.childCapture,
    authoritativeStep: {
      fingerprint: fp(
        occurrence.usageElementId === "usage-arm" ? armStepSha : baseStepSha,
      ),
      bytes: occurrence.step.byteCount,
    },
  }));
  const inputBundle = {
    schemaVersion: GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
    fingerprint: childBundle.fingerprint,
    byteCount: childBundle.bytes.byteLength,
    manifest: childBundle.manifest,
  };
  const manifest = {
    schemaVersion: "geometry-module-manifest/1.0",
    architectureBasis: {
      snapshotId: "architecture-snapshot",
      revision: 1,
      artifactFingerprint: fp(A),
    },
    structureCapture: {
      schemaVersion: "part-definitions-capture/1.0",
      artifactId: `part-definitions-${C}`,
      fingerprint: fp(C),
      uri: `casys://part-definitions-capture/sha256/${C}`,
      byteCount: 1,
      architecture: {
        artifactId: `architecture-${A}`,
        fingerprint: fp(A),
        uri: `casys://architecture-capture/sha256/${A}`,
      },
    },
    target: { partDefinitionElementId: "definition-assembly", label: "Assembly" },
    placementAnalysis: {
      schemaVersion: "cad-placement-analysis-capture-locator/1.0",
      kind: "cad-placement-analysis-capture-locator",
      fingerprint: fp(B),
      byteCount: 1,
      casUri: `casys://cad-placement-analysis-capture/sha256/${B}`,
    },
    children,
    unitSystem: GEOMETRY_MODULE_UNIT_SYSTEM,
    placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
    assembly: {
      inputBundle,
      step: { fingerprint: fp(assemblyStepSha) },
      glb: { fingerprint: fp(assemblyGlbSha) },
    },
  };
  const capture = {
    schemaVersion: GEOMETRY_MODULE_CAPTURE_SCHEMA,
    operation: { id: "design.write-geometry", version: "1" },
    trustedRunId: "run-geometry-module",
    draftDigest: A,
    manifest,
    architectureBasis: {
      artifactId: `architecture-${A}`,
      fingerprint: fp(A),
      producerRunId: "run-architecture",
    },
    structureCapture: manifest.structureCapture,
    placementAnalysis: manifest.placementAnalysis,
    children,
    inputBundle,
    receipt,
    assemblyStep: { fingerprint: fp(assemblyStepSha), bytes: assemblyStep.byteLength },
    assemblyGlb: { fingerprint: fp(assemblyGlbSha), bytes: assemblyGlb.byteLength },
    sealedAt: "2026-08-26T10:00:00.000Z",
  };
  const parsedCapture = await parseGeometryModuleCapture(capture);
  const captureFingerprint = await sha256Fingerprint(parsedCapture);
  return {
    source: {
      geometryModule: {
        schemaVersion: GEOMETRY_MODULE_CAPTURE_SCHEMA,
        artifactId: `geometry-${captureFingerprint.digest}`,
        fingerprint: captureFingerprint,
      },
      geometryModuleCapture: capture,
      assemblyStepBytes: assemblyStep,
      method: {
        id: "occt-assembly-observer",
        version: "1.0.0",
        linearToleranceMm: 0.01,
      },
    },
    stepBytes: assemblyStep,
  };
}

function observedResult(
  bundle: Awaited<ReturnType<typeof createAssemblyIntegrityInputBundle>>,
) {
  return {
    schemaVersion: ASSEMBLY_INTEGRITY_OBSERVATION_SCHEMA,
    operation: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
    inputBundle: {
      schemaVersion: ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA,
      fingerprint: bundle.fingerprint,
      byteCount: bundle.bytes.byteLength,
    },
    method: bundle.manifest.method,
    importability: { status: "observed" as const, value: "imported" as const },
    importFacts: {
      unitSystem: { status: "observed" as const, value: "mm" as const },
      solidCount: { status: "observed" as const, value: 2 },
    },
    topology: {
      brepValidity: { status: "observed" as const, value: "valid" as const },
      degenerateEdgeCount: { status: "observed" as const, value: 0 },
      freeEdgeCount: { status: "observed" as const, value: 0 },
      shellCount: { status: "observed" as const, value: 1 },
    },
    occurrences: bundle.manifest.occurrences.map((occurrence) => ({
      usageElementId: occurrence.usageElementId,
      target: {
        status: "observed" as const,
        value: { partDefinitionElementId: occurrence.partDefinitionElementId },
      },
      transform: {
        status: "observed" as const,
        value: {
          expectedPlacement: occurrence.expectedPlacement,
          expectedMatrix: assemblyIntegrityExpectedPlacementMatrix(
            occurrence.expectedPlacement,
          ),
          observedMatrix: assemblyIntegrityExpectedPlacementMatrix(
            occurrence.expectedPlacement,
          ),
        },
      },
    })),
    pairs: [{
      firstUsageElementId: bundle.manifest.occurrences[0]!.usageElementId,
      secondUsageElementId: bundle.manifest.occurrences[1]!.usageElementId,
      linearToleranceMm: bundle.manifest.method.linearToleranceMm,
      minimumDistanceMm: { status: "observed" as const, value: 1.5 },
      intersectionVolumeMm3: { status: "observed" as const, value: 0 },
      contact: { status: "observed" as const, value: "no-contact" as const },
    }],
  };
}

function rawObservedResult(
  bundle: Awaited<ReturnType<typeof createAssemblyIntegrityInputBundle>>,
) {
  const labels = bundle.manifest.occurrences.map(
    (occurrence) => occurrence.usageElementId,
  );
  return {
    schemaVersion: "build123d-assembly-integrity-observation/1.0",
    kind: "assembly-integrity-observation",
    producer: {
      service: "mcp-build123d",
      packageVersion: "0.7.1",
      tool: "build123d_observe_assembly_integrity",
      engine: { name: "cadquery-ocp", version: "7.9.3.1" },
    },
    inputArtifact: {
      mimeType: "model/step",
      sha256: bundle.manifest.assemblyStep.sha256,
      bytes: bundle.assemblyStep.byteLength,
    },
    method: {
      id: "occt-assembly-integrity-v1",
      version: "1.0.0",
      linearToleranceMm: 0.000001,
    },
    importability: { status: "observed" as const, value: "imported" as const },
    unitSystem: { status: "observed" as const, value: "mm" as const },
    topology: {
      brepValidity: { status: "observed" as const, value: "valid" as const },
      solidCount: { status: "observed" as const, value: 2 },
      shellCount: { status: "observed" as const, value: 1 },
      degenerateEdgeCount: { status: "observed" as const, value: 0 },
      freeEdgeCount: { status: "observed" as const, value: 0 },
    },
    occurrences: {
      status: "observed" as const,
      value: bundle.manifest.occurrences.map((occurrence) => ({
        label: occurrence.usageElementId,
        transform: {
          status: "observed" as const,
          value: assemblyIntegrityExpectedPlacementMatrix(
            occurrence.expectedPlacement,
          ),
        },
      })),
    },
    pairs: {
      status: "observed" as const,
      value: labels.flatMap((firstLabel, first) =>
        labels.slice(first + 1).map((secondLabel) => ({
          firstLabel,
          secondLabel,
          linearToleranceMm: 0.000001,
          minimumDistanceMm: { status: "observed" as const, value: 1.5 },
          intersectionVolumeMm3: { status: "observed" as const, value: 0 },
          contact: { status: "observed" as const, value: "no-contact" as const },
        }))
      ),
    },
  };
}

function rawFailedResult(
  bundle: Awaited<ReturnType<typeof createAssemblyIntegrityInputBundle>>,
) {
  const observed = rawObservedResult(bundle);
  const gap = {
    status: "unresolved" as const,
    reason: "observability-missing" as const,
  };
  return {
    ...observed,
    importability: { status: "observed" as const, value: "failed" as const },
    unitSystem: gap,
    topology: {
      brepValidity: gap,
      solidCount: gap,
      shellCount: gap,
      degenerateEdgeCount: gap,
      freeEdgeCount: gap,
    },
    occurrences: gap,
    pairs: gap,
  };
}

function fp(digest: string) {
  return { algorithm: "sha256" as const, digest };
}

function step(marker: string): Uint8Array {
  return new TextEncoder().encode(
    `ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n/* ${marker} */\nENDSEC;\nEND-ISO-10303-21;\n`,
  );
}
