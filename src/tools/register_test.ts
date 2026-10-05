import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import type { DockerObserver } from "../adapters/shared/docker-observer.ts";
import type { McpProbe } from "../adapters/shared/mcp/http-mcp-probe.ts";
import {
  DESIGN_EXECUTE_BUILD123D_OPERATION,
} from "../domain/cad/isolated/build123d-execution-proposal.ts";
import { SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION } from "../domain/modelica/qualified-kit/run-proposal.ts";
import { VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION } from "../orchestration/operations/fea-isolated-static-proof.ts";
import type { ProjectRunExecutor } from "../application/ports/in/project-run-executor.ts";
import type { RunDetail } from "../application/control-plane/read-model/engineering-run.ts";
import type { FleetManifest } from "../application/control-plane/read-model/fleet-manifest.ts";
import type { ObservedContainer } from "../application/control-plane/read-model/fleet-observation.ts";
import type { EngineeringProjectSnapshot } from "../domain/project/engineering-project.ts";
import {
  approvalModeForBinding,
  createConsoleServer,
  createLocalAdmittedModelicaExecutionServerOptions,
  createLocalAdmittedSpiceExecutionServerOptions,
  createLocalBuild123dExecutionServerOptions,
  createLocalCalculixIsolatedExecutionServerOptions,
  createLocalGeometryModuleAssemblyServerOptions,
  createLocalModelicaIsolatedExecutionServerOptions,
  LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE,
  LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE,
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_WRAPPER_SHA256,
  LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE,
  parseConsoleCli,
} from "../../server.ts";
import { MCP_BUILD123D_071_IMAGE_REFERENCE } from "../adapters/control-plane/first-party-capability-runtime-launch-groups.ts";
import { LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE } from "../adapters/control-plane/first-party-capability-runtime-identities.ts";
import { CONSOLE_RESOURCE_URI } from "./control-plane.ts";
import {
  createNeutralStartedProject,
  NEUTRAL_PROJECT_ID,
} from "../testing/neutral-started-engineering-project-fixture.ts";

Deno.test("console CLI parses loopback bind options without a review-intent outbox", () => {
  assertEquals(
    parseConsoleCli([
      "--hostname=localhost",
      "--port",
      "6202",
      "--yolo",
    ]),
    {
      hostname: "localhost",
      port: 6202,
      yolo: true,
    },
  );
  assertThrows(
    () => parseConsoleCli(["--review-intent-dir=/var/tmp/casys-review-outbox"]),
    TypeError,
    "Unknown console argument",
  );
});

Deno.test("YOLO CLI activation is explicit and restricted to loopback", () => {
  assertEquals(parseConsoleCli([]).yolo, undefined);
  assertEquals(approvalModeForBinding(false, "0.0.0.0"), {
    kind: "interactive",
  });
  assertEquals(approvalModeForBinding(true, "127.0.0.1"), {
    kind: "local-yolo",
    origin: { kind: "human", actorId: "local-yolo:startup-opt-in" },
  });
  assertThrows(
    () => approvalModeForBinding(true, "0.0.0.0"),
    TypeError,
    "restricted to an explicit loopback",
  );
  for (
    const unknown of [
      "--yoloo",
      "--yolo=true",
      "--local-execution",
      "--local-execution=true",
      "serve",
    ]
  ) {
    assertThrows(
      () => parseConsoleCli([unknown]),
      TypeError,
      `Unknown console argument: ${unknown}`,
    );
  }
  assertThrows(
    () => parseConsoleCli(["--hostname"]),
    TypeError,
    "--hostname requires a value",
  );
});

Deno.test("future Build123d runtime binding factory is code-owned and digest pinned", async () => {
  const first = await createLocalBuild123dExecutionServerOptions();
  const second = await createLocalBuild123dExecutionServerOptions();

  assertEquals(first, second);
  assertEquals(first.profile.imageReference, LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE);
  assertEquals(
    first.profile.imageReference,
    "casys/build123d-microsandbox-worker@sha256:6484a43b3632972de349ba5aa55f3da7316fb5bd7ad957b7c22aaf7888fad159",
  );
  assertEquals(first.profile.policy.id, "build123d-microsandbox-deny-all-v1");
  assertEquals(first.profile.policy.version, "1.0.0");
  assertEquals(first.profile.limits, {
    maxWallTimeMs: 30_000,
    maxCpuTimeMs: 25_000,
    maxMemoryBytes: 1_024 * 1_048_576,
    maxProcesses: 32,
    maxStdoutBytes: 65_536,
    maxStderrBytes: 65_536,
    maxOutputFileBytes: 128 * 1_048_576,
    maxOutputTotalBytes: 128 * 1_048_576,
  });
  assertEquals(first.runtime, {});
  assertEquals(Object.keys(first).sort(), ["profile", "runtime"]);
  assertEquals(Object.keys(first.profile).sort(), [
    "imageReference",
    "limits",
    "policy",
  ]);
});

Deno.test("future geometry-module runtime binding factory is code-owned and digest pinned", async () => {
  const first = await createLocalGeometryModuleAssemblyServerOptions();
  const second = await createLocalGeometryModuleAssemblyServerOptions();

  assertEquals(first, second);
  assertEquals(
    first.profile.imageReference,
    LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
  );
  assertEquals(
    first.profile.imageReference,
    "docker.io/casys/build123d-module-assembler-worker@sha256:5aa833e19f1956a001013661e726c19c4566677a75f58493a6534456b99b6707",
  );
  assertEquals(
    LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE,
    "casys/build123d-module-assembler-worker@sha256:40accee586603416f573386df29d881ffd682730bb8bd0e2df53ce1454ede5a2",
  );
  assertEquals(
    first.profile.wrapperSha256,
    LOCAL_GEOMETRY_MODULE_ASSEMBLY_WRAPPER_SHA256,
  );
  assertEquals(
    first.profile.wrapperSha256,
    "609eaf93f2564b88b9103d5e0d53d1dd3e93fcdf8e54c61cc313b957370bf581",
  );
  assertEquals(
    first.profile.policy.id,
    "geometry-module-assembler-microsandbox-deny-all-v1",
  );
  assertEquals(first.profile.policy.version, "1.0.0");
  assertEquals(first.profile.limits, {
    maxWallTimeMs: 120_000,
    maxCpuTimeMs: 90_000,
    maxMemoryBytes: 2 * 1_073_741_824,
    maxProcesses: 32,
    maxStdoutBytes: 65_536,
    maxStderrBytes: 65_536,
    maxOutputFileBytes: 64 * 1_048_576,
    maxOutputTotalBytes: 128 * 1_048_576,
  });
  assertEquals(first.runtime, {});
  assertEquals(Object.keys(first).sort(), ["profile", "runtime"]);
  assertEquals(Object.keys(first.profile).sort(), [
    "imageReference",
    "limits",
    "policy",
    "wrapperSha256",
  ]);
});

Deno.test("server hides native module assembly behind the neutral export and draft store", async () => {
  const source = await Deno.readTextFile("server.ts");
  const assemblyStart = source.indexOf("const geometryModuleAssembly =");
  const cadProjectStart = source.indexOf("const cadProject = createCadProject({");
  const moduleExportStart = source.indexOf("const geometryModuleExport =");

  assert(assemblyStart >= 0);
  assert(cadProjectStart >= 0);
  assert(moduleExportStart >= 0);
  assert(assemblyStart < cadProjectStart);
  assert(cadProjectStart < moduleExportStart);
  assertStringIncludes(
    source.slice(cadProjectStart, moduleExportStart),
    "geometryDraftAssetDirectory: GEOMETRY_DRAFT_ASSETS_DIR,",
  );
  assertStringIncludes(
    source.slice(moduleExportStart),
    "assembler: geometryModuleAssembly.assembler,",
  );
  assertEquals((source.match(/const geometryModuleAssembly =/g) ?? []).length, 1);
});

