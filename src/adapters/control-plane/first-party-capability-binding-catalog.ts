import {
  ELECTRONICS_RUN_ADMITTED_SPICE_CAPABILITY,
  GEOMETRY_EXECUTE_ADMITTED_SOURCE_CAPABILITY,
  GEOMETRY_EXPORT_ADMITTED_SOURCE_CAPABILITY,
  GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY,
  GEOMETRY_OBSERVE_ASSEMBLY_INTEGRITY_CAPABILITY,
  MANUFACTURING_RUN_DFM_CHECKS_CAPABILITY,
  MECHANICS_OBSERVE_PRESCRIBED_KINEMATICS_CAPABILITY,
  MECHANICS_OBSERVE_STATIC_STRUCTURAL_SENSITIVITY_CAPABILITY,
  MECHANICS_SOLVE_STATIC_STRUCTURAL_CAPABILITY,
  MODEL_AUTHOR_SYSTEM_CAPABILITY,
  MODEL_EVALUATE_REQUIREMENT_CAPABILITY,
  MODEL_INSPECT_SYSTEM_CAPABILITY,
  SIMULATION_RUN_ADMITTED_MODELICA_CAPABILITY,
  SIMULATION_RUN_QUALIFIED_MODELICA_CAPABILITY,
} from "../../domain/capability/engineering-capability.ts";
import {
  BUILD123D_EXECUTION_PROFILE,
} from "../../domain/cad/isolated/build123d-execution-proposal.ts";
import {
  CALCULIX_ISOLATED_EXECUTION_PROFILE,
} from "../../domain/fea/isolated-v3/calculix-isolated-execution.ts";
import {
  MODELICA_ADMITTED_EXECUTION_PROFILE,
} from "../../domain/modelica/admitted/run-proposal.ts";
import {
  MODELICA_ISOLATED_EXECUTION_PROFILE,
} from "../../domain/modelica/qualified-kit/isolated-execution.ts";
import {
  SPICE_ADMITTED_EXECUTION_PROFILE,
} from "../../domain/electrical/spice/admitted/run-proposal.ts";
import { pinnedOciImageReference } from "../../domain/compile/isolation/local-isolation-runtime.ts";
import {
  LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE,
} from "../fea/isolated-v3/local-calculix-isolated-execution-options.ts";
import {
  LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
} from "../electrical/spice/admitted/local-image-references.ts";
import {
  LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE,
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
  LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE,
  MCP_CALCULIX_085_IMAGE_REFERENCE,
  MCP_CHRONO_035_IMAGE_REFERENCE,
  MCP_DFM_030_IMAGE_REFERENCE,
} from "./first-party-capability-runtime-identities.ts";
import {
  type AtomicCapabilityRuntimeMaterial,
  type AtomicCapabilityRuntimeUnit,
  CAPABILITY_RUNTIME_CATALOG_SCHEMA_VERSION,
  type CapabilityRuntimeCatalog,
  fingerprintAtomicCapabilityRuntimeUnit,
} from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import { validateCapabilityRuntimeCatalog } from "./capability-runtime-catalog.ts";
import {
  firstPartyBuild123dObservationLaunchGroupReference,
  firstPartyBuild123dSandboxLaunchGroupReference,
  firstPartyCalculixLaunchGroupReference,
  firstPartyChronoLaunchGroupReference,
  firstPartyDfmLaunchGroupReference,
  firstPartySysonLaunchGroupReference,
  MCP_BUILD123D_071_IMAGE_REFERENCE,
  MCP_SYSON_IMAGE_REFERENCE,
  POSTGRES_IMAGE_REFERENCE,
  SYSON_IMAGE_REFERENCE,
} from "./first-party-capability-runtime-launch-groups.ts";
import type { CapabilityRuntimeLaunchGroupReference } from "../../domain/capability/runtime/capability-runtime-launch-group.ts";

