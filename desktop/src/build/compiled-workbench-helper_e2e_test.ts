import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert@1.0.14";
import { FileCockpitFocusStore } from "../../../src/adapters/project/file-cockpit-focus-store.ts";
import { FileEngineeringProjectRevisionStore } from "../../../src/adapters/shared/stores/engineering-project-store.ts";
import type { EngineeringProjectSnapshot } from "../../../src/domain/project/engineering-project.ts";
import { validateEngineeringProjectSnapshot } from "../../../src/domain/project/engineering-project-validation.ts";
import { COCKPIT_FOCUS_SCHEMA_VERSION } from "../../../src/domain/project/cockpit-focus.ts";
import { PACKAGED_CONTROL_PLANE_ASSETS } from "../sidecar/embedded-assets.ts";
import { materializeClosedWorkspace } from "../sidecar/workspace.ts";
import { createDenoWorkbenchHost } from "../workbench/host.ts";
import {
  WORKBENCH_ACCESS_HEADER,
  WORKBENCH_HANDSHAKE_SCHEMA,
  WORKBENCH_HELPER_NAME,
  WORKBENCH_INSPECT_SCHEMA,
  WORKBENCH_ORIGIN,
} from "../workbench/contracts.ts";

const LAUNCH_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const decoder = new TextDecoder();