Deno.test("server injects the resolved Build123d execution profile into the exact cache composition", async () => {
  const source = await Deno.readTextFile("server.ts");
  const readStart = source.indexOf(
    "const capabilityRead = await createLocalCapabilityRuntimeReadComposition({",
  );
  const readEnd = source.indexOf(
    "const capabilityRuntimeLeases = new FileCapabilityRuntimeLeaseStore(",
  );
  assert(readStart >= 0);
  assert(readEnd > readStart);
  const block = source.slice(readStart, readEnd);
  assertStringIncludes(
    block,
    "build123dExecutionProfile: build123dCapability.localProfile",
  );
  assertStringIncludes(
    block,
    "profileFingerprint: build123dCapability.localProfile.profileFingerprint",
  );
  assertStringIncludes(block, "qualifiedModelicaExecutionProfile:");
  assertStringIncludes(block, "admittedModelicaExecutionProfile:");
  assertStringIncludes(
    source,
    "qualifiedModelica.isolatedExecution?.execution === undefined",
  );
  assertStringIncludes(
    source,
    "admittedModelica.execution?.execution === undefined",
  );
  assertEquals(block.includes("Deno.env"), false);
  const cadStart = source.indexOf("const cadProject = createCadProject({");
  const cadEnd = source.indexOf("const assemblyIntegrityEvaluationCaptures");
  assert(cadStart >= 0);
  assert(cadEnd > cadStart);
  const cad = source.slice(cadStart, cadEnd);
  assertStringIncludes(cad, "capabilityRuntime,");
  assertStringIncludes(cad, "capabilityRuntimeSession,");
});

Deno.test("server capability authorization reuses every qualification reconstruction input from the read composition", async () => {
  const source = await Deno.readTextFile("server.ts");
  const serviceStart = source.indexOf(
    "const capabilityAuthorization = new ProjectCapabilityAuthorizationService({",
  );
  const serviceEnd = source.indexOf(
    "// A restart does not re-authorize anything.",
    serviceStart,
  );
  assert(serviceStart >= 0);
  assert(serviceEnd > serviceStart);
  const block = source.slice(serviceStart, serviceEnd);

  assertStringIncludes(
    block,
    "qualificationSpecs: capabilityRead.qualificationSpecs,",
  );
  assertStringIncludes(
    block,
    "qualificationCandidates: capabilityRead.qualificationCandidates,",
  );
  assertEquals(
    block.includes("createFirstPartyCapabilityRuntimeQualification"),
    false,
  );
});

Deno.test("server prepares the closed first-party Microsandbox cache recipes from the catalogue", async () => {
  const source = await Deno.readTextFile("server.ts");
  const runtimeLock = source.indexOf(
    "const capabilityRuntimeMutationLock = new FileCapabilityRuntimeHostMutationLock();",
  );
  const cachePreparation = source.indexOf(
    "const capabilityRuntimeCachePreparation =",
  );
  const scheduler = source.indexOf(
    "preloadScheduler: new CapabilityRuntimePreloadScheduler({",
  );

  assert(runtimeLock >= 0);
  assert(cachePreparation > runtimeLock);
  assert(scheduler > cachePreparation);
  const cache = source.slice(cachePreparation, scheduler);
  assertStringIncludes(
    cache,
    "catalog: capabilityRead.catalog,",
  );
  assertStringIncludes(cache, "lock: capabilityRuntimeMutationLock,");
  assertEquals(cache.includes("admittedSpiceRuntimeProfile"), false);
  assertEquals(cache.includes("geometryModuleAssemblyRuntimeProfile"), false);
  const schedulerBlock = source.slice(scheduler);
  assertStringIncludes(
    schedulerBlock,
    "cachePreparer: capabilityRuntimeCachePreparation.cachePreparer,",
  );
});

Deno.test("future Modelica runtime binding factory is code-owned, digest pinned, and qualification-gated", async () => {
  const first = await createLocalModelicaIsolatedExecutionServerOptions();
  const second = await createLocalModelicaIsolatedExecutionServerOptions();

  assertEquals(first, second);
  assertEquals(first.profile.imageReference, LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE);
  assertEquals(
    first.profile.imageReference,
    "casys/modelica-microsandbox-worker@sha256:834c759291320eb5f35ccb6eba03587445d259dcb38a2814c5def4ac41d5d730",
  );
  assertEquals(first.profile.policy, {
    id: "modelica-microsandbox-deny-all-v1",
    version: "1.0.0",
    fingerprint: {
      algorithm: "sha256",
      digest: "acd119309fd7827a09b31babdd01a46e27f9839b02145dc8e01b480d904ccabe",
    },
  });
  assertEquals(first.profile.engine, {
    name: "OpenModelica",
    version: "1.27.0",
    mslVersion: "4.1.0",
  });
  assertEquals(first.runtime, {});

  const admitted = await createLocalAdmittedModelicaExecutionServerOptions();
  const admittedAgain = await createLocalAdmittedModelicaExecutionServerOptions();
  assertEquals(admitted, admittedAgain);
  assertEquals(
    admitted.profile.imageReference,
    LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE,
  );
  assertEquals(
    admitted.profile.policy.id,
    "modelica-admitted-microsandbox-deny-all-v1",
  );
  assertEquals(admitted.profile.policy.version, "1.0.0");
  assertEquals(admitted.runtime, {});
});

Deno.test("future CalculiX runtime binding factory is code-owned, digest pinned, and SysON-gated", async () => {
  const first = await createLocalCalculixIsolatedExecutionServerOptions();
  const second = await createLocalCalculixIsolatedExecutionServerOptions();

  assertEquals(first, second);
  assertEquals(first.profile.imageReference, LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE);
  assertEquals(
    first.profile.imageReference,
    "casys/calculix-microsandbox-worker@sha256:2dc7d17454833a2c17b5812eb1e5504c4a025ef3764fc771fda2938d49fa9771",
  );
  assertEquals(
    first.profile.wrapperSha256,
    "507c29da72e346aa87465ce96572b19b42e96105c64b2854be73d6894592e4e2",
  );
  assertEquals(first.profile.policy, {
    id: "calculix-microsandbox-deny-all-v1",
    version: "1.0.0",
    fingerprint: {
      algorithm: "sha256",
      digest: "46d92b3f0c77084d6ef06015b88d72be26b3f0293aca23d20b221ae3bc2e9e31",
    },
  });
  assertEquals(first.runtime, {});
});

