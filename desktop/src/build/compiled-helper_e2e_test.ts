import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert@1.0.14";
import {
  CONTROL_PLANE_ENDPOINT,
  CONTROL_PLANE_HELPER_NAME,
  HANDSHAKE_SCHEMA,
  INSPECT_SCHEMA,
  MCP_PROTOCOL_VERSION,
} from "../sidecar/contracts.ts";

const PROFILE_ARGUMENT = "--layout-profile=macos-application-support";
const FIRST_LAUNCH_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SECOND_LAUNCH_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const decoder = new TextDecoder();

Deno.test({
  name:
    "compiled macOS helper starts with embedded assets, enforces lifecycle and symlink confinement",
  ignore: Deno.build.os !== "darwin",
  async fn() {
    const desktopRoot = decodeURIComponent(
      new URL("../../", import.meta.url).pathname,
    ).replace(/\/$/u, "");
    const helper = `${desktopRoot}/dist/helpers/${CONTROL_PLANE_HELPER_NAME}`;

    await proveReadOnlyFirstInspect(helper);
    await proveSignalShutdown(helper);
    await proveExistingSymlinkRejected(helper);
    await proveDanglingSymlinkRejected(helper);
    await proveDeepProjectStoreSymlinkRejected(helper);
  },
});

async function proveReadOnlyFirstInspect(helper: string): Promise<void> {
  const launchCwd = await canonicalTempDir("casys-compiled-inspect-");
  try {
    const result = await runHelper(helper, launchCwd, [
      "inspect",
      PROFILE_ARGUMENT,
    ]);
    assertEquals(result.success, true, decoder.decode(result.stderr));
    const document = JSON.parse(decoder.decode(result.stdout));
    assertEquals(document.schema, INSPECT_SCHEMA);
    assertEquals(document.configuration, "missing");
    assertEquals(document.marker, null);
    assertEquals(document.lock, "free");
    await assertRejects(
      () => Deno.lstat(`${launchCwd}/ai.casys.digital-thread`),
      Deno.errors.NotFound,
    );
  } finally {
    await Deno.remove(launchCwd, { recursive: true });
  }
}

