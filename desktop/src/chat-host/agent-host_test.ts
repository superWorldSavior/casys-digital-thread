import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import { join } from "node:path";
import {
  builtinAdapterEntry,
  loadAgentProfilesFile,
  type MuseResolveDeps,
  parseMuseVersion,
  resolveMuseHost,
  saveAgentProfilesFile,
} from "./agent-host.ts";

Deno.test("builtin adapter entries resolve per kind", () => {
  assertEquals(
    builtinAdapterEntry("bundled-muse"),
    "adapter/node_modules/@bex-co/muse-code-acp/dist/index.js",
  );
  assertEquals(
    builtinAdapterEntry("bundled-codex"),
    "adapter/node_modules/@agentclientprotocol/codex-acp/dist/index.js",
  );
});

Deno.test("missing profiles file loads as built-ins only", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-agent-profiles-" });
  try {
    const loaded = await loadAgentProfilesFile(root);
    assert(loaded.ok);
    if (!loaded.ok) throw new Error("unreachable");
    assertEquals(loaded.file.profiles, []);
    assertEquals(loaded.file.defaultProfileId, undefined);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("malformed or invalid profiles file fails closed", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-agent-profiles-" });
  try {
    await Deno.writeTextFile(join(root, "agent-profiles.json"), "{nope");
    const malformed = await loadAgentProfilesFile(root);
    assert(!malformed.ok);
    await Deno.writeTextFile(
      join(root, "agent-profiles.json"),
      JSON.stringify({ profiles: [{ id: "x" }] }),
    );
    const invalid = await loadAgentProfilesFile(root);
    assert(!invalid.ok);
    if (invalid.ok) throw new Error("unreachable");
    assert(invalid.error.length > 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("save round-trips customs and default, then reloads", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-agent-profiles-" });
  try {
    await saveAgentProfilesFile(root, {
      defaultProfileId: "lab",
      profiles: [
        {
          id: "lab",
          displayName: "Lab",
          agentName: "lab",
          builtin: null,
          launch: {
            kind: "command",
            path: "/usr/local/bin/lab-acp",
            args: ["--stdio"],
          },
          authRecovery: "Sign in, then retry.",
          modelsExposed: false,
        },
      ],
    });
    const loaded = await loadAgentProfilesFile(root);
    assert(loaded.ok);
    if (!loaded.ok) throw new Error("unreachable");
    assertEquals(loaded.file.defaultProfileId, "lab");
    assertEquals(loaded.file.profiles.length, 1);
    assertEquals(loaded.file.profiles[0].launch, {
      kind: "command",
      path: "/usr/local/bin/lab-acp",
      args: ["--stdio"],
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("muse version parses the vendor banner only", () => {
  assertEquals(parseMuseVersion("Muse Code 1.4.0 (1.4.0-R4302.1)\n"), "1.4.0");
  assertEquals(parseMuseVersion("Muse Code 1.1.1-R2514.1"), "1.1.1-R2514.1");
  assertEquals(parseMuseVersion("muse 1.4.0"), undefined);
  assertEquals(parseMuseVersion(""), undefined);
});

Deno.test("muse resolution honors the explicit override", async () => {
  const deps = stubDeps({
    executables: new Set(["/custom/muse"]),
    versions: { "/custom/muse": "9.9.9" },
  });
  const resolved = await resolveMuseHost(
    { MUSE_CODE_EXECUTABLE: "/custom/muse", HOME: "/home/u", PATH: "" },
    deps,
  );
  assert(resolved.ok);
  if (!resolved.ok) throw new Error("unreachable");
  assertEquals(resolved.host, { path: "/custom/muse", version: "9.9.9" });
});

Deno.test("muse resolution rejects a non-executable override", async () => {
  const deps = stubDeps({ executables: new Set(["/home/u/.local/bin/muse"]) });
  const resolved = await resolveMuseHost(
    { MUSE_CODE_EXECUTABLE: "/custom/missing", HOME: "/home/u", PATH: "" },
    deps,
  );
  assert(!resolved.ok);
  if (resolved.ok) throw new Error("unreachable");
  assert(resolved.reason.includes("MUSE_CODE_EXECUTABLE"));
});

Deno.test("muse resolution falls back to local bin then PATH", async () => {
  const local: MuseResolveDeps = stubDeps({
    executables: new Set(["/home/u/.local/bin/muse"]),
    versions: { "/home/u/.local/bin/muse": "1.4.0" },
  });
  const viaLocal = await resolveMuseHost({ HOME: "/home/u", PATH: "" }, local);
  assert(viaLocal.ok);
  const pathDeps = stubDeps({
    executables: new Set(["/opt/bin/muse"]),
    versions: { "/opt/bin/muse": "1.2.1" },
  });
  const viaPath = await resolveMuseHost(
    { HOME: "/home/u", PATH: "/opt/bin:/usr/bin" },
    pathDeps,
  );
  assert(viaPath.ok);
  if (!viaPath.ok) throw new Error("unreachable");
  assertEquals(viaPath.host, { path: "/opt/bin/muse", version: "1.2.1" });
});

Deno.test("muse resolution reports missing or versionless honestly", async () => {
  const missing = await resolveMuseHost(
    { HOME: "/home/u", PATH: "/usr/bin" },
    stubDeps({ executables: new Set() }),
  );
  assert(!missing.ok);
  const versionless = await resolveMuseHost(
    { HOME: "/home/u", PATH: "/opt/bin" },
    stubDeps({ executables: new Set(["/opt/bin/muse"]), versions: {} }),
  );
  assert(!versionless.ok);
  if (versionless.ok) throw new Error("unreachable");
  assert(versionless.reason.includes("did not report a version"));
});

function stubDeps(options: {
  executables: Set<string>;
  versions?: Record<string, string>;
}): MuseResolveDeps {
  return {
    isExecutable: (path: string) => Promise.resolve(options.executables.has(path)),
    readVersion: (path: string) => Promise.resolve(options.versions?.[path]),
    pathSeparator: ":",
  };
}