Deno.test("startup composes only code-owned local engineering runtimes", async () => {
  const config = JSON.parse(await Deno.readTextFile("deno.json")) as {
    imports: Record<string, string>;
    tasks: Record<string, string>;
  };
  assertEquals(config.imports[["@deno", "sandbox"].join("/")], undefined);
  assertEquals(config.imports.microsandbox, "npm:microsandbox@0.6.8");
  assertEquals(config.tasks.start.includes("--local-execution"), false);
  assertStringIncludes(config.tasks.start, "--node-modules-dir=auto");
  assertStringIncludes(
    config.tasks.start,
    "--allow-read=.,config,state,src,images,mcp-server.yaml,node_modules",
  );
  assertStringIncludes(
    config.tasks.start,
    "--allow-write=state/local,/tmp,/private/tmp",
  );
  assertStringIncludes(config.tasks.start, "--allow-ffi=node_modules");

  const yolo = config.tasks["start:yolo"];
  assertEquals(config.tasks["start:local"], undefined);
  assertEquals(config.tasks["capability:behave:inspect"], undefined);
  assertEquals(config.tasks["capability:behave:doctor"], undefined);
  assertEquals(yolo, `${config.tasks.start} --yolo`);
  assertStringIncludes(
    yolo,
    "--allow-read=.,config,state,src,images,mcp-server.yaml,node_modules",
  );
  assertStringIncludes(yolo, "--allow-write=state/local,/tmp,/private/tmp");
  assertStringIncludes(yolo, "--allow-ffi=node_modules");
  assertStringIncludes(yolo, "--node-modules-dir=auto");
  assertEquals(yolo.endsWith("server.ts --yolo"), true);
  assertEquals(yolo.includes("--local-execution"), false);
  const source = await Deno.readTextFile("server.ts");
  assertEquals(source.includes("localExecutionForBinding"), false);
  assertEquals(source.includes("cli.localExecution"), false);
  assertEquals(source.includes("build123dExecution: localExecution"), false);
  const mainStart = source.indexOf("if (import.meta.main) {");
  assert(mainStart >= 0);
  const main = source.slice(mainStart);
  for (
    const factory of [
      "createLocalBuild123dExecutionServerOptions()",
      "createLocalGeometryModuleAssemblyServerOptions()",
      "createLocalModelicaIsolatedExecutionServerOptions()",
      "createLocalAdmittedModelicaExecutionServerOptions()",
      "createLocalAdmittedSpiceExecutionServerOptions()",
      "createLocalCalculixIsolatedExecutionServerOptions()",
    ]
  ) {
    assertStringIncludes(main, factory);
  }
  for (
    const option of [
      "build123dExecution,",
      "geometryModuleAssembly,",
      "modelicaIsolatedExecution,",
      "admittedModelicaExecution,",
      "admittedSpiceExecution,",
      "calculixIsolatedExecution,",
    ]
  ) {
    assertStringIncludes(main, option);
  }
  assertStringIncludes(
    source,
    "cachePreparer: capabilityRuntimeCachePreparation.cachePreparer,",
  );
});

Deno.test("server orchestrates one historical proof and requirements CAS into ROP2", async () => {
  const source = await Deno.readTextFile("server.ts");
  assertStringIncludes(source, "createFeaFoundation(");
  assertStringIncludes(source, "createRecordedOperationPlanComposition(");
  assertStringIncludes(source, "feaProofCaptures: feaFoundation.feaProofCaptures,");
  assertStringIncludes(
    source,
    "requirementsCaptures: architectureFoundation.requirementsCaptures,",
  );
  assertEquals(
    source.includes("${recordedAnalysisDirectory}/calculix/proof-cases"),
    false,
  );
});

Deno.test("server starts project control without seeding any project", async () => {
  const activeProjectDirectory = await Deno.makeTempDir({
    prefix: "casys-project-tools-empty-",
  });
  try {
    await createConsoleServer({
      manifest: { version: 1, servers: [] },
      runs: [],
      logger: () => {},
      activeProjectDirectory,
    });
    const entries = [];
    for await (const entry of Deno.readDir(activeProjectDirectory)) {
      entries.push(entry.name);
    }
    assertEquals(entries, []);
  } finally {
    await Deno.remove(activeProjectDirectory, { recursive: true });
  }
});

Deno.test("server exposes qualified Build123d review only from explicit profile configuration", async () => {
  const temporaryDirectory = await Deno.makeTempDir({
    prefix: "casys-build123d-review-composition-",
  });
  const { profile } = await createLocalBuild123dExecutionServerOptions();
  try {
    const withoutConfiguration = await createConsoleServer({
      manifest: { version: 1, servers: [] },
      runs: [],
      logger: () => {},
      activeProjectDirectory: `${temporaryDirectory}/without/projects`,
      recordedAnalysisDirectory: `${temporaryDirectory}/without/analysis`,
    });
    assertEquals(
      withoutConfiguration.app.getToolNames().includes(
        "project_build123d_execution_review",
      ),
      false,
    );
    assertEquals(
      await directoryExists(`${temporaryDirectory}/without/analysis/build123d`),
      false,
    );

    const reviewOnly = await createConsoleServer({
      manifest: { version: 1, servers: [] },
      runs: [],
      logger: () => {},
      activeProjectDirectory: `${temporaryDirectory}/review/projects`,
      recordedAnalysisDirectory: `${temporaryDirectory}/review/analysis`,
      build123dExecution: { profile },
    });
    assertEquals(
      reviewOnly.app.getToolNames().includes(
        "project_build123d_execution_review",
      ),
      true,
    );
    assertEquals(
      await directoryExists(`${temporaryDirectory}/review/analysis/build123d`),
      false,
    );
  } finally {
    await Deno.remove(temporaryDirectory, { recursive: true });
  }
});

Deno.test("server exposes qualified Modelica review only from explicit local profile configuration", async () => {
  const temporaryDirectory = await Deno.makeTempDir({
    prefix: "casys-modelica-review-composition-",
  });
  const { profile } = await createLocalModelicaIsolatedExecutionServerOptions();
  try {
    const withoutConfiguration = await createConsoleServer({
      manifest: { version: 1, servers: [] },
      runs: [],
      logger: () => {},
      activeProjectDirectory: `${temporaryDirectory}/without/projects`,
      recordedAnalysisDirectory: `${temporaryDirectory}/without/analysis`,
    });
    assertEquals(
      withoutConfiguration.app.getToolNames().includes(
        "project_modelica_qualified_kit_run_review",
      ),
      false,
    );

    const reviewOnly = await createConsoleServer({
      manifest: { version: 1, servers: [] },
      runs: [],
      logger: () => {},
      activeProjectDirectory: `${temporaryDirectory}/review/projects`,
      recordedAnalysisDirectory: `${temporaryDirectory}/review/analysis`,
      modelicaIsolatedExecution: { profile },
    });
    assertEquals(
      reviewOnly.app.getToolNames().includes(
        "project_modelica_qualified_kit_run_review",
      ),
      true,
    );
    assertEquals(
      await directoryExists(
        `${temporaryDirectory}/review/analysis/modelica/isolated-execution`,
      ),
      false,
    );

    const operation = SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION;
    assertStringIncludes(
      await Deno.readTextFile("server.ts"),
      "The server has no complete qualified local Modelica runtime and pinned qualification configured for this run.",
    );
    assertEquals(operation, {
      id: "simulate.run-qualified-modelica-kit",
      version: "1",
    });
    assertStringIncludes(
      await Deno.readTextFile("server.ts"),
      "The server has no admitted Modelica closed-subset isolated runtime configured for this run.",
    );
    assertEquals(
      withoutConfiguration.app.getToolNames().includes(
        "project_admitted_modelica_run_review",
      ),
      false,
    );

    const { profile: admittedProfile } =
      await createLocalAdmittedModelicaExecutionServerOptions();
    const admittedReview = await createConsoleServer({
      manifest: { version: 1, servers: [] },
      runs: [],
      logger: () => {},
      activeProjectDirectory: `${temporaryDirectory}/admitted/projects`,
      recordedAnalysisDirectory: `${temporaryDirectory}/admitted/analysis`,
      admittedModelicaExecution: { profile: admittedProfile },
    });
    assertEquals(
      admittedReview.app.getToolNames().includes(
        "project_admitted_modelica_run_review",
      ),
      true,
    );
  } finally {
    await Deno.remove(temporaryDirectory, { recursive: true });
  }
});