const REVIEWED_LICENCE_DOC =
  "docs/reference/runtime/capability-packs/atomic-runtime-boundaries.md";
const SYSON_LAUNCH_GROUP_NOTE =
  "SysON runs only through the exact casys-syson launch group: all three pinned services must be installed, owned and healthy; only mcp-syson loopback port 3009 is exposed.";

/**
 * Builds the trusted first-party catalogue from exact current composition
 * identities. Manifest fingerprints are derived from the closed unit body;
 * no publisher claim, agent request, provider endpoint, tool, or argument is
 * accepted here.
 */
export async function createFirstPartyCapabilityRuntimeCatalog(): Promise<
  CapabilityRuntimeCatalog
> {
  const [
    sysonLaunchGroup,
    build123dSandboxLaunchGroup,
    build123dObservationLaunchGroup,
    chronoLaunchGroup,
    calculixLaunchGroup,
    dfmLaunchGroup,
  ] = await Promise.all([
    firstPartySysonLaunchGroupReference(),
    firstPartyBuild123dSandboxLaunchGroupReference(),
    firstPartyBuild123dObservationLaunchGroupReference(),
    firstPartyChronoLaunchGroupReference(),
    firstPartyCalculixLaunchGroupReference(),
    firstPartyDfmLaunchGroupReference(),
  ]);
  const units = await Promise.all([
    unit("casys.syson-stack", [
      composeMaterial(
        "syson-db-image",
        POSTGRES_IMAGE_REFERENCE,
        ["linux/arm64"],
        "syson-db",
        "internal",
        [],
        [
          volume("syson-db-data", "read-write", "preserve"),
        ],
        "reviewed",
        sysonLaunchGroup,
      ),
      composeMaterial(
        "syson-app-image",
        SYSON_IMAGE_REFERENCE,
        ["linux/amd64", "linux/arm64"],
        "syson-app",
        "internal",
        [],
        [],
        "reviewed",
        sysonLaunchGroup,
      ),
      composeMaterial(
        "mcp-syson-image",
        MCP_SYSON_IMAGE_REFERENCE,
        ["linux/amd64", "linux/arm64"],
        "mcp-syson",
        "loopback-only",
        [3009],
        [],
        "reviewed",
        sysonLaunchGroup,
      ),
    ], "1.0.1"),
    unit("casys.mcp-build123d-sandbox", [
      composeMaterial(
        "mcp-build123d-sandbox-image",
        MCP_BUILD123D_071_IMAGE_REFERENCE,
        ["linux/amd64", "linux/arm64"],
        "mcp-build123d-sandbox",
        "loopback-only",
        [3024],
        [
          volume("build123d-sandbox-exports", "read-write", "preserve"),
        ],
        "reviewed",
        build123dSandboxLaunchGroup,
      ),
    ], "0.7.1"),
    unit("casys.mcp-build123d-observation", [
      composeMaterial(
        "mcp-build123d-observation-image",
        MCP_BUILD123D_071_IMAGE_REFERENCE,
        ["linux/amd64", "linux/arm64"],
        "mcp-build123d",
        "loopback-only",
        [3014],
        [
          volume("exports", "read-write", "preserve"),
        ],
        "reviewed",
        build123dObservationLaunchGroup,
      ),
    ], "0.7.1"),
    unit("casys.build123d-isolated-worker", [
      microvmMaterial(
        "build123d-isolated-worker-image",
        LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE,
        ["linux/arm64"],
        "reviewed",
        "unknown",
      ),
    ]),
    unit("casys.geometry-module-assembler-worker", [
      microvmMaterial(
        "geometry-module-assembler-worker-image",
        LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
        ["linux/arm64"],
        "reviewed",
      ),
    ], "1.2.0"),
    unit("casys.calculix-worker", [
      microvmMaterial(
        "calculix-worker-image",
        LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE,
        ["linux/arm64"],
        "reviewed",
        "unknown",
      ),
    ]),
    unit("casys.mcp-calculix", [
      composeMaterial(
        "mcp-calculix-image",
        MCP_CALCULIX_085_IMAGE_REFERENCE,
        ["linux/amd64", "linux/arm64"],
        "mcp-calculix",
        "loopback-only",
        [3015],
        [
          volume("calculix-inputs", "read-write", "preserve"),
          volume("calculix-runs", "read-write", "preserve"),
          volume("calculix-exports", "read-write", "preserve"),
        ],
        "reviewed",
        calculixLaunchGroup,
      ),
    ], "0.8.5"),
    unit("casys.modelica-worker", [
      microvmMaterial(
        "modelica-worker-image",
        LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE,
        ["linux/arm64"],
        "reviewed",
      ),
    ], "2.0.0"),
    unit("casys.spice-worker", [
      microvmMaterial(
        "ngspice-runtime-image",
        LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
        ["linux/arm64"],
        "reviewed",
      ),
    ], "1.1.0"),
    unit("casys.mcp-chrono", [chronoMaterial(chronoLaunchGroup)], "0.3.5"),
    unit("casys.mcp-dfm", [
      composeMaterial(
        "mcp-dfm-image",
        MCP_DFM_030_IMAGE_REFERENCE,
        ["linux/amd64", "linux/arm64"],
        "mcp-dfm",
        "loopback-only",
        [3018],
        [volume("dfm-exports", "read-only", "preserve")],
        "reviewed",
        dfmLaunchGroup,
      ),
    ], "0.3.0"),
  ]);
  return await validateCapabilityRuntimeCatalog({
    schemaVersion: CAPABILITY_RUNTIME_CATALOG_SCHEMA_VERSION,
    productionEligible: false,
    units,
    bindings: [
      binding(
        "syson-author-system",
        MODEL_AUTHOR_SYSTEM_CAPABILITY,
        "execution",
        "qualified",
        "syson-architecture-adapter",
        "1.0.0",
        null,
        ["casys.syson-stack"],
        "src/adapters/architecture/renderer/model-write-architecture-run-executor.ts",
        [
          "SysON authoring is a concrete runtime binding; it does not validate any engineering result.",
          SYSON_LAUNCH_GROUP_NOTE,
        ],
      ),
      binding(
        "syson-evaluate-requirement",
        MODEL_EVALUATE_REQUIREMENT_CAPABILITY,
        "execution",
        "qualified",
        "syson-requirement-evaluation-adapter",
        "1.0.0",
        null,
        ["casys.syson-stack"],
        "src/adapters/architecture/requirements/model-write-requirements-run-executor.ts",
        [
          "A provider response is not an L4 or L5 verdict without the registered evaluation path.",
          SYSON_LAUNCH_GROUP_NOTE,
        ],
      ),
      binding(
        "syson-inspect-system",
        MODEL_INSPECT_SYSTEM_CAPABILITY,
        "execution",
        "qualified",
        "syson-system-inspection-adapter",
        "1.0.0",
        null,
        ["casys.syson-stack"],
        "src/adapters/architecture/part-definitions/part-definitions-capture.ts",
        [
          "Inspection is a bounded SysML read, not a product navigation authority.",
          SYSON_LAUNCH_GROUP_NOTE,
        ],
      ),
      binding(
        "build123d-export-admitted-source",
        GEOMETRY_EXPORT_ADMITTED_SOURCE_CAPABILITY,
        "preparation",
        "qualified",
        "build123d-admitted-geometry-export-adapter",
        "1.0.0",
        null,
        ["casys.mcp-build123d-sandbox"],
        "src/adapters/cad/canonical/admission-backed-geometry-export-adapter.ts",
        [
          "The binding exports exact admitted geometry; it does not execute arbitrary agent CAD source.",
        ],
      ),
      binding(
        "build123d-execute-admitted-source",
        GEOMETRY_EXECUTE_ADMITTED_SOURCE_CAPABILITY,
        "execution",
        "qualified",
        "build123d-isolated-execution-adapter",
        "1.0.0",
        BUILD123D_EXECUTION_PROFILE,
        ["casys.build123d-isolated-worker"],
        "src/adapters/cad/isolated/fixed-build123d-execution-profile-catalog.ts",
        [
          "Isolated output is documentary until a separate canonical or proof path admits it.",
        ],
      ),
      binding(
        "build123d-execute-admitted-source-preparation",
        GEOMETRY_EXECUTE_ADMITTED_SOURCE_CAPABILITY,
        "preparation",
        "qualified",
        "build123d-isolated-execution-adapter",
        "1.0.0",
        BUILD123D_EXECUTION_PROFILE,
        ["casys.build123d-isolated-worker"],
        "src/adapters/cad/isolated/fixed-build123d-execution-profile-catalog.ts",
        [
          "This binding stages exact admitted-source execution only.",
          "Isolated output remains documentary and does not qualify a downstream solver or product verdict.",
        ],
      ),
      binding(
        "build123d-observe-assembly-integrity",
        GEOMETRY_OBSERVE_ASSEMBLY_INTEGRITY_CAPABILITY,
        "execution",
        "qualified",
        "build123d-assembly-integrity-observer",
        "1.0.0",
        { id: "assembly-integrity-observer", version: "1.0.0" },
        ["casys.mcp-build123d-observation"],
        "src/adapters/cad/assembly-integrity/fixed-assembly-integrity-observer-profile-catalog.ts",
        [
          "This observer covers exact imported assembly facts only, not collision, motion, force, clearance, safety, or manufacturability.",
        ],
      ),
      binding(
        "build123d-geometry-module-immediate-compound",
        GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY,
        "preparation",
        "qualified",
        "build123d-module-assembler-adapter",
        "1.0.0",
        { id: "build123d-module-assembler-v1", version: "1.0.0" },
        ["casys.geometry-module-assembler-worker"],
        "src/adapters/cad/module-assembly/fixed-geometry-module-assembler.ts",
        [
          "This binding assembles an exact static immediate compound only.",
          "It does not cover collision, contact, clearance, motion, forces, resistance, safety, or fabricability.",
        ],
      ),
      binding(
        "calculix-static-structural",
        MECHANICS_SOLVE_STATIC_STRUCTURAL_CAPABILITY,
        "execution",
        "qualified",
        "calculix-isolated-static-proof-adapter",
        "1.0.0",
        CALCULIX_ISOLATED_EXECUTION_PROFILE,
        ["casys.calculix-worker"],
        "src/adapters/fea/isolated-v3/fixed-calculix-isolated-execution-profile.ts",
        [
          "The local product worker is distinct from HTTP mcp-calculix and from sensitivity reuse.",
        ],
      ),
      binding(
        "calculix-http-static-sensitivity",
        MECHANICS_OBSERVE_STATIC_STRUCTURAL_SENSITIVITY_CAPABILITY,
        "execution",
        "unqualified",
        "calculix-http-static-sensitivity-adapter",
        "1.0.0",
        null,
        ["casys.mcp-calculix"],
        "src/adapters/sensitivity/live-fea/mcp-calculix-sensitivity-solver.ts",
        [
          "The HTTP sensitivity binding is distinct from the isolated product static-proof worker.",
          "The exact casys-mcp-calculix launch group is declared but this binding remains unqualified and non-activable until its live contract qualification is recorded.",
          "The binding can emit only static-structural sensitivity observations; no provider health or completed call is an engineering verdict.",
        ],
      ),
      binding(
        "openmodelica-qualified-kit",
        SIMULATION_RUN_QUALIFIED_MODELICA_CAPABILITY,
        "execution",
        "qualified",
        "modelica-qualified-kit-adapter",
        "1.0.0",
        MODELICA_ISOLATED_EXECUTION_PROFILE,
        ["casys.modelica-worker"],
        "src/adapters/modelica/qualified-kit/execution-profile.ts",
        [
          "Qualification covers only the pinned LinearThermalRamp kit, not arbitrary admitted Modelica source.",
        ],
      ),
      binding(
        "openmodelica-admitted-modelica",
        SIMULATION_RUN_ADMITTED_MODELICA_CAPABILITY,
        "execution",
        "unqualified",
        "modelica-admitted-execution-adapter",
        "1.0.0",
        MODELICA_ADMITTED_EXECUTION_PROFILE,
        ["casys.modelica-worker"],
        "src/adapters/modelica/admitted/execution-profile-catalog.ts",
        [
          "The admitted Modelica method remains unqualified; sharing the reviewed worker image does not qualify this binding.",
        ],
      ),
      binding(
        "ngspice-admitted-circuit",
        ELECTRONICS_RUN_ADMITTED_SPICE_CAPABILITY,
        "execution",
        "qualified",
        "ngspice-admitted-execution-adapter",
        "1.0.0",
        SPICE_ADMITTED_EXECUTION_PROFILE,
        ["casys.spice-worker"],
        "src/adapters/electrical/spice/admitted/execution-profile-catalog.ts",
        [
          "The Docker distribution image and Microsandbox runtime digest are distinct identities.",
        ],
      ),
      binding(
        "chrono-prescribed-kinematics",
        MECHANICS_OBSERVE_PRESCRIBED_KINEMATICS_CAPABILITY,
        "execution",
        "unqualified",
        "chrono-prescribed-kinematics-adapter",
        "0.3.5",
        null,
        ["casys.mcp-chrono"],
        "src/adapters/mechanics/chrono/chrono-prescribed-kinematics-client.ts",
        [
          "Only mcp-chrono 0.3.5 at its immutable Linux/amd64 digest is catalogued.",
          "On an ARM64 host the material can be emulated only after an explicit qualification probe; it is never claimed native.",
          "The binding exposes factual prescribed-kinematics observations, not collision, contact, clearance, force, strength, safety, or product verdicts.",
        ],
        "1",
      ),
      binding(
        "mcp-dfm-measured-checks",
        MANUFACTURING_RUN_DFM_CHECKS_CAPABILITY,
        "execution",
        "qualified",
        "dfm-measured-checks-adapter",
        "1.0.0",
        null,
        ["casys.mcp-dfm"],
        "src/adapters/make/dfm/industrialize-run-dfm-checks-run-executor.ts",
        [
          "The binding runs sealed measured envelope, thickness and overhang checks on a canonical write-geometry STEP child.",
          "It does not observe printability, estimate FFF, select a printer SKU, or publish a product verdict beyond the fail-closed DFM evaluations.",
        ],
      ),
    ],
  });
}

