import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import type { CockpitFocusStore } from "../../src/application/ports/out/project/cockpit-focus-store.ts";
import type { EngineeringProjectSnapshot } from "../../src/domain/project/engineering-project.ts";
import type { EngineeringProjectRevisionStore } from "../../src/application/ports/out/engineering-project-revision-store.ts";
import type { CockpitFocusSnapshot } from "../../src/domain/project/cockpit-focus.ts";
import { COCKPIT_FOCUS_SCHEMA_VERSION } from "../../src/domain/project/cockpit-focus.ts";
import { MODEL_WRITE_ARCHITECTURE_OPERATION } from "../../src/domain/architecture/renderer/architecture-proposal.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "../../src/domain/cad/canonical/geometry-proposal.ts";
import { MODEL_WRITE_REQUIREMENTS_OPERATION } from "../../src/domain/architecture/requirements/requirements-proposal.ts";
import { MODEL_WRITE_TRACED_REQUIREMENTS_OPERATION } from "../../src/domain/architecture/requirements/requirements-traced-proposal.ts";
import { MODEL_RECAPTURE_REQUIREMENTS_OPERATION } from "../../src/domain/architecture/requirements/requirements-recapture-proposal.ts";
import { MODEL_RECAPTURE_TRACED_REQUIREMENTS_OPERATION } from "../../src/domain/architecture/requirements/requirements-traced-recapture-proposal.ts";
import { RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION } from "../../src/domain/record/requirements-brief-trace.ts";
import { RECORD_DOCUMENTARY_CLAUSE_RESPONSE_OPERATION } from "../../src/domain/record/documentary-clause-response.ts";
import { COMPILE_SEAL_ADMISSION_OPERATION } from "../../src/domain/compile/admission/technical-compilation-proposal.ts";
import { DESIGN_EXECUTE_BUILD123D_OPERATION } from "../../src/domain/cad/isolated/build123d-execution-proposal.ts";
import {
  VERIFY_RUN_FEA_STATIC_PROOF_OPERATION,
  VERIFY_SEAL_PROOF_CASE_OPERATION,
} from "../../src/domain/fea/seal-case/fea-proof-proposal.ts";
import { SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION } from "../../src/domain/modelica/qualified-kit/run-proposal.ts";
import { SIMULATE_RUN_ADMITTED_MODELICA_OPERATION } from "../../src/domain/modelica/admitted/run-proposal.ts";
import { ARCHIVE_LINEAGE_OPERATION } from "../../src/domain/thread/thread-retirement.ts";
import {
  ANALYZE_RUN_FEA_SENSITIVITY_OPERATION,
  ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
  MODEL_WRITE_SENSITIVITY_EDGES_OPERATION,
} from "../../src/domain/sensitivity/study/sensitivity-study-proposal.ts";
import {
  VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION,
  VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
} from "../../src/orchestration/operations/fea-isolated-static-proof.ts";
import type { ThreadSnapshot } from "../../src/domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../src/domain/thread/thread-snapshot-store.ts";
import {
  createFocusedWorkspaceHandler,
  createNativeWorkbenchCapabilityWorkbench,
  createNativeWorkbenchHandler,
  hasUnattachedDurableProjectOperationForTest,
  injectMcpAppScriptNonce,
  MCP_APP_SCRIPT_NONCE_META_NAME,
  projectViewerReviewAnchors,
  readPersistedProjectCatalog,
  resolveNativeWorkbenchProjectId,
  resolveNativeWorkbenchStartupTarget,
  resolveNativeWorkbenchSubjectId,
  resolveWorkbenchUiAssetPath,
  ThreadViewerSessionsSequencer,
} from "./serve-native-workbench.ts";
import { FileEngineeringProjectRevisionStore } from "../../src/adapters/shared/stores/engineering-project-store.ts";
import { validateEngineeringProjectSnapshot } from "../../src/domain/project/engineering-project-validation.ts";
import {
  type NativeWorkbenchProjectDiscovery,
  readNativeWorkbenchProjectDiscovery,
} from "../../src/adapters/thread/native-workbench-project-discovery.ts";
import { verifiedArchitectureNavigationFixture } from "../../src/adapters/architecture/renderer/capture-product-structure-traversal_test.ts";
import { sampleAgentResourceReference } from "../../src/testing/agent-resource-test-support.ts";
import {
  applyProjectSourceWorkspaceCommand,
  emptyProjectSourceWorkspace,
} from "../../src/domain/project-source-workspace/transitions.ts";
import type { ProjectSourceWorkspaceState } from "../../src/domain/project-source-workspace/types.ts";
import { FileByteStore } from "../../src/adapters/shared/cas/file-byte-store.ts";
import {
  FileThreadViewerAppRegistry,
  THREAD_VIEWER_APP_REGISTRY_SCHEMA,
} from "../../src/adapters/thread/file-thread-viewer-app-registry.ts";
import { sha256Fingerprint } from "../../src/domain/kernel/deterministic-json.ts";
import { PROJECT_RESPONSE_SCHEMA } from "../../src/domain/project/project-response.ts";
import type { ProjectResponseUseCase } from "../../src/application/ports/in/project-response/project-response.ts";
import type {
  ThreadViewerAppBinding,
  ThreadViewerSessionsProjection,
} from "../../src/presentation/workbench/thread/viewer-sessions.ts";

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

Deno.test("Workbench HTML receives one strict document-scoped MCP App nonce", () => {
  const nonce = "A".repeat(43);
  assertEquals(
    injectMcpAppScriptNonce(
      "<!doctype html><html><head><title>Workbench</title></head><body></body></html>",
      nonce,
    ),
    `<!doctype html><html><head><meta name="${MCP_APP_SCRIPT_NONCE_META_NAME}" content="${nonce}"><title>Workbench</title></head><body></body></html>`,
  );
  assertThrows(
    () => injectMcpAppScriptNonce("<html></html>", "not-a-nonce"),
    TypeError,
  );
  assertThrows(
    () =>
      injectMcpAppScriptNonce(
        `<html><head><meta name="${MCP_APP_SCRIPT_NONCE_META_NAME}" content="${nonce}"></head></html>`,
        nonce,
      ),
    TypeError,
  );
});

async function writeViewerAppRegistryFixture(
  registryPath: string,
  objectDirectory: string,
  project: EngineeringProjectSnapshot,
) {
  const inputFingerprint = `sha256:${"1".repeat(64)}`;
  const payload = {
    schemaVersion: "io.casys.mcp-digital-thread.project-review-session/1.0",
    kind: "project-review",
    status: "provisional",
    basis: {
      projectId: project.project.id,
      projectRevision: project.revision,
      subjectId: project.project.subjectId,
    },
    anchor: {
      kind: "project-review",
      id: "brief:r2",
      revision: project.revision,
      fingerprint: inputFingerprint,
    },
    review: {
      kind: "brief",
      proposalId: "brief:r2",
      question: "Approve this exact proposed brief?",
      parameters: [],
      inputFingerprint,
    },
  } as const;
  const manifest = new TextEncoder().encode(JSON.stringify({
    schemaVersion: "io.casys.mcp.view-app-manifest/1.0",
    app: {
      id: "io.casys.mcp-digital-thread.review",
      title: "Exact project review",
      version: "1.0.0",
    },
    resources: [{
      uri: "ui://mcp-digital-thread/project-review",
      ownership: "whole-view",
      acceptedActions: ["viewer.session.apply"],
      sessionSchemas: [payload.schemaVersion],
      resultSchemas: [
        "io.casys.mcp-digital-thread.project-review-result/1.0",
      ],
    }],
  }));
  const html = new TextEncoder().encode(
    "<!doctype html><html><head><meta charset=utf-8><title>Exact project review</title></head><body><script type=\"module\">const c=new MessageChannel();c.port1.start();parent.postMessage({schemaVersion:'io.casys.mcp-app-host.resource-read/1.0',type:'mcp-app-host.resource.port.offer'},'*',[c.port2]);</script></body></html>",
  );
  const manifestDigest = await sha256Hex(manifest);
  const htmlDigest = await sha256Hex(html);
  const manifestFingerprint = `sha256:${manifestDigest}`;
  const htmlFingerprint = `sha256:${htmlDigest}`;
  const payloadSeal = await sha256Fingerprint(payload);
  const binding: ThreadViewerAppBinding = {
    basis: {
      projectId: project.project.id,
      projectRevision: project.revision,
      subjectId: project.project.subjectId,
    },
    anchor: {
      kind: "project-review",
      id: "brief:r2",
      revision: project.revision,
      fingerprint: inputFingerprint,
    },
    app: { id: "io.casys.mcp-digital-thread.review", version: "1.0.0" },
    manifest: {
      uri: "ui://mcp-digital-thread/app-manifest",
      fingerprint: manifestFingerprint,
    },
    resource: {
      uri: "ui://mcp-digital-thread/project-review",
      fingerprint: htmlFingerprint,
      ownership: "whole-view",
      mimeType: "text/html;profile=mcp-app",
      bytes: html.byteLength,
    },
    readResources: [],
    session: {
      action: "viewer.session.apply",
      schema: payload.schemaVersion,
      payload,
      fingerprint: `${payloadSeal.algorithm}:${payloadSeal.digest}`,
    },
  };
  const store = new FileByteStore({
    kind: "thread-viewer-app-object",
    directory: objectDirectory,
    uriNamespace: "thread-viewer-apps",
    label: "Thread viewer App object",
  });
  await store.save({ algorithm: "sha256", digest: manifestDigest }, manifest);
  await store.save({ algorithm: "sha256", digest: htmlDigest }, html);
  const registryText = JSON.stringify({
    schemaVersion: THREAD_VIEWER_APP_REGISTRY_SCHEMA,
    bindings: [binding],
    objects: [{
      role: "manifest",
      mimeType: "application/json",
      bytes: manifest.byteLength,
      fingerprint: manifestFingerprint,
    }, {
      role: "whole-view",
      mimeType: "text/html;profile=mcp-app",
      bytes: html.byteLength,
      fingerprint: htmlFingerprint,
    }],
  });
  await Deno.writeTextFile(registryPath, registryText);
  return { html, htmlDigest, payload, registryText };
}

function viewerSessionsEventReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
) {
  let pending = "";
  const decoder = new TextDecoder();
  return async (): Promise<{
    sequence: number;
    sessions: Array<{ launchUri?: string }>;
  }> => {
    while (true) {
      const boundary = pending.indexOf("\n\n");
      if (boundary >= 0) {
        const block = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        if (!block.includes("event: viewer-sessions")) continue;
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (!data) continue;
        return JSON.parse(data);
      }
      const result = await readStreamWithTimeout(reader);
      if (result.done) throw new Error("viewer sessions SSE ended early");
      pending += decoder.decode(result.value, { stream: true });
    }
  };
}

function readStreamWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out waiting for viewer sessions SSE")),
      2_000,
    );
    reader.read().then((result) => {
      clearTimeout(timer);
      resolve(result);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

Deno.test("native Workbench resolves an agent-selected project and its subject", async () => {
  const project = projectFixture("project-one", "subject-one");
  const projects = new ProjectStore([project]);

  assertEquals(
    resolveNativeWorkbenchProjectId(undefined, undefined),
    undefined,
  );
  assertEquals(
    resolveNativeWorkbenchProjectId(undefined, "subject-one"),
    undefined,
  );
  assertEquals(
    resolveNativeWorkbenchProjectId("project-one", "subject-one"),
    "project-one",
  );
  assertEquals(
    await resolveNativeWorkbenchSubjectId("project-one", undefined, projects),
    "subject-one",
  );
  assertEquals(
    await resolveNativeWorkbenchSubjectId(
      "project-one",
      "subject-override",
      projects,
    ),
    "subject-override",
  );
});

Deno.test("native Workbench startup requires a durable focus or explicit target", () => {
  assertEquals(
    resolveNativeWorkbenchStartupTarget({
      "no-seed": "true",
      "workspace-id": "primary",
    }),
    {
      hostname: "127.0.0.1",
      port: 5175,
      noSeed: true,
      workspaceId: "primary",
      projectId: undefined,
      explicitSubjectId: undefined,
    },
  );
  assertThrows(
    () => resolveNativeWorkbenchStartupTarget({}),
    TypeError,
    "--workspace-id or --project-id is required",
  );
  assertThrows(
    () => resolveNativeWorkbenchStartupTarget({ "no-seed": "true" }),
    TypeError,
    "--workspace-id or --project-id is required",
  );
  assertThrows(
    () => resolveNativeWorkbenchStartupTarget({ subject: "subject-one" }),
    TypeError,
    "--subject requires --project-id.",
  );
});

Deno.test("native Workbench --project-id pin disables workspace focus follow", () => {
  assertEquals(
    resolveNativeWorkbenchStartupTarget({
      "workspace-id": "primary",
      "project-id": "modular-sensor-mount-msm01",
    }),
    {
      hostname: "127.0.0.1",
      port: 5175,
      noSeed: true,
      workspaceId: undefined,
      projectId: "modular-sensor-mount-msm01",
      explicitSubjectId: undefined,
    },
  );
});

Deno.test("native Workbench GET serves the pinned project instead of durable focus", async () => {
  const pinned = projectFixture(
    "modular-sensor-mount-msm01",
    "project:modular-sensor-mount-msm01",
  );
  const focused = projectFixture(
    "two-piece-tablet-stand-tps03",
    "project:two-piece-tablet-stand-tps03",
  );
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([pinned, focused]),
    projectId: pinned.project.id,
    workspaceId: "primary",
    cockpitFocus: new MutableFocus(focusSnapshot(focused.project.id)),
    html: "unused",
  });

  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  assertEquals(response.status, 200);
  const body = await response.json() as {
    project: { project: { id: string } };
  };
  assertEquals(body.project.project.id, pinned.project.id);
});