Deno.test("server exposes admitted SPICE review from profile and keeps the executor unavailable without runtime", async () => {
  const temporaryDirectory = await Deno.makeTempDir({
    prefix: "casys-spice-review-composition-",
  });
  try {
    const withoutConfiguration = await createConsoleServer({
      manifest: { version: 1, servers: [] },
      runs: [],
      logger: () => {},
      activeProjectDirectory: `${temporaryDirectory}/without/projects`,
      recordedAnalysisDirectory: `${temporaryDirectory}/without/analysis`,
    });
    assertEquals(
      withoutConfiguration.app.getToolNames().includes(
        "project_admitted_spice_run_review",
      ),
      false,
    );
    assertStringIncludes(
      await Deno.readTextFile("server.ts"),
      "The server has no admitted SPICE closed-subset isolated runtime configured for this run.",
    );

    const { profile } = await createLocalAdmittedSpiceExecutionServerOptions();
    const admittedReview = await createConsoleServer({
      manifest: { version: 1, servers: [] },
      runs: [],
      logger: () => {},
      activeProjectDirectory: `${temporaryDirectory}/admitted/projects`,
      recordedAnalysisDirectory: `${temporaryDirectory}/admitted/analysis`,
      admittedSpiceExecution: { profile },
    });
    assertEquals(
      admittedReview.app.getToolNames().includes(
        "project_admitted_spice_run_review",
      ),
      true,
    );
  } finally {
    await Deno.remove(temporaryDirectory, { recursive: true });
  }
});

Deno.test("server seals the local CalculiX profile into ROP2 but composes @3 only with runtime and SysON", async () => {
  const temporaryDirectory = await Deno.makeTempDir({
    prefix: "casys-calculix-local-composition-",
  });
  const { profile } = await createLocalCalculixIsolatedExecutionServerOptions();
  try {
    await createConsoleServer({
      manifest: { version: 1, servers: [] },
      runs: [],
      logger: () => {},
      activeProjectDirectory: `${temporaryDirectory}/projects`,
      recordedAnalysisDirectory: `${temporaryDirectory}/analysis`,
      calculixIsolatedExecution: { profile },
    });
    assertEquals(
      await directoryExists(
        `${temporaryDirectory}/analysis/calculix/isolated-execution`,
      ),
      false,
    );

    const source = await Deno.readTextFile("server.ts");
    assertStringIncludes(
      source,
      "calculixLocalProfile: calculixCapability.localProfile,",
    );
    assertStringIncludes(source, "executor: feaProject.isolatedCalculixRun,");
    assertStringIncludes(
      source,
      "operation: VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,",
    );
    assertEquals(VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION, {
      id: "verify.run-fea-static-proof",
      version: "3",
    });
  } finally {
    await Deno.remove(temporaryDirectory, { recursive: true });
  }
});

Deno.test("Build123d execution registration stays unavailable until the explicit runtime is complete", async () => {
  const operation = DESIGN_EXECUTE_BUILD123D_OPERATION;
  const project = build123dUnavailableProjectFixture();
  const baseline: ProjectRunExecutor = {
    execute: () => Promise.resolve(project),
  };
  const unavailable = new (await import(
    "../application/use-cases/registered-project-run-executor.ts"
  )).RegisteredProjectRunExecutor({
    projects: { get: () => Promise.resolve(project) },
    baseline,
    additional: [{
      operation,
      unavailableMessage: "qualified Build123d runtime is absent",
    }],
  });

  await assertRejects(
    () =>
      unavailable.execute({ kind: "agent", actorId: "agent:test" }, {
        commandId: "execute-build123d",
        projectId: project.project.id,
        expectedRevision: project.revision,
        issuedAt: "2026-08-13T00:00:00.000Z",
        runId: "run-build123d-unavailable",
      }),
    Error,
    "qualified Build123d runtime is absent",
  );
});

Deno.test(
  "sandbox-composed MCP lists admitted export and does not list geometry preview",
  async () => {
    const temporaryDirectory = await Deno.makeTempDir({
      prefix: "casys-sandbox-tools-",
    });
    try {
      const { app } = await createConsoleServer({
        manifest: {
          version: 1,
          servers: [{
            id: "build123d-sandbox",
            displayName: "build123d sandbox",
            role: "sandbox",
            serviceName: "mcp-build123d-sandbox",
            transport: "streamable-http",
            mcpUrl: "http://127.0.0.1:3998/mcp",
            healthUrl: "http://127.0.0.1:3998/health",
            image: "example.test/sandbox:1",
            required: false,
            expectedTools: ["build123d_export"],
          }],
        },
        runs: [runFixture()],
        probe: healthyProbe(),
        docker: unavailableDocker(),
        logger: () => {},
        activeProjectDirectory: `${temporaryDirectory}/projects`,
      });
      const names = app.getToolNames();
      assertEquals(names.includes("project_admitted_geometry_export"), true);
      assertEquals(names.includes("project_geometry_preview"), false);
      assertEquals(names.includes("project_product_explore"), true);
      assertEquals(names.includes("project_product_inspect"), true);
      assertEquals(names.includes("project_product_search"), true);
      assertEquals(names.includes("project_source_closure"), true);
      assertEquals(names.includes("project_response_read"), true);
      assertEquals(names.includes("project_product_navigation_roots"), false);
      assertEquals(names.includes("project_product_source_closure"), false);
    } finally {
      await Deno.remove(temporaryDirectory, { recursive: true });
    }
  },
);

Deno.test(
  "server composes L3 assembly-integrity only through the pinned normal build123d server",
  async () => {
    const temporaryDirectory = await Deno.makeTempDir({
      prefix: "casys-assembly-integrity-composition-",
    });
    try {
      const sandboxOnly = await createConsoleServer({
        manifest: {
          version: 1,
          servers: [{
            id: "build123d-sandbox",
            displayName: "build123d sandbox",
            role: "sandbox",
            serviceName: "mcp-build123d-sandbox",
            transport: "streamable-http",
            mcpUrl: "http://127.0.0.1:3998/mcp",
            healthUrl: "http://127.0.0.1:3998/health",
            image: "example.test/sandbox:1",
            required: false,
            expectedTools: ["build123d_export"],
          }],
        },
        runs: [],
        logger: () => {},
        activeProjectDirectory: `${temporaryDirectory}/sandbox/projects`,
      });
      assertEquals(
        sandboxOnly.app.getToolNames().includes(
          "project_assembly_integrity_review",
        ),
        false,
      );
      assertEquals(
        sandboxOnly.app.getToolNames().includes(
          "project_assembly_integrity_evaluation_review",
        ),
        false,
      );

      const normal = await createConsoleServer({
        manifest: assemblyIntegrityBuild123dManifest(
          MCP_BUILD123D_071_IMAGE_REFERENCE,
        ),
        runs: [],
        logger: () => {},
        activeProjectDirectory: `${temporaryDirectory}/normal/projects`,
      });
      assertEquals(
        normal.app.getToolNames().includes("project_assembly_integrity_review"),
        true,
      );
      assertEquals(
        normal.app.getToolNames().includes(
          "project_assembly_integrity_evaluation_review",
        ),
        true,
      );

      await assertRejects(
        () =>
          createConsoleServer({
            manifest: assemblyIntegrityBuild123dManifest(
              "example.test/build123d:0.5.0",
            ),
            runs: [],
            logger: () => {},
            activeProjectDirectory: `${temporaryDirectory}/unpinned/projects`,
          }),
        TypeError,
        "$assemblyIntegrityBuild123d.image must be one OCI image name pinned by a lowercase sha256 digest.",
      );

      await assertRejects(
        () =>
          createConsoleServer({
            manifest: assemblyIntegrityBuild123dManifest(
              MCP_BUILD123D_071_IMAGE_REFERENCE,
              "http://127.0.0.1:3024/mcp",
            ),
            runs: [],
            logger: () => {},
            activeProjectDirectory: `${temporaryDirectory}/sandbox-url/projects`,
          }),
        Error,
        "does not match the sealed launch-group loopback host port",
      );

      await assertRejects(
        () =>
          createConsoleServer({
            manifest: assemblyIntegrityBuild123dManifest(
              `example.test/build123d@sha256:${"0".repeat(64)}`,
            ),
            runs: [],
            logger: () => {},
            activeProjectDirectory: `${temporaryDirectory}/digest-mismatch/projects`,
          }),
        TypeError,
        "does not match the sealed casys-build123d-observation launch-group material",
      );

      const composition = await Deno.readTextFile(
        new URL("../../server.ts", import.meta.url),
      );
      assertEquals(
        composition.includes("firstPartyBuild123dObservationLaunchGroupReference"),
        true,
      );
      assertEquals(
        composition.includes("build123d-observe-assembly-integrity"),
        true,
      );
      assertEquals(
        composition.includes("createLocalFixedCapabilityRuntimeConnection"),
        true,
      );
      assertEquals(
        composition.includes(
          "openObserver: (client) => new McpBuild123dAssemblyIntegrityObserver",
        ),
        true,
      );
    } finally {
      await Deno.remove(temporaryDirectory, { recursive: true });
    }
  },
);

