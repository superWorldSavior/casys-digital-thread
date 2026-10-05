/**
 * Named adapter for the fixed mcp-build123d assembly-integrity tool.
 *
 * It sends only one exact canonical STEP, recrosses the provider's closed
 * factual schema, and returns normalized DT facts plus opaque call provenance.
 * It contains no project id, MRTR, verdict, local OCCT worker, runtime choice,
 * retry policy, WAL, public tool registration, or generic runTool escape hatch.
 */

import type { McpToolClient } from "../../../application/ports/out/mcp-tool-client.ts";
import type {
  AssemblyIntegrityObserver,
  AssemblyIntegrityObserverExecution,
  AssemblyIntegrityObserverRequest,
  AssemblyIntegrityObserverResult,
} from "../../../application/ports/out/cad/assembly-integrity/assembly-integrity-observer.ts";
import type { AssemblyIntegrityInputBundle } from "../../../domain/cad/assembly-integrity/assembly-integrity-input-bundle.ts";
import {
  ASSEMBLY_INTEGRITY_OBSERVATION_SCHEMA,
  assemblyIntegrityExpectedPlacementMatrix,
  type AssemblyIntegrityFact,
  type AssemblyIntegrityObservation,
  parseAssemblyIntegrityObservation,
  parseAssemblyIntegrityTransformMatrix,
  VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-observation.ts";
import {
  type AssemblyIntegrityObserverProfile,
  validateAssemblyIntegrityObserverProfile,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-observer-profile.ts";
import {
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  safeId,
  safeVersion,
} from "../../../domain/kernel/case-validation.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";

export const MCP_BUILD123D_ASSEMBLY_INTEGRITY_TOOL =
  "build123d_observe_assembly_integrity" as const;

const MCP_BUILD123D_RAW_SCHEMA =
  "build123d-assembly-integrity-observation/1.0" as const;
const MCP_BUILD123D_SERVICE = "mcp-build123d" as const;
const MCP_BUILD123D_PACKAGE_VERSION = "0.7.1" as const;
const MCP_BUILD123D_ENGINE = Object.freeze(
  {
    name: "cadquery-ocp",
    version: "7.9.3.1",
  } as const,
);
const MCP_BUILD123D_METHOD = Object.freeze(
  {
    id: "occt-assembly-integrity-v1",
    version: "1.0.0",
    linearToleranceMm: 0.000001,
  } as const,
);

type RawOccurrence = {
  readonly label: string;
  readonly transform: AssemblyIntegrityFact<readonly number[]>;
};

type RawPair = {
  readonly firstLabel: string;
  readonly secondLabel: string;
  readonly linearToleranceMm: number;
  readonly minimumDistanceMm: AssemblyIntegrityFact<number>;
  readonly intersectionVolumeMm3: AssemblyIntegrityFact<number>;
  readonly contact: AssemblyIntegrityFact<"contact" | "no-contact">;
};

interface RawAssemblyIntegrityObservation {
  readonly schemaVersion: string;
  readonly producer: {
    readonly service: string;
    readonly packageVersion: string;
    readonly tool: string;
    readonly engine: { readonly name: string; readonly version: string };
  };
  readonly importability: AssemblyIntegrityFact<"imported" | "failed">;
  readonly unitSystem: AssemblyIntegrityFact<"mm">;
  readonly topology: {
    readonly brepValidity: AssemblyIntegrityFact<"valid" | "invalid">;
    readonly solidCount: AssemblyIntegrityFact<number>;
    readonly shellCount: AssemblyIntegrityFact<number>;
    readonly degenerateEdgeCount: AssemblyIntegrityFact<number>;
    readonly freeEdgeCount: AssemblyIntegrityFact<number>;
  };
  readonly occurrences: AssemblyIntegrityFact<readonly RawOccurrence[]>;
  readonly pairs: AssemblyIntegrityFact<readonly RawPair[]>;
}

export interface McpBuild123dAssemblyIntegrityObserverOptions {
  readonly client: McpToolClient;
}

/**
 * Calls one fixed provider tool over an exact profile already reopened by the
 * server. It cannot replace that profile with a newer catalogue entry.
 */
export class McpBuild123dAssemblyIntegrityObserver
  implements AssemblyIntegrityObserver {
  readonly #client: McpToolClient;

  constructor(options: McpBuild123dAssemblyIntegrityObserverOptions) {
    const root = exactRecord(
      options,
      ["client"],
      "$mcpBuild123dAssemblyIntegrityObserver",
    );
    this.#client = root.client as McpToolClient;
  }

  async observe(
    value: AssemblyIntegrityObserverRequest,
  ): Promise<AssemblyIntegrityObserverResult> {
    const requestValue = exactRecord(
      value,
      ["inputBundle", "profile"],
      "$mcpBuild123dAssemblyIntegrityObserver.request",
    );
    const input = requestValue.inputBundle as AssemblyIntegrityInputBundle;
    const profile = await validateAssemblyIntegrityObserverProfile(
      requestValue.profile,
    );
    assertFixedAdapterProfile(profile);
    assertBoundInput(input, profile);
    const request = requestFor(input);
    const requestFingerprint = await sha256Fingerprint(request);
    const result = await this.#client.callTool({
      name: MCP_BUILD123D_ASSEMBLY_INTEGRITY_TOOL,
      arguments: request,
    });
    const responseFingerprint = await sha256Fingerprint(result.structuredContent);
    const raw = parseRawObservation(result.structuredContent, input, profile);
    const observation = normalizeObservation(raw, input, profile);
    const execution = deepFreeze<AssemblyIntegrityObserverExecution>({
      profile: {
        id: profile.profile.id,
        version: profile.profile.version,
        fingerprint: profile.profileFingerprint,
      },
      configuredRuntime: profile.configuredRuntime,
      raw: {
        schemaVersion: raw.schemaVersion,
        producer: {
          service: raw.producer.service,
          packageVersion: raw.producer.packageVersion,
          tool: raw.producer.tool,
          engine: {
            id: raw.producer.engine.name,
            version: raw.producer.engine.version,
          },
        },
        requestFingerprint,
        responseFingerprint,
      },
    });
    return deepFreeze({ observation, execution });
  }
}

