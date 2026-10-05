import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import {
  BUILTIN_AGENT_PROFILES,
  CODEX_AGENT_PROFILE_ID,
  DEFAULT_AGENT_PROFILE_ID,
  isAgentAuthFailure,
  LEGACY_AGENT_PROFILE_ID,
  MUSE_AGENT_PROFILE_ID,
  parseAgentProfilesFile,
  profileRuntimeKey,
  profileSessionKey,
  resolveDefaultProfileId,
} from "./agent-profiles.ts";

Deno.test("built-ins keep Muse default and Codex legacy", () => {
  assertEquals(DEFAULT_AGENT_PROFILE_ID, MUSE_AGENT_PROFILE_ID);
  assertEquals(LEGACY_AGENT_PROFILE_ID, CODEX_AGENT_PROFILE_ID);
  assertEquals(BUILTIN_AGENT_PROFILES.map((profile) => profile.id), [
    MUSE_AGENT_PROFILE_ID,
    CODEX_AGENT_PROFILE_ID,
  ]);
  for (const profile of BUILTIN_AGENT_PROFILES) {
    assert(profile.displayName.length > 0);
    assert(profile.authRecovery.includes(profile.displayName));
    assertEquals(profile.modelsExposed, false);
    assert(profile.builtin !== null);
    assertEquals(profile.launch, null);
  }
});

Deno.test("profiles file accepts one node-entry and one command profile", () => {
  const parsed = parseAgentProfilesFile({
    defaultProfileId: "my-muse",
    profiles: [
      {
        id: "my-muse",
        displayName: "My Muse",
        agentName: "my-muse",
        launch: { kind: "node-entry", entry: "/opt/agents/muse-acp/index.js" },
        authRecovery: "Run the vendor login, then retry.",
        modelsExposed: false,
      },
      {
        id: "cursor-lab",
        displayName: "Cursor lab",
        agentName: "cursor-lab",
        launch: { kind: "command", path: "/usr/local/bin/cursor-agent", args: ["acp"] },
        authRecovery: "Sign in Cursor, then retry.",
        modelsExposed: true,
      },
    ],
  });
  assertEquals(parsed.defaultProfileId, "my-muse");
  assertEquals(parsed.profiles.length, 2);
  assertEquals(parsed.profiles[0].builtin, null);
  assertEquals(parsed.profiles[1].launch, {
    kind: "command",
    path: "/usr/local/bin/cursor-agent",
    args: ["acp"],
  });
  assertEquals(parsed.profiles[1].modelsExposed, true);
});

Deno.test("profiles file defaults to no customs and no stored default", () => {
  assertEquals(parseAgentProfilesFile({}), { profiles: [] });
  assertEquals(parseAgentProfilesFile({ profiles: [] }), { profiles: [] });
});

Deno.test("profiles file rejects the whole file on any violation", () => {
  const bad: readonly unknown[] = [
    null,
    [],
    { profiles: {} },
    { profiles: new Array(9).fill({}) },
    // Duplicate ids.
    {
      profiles: [
        minimalProfile({ id: "dup" }),
        minimalProfile({ id: "dup" }),
      ],
    },
    // Built-in collision.
    { profiles: [minimalProfile({ id: MUSE_AGENT_PROFILE_ID })] },
    { profiles: [minimalProfile({ id: CODEX_AGENT_PROFILE_ID })] },
    // Bad id / agentName.
    { profiles: [minimalProfile({ id: "Has Caps" })] },
    { profiles: [minimalProfile({ id: "../escape" })] },
    { profiles: [minimalProfile({ agentName: "not a name!" })] },
    // Bad launch.
    { profiles: [minimalProfile({ launch: { kind: "shell", cmd: "x" } })] },
    {
      profiles: [
        minimalProfile({ launch: { kind: "node-entry", entry: "relative.js" } }),
      ],
    },
    {
      profiles: [minimalProfile({ launch: { kind: "command", path: "cursor-agent" } })],
    },
    {
      profiles: [
        minimalProfile({
          launch: { kind: "command", path: "/bin/x", args: new Array(33).fill("a") },
        }),
      ],
    },
    // Bad recovery / flags.
    { profiles: [minimalProfile({ authRecovery: "" })] },
    { profiles: [minimalProfile({ modelsExposed: "yes" })] },
    // Bad stored default.
    { profiles: [], defaultProfileId: "Not A Profile" },
  ];
  for (const value of bad) {
    assertThrows(
      () => parseAgentProfilesFile(value),
      TypeError,
      undefined,
      JSON.stringify(value)?.slice(0, 120),
    );
  }
});

Deno.test("profiles file accepts windows absolute launch paths", () => {
  const parsed = parseAgentProfilesFile({
    profiles: [
      minimalProfile({
        id: "win-agent",
        launch: { kind: "command", path: "C:\\Agents\\acp.exe", args: [] },
      }),
    ],
  });
  assertEquals(parsed.profiles[0].id, "win-agent");
});

Deno.test("default resolution fails safe to Muse", () => {
  const known = [MUSE_AGENT_PROFILE_ID, CODEX_AGENT_PROFILE_ID, "custom-x"];
  assertEquals(resolveDefaultProfileId("custom-x", known), "custom-x");
  assertEquals(
    resolveDefaultProfileId(CODEX_AGENT_PROFILE_ID, known),
    CODEX_AGENT_PROFILE_ID,
  );
  assertEquals(resolveDefaultProfileId("deleted-custom", known), MUSE_AGENT_PROFILE_ID);
  assertEquals(resolveDefaultProfileId(undefined, known), MUSE_AGENT_PROFILE_ID);
});

Deno.test("legacy profile keeps bare keys, others are namespaced", () => {
  const base = "casys-desktop-exclusive/standalone/conversation:1";
  assertEquals(profileSessionKey(base, CODEX_AGENT_PROFILE_ID), base);
  assertEquals(
    profileSessionKey(base, MUSE_AGENT_PROFILE_ID),
    `${base}/agent/${MUSE_AGENT_PROFILE_ID}`,
  );
  assertEquals(profileSessionKey(base, "custom-x"), `${base}/agent/custom-x`);
  assertEquals(
    profileRuntimeKey("standalone+mcp:build123d", CODEX_AGENT_PROFILE_ID),
    "standalone+mcp:build123d",
  );
  assertEquals(
    profileRuntimeKey("standalone", MUSE_AGENT_PROFILE_ID),
    `standalone@${MUSE_AGENT_PROFILE_ID}`,
  );
  assertEquals(profileRuntimeKey("project", "custom-x"), "project@custom-x");
});

Deno.test("auth failure matches the stable SDK prefix only", () => {
  assert(isAgentAuthFailure("Authentication required"));
  assert(isAgentAuthFailure("Authentication required: no valid session"));
  assert(
    isAgentAuthFailure(
      "Authentication required: Muse SDK turn failed: not logged in: run muse login",
    ),
  );
  assert(!isAgentAuthFailure("Authentication requiredish"));
  assert(!isAgentAuthFailure("authentication required"));
  assert(!isAgentAuthFailure("boom"));
  assert(!isAgentAuthFailure(""));
});

function minimalProfile(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "custom-x",
    displayName: "Custom X",
    agentName: "custom-x",
    launch: { kind: "node-entry", entry: "/opt/agents/x/index.js" },
    authRecovery: "Sign in, then retry.",
    modelsExposed: false,
    ...overrides,
  };
}