Deno.test("control-plane MCP tools are namespaced, read-only, and return structured roots", async () => {
  const temporaryDirectory = await Deno.makeTempDir({
    prefix: "casys-project-tools-",
  });
  const activeProjectDirectory = `${temporaryDirectory}/projects`;
  const projectPath = `${temporaryDirectory}/neutral-project.json`;
  await Deno.writeTextFile(
    projectPath,
    `${JSON.stringify(await createNeutralStartedProject())}\n`,
  );
  const { app } = await createConsoleServer({
    manifest: manifestFixture(),
    runs: [runFixture()],
    probe: healthyProbe(),
    docker: unavailableDocker(),
    logger: () => {},
    projectId: NEUTRAL_PROJECT_ID,
    projectPath,
    activeProjectDirectory,
  });
  assertEquals(app.getToolNames().sort(), [
    "cockpit_focus_set",
    "cockpit_focus_snapshot",
    "console_refresh",
    "console_run_detail",
    "console_run_list",
    "console_server_detail",
    "console_snapshot",
    "project_admitted_geometry_export",
    "project_admitted_geometry_export_preflight",
    "project_admitted_modelica_evaluation_closeout_review",
    "project_admitted_modelica_evaluation_review",
    "project_admitted_spice_evaluation_closeout_review",
    "project_admitted_spice_evaluation_review",
    "project_agent_run_cancel",
    "project_agent_run_execute",
    "project_agent_run_plan_get",
    "project_agent_run_queue",
    "project_answer_record",
    "project_architecture_sysml_preview",
    "project_architecture_sysml_source_capture",
    "project_assembly_integrity_evaluation_closeout_review",
    "project_brief_architecture_review",
    "project_brief_confirm",
    "project_brief_propose",
    "project_brief_requirements_review",
    "project_buy_configuration_cost_capture_review",
    "project_buy_configuration_cost_seal_review",
    "project_buy_cost_estimate_preview",
    "project_buy_cost_estimate_preview_detail",
    "project_cad_placement_capture",
    "project_capability_change_review",
    "project_capability_inspect",
    "project_change_append",
    "project_cross_domain_impact_decision_review",
    "project_cross_domain_impact_manifest_capture",
    "project_cross_domain_impact_manifest_seal_review",
    "project_decision_approve",
    "project_decision_propose",
    "project_decision_reject",
    "project_documentary_clause_response_review",
    "project_electrical_observation_method_sheet_seal_review",
    "project_evaluation_closeout_review",
    "project_fea_isolated_run_review",
    "project_fea_proof_case_capture",
    "project_fea_proof_seal_review",
    "project_isolated_geometry_seal_review",
    "project_led_driver_source_capture",
    "project_led_driver_source_review",
    "project_plan_publish",
    "project_prescribed_kinematics_case_review",
    "project_prescribed_kinematics_evaluation_closeout_review",
    "project_prescribed_kinematics_evaluation_review",
    "project_prescribed_kinematics_method_review",
    "project_prescribed_kinematics_run_review",
    "project_product_explore",
    "project_product_inspect",
    "project_product_search",
    "project_question_propose",
    "project_requirements_brief_trace_review",
    "project_requirements_recapture_review",
    "project_resource_capture",
    "project_response_read",
    "project_sensitivity_base_evaluation_review",
    "project_sensitivity_edges_review",
    "project_sensitivity_study_seal_review",
    "project_snapshot",
    "project_source_attachment_detach",
    "project_source_attachment_list",
    "project_source_attachment_put",
    "project_source_attachment_read",
    "project_source_attachment_recross",
    "project_source_closure",
    "project_source_file_put",
    "project_source_file_read",
    "project_source_file_remove",
    "project_source_module_put",
    "project_source_search",
    "project_source_tree",
    "project_source_workspace_snapshot",
    "project_start",
    "project_technical_compilation_preview",
    "project_technical_compilation_preview_detail",
    "project_technical_source_capture",
    "project_thermal_method_sheet_seal_review",
    "project_vector_correction_review",
    "project_work_item_abandon",
  ]);
  assertEquals(app.hasResource(CONSOLE_RESOURCE_URI), false);

  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  const http = await app.startHttp({
    port,
    hostname: "127.0.0.1",
    onListen: () => {},
  });
  try {
    const client = new TestMcpClient(`http://127.0.0.1:${port}/mcp`);
    const projectId = NEUTRAL_PROJECT_ID;
    const discovered = await client.discover();
    assertEquals(discovered.resultType, "complete");
    assertEquals(discovered.serverInfo, {
      name: "casys-digital-thread-console",
      version: "0.2.0",
    });
    const listed = await client.call("tools/list", {});
    const tools = listed.tools as Array<Record<string, unknown>>;
    assertEquals(tools.map((tool) => tool.name).sort(), [
      "cockpit_focus_set",
      "cockpit_focus_snapshot",
      "console_run_detail",
      "console_run_list",
      "console_server_detail",
      "console_snapshot",
      "project_admitted_geometry_export",
      "project_admitted_geometry_export_preflight",
      "project_admitted_modelica_evaluation_closeout_review",
      "project_admitted_modelica_evaluation_review",
      "project_admitted_spice_evaluation_closeout_review",
      "project_admitted_spice_evaluation_review",
      "project_agent_run_cancel",
      "project_agent_run_execute",
      "project_agent_run_plan_get",
      "project_agent_run_queue",
      "project_answer_record",
      "project_architecture_sysml_preview",
      "project_architecture_sysml_source_capture",
      "project_assembly_integrity_evaluation_closeout_review",
      "project_brief_architecture_review",
      "project_brief_confirm",
      "project_brief_propose",
      "project_brief_requirements_review",
      "project_buy_configuration_cost_capture_review",
      "project_buy_configuration_cost_seal_review",
      "project_buy_cost_estimate_preview",
      "project_buy_cost_estimate_preview_detail",
      "project_cad_placement_capture",
      "project_capability_change_review",
      "project_capability_inspect",
      "project_change_append",
      "project_cross_domain_impact_decision_review",
      "project_cross_domain_impact_manifest_capture",
      "project_cross_domain_impact_manifest_seal_review",
      "project_decision_approve",
      "project_decision_propose",
      "project_decision_reject",
      "project_documentary_clause_response_review",
      "project_electrical_observation_method_sheet_seal_review",
      "project_evaluation_closeout_review",
      "project_fea_isolated_run_review",
      "project_fea_proof_case_capture",
      "project_fea_proof_seal_review",
      "project_isolated_geometry_seal_review",
      "project_led_driver_source_capture",
      "project_led_driver_source_review",
      "project_plan_publish",
      "project_prescribed_kinematics_case_review",
      "project_prescribed_kinematics_evaluation_closeout_review",
      "project_prescribed_kinematics_evaluation_review",
      "project_prescribed_kinematics_method_review",
      "project_prescribed_kinematics_run_review",
      "project_product_explore",
      "project_product_inspect",
      "project_product_search",
      "project_question_propose",
      "project_requirements_brief_trace_review",
      "project_requirements_recapture_review",
      "project_resource_capture",
      "project_response_read",
      "project_sensitivity_base_evaluation_review",
      "project_sensitivity_edges_review",
      "project_sensitivity_study_seal_review",
      "project_snapshot",
      "project_source_attachment_detach",
      "project_source_attachment_list",
      "project_source_attachment_put",
      "project_source_attachment_read",
      "project_source_attachment_recross",
      "project_source_closure",
      "project_source_file_put",
      "project_source_file_read",
      "project_source_file_remove",
      "project_source_module_put",
      "project_source_search",
      "project_source_tree",
      "project_source_workspace_snapshot",
      "project_start",
      "project_technical_compilation_preview",
      "project_technical_compilation_preview_detail",
      "project_technical_source_capture",
      "project_thermal_method_sheet_seal_review",
      "project_vector_correction_review",
      "project_work_item_abandon",
    ]);
    const snapshotTool = tools.find((tool) => tool.name === "console_snapshot");
    assert(snapshotTool);
    assertEquals(snapshotTool._meta, undefined);
    assertEquals(snapshotTool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    const executeTool = tools.find((tool) => tool.name === "project_agent_run_execute");
    assert(executeTool);
    assertEquals(
      executeTool.annotations,
      {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    );
    const executeSchema = executeTool.inputSchema as Record<string, unknown>;
    const executeProperties = executeSchema.properties as Record<string, unknown>;
    assertEquals(
      Object.keys(executeProperties).sort(),
      [
        "commandId",
        "expectedRevision",
        "issuedAt",
        "projectId",
        "runId",
      ],
    );
    assertEquals(executeSchema.required, [
      "commandId",
      "projectId",
      "expectedRevision",
      "issuedAt",
      "runId",
    ]);
    assertEquals(executeSchema.additionalProperties, false);
    const proofSealReviewTool = tools.find((tool) =>
      tool.name === "project_fea_proof_seal_review"
    );
    assert(proofSealReviewTool);
    const proofSealReviewSchema = proofSealReviewTool.inputSchema as Record<
      string,
      unknown
    >;
    const proofSealReviewProperties = proofSealReviewSchema.properties as Record<
      string,
      unknown
    >;
    assertEquals(
      Object.keys(proofSealReviewProperties).sort(),
      ["caseRef", "projectId", "sensitivityCatalogOptIn"],
    );
    assertEquals(proofSealReviewProperties.sensitivityCatalogOptIn, {
      type: "boolean",
      description:
        "Explicit opt-in to seal the causally joined sensitivity catalog offer with the FEA proof. Omit or send false to seal only the proof.",
    });
    assertEquals(proofSealReviewSchema.additionalProperties, false);
    for (
      const forbiddenProperty of [
        "provider",
        "providerArguments",
        "providerTool",
        "toolName",
        "toolArguments",
        "mcpUrl",
        "resultSnapshot",
        "evidenceRefs",
      ]
    ) {
      assertEquals(forbiddenProperty in executeProperties, false);
    }
    for (
      const retiredToolName of [
        "project_agent_run_start",
        "project_agent_run_progress",
        "project_agent_run_publish",
        "project_agent_run_fail",
      ]
    ) {
      assertEquals(
        tools.some((tool) => tool.name === retiredToolName),
        false,
      );
    }

    const result = await client.call("tools/call", {
      name: "console_snapshot",
      arguments: {},
    });
    const structured = result.structuredContent as Record<string, unknown>;
    assertEquals(structured.schemaVersion, "2.0");
    assertEquals(structured.mode, "mixed");
    assert("fleet" in structured);
    assert("runs" in structured);
    assertEquals("workbench" in structured, false);

    const runDetail = await client.call("tools/call", {
      name: "console_run_detail",
      arguments: { id: "run-1" },
    });
    assertEquals(
      (runDetail.content as Array<Record<string, unknown>>)[0].text,
      "Run: documentary record (no dispatch attested); comparison verdict not_evaluated. Source: demo.",
    );

    const projectSnapshot = await client.call("tools/call", {
      name: "project_snapshot",
      arguments: { projectId },
    });
    const project = projectSnapshot.structuredContent as Record<string, unknown>;
    assertEquals(project.schemaVersion, "4.0");
    assertEquals(
      (project.project as Record<string, unknown>).id,
      projectId,
    );
    assertEquals(project.revision, 1);
    assertEquals(
      (projectSnapshot.content as Array<Record<string, unknown>>)[0].text,
      "Project Neutral engineering system is at revision 1.",
    );

    const proposalArguments = {
      commandId: "mcp-proposal-material-1",
      projectId,
      expectedRevision: 1,
      issuedAt: "2026-08-01T22:10:00+08:00",
      question: {
        id: "neutral-review-scope",
        prompt: "Which review boundary should this isolated control-plane test keep?",
        whyItMatters:
          "It keeps the registry contract in framing, not fabricated planning.",
        recommendation: {
          value: "framing-only",
          rationale:
            "Revision 1 owns intent; planning state arrives only after later commands.",
          confidence: "high",
        },
        options: [{
          value: "framing-only",
          label: "Framing only",
          consequences: "The first mutation stays a living-brief question.",
        }],
        allowUnknown: true,
        risk: "reversible",
        evidenceNeeded: ["paired conversation"],
      },
    };
    const proposal = await client.call("tools/call", {
      name: "project_question_propose",
      arguments: proposalArguments,
    });
    const proposedProject = proposal.structuredContent as Record<string, unknown>;
    assertEquals(proposedProject.revision, 2);
    assertEquals(
      (proposedProject.commandReceipts as Array<Record<string, unknown>>).at(-1)
        ?.issuedAt,
      "2026-08-01T14:10:00.000Z",
    );
    const proposedQuestion = ((proposedProject.framing as Record<string, unknown>)
      .questions as Array<Record<string, unknown>>).find((item) =>
        item.id === "neutral-review-scope"
      )!;
    assertEquals(
      proposedQuestion.proposedBy as Record<string, unknown>,
      { id: "mcp:test@1", origin: "agent" },
    );

    const replay = await client.call("tools/call", {
      name: "project_question_propose",
      arguments: proposalArguments,
    });
    assertEquals(
      (replay.structuredContent as Record<string, unknown>).revision,
      2,
    );

    const stale = await client.call("tools/call", {
      name: "project_question_propose",
      arguments: {
        ...proposalArguments,
        commandId: "mcp-stale-proposal-2",
        question: {
          ...proposalArguments.question,
          id: "neutral-stale-review-scope",
        },
      },
    });
    assertEquals(stale.isError, true);
    assertStringIncludes(
      (stale.content as Array<Record<string, unknown>>)[0].text as string,
      "current revision is 2",
    );

    const projectTools = tools.filter((tool) =>
      String(tool.name).startsWith("project_")
    );
    assertEquals(
      projectTools.some((tool) =>
        [
          "project_decision_approve",
          "project_decision_reject",
          "project_agent_run_cancel",
          "project_work_item_abandon",
          "project_agent_run_queue",
        ]
          .includes(String(tool.name))
      ),
      true,
    );
    for (const tool of projectTools) {
      const annotations = tool.annotations as Record<string, unknown>;
      assertEquals(annotations.destructiveHint, false);
      assertEquals(annotations.openWorldHint, false);
      assertEquals(
        annotations.readOnlyHint,
        tool.name === "project_snapshot" ||
          tool.name === "project_source_workspace_snapshot" ||
          tool.name === "project_source_tree" ||
          tool.name === "project_source_search" ||
          tool.name === "project_source_file_read" ||
          tool.name === "project_source_attachment_read" ||
          tool.name === "project_source_attachment_list" ||
          tool.name === "project_product_explore" ||
          tool.name === "project_product_inspect" ||
          tool.name === "project_product_search" ||
          tool.name === "project_source_closure" ||
          tool.name === "project_agent_run_plan_get" ||
          tool.name === "project_capability_inspect" ||
          tool.name === "project_prescribed_kinematics_case_review" ||
          tool.name === "project_prescribed_kinematics_evaluation_closeout_review" ||
          tool.name === "project_prescribed_kinematics_evaluation_review" ||
          tool.name === "project_prescribed_kinematics_method_review" ||
          tool.name === "project_prescribed_kinematics_run_review" ||
          tool.name === "project_isolated_geometry_seal_review" ||
          tool.name === "project_buy_configuration_cost_capture_review" ||
          tool.name === "project_buy_configuration_cost_seal_review" ||
          tool.name === "project_buy_cost_estimate_preview_detail" ||
          tool.name === "project_led_driver_source_review" ||
          tool.name === "project_evaluation_closeout_review" ||
          tool.name === "project_assembly_integrity_evaluation_closeout_review" ||
          tool.name === "project_fea_proof_seal_review" ||
          tool.name === "project_fea_isolated_run_review" ||
          tool.name === "project_vector_correction_review" ||
          tool.name === "project_sensitivity_base_evaluation_review" ||
          tool.name === "project_sensitivity_edges_review" ||
          tool.name === "project_sensitivity_study_seal_review" ||
          tool.name === "project_cross_domain_impact_decision_review" ||
          tool.name === "project_cross_domain_impact_manifest_seal_review" ||
          tool.name === "project_brief_requirements_review" ||
          tool.name === "project_documentary_clause_response_review" ||
          tool.name === "project_requirements_brief_trace_review" ||
          tool.name === "project_requirements_recapture_review" ||
          tool.name === "project_response_read" ||
          tool.name === "project_brief_architecture_review" ||
          tool.name === "project_thermal_method_sheet_seal_review" ||
          tool.name === "project_admitted_modelica_evaluation_closeout_review" ||
          tool.name === "project_admitted_modelica_evaluation_review" ||
          tool.name === "project_admitted_spice_evaluation_closeout_review" ||
          tool.name === "project_admitted_spice_evaluation_review" ||
          tool.name === "project_electrical_observation_method_sheet_seal_review" ||
          tool.name === "project_admitted_geometry_export_preflight" ||
          tool.name === "project_technical_compilation_preview_detail",
      );
      assertEquals(
        annotations.idempotentHint,
        tool.name === "project_snapshot" ||
          tool.name === "project_source_workspace_snapshot" ||
          tool.name === "project_source_tree" ||
          tool.name === "project_source_search" ||
          tool.name === "project_source_file_read" ||
          tool.name === "project_source_attachment_read" ||
          tool.name === "project_source_attachment_list" ||
          tool.name === "project_product_explore" ||
          tool.name === "project_product_inspect" ||
          tool.name === "project_product_search" ||
          tool.name === "project_source_closure" ||
          tool.name === "project_source_module_put" ||
          tool.name === "project_source_file_put" ||
          tool.name === "project_source_file_remove" ||
          tool.name === "project_source_attachment_put" ||
          tool.name === "project_source_attachment_recross" ||
          tool.name === "project_source_attachment_detach" ||
          tool.name === "project_brief_requirements_review" ||
          tool.name === "project_documentary_clause_response_review" ||
          tool.name === "project_requirements_brief_trace_review" ||
          tool.name === "project_requirements_recapture_review" ||
          tool.name === "project_response_read" ||
          tool.name === "project_brief_architecture_review" ||
          tool.name === "project_start" ||
          tool.name === "project_question_propose" ||
          tool.name === "project_resource_capture" ||
          tool.name === "project_answer_record" ||
          tool.name === "project_brief_propose" ||
          tool.name === "project_brief_confirm" ||
          tool.name === "project_agent_run_cancel" ||
          tool.name === "project_agent_run_execute" ||
          tool.name === "project_agent_run_plan_get" ||
          tool.name === "project_agent_run_queue" ||
          tool.name === "project_capability_change_review" ||
          tool.name === "project_capability_inspect" ||
          tool.name === "project_prescribed_kinematics_case_review" ||
          tool.name === "project_prescribed_kinematics_evaluation_closeout_review" ||
          tool.name === "project_prescribed_kinematics_evaluation_review" ||
          tool.name === "project_prescribed_kinematics_method_review" ||
          tool.name === "project_prescribed_kinematics_run_review" ||
          tool.name === "project_architecture_sysml_preview" ||
          tool.name === "project_architecture_sysml_source_capture" ||
          tool.name === "project_cross_domain_impact_manifest_capture" ||
          tool.name === "project_led_driver_source_capture" ||
          tool.name === "project_fea_proof_case_capture" ||
          tool.name === "project_technical_compilation_preview" ||
          tool.name === "project_technical_source_capture" ||
          tool.name === "project_cad_placement_capture" ||
          tool.name === "project_admitted_geometry_export" ||
          tool.name === "project_work_item_abandon" ||
          tool.name === "project_decision_approve" ||
          tool.name === "project_decision_reject" ||
          tool.name === "project_isolated_geometry_seal_review" ||
          tool.name === "project_buy_configuration_cost_capture_review" ||
          tool.name === "project_buy_configuration_cost_seal_review" ||
          tool.name === "project_buy_cost_estimate_preview" ||
          tool.name === "project_buy_cost_estimate_preview_detail" ||
          tool.name === "project_led_driver_source_review" ||
          tool.name === "project_evaluation_closeout_review" ||
          tool.name === "project_assembly_integrity_evaluation_closeout_review" ||
          tool.name === "project_fea_proof_seal_review" ||
          tool.name === "project_fea_isolated_run_review" ||
          tool.name === "project_vector_correction_review" ||
          tool.name === "project_sensitivity_base_evaluation_review" ||
          tool.name === "project_sensitivity_edges_review" ||
          tool.name === "project_sensitivity_study_seal_review" ||
          tool.name === "project_cross_domain_impact_decision_review" ||
          tool.name === "project_cross_domain_impact_manifest_seal_review" ||
          tool.name === "project_thermal_method_sheet_seal_review" ||
          tool.name === "project_admitted_modelica_evaluation_closeout_review" ||
          tool.name === "project_admitted_modelica_evaluation_review" ||
          tool.name === "project_admitted_spice_evaluation_closeout_review" ||
          tool.name === "project_admitted_spice_evaluation_review" ||
          tool.name === "project_electrical_observation_method_sheet_seal_review" ||
          tool.name === "project_admitted_geometry_export_preflight" ||
          tool.name === "project_technical_compilation_preview_detail",
      );
    }
    const framingTools = tools.filter((tool) =>
      [
        "project_start",
        "project_question_propose",
        "project_answer_record",
        "project_brief_propose",
        "project_brief_confirm",
      ].includes(String(tool.name))
    );
    assertEquals(framingTools.length, 5);
    for (const tool of framingTools) {
      const annotations = tool.annotations as Record<string, unknown>;
      assertEquals(annotations.destructiveHint, false);
      assertEquals(annotations.openWorldHint, false);
      assertEquals(annotations.idempotentHint, true);
      assertEquals(annotations.readOnlyHint, false);
    }
    const focusTools = tools.filter((tool) =>
      String(tool.name).startsWith("cockpit_focus_")
    );
    assertEquals(focusTools.length, 2);
    for (const tool of focusTools) {
      const annotations = tool.annotations as Record<string, unknown>;
      assertEquals(annotations.destructiveHint, false);
      assertEquals(annotations.openWorldHint, false);
      assertEquals(annotations.idempotentHint, true);
      assertEquals(
        annotations.readOnlyHint,
        tool.name === "cockpit_focus_snapshot",
      );
    }
  } finally {
    await http.shutdown();
    await Deno.remove(temporaryDirectory, { recursive: true });
  }
});

class TestMcpClient {
  #id = 0;

  constructor(private readonly url: string) {}

  async discover(): Promise<Record<string, unknown>> {
    return await this.call("server/discover", {});
  }

  async call(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await this.#request({
      jsonrpc: "2.0",
      id: ++this.#id,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
        },
      },
    });
    const body = await parseResponse(response);
    if (body.error) throw new Error(JSON.stringify(body.error));
    const result = body.result as Record<string, unknown>;
    assertEquals(result.resultType, "complete");
    return result;
  }

  async listen(resourceSubscriptions: string[]): Promise<TestSseSubscription> {
    const subscriptionId = ++this.#id;
    const response = await this.#request({
      jsonrpc: "2.0",
      id: subscriptionId,
      method: "subscriptions/listen",
      params: {
        notifications: { resourceSubscriptions },
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
        },
      },
    }, "text/event-stream");
    assertEquals(response.status, 200);
    assertStringIncludes(
      response.headers.get("content-type") ?? "",
      "text/event-stream",
    );
    assert(response.body);
    return new TestSseSubscription(subscriptionId, response.body);
  }

  async #request(
    body: Record<string, unknown>,
    accept = "application/json",
  ): Promise<Response> {
    const headers: Record<string, string> = {
      accept,
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": String(body.method),
    };
    const params = body.params as Record<string, unknown>;
    if (body.method === "tools/call" && typeof params.name === "string") {
      headers["mcp-name"] = params.name;
    }
    if (body.method === "resources/read" && typeof params.uri === "string") {
      headers["mcp-name"] = params.uri;
    }
    const response = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    assertEquals(response.headers.get("mcp-session-id"), null);
    return response;
  }
}

