import {
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "jsr:@std/assert@1.0.14";
import rawManifest from "../../component-manifest.json" with { type: "json" };
import { renderDesktopShell } from "../renderer/mod.ts";
import { bootstrapDesktopShell, inspectDesktopBootstrap } from "./bootstrap.ts";

function bootstrap(
  overrides: Partial<Parameters<typeof bootstrapDesktopShell>[0]> = {},
) {
  return bootstrapDesktopShell({
    manifest: rawManifest,
    actualDenoVersion: rawManifest.runtime.denoVersion,
    actualDesktopRuntimeVersion: rawManifest.runtime.desktopRuntimeVersion,
    actualProductVersion: rawManifest.product.version,
    platform: "macOS",
    env: (name) => name === "HOME" ? "/Users/ada" : undefined,
    ...overrides,
  });
}

Deno.test("bootstrap produces an honest degraded shell without a lifecycle observation", () => {
  const model = bootstrap();
  assertEquals(model.status, "degraded");
  assertEquals(
    model.components.find((component) => component.id === "desktop-shell")?.state,
    "ready",
  );
  assertEquals(
    model.components.find((component) => component.id === "casys-control-plane")
      ?.state,
    "unavailable",
  );
  assertStringIncludes(model.summary, "unavailable");
});

Deno.test("bootstrap keeps runtime or application-support failure recovery-required", () => {
  assertEquals(
    bootstrap({ actualDenoVersion: "2.9.1" }).status,
    "recovery-required",
  );
  assertEquals(
    bootstrap({
      actualDenoVersion: "2.9.2",
      actualDesktopRuntimeVersion: "2.9.2",
    }).status,
    "recovery-required",
  );
  assertEquals(
    bootstrap({ env: () => undefined }).status,
    "recovery-required",
  );
});

Deno.test("bootstrap carries only the sanitized control-plane projection", () => {
  const model = bootstrap({
    controlPlane: {
      configuration: "verified",
      lifecycle: "owned-ready",
      controlPlaneVersion: rawManifest.components.find((component) =>
        component.id === "casys-control-plane"
      )?.version ?? undefined,
      providers: { state: "unavailable", total: 4, healthy: 0, drift: 4 },
      persistedEvidence: "unavailable",
    },
  });
  assertEquals(
    model.components.find((component) => component.id === "casys-control-plane")
      ?.state,
    "ready",
  );
  assertEquals(
    model.components.find((component) => component.id === "engineering-providers")
      ?.state,
    "unavailable",
  );
});

Deno.test("bootstrap facts gate the sidecar on exact host and component pins", () => {
  const facts = inspectDesktopBootstrap({
    manifest: rawManifest,
    actualDenoVersion: rawManifest.runtime.denoVersion,
    actualDesktopRuntimeVersion: rawManifest.runtime.desktopRuntimeVersion,
    actualProductVersion: rawManifest.product.version,
    platform: "macOS",
    env: (name) => name === "HOME" ? "/Users/ada" : undefined,
  });
  assertEquals(facts.controlPlaneLaunchable, true);
  assertEquals(facts.controlPlanePinValid, true);

  const wrongRuntime = inspectDesktopBootstrap({
    manifest: rawManifest,
    actualDenoVersion: "2.9.1",
    actualDesktopRuntimeVersion: rawManifest.runtime.desktopRuntimeVersion,
    actualProductVersion: rawManifest.product.version,
    platform: "macOS",
    env: (name) => name === "HOME" ? "/Users/ada" : undefined,
  });
  assertEquals(wrongRuntime.controlPlaneLaunchable, false);
  assertEquals(wrongRuntime.controlPlanePinValid, true);

  const wrongComponent = structuredClone(rawManifest);
  const controlPlane = wrongComponent.components.find((component) =>
    component.id === "casys-control-plane"
  );
  if (controlPlane === undefined) throw new Error("missing control-plane fixture");
  controlPlane.version = "0.2.1";
  const wrongPin = inspectDesktopBootstrap({
    manifest: wrongComponent,
    actualDenoVersion: rawManifest.runtime.denoVersion,
    actualDesktopRuntimeVersion: rawManifest.runtime.desktopRuntimeVersion,
    actualProductVersion: wrongComponent.product.version,
    platform: "macOS",
    env: (name) => name === "HOME" ? "/Users/ada" : undefined,
  });
  assertEquals(wrongPin.controlPlaneLaunchable, false);
  assertEquals(wrongPin.controlPlanePinValid, false);

  const closedLinuxLayout = inspectDesktopBootstrap({
    manifest: rawManifest,
    actualDenoVersion: rawManifest.runtime.denoVersion,
    actualDesktopRuntimeVersion: rawManifest.runtime.desktopRuntimeVersion,
    actualProductVersion: rawManifest.product.version,
    platform: "Linux",
    env: (name) =>
      name === "XDG_DATA_HOME"
        ? "/var/lib/casys-data"
        : name === "HOME"
        ? "/home/ada"
        : undefined,
  });
  assertEquals(closedLinuxLayout.controlPlaneLaunchable, true);
  assertEquals(closedLinuxLayout.workbenchLaunchable, true);
  assertEquals(closedLinuxLayout.packagedHelperPermissionsCompatible, true);

  const linuxHomeFallback = inspectDesktopBootstrap({
    manifest: rawManifest,
    actualDenoVersion: rawManifest.runtime.denoVersion,
    actualDesktopRuntimeVersion: rawManifest.runtime.desktopRuntimeVersion,
    actualProductVersion: rawManifest.product.version,
    platform: "Linux",
    env: (name) => name === "HOME" ? "/home/ada" : undefined,
  });
  assertEquals(linuxHomeFallback.layout.ok, true);
  assertEquals(linuxHomeFallback.packagedHelperPermissionsCompatible, false);
  assertEquals(linuxHomeFallback.controlPlaneLaunchable, false);
  assertEquals(linuxHomeFallback.workbenchLaunchable, false);

  const wrongProduct = structuredClone(rawManifest);
  wrongProduct.product.identifier = "io.example.other-product";
  const wrongProductFacts = inspectDesktopBootstrap({
    manifest: wrongProduct,
    actualDenoVersion: rawManifest.runtime.denoVersion,
    actualDesktopRuntimeVersion: rawManifest.runtime.desktopRuntimeVersion,
    actualProductVersion: wrongProduct.product.version,
    platform: "macOS",
    env: (name) => name === "HOME" ? "/Users/ada" : undefined,
  });
  assertEquals(wrongProductFacts.controlPlaneLaunchable, false);
  assertEquals(wrongProductFacts.controlPlanePinValid, false);
});

Deno.test("the real bootstrap-to-renderer seam does not expose application-support paths", () => {
  const html = renderDesktopShell(bootstrap());
  for (
    const forbidden of [
      "/Users/ada",
      "Application Support",
      "/thread",
      "/cas",
      "/experience",
    ]
  ) {
    assertFalse(html.includes(forbidden), `rendered shell leaked ${forbidden}`);
  }
});
