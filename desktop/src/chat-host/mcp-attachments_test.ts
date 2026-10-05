import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import type { McpRelay } from "./mcp-relay.ts";
import {
  McpAttachmentManager,
  parseMcpEnsurePayload,
  parseMcpReleasePayload,
} from "./mcp-attachments.ts";

interface Harness {
  manager: McpAttachmentManager;
  relays: McpRelay[];
  released: string[];
}

function harness(): Harness {
  const relays: McpRelay[] = [];
  const released: string[] = [];
  let relayCount = 0;
  const manager = new McpAttachmentManager({
    connectableIds: ["build123d"],
    startRelay: (upstreamMcpUrl) => {
      const relay: McpRelay & { upstream: string; closed: boolean } = {
        url: `http://127.0.0.1:50000/relay-${relayCount++}`,
        upstream: upstreamMcpUrl,
        closed: false,
        setUpstream: (next) => {
          relay.upstream = next;
        },
        close: () => {
          relay.closed = true;
          return Promise.resolve();
        },
      };
      relays.push(relay);
      return Promise.resolve(relay);
    },
    releaseRuntimes: (mcpId) => void released.push(mcpId),
  });
  return { manager, relays, released };
}

const FIRST = {
  mcpUrl: "http://127.0.0.1:45678/mcp",
  healthUrl: "http://127.0.0.1:45678/health",
};
const SECOND = {
  mcpUrl: "http://127.0.0.1:49999/mcp",
  healthUrl: "http://127.0.0.1:49999/health",
};

Deno.test("ensure creates one relay, then reuses it", async () => {
  const { manager, relays } = harness();
  await manager.ensure("build123d", FIRST);
  await manager.ensure("build123d", FIRST);
  assertEquals(relays.length, 1);
  assertEquals(manager.resolve("build123d"), FIRST);
});

Deno.test("ensure retargets the relay on binding change", async () => {
  const { manager, relays } = harness();
  await manager.ensure("build123d", FIRST);
  const url = manager.relayUrl("build123d");
  await manager.ensure("build123d", SECOND);
  assertEquals(relays.length, 1);
  assertEquals(manager.relayUrl("build123d"), url);
  assertEquals((relays[0] as unknown as { upstream: string }).upstream, SECOND.mcpUrl);
  assertEquals(manager.resolve("build123d"), SECOND);
});

Deno.test("ensure refuses unknown ids and non-loopback endpoints", async () => {
  const { manager } = harness();
  await assertRejects(() => manager.ensure("evil", FIRST), Error, "not connectable");
  await assertRejects(
    () =>
      manager.ensure("build123d", { ...FIRST, mcpUrl: "http://10.0.0.9:45678/mcp" }),
    TypeError,
    "loopback",
  );
  await assertRejects(
    () => manager.ensure("build123d", { ...FIRST, healthUrl: "" }),
    TypeError,
    "healthUrl",
  );
  assertEquals(manager.relayUrl("build123d"), undefined);
});

Deno.test("release closes the relay and drops runtimes; absent ids pass", async () => {
  const { manager, relays, released } = harness();
  assertEquals(await manager.release("build123d"), "absent");
  assertEquals(released, []);
  await manager.ensure("build123d", FIRST);
  assertEquals(await manager.release("build123d"), "released");
  assertEquals((relays[0] as unknown as { closed: boolean }).closed, true);
  assertEquals(released, ["build123d"]);
  assertEquals(manager.resolve("build123d"), undefined);
  assertEquals(manager.relayUrl("build123d"), undefined);
  await manager.ensure("build123d", SECOND);
  assertEquals(relays.length, 2);
});

Deno.test("IPC payload parsers reject malformed directives", () => {
  assertEquals(
    parseMcpEnsurePayload({ mcpId: "build123d", ...FIRST }),
    { mcpId: "build123d", ...FIRST },
  );
  assertEquals(parseMcpReleasePayload({ mcpId: "build123d" }), { mcpId: "build123d" });
  for (
    const bad of [undefined, null, [], "x", {}, { mcpId: "" }, {
      mcpId: "a".repeat(65),
    }]
  ) {
    let ensureThrew = false;
    try {
      parseMcpEnsurePayload(bad);
    } catch {
      ensureThrew = true;
    }
    assert(ensureThrew, `mcp.ensure accepted ${JSON.stringify(bad)}`);
    let releaseThrew = false;
    try {
      parseMcpReleasePayload(bad);
    } catch {
      releaseThrew = true;
    }
    assert(releaseThrew, `mcp.release accepted ${JSON.stringify(bad)}`);
  }
});