function requestFor(input: AssemblyIntegrityInputBundle): {
  readonly step: {
    readonly mimeType: "model/step";
    readonly sha256: string;
    readonly bytes: number;
    readonly blob: string;
  };
} {
  const bytes = input.assemblyStep.copy();
  return deepFreeze({
    step: {
      mimeType: "model/step" as const,
      sha256: input.manifest.assemblyStep.sha256,
      bytes: bytes.byteLength,
      blob: bytes.toBase64(),
    },
  });
}

function assertFixedAdapterProfile(profile: AssemblyIntegrityObserverProfile): void {
  if (
    profile.producer.rawSchemaVersion !== MCP_BUILD123D_RAW_SCHEMA ||
    profile.producer.package.id !== MCP_BUILD123D_SERVICE ||
    profile.producer.package.version !== MCP_BUILD123D_PACKAGE_VERSION ||
    profile.producer.engine.id !== MCP_BUILD123D_ENGINE.name ||
    profile.producer.engine.version !== MCP_BUILD123D_ENGINE.version ||
    !Object.is(profile.method.linearToleranceMm, MCP_BUILD123D_METHOD.linearToleranceMm)
  ) {
    throw new TypeError(
      "The server-selected observer profile does not match the fixed mcp-build123d adapter contract.",
    );
  }
}

function assertBoundInput(
  input: AssemblyIntegrityInputBundle,
  profile: AssemblyIntegrityObserverProfile,
): void {
  const method = input.manifest.method;
  if (
    method.id !== profile.method.id || method.version !== profile.method.version ||
    !Object.is(method.linearToleranceMm, profile.method.linearToleranceMm) ||
    input.assemblyStep.byteLength > profile.maximumStepBytes ||
    input.manifest.occurrences.length > profile.maximumOccurrences
  ) {
    throw new TypeError(
      "The assembly-integrity input bundle is not bound to the server-selected observer profile.",
    );
  }
}

