import { assertEquals, assertThrows } from "@std/assert";
import {
  DESKTOP_CATALOGUE_PROTOCOL,
  parseCatalogueCommandRequest,
  parseCatalogueCommandResponse,
  parseCatalogueSnapshotDto,
} from "./contracts.ts";

function entry(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "build123d",
    displayName: "Build123d",
    tagline: "Parametric CAD execution, exact geometry metrics and export",
    description: "Run parametric CAD scripts and get exact measurements.",
    tools: [{
      name: "build123d_execute",
      summary: "Execute a script and return exact geometry metrics.",
      inputs: "A script assigning its final shape to `result`.",
      results: "Volume, area, center of mass, bounding box, counts.",
    }],
    examples: [{ title: "Measure a box", summary: "Box(10, 10, 10) reads 1,000 mm³." }],
    viewers: [{
      uri: "ui://mcp-build123d/results-viewer",
      label: "Geometry results",
      hostSupport: "planned",
      note: "Host rendering lands in #50.",
    }],
    distribution: {
      version: "0.7.0",
      release: "v0.7.0",
      revision: "b831c16019e4e09e66c4e5567f9ee70310fb8785",
    },
    platforms: [{
      id: "macOS/arm64",
      status: "measured",
      note: "Reuse path measured end to end.",
    }],
    guidance: "Use Prepare, then enable the tool in the chat.",
    availability: {
      prepared: true,
      running: true,
      capable: true,
      lastProbeAt: "2026-09-28T00:00:00.000Z",
      detail: "Prepared and capable.",
      engine: "ready",
      runtime: "running",
    },
    isDefault: false,
    ...overrides,
  };
}

function snapshotWith(
  ...entries: ReadonlyArray<Record<string, unknown>>
): Record<string, unknown> {
  return {
    protocol: DESKTOP_CATALOGUE_PROTOCOL,
    entries: [...entries],
  };
}

Deno.test("catalogue snapshot accepts a valid entry", () => {
  const parsed = parseCatalogueSnapshotDto(snapshotWith(entry()));
  assertEquals(parsed.entries.length, 1);
  assertEquals(parsed.entries[0]?.id, "build123d");
  assertEquals(parsed.entries[0]?.availability.capable, true);
});

Deno.test("catalogue snapshot rejects a viewer uri outside ui://", () => {
  assertThrows(
    () =>
      parseCatalogueSnapshotDto(snapshotWith(entry({
        viewers: [{
          uri: "https://example.invalid/viewer",
          label: "Geometry results",
          hostSupport: "planned",
        }],
      }))),
    TypeError,
    "catalogue viewer uri must be a ui:// resource",
  );
});

Deno.test("catalogue snapshot rejects invalid enums", () => {
  assertThrows(
    () =>
      parseCatalogueSnapshotDto(snapshotWith(entry({
        viewers: [{
          uri: "ui://mcp-build123d/results-viewer",
          label: "Geometry results",
          hostSupport: "eventually",
        }],
      }))),
    TypeError,
    "catalogue viewer support is invalid",
  );
  assertThrows(
    () =>
      parseCatalogueSnapshotDto(snapshotWith(entry({
        platforms: [{ id: "macOS/arm64", status: "maybe", note: "x" }],
      }))),
    TypeError,
    "catalogue platform status is invalid",
  );
  assertThrows(
    () =>
      parseCatalogueSnapshotDto(snapshotWith(entry({
        availability: {
          prepared: false,
          running: false,
          capable: false,
          lastProbeAt: null,
          detail: "Not prepared.",
          engine: "warming-up",
        },
      }))),
    TypeError,
    "catalogue engine status is invalid",
  );
});

Deno.test("catalogue snapshot rejects oversize copy", () => {
  assertThrows(
    () =>
      parseCatalogueSnapshotDto(
        snapshotWith(entry({ description: "x".repeat(2_001) })),
      ),
    TypeError,
    "catalogue entry description must be non-empty text of at most 2000 characters",
  );
});