Deno.test("native Workbench GET does not substitute focus when a pin is missing", async () => {
  const focused = projectFixture(
    "two-piece-tablet-stand-tps03",
    "project:two-piece-tablet-stand-tps03",
  );
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([focused]),
    projectId: "modular-sensor-mount-msm01",
    workspaceId: "primary",
    cockpitFocus: new MutableFocus(focusSnapshot(focused.project.id)),
    html: "unused",
  });

  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  assertEquals(response.status, 404);
  assertEquals(await response.json(), {
    error: "engineering_project_not_found",
    projectId: "modular-sensor-mount-msm01",
  });
});

Deno.test("native Workbench rejects a non-loopback bind host", () => {
  for (const hostname of ["0.0.0.0", "workbench.test"]) {
    assertThrows(
      () => resolveNativeWorkbenchStartupTarget({ host: hostname }),
      TypeError,
      "--host must be an explicit loopback hostname",
    );
  }
  assertEquals(
    resolveNativeWorkbenchStartupTarget({
      host: "localhost",
      "workspace-id": "primary",
    }).hostname,
    "localhost",
  );
});

Deno.test("native Workbench health is independent of focus and project state", async () => {
  let focusReads = 0;
  const focus: CockpitFocusStore = {
    get: () => {
      focusReads += 1;
      return Promise.resolve(undefined);
    },
    select: (snapshot) => Promise.resolve(snapshot),
  };
  const native = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([]),
    html: "unused",
  });
  const handler = createFocusedWorkspaceHandler({
    focus,
    workspaceId: "primary",
    native,
  });

  const response = await handler(new Request("http://localhost/healthz"));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    status: "ok",
    service: "native-workbench",
  });
  assertEquals(focusReads, 0);
  const rejected = await handler(
    new Request("http://localhost/healthz", { method: "POST" }),
  );
  assertEquals(rejected.status, 405);
  assertEquals(focusReads, 0);

  const unavailable = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  assertEquals(unavailable.status, 409);
  assertEquals((await unavailable.json()).error, "cockpit_focus_not_selected");
  assertEquals(focusReads, 1);
});

Deno.test("Desktop can opt into the native document and assets without inventing project focus", async () => {
  const directory = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${directory}/assets`);
    await Deno.writeTextFile(
      `${directory}/native-workbench.html`,
      `<html><head><script type="module" src="./assets/native-workbench-test.js"></script></head><body><div id="native-preview"></div></body></html>`,
    );
    await Deno.writeTextFile(
      `${directory}/assets/native-workbench-test.js`,
      "export const ready = true;\n",
    );
    const focus = new MutableFocus(undefined);
    const native = createNativeWorkbenchHandler({
      store: new EmptyThreadStore(),
      projectStore: new ProjectStore([]),
      cockpitFocus: focus,
      workspaceId: "primary",
      htmlPath: `${directory}/native-workbench.html`,
    });
    const handler = createFocusedWorkspaceHandler({
      focus,
      workspaceId: "primary",
      native,
      allowUnfocusedDocument: true,
    });

    for (const path of ["/", "/native-workbench.html"]) {
      const response = await handler(new Request(`http://localhost${path}`));
      assertEquals(response.status, 200);
      const html = await response.text();
      assertStringIncludes(html, 'id="native-preview"');
      assertStringIncludes(html, "./assets/native-workbench-test.js");
      assertStringIncludes(html, MCP_APP_SCRIPT_NONCE_META_NAME);
      assertEquals(html.includes("Cockpit awaiting project context"), false);
      assertStringIncludes(
        response.headers.get("Content-Security-Policy") ?? "",
        "script-src 'self'",
      );
      assertEquals(
        (await handler(new Request(`http://localhost${path}`, { method: "POST" })))
          .status,
        405,
      );
    }
    const script = await handler(
      new Request("http://localhost/assets/native-workbench-test.js"),
    );
    assertEquals(script.status, 200);
    assertEquals(await script.text(), "export const ready = true;\n");

    for (
      const path of [
        "/api/thread/workbench",
        "/api/project/capabilities",
        "/api/thread/viewer-sessions",
      ]
    ) {
      const response = await handler(new Request(`http://localhost${path}`));
      assertEquals(response.status, 409);
      assertEquals((await response.json()).error, "cockpit_focus_not_selected");
    }
    assertEquals(focus.value, undefined);

    const generic = createFocusedWorkspaceHandler({
      focus,
      workspaceId: "primary",
      native,
    });
    const genericPage = await generic(new Request("http://localhost/"));
    assertStringIncludes(await genericPage.text(), "Cockpit awaiting project context");
    assertEquals(focus.value, undefined);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("native Workbench exposes the redacted capability projection by GET only", async () => {
  const project = projectFixture(
    "project-capabilities",
    "subject-capabilities",
  );
  let reads = 0;
  const projection = {
    schemaVersion: "project-capability-workbench/1.0",
    project: {
      id: "project-capabilities",
      snapshotId: project.id,
      revision: project.revision,
    },
    authorization: { status: "not-authorized", fingerprint: null },
    demand: {
      plannedCeiling: {
        status: "resolved",
        requirements: [],
        fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      },
      jit: {
        status: "resolved",
        requirements: [],
        fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
      },
    },
    plan: { status: "ready", activation: "allowed", blockers: [] },
    bindings: [],
    units: [],
    materials: [],
    footprint: null,
    effects: {
      serviceCount: 0,
      volumeCount: 0,
      networkModes: [],
      bindMountCount: 0,
      deviceCount: 0,
      licences: { reviewed: 0, unknown: 0 },
      security: "reviewed",
    },
    projectionFingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
  } as never;
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    html: "unused",
    capabilityWorkbench: {
      read: (requested) => {
        reads += 1;
        assertEquals(requested.id, project.id);
        return Promise.resolve(projection);
      },
    },
  });

  const response = await handler(
    new Request("http://localhost/api/project/capabilities"),
  );
  assertEquals(response.status, 200);
  const serialized = await response.text();
  assertStringIncludes(serialized, "project-capability-workbench/1.0");
  assertEquals(serialized.includes("docker"), false);
  assertEquals(serialized.includes("credential"), false);
  assertEquals(reads, 1);

  const rejected = await handler(
    new Request("http://localhost/api/project/capabilities", {
      method: "POST",
    }),
  );
  assertEquals(rejected.status, 405);
  assertEquals(rejected.headers.get("Allow"), "GET");
  assertEquals(reads, 1);
});

Deno.test("native Workbench projects capabilities through a non-default ledger directory", async () => {
  const project = projectFixture(
    "project-custom-ledger",
    "subject-custom-ledger",
  );
  const ledgerDirectory = "/tmp/casys-custom-capability-ledgers";
  let configuredLedgerDirectory: string | undefined;
  const projection = {
    schemaVersion: "project-capability-workbench/1.0",
    project: {
      id: project.project.id,
      snapshotId: project.id,
      revision: project.revision,
    },
    authorization: {
      status: "authorized",
      fingerprint: { algorithm: "sha256", digest: "d".repeat(64) },
    },
  } as never;
  const capabilityWorkbench = await createNativeWorkbenchCapabilityWorkbench(
    { "project-capability-ledger-dir": ledgerDirectory },
    (options) => {
      configuredLedgerDirectory = options.ledgerDirectory;
      return Promise.resolve({
        workbench: {
          read: (requested) => {
            assertEquals(requested.id, project.id);
            return Promise.resolve(projection);
          },
        },
      });
    },
  );
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    html: "unused",
    capabilityWorkbench,
  });

  const response = await handler(
    new Request("http://localhost/api/project/capabilities"),
  );
  assertEquals(response.status, 200);
  assertEquals(configuredLedgerDirectory, ledgerDirectory);
  assertEquals((await response.json()).authorization.status, "authorized");
});

Deno.test("native Workbench exposes persisted projects without inventing a default focus", async () => {
  const focus = new MutableFocus(undefined);
  const catalog = {
    schemaVersion: "native-workbench-project-catalog/1.0" as const,
    state: "available" as const,
    projects: [{
      id: "project-<one>",
      name: "Pump & <script>alert(1)</script>",
      revision: 7,
      subjectId: "subject-one",
    }],
  };
  const native = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([]),
    html: "unused",
    projectCatalog: () => Promise.resolve(catalog),
  });
  const handler = createFocusedWorkspaceHandler({
    focus,
    workspaceId: "primary",
    native,
    projectCatalog: () => Promise.resolve(catalog),
  });

  const projects = await handler(new Request("http://localhost/api/projects"));
  assertEquals(projects.status, 200);
  assertEquals(await projects.json(), catalog);
  assertEquals(projects.headers.get("X-Content-Type-Options"), "nosniff");

  const page = await handler(new Request("http://localhost/"));
  const html = await page.text();
  assertEquals(page.status, 200);
  assertStringIncludes(
    html,
    "Pump &amp; &lt;script&gt;alert(1)&lt;/script&gt;",
  );
  assertStringIncludes(html, "project-&lt;one&gt;");
  assertEquals(html.includes("<script>alert(1)</script>"), false);
  assertEquals(html.includes("href="), false);
  assertEquals(html.includes("<form"), false);
  assertStringIncludes(
    page.headers.get("Content-Security-Policy") ?? "",
    "connect-src 'self'",
  );

  const rejected = await handler(
    new Request("http://localhost/", { method: "POST" }),
  );
  assertEquals(rejected.status, 405);
  assertEquals(rejected.headers.get("Allow"), "GET");
  assertEquals(rejected.headers.get("X-Frame-Options"), "DENY");
});

Deno.test("native Workbench labels persisted-project discovery literally unavailable", async () => {
  const unavailable = {
    schemaVersion: "native-workbench-project-catalog/1.0" as const,
    state: "unavailable" as const,
    projects: [] as const,
    reason: "Persisted project revisions could not be reopened exactly.",
  };
  const native = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([]),
    html: "unused",
    projectCatalog: () => Promise.resolve(unavailable),
  });
  const handler = createFocusedWorkspaceHandler({
    focus: new MutableFocus(undefined),
    workspaceId: "primary",
    native,
    projectCatalog: () => Promise.resolve(unavailable),
  });

  const projects = await handler(new Request("http://localhost/api/projects"));
  assertEquals(projects.status, 503);
  assertEquals((await projects.json()).state, "unavailable");
  const page = await handler(new Request("http://localhost/"));
  assertStringIncludes(await page.text(), "<strong>unavailable</strong>");
});

