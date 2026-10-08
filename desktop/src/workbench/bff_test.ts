import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.14";
import { FileCockpitFocusStore } from "../../../src/adapters/project/file-cockpit-focus-store.ts";
import { FileEngineeringProjectRevisionStore } from "../../../src/adapters/shared/stores/engineering-project-store.ts";
import { validateEngineeringProjectSnapshot } from "../../../src/domain/project/engineering-project-validation.ts";
import { COCKPIT_FOCUS_SCHEMA_VERSION } from "../../../src/domain/project/cockpit-focus.ts";
import {
  createPackagedWorkbenchBff,
  PACKAGED_VIEWER_APP_OBJECT_DIRECTORY,
  PACKAGED_VIEWER_APP_REGISTRY_PATH,
} from "./bff.ts";
import { WORKBENCH_ACCESS_HEADER, WORKBENCH_WORKSPACE_ID } from "./contracts.ts";

Deno.test("packaged Workbench opens its native document on a fresh profile without creating project state", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-packaged-unfocused-" });
  try {
    const profile = `${root}/profile`;
    const uiAssetDirectory = `${root}/ui`;
    await Deno.mkdir(profile);
    await Deno.mkdir(`${uiAssetDirectory}/assets`, { recursive: true });
    await Deno.writeTextFile(
      `${uiAssetDirectory}/native-workbench.html`,
      `<html><head><script type="module" src="./assets/native-workbench-test.js"></script></head><body><div id="native-preview"></div></body></html>`,
    );
    await Deno.writeTextFile(
      `${uiAssetDirectory}/assets/native-workbench-test.js`,
      "export const ready = true;\n",
    );
    const token = "c".repeat(64);
    const handler = createPackagedWorkbenchBff(token, profile, { uiAssetDirectory });
    const headers = { [WORKBENCH_ACCESS_HEADER]: token };
    assertEquals((await handler(new Request("http://127.0.0.1/"))).status, 404);
    for (const path of ["/", "/native-workbench.html"]) {
      const page = await handler(new Request(`http://127.0.0.1${path}`, { headers }));
      assertEquals(page.status, 200);
      const html = await page.text();
      assertStringIncludes(html, 'id="native-preview"');
      assertStringIncludes(html, "./assets/native-workbench-test.js");
      assertEquals(html.includes("Cockpit awaiting project context"), false);
    }
    const script = await handler(
      new Request("http://127.0.0.1/assets/native-workbench-test.js", { headers }),
    );
    assertEquals(script.status, 200);
    assertEquals(await script.text(), "export const ready = true;\n");
    const project = await handler(
      new Request("http://127.0.0.1/api/thread/workbench", { headers }),
    );
    assertEquals(project.status, 409);
    assertEquals((await project.json()).error, "cockpit_focus_not_selected");
    const catalog = await handler(
      new Request("http://127.0.0.1/api/projects", { headers }),
    );
    assertEquals(catalog.status, 200);
    assertEquals((await catalog.json()).projects, []);
    assertEquals(await Array.fromAsync(Deno.readDir(profile)), []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("packaged Workbench reaches v2 project discovery without changing v1 catalog", async () => {
  const root = await Deno.makeTempDir({
    prefix: "casys-packaged-project-discovery-",
  });
  try {
    const projectStore = new FileEngineeringProjectRevisionStore(
      `${root}/state/local/engineering-projects`,
    );
    await projectStore.createInitial(projectFixture());
    await Deno.mkdir(
      `${root}/state/local/engineering-projects/legacy-unsupported`,
    );
    await Deno.writeTextFile(
      `${root}/state/local/engineering-projects/legacy-unsupported/0000000001.json`,
      '{"schemaVersion":"1.0","password":"hunter2-credential"}',
    );

    const token = "b".repeat(64);
    const handler = createPackagedWorkbenchBff(token, root);
    const headers = { [WORKBENCH_ACCESS_HEADER]: token };

    const catalog = await handler(
      new Request("http://127.0.0.1/api/projects", { headers }),
    );
    assertEquals(catalog.status, 503);
    assertEquals(await catalog.json(), {
      schemaVersion: "native-workbench-project-catalog/1.0",
      state: "unavailable",
      projects: [],
      reason: "Persisted project revisions could not be reopened exactly.",
    });

    const discovery = await handler(
      new Request("http://127.0.0.1/api/project-discovery", { headers }),
    );
    assertEquals(discovery.status, 200);
    const body = await discovery.json();
    assertEquals(body.schemaVersion, "native-workbench-project-discovery/2.0");
    assertEquals(body.state, "partial");
    assertEquals(body.counts, {
      available: 1,
      unavailable: 1,
      candidates: 2,
    });
    const available = body.entries.find((entry: { kind: string }) =>
      entry.kind === "available"
    );
    const unavailable = body.entries.find((entry: { kind: string }) =>
      entry.kind === "unavailable"
    );
    assertEquals(available, {
      kind: "available",
      id: PROJECT_ID,
      name: "Packaged viewer project",
      revision: 1,
      subjectId: "packaged-viewer-subject",
    });
    assertEquals(unavailable?.kind, "unavailable");
    assertEquals(unavailable?.observedStorageIdentifier, "legacy-unsupported");
    assertEquals(unavailable?.identityAuthority, "observed-storage");
    assertEquals(JSON.stringify(body).includes("hunter2-credential"), false);

    const rejected = await handler(
      new Request("http://127.0.0.1/api/project-discovery", {
        method: "POST",
        headers,
      }),
    );
    assertEquals(rejected.status, 405);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("packaged Workbench wires the explicit viewer registry and fails closed when absent", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-packaged-viewer-apps-" });
  try {
    const projectStore = new FileEngineeringProjectRevisionStore(
      `${root}/state/local/engineering-projects`,
    );
    await projectStore.createInitial(projectFixture());
    const focus = new FileCockpitFocusStore(
      `${root}/state/local/cockpit-focus`,
    );
    await focus.select({
      schemaVersion: COCKPIT_FOCUS_SCHEMA_VERSION,
      workspaceId: WORKBENCH_WORKSPACE_ID,
      revision: 1,
      commandId: "select-packaged-viewer-test",
      selectedAt: AT,
      selectedBy: { kind: "agent", actorId: "desktop-test" },
      target: { kind: "project", projectId: PROJECT_ID },
    }, 0);

    const token = "a".repeat(64);
    const handler = createPackagedWorkbenchBff(token, root);
    const projects = await handler(
      new Request("http://127.0.0.1/api/projects", {
        headers: { [WORKBENCH_ACCESS_HEADER]: token },
      }),
    );
    assertEquals(projects.status, 200);
    assertEquals(await projects.json(), {
      schemaVersion: "native-workbench-project-catalog/1.0",
      state: "available",
      projects: [{
        id: PROJECT_ID,
        name: "Packaged viewer project",
        revision: 1,
        subjectId: "packaged-viewer-subject",
      }],
    });
    const response = await handler(
      new Request("http://127.0.0.1/api/thread/viewer-sessions", {
        headers: { [WORKBENCH_ACCESS_HEADER]: token },
      }),
    );
    assertEquals(response.status, 200);
    assertEquals((await response.json()).sessions, []);
    assertEquals(
      PACKAGED_VIEWER_APP_REGISTRY_PATH,
      "state/local/thread-viewer-apps/registry.json",
    );
    assertEquals(
      PACKAGED_VIEWER_APP_OBJECT_DIRECTORY,
      "state/local/thread-viewer-apps/objects",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

const PROJECT_ID = "packaged-viewer-project";
const AT = "2026-08-31T00:00:00.000Z";

function projectFixture() {
  return validateEngineeringProjectSnapshot({
    schemaVersion: "4.0",
    id: `${PROJECT_ID}:r1`,
    revision: 1,
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "Packaged viewer project",
      subjectId: "packaged-viewer-subject",
      objective: {
        title: "Verify packaged whole-App registration",
        statement: "Verify packaged whole-App registration.",
      },
    },
    framing: {
      intent: {
        statement: "Verify packaged whole-App registration.",
        source: { kind: "human", reference: "paired-conversation" },
        capturedAt: AT,
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
      commandId: "start-packaged-viewer-project",
      type: "project.start",
      actor: { id: "human:owner", origin: "human" },
      issuedAt: AT,
      appliedAt: AT,
      requestFingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
      resultingSnapshot: { snapshotId: `${PROJECT_ID}:r1`, revision: 1 },
    }],
  });
}
