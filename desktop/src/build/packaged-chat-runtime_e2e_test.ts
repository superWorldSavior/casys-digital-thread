import { assertEquals } from "jsr:@std/assert@1.0.14";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveMuseHost } from "../chat-host/agent-host.ts";

Deno.test("resolved Muse path reaches the bundled adapter without PATH", async () => {
  const root = await Deno.makeTempDir({ dir: "/tmp", prefix: "casys-muse-path-" });
  try {
    const directory = join(root, ".local", "bin");
    const muse = join(directory, "muse");
    await Deno.mkdir(directory, { recursive: true });
    await Deno.writeTextFile(muse, "#!/bin/sh\nexit 0\n");
    await Deno.chmod(muse, 0o755);
    const resolved = await resolveMuseHost({ HOME: root }, {
      isExecutable: (path) => Promise.resolve(path === muse),
      readVersion: () => Promise.resolve("1.4.0"),
      pathSeparator: ":",
    });
    assertEquals(resolved.ok, true);
    if (!resolved.ok) throw new Error("unreachable");
    const adapter = pathToFileURL(
      join(
        Deno.cwd(),
        "dist/chat-host-runtime/adapter/node_modules/@bex-co/muse-code-acp/dist/muse-cli.js",
      ),
    ).href;
    const output = await new Deno.Command("dist/chat-host-runtime/node", {
      args: [
        "--input-type=module",
        "--eval",
        `import { museCliPath } from ${
          JSON.stringify(adapter)
        }; process.stdout.write(museCliPath());`,
      ],
      env: { HOME: root, MUSE_CODE_EXECUTABLE: resolved.host.path },
      clearEnv: true,
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(output.success, true, new TextDecoder().decode(output.stderr));
    assertEquals(new TextDecoder().decode(output.stdout), muse);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("packaged fork acpx/runtime streams elicitation and reaps its process tree", async () => {
  const stateRoot = await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "casys-packaged-acpx-test-",
  });
  try {
    const desktopRoot = Deno.cwd();
    const output = await new Deno.Command("dist/chat-host-runtime/node", {
      args: [
        `${desktopRoot}/src/build/fixtures/packaged-runtime-smoke.mjs`,
        `${desktopRoot}/dist/chat-host-runtime`,
        `${desktopRoot}/src/build/fixtures/acp-agent.mjs`,
        stateRoot,
      ],
      cwd: Deno.cwd(),
      env: {},
      clearEnv: true,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stdout = new TextDecoder().decode(output.stdout).trim();
    const stderr = new TextDecoder().decode(output.stderr).trim();
    assertEquals(output.success, true, stderr);
    assertEquals(JSON.parse(stdout), {
      ok: true,
      runtime: "acpx/runtime",
      result: "completed",
      text: "elicitation:accept",
      elicitation: {
        mode: "form",
        message: "Confirm packaged runtime smoke",
        requestIdType: "number",
        aborted: false,
      },
      noOrphan: true,
    });
  } finally {
    await Deno.remove(stateRoot, { recursive: true });
  }
});