Deno.test("native Workbench v2 discovery keeps a healthy project visible beside an invalid head", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "native-workbench-project-discovery-serve-",
  });
  try {
    const store = new FileEngineeringProjectRevisionStore(directory);
    const valid = await store.createInitial(
      discoveryProjectFixture("healthy-id01", "Healthy ID01"),
    );
    await Deno.mkdir(`${directory}/legacy-unsupported`);
    await Deno.writeTextFile(
      `${directory}/legacy-unsupported/0000000001.json`,
      DISCOVERY_LEAK_JSON,
    );
    const before = await discoveryTreeSnapshot(directory);
    const native = createNativeWorkbenchHandler({
      store: new EmptyThreadStore(),
      projectStore: store,
      html: "unused",
      projectCatalog: () => readPersistedProjectCatalog(store, directory),
      projectDiscovery: () => readNativeWorkbenchProjectDiscovery(store, directory),
    });
    const handler = createFocusedWorkspaceHandler({
      focus: new MutableFocus(undefined),
      workspaceId: "primary",
      native,
      projectCatalog: () => readPersistedProjectCatalog(store, directory),
      projectDiscovery: () => readNativeWorkbenchProjectDiscovery(store, directory),
    });

    const catalog = await handler(new Request("http://localhost/api/projects"));
    assertEquals(catalog.status, 503);
    assertEquals((await catalog.json()).state, "unavailable");

    const discovery = await handler(
      new Request("http://localhost/api/project-discovery"),
    );
    assertEquals(discovery.status, 200);
    const body = await discovery.json() as NativeWorkbenchProjectDiscovery;
    assertEquals(body.schemaVersion, "native-workbench-project-discovery/2.0");
    assertEquals(body.state, "partial");
    assertEquals(body.counts, {
      available: 1,
      unavailable: 1,
      candidates: 2,
    });
    assertEquals(body.entries[0], {
      kind: "available",
      id: "healthy-id01",
      name: "Healthy ID01",
      revision: 1,
      subjectId: "healthy-id01-subject",
    });
    const unavailable = body.entries[1];
    assertEquals(unavailable.kind, "unavailable");
    if (unavailable.kind !== "unavailable") return;
    assertEquals(unavailable.observedStorageIdentifier, "legacy-unsupported");
    assertEquals(unavailable.identityAuthority, "observed-storage");
    assertEquals(unavailable.reasonCode, "validation-failure");
    assertEquals("name" in unavailable, false);
    assertEquals("status" in unavailable, false);
    assertDiscoveryNoLeak(JSON.stringify(body));

    const page = await handler(new Request("http://localhost/"));
    const html = await page.text();
    assertEquals(page.status, 200);
    assertStringIncludes(html, 'data-discovery-kind="available"');
    assertStringIncludes(html, 'data-discovery-kind="unavailable"');
    assertStringIncludes(html, "Healthy ID01");
    assertStringIncludes(html, "<code>healthy-id01</code>");
    assertStringIncludes(html, "legacy-unsupported");
    assertEquals(html.includes("<a href="), false);
    assertEquals(html.includes("/projects/"), false);
    assertEquals(html.includes("<form"), false);
    assertEquals(html.includes("<button"), false);
    assertEquals(html.includes("cockpit_focus_set"), false);
    assertStringIncludes(
      html,
      "Choose the project from the paired assistant.",
    );
    const invented = await handler(
      new Request("http://localhost/projects/healthy-id01"),
    );
    assertEquals(invented.status, 200);
    assertStringIncludes(
      await invented.text(),
      "Choose the project from the paired assistant.",
    );
    assertDiscoveryNoLeak(html);

    const focused = createNativeWorkbenchHandler({
      store: new EmptyThreadStore(),
      projectStore: store,
      projectId: valid.project.id,
      subjectId: valid.project.subjectId,
      html: "unused",
    });
    const snapshot = await focused(
      new Request("http://localhost/api/thread/workbench"),
    );
    assertEquals(snapshot.status, 200);
    assertEquals((await snapshot.json()).project.project.id, "healthy-id01");
    assertEquals(await discoveryTreeSnapshot(directory), before);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("native Workbench v2 discovery labels five valid and five invalid roots", async () => {
  const entries: NativeWorkbenchProjectDiscovery["entries"][number][] = [];
  for (let index = 1; index <= 5; index++) {
    entries.push({
      kind: "available",
      id: `good-${index}`,
      name: `Good ${index}`,
      revision: 1,
      subjectId: `good-${index}-subject`,
    });
  }
  for (let index = 1; index <= 5; index++) {
    entries.push({
      kind: "unavailable",
      observedStorageIdentifier: `bad-<${index}>`,
      identityAuthority: "observed-storage",
      reasonCode: "malformed-head",
      message: "Observed project head is not well-formed published JSON.",
    });
  }
  const discovery: NativeWorkbenchProjectDiscovery = {
    schemaVersion: "native-workbench-project-discovery/2.0",
    state: "partial",
    counts: { available: 5, unavailable: 5, candidates: 10 },
    enumeration: { complete: true, truncated: false },
    entries,
  };
  const handler = createFocusedWorkspaceHandler({
    focus: new MutableFocus(undefined),
    workspaceId: "primary",
    native: createNativeWorkbenchHandler({
      store: new EmptyThreadStore(),
      projectStore: new ProjectStore([]),
      html: "unused",
      projectDiscovery: () => Promise.resolve(discovery),
    }),
    projectDiscovery: () => Promise.resolve(discovery),
  });

  const response = await handler(
    new Request("http://localhost/api/project-discovery"),
  );
  assertEquals(response.status, 200);
  assertEquals((await response.json()).counts.candidates, 10);

  const html = await (await handler(new Request("http://localhost/"))).text();
  for (let index = 1; index <= 5; index++) {
    assertStringIncludes(html, `Good ${index}`);
    assertStringIncludes(html, `<code>good-${index}</code>`);
    assertStringIncludes(html, `bad-&lt;${index}&gt;`);
  }
  assertEquals(html.includes("<script>"), false);
  assertEquals(html.includes("<a href="), false);
  assertEquals(html.includes("/projects/"), false);
  assertEquals(html.includes("<form"), false);
  assertEquals(html.includes("<button"), false);
  assertEquals(html.includes("cockpit_focus_set"), false);
  assertStringIncludes(
    html,
    "Choose the project from the paired assistant.",
  );
});

Deno.test("native Workbench v2 discovery stays GET-only and fail-closed when unwired", async () => {
  const handler = createFocusedWorkspaceHandler({
    focus: new MutableFocus(undefined),
    workspaceId: "primary",
    native: createNativeWorkbenchHandler({
      store: new EmptyThreadStore(),
      projectStore: new ProjectStore([]),
      html: "unused",
    }),
  });
  const missing = await handler(
    new Request("http://localhost/api/project-discovery"),
  );
  assertEquals(missing.status, 503);
  assertEquals((await missing.json()).state, "unavailable");
  const rejected = await handler(
    new Request("http://localhost/api/project-discovery", { method: "POST" }),
  );
  assertEquals(rejected.status, 405);
  assertEquals(rejected.headers.get("Allow"), "GET");
});

Deno.test("native Workbench v2 discovery redacts leaked credentials from API and HTML", async () => {
  const discovery: NativeWorkbenchProjectDiscovery = {
    schemaVersion: "native-workbench-project-discovery/2.0",
    state: "partial",
    counts: { available: 0, unavailable: 1, candidates: 1 },
    enumeration: { complete: true, truncated: false },
    entries: [{
      kind: "unavailable",
      observedStorageIdentifier: "broken",
      identityAuthority: "observed-storage",
      reasonCode: "validation-failure",
      message:
        "Observed project head is not a valid current EngineeringProjectSnapshot.",
    }],
  };
  const handler = createFocusedWorkspaceHandler({
    focus: new MutableFocus(undefined),
    workspaceId: "primary",
    native: createNativeWorkbenchHandler({
      store: new EmptyThreadStore(),
      projectStore: new ProjectStore([]),
      html: "unused",
      projectDiscovery: () => Promise.resolve(discovery),
    }),
    projectDiscovery: () => Promise.resolve(discovery),
  });
  const api = await (await handler(
    new Request("http://localhost/api/project-discovery"),
  )).text();
  const html = await (await handler(new Request("http://localhost/"))).text();
  assertDiscoveryNoLeak(`${api}\n${html}`);
});

Deno.test("native Workbench serves a planning-only project without borrowing a thread", async () => {
  const project = projectFixture("project-one", "subject-one");
  const store = new EmptyThreadStore();
  const handler = createNativeWorkbenchHandler({
    store,
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
  });

  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("X-Casys-Data-Source"),
    "engineering-project-plan",
  );
  assertEquals(body.surface, "planning");
  assertEquals(body.project.threadSnapshots, []);
  assertEquals(body.planning.technicalBaseline.status, "not-created");
  assertEquals(store.latestCalls, 0);
  assertEquals(Object.hasOwn(body, "response"), false);
});

Deno.test("native Workbench evidence GET enriches the already-resolved project and Thread via project()", async () => {
  const r2 = genericArchitectureThreadSnapshot(2);
  const r3 = genericArchitectureThreadSnapshot(3, r2);
  const project = genericArchitectureProject("completed", r2, r3);
  const seen: Array<{ projectRevision: number; threadId?: string }> = [];
  const projectResponse: ProjectResponseUseCase = {
    read: () => Promise.reject(new Error("Workbench must not call read()")),
    project: (query) => {
      seen.push({
        projectRevision: query.project.revision,
        threadId: query.thread?.id,
      });
      return Promise.resolve({
        schemaVersion: PROJECT_RESPONSE_SCHEMA,
        status: "available",
        basis: {
          projectId: query.project.project.id,
          projectRevision: query.project.revision,
          brief: {
            briefId: query.project.framing!.currentBrief!.briefId,
            snapshotId: query.project.framing!.currentBrief!.id,
            revision: query.project.framing!.currentBrief!.revision,
          },
          thread: query.thread
            ? {
              snapshotId: query.thread.id,
              revision: query.thread.revision,
              subjectId: query.thread.subject.id,
            }
            : undefined,
        },
        items: query.project.framing!.currentBrief!.items.map((item) => ({
          item,
          correspondence: "unresolved" as const,
          requirements: [],
          clauseResponses: [],
          gaps: [{
            code: "correspondence.missing",
            message: "No exact mapping.",
          }],
        })),
        historicalClauseResponses: [],
        diagnostics: [],
        grants: "none",
      });
    },
  };
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([r2, r3]),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
    projectResponse,
  });
  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  const body = await response.json() as {
    surface: string;
    thread: { id: string; revision: number };
    response: {
      schemaVersion: string;
      basis: { projectRevision: number; thread?: { snapshotId: string } };
      items: unknown[];
    };
  };
  assertEquals(response.status, 200);
  assertEquals(body.surface, "evidence");
  assertEquals(body.thread.id, r3.id);
  assertEquals(body.response.schemaVersion, PROJECT_RESPONSE_SCHEMA);
  assertEquals(body.response.basis.projectRevision, project.revision);
  assertEquals(body.response.basis.thread?.snapshotId, body.thread.id);
  assertEquals(body.response.items.length, 3);
  assertEquals(seen, [{
    projectRevision: project.revision,
    threadId: body.thread.id,
  }]);
});

Deno.test("native Workbench keeps a durable unattached generic architecture snapshot out of preview until completion attaches it", async () => {
  const r2 = genericArchitectureThreadSnapshot(2);
  const r3 = genericArchitectureThreadSnapshot(3, r2);
  const projects = new ProjectStore([
    genericArchitectureProject("queued", r2, r3),
  ]);
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([r2, r3]),
    projectStore: projects,
    projectId: "generic-architecture-project",
    subjectId: r2.subject.id,
    html: "unused",
  });

  for (const status of ["queued", "running", "publishing", "failed"] as const) {
    projects.replace(genericArchitectureProject(status, r2, r3));
    assertEquals(await previewThreadId(handler), r2.id);
  }

  projects.replace(genericArchitectureProject("completed", r2, r3));
  assertEquals(await previewThreadId(handler), r3.id);
});

Deno.test("native Workbench labels a dangling decision evidence reference instead of failing the projection", async () => {
  const r2 = genericArchitectureThreadSnapshot(2);
  const r3 = genericArchitectureThreadSnapshot(3, r2);
  const project = genericArchitectureProject("completed", r2, r3);
  const withDanglingDecision: EngineeringProjectSnapshot = {
    ...project,
    decisions: [{
      id: "decision:abandoned-work",
      phaseId: "architecture",
      title: "Approve work that was later abandoned",
      question: "Should the abandoned binding be executed?",
      status: "required",
      requestedAt: "2026-08-08T05:10:00.000Z",
      inputEvidenceRefs: [{
        snapshotId: r3.id,
        snapshotRevision: r3.revision,
        kind: "artifact",
        id: "artifact-that-never-existed",
      }],
      approvalIds: [],
    }],
  };
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([r2, r3]),
    projectStore: new ProjectStore([withDanglingDecision]),
    projectId: "generic-architecture-project",
    subjectId: r2.subject.id,
    html: "unused",
  });

  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.surface, "evidence");
  assertEquals(body.unresolvedEvidenceReferences.length, 1);
  assertEquals(
    body.unresolvedEvidenceReferences[0].path,
    "$.decisions[0].inputEvidenceRefs[0]",
  );
  assertEquals(
    Object.keys(body.unresolvedEvidenceReferences[0]).toSorted(),
    ["message", "path"],
  );
});

Deno.test("native Workbench applies the engineering-case read model after pure projection", async () => {
  const r2 = genericArchitectureThreadSnapshot(2);
  const r3 = genericArchitectureThreadSnapshot(3, r2);
  const project = genericArchitectureProject("completed", r2, r3);
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([r2, r3]),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
    engineeringCaseCaptures: {
      mechanicalProof: { read: () => Promise.resolve(undefined) },
      sensitivityStudy: { read: () => Promise.resolve(undefined) },
      printabilityCheck: { read: () => Promise.resolve(undefined) },
      printEstimate: { read: () => Promise.resolve(undefined) },
      dfmCheck: { read: () => Promise.resolve(undefined) },
    },
  });

  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.surface, "evidence");
  assertEquals(body.thread.engineeringCases, {
    schemaVersion: "engineering-cases/1.1",
    status: "unresolved",
    coverage: [
      { family: "mechanical-proof", status: "observed" },
      { family: "sensitivity-study", status: "observed" },
      { family: "printability-check", status: "observed" },
      { family: "print-estimate", status: "observed" },
      { family: "dfm-check", status: "observed" },
      { family: "pre-sizing-worksheet", status: "unavailable" },
    ],
    cases: [],
    current: [],
    issues: [],
  });
});

Deno.test("native Workbench snapshot never reopens technical admissions or source workspaces", async () => {
  const r2 = genericArchitectureThreadSnapshot(2);
  const r3 = genericArchitectureThreadSnapshot(3, r2);
  const project = genericArchitectureProject("completed", r2, r3);
  let admissionReads = 0;
  let workspaceLoads = 0;
  let requirementReads = 0;
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([r2, r3]),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
    technicalCompilationAdmissions: {
      read: () => {
        admissionReads += 1;
        return Promise.resolve(undefined);
      },
    },
    projectSourceWorkspace: {
      load: () => {
        workspaceLoads += 1;
        return Promise.reject(new Error("no workspace for this snapshot"));
      },
      loadAtFresh: () => {
        workspaceLoads += 1;
        return Promise.reject(new Error("no workspace for this snapshot"));
      },
    },
    requirementsCaptures: {
      read: () => {
        requirementReads += 1;
        return Promise.resolve(undefined);
      },
    },
  });

  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.surface, "evidence");
  assertEquals(Object.hasOwn(body.thread, "sourceFiles"), false);
  assertEquals(
    body.thread.requirements.every((item: { targetElementId?: string }) =>
      item.targetElementId === undefined
    ),
    true,
  );
  assertEquals(admissionReads, 0);
  assertEquals(workspaceLoads, 0);
  assertEquals(requirementReads, 0);
});