function parseRawObservation(
  value: unknown,
  input: AssemblyIntegrityInputBundle,
  profile: AssemblyIntegrityObserverProfile,
): RawAssemblyIntegrityObservation {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "kind",
      "producer",
      "inputArtifact",
      "method",
      "importability",
      "unitSystem",
      "topology",
      "occurrences",
      "pairs",
    ],
    "$mcpBuild123dAssemblyIntegrityObservation",
  );
  if (root.schemaVersion !== profile.producer.rawSchemaVersion) {
    throw new TypeError("The provider raw schema does not match the selected profile.");
  }
  literalValue(
    root.kind,
    "assembly-integrity-observation",
    "$mcpBuild123dAssemblyIntegrityObservation.kind",
  );
  const producer = parseRawProducer(root.producer, profile);
  assertRawInputArtifact(root.inputArtifact, input);
  assertRawMethod(root.method, profile);
  const importability = parseFact(
    root.importability,
    "$mcpBuild123dAssemblyIntegrityObservation.importability",
    (candidate, path) => enumValue(candidate, ["imported", "failed"] as const, path),
  );
  if (importability.status !== "observed") {
    throw new TypeError("The fixed provider must state an observed importability.");
  }
  const unitSystem = parseFact(
    root.unitSystem,
    "$mcpBuild123dAssemblyIntegrityObservation.unitSystem",
    (candidate, path) => enumValue(candidate, ["mm"] as const, path),
  );
  const topology = parseRawTopology(root.topology);
  const occurrences = parseFact(
    root.occurrences,
    "$mcpBuild123dAssemblyIntegrityObservation.occurrences",
    parseRawOccurrences,
  );
  const pairs = parseFact(
    root.pairs,
    "$mcpBuild123dAssemblyIntegrityObservation.pairs",
    parseRawPairs,
  );
  assertRawBranchInvariants(importability, unitSystem, topology, occurrences, pairs);
  return deepFreeze({
    schemaVersion: profile.producer.rawSchemaVersion,
    producer,
    importability,
    unitSystem,
    topology,
    occurrences,
    pairs,
  });
}

function parseRawProducer(
  value: unknown,
  profile: AssemblyIntegrityObserverProfile,
): RawAssemblyIntegrityObservation["producer"] {
  const root = exactRecord(
    value,
    ["service", "packageVersion", "tool", "engine"],
    "$mcpBuild123dAssemblyIntegrityObservation.producer",
  );
  const engine = exactRecord(
    root.engine,
    ["name", "version"],
    "$mcpBuild123dAssemblyIntegrityObservation.producer.engine",
  );
  const producer = deepFreeze({
    service: safeId(
      root.service,
      "$mcpBuild123dAssemblyIntegrityObservation.producer.service",
    ),
    packageVersion: safeVersion(
      root.packageVersion,
      "$mcpBuild123dAssemblyIntegrityObservation.producer.packageVersion",
    ),
    tool: safeId(
      root.tool,
      "$mcpBuild123dAssemblyIntegrityObservation.producer.tool",
    ),
    engine: {
      name: safeId(
        engine.name,
        "$mcpBuild123dAssemblyIntegrityObservation.producer.engine.name",
      ),
      version: safeVersion(
        engine.version,
        "$mcpBuild123dAssemblyIntegrityObservation.producer.engine.version",
      ),
    },
  });
  if (
    producer.service !== MCP_BUILD123D_SERVICE ||
    producer.packageVersion !== MCP_BUILD123D_PACKAGE_VERSION ||
    producer.tool !== MCP_BUILD123D_ASSEMBLY_INTEGRITY_TOOL ||
    producer.engine.name !== MCP_BUILD123D_ENGINE.name ||
    producer.engine.version !== MCP_BUILD123D_ENGINE.version ||
    producer.service !== profile.producer.package.id ||
    producer.packageVersion !== profile.producer.package.version ||
    producer.engine.name !== profile.producer.engine.id ||
    producer.engine.version !== profile.producer.engine.version
  ) {
    throw new TypeError(
      "The provider producer provenance does not match the fixed adapter and selected profile.",
    );
  }
  return producer;
}

function assertRawInputArtifact(
  value: unknown,
  input: AssemblyIntegrityInputBundle,
): void {
  const root = exactRecord(
    value,
    ["mimeType", "sha256", "bytes"],
    "$mcpBuild123dAssemblyIntegrityObservation.inputArtifact",
  );
  if (
    root.mimeType !== "model/step" ||
    root.sha256 !== input.manifest.assemblyStep.sha256 ||
    root.bytes !== input.assemblyStep.byteLength
  ) {
    throw new TypeError(
      "The provider response does not recross the exact canonical STEP identity.",
    );
  }
}

function assertRawMethod(
  value: unknown,
  profile: AssemblyIntegrityObserverProfile,
): void {
  const root = exactRecord(
    value,
    ["id", "version", "linearToleranceMm"],
    "$mcpBuild123dAssemblyIntegrityObservation.method",
  );
  if (
    root.id !== MCP_BUILD123D_METHOD.id ||
    root.version !== MCP_BUILD123D_METHOD.version ||
    !Object.is(root.linearToleranceMm, MCP_BUILD123D_METHOD.linearToleranceMm) ||
    !Object.is(root.linearToleranceMm, profile.method.linearToleranceMm)
  ) {
    throw new TypeError(
      "The provider factual method does not match the fixed adapter and selected profile.",
    );
  }
}

