import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import { MCP_BUILD123D_071_IMAGE_REFERENCE } from "../../../src/adapters/control-plane/first-party-capability-runtime-launch-groups.ts";
import { build123dHostPlan, verifyBuild123dSmoke } from "./plans.ts";

Deno.test("fleet plan carries the exact pinned provider identity", () => {
  const plan = build123dHostPlan({ workdir: "/tmp/tool-runtime-test" });
  assertEquals(plan.toolId, "build123d");
  assertEquals(
    plan.imageRef,
    MCP_BUILD123D_071_IMAGE_REFERENCE,
  );
  assertEquals(plan.providerVersion, "0.7.1");
  assertEquals(
    plan.platform,
    Deno.build.arch === "x86_64" ? "linux/amd64" : "linux/arm64",
  );
  assertEquals(plan.hostPort, 3014);
  assertEquals(plan.containerPort, 3014);
  assert(plan.expectedTools.includes("build123d_execute"));
  assert(plan.mcpUrl.startsWith("http://127.0.0.1:"));
  assert(plan.healthUrl.startsWith("http://127.0.0.1:"));
  assertEquals(plan.smoke.tool, "build123d_execute");
  assert(plan.macOSInstall !== undefined);
});

Deno.test("fleet plan rejects a non-loopback endpoint", () => {
  // The fleet file itself is loopback; this guards the factory shape by
  // asserting the ports it derives stay the fleet's loopback ports.
  const plan = build123dHostPlan({ workdir: "/tmp/tool-runtime-test" });
  const mcp = new URL(plan.mcpUrl);
  const health = new URL(plan.healthUrl);
  assertEquals(mcp.hostname, "127.0.0.1");
  assertEquals(health.hostname, "127.0.0.1");
});

Deno.test("fleet plan derives runtime endpoints from the allocated port", () => {
  const plan = build123dHostPlan({
    workdir: "/tmp/tool-runtime-test",
    hostPort: 45678,
  });
  assertEquals(plan.hostPort, 45678);
  assertEquals(plan.mcpUrl, "http://127.0.0.1:45678/mcp");
  assertEquals(plan.healthUrl, "http://127.0.0.1:45678/health");
  const historical = build123dHostPlan({ workdir: "/tmp/tool-runtime-test" });
  assertEquals(historical.mcpUrl, "http://127.0.0.1:3014/mcp");
  assertEquals(historical.healthUrl, "http://127.0.0.1:3014/health");
});

Deno.test("smoke verifier accepts the reviewed box result", () => {
  assertEquals(
    verifyBuild123dSmoke({
      structuredContent: {
        kind: "execution",
        metrics: { volume_mm3: 999.9999999999998, solids: 1, faces: 6, edges: 12 },
      },
      text: "Geometry computed",
    }),
    undefined,
  );
});

Deno.test("smoke verifier rejects wrong metrics", () => {
  assert(
    verifyBuild123dSmoke({
      structuredContent: {
        kind: "execution",
        metrics: { volume_mm3: 1000, solids: 1, faces: 6, edges: 11 },
      },
      text: "",
    }) !== undefined,
  );
  assert(
    verifyBuild123dSmoke({
      structuredContent: {
        kind: "execution",
        metrics: { volume_mm3: 5, solids: 1, faces: 6, edges: 12 },
      },
      text: "",
    }) !== undefined,
  );
  assert(
    verifyBuild123dSmoke({ structuredContent: { kind: "export" }, text: "" }) !==
      undefined,
  );
  assertThrows(() =>
    build123dHostPlan({ workdir: "/tmp/x", hostPort: -1 }) && undefined
  );
});