Deno.test("native Workbench does not embed product-navigation or component catalogs", async () => {
  const r2 = genericArchitectureThreadSnapshot(2);
  const r3 = genericArchitectureThreadSnapshot(3, r2);
  const project = genericArchitectureProject("completed", r2, r3);
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([r2, r3]),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
    productStructureCaptures: {
      read: () => Promise.resolve(undefined),
    },
  });
  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(Object.hasOwn(body.thread, "productNavigation"), false);
  assertEquals(Object.hasOwn(body.thread, "components"), false);
});

Deno.test("native Workbench product-navigation GET publishes exact roots and default projection", async () => {
  const fixture = await verifiedArchitectureNavigationFixture();
  const projectId = "project.verified-architecture";
  const project = {
    project: {
      id: projectId,
      subjectId: fixture.snapshot.subject.id,
    },
    threadSnapshots: [{
      snapshotId: fixture.snapshot.id,
      revision: fixture.snapshot.revision,
      subjectId: fixture.snapshot.subject.id,
    }],
  } as unknown as EngineeringProjectSnapshot;
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([fixture.snapshot]),
    projectStore: new ProjectStore([project]),
    projectId,
    subjectId: fixture.snapshot.subject.id,
    html: "unused",
    productStructureCaptures: fixture.reader,
    sysmlSourceAnalysis: fixture.sourceAnalysis,
  });
  const roots = await (await handler(
    new Request("http://localhost/api/thread/product-navigation?view=roots"),
  )).json();
  assertEquals(roots.status, "observed");
  assertEquals(roots.focus.element.elementId, "sys-def-001");
  assertEquals(
    roots.basis.architectureArtifactId,
    `architecture-${fixture.fingerprint.digest}`,
  );
  assertEquals(
    roots.basis.architectureFingerprint,
    `sha256:${fixture.fingerprint.digest}`,
  );
  const def = await (await handler(
    new Request("http://localhost/api/thread/product-navigation"),
  )).json();
  assertEquals(def.status, "observed");
  assertEquals(def.roots[0]?.element.elementId, "sys-def-001");
  assertEquals(
    def.children.map((node: { element: { elementId: string } }) =>
      node.element.elementId
    ),
    ["alpha-use-001"],
  );
  assertEquals(
    def.basis.architectureArtifactId,
    roots.basis.architectureArtifactId,
  );
});

Deno.test("native Workbench product-navigation GET stays on the declared Thread tip", async () => {
  const fixture = await verifiedArchitectureNavigationFixture();
  const projectId = "project.verified-architecture";
  const descendant: ThreadSnapshot = {
    ...fixture.snapshot,
    id: `${fixture.snapshot.subject.id}:r2-undeclared`,
    revision: fixture.snapshot.revision + 1,
    previous: {
      snapshotId: fixture.snapshot.id,
      revision: fixture.snapshot.revision,
    },
  };
  const project = {
    project: {
      id: projectId,
      subjectId: fixture.snapshot.subject.id,
    },
    threadSnapshots: [{
      snapshotId: fixture.snapshot.id,
      revision: fixture.snapshot.revision,
      subjectId: fixture.snapshot.subject.id,
    }],
  } as unknown as EngineeringProjectSnapshot;
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([fixture.snapshot, descendant]),
    projectStore: new ProjectStore([project]),
    projectId,
    subjectId: fixture.snapshot.subject.id,
    html: "unused",
    productStructureCaptures: fixture.reader,
    sysmlSourceAnalysis: fixture.sourceAnalysis,
  });
  const roots = await (await handler(
    new Request("http://localhost/api/thread/product-navigation?view=roots"),
  )).json();
  assertEquals(roots.status, "observed");
  assertEquals(roots.basis.threadSnapshotId, fixture.snapshot.id);
  assertEquals(roots.basis.threadRevision, fixture.snapshot.revision);
  assertEquals(roots.basis.threadSubjectId, fixture.snapshot.subject.id);
  const def = await (await handler(
    new Request("http://localhost/api/thread/product-navigation"),
  )).json();
  assertEquals(def.status, "observed");
  assertEquals(def.basis.threadSnapshotId, fixture.snapshot.id);
  assertEquals(def.basis.threadRevision, fixture.snapshot.revision);
  assertEquals(def.basis.threadSubjectId, fixture.snapshot.subject.id);
});

Deno.test("native Workbench product-navigation children and neighborhood GET stay exact to the semantic root or a PartUsage", async () => {
  const fixture = await verifiedArchitectureNavigationFixture();
  const projectId = "project.verified-architecture";
  const project = {
    project: {
      id: projectId,
      subjectId: fixture.snapshot.subject.id,
    },
    threadSnapshots: [{
      snapshotId: fixture.snapshot.id,
      revision: fixture.snapshot.revision,
      subjectId: fixture.snapshot.subject.id,
    }],
  } as unknown as EngineeringProjectSnapshot;
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([fixture.snapshot]),
    projectStore: new ProjectStore([project]),
    projectId,
    subjectId: fixture.snapshot.subject.id,
    html: "unused",
    productStructureCaptures: fixture.reader,
    sysmlSourceAnalysis: fixture.sourceAnalysis,
  });
  for (const view of ["children", "neighborhood"]) {
    const root = await (await handler(
      new Request(
        `http://localhost/api/thread/product-navigation?view=${view}&kind=part-definition&id=sys-def-001`,
      ),
    )).json();
    assertEquals(root.status, "observed", view);
    assertEquals(root.schemaVersion, "product-explore/1.0");
    assertEquals(root.focus.element, {
      elementKind: "PartDefinition",
      elementId: "sys-def-001",
    });
    assertEquals(root.focus.occurrence, undefined);
    assertEquals(
      root.children.map((node: { element: { elementId: string } }) =>
        node.element.elementId
      ),
      ["alpha-use-001"],
    );

    const usage = await (await handler(
      new Request(
        `http://localhost/api/thread/product-navigation?view=${view}&kind=part-usage&id=alpha-use-001&path=alpha-use-001`,
      ),
    )).json();
    assertEquals(usage.status, "observed", view);
    assertEquals(usage.focus.element, {
      elementKind: "PartUsage",
      elementId: "alpha-use-001",
    });
    assertEquals(usage.focus.occurrence.path, ["alpha-use-001"]);

    const nested = await (await handler(
      new Request(
        `http://localhost/api/thread/product-navigation?view=${view}&kind=part-definition&id=alpha-def-001`,
      ),
    )).json();
    assertEquals(nested.status, "unattached", view);
    assertEquals(nested.focus, undefined);
    assertEquals(nested.children, []);
    assertEquals(nested.diagnostics[0]?.code, "selection.unattached");
    assertEquals(
      nested.basis.architectureArtifactId,
      root.basis.architectureArtifactId,
    );

    for (
      const url of [
        `http://localhost/api/thread/product-navigation?view=${view}&id=sys-def-001`,
        `http://localhost/api/thread/product-navigation?view=${view}&id=alpha-def-001`,
        `http://localhost/api/thread/product-navigation?view=${view}&kind=latest&id=sys-def-001`,
        `http://localhost/api/thread/product-navigation?view=${view}&kind=part&id=sys-def-001`,
      ]
    ) {
      const response = await handler(new Request(url));
      assertEquals(response.status, 400, url);
      assertStringIncludes(await response.text(), "kind");
    }
  }
});

Deno.test("native Workbench product-navigation GET refuses latest in exact paths", async () => {
  const fixture = await verifiedArchitectureNavigationFixture();
  const projectId = "project.verified-architecture";
  const project = {
    project: {
      id: projectId,
      subjectId: fixture.snapshot.subject.id,
    },
    threadSnapshots: [{
      snapshotId: fixture.snapshot.id,
      revision: fixture.snapshot.revision,
      subjectId: fixture.snapshot.subject.id,
    }],
  } as unknown as EngineeringProjectSnapshot;
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([fixture.snapshot]),
    projectStore: new ProjectStore([project]),
    projectId,
    subjectId: fixture.snapshot.subject.id,
    html: "unused",
    productStructureCaptures: fixture.reader,
    sysmlSourceAnalysis: fixture.sourceAnalysis,
  });
  for (
    const url of [
      "http://localhost/api/thread/product-navigation?view=path&usagePath=latest",
      "http://localhost/api/thread/product-navigation?view=path&usagePath=foo,latest",
      "http://localhost/api/thread/product-navigation?view=children&path=latest",
    ]
  ) {
    const response = await handler(new Request(url));
    assertEquals(response.status, 400, url);
    assertStringIncludes(await response.text(), "latest");
  }
});

Deno.test("native Workbench product-navigation GET is read-only and shares the application port", async () => {
  const r2 = genericArchitectureThreadSnapshot(2);
  const r3 = genericArchitectureThreadSnapshot(3, r2);
  const project = genericArchitectureProject("completed", r2, r3);
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([r2, r3]),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
    productStructureCaptures: {
      read: () => Promise.resolve(undefined),
    },
  });
  const post = await handler(
    new Request("http://localhost/api/thread/product-navigation", {
      method: "POST",
    }),
  );
  assertEquals(post.status, 405);
  const response = await handler(
    new Request(
      "http://localhost/api/thread/product-navigation?view=search&id=def-system",
    ),
  );
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.schemaVersion, "product-search/1.0");
  assertEquals(body.status, "unavailable");
});

Deno.test("native Workbench product-navigation GET publishes authoring attachments from the shared port", async () => {
  const fixture = await verifiedArchitectureNavigationFixture();
  const projectId = "project.verified-architecture";
  const project = {
    project: {
      id: projectId,
      subjectId: fixture.snapshot.subject.id,
    },
    threadSnapshots: [{
      snapshotId: fixture.snapshot.id,
      revision: fixture.snapshot.revision,
      subjectId: fixture.snapshot.subject.id,
    }],
  } as unknown as EngineeringProjectSnapshot;
  const workspace = await authoringWorkspaceForFixture(projectId, fixture);
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([fixture.snapshot]),
    projectStore: new ProjectStore([project]),
    projectId,
    subjectId: fixture.snapshot.subject.id,
    html: "unused",
    productStructureCaptures: fixture.reader,
    sysmlSourceAnalysis: fixture.sourceAnalysis,
    projectSourceWorkspace: workspace.store,
  });
  const response = await handler(
    new Request(
      "http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=part-definition&id=sys-def-001",
    ),
  );
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.schemaVersion, "product-inspect/1.0");
  assertEquals(body.status, "observed");
  assertEquals(body.grants, "none");
  assertEquals(
    body.authoringAttachments.attachments.map((
      item: { attachmentId: string },
    ) => item.attachmentId),
    ["att-system"],
  );
  assertEquals(body.authoringAttachments.attachments[0]?.target, {
    elementId: "sys-def-001",
    elementKind: "PartDefinition",
  });
  assertEquals(
    body.authoringAttachments.attachments[0]?.basisStatus,
    "exact-basis",
  );
  const usage = await (await handler(
    new Request(
      "http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=part-usage&id=alpha-use-001&path=alpha-use-001",
    ),
  )).json();
  assertEquals(usage.authoringAttachments.attachments, []);
  const projection = await (await handler(
    new Request("http://localhost/api/thread/product-navigation"),
  )).json();
  assertEquals(projection.attachments.sources, []);
  assertEquals("workspaceRevision" in projection, false);
  assertEquals(Array.isArray(projection.attachments), false);
});

Deno.test("native Workbench product-navigation authoring attachments GET refuses invalid input and POST", async () => {
  const fixture = await verifiedArchitectureNavigationFixture();
  const projectId = "project.verified-architecture";
  const project = {
    project: {
      id: projectId,
      subjectId: fixture.snapshot.subject.id,
    },
    threadSnapshots: [{
      snapshotId: fixture.snapshot.id,
      revision: fixture.snapshot.revision,
      subjectId: fixture.snapshot.subject.id,
    }],
  } as unknown as EngineeringProjectSnapshot;
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([fixture.snapshot]),
    projectStore: new ProjectStore([project]),
    projectId,
    subjectId: fixture.snapshot.subject.id,
    html: "unused",
    productStructureCaptures: fixture.reader,
    sysmlSourceAnalysis: fixture.sourceAnalysis,
    projectSourceWorkspace: {
      load: () => Promise.resolve(emptyProjectSourceWorkspace(projectId)),
      loadAtFresh: () => Promise.resolve(emptyProjectSourceWorkspace(projectId)),
    },
  });
  const post = await handler(
    new Request(
      "http://localhost/api/thread/product-navigation?view=authoring-attachments",
      { method: "POST" },
    ),
  );
  assertEquals(post.status, 405);
  for (
    const url of [
      "http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=latest&id=sys-def-001",
      "http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=part-definition&id=latest",
      "http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=part-definition&id=sys-def-001&path=latest",
      "http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=part-definition&id=sys-def-001&pageSize=latest",
      "http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=part-definition&id=sys-def-001&pageSize=51",
      "http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=part-definition&id=sys-def-001&cursor=latest",
      "http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=part-definition&id=sys-def-001&cursor=not-a-cursor",
    ]
  ) {
    const response = await handler(new Request(url));
    assertEquals(response.status, 400, url);
  }
});