function parseRawTopology(
  value: unknown,
): RawAssemblyIntegrityObservation["topology"] {
  const root = exactRecord(
    value,
    [
      "brepValidity",
      "solidCount",
      "shellCount",
      "degenerateEdgeCount",
      "freeEdgeCount",
    ],
    "$mcpBuild123dAssemblyIntegrityObservation.topology",
  );
  return deepFreeze({
    brepValidity: parseFact(
      root.brepValidity,
      "$mcpBuild123dAssemblyIntegrityObservation.topology.brepValidity",
      (candidate, path) => enumValue(candidate, ["valid", "invalid"] as const, path),
    ),
    solidCount: parseFact(
      root.solidCount,
      "$mcpBuild123dAssemblyIntegrityObservation.topology.solidCount",
      nonNegativeInteger,
    ),
    shellCount: parseFact(
      root.shellCount,
      "$mcpBuild123dAssemblyIntegrityObservation.topology.shellCount",
      nonNegativeInteger,
    ),
    degenerateEdgeCount: parseFact(
      root.degenerateEdgeCount,
      "$mcpBuild123dAssemblyIntegrityObservation.topology.degenerateEdgeCount",
      nonNegativeInteger,
    ),
    freeEdgeCount: parseFact(
      root.freeEdgeCount,
      "$mcpBuild123dAssemblyIntegrityObservation.topology.freeEdgeCount",
      nonNegativeInteger,
    ),
  });
}

function parseRawOccurrences(value: unknown, path: string): readonly RawOccurrence[] {
  if (!Array.isArray(value) || value.length > 32) {
    throw new TypeError(`${path} exceeds the fixed occurrence bound.`);
  }
  const occurrences = value.map((entry, index) => {
    const root = exactRecord(entry, ["label", "transform"], `${path}[${index}]`);
    return deepFreeze({
      label: asciiLabel(root.label, `${path}[${index}].label`),
      transform: parseFact(
        root.transform,
        `${path}[${index}].transform`,
        parseAssemblyIntegrityTransformMatrix,
      ),
    });
  });
  const labels = occurrences.map((occurrence) => occurrence.label);
  if (
    new Set(labels).size !== labels.length ||
    labels.some((label, index) => index > 0 && labels[index - 1]! >= label)
  ) {
    throw new TypeError(`${path} labels must be unique and ASCII-sorted.`);
  }
  return deepFreeze(occurrences);
}

function parseRawPairs(value: unknown, path: string): readonly RawPair[] {
  if (!Array.isArray(value) || value.length > 496) {
    throw new TypeError(`${path} exceeds the fixed pair bound.`);
  }
  return deepFreeze(value.map((entry, index) => {
    const root = exactRecord(
      entry,
      [
        "firstLabel",
        "secondLabel",
        "linearToleranceMm",
        "minimumDistanceMm",
        "intersectionVolumeMm3",
        "contact",
      ],
      `${path}[${index}]`,
    );
    const firstLabel = asciiLabel(root.firstLabel, `${path}[${index}].firstLabel`);
    const secondLabel = asciiLabel(
      root.secondLabel,
      `${path}[${index}].secondLabel`,
    );
    if (
      firstLabel >= secondLabel ||
      !Object.is(root.linearToleranceMm, MCP_BUILD123D_METHOD.linearToleranceMm)
    ) {
      throw new TypeError(`${path}[${index}] has a noncanonical pair identity.`);
    }
    return {
      firstLabel,
      secondLabel,
      linearToleranceMm: MCP_BUILD123D_METHOD.linearToleranceMm,
      minimumDistanceMm: parseFact(
        root.minimumDistanceMm,
        `${path}[${index}].minimumDistanceMm`,
        nonNegativeFinite,
      ),
      intersectionVolumeMm3: parseFact(
        root.intersectionVolumeMm3,
        `${path}[${index}].intersectionVolumeMm3`,
        nonNegativeFinite,
      ),
      contact: parseFact(
        root.contact,
        `${path}[${index}].contact`,
        (candidate, candidatePath) =>
          enumValue(
            candidate,
            ["contact", "no-contact"] as const,
            candidatePath,
          ),
      ),
    } as RawPair;
  }));
}