async function unit(
  id: string,
  materials: readonly AtomicCapabilityRuntimeMaterial[],
  version = "1.0.0",
): Promise<AtomicCapabilityRuntimeUnit> {
  const manifestFingerprint = await fingerprintAtomicCapabilityRuntimeUnit({
    id,
    version,
    materials,
  });
  return {
    id,
    version,
    manifestFingerprint,
    materials,
  };
}

function composeMaterial(
  id: string,
  imageReference: string,
  platforms: readonly ("linux/arm64" | "linux/amd64")[],
  serviceId: string,
  network: "internal" | "loopback-only",
  loopbackPorts: readonly number[],
  volumes: readonly {
    readonly id: string;
    readonly access: "read-only" | "read-write";
    readonly preservation: "preserve" | "ephemeral";
  }[],
  security: "reviewed" | "unknown",
  launchGroup: CapabilityRuntimeLaunchGroupReference | null = null,
): AtomicCapabilityRuntimeMaterial {
  return {
    id,
    kind: "compose-service",
    imageReference: cataloguedImageReference(imageReference, id),
    platforms,
    lifecycle: "persistent",
    launchGroup,
    effects: {
      downloadBytes: null,
      storageBytes: null,
      services: [{ id: serviceId, lifecycle: "persistent" }],
      volumes,
      network,
      loopbackPorts,
      bindMounts: [],
      privileged: false,
      dockerSocket: false,
      devices: [],
      secretSlots: [],
      licence: { status: "reviewed", reference: REVIEWED_LICENCE_DOC },
      security,
    },
  };
}