Deno.test("native Workbench authoring attachments GET pins nextCursor across two requests", async () => {
  const fixture = await verifiedArchitectureNavigationFixture();
  const projectId = "project.verified-architecture";
  const project = {
    project: {
      id: projectId,
      subjectId: fixture.snapshot.subject.id,
    },
    threadSnapshots: [{
      snapshotId: fixture.snapshot.id,
      revision: fixture.snapshot.revision,
      subjectId: fixture.snapshot.subject.id,
    }],
  } as unknown as EngineeringProjectSnapshot;
  const workspace = await authoringWorkspaceForFixture(projectId, fixture, {
    extraFile: true,
  });
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([fixture.snapshot]),
    projectStore: new ProjectStore([project]),
    projectId,
    subjectId: fixture.snapshot.subject.id,
    html: "unused",
    productStructureCaptures: fixture.reader,
    sysmlSourceAnalysis: fixture.sourceAnalysis,
    projectSourceWorkspace: workspace.store,
  });
  const first = await (await handler(
    new Request(
      "http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=part-definition&id=sys-def-001&pageSize=1",
    ),
  )).json();
  assertEquals(first.status, "observed");
  assertEquals(
    first.authoringAttachments.attachments.map((
      item: { attachmentId: string },
    ) => item.attachmentId),
    ["att-extra"],
  );
  assertEquals(typeof first.authoringAttachments.nextCursor, "string");
  const second = await (await handler(
    new Request(
      `http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=part-definition&id=sys-def-001&pageSize=1&cursor=${
        encodeURIComponent(first.authoringAttachments.nextCursor)
      }`,
    ),
  )).json();
  assertEquals(second.status, "observed");
  assertEquals(
    second.authoringAttachments.workspaceRevision,
    first.authoringAttachments.workspaceRevision,
  );
  assertEquals(
    second.authoringAttachments.attachments.map((
      item: { attachmentId: string },
    ) => item.attachmentId),
    ["att-system"],
  );
  const forged = await handler(
    new Request(
      `http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=part-definition&id=sys-def-001&cursor=${
        encodeURIComponent(
          btoa(JSON.stringify({
            kind: "attachment-list",
            workspaceRevision: first.workspaceRevision,
            filter: {
              target: {
                elementId: "sys-def-001",
                elementKind: "PartDefinition",
              },
            },
          })),
        )
      }`,
    ),
  );
  assertEquals(forged.status, 400);
});

Deno.test("native Workbench hides durable unattached generic requirements and geometry snapshots", async () => {
  for (
    const operation of [
      MODEL_WRITE_REQUIREMENTS_OPERATION,
      MODEL_WRITE_TRACED_REQUIREMENTS_OPERATION,
      MODEL_RECAPTURE_REQUIREMENTS_OPERATION,
      MODEL_RECAPTURE_TRACED_REQUIREMENTS_OPERATION,
      RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION,
      RECORD_DOCUMENTARY_CLAUSE_RESPONSE_OPERATION,
      DESIGN_WRITE_GEOMETRY_OPERATION,
    ]
  ) {
    const r2 = genericArchitectureThreadSnapshot(2);
    const r3 = genericArchitectureThreadSnapshot(3, r2);
    const projects = new ProjectStore([
      projectWithOperation(
        genericArchitectureProject("queued", r2, r3),
        operation,
      ),
    ]);
    const handler = createNativeWorkbenchHandler({
      store: new ThreadStore([r2, r3]),
      projectStore: projects,
      projectId: "generic-architecture-project",
      subjectId: r2.subject.id,
      html: "unused",
    });

    for (
      const status of ["queued", "running", "publishing", "failed"] as const
    ) {
      projects.replace(
        projectWithOperation(
          genericArchitectureProject(status, r2, r3),
          operation,
        ),
      );
      assertEquals(await previewThreadId(handler), r2.id, operation.id);
    }

    projects.replace(
      projectWithOperation(
        genericArchitectureProject("completed", r2, r3),
        operation,
      ),
    );
    assertEquals(await previewThreadId(handler), r3.id, operation.id);
  }
});

Deno.test("native Workbench hides an unattached technical compilation seal until project completion", async () => {
  const r2 = genericArchitectureThreadSnapshot(2);
  const r3 = genericArchitectureThreadSnapshot(3, r2);
  const projects = new ProjectStore([
    projectWithOperation(
      genericArchitectureProject("running", r2, r3),
      COMPILE_SEAL_ADMISSION_OPERATION,
    ),
  ]);
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([r2, r3]),
    projectStore: projects,
    projectId: "generic-architecture-project",
    subjectId: r2.subject.id,
    html: "unused",
  });

  for (const status of ["running", "publishing", "failed"] as const) {
    projects.replace(
      projectWithOperation(
        genericArchitectureProject(status, r2, r3),
        COMPILE_SEAL_ADMISSION_OPERATION,
      ),
    );
    assertEquals(await previewThreadId(handler), r2.id, status);
  }

  projects.replace(
    projectWithOperation(
      genericArchitectureProject("completed", r2, r3),
      COMPILE_SEAL_ADMISSION_OPERATION,
    ),
  );
  assertEquals(await previewThreadId(handler), r3.id);
});

Deno.test("native Workbench classifies every known durable writer before attachment", () => {
  const r2 = genericArchitectureThreadSnapshot(2);
  const r3 = genericArchitectureThreadSnapshot(3, r2);
  const operations = [
    MODEL_WRITE_TRACED_REQUIREMENTS_OPERATION,
    MODEL_RECAPTURE_REQUIREMENTS_OPERATION,
    MODEL_RECAPTURE_TRACED_REQUIREMENTS_OPERATION,
    RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION,
    RECORD_DOCUMENTARY_CLAUSE_RESPONSE_OPERATION,
    VERIFY_SEAL_PROOF_CASE_OPERATION,
    VERIFY_RUN_FEA_STATIC_PROOF_OPERATION,
    COMPILE_SEAL_ADMISSION_OPERATION,
    DESIGN_EXECUTE_BUILD123D_OPERATION,
    VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION,
    SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
    SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
    VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
    ARCHIVE_LINEAGE_OPERATION,
    ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
    ANALYZE_RUN_FEA_SENSITIVITY_OPERATION,
    MODEL_WRITE_SENSITIVITY_EDGES_OPERATION,
  ] as const;
  for (const operation of operations) {
    for (const status of ["running", "publishing", "failed"] as const) {
      const project = projectWithOperation(
        genericArchitectureProject(status, r2, r3),
        operation,
      );
      assertEquals(
        hasUnattachedDurableProjectOperationForTest(project),
        true,
        `${operation.id}@${operation.version} ${status}`,
      );
    }
    const completed = projectWithOperation(
      genericArchitectureProject("completed", r2, r3),
      operation,
    );
    assertEquals(
      hasUnattachedDurableProjectOperationForTest(completed),
      false,
      `${operation.id}@${operation.version} completed`,
    );
  }
});

Deno.test("native Workbench follows durable focus without a static target", async () => {
  const first = projectFixture("project-one", "subject-one");
  const second = projectFixture("project-two", "subject-two");
  const focus = new MutableFocus(focusSnapshot("project-one"));
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([first, second]),
    cockpitFocus: focus,
    workspaceId: "primary",
    html: "unused",
  });

  let response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  assertEquals((await response.json()).project.project.id, "project-one");

  focus.value = focusSnapshot("project-two", 2);
  response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  assertEquals((await response.json()).project.project.id, "project-two");
});

Deno.test("native Workbench resolves hashed Vite assets and rejects traversal", () => {
  const directory = "/tmp/ui-dist";
  assertEquals(
    resolveWorkbenchUiAssetPath(directory, "/assets/app-aaaa.js"),
    "/tmp/ui-dist/assets/app-aaaa.js",
  );
  assertEquals(
    resolveWorkbenchUiAssetPath(directory, "/assets/app-aaaa.css"),
    "/tmp/ui-dist/assets/app-aaaa.css",
  );
  assertEquals(
    resolveWorkbenchUiAssetPath(directory, "/assets/../secret.js"),
    undefined,
  );
  assertEquals(
    resolveWorkbenchUiAssetPath(directory, "/assets/%2e%2e/secret.js"),
    undefined,
  );
  assertEquals(
    resolveWorkbenchUiAssetPath(directory, "/native-workbench.html"),
    undefined,
  );
  assertEquals(
    resolveWorkbenchUiAssetPath(directory, "/api/thread/workbench"),
    undefined,
  );
});

Deno.test("native Workbench serves hashed Vite JS and CSS without a command path", async () => {
  const directory = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${directory}/assets`);
    await Deno.writeTextFile(
      `${directory}/native-workbench.html`,
      `<html><script type="module" src="./assets/app-aaaa.js"></script></html>`,
    );
    await Deno.writeTextFile(
      `${directory}/assets/app-aaaa.js`,
      "export const ready = true;\n",
    );
    await Deno.writeTextFile(
      `${directory}/assets/app-aaaa.css`,
      "body{color:red}\n",
    );
    const project = projectFixture("project-one", "subject-one");
    const handler = createNativeWorkbenchHandler({
      store: new EmptyThreadStore(),
      projectStore: new ProjectStore([project]),
      projectId: project.project.id,
      subjectId: project.project.subjectId,
      htmlPath: `${directory}/native-workbench.html`,
    });

    const page = await handler(new Request("http://localhost/"));
    assertEquals(page.status, 200);
    assertStringIncludes(await page.text(), "./assets/app-aaaa.js");
    assertStringIncludes(
      page.headers.get("Content-Security-Policy") ?? "",
      "script-src 'self'",
    );

    const js = await handler(
      new Request("http://localhost/assets/app-aaaa.js"),
    );
    assertEquals(js.status, 200);
    assertStringIncludes(js.headers.get("Content-Type") ?? "", "javascript");
    assertEquals(await js.text(), "export const ready = true;\n");

    const css = await handler(
      new Request("http://localhost/assets/app-aaaa.css"),
    );
    assertEquals(css.status, 200);
    assertStringIncludes(css.headers.get("Content-Type") ?? "", "text/css");
    assertEquals(await css.text(), "body{color:red}\n");

    assertEquals(
      (await handler(new Request("http://localhost/assets/missing.js"))).status,
      404,
    );
    assertEquals(
      (await handler(new Request("http://localhost/api/project/commands")))
        .status,
      404,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("native Workbench keeps its BFF read-only and blocks cross-origin framing", async () => {
  const project = projectFixture("project-one", "subject-one");
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "<html><body>Workbench</body></html>",
  });

  const page = await handler(new Request("http://localhost/"));
  assertEquals(page.status, 200);
  const pageHtml = await page.text();
  assertStringIncludes(pageHtml, "Workbench");
  const nonceMatch = pageHtml.match(
    new RegExp(
      `<meta name="${MCP_APP_SCRIPT_NONCE_META_NAME}" content="([A-Za-z0-9_-]{43})">`,
    ),
  );
  assertEquals(nonceMatch?.[1]?.length, 43);
  assertStringIncludes(
    page.headers.get("Content-Security-Policy") ?? "",
    `'nonce-${nonceMatch?.[1]}'`,
  );
  const secondPageHtml = await (await handler(
    new Request("http://localhost/native-workbench.html"),
  )).text();
  const secondNonce = secondPageHtml.match(
    new RegExp(
      `<meta name="${MCP_APP_SCRIPT_NONCE_META_NAME}" content="([A-Za-z0-9_-]{43})">`,
    ),
  )?.[1];
  assertEquals(secondNonce === nonceMatch?.[1], false);
  assertStringIncludes(
    page.headers.get("Content-Security-Policy") ?? "",
    "frame-ancestors 'self'",
  );
  assertStringIncludes(
    page.headers.get("Content-Security-Policy") ?? "",
    "frame-src blob:",
  );
  assertEquals(page.headers.get("X-Frame-Options"), "DENY");

  const rejected = await handler(
    new Request("http://localhost/api/thread/workbench", {
      method: "POST",
    }),
  );
  assertEquals(rejected.status, 405);
  assertEquals(rejected.headers.get("Allow"), "GET");
  assertEquals(
    (await handler(new Request("http://localhost/api/project/commands")))
      .status,
    404,
  );
});

Deno.test("native Workbench serves declared fleet identity without health", async () => {
  const project = projectFixture("project-one", "subject-one");
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "<html><body>Workbench</body></html>",
    cockpitFleet: () =>
      Promise.resolve({
        servers: [{
          id: "syson",
          displayName: "SysON",
          role: "System model",
          required: true,
        }],
      }),
  });

  const response = await handler(new Request("http://localhost/api/fleet"));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    servers: [{
      id: "syson",
      displayName: "SysON",
      role: "System model",
      required: true,
    }],
  });
  assertEquals(
    (await handler(
      new Request("http://localhost/api/fleet", { method: "POST" }),
    )).status,
    405,
  );
});

Deno.test("native Workbench degrades when declared fleet is unavailable", async () => {
  const project = projectFixture("project-one", "subject-one");
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "<html><body>Workbench</body></html>",
  });
  assertEquals(
    (await handler(new Request("http://localhost/api/fleet"))).status,
    404,
  );
});

Deno.test("native Workbench API routes reject non-GET verbs and keep SSE on GET", async () => {
  const digest = "a".repeat(64);
  const project = projectFixture("project-one", "subject-one");
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "<html><body>Workbench</body></html>",
    assetReader: () => Promise.resolve(undefined),
    cockpitFleet: () =>
      Promise.resolve({
        servers: [{
          id: "syson",
          displayName: "SysON",
          role: "System model",
          required: true,
        }],
      }),
    pollIntervalMs: 50,
  });

  const routes = [
    "/healthz",
    "/api/thread/workbench",
    "/api/thread/product-navigation",
    "/api/thread/viewer-sessions",
    "/api/thread/viewer-sessions/events",
    `/api/thread/viewer-apps/launch/${digest}/${digest}`,
    `/api/thread/viewer-apps/resources/${digest}`,
    "/api/thread/workbench/events",
    "/api/fleet",
    `/api/thread/assets/${digest}.glb`,
    `/api/thread/assets/${digest}.step`,
    "/",
    "/native-workbench.html",
  ];
  for (const path of routes) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const rejected = await handler(
        new Request(`http://localhost${path}`, { method }),
      );
      assertEquals(rejected.status, 405, `${method} ${path}`);
      assertEquals(rejected.headers.get("Allow"), "GET");
    }
  }

  const sse = await handler(
    new Request("http://localhost/api/thread/workbench/events"),
  );
  assertEquals(sse.status, 200);
  assertEquals(
    sse.headers.get("Content-Type"),
    "text/event-stream; charset=utf-8",
  );
  await sse.body?.cancel();

  assertEquals(
    (await handler(
      new Request("http://localhost/api/review-intents", { method: "POST" }),
    )).status,
    404,
  );
  assertEquals(
    (await handler(new Request("http://localhost/api/review-intents"))).status,
    404,
  );
});