Deno.test("catalogue commands parse the four supported shapes", () => {
  const prepare = parseCatalogueCommandRequest({
    protocol: DESKTOP_CATALOGUE_PROTOCOL,
    requestId: "r1",
    command: "catalogue.prepare",
    entryId: "build123d",
  });
  assertEquals(prepare.command, "catalogue.prepare");
  const probe = parseCatalogueCommandRequest({
    protocol: DESKTOP_CATALOGUE_PROTOCOL,
    requestId: "r2",
    command: "catalogue.probe",
    entryId: "build123d",
  });
  assertEquals(probe.command, "catalogue.probe");
  const get = parseCatalogueCommandRequest({
    protocol: DESKTOP_CATALOGUE_PROTOCOL,
    requestId: "r3",
    command: "catalogue.defaults.get",
  });
  assertEquals(get.command, "catalogue.defaults.get");
  const set = parseCatalogueCommandRequest({
    protocol: DESKTOP_CATALOGUE_PROTOCOL,
    requestId: "r4",
    command: "catalogue.defaults.set",
    ids: ["build123d"],
  });
  if (set.command !== "catalogue.defaults.set") throw new Error("wrong command");
  assertEquals(set.ids, ["build123d"]);
  assertThrows(
    () =>
      parseCatalogueCommandRequest({
        protocol: DESKTOP_CATALOGUE_PROTOCOL,
        requestId: "r5",
        command: "catalogue.launch",
        entryId: "build123d",
      }),
    TypeError,
    "catalogue command is not supported",
  );
  assertThrows(
    () =>
      parseCatalogueCommandRequest({
        protocol: DESKTOP_CATALOGUE_PROTOCOL,
        requestId: "r6",
        command: "catalogue.defaults.set",
        ids: Array.from({ length: 9 }, (_, i) => `mcp-${i}`),
      }),
    TypeError,
    "catalogue default ids are invalid",
  );
});

Deno.test("catalogue rejects update commands: no update check for chat tools (#52)", () => {
  for (const command of ["catalogue.update", "catalogue.update-check"]) {
    assertThrows(
      () =>
        parseCatalogueCommandRequest({
          protocol: DESKTOP_CATALOGUE_PROTOCOL,
          requestId: "no-update",
          command,
          entryId: "build123d",
        }),
      TypeError,
      "catalogue command is not supported",
    );
  }
});

Deno.test("catalogue responses carry outcomes, details, and default ids", () => {
  const prepared = parseCatalogueCommandResponse({
    protocol: DESKTOP_CATALOGUE_PROTOCOL,
    requestId: "r1",
    ok: true,
    outcome: "prepared",
    detail: "Prepared and running.",
  });
  assertEquals(prepared.outcome, "prepared");
  const needsAction = parseCatalogueCommandResponse({
    protocol: DESKTOP_CATALOGUE_PROTOCOL,
    requestId: "r2",
    ok: true,
    outcome: "needs-action",
    detail: "Engine is stopped.",
    recovery: "Start Docker Desktop explicitly, then retry.",
  });
  assertEquals(needsAction.recovery, "Start Docker Desktop explicitly, then retry.");
  const failed = parseCatalogueCommandResponse({
    protocol: DESKTOP_CATALOGUE_PROTOCOL,
    requestId: "r3",
    ok: false,
    error: "Unknown catalogue entry.",
  });
  assertEquals(failed.ok, false);
  const defaults = parseCatalogueCommandResponse({
    protocol: DESKTOP_CATALOGUE_PROTOCOL,
    requestId: "r4",
    ok: true,
    ids: ["build123d"],
  });
  assertEquals(defaults.ids, ["build123d"]);
  assertThrows(
    () =>
      parseCatalogueCommandResponse({
        protocol: DESKTOP_CATALOGUE_PROTOCOL,
        requestId: "r5",
        ok: true,
        outcome: "eventually",
      }),
    TypeError,
    "catalogue response outcome is invalid",
  );
});
