import {
  compilePermissionFlagsAreClosed,
  CONTROL_PLANE_COMPILE_PERMISSION_FLAGS,
} from "../sidecar/compile-permissions.ts";
import { HELPER_STAGE_SOURCE } from "./helper-bundle.ts";

if (!compilePermissionFlagsAreClosed(CONTROL_PLANE_COMPILE_PERMISSION_FLAGS)) {
  throw new Error("Control-plane compile flags are not fail-closed.");
}

await Deno.mkdir("dist/helpers", { recursive: true });

const args = [
  "compile",
  "--config=../deno.json",
  "--no-prompt",
  `--output=${HELPER_STAGE_SOURCE}`,
  // Server startup builds the closed CalculiX qualification catalogue from
  // this code-owned fixture. Embed it so the helper never needs the checkout.
  "--include=../examples/bracket/bracket.step",
  // The read-only bootstrap catalogue validates these reviewed build recipes
  // at startup even though this helper cannot build or launch worker images.
  "--include=../images/build123d-microsandbox-worker/Dockerfile",
  "--include=../images/build123d-module-assembler-worker/Dockerfile",
  "--include=../images/calculix-microsandbox-worker/Dockerfile",
  "--include=../images/modelica-microsandbox-worker/Dockerfile",
  "--include=../images/ngspice-microsandbox-worker/Dockerfile",
  ...CONTROL_PLANE_COMPILE_PERMISSION_FLAGS,
  "src/sidecar/main.ts",
];

const compiled = await new Deno.Command("deno", {
  args,
  stdout: "inherit",
  stderr: "inherit",
}).output();

if (!compiled.success) {
  throw new Error(`deno compile failed with code ${compiled.code}.`);
}

console.log(`Compiled dedicated helper ${HELPER_STAGE_SOURCE}.`);