function assertRawBranchInvariants(
  importability: AssemblyIntegrityFact<"imported" | "failed">,
  unitSystem: AssemblyIntegrityFact<"mm">,
  topology: RawAssemblyIntegrityObservation["topology"],
  occurrences: AssemblyIntegrityFact<readonly RawOccurrence[]>,
  pairs: AssemblyIntegrityFact<readonly RawPair[]>,
): void {
  const unresolvedObservability = (fact: AssemblyIntegrityFact<unknown>): boolean =>
    fact.status === "unresolved" && fact.reason === "observability-missing";
  if (importability.status === "observed" && importability.value === "failed") {
    if (
      !unresolvedObservability(unitSystem) ||
      !Object.values(topology).every(unresolvedObservability) ||
      !unresolvedObservability(occurrences) ||
      !unresolvedObservability(pairs)
    ) {
      throw new TypeError(
        "A failed provider import must retain literal downstream observability gaps.",
      );
    }
    return;
  }
  if (occurrences.status === "observed") {
    if (pairs.status !== "observed") {
      throw new TypeError(
        "Observed provider occurrences require a complete provider pair table.",
      );
    }
    const expected = expectedRawPairs(occurrences.value.map((entry) => entry.label));
    if (
      pairs.value.length !== expected.length ||
      pairs.value.some((pair, index) =>
        pair.firstLabel !== expected[index]![0] ||
        pair.secondLabel !== expected[index]![1]
      )
    ) {
      throw new TypeError(
        "Observed provider pairs must cover exact sorted occurrence pairs.",
      );
    }
  } else if (pairs.status === "observed") {
    throw new TypeError("Provider pairs cannot be observed without occurrence labels.");
  }
}

function normalizeObservation(
  raw: RawAssemblyIntegrityObservation,
  input: AssemblyIntegrityInputBundle,
  profile: AssemblyIntegrityObserverProfile,
): AssemblyIntegrityObservation {
  const normalized = {
    schemaVersion: ASSEMBLY_INTEGRITY_OBSERVATION_SCHEMA,
    operation: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
    inputBundle: {
      schemaVersion: input.manifest.schemaVersion,
      fingerprint: input.fingerprint,
      byteCount: input.bytes.byteLength,
    },
    method: profile.method,
    importability: raw.importability,
    importFacts: {
      unitSystem: raw.unitSystem,
      solidCount: raw.topology.solidCount,
    },
    topology: {
      brepValidity: raw.topology.brepValidity,
      degenerateEdgeCount: raw.topology.degenerateEdgeCount,
      freeEdgeCount: raw.topology.freeEdgeCount,
      shellCount: raw.topology.shellCount,
    },
    occurrences: normalizeOccurrences(raw.occurrences, input),
    pairs: normalizePairs(raw.pairs, input, profile.method.linearToleranceMm),
  };
  return parseAssemblyIntegrityObservation(normalized, input);
}

function normalizeOccurrences(
  raw: AssemblyIntegrityFact<readonly RawOccurrence[]>,
  input: AssemblyIntegrityInputBundle,
) {
  if (raw.status !== "observed") {
    return input.manifest.occurrences.map((occurrence) => ({
      usageElementId: occurrence.usageElementId,
      target: gapFrom(raw),
      transform: gapFrom(raw),
    }));
  }
  if (
    raw.value.length !== input.manifest.occurrences.length ||
    raw.value.some((occurrence, index) =>
      occurrence.label !== input.manifest.occurrences[index]!.usageElementId
    )
  ) {
    throw new TypeError(
      "Provider occurrence labels do not recross the exact input bundle identities.",
    );
  }
  return raw.value.map((rawOccurrence, index) => {
    const expected = input.manifest.occurrences[index]!;
    return {
      usageElementId: expected.usageElementId,
      target: {
        status: "observed" as const,
        value: { partDefinitionElementId: expected.partDefinitionElementId },
      },
      transform: rawOccurrence.transform.status === "observed"
        ? {
          status: "observed" as const,
          value: {
            expectedPlacement: expected.expectedPlacement,
            expectedMatrix: assemblyIntegrityExpectedPlacementMatrix(
              expected.expectedPlacement,
            ),
            observedMatrix: rawOccurrence.transform.value,
          },
        }
        : gapFrom(rawOccurrence.transform),
    };
  });
}