class TestSseSubscription {
  readonly #reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly #decoder = new TextDecoder();
  #buffer = "";

  constructor(
    readonly subscriptionId: number,
    stream: ReadableStream<Uint8Array>,
  ) {
    this.#reader = stream.getReader();
  }

  async next(): Promise<Record<string, unknown>> {
    while (true) {
      const boundary = this.#buffer.indexOf("\n\n");
      if (boundary >= 0) {
        const event = this.#buffer.slice(0, boundary);
        this.#buffer = this.#buffer.slice(boundary + 2);
        const data = event.split("\n").flatMap((line) =>
          line.startsWith("data: ") ? [line.slice("data: ".length)] : []
        );
        if (data.length > 0) return JSON.parse(data.join("\n"));
        continue;
      }

      const chunk = await withTimeout(this.#reader.read(), 5_000);
      if (chunk.done) throw new Error("SSE subscription closed before next event");
      this.#buffer += this.#decoder.decode(chunk.value, { stream: true });
    }
  }

  async cancel(): Promise<void> {
    await this.#reader.cancel();
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`Timed out after ${timeoutMs} ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timeout));
}

async function parseResponse(
  response: Response,
): Promise<Record<string, unknown>> {
  const text = await response.text();
  return JSON.parse(text);
}

function build123dUnavailableProjectFixture(): EngineeringProjectSnapshot {
  const generatedAt = "2026-08-13T00:00:00.000Z";
  const workItemId = "execute-build123d";
  return {
    schemaVersion: "4.0",
    id: `${NEUTRAL_PROJECT_ID}:project:r2:build123d-unavailable`,
    revision: 2,
    previous: {
      snapshotId: `${NEUTRAL_PROJECT_ID}:project:r1`,
      revision: 1,
    },
    generatedAt,
    project: {
      id: NEUTRAL_PROJECT_ID,
      name: "Neutral engineering system",
      subjectId: `project:${NEUTRAL_PROJECT_ID}`,
      objective: {
        title: "Execute reviewed Build123d source",
        statement: "Dispatch fixture for an unavailable local Build123d runtime.",
      },
    },
    threadSnapshots: [],
    phases: [],
    workItems: [{
      id: workItemId,
      activityId: `activity:${workItemId}`,
      phaseId: "design",
      title: "Execute reviewed Build123d source",
      description: "Later work item used only to probe executor registration.",
      kind: "design",
      status: "in-progress",
      owner: "agent",
      operation: { ...DESIGN_EXECUTE_BUILD123D_OPERATION, bindings: [] },
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [],
      blockerIds: [],
    }],
    agentRuns: [{
      id: "run-build123d-unavailable",
      workItemId,
      status: "queued",
      summary: "Execute reviewed Build123d source",
      queuedAt: generatedAt,
      basis: {
        kind: "thread-snapshot",
        snapshotId: `${NEUTRAL_PROJECT_ID}:thread:r1`,
        revision: 1,
        subjectId: `project:${NEUTRAL_PROJECT_ID}`,
      },
      evidenceRefs: [],
    }],
    decisions: [],
    approvals: [],
    blockers: [],
  };
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isDirectory;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

function manifestFixture(): FleetManifest {
  return {
    version: 1,
    servers: [{
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
    }],
  };
}

function assemblyIntegrityBuild123dManifest(
  image: string,
  mcpUrl = "http://127.0.0.1:3014/mcp",
): FleetManifest {
  return {
    version: 1,
    servers: [{
      id: "build123d",
      displayName: "build123d",
      role: "factual assembly integrity",
      serviceName: "mcp-build123d",
      transport: "streamable-http",
      mcpUrl,
      healthUrl: mcpUrl.replace(/\/mcp$/, "/health"),
      image,
      required: true,
      expectedTools: ["build123d_observe_assembly_integrity"],
    }],
  };
}

function runFixture(): RunDetail {
  return {
    id: "run-1",
    name: "Run",
    subject: "Part",
    status: "documentary",
    verdictStatus: "not_evaluated",
    source: "demo",
    passedRequirements: 0,
    failedRequirements: 0,
    unresolvedRequirements: 0,
    description: "Test fixture",
    stages: [],
    measurements: [],
    provenance: [],
    warnings: [],
    requirements: [],
    evidence: [],
  };
}

function healthyProbe(): McpProbe {
  return {
    probe: () =>
      Promise.resolve({
        checkedAt: "2026-07-30T00:00:00.000Z",
        status: "healthy",
        httpStatus: 200,
        mcp: {
          reachable: true,
          tools: [{ name: "test_read" }],
          resourceUris: [],
          viewerUris: [],
        },
      }),
  };
}

function unavailableDocker(): DockerObserver {
  return {
    observe: (servers) =>
      Promise.resolve(
        new Map<string, ObservedContainer>(
          servers.map((server) => [
            server.id,
            {
              runtimeAvailable: false,
              present: false,
              error: "Docker unavailable",
            },
          ]),
        ),
      ),
  };
}