Deno.test("native Workbench exposes viewer sessions as complete GET and SSE replacements", async () => {
  const project = projectFixture("project-one", "subject-one");
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
    pollIntervalMs: 50,
  });

  const response = await handler(
    new Request("http://localhost/api/thread/viewer-sessions"),
  );
  assertEquals(response.status, 200);
  const projection = await response.json() as {
    schemaVersion: string;
    basis: Record<string, unknown>;
    sequence: number;
    projectionFingerprint: string;
    sessions: unknown[];
  };
  assertEquals(projection.schemaVersion, "thread-viewer-sessions/2.0");
  assertEquals(projection.basis, {
    projectId: "project-one",
    projectRevision: 1,
    subjectId: "subject-one",
  });
  assertEquals(projection.sequence, 1);
  assertEquals(
    /^sha256:[a-f0-9]{64}$/.test(projection.projectionFingerprint),
    true,
  );
  assertEquals(projection.sessions, []);

  const events = await handler(
    new Request("http://localhost/api/thread/viewer-sessions/events"),
  );
  assertEquals(events.status, 200);
  assertEquals(
    events.headers.get("Content-Type"),
    "text/event-stream; charset=utf-8",
  );
  const reader = events.body!.getReader();
  const first = await reader.read();
  await reader.cancel();
  const text = new TextDecoder().decode(first.value);
  assertStringIncludes(text, "event: viewer-sessions");
  assertStringIncludes(text, '"schemaVersion":"thread-viewer-sessions/2.0"');
  assertStringIncludes(text, `:${projection.projectionFingerprint}`);
});

Deno.test("native Workbench viewer hierarchy travels in the same fingerprinted GET and SSE replacement", async () => {
  const fixture = await verifiedArchitectureNavigationFixture();
  const projectId = "project.verified-architecture";
  const base = projectFixture(projectId, fixture.snapshot.subject.id);
  const project: EngineeringProjectSnapshot = {
    ...base,
    threadSnapshots: [{
      snapshotId: fixture.snapshot.id,
      revision: fixture.snapshot.revision,
      subjectId: fixture.snapshot.subject.id,
    }],
  };
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([fixture.snapshot]),
    projectStore: new ProjectStore([project]),
    projectId,
    subjectId: fixture.snapshot.subject.id,
    html: "unused",
    productStructureCaptures: fixture.reader,
    sysmlSourceAnalysis: fixture.sourceAnalysis,
    geometryCaptures: { read: () => Promise.resolve(undefined) },
  });
  const response = await handler(
    new Request("http://localhost/api/thread/viewer-sessions"),
  );
  assertEquals(response.status, 200);
  const projection = await response.json();
  assertEquals(projection.hierarchy.status, "available");
  assertEquals(projection.hierarchy.nodes[0].partDefinitionElementId, "sys-def-001");
  assertEquals(projection.sessions, []);
  assertEquals(
    projection.hierarchy.nodes.every((n: { sessionIds: string[] }) =>
      n.sessionIds.length === 0
    ),
    true,
  );
  const { projectionFingerprint, ...unsigned } = projection;
  assertEquals(
    projectionFingerprint,
    `sha256:${(await sha256Fingerprint(unsigned)).digest}`,
  );
  const events = await handler(
    new Request("http://localhost/api/thread/viewer-sessions/events"),
  );
  const reader = events.body!.getReader();
  try {
    const next = viewerSessionsEventReader(reader);
    assertEquals(await next(), projection);
  } finally {
    await reader.cancel();
  }
});

Deno.test("native Workbench file registry serves and revokes an exact whole App end to end", async () => {
  const temporary = await Deno.makeTempDir();
  try {
    const base = projectFixture("project-review-app", "subject-review-app");
    const project: EngineeringProjectSnapshot = {
      ...base,
      id: "project-review-app:r5",
      revision: 5,
      framing: {
        intent: {
          statement: "Review the exact proposed brief",
          source: { kind: "human", reference: "conversation" },
          capturedAt: base.generatedAt,
          capturedBy: { id: "human", origin: "human" },
        },
        questions: [],
        answers: [],
        proposedBrief: {
          briefId: "brief",
          id: "brief:r2",
          revision: 2,
          items: [],
          proposedAt: base.generatedAt,
          proposedBy: { id: "agent", origin: "agent" },
        },
        proposalReview: {
          briefSnapshotId: "brief:r2",
          briefRevision: 2,
          status: "pending",
          inputFingerprint: {
            algorithm: "sha256",
            digest: "1".repeat(64),
          },
          requestedAt: base.generatedAt,
        },
      },
    };
    const registryPath = `${temporary}/registry.json`;
    const objectDirectory = `${temporary}/objects`;
    const fixture = await writeViewerAppRegistryFixture(
      registryPath,
      objectDirectory,
      project,
    );
    const handler = createNativeWorkbenchHandler({
      store: new EmptyThreadStore(),
      projectStore: new ProjectStore([project]),
      projectId: project.project.id,
      subjectId: project.project.subjectId,
      html: "unused",
      viewerAppRegistry: new FileThreadViewerAppRegistry({
        registryPath,
        objectDirectory,
      }),
      pollIntervalMs: 10,
    });

    const initialResponse = await handler(
      new Request("http://localhost/api/thread/viewer-sessions"),
    );
    assertEquals(initialResponse.status, 200);
    const initial = await initialResponse.json() as {
      sequence: number;
      sessions: Array<{ launchUri: string; session: { payload: unknown } }>;
    };
    assertEquals(initial.sessions.length, 1);
    assertEquals(initial.sessions[0]?.session.payload, fixture.payload);
    const launchUri = initial.sessions[0]!.launchUri;
    const launch = await handler(new Request(`http://localhost${launchUri}`));
    assertEquals(launch.status, 200);
    assertEquals(await launch.text(), new TextDecoder().decode(fixture.html));

    const events = await handler(
      new Request("http://localhost/api/thread/viewer-sessions/events"),
    );
    const reader = events.body!.getReader();
    const next = viewerSessionsEventReader(reader);
    const first = await next();
    assertEquals(first.sessions.length, 1);
    assertEquals(first.sequence, initial.sequence);

    await Deno.remove(registryPath);
    const revoked = await next();
    assertEquals(revoked.sessions, []);
    assertEquals(revoked.sequence > first.sequence, true);
    assertEquals(
      (await handler(new Request(`http://localhost${launchUri}`))).status,
      404,
    );

    await Deno.writeTextFile(registryPath, fixture.registryText);
    const reattested = await next();
    assertEquals(reattested.sessions.length, 1);
    assertEquals(reattested.sequence > revoked.sequence, true);
    assertEquals(reattested.sessions[0]?.launchUri, launchUri);

    await Deno.writeTextFile(
      `${objectDirectory}/${fixture.htmlDigest}`,
      "tampered whole-App bytes",
    );
    const tampered = await next();
    assertEquals(tampered.sessions, []);
    assertEquals(tampered.sequence > reattested.sequence, true);
    assertEquals(
      (await handler(new Request(`http://localhost${launchUri}`))).status,
      404,
    );
    await reader.cancel();
  } finally {
    await Deno.remove(temporary, { recursive: true });
  }
});

Deno.test("viewer projection clock sequences resolver revocation and re-attestation", async () => {
  const sequencer = new ThreadViewerSessionsSequencer();
  const candidate = {
    schemaVersion: "thread-viewer-sessions/2.0" as const,
    basis: {
      projectId: "project-one",
      projectRevision: 1,
      subjectId: "subject-one",
    },
    sequence: 7,
    projectionFingerprint: `sha256:${"a".repeat(64)}`,
    sessions: [],
  };
  const initial = await sequencer.admit(candidate);
  assertEquals(initial.sequence, 7);
  assertEquals(await sequencer.admit(candidate), initial);

  const revoked = await sequencer.admit({
    ...candidate,
    projectionFingerprint: `sha256:${"b".repeat(64)}`,
  });
  assertEquals(revoked.sequence, 8);
  assertEquals(
    revoked.projectionFingerprint === initial.projectionFingerprint,
    false,
  );

  const reattested = await sequencer.admit(candidate);
  assertEquals(reattested.sequence, 9);
  assertEquals(
    reattested.projectionFingerprint === revoked.projectionFingerprint,
    false,
  );

  const stale = await sequencer.admit({
    ...candidate,
    sequence: 6,
    projectionFingerprint: `sha256:${"c".repeat(64)}`,
  });
  assertEquals(
    stale,
    reattested,
    "a lower source sequence cannot become fresh",
  );
});

Deno.test("viewer projection clock serializes slow registry factories before revocation", async () => {
  const sequencer = new ThreadViewerSessionsSequencer();
  const basis = {
    projectId: "project-one",
    projectRevision: 1,
    subjectId: "subject-one",
  };
  const old = {
    schemaVersion: "thread-viewer-sessions/2.0" as const,
    basis,
    sequence: 1,
    projectionFingerprint: `sha256:${"a".repeat(64)}`,
    sessions: [{
      id: "old-session",
    }] as unknown as ThreadViewerSessionsProjection["sessions"],
  };
  const revoked = {
    ...old,
    projectionFingerprint: `sha256:${"b".repeat(64)}`,
    sessions: [],
  };
  let releaseOld!: () => void;
  const oldGate = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  const starts: string[] = [];
  const slowOld = sequencer.project(async () => {
    starts.push("old");
    await oldGate;
    return old;
  });
  const revoke = sequencer.project(() => {
    starts.push("revoked");
    return Promise.resolve(revoked);
  });
  await Promise.resolve();
  assertEquals(starts, ["old"]);
  releaseOld();
  const oldProjection = await slowOld;
  const revokedProjection = await revoke;
  assertEquals(oldProjection.sessions.length, 1);
  assertEquals(starts, ["old", "revoked"]);
  assertEquals(revokedProjection.sessions, []);
  assertEquals(revokedProjection.sequence, oldProjection.sequence + 1);
});

Deno.test("viewer review anchors cover exact pending brief architecture requirements and geometry", () => {
  const base = projectFixture("project-review", "subject-review");
  const project: EngineeringProjectSnapshot = {
    ...base,
    id: "project-review:r5",
    revision: 5,
    framing: {
      intent: {
        statement: "Review exact proposals",
        source: { kind: "human", reference: "conversation" },
        capturedAt: base.generatedAt,
        capturedBy: { id: "human", origin: "human" },
      },
      questions: [],
      answers: [],
      proposedBrief: {
        briefId: "brief",
        id: "brief:r2",
        revision: 2,
        items: [],
        proposedAt: base.generatedAt,
        proposedBy: { id: "agent", origin: "agent" },
      },
      proposalReview: {
        briefSnapshotId: "brief:r2",
        briefRevision: 2,
        status: "pending",
        inputFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
        requestedAt: base.generatedAt,
      },
    },
    workItems: [
      reviewWorkItem("architecture", MODEL_WRITE_ARCHITECTURE_OPERATION.id),
      reviewWorkItem("requirements", MODEL_WRITE_REQUIREMENTS_OPERATION.id),
      reviewWorkItem("geometry", DESIGN_WRITE_GEOMETRY_OPERATION.id),
    ],
    decisions: [
      reviewDecision("architecture", "2"),
      reviewDecision("requirements", "3"),
      reviewDecision("geometry", "4"),
    ],
  };
  assertEquals(projectViewerReviewAnchors(project), [
    {
      kind: "project-review",
      id: "architecture",
      revision: 5,
      fingerprint: `sha256:${"2".repeat(64)}`,
    },
    {
      kind: "project-review",
      id: "brief:r2",
      revision: 5,
      fingerprint: `sha256:${"1".repeat(64)}`,
    },
    {
      kind: "project-review",
      id: "geometry",
      revision: 5,
      fingerprint: `sha256:${"4".repeat(64)}`,
    },
    {
      kind: "project-review",
      id: "requirements",
      revision: 5,
      fingerprint: `sha256:${"3".repeat(64)}`,
    },
  ]);
});

Deno.test("native Workbench viewer-sessions SSE refuses a missing declared Thread tip", async () => {
  const r2 = genericArchitectureThreadSnapshot(2);
  const r3 = genericArchitectureThreadSnapshot(3, r2);
  const project = genericArchitectureProject("completed", r2, r3);
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
  });

  const response = await handler(
    new Request("http://localhost/api/thread/viewer-sessions/events"),
  );
  assertEquals(response.status, 404);
  assertEquals((await response.json()).error, "thread_snapshot_not_found");
});