function microvmMaterial(
  id: string,
  imageReference: string,
  platforms: readonly ("linux/arm64" | "linux/amd64")[],
  security: "reviewed" | "unknown",
  licence: "reviewed" | "unknown" = "reviewed",
): AtomicCapabilityRuntimeMaterial {
  return {
    id,
    kind: "microvm-image",
    imageReference: cataloguedImageReference(imageReference, id),
    platforms,
    lifecycle: "ephemeral",
    launchGroup: null,
    effects: {
      downloadBytes: null,
      storageBytes: null,
      services: [{ id, lifecycle: "ephemeral" }],
      volumes: [],
      network: "deny-all",
      loopbackPorts: [],
      bindMounts: [],
      privileged: false,
      dockerSocket: false,
      devices: [],
      secretSlots: [],
      licence: { status: licence, reference: REVIEWED_LICENCE_DOC },
      security,
    },
  };
}

/**
 * Chrono is a persistent authenticated local service, unlike the ephemeral
 * local microVM workers. Its runtime security and ARM emulation qualification
 * remain literal unknown/unqualified until a dedicated probe records them.
 */
function chronoMaterial(
  launchGroup: CapabilityRuntimeLaunchGroupReference,
): AtomicCapabilityRuntimeMaterial {
  return {
    id: "mcp-chrono-image",
    kind: "compose-service",
    imageReference: cataloguedImageReference(
      MCP_CHRONO_035_IMAGE_REFERENCE,
      "mcp-chrono-image",
    ),
    platforms: ["linux/amd64"],
    lifecycle: "persistent",
    launchGroup,
    effects: {
      downloadBytes: null,
      storageBytes: null,
      services: [{ id: "mcp-chrono", lifecycle: "persistent" }],
      volumes: [volume("chrono-data", "read-write", "preserve")],
      network: "loopback-only",
      loopbackPorts: [3025],
      bindMounts: [],
      privileged: false,
      dockerSocket: false,
      devices: [],
      secretSlots: ["chrono-mcp-bearer-token"],
      licence: { status: "unknown", reference: REVIEWED_LICENCE_DOC },
      security: "reviewed",
    },
  };
}

function cataloguedImageReference(imageReference: string, materialId: string): string {
  return pinnedOciImageReference(
    imageReference,
    `$firstPartyCatalog.${materialId}.imageReference`,
  );
}

function volume(
  id: string,
  access: "read-only" | "read-write",
  preservation: "preserve" | "ephemeral",
) {
  return { id, access, preservation } as const;
}

function binding(
  id: string,
  capability: { readonly id: string; readonly version: string },
  use: "preparation" | "execution",
  qualification: "compatible" | "qualified" | "unqualified" | "revoked",
  adapterId: string,
  adapterVersion: string,
  profile: { readonly id: string; readonly version: string } | null,
  unitIds: readonly string[],
  source: string,
  limitations: readonly string[],
  version = "1.0.0",
) {
  return {
    id,
    version,
    capability,
    use,
    qualification,
    adapter: { id: adapterId, version: adapterVersion, source },
    profile: profile === null ? null : { ...profile, fingerprint: null },
    unitIds,
    qualificationEvidence: {
      id: `${id}-qualification`,
      source,
      fingerprint: null,
    },
    // Runtime mode is host-local and therefore never claimed by this
    // code-owned catalogue baseline. The attestation evaluator fills it.
    runtimeModes: [],
    limitations,
  } as const;
}
