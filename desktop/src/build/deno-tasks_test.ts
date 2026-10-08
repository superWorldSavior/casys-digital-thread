import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import denoConfig from "../../deno.json" with { type: "json" };
import { CONTROL_PLANE_COMPILE_PERMISSION_FLAGS } from "../sidecar/compile-permissions.ts";
import { WORKBENCH_COMPILE_PERMISSION_FLAGS } from "../workbench/compile-permissions.ts";

Deno.test("Lot 3 tasks compile both dedicated helpers and keep the host free of a Deno CLI", () => {
  const compile = denoConfig.tasks["sidecar:compile"];
  const workbenchCompile = denoConfig.tasks["workbench:compile"];
  const workbenchTest = denoConfig.tasks["workbench:test"];
  const generalTest = denoConfig.tasks.test;
  const sidecarTest = denoConfig.tasks["sidecar:test"];
  const pack = denoConfig.tasks.package;
  const compiledE2e = Deno.readTextFileSync(
    "src/build/compiled-helper_e2e_test.ts",
  );
  const compiledWorkbenchE2e = Deno.readTextFileSync(
    "src/build/compiled-workbench-helper_e2e_test.ts",
  );
  const compileWorkbench = Deno.readTextFileSync(
    "src/build/compile-workbench-helper.ts",
  );
  const finalizer = Deno.readTextFileSync("src/build/finalize-macos.ts");
  assert(compile.includes("src/build/compile-control-plane-helper.ts"));
  assert(compile.includes("src/build/compile-workbench-helper.ts"));
  assert(compile.includes("ui:build"));
  assert(workbenchCompile.includes("ui:build"));
  assert(workbenchCompile.includes("src/build/compile-workbench-helper.ts"));
  assertEquals(workbenchCompile.includes("compile-control-plane-helper"), false);
  assertEquals(
    workbenchTest.startsWith("deno task workbench:compile &&"),
    true,
  );
  assertEquals(
    workbenchTest.includes("--allow-net=127.0.0.1:5176"),
    true,
  );
  assertEquals(workbenchTest.includes("127.0.0.1:3020"), false);
  assertEquals(
    workbenchTest.includes("src/build/compiled-workbench-helper_e2e_test.ts"),
    true,
  );
  assertEquals(compile.includes("allow-run=deno"), true);
  assertEquals(compile.includes("--allow-env"), false);
  assertEquals(compile.includes("--allow-net"), false);
  assertEquals(compile.includes("--deny-env"), true);
  assertEquals(compile.includes("--deny-net"), true);
  assertEquals(
    generalTest.includes("--ignore=src/build/compiled-helper_e2e_test.ts"),
    true,
  );
  assertEquals(
    generalTest.includes("--ignore=src/build/compiled-workbench-helper_e2e_test.ts"),
    true,
  );
  // A second explicit root beside `src` disables the ignored-file filter.
  assertEquals(
    generalTest.includes(
      "src && deno test e2e/native-memory-guard_test.ts && deno test --config=../deno.json",
    ),
    true,
  );
  assertEquals(generalTest.includes("--allow-run"), false);
  assertEquals(
    sidecarTest.includes("--allow-net=127.0.0.1:3020,127.0.0.1:5176"),
    true,
  );
  assertEquals(sidecarTest.startsWith("deno task sidecar:compile &&"), true);
  assertEquals(compiledE2e.includes('args: ["task", "sidecar:compile"]'), false);
  assertEquals(
    compiledWorkbenchE2e.includes('args: ["task", "sidecar:compile"]'),
    false,
  );
  assertEquals(compileWorkbench.includes("--include=../src/ui/dist/thread"), true);
  assertEquals(finalizer.includes("stageWorkbenchHelper"), true);
  assertEquals(finalizer.includes("workbenchPath"), true);
  assertEquals(pack.includes("sidecar:compile"), true);
  assertEquals(pack.includes("DENO_BIN=$(which deno)"), true);
  assertEquals(pack.includes('PATH="$PWD/dist/helpers:$PATH"'), true);
  assertEquals(pack.includes('"$DENO_BIN" desktop'), true);
  // Deno 2.9.6 appends the macOS bundle suffix to this output basename.
  assertEquals(pack.includes("--output=dist/CasysDigitalThread main.ts"), true);
  assertEquals(pack.includes("--output=dist/CasysDigitalThread.app main.ts"), false);
  assertEquals(pack.includes("--deny-import"), true);
  assertEquals(pack.includes("allow-run=deno"), false);
  assertEquals(pack.includes("deno compile"), false);
  assertEquals(pack.includes("/usr/bin/clang"), true);
  assertEquals(pack.includes("src/build/finalize-macos.ts"), true);
  for (const flag of CONTROL_PLANE_COMPILE_PERMISSION_FLAGS) {
    assertEquals(flag.includes("allow-run=deno"), false);
  }
  for (const flag of WORKBENCH_COMPILE_PERMISSION_FLAGS) {
    assertEquals(flag.includes("allow-run=deno"), false);
  }
  assertEquals(denoConfig.version, "0.4.0");
  assertEquals(denoConfig.permissions.desktop.run, [
    "casys-control-plane",
    "casys-chat-host",
    "casys-workbench",
    "open",
    "docker",
    "/opt/homebrew/bin/docker",
    "/usr/local/bin/docker",
    "/usr/bin/docker",
    "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
  ]);
  // #57: app-managed providers bind ephemeral loopback ports, so the
  // desktop profile grants the loopback interface instead of fixed ports.
  // Loopback-only stays the boundary; the renderer never selects endpoints.
  assertEquals(denoConfig.permissions.desktop.net, [
    "127.0.0.1",
  ]);
  assertEquals("dev" in denoConfig.tasks, false);
  // The desktop shell holds user-fs access: the catalogue persists intents
  // under the per-user support dir (statically inexpressible) and chat
  // exports to Downloads. run/net/env/import stay allowlisted.
  assertEquals(denoConfig.permissions.desktop.read, true);
  assertEquals(denoConfig.permissions.desktop.write, true);
  const profileTest = denoConfig.tasks["catalogue:profile-test"];
  assertEquals(typeof profileTest, "string");
  assertEquals(
    profileTest.includes("src/catalogue/distribution-profile_test.ts"),
    true,
  );
  assertEquals(
    profileTest.includes(
      "--allow-run=casys-control-plane,casys-chat-host,casys-workbench,open,docker,/opt/homebrew/bin/docker,/usr/local/bin/docker,/usr/bin/docker",
    ),
    true,
  );
  assertEquals(
    profileTest.includes("--allow-net=127.0.0.1 --allow-env"),
    true,
  );
  assertEquals(
    profileTest.includes(
      "--allow-env=HOME,XDG_DATA_HOME,APPDATA,LOCALAPPDATA,CODEX_HOME,OPENAI_API_KEY",
    ),
    true,
  );
  assertEquals(
    generalTest.includes("--ignore=src/catalogue/distribution-profile_test.ts"),
    true,
  );
  // The profile-test mirrors the profile run list 1:1 except the Windows
  // Docker path, which is inert (and shell-hostile) on unix runners but
  // stays granted for Windows production.
  const windowsDocker = "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe";
  for (const entry of denoConfig.permissions.desktop.run) {
    if (entry === windowsDocker) continue;
    assertEquals(
      profileTest.includes(entry),
      true,
      `profile run entry missing from catalogue:profile-test: ${entry}`,
    );
  }
});