Deno.test("native Workbench SSE invalidates a fixed project and Thread tip when its authoring workspace advances", async () => {
  const fixture = await verifiedArchitectureNavigationFixture();
  const r2 = fixture.snapshot;
  const r3: ThreadSnapshot = {
    ...fixture.snapshot,
    id: `${fixture.snapshot.id}:r2`,
    revision: fixture.snapshot.revision + 1,
    previous: {
      snapshotId: fixture.snapshot.id,
      revision: fixture.snapshot.revision,
    },
  };
  const project = genericArchitectureProject("completed", r2, r3);
  const projectId = project.project.id;
  let workspace = await authoringWorkspaceAtRevision(projectId, fixture, 15);
  const revisions = new Map<number, ProjectSourceWorkspaceState>([
    [workspace.workspaceRevision, workspace],
  ]);
  const workspaceStore = {
    load: () => Promise.resolve(workspace),
    loadAtFresh: (_projectId: string, workspaceRevision: number) => {
      const revision = revisions.get(workspaceRevision);
      if (!revision) {
        return Promise.reject(
          new Error(`missing revision ${workspaceRevision}`),
        );
      }
      return Promise.resolve(revision);
    },
  };
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([r2, r3]),
    projectStore: new ProjectStore([project]),
    projectId,
    subjectId: r3.subject.id,
    html: "unused",
    productStructureCaptures: fixture.reader,
    sysmlSourceAnalysis: fixture.sourceAnalysis,
    projectSourceWorkspace: workspaceStore,
    pollIntervalMs: 5,
  });

  const authoringR15 = await (await handler(
    new Request(
      "http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=part-definition&id=sys-def-001",
    ),
  )).json();
  assertEquals(authoringR15.authoringAttachments.workspaceRevision, 15);
  assertEquals(authoringR15.authoringAttachments.attachments.length, 1);

  const events = await handler(
    new Request("http://localhost/api/thread/workbench/events"),
  );
  const reader = events.body!.getReader();
  const first = await reader.read();
  const firstEvent = workbenchSnapshotEvent(
    new TextDecoder().decode(first.value),
  );
  assertEquals(firstEvent.snapshot.project.revision, project.revision);
  assertEquals(firstEvent.snapshot.thread.id, r3.id);
  assertStringIncludes(
    firstEvent.id,
    `workspace:15:${workspace.lastEventFingerprint!.algorithm}:${
      workspace.lastEventFingerprint!.digest
    }`,
  );

  workspace = (await applyProjectSourceWorkspaceCommand(workspace, {
    projectId,
    mutationId: "detach-at-r16",
    expectedWorkspaceRevision: 15,
    mutation: {
      kind: "attachment_detach",
      attachmentId: "att-system",
      activeAttachmentRevision: 1,
    },
  })).state;
  revisions.set(workspace.workspaceRevision, workspace);
  assertEquals(workspace.workspaceRevision, 16);

  const authoringR16 = await (await handler(
    new Request(
      "http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=part-definition&id=sys-def-001",
    ),
  )).json();
  assertEquals(authoringR16.authoringAttachments.workspaceRevision, 16);
  assertEquals(authoringR16.authoringAttachments.attachments, []);
  assertEquals(
    authoringR16.authoringAttachments.workspaceEventFingerprint ===
      authoringR15.authoringAttachments.workspaceEventFingerprint,
    false,
  );

  const second = await reader.read();
  await reader.cancel();
  const secondEvent = workbenchSnapshotEvent(
    new TextDecoder().decode(second.value),
  );
  assertEquals(secondEvent.id === firstEvent.id, false);
  assertEquals(secondEvent.snapshot.project.revision, project.revision);
  assertEquals(secondEvent.snapshot.thread.id, r3.id);
  assertStringIncludes(
    secondEvent.id,
    `workspace:16:${workspace.lastEventFingerprint!.algorithm}:${
      workspace.lastEventFingerprint!.digest
    }`,
  );
});

Deno.test("native Workbench refuses mutated canonical content-addressed bytes", async () => {
  const digest = "a".repeat(64);
  const project = projectFixture("project-one", "subject-one");
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
    assetReader: () => Promise.resolve(new TextEncoder().encode("mutated")),
  });

  const response = await handler(
    new Request(`http://localhost/api/thread/assets/${digest}.gltf`),
  );
  assertEquals(response.status, 404);
});

Deno.test("native Workbench serves exact canonical GLB bytes with their binary media type", async () => {
  const bytes = new TextEncoder().encode("exact-glb-bytes");
  const digest = await sha256Hex(bytes);
  const project = projectFixture("project-one", "subject-one");
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
    assetReader: () => Promise.resolve(bytes),
  });

  const response = await handler(
    new Request(`http://localhost/api/thread/assets/${digest}.glb`),
  );
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Content-Type"), "model/gltf-binary");
  assertEquals(new Uint8Array(await response.arrayBuffer()), bytes);
});

Deno.test("native Workbench serves exact canonical STEP bytes with model/step", async () => {
  const bytes = new TextEncoder().encode("exact-step-bytes");
  const digest = await sha256Hex(bytes);
  const project = projectFixture("project-one", "subject-one");
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
    assetReader: () => Promise.resolve(bytes),
  });

  const response = await handler(
    new Request(`http://localhost/api/thread/assets/${digest}.step`),
  );
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Content-Type"), "model/step");
  assertEquals(new Uint8Array(await response.arrayBuffer()), bytes);
});

Deno.test("native Workbench exposes no route for internal geometry draft bytes", async () => {
  const digest = "a".repeat(64);
  const project = projectFixture("project-one", "subject-one");
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
  });

  for (const method of ["GET", "POST"] as const) {
    const response = await handler(
      new Request(`http://localhost/api/draft-assets/${digest}`, { method }),
    );
    assertEquals(response.status, 404, method);
  }
});

Deno.test("native Workbench reports an unknown selected project without substituting another one", async () => {
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([]),
    cockpitFocus: new MutableFocus(focusSnapshot("missing")),
    html: "unused",
  });

  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  assertEquals(response.status, 404);
  assertEquals((await response.json()).error, "engineering_project_not_found");
});

function projectFixture(
  projectId: string,
  subjectId: string,
): EngineeringProjectSnapshot {
  return {
    schemaVersion: "4.0",
    id: `${projectId}:r1`,
    revision: 1,
    generatedAt: "2026-08-03T12:00:00.000Z",
    project: {
      id: projectId,
      name: projectId,
      subjectId,
      objective: { title: "Project", statement: "Project" },
    },
    threadSnapshots: [],
    phases: [],
    workItems: [],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
  };
}

function reviewWorkItem(
  id: string,
  operationId: string,
): EngineeringProjectSnapshot["workItems"][number] {
  return {
    id: `work:${id}`,
    activityId: `activity:${id}`,
    phaseId: "review",
    title: id,
    description: `Review ${id}`,
    kind: "review",
    operation: { id: operationId, version: "1", bindings: [] },
    status: "waiting-for-decision",
    owner: "human",
    dependsOnWorkItemIds: [],
    evidenceRefs: [],
    decisionIds: [id],
    blockerIds: [],
  };
}

function reviewDecision(
  id: string,
  digestDigit: string,
): EngineeringProjectSnapshot["decisions"][number] {
  return {
    id,
    phaseId: "review",
    title: id,
    question: `Approve ${id}?`,
    status: "proposed",
    requestedAt: "2026-08-03T12:00:00.000Z",
    inputFingerprint: {
      algorithm: "sha256",
      digest: digestDigit.repeat(64),
    },
    inputEvidenceRefs: [],
    approvalIds: [],
    proposal: {
      summary: id,
      parameters: [],
      proposedAt: "2026-08-03T12:00:00.000Z",
      proposedBy: { id: "agent", origin: "agent" },
    },
  };
}