async function proveSignalShutdown(helper: string): Promise<void> {
  const launchCwd = await canonicalTempDir("casys-compiled-sigterm-");
  const child = new Deno.Command(helper, {
    args: ["start", PROFILE_ARGUMENT, `--launch-id=${FIRST_LAUNCH_ID}`],
    cwd: launchCwd,
    env: {},
    clearEnv: true,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const stdin = child.stdin.getWriter();
  const stderrPromise = new Response(child.stderr).text();
  const stdout = child.stdout.getReader();
  try {
    const handshake = JSON.parse(await readFirstLine(stdout));
    assertEquals(handshake.schema, HANDSHAKE_SCHEMA);
    assertEquals(handshake.status, "ready");
    assertEquals(handshake.launchId, FIRST_LAUNCH_ID);

    // This actual compiled server startup reads the packaged CalculiX STEP
    // qualification fixture before publishing readiness. A source-checkout
    // run or an include-string assertion cannot prove that asset survived
    // compilation. The cwd and environment are the native launch contract.
    const health = await fetch(new URL("/health", CONTROL_PLANE_ENDPOINT));
    assertEquals(health.status, 200, await health.text());

    child.kill("SIGTERM");
    await drain(stdout);
    const status = await child.status;
    const stderr = await stderrPromise;
    assertEquals(status.success, true, stderr);
    await assertRejects(
      () =>
        Deno.lstat(
          `${launchCwd}/ai.casys.digital-thread/control-plane/runtime/owner.json`,
        ),
      Deno.errors.NotFound,
    );

    const inspected = await runHelper(helper, launchCwd, [
      "inspect",
      PROFILE_ARGUMENT,
    ]);
    assertEquals(inspected.success, true, decoder.decode(inspected.stderr));
    const document = JSON.parse(decoder.decode(inspected.stdout));
    assertEquals(document.configuration, "verified");
    assertEquals(document.marker, null);
    assertEquals(document.lock, "free");
  } finally {
    try {
      await stdin.close();
    } catch {
      // The signalled child may close its pipe first.
    }
    stdin.releaseLock();
    stdout.releaseLock();
    await Deno.remove(launchCwd, { recursive: true });
  }
}

async function proveExistingSymlinkRejected(helper: string): Promise<void> {
  const launchCwd = await canonicalTempDir("casys-compiled-link-existing-");
  const escape = await canonicalTempDir("casys-compiled-link-target-");
  const target = `${escape}/ai.casys.digital-thread`;
  const escapedWorkspace = `${target}/control-plane`;
  await Deno.mkdir(escapedWorkspace, { recursive: true });
  await Deno.symlink(target, `${launchCwd}/ai.casys.digital-thread`);
  try {
    const result = await runHelper(helper, launchCwd, [
      "start",
      PROFILE_ARGUMENT,
      `--launch-id=${FIRST_LAUNCH_ID}`,
    ]);
    assertEquals(result.success, false);
    assertStringIncludes(decoder.decode(result.stderr), "workspace.path-unsafe");
    assertEquals([...Deno.readDirSync(escapedWorkspace)].length, 0);
  } finally {
    await Deno.remove(launchCwd, { recursive: true });
    await Deno.remove(escape, { recursive: true });
  }
}

async function proveDanglingSymlinkRejected(helper: string): Promise<void> {
  const launchCwd = await canonicalTempDir("casys-compiled-link-dangling-");
  const escape = await canonicalTempDir("casys-compiled-link-missing-");
  const target = `${escape}/ai.casys.digital-thread`;
  await Deno.symlink(target, `${launchCwd}/ai.casys.digital-thread`);
  try {
    const result = await runHelper(helper, launchCwd, [
      "start",
      PROFILE_ARGUMENT,
      `--launch-id=${SECOND_LAUNCH_ID}`,
    ]);
    assertEquals(result.success, false);
    assertStringIncludes(decoder.decode(result.stderr), "workspace.path-unsafe");
    await assertRejects(() => Deno.lstat(target), Deno.errors.NotFound);
  } finally {
    await Deno.remove(launchCwd, { recursive: true });
    await Deno.remove(escape, { recursive: true });
  }
}

async function proveDeepProjectStoreSymlinkRejected(
  helper: string,
): Promise<void> {
  const launchCwd = await canonicalTempDir("casys-compiled-deep-link-");
  const escape = await canonicalTempDir("casys-compiled-project-target-");
  const workspaceRoot = `${launchCwd}/ai.casys.digital-thread/control-plane`;
  await Deno.mkdir(`${workspaceRoot}/state/local`, { recursive: true });
  await Deno.symlink(
    escape,
    `${workspaceRoot}/state/local/engineering-projects`,
  );

  const child = new Deno.Command(helper, {
    args: [
      "start",
      PROFILE_ARGUMENT,
      `--launch-id=${SECOND_LAUNCH_ID}`,
    ],
    cwd: launchCwd,
    env: {},
    clearEnv: true,
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
    const firstLine = await Promise.race([
      readFirstLineOrNull(stdout),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("deep-link helper launch timed out")),
          10_000,
        )
      ),
    ]);

    // If the launch audit regresses, drive the exact mutation that previously
    // escaped through this deep link so the outside-tree assertion catches it.
    if (firstLine !== null) {
      const handshake = JSON.parse(firstLine);
      assertEquals(handshake.schema, HANDSHAKE_SCHEMA);
      assertEquals(handshake.status, "ready");
      await callProjectStart();
    }

    try {
      await stdin.close();
    } catch {
      // A rejected launch closes its pipe before the test does.
    }
    await drain(stdout);
    const status = await statusPromise;
    const stderr = await stderrPromise;
    assertEquals([...Deno.readDirSync(escape)].length, 0);
    assertEquals(firstLine, null, "unsafe deep tree reached MCP readiness");
    assertEquals(status.success, false);
    assertStringIncludes(stderr, "workspace.tree-unsafe");
  } finally {
    if (!exited) {
      try {
        child.kill("SIGTERM");
      } catch {
        // The child may have exited between the state check and signal.
      }
      await statusPromise;
    }
    try {
      await stdin.close();
    } catch {
      // Already closed above.
    }
    stdin.releaseLock();
    stdout.releaseLock();
    await Deno.remove(launchCwd, { recursive: true });
    await Deno.remove(escape, { recursive: true });
  }
}

async function callProjectStart(): Promise<void> {
  const response = await fetch(CONTROL_PLANE_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
      "mcp-method": "tools/call",
      "mcp-name": "project_start",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "project_start",
        arguments: {
          commandId: "deep-link-regression",
          projectId: "deep-link-regression",
          projectName: "Deep link regression",
          issuedAt: new Date().toISOString(),
          intent: "Prove project persistence remains in the closed workspace.",
          intentSource: {
            kind: "human",
            reference: "test:deep-link-regression",
          },
        },
        _meta: {
          "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": {
            name: "casys-desktop-deep-link-regression",
            version: "0.2.0",
          },
        },
      },
    }),
  });
  const envelope = await response.json() as {
    readonly error?: { readonly message?: string };
  };
  if (!response.ok || envelope.error !== undefined) {
    throw new Error(
      `project_start did not complete: ${
        envelope.error?.message ?? `HTTP ${response.status}`
      }`,
    );
  }
}

function runHelper(
  helper: string,
  cwd: string,
  args: readonly string[],
): Promise<Deno.CommandOutput> {
  return new Deno.Command(helper, {
    args: [...args],
    cwd,
    env: {},
    clearEnv: true,
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
    if (next.done) {
      throw new Error("The compiled helper exited before its handshake.");
    }
    text += decoder.decode(next.value, { stream: true });
  }
  return text.slice(0, text.indexOf("\n"));
}

async function readFirstLineOrNull(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string | null> {
  let text = "";
  while (!text.includes("\n")) {
    const next = await reader.read();
    if (next.done) return text.length === 0 ? null : text;
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
