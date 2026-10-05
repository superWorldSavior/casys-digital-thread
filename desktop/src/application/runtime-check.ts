import rawManifest from "../../component-manifest.json" with { type: "json" };
import denoConfig from "../../deno.json" with { type: "json" };
import {
  CONTROL_PLANE_PRODUCT_VERSION,
  CONTROL_PLANE_SERVER_VERSION,
} from "../control-plane/contracts.ts";
import {
  CHAT_HOST_COMPONENT_ID,
  CHAT_HOST_COMPONENT_VERSION,
} from "../../../src/presentation/desktop/chat/contracts.ts";
import { MACOS_EXTERNAL_URL_OPENER_NAME } from "../chat/external-url.ts";
import { PACKAGED_CHAT_HOST_NAME } from "../chat-host/path.ts";
import { validateComponentManifest } from "../host/mod.ts";
import { WORKBENCH_VERSION } from "../workbench/contracts.ts";
import {
  PACKAGED_CONTROL_PLANE_HELPER_NAME,
  PACKAGED_WORKBENCH_HELPER_NAME,
} from "./helper-path.ts";

const manifest = validateComponentManifest(rawManifest);
if (!manifest.ok) {
  throw new Error(
    `Cannot build Desktop: ${manifest.error.code}: ${manifest.error.message}`,
  );
}

const pinnedDeno = manifest.value.runtime.denoVersion;
const pinnedDesktop = manifest.value.runtime.desktopRuntimeVersion;
if (Deno.version.deno !== pinnedDeno || Deno.version.deno !== pinnedDesktop) {
  throw new Error(
    `Cannot build Desktop with Deno ${Deno.version.deno}; manifest pins Deno ${pinnedDeno} and Desktop ${pinnedDesktop}.`,
  );
}

if (denoConfig.version !== manifest.value.product.version) {
  throw new Error(
    `Cannot build Desktop: deno.json version ${denoConfig.version} does not match product manifest ${manifest.value.product.version}.`,
  );
}

if (
  denoConfig.desktop.app.identifier !== manifest.value.product.identifier ||
  denoConfig.desktop.backend !== manifest.value.runtime.backend
) {
  throw new Error(
    "Cannot build Desktop: package identifier or backend differs from the component manifest.",
  );
}

const controlPlane = manifest.value.components.find((component) =>
  component.id === "casys-control-plane"
);
const workbench = manifest.value.components.find((component) =>
  component.id === "workbench-projection"
);
const chatHost = manifest.value.components.find((component) =>
  component.id === CHAT_HOST_COMPONENT_ID
);
if (
  manifest.value.product.version !== CONTROL_PLANE_PRODUCT_VERSION ||
  controlPlane?.version !== CONTROL_PLANE_SERVER_VERSION ||
  controlPlane?.lifecycle !== "active" || controlPlane?.delivery !== "sidecar"
) {
  throw new Error(
    "Cannot build Desktop: Lot 3 requires the exact active packaged control-plane sidecar pin.",
  );
}
if (
  workbench?.version !== WORKBENCH_VERSION ||
  workbench.lifecycle !== "active" || workbench.delivery !== "sidecar"
) {
  throw new Error(
    "Cannot build Desktop: Lot 3 requires the exact active packaged Workbench sidecar pin.",
  );
}
if (
  chatHost?.version !== CHAT_HOST_COMPONENT_VERSION ||
  chatHost.lifecycle !== "active" || chatHost.delivery !== "sidecar"
) {
  throw new Error(
    "Cannot build Desktop: Lot 4 requires the exact active packaged Chat Host sidecar pin.",
  );
}

const expectedEnvironment = [
  "APPDATA",
  "CODEX_HOME",
  "HOME",
  "LOCALAPPDATA",
  "META_API_KEY",
  "MUSE_CODE_EXECUTABLE",
  "OPENAI_API_KEY",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
];
const actualEnvironment = [...denoConfig.permissions.desktop.env].sort();
const actualRun = [...denoConfig.permissions.desktop.run].sort();
const actualNet = [...denoConfig.permissions.desktop.net].sort();
const permissionKeys = Object.keys(denoConfig.permissions.desktop).sort();
// Closed desktop-host grant set. Docker paths are the #54 distribution grant
// exercised by the #56 app-managed tool runtime; full loopback is the #57
// ephemeral provider-port grant. Any change must update deno.json,
// deno-tasks_test.ts, this gate, and the README boundary together.
const expectedRun = [
  PACKAGED_CHAT_HOST_NAME,
  PACKAGED_CONTROL_PLANE_HELPER_NAME,
  PACKAGED_WORKBENCH_HELPER_NAME,
  MACOS_EXTERNAL_URL_OPENER_NAME,
  "docker",
  "/opt/homebrew/bin/docker",
  "/usr/local/bin/docker",
  "/usr/bin/docker",
  "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
].sort();
if (
  JSON.stringify(actualEnvironment) !== JSON.stringify(expectedEnvironment) ||
  JSON.stringify(actualRun) !== JSON.stringify(expectedRun) ||
  JSON.stringify(actualNet) !== JSON.stringify(["127.0.0.1"]) ||
  JSON.stringify(permissionKeys) !==
    JSON.stringify(["env", "import", "net", "read", "run", "write"]) ||
  denoConfig.permissions.desktop.import !== false ||
  denoConfig.permissions.desktop.read !== true ||
  denoConfig.permissions.desktop.write !== true
) {
  throw new Error(
    "Cannot build Desktop: runtime permissions must contain only named layout/agent env reads, the three packaged helper basenames, the external URL opener, the five managed docker paths, full loopback for ephemeral provider ports, host read/write, and denied remote imports.",
  );
}

if (
  Object.hasOwn(denoConfig.tasks, "dev") ||
  !denoConfig.tasks.package.includes("--deny-import")
) {
  throw new Error(
    "Cannot build Desktop: the packaged-only helper topology has no checkout dev task, and package must deny runtime remote imports explicitly.",
  );
}

console.log(
  `Pinned Deno Desktop runtime ${Deno.version.deno} and product ${denoConfig.version} verified.`,
);