function genericArchitectureProject(
  status: "queued" | "running" | "publishing" | "failed" | "completed",
  r2: ThreadSnapshot,
  r3: ThreadSnapshot,
): EngineeringProjectSnapshot {
  const completed = status === "completed";
  const evidence = {
    snapshotId: r3.id,
    snapshotRevision: r3.revision,
    kind: "artifact" as const,
    id: r3.artifacts[0]!.id,
  };
  const reference = (snapshot: ThreadSnapshot) => ({
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: snapshot.subject.id,
  });
  const generatedAt = "2026-08-08T05:00:00.000Z";
  const briefFingerprint = {
    algorithm: "sha256" as const,
    digest: "e".repeat(64),
  };
  const approvedBriefBasis = {
    kind: "approved-brief" as const,
    projectId: "generic-architecture-project",
    projectSnapshotId: "generic-architecture-project:r1",
    projectRevision: 2,
    briefId: "generic-architecture-project:brief",
    briefSnapshotId: "generic-architecture-project:brief:r1:fixture",
    briefRevision: 1,
    approvedBriefFingerprint: briefFingerprint,
  };
  const runBasis = {
    kind: "thread-snapshot" as const,
    ...reference(r2),
  };
  return {
    schemaVersion: "4.0",
    id: "generic-architecture-project:r1",
    revision: 2,
    generatedAt,
    previous: {
      snapshotId: "generic-architecture-project:r0-start",
      revision: 1,
    },
    project: {
      id: "generic-architecture-project",
      name: "Generic architecture project",
      subjectId: r2.subject.id,
      objective: {
        title: "Keep the approved generic architecture traceable.",
        statement: "Keep the approved generic architecture traceable.",
      },
    },
    framing: {
      intent: {
        statement: "Keep the approved generic architecture traceable.",
        source: { kind: "human", reference: "paired-conversation" },
        capturedAt: generatedAt,
        capturedBy: { id: "human:owner", origin: "human" },
      },
      questions: [],
      answers: [],
      currentBrief: {
        briefId: "generic-architecture-project:brief",
        id: "generic-architecture-project:brief:r1:fixture",
        revision: 1,
        items: [{
          id: "objective",
          kind: "objective",
          statement: "Keep the approved generic architecture traceable.",
          sourceRefs: [{ kind: "intent", reference: "paired-conversation" }],
        }, {
          id: "mission",
          kind: "mission-scenario",
          statement: "Keep the approved generic architecture traceable.",
          sourceRefs: [{ kind: "intent", reference: "paired-conversation" }],
        }, {
          id: "success",
          kind: "success-criterion",
          statement: "The architecture remains bound to exact evidence.",
          sourceRefs: [{ kind: "intent", reference: "paired-conversation" }],
        }],
        proposedAt: generatedAt,
        proposedBy: { id: "agent:planner", origin: "agent" },
      },
      currentBriefApproval: {
        briefSnapshotId: "generic-architecture-project:brief:r1:fixture",
        briefRevision: 1,
        status: "approved",
        inputFingerprint: briefFingerprint,
        requestedAt: generatedAt,
        decidedAt: generatedAt,
        decidedBy: { id: "human:owner", origin: "human" },
        rationale: "Confirmed in the paired conversation.",
      },
    },
    threadSnapshots: completed ? [reference(r2), reference(r3)] : [reference(r2)],
    phases: [{
      id: "architecture",
      name: "Architecture",
      order: 1,
      description: "Publish the generic SysON architecture.",
      workItemIds: ["author-generic-architecture"],
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems: [{
      id: "author-generic-architecture",
      activityId: "activity:author-generic-architecture",
      phaseId: "architecture",
      title: "Author generic architecture",
      description: "Run the registered generic architecture operation.",
      kind: "architect",
      operation: {
        id: MODEL_WRITE_ARCHITECTURE_OPERATION.id,
        version: MODEL_WRITE_ARCHITECTURE_OPERATION.version,
        bindings: [],
      },
      status: completed ? "completed" : "in-progress",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: completed ? [evidence] : [],
      decisionIds: [],
      blockerIds: [],
    }],
    agentRuns: [{
      id: "run:generic-architecture",
      workItemId: "author-generic-architecture",
      status,
      summary: "Author the approved generic architecture.",
      queuedAt: "2026-08-08T04:45:00.000Z",
      basis: runBasis,
      inputFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      ...(status === "queued" ? {} : {
        startedAt: "2026-08-08T04:46:00.000Z",
        claimedAt: "2026-08-08T04:46:00.000Z",
        claimedBy: { origin: "agent" as const, id: "agent:engineering" },
      }),
      ...(completed
        ? {
          completedAt: "2026-08-08T04:47:00.000Z",
          resultSnapshot: reference(r3),
          evidenceRefs: [evidence],
        }
        : status === "failed"
        ? {
          completedAt: "2026-08-08T04:47:00.000Z",
          failure: {
            code: "readback-unavailable",
            message: "r3 durable but unattached",
          },
          evidenceRefs: [],
        }
        : { evidenceRefs: [] }),
    }],
    decisions: [],
    approvals: [],
    blockers: [],
    commandReceipts: [{
      commandId: "start-generic-architecture",
      type: "project.start",
      actor: { id: "human:owner", origin: "human" },
      issuedAt: generatedAt,
      appliedAt: generatedAt,
      requestFingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
      resultingSnapshot: {
        snapshotId: "generic-architecture-project:r0-start",
        revision: 1,
      },
    }, {
      commandId: "approve-generic-architecture-brief",
      type: "project.brief-approve",
      actor: { id: "human:owner", origin: "human" },
      issuedAt: generatedAt,
      appliedAt: generatedAt,
      requestFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      resultingSnapshot: {
        snapshotId: "generic-architecture-project:r1",
        revision: 2,
      },
      approvedBriefBasis,
    }],
  };
}

function projectWithOperation(
  project: EngineeringProjectSnapshot,
  operation: { readonly id: string; readonly version: string },
): EngineeringProjectSnapshot {
  return {
    ...project,
    workItems: project.workItems.map((item) => ({
      ...item,
      operation: { ...operation, bindings: item.operation?.bindings ?? [] },
    })),
  };
}

function genericArchitectureThreadSnapshot(
  revision: number,
  previous?: ThreadSnapshot,
): ThreadSnapshot {
  const at = "2026-08-08T05:00:00.000Z";
  const digest = String(revision).repeat(64);
  const artifactId = `architecture-${digest}`;
  const changeId = `generic-architecture-change-r${revision}`;
  return {
    schemaVersion: "1.0",
    id: `generic-architecture-thread-r${revision}`,
    revision,
    ...(previous
      ? { previous: { snapshotId: previous.id, revision: previous.revision } }
      : {}),
    generatedAt: at,
    subject: {
      id: "project:generic-architecture",
      name: "Generic architecture",
      kind: "system",
      version: String(revision),
      modelArtifactId: artifactId,
    },
    freshness: { status: "fresh", changedAt: at, invalidatedByChangeIds: [] },
    changeSet: {
      id: changeId,
      name: "Record generic architecture",
      status: "applied",
      createdAt: at,
      appliedAt: at,
      changes: [{
        id: `generic-architecture-artifact-r${revision}`,
        kind: "created",
        target: { kind: "artifact", id: artifactId },
        summary: "Recorded one exact generic architecture artifact.",
        afterFingerprint: { algorithm: "sha256", digest },
      }],
    },
    artifacts: [{
      id: artifactId,
      name: "Generic architecture",
      kind: "sysml-model",
      version: digest,
      fingerprint: { algorithm: "sha256", digest },
      uri: `casys://architecture-capture/sha256/${digest}`,
      producer: {
        serverId: "syson",
        tool: "syson_element_insert_sysml",
        runId: `run:generic-architecture-r${revision}`,
      },
      inputArtifactIds: [],
      freshness: { status: "fresh", changedAt: at, invalidatedByChangeIds: [] },
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: `generic-architecture-provenance-r${revision}`,
      relation: "changes",
      from: { kind: "change", id: changeId },
      to: { kind: "artifact", id: artifactId },
      rationale: "The exact snapshot records this generic architecture artifact.",
    }],
    proposedActions: [],
  };
}

async function previewThreadId(
  handler: (request: Request) => Promise<Response>,
): Promise<string> {
  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  assertEquals(response.status, 200);
  const body = await response.json() as {
    surface?: unknown;
    thread?: { id?: unknown };
  };
  assertEquals(body.surface, "evidence");
  if (typeof body.thread?.id !== "string") {
    throw new Error("expected an evidence Workbench thread id");
  }
  return body.thread.id;
}

function focusSnapshot(projectId: string, revision = 1): CockpitFocusSnapshot {
  return {
    schemaVersion: COCKPIT_FOCUS_SCHEMA_VERSION,
    workspaceId: "primary",
    revision,
    commandId: `focus-${revision}`,
    selectedAt: "2026-08-03T12:00:00.000Z",
    selectedBy: { kind: "agent", actorId: "mcp:test@1" },
    target: { kind: "project", projectId },
    ...(revision === 1 ? {} : { previous: { revision: revision - 1 } }),
  };
}

class EmptyThreadStore implements ThreadSnapshotStore {
  latestCalls = 0;

  get(_snapshotId: string): Promise<ThreadSnapshot | undefined> {
    return Promise.resolve(undefined);
  }

  latest(_subjectId: string): Promise<ThreadSnapshot | undefined> {
    this.latestCalls += 1;
    return Promise.resolve(undefined);
  }

  save(_snapshot: ThreadSnapshot): Promise<void> {
    return Promise.resolve();
  }
}

async function authoringWorkspaceForFixture(
  projectId: string,
  fixture: Awaited<ReturnType<typeof verifiedArchitectureNavigationFixture>>,
  options: { extraFile?: boolean } = {},
) {
  let state = emptyProjectSourceWorkspace(projectId);
  state = (await applyProjectSourceWorkspaceCommand(state, {
    projectId,
    mutationId: "m1",
    expectedWorkspaceRevision: 0,
    mutation: {
      kind: "module_put",
      moduleId: "mod-a",
      slug: "mech",
      displayName: "Mech",
    },
  })).state;
  state = (await applyProjectSourceWorkspaceCommand(state, {
    projectId,
    mutationId: "f1",
    expectedWorkspaceRevision: 1,
    mutation: {
      kind: "file_put",
      fileId: "file-system",
      moduleId: "mod-a",
      logicalName: "system.py",
      role: "script",
      dependencies: [],
      resourceRef: sampleAgentResourceReference({
        name: "system.py",
        mimeType: "text/plain",
        byteCount: 1,
      }),
    },
  })).state;
  state = (await applyProjectSourceWorkspaceCommand(state, {
    projectId,
    mutationId: "a1",
    expectedWorkspaceRevision: 2,
    mutation: {
      kind: "attachment_put",
      attachmentId: "att-system",
      fileId: "file-system",
      role: { id: "design-source", version: 1 },
      target: { elementId: "sys-def-001", elementKind: "PartDefinition" },
      declaredAgainst: {
        thread: {
          snapshotId: fixture.snapshot.id,
          revision: fixture.snapshot.revision,
          subjectId: fixture.snapshot.subject.id,
        },
        architecture: {
          artifactId: `architecture-${fixture.fingerprint.digest}`,
          fingerprint: fixture.fingerprint,
          captureSchema: "architecture-capture/4.0",
        },
      },
    },
  })).state;
  if (options.extraFile) {
    state = (await applyProjectSourceWorkspaceCommand(state, {
      projectId,
      mutationId: "f-extra",
      expectedWorkspaceRevision: 3,
      mutation: {
        kind: "file_put",
        fileId: "file-extra",
        moduleId: "mod-a",
        logicalName: "extra.py",
        role: "script",
        dependencies: [],
        resourceRef: sampleAgentResourceReference({
          name: "extra.py",
          mimeType: "text/plain",
          byteCount: 1,
        }),
      },
    })).state;
    state = (await applyProjectSourceWorkspaceCommand(state, {
      projectId,
      mutationId: "a-extra",
      expectedWorkspaceRevision: 4,
      mutation: {
        kind: "attachment_put",
        attachmentId: "att-extra",
        fileId: "file-extra",
        role: { id: "design-source", version: 1 },
        target: { elementId: "sys-def-001", elementKind: "PartDefinition" },
        declaredAgainst: {
          thread: {
            snapshotId: fixture.snapshot.id,
            revision: fixture.snapshot.revision,
            subjectId: fixture.snapshot.subject.id,
          },
          architecture: {
            artifactId: `architecture-${fixture.fingerprint.digest}`,
            fingerprint: fixture.fingerprint,
            captureSchema: "architecture-capture/4.0",
          },
        },
      },
    })).state;
  }
  const revisions = new Map<number, ProjectSourceWorkspaceState>([
    [state.workspaceRevision, state],
  ]);
  return {
    state,
    store: {
      load: () => Promise.resolve(state),
      loadAtFresh: (_projectId: string, workspaceRevision: number) => {
        const named = revisions.get(workspaceRevision);
        if (!named) {
          return Promise.reject(
            new Error(`missing revision ${workspaceRevision}`),
          );
        }
        return Promise.resolve(named);
      },
    },
  };
}

async function authoringWorkspaceAtRevision(
  projectId: string,
  fixture: Awaited<ReturnType<typeof verifiedArchitectureNavigationFixture>>,
  workspaceRevision: number,
): Promise<ProjectSourceWorkspaceState> {
  let state = (await authoringWorkspaceForFixture(projectId, fixture)).state;
  for (
    let revision = state.workspaceRevision + 1;
    revision <= workspaceRevision;
    revision++
  ) {
    state = (await applyProjectSourceWorkspaceCommand(state, {
      projectId,
      mutationId: `padding-${revision}`,
      expectedWorkspaceRevision: state.workspaceRevision,
      mutation: {
        kind: "module_put",
        moduleId: `module-${revision}`,
        slug: `module-${revision}`,
        displayName: `Module ${revision}`,
      },
    })).state;
  }
  return state;
}

function workbenchSnapshotEvent(text: string): {
  readonly id: string;
  readonly snapshot: {
    readonly project: { readonly revision: number };
    readonly thread: { readonly id: string };
  };
} {
  const id = /^id: (.+)$/m.exec(text)?.[1];
  const data = /^data: (.+)$/m.exec(text)?.[1];
  if (!id || !data) throw new Error("expected a workbench snapshot SSE event");
  return {
    id,
    snapshot: JSON.parse(data),
  };
}

class ThreadStore implements ThreadSnapshotStore {
  readonly #snapshots = new Map<string, ThreadSnapshot>();

  constructor(snapshots: readonly ThreadSnapshot[]) {
    for (const snapshot of snapshots) {
      this.#snapshots.set(snapshot.id, snapshot);
    }
  }

  get(snapshotId: string): Promise<ThreadSnapshot | undefined> {
    return Promise.resolve(this.#snapshots.get(snapshotId));
  }

  latest(subjectId: string): Promise<ThreadSnapshot | undefined> {
    const latest = [...this.#snapshots.values()]
      .filter((snapshot) => snapshot.subject.id === subjectId)
      .sort((left, right) => right.revision - left.revision)[0];
    return Promise.resolve(latest);
  }

  save(snapshot: ThreadSnapshot): Promise<void> {
    this.#snapshots.set(snapshot.id, snapshot);
    return Promise.resolve();
  }
}

class ProjectStore implements EngineeringProjectRevisionStore {
  readonly #projects = new Map<string, EngineeringProjectSnapshot>();

  constructor(projects: readonly EngineeringProjectSnapshot[]) {
    for (const project of projects) {
      this.#projects.set(project.project.id, project);
    }
  }

  replace(project: EngineeringProjectSnapshot): void {
    this.#projects.set(project.project.id, project);
  }

  get(projectId: string): Promise<EngineeringProjectSnapshot | undefined> {
    return Promise.resolve(this.#projects.get(projectId));
  }

  getRevision(
    projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = this.#projects.get(projectId);
    return Promise.resolve(
      project?.revision === revision ? project : undefined,
    );
  }

  createInitial(
    snapshot: EngineeringProjectSnapshot,
  ): Promise<EngineeringProjectSnapshot> {
    return Promise.resolve(snapshot);
  }

  commit(
    snapshot: EngineeringProjectSnapshot,
  ): Promise<EngineeringProjectSnapshot> {
    return Promise.resolve(snapshot);
  }
}

class MutableFocus implements CockpitFocusStore {
  constructor(public value: CockpitFocusSnapshot | undefined) {}

  get(_workspaceId: string): Promise<CockpitFocusSnapshot | undefined> {
    return Promise.resolve(this.value);
  }

  select(snapshot: CockpitFocusSnapshot): Promise<CockpitFocusSnapshot> {
    this.value = snapshot;
    return Promise.resolve(snapshot);
  }
}

const DISCOVERY_LEAK_PASSWORD = "hunter2-credential";
const DISCOVERY_LEAK_PATH = "/Volumes/DEV/secret/id_rsa";
const DISCOVERY_LEAK_TOKEN = "sk-live-secret-token";
const DISCOVERY_LEAK_JSON = JSON.stringify({
  schemaVersion: "1.0",
  password: DISCOVERY_LEAK_PASSWORD,
  path: DISCOVERY_LEAK_PATH,
  token: DISCOVERY_LEAK_TOKEN,
  name: "Should-Not-Surface",
  status: "pass",
  verdict: "pass",
});

function discoveryProjectFixture(id: string, name: string) {
  const generatedAt = "2026-08-01T10:36:58.345Z";
  const objective = "Exercise read-only project discovery without a product fixture.";
  return validateEngineeringProjectSnapshot({
    schemaVersion: "4.0",
    id: `${id}:r1`,
    revision: 1,
    generatedAt,
    project: {
      id,
      name,
      subjectId: `${id}-subject`,
      objective: { title: objective, statement: objective },
    },
    framing: {
      intent: {
        statement: objective,
        source: { kind: "human", reference: "paired-conversation" },
        capturedAt: generatedAt,
        capturedBy: { id: "human:owner", origin: "human" },
      },
      questions: [],
      answers: [],
    },
    threadSnapshots: [],
    phases: [],
    workItems: [],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
    commandReceipts: [{
      commandId: `start-${id}`,
      type: "project.start",
      actor: { id: "human:owner", origin: "human" },
      issuedAt: generatedAt,
      appliedAt: generatedAt,
      requestFingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
      resultingSnapshot: { snapshotId: `${id}:r1`, revision: 1 },
    }],
  });
}

function assertDiscoveryNoLeak(text: string): void {
  for (
    const leak of [
      DISCOVERY_LEAK_PASSWORD,
      DISCOVERY_LEAK_PATH,
      DISCOVERY_LEAK_TOKEN,
      "Should-Not-Surface",
    ]
  ) {
    assertEquals(text.includes(leak), false);
  }
}

async function discoveryTreeSnapshot(directory: string): Promise<string> {
  const lines: string[] = [];
  async function walk(path: string, relative: string): Promise<void> {
    const entries = [];
    for await (const entry of Deno.readDir(path)) entries.push(entry);
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const child = `${path}/${entry.name}`;
      const rel = relative === "" ? entry.name : `${relative}/${entry.name}`;
      const stat = await Deno.lstat(child);
      lines.push(
        `${rel}|${stat.isDirectory}|${stat.isSymlink}|${stat.size}|${
          stat.mtime?.getTime() ?? ""
        }`,
      );
      if (stat.isDirectory && !stat.isSymlink) await walk(child, rel);
    }
  }
  await walk(directory, "");
  return lines.join("\n");
}