Deno.test({
  name: "native Workbench host inspects and owns the actual compiled helper",
  ignore: Deno.build.os !== "darwin",
  async fn() {
    const desktopRoot = decodeURIComponent(
      new URL("../../", import.meta.url).pathname,
    ).replace(/\/$/u, "");
    const helper = `${desktopRoot}/dist/helpers/${WORKBENCH_HELPER_NAME}`;
    const launchCwd = await canonicalTempDir("casys-native-workbench-host-");
    await materializeClosedWorkspace(
      launchCwd,
      "macos-application-support",
      PACKAGED_CONTROL_PLANE_ASSETS,
    );
    const host = createDenoWorkbenchHost(
      helper,
      launchCwd,
      "macos-application-support",
    );
    try {
      // Exercise the production Deno.Command adapter, including its inspect
      // call, rather than manually spawning the helper with different stdio.
      const started = await host.start();
      assertEquals(started.projection.lifecycle, "owned-ready");
      if (started.session === undefined) {
        throw new Error("The compiled Workbench did not publish its host session.");
      }
      const response = await fetch(`${started.session.origin}/api/projects`, {
        headers: { [WORKBENCH_ACCESS_HEADER]: started.session.accessToken },
      });
      assertEquals(response.status, 200);
      assertEquals((await response.json()).projects, []);
      await host.stop();
      const inspected = await runHelper(helper, launchCwd, [
        "inspect",
        "--layout-profile=macos-application-support",
      ]);
      assertEquals(inspected.success, true, decoder.decode(inspected.stderr));
      const document = JSON.parse(decoder.decode(inspected.stdout));
      assertEquals(document.lock, "free");
      assertEquals(document.marker, null);
    } finally {
      await host.stop();
      await Deno.remove(launchCwd, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "compiled Workbench reopens offline project intent, streams SSE, and leaves no orphan",
  ignore: Deno.build.os !== "darwin",
  async fn() {
    const desktopRoot = decodeURIComponent(
      new URL("../../", import.meta.url).pathname,
    ).replace(/\/$/u, "");
    const helper = `${desktopRoot}/dist/helpers/${WORKBENCH_HELPER_NAME}`;
    const launchCwd = await canonicalTempDir("casys-compiled-workbench-");
    const materialized = await materializeClosedWorkspace(
      launchCwd,
      "macos-application-support",
      PACKAGED_CONTROL_PLANE_ASSETS,
    );
    const projectDirectory =
      `${materialized.workspaceRoot}/state/local/engineering-projects`;
    const focusDirectory = `${materialized.workspaceRoot}/state/local/cockpit-focus`;
    const projectStore = new FileEngineeringProjectRevisionStore(projectDirectory);
    const focusStore = new FileCockpitFocusStore(focusDirectory);
    await projectStore.createInitial(projectFixture());

    const child = new Deno.Command(helper, {
      args: [
        "start",
        "--layout-profile=macos-application-support",
        `--launch-id=${LAUNCH_ID}`,
      ],
      cwd: launchCwd,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const stdin = child.stdin.getWriter();
    const stdout = child.stdout.getReader();
    const stderrPromise = new Response(child.stderr).text();
    let exited = false;
    const statusPromise = child.status.then((status) => {
      exited = true;
      return status;
    });
    try {
      const handshake = JSON.parse(await readFirstLine(stdout));
      assertEquals(handshake.schema, WORKBENCH_HANDSHAKE_SCHEMA);
      assertEquals(handshake.status, "ready");
      assertEquals(handshake.launchId, LAUNCH_ID);
      const token = String(handshake.accessToken);
      const authenticated = { headers: { [WORKBENCH_ACCESS_HEADER]: token } };

      const unauthenticated = await fetch(`${WORKBENCH_ORIGIN}/api/projects`);
      assertEquals(unauthenticated.status, 404);

      const projects = await fetch(`${WORKBENCH_ORIGIN}/api/projects`, authenticated);
      const catalog = await projects.json();
      assertEquals(projects.status, 200, JSON.stringify(catalog));
      assertEquals(catalog.state, "available");
      assertEquals(catalog.projects, [{
        id: "offline-project",
        name: "Offline project",
        revision: 1,
        subjectId: "offline-subject",
      }]);

      const waiting = await fetch(`${WORKBENCH_ORIGIN}/`, authenticated);
      assertEquals(waiting.status, 200);
      const waitingHtml = await waiting.text();
      assertStringIncludes(waitingHtml, "Opening project context");
      assertStringIncludes(waitingHtml, "Offline project");
      assertEquals(waitingHtml.includes("href="), false);
      const absentFocus = await fetch(
        `${WORKBENCH_ORIGIN}/api/thread/workbench`,
        authenticated,
      );
      assertEquals(absentFocus.status, 409);
      assertEquals((await absentFocus.json()).error, "cockpit_focus_not_selected");

      await focusStore.select({
        schemaVersion: COCKPIT_FOCUS_SCHEMA_VERSION,
        workspaceId: "primary",
        revision: 1,
        commandId: "desktop-e2e-focus",
        selectedAt: "2026-08-23T00:00:00.000Z",
        selectedBy: { kind: "agent", actorId: "desktop-e2e-agent" },
        target: { kind: "project", projectId: "offline-project" },
      }, 0);

      const projection = await fetch(
        `${WORKBENCH_ORIGIN}/api/thread/workbench`,
        authenticated,
      );
      assertEquals(projection.status, 200);
      const body = await projection.json();
      assertEquals(body.surface, "planning");
      assertEquals(body.project.project.id, "offline-project");
      assertEquals(body.project.threadSnapshots, []);
      assertEquals(body.planning.technicalBaseline.status, "not-created");
      assertEquals("thread" in body, false);

      const viewerSessions = await fetch(
        `${WORKBENCH_ORIGIN}/api/thread/viewer-sessions`,
        authenticated,
      );
      assertEquals(viewerSessions.status, 200);
      assertEquals((await viewerSessions.json()).sessions, []);

      const workbench = await fetch(`${WORKBENCH_ORIGIN}/`, authenticated);
      assertEquals(workbench.status, 200);
      assertStringIncludes(
        workbench.headers.get("content-security-policy") ?? "",
        "default-src 'none'",
      );
      assertStringIncludes(
        workbench.headers.get("content-security-policy") ?? "",
        "script-src 'self'",
      );
      assertStringIncludes(
        workbench.headers.get("content-security-policy") ?? "",
        "frame-src blob:",
      );
      const workbenchHtml = await workbench.text();
      const appNonce = workbenchHtml.match(
        /<meta name="casys-mcp-app-script-nonce" content="([A-Za-z0-9_-]{43})">/,
      )?.[1];
      if (!appNonce) {
        throw new Error("Compiled Workbench HTML has no MCP App host nonce.");
      }
      assertStringIncludes(
        workbench.headers.get("content-security-policy") ?? "",
        `'nonce-${appNonce}'`,
      );
      const scriptPath = workbenchHtml.match(
        /<script[^>]+src="\.?(\/assets\/[^"]+\.js)"/u,
      )?.[1];
      if (scriptPath === undefined) {
        throw new Error("Compiled Workbench HTML has no embedded module asset.");
      }
      const script = await fetch(`${WORKBENCH_ORIGIN}${scriptPath}`, authenticated);
      assertEquals(script.status, 200);
      assertStringIncludes(
        script.headers.get("content-type") ?? "",
        "javascript",
      );
      assertStringIncludes(await script.text(), "EventSource");

      const sseAbort = new AbortController();
      const events = await fetch(
        `${WORKBENCH_ORIGIN}/api/thread/workbench/events`,
        { ...authenticated, signal: sseAbort.signal },
      );
      assertEquals(events.status, 200);
      assertStringIncludes(
        events.headers.get("content-type") ?? "",
        "text/event-stream",
      );
      const eventReader = events.body!.getReader();
      const firstEvent = decoder.decode((await eventReader.read()).value);
      assertStringIncludes(firstEvent, "event: workbench-snapshot");
      assertStringIncludes(firstEvent, '"id":"offline-project"');
      await eventReader.cancel();
      sseAbort.abort();

      const rejected = await fetch(`${WORKBENCH_ORIGIN}/api/thread/workbench`, {
        method: "POST",
        headers: { [WORKBENCH_ACCESS_HEADER]: token },
      });
      assertEquals(rejected.status, 405);
      assertEquals(rejected.headers.get("allow"), "GET");

      await stdin.close();
      await drain(stdout);
      const status = await statusPromise;
      assertEquals(status.success, true, await stderrPromise);

      const inspect = await runHelper(helper, launchCwd, [
        "inspect",
        "--layout-profile=macos-application-support",
      ]);
      assertEquals(inspect.success, true, decoder.decode(inspect.stderr));
      const document = JSON.parse(decoder.decode(inspect.stdout));
      assertEquals(document.schema, WORKBENCH_INSPECT_SCHEMA);
      assertEquals(document.configuration, "verified");
      assertEquals(document.marker, null);
      assertEquals(document.lock, "free");
      assertEquals("accessToken" in document, false);
      await assertRejects(
        () =>
          Deno.lstat(
            `${launchCwd}/ai.casys.digital-thread/workbench-runtime/owner.json`,
          ),
        Deno.errors.NotFound,
      );
      await assertRejects(
        () =>
          Deno.lstat(
            `${launchCwd}/ai.casys.digital-thread/workbench-runtime/access-token`,
          ),
        Deno.errors.NotFound,
      );
      await assertRejects(() => fetch(`${WORKBENCH_ORIGIN}/healthz`), TypeError);
    } finally {
      if (!exited) {
        try {
          await stdin.close();
        } catch {
          // The child may already have closed its lifeline.
        }
        try {
          child.kill("SIGTERM");
        } catch {
          // The child may have exited between the state check and signal.
        }
        await statusPromise;
      }
      try {
        stdin.releaseLock();
      } catch {
        // Already released by shutdown cleanup.
      }
      stdout.releaseLock();
      await Deno.remove(launchCwd, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "compiled Workbench executes the Linux XDG grant and rejects the uncovered HOME fallback",
  ignore: Deno.build.os !== "darwin",
  async fn() {
    const desktopRoot = decodeURIComponent(
      new URL("../../", import.meta.url).pathname,
    ).replace(/\/$/u, "");
    const helper = `${desktopRoot}/dist/helpers/${WORKBENCH_HELPER_NAME}`;
    const xdgCwd = await canonicalTempDir("casys-workbench-linux-xdg-");
    const homeCwd = await canonicalTempDir("casys-workbench-linux-home-");
    try {
      await materializeClosedWorkspace(
        xdgCwd,
        "linux-xdg",
        PACKAGED_CONTROL_PLANE_ASSETS,
      );
      const xdg = await runHelper(helper, xdgCwd, [
        "start",
        "--layout-profile=linux-xdg",
        `--launch-id=${LAUNCH_ID}`,
      ]);
      assertEquals(xdg.success, true, decoder.decode(xdg.stderr));
      const handshake = JSON.parse(decoder.decode(xdg.stdout).trim());
      assertEquals(handshake.schema, WORKBENCH_HANDSHAKE_SCHEMA);
      assertEquals(handshake.status, "ready");

      await materializeClosedWorkspace(
        homeCwd,
        "linux-home",
        PACKAGED_CONTROL_PLANE_ASSETS,
      );
      const home = await runHelper(helper, homeCwd, [
        "start",
        "--layout-profile=linux-home",
        `--launch-id=${LAUNCH_ID}`,
      ]);
      assertEquals(home.success, false);
      const error = decoder.decode(home.stderr);
      assertStringIncludes(error, "Requires read access");
      assertStringIncludes(error, ".local/share/ai.casys.digital-thread");
    } finally {
      await Deno.remove(xdgCwd, { recursive: true });
      await Deno.remove(homeCwd, { recursive: true });
    }
  },
});

function projectFixture(): EngineeringProjectSnapshot {
  const generatedAt = "2026-08-23T00:00:00.000Z";
  return validateEngineeringProjectSnapshot({
    schemaVersion: "4.0",
    id: "offline-project:r1",
    revision: 1,
    generatedAt,
    project: {
      id: "offline-project",
      name: "Offline project",
      subjectId: "offline-subject",
      objective: {
        title: "Reopen a persisted project without provider availability",
        statement: "Prove the Desktop Workbench remains an offline read model.",
      },
    },
    framing: {
      intent: {
        statement: "Prove the Desktop Workbench remains an offline read model.",
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
      commandId: "start-offline-project",
      type: "project.start",
      actor: { id: "human:owner", origin: "human" },
      issuedAt: generatedAt,
      appliedAt: generatedAt,
      requestFingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
      resultingSnapshot: { snapshotId: "offline-project:r1", revision: 1 },
    }],
  });
}

function runHelper(
  helper: string,
  cwd: string,
  args: readonly string[],
): Promise<Deno.CommandOutput> {
  return new Deno.Command(helper, {
    args: [...args],
    cwd,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
}

async function readFirstLine(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> {
  let text = "";
  while (!text.includes("\n")) {
    const next = await reader.read();
    if (next.done) throw new Error("Workbench exited before its handshake.");
    text += decoder.decode(next.value, { stream: true });
  }
  return text.slice(0, text.indexOf("\n"));
}

async function drain(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  while (!(await reader.read()).done) {
    // Drain until the child closes stdout.
  }
}

async function canonicalTempDir(prefix: string): Promise<string> {
  return await Deno.realPath(await Deno.makeTempDir({ prefix }));
}