function normalizePairs(
  raw: AssemblyIntegrityFact<readonly RawPair[]>,
  input: AssemblyIntegrityInputBundle,
  linearToleranceMm: number,
) {
  const expected = expectedInputPairs(input);
  if (raw.status !== "observed") {
    return expected.map((pair) => ({
      ...pair,
      linearToleranceMm,
      minimumDistanceMm: gapFrom(raw),
      intersectionVolumeMm3: gapFrom(raw),
      contact: gapFrom(raw),
    }));
  }
  if (
    raw.value.length !== expected.length ||
    raw.value.some((pair, index) =>
      pair.firstLabel !== expected[index]!.firstUsageElementId ||
      pair.secondLabel !== expected[index]!.secondUsageElementId ||
      !Object.is(pair.linearToleranceMm, linearToleranceMm)
    )
  ) {
    throw new TypeError(
      "Provider pair labels or tolerance do not recross the exact input bundle.",
    );
  }
  return raw.value.map((pair, index) => ({
    ...expected[index]!,
    linearToleranceMm,
    minimumDistanceMm: pair.minimumDistanceMm,
    intersectionVolumeMm3: pair.intersectionVolumeMm3,
    contact: pair.contact,
  }));
}

function gapFrom<T>(
  fact: Exclude<AssemblyIntegrityFact<T>, { readonly status: "observed" }>,
): Exclude<AssemblyIntegrityFact<unknown>, { readonly status: "observed" }> {
  return fact.status === "unresolved"
    ? { status: "unresolved", reason: fact.reason }
    : { status: "unavailable", reason: "unsupported" };
}

function expectedInputPairs(input: AssemblyIntegrityInputBundle): readonly {
  readonly firstUsageElementId: string;
  readonly secondUsageElementId: string;
}[] {
  const result: { firstUsageElementId: string; secondUsageElementId: string }[] = [];
  for (let first = 0; first < input.manifest.occurrences.length; first += 1) {
    for (
      let second = first + 1;
      second < input.manifest.occurrences.length;
      second += 1
    ) {
      result.push({
        firstUsageElementId: input.manifest.occurrences[first]!.usageElementId,
        secondUsageElementId: input.manifest.occurrences[second]!.usageElementId,
      });
    }
  }
  return result;
}

function expectedRawPairs(
  labels: readonly string[],
): readonly (readonly [string, string])[] {
  const result: [string, string][] = [];
  for (let first = 0; first < labels.length; first += 1) {
    for (let second = first + 1; second < labels.length; second += 1) {
      result.push([labels[first]!, labels[second]!]);
    }
  }
  return result;
}

function parseFact<T>(
  value: unknown,
  path: string,
  parseObserved: (value: unknown, path: string) => T,
): AssemblyIntegrityFact<T> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be a factual state object.`);
  }
  const status = (value as Record<string, unknown>).status;
  if (status === "observed") {
    const root = exactRecord(value, ["status", "value"], path);
    return deepFreeze({
      status: "observed" as const,
      value: parseObserved(root.value, `${path}.value`),
    });
  }
  if (status === "unresolved") {
    const root = exactRecord(value, ["status", "reason"], path);
    if (root.reason !== "identity-missing" && root.reason !== "observability-missing") {
      throw new TypeError(`${path}.reason is unsupported.`);
    }
    return deepFreeze({ status: "unresolved" as const, reason: root.reason });
  }
  if (status === "unavailable") {
    const root = exactRecord(value, ["status", "reason"], path);
    literalValue(root.reason, "unsupported", `${path}.reason`);
    return deepFreeze({ status: "unavailable" as const, reason: "unsupported" });
  }
  throw new TypeError(`${path}.status is unsupported.`);
}

function enumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new TypeError(`${path} has an unsupported value.`);
  }
  return value as T[number];
}

function asciiLabel(value: unknown, path: string): string {
  if (
    typeof value !== "string" || !/^[\x21-\x7e]{1,255}$/.test(value)
  ) {
    throw new TypeError(`${path} must be a bounded printable ASCII label.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || Object.is(value, -0)) {
    throw new TypeError(`${path} must be a non-negative safe integer.`);
  }
  return value as number;
}

function nonNegativeFinite(value: unknown, path: string): number {
  const result = finite(value, path);
  if (result < 0 || Object.is(result, -0)) {
    throw new TypeError(`${path} must be a non-negative finite number.`);
  }
  return result;
}
