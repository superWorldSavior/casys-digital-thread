import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import { createServer, type Server } from "node:http";
import { CHAT_HOST_COMPONENT_VERSION } from "../../../src/presentation/desktop/chat/contracts.ts";
import { canonicalJson, createMcpCallTap } from "../chat/mcp-tap.ts";
import { type McpObservedCall, startMcpRelay } from "./mcp-relay.ts";

interface CapturedUpstream {
  method?: string;
  headers: Record<string, string>;
  body: unknown;
}

async function withUpstream(
  handler: (captured: CapturedUpstream) =>
    | { status: number; body: unknown }
    | Promise<{ status: number; body: unknown }>,
  run: (url: string, captured: CapturedUpstream) => Promise<void>,
): Promise<void> {
  const captured: CapturedUpstream = { headers: {}, body: undefined };
  const server: Server = createServer((request, response) => {
    const chunks: Uint8Array[] = [];
    request.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    request.on("end", async () => {
      captured.method = request.method;
      captured.headers = {};
      for (const [key, value] of Object.entries(request.headers)) {
        if (typeof value === "string") captured.headers[key] = value;
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      captured.body = raw === "" ? undefined : JSON.parse(raw);
      const { status, body } = await handler(captured);
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  assert(typeof address === "object" && address !== null);
  try {
    await run(`http://127.0.0.1:${address.port}/mcp`, captured);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

Deno.test("relay injects the Casys convention and pipes the JSON response", async () => {
  await withUpstream(
    () => ({ status: 200, body: { jsonrpc: "2.0", id: 7, result: { ok: true } } }),
    async (upstreamUrl, captured) => {
      const relay = await startMcpRelay({ upstreamMcpUrl: upstreamUrl });
      try {
        assert(relay.url.startsWith("http://127.0.0.1:"));
        assert(relay.url.endsWith("/mcp"));
        const response = await fetch(relay.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 7,
            method: "tools/list",
            params: {},
          }),
        });
        assertEquals(response.status, 200);
        assertEquals(await response.json(), {
          jsonrpc: "2.0",
          id: 7,
          result: { ok: true },
        });
        assertEquals(captured.method, "POST");
        assertEquals(captured.headers["mcp-protocol-version"], "2026-07-28");
        assertEquals(captured.headers["mcp-method"], "tools/list");
        assertEquals(captured.headers["accept"], "application/json");
        const forwarded = captured.body as Record<string, unknown>;
        assertEquals(forwarded.method, "tools/list");
        assertEquals(
          (forwarded.params as Record<string, unknown>)._meta,
          {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": {
              name: "casys-desktop-chat-relay",
              version: CHAT_HOST_COMPONENT_VERSION,
            },
          },
        );
      } finally {
        await relay.close();
      }
    },
  );
});

async function scopedCall(url: string, id: number, tool = "build123d_execute") {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: tool, arguments: { source: "same source" } },
    }),
  });
  return { status: response.status, body: await response.json() };
}

Deno.test("scoped calls isolate concurrent sessions and identical calls on one listener", async () => {
  let sequence = 0;
  await withUpstream((captured) => ({
    status: 200,
    body: {
      jsonrpc: "2.0",
      id: (captured.body as { id: number }).id,
      result: { volume: ++sequence },
    },
  }), async (upstreamUrl) => {
    const relay = await startMcpRelay({ upstreamMcpUrl: upstreamUrl });
    try {
      const first = relay.createScope!();
      const second = relay.createScope!();
      assertEquals(new URL(first.url).port, new URL(second.url).port);
      assert(first.url !== second.url);
      const firstCalls: McpObservedCall[] = [], secondCalls: McpObservedCall[] = [];
      first.beginTurn((call) => firstCalls.push(call));
      second.beginTurn((call) => secondCalls.push(call));
      const [a, b] = await Promise.all([
        scopedCall(first.url, 1),
        scopedCall(second.url, 1),
      ]);
      assertEquals(firstCalls.map((call) => call.result), [a.body.result]);
      assertEquals(secondCalls.map((call) => call.result), [b.body.result]);
      const repeated = await scopedCall(first.url, 2);
      assertEquals(firstCalls[1].result, repeated.body.result);
      assert(firstCalls[0].callId !== firstCalls[1].callId);
      assertEquals(firstCalls[0].args, { source: "same source" });
      first.close();
      second.close();
    } finally {
      await relay.close();
    }
  });
});

Deno.test("large provider response streams intact without a second call or capture", async () => {
  const providerBody = {
    jsonrpc: "2.0",
    id: 1,
    result: { content: "x".repeat(8 * 1024 * 1024) },
  };
  const expected = JSON.stringify(providerBody);
  let executions = 0;
  await withUpstream(() => {
    executions++;
    return { status: 200, body: providerBody };
  }, async (upstreamUrl) => {
    const tap = createMcpCallTap();
    const relay = await startMcpRelay({ upstreamMcpUrl: upstreamUrl, tap });
    try {
      const scope = relay.createScope!();
      let observations = 0;
      scope.beginTurn(() => observations++);
      const response = await fetch(scope.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "build123d_execute", arguments: {} },
        }),
      });
      assertEquals(response.status, 200);
      assertEquals(await response.text(), expected);
      assertEquals(executions, 1);
      assertEquals(observations, 0);
      assertEquals(
        tap.takeMatch({ tool: "build123d_execute", argsJson: "{}", since: 0 }),
        undefined,
      );
      scope.close();
    } finally {
      await relay.close();
    }
  });
});

Deno.test("scoped endpoint denies execution outside its one turn and cannot be reused", async () => {
  await withUpstream((captured) => ({
    status: 200,
    body: { jsonrpc: "2.0", id: (captured.body as { id: number }).id, result: {} },
  }), async (upstreamUrl, captured) => {
    const relay = await startMcpRelay({ upstreamMcpUrl: upstreamUrl });
    try {
      const scope = relay.createScope!();
      assertEquals((await scopedCall(scope.url, 1)).status, 403);
      assertEquals(captured.method, undefined);
      scope.beginTurn(() => {});
      assertEquals((await scopedCall(scope.url, 2)).status, 200);
      scope.close();
      assertEquals((await scopedCall(scope.url, 3)).status, 404);
      let refused = false;
      try {
        scope.beginTurn(() => {});
      } catch {
        refused = true;
      }
      assert(refused);
    } finally {
      await relay.close();
    }
  });
});

Deno.test("late response from a revoked turn cannot update a new scoped turn", async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await withUpstream(async (captured) => {
    const id = (captured.body as { id: number }).id;
    if (id === 1) {
      started.resolve();
      await release.promise;
    }
    return { status: 200, body: { jsonrpc: "2.0", id, result: { volume: id } } };
  }, async (upstreamUrl) => {
    const relay = await startMcpRelay({ upstreamMcpUrl: upstreamUrl });
    try {
      const old = relay.createScope!();
      const oldCalls: McpObservedCall[] = [];
      old.beginTurn((call) => oldCalls.push(call));
      const pending = scopedCall(old.url, 1);
      await started.promise;
      old.close();
      const next = relay.createScope!();
      const newCalls: McpObservedCall[] = [];
      next.beginTurn((call) => newCalls.push(call));
      await scopedCall(next.url, 2);
      release.resolve();
      assertEquals((await pending).status, 200);
      assertEquals(oldCalls.length, 0);
      assertEquals(newCalls.map((call) => call.result), [{ volume: 2 }]);
      assertEquals((await scopedCall(old.url, 3)).status, 404);
      next.close();
    } finally {
      release.resolve();
      await relay.close();
    }
  });
});

Deno.test("retarget during an in-flight call invalidates only its observation", async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await withUpstream(async (captured) => {
    const id = (captured.body as { id: number }).id;
    started.resolve();
    await release.promise;
    return { status: 200, body: { jsonrpc: "2.0", id, result: { endpoint: "old" } } };
  }, async (oldUrl) => {
    await withUpstream((captured) => ({
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: (captured.body as { id: number }).id,
        result: { endpoint: "new" },
      },
    }), async (newUrl) => {
      const relay = await startMcpRelay({ upstreamMcpUrl: oldUrl });
      try {
        const scope = relay.createScope!();
        const calls: McpObservedCall[] = [];
        scope.beginTurn((call) => calls.push(call));
        const pending = scopedCall(scope.url, 1);
        await started.promise;
        relay.setUpstream(newUrl);
        release.resolve();
        assertEquals((await pending).body.result, { endpoint: "old" });
        assertEquals(calls.length, 0);
        await scopedCall(scope.url, 2);
        assertEquals(calls.map((call) => call.result), [{ endpoint: "new" }]);
        scope.close();
      } finally {
        release.resolve();
        await relay.close();
      }
    });
  });
});

Deno.test("scoped capture refuses mismatched and malformed RPC results and retains real errors", async () => {
  let nextBody: unknown;
  await withUpstream(() => ({ status: 200, body: nextBody }), async (upstreamUrl) => {
    const relay = await startMcpRelay({ upstreamMcpUrl: upstreamUrl });
    try {
      const scope = relay.createScope!();
      const calls: McpObservedCall[] = [];
      scope.beginTurn((call) => calls.push(call));
      for (
        const body of [
          { jsonrpc: "2.0", id: 99, result: { bad: true } },
          { id: 1, result: {} },
          { jsonrpc: "2.0", id: 1, result: {}, error: {} },
          [{ jsonrpc: "2.0", id: 1, result: {} }],
          { jsonrpc: "2.0", id: 1, result: { text: "x".repeat(262_144) } },
        ]
      ) {
        nextBody = body;
        await scopedCall(scope.url, 1);
        assertEquals(calls.length, 0);
      }
      nextBody = {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32602, message: "bad args" },
      };
      await scopedCall(scope.url, 1);
      assertEquals(calls[0].error, { code: -32602, message: "bad args" });
      nextBody = { jsonrpc: "2.0", id: 2, result: { isError: true, content: [] } };
      await scopedCall(scope.url, 2);
      assertEquals(calls[1].error, { isError: true, content: [] });
      scope.close();
    } finally {
      await relay.close();
    }
  });
});

Deno.test("an observation failure cannot fail or replay an acknowledged tool", async () => {
  let executed = 0;
  await withUpstream(() => ({
    status: 200,
    body: { jsonrpc: "2.0", id: 1, result: { executions: ++executed } },
  }), async (upstreamUrl) => {
    const relay = await startMcpRelay({ upstreamMcpUrl: upstreamUrl });
    try {
      const scope = relay.createScope!();
      scope.beginTurn(() => {
        throw new Error("capture callback unavailable");
      });
      const result = await scopedCall(scope.url, 1);
      assertEquals(result.status, 200);
      assertEquals(result.body.result, { executions: 1 });
      assertEquals(executed, 1);
      scope.close();
    } finally {
      await relay.close();
    }
  });
});

Deno.test("relay preserves incoming meta fields while Casys keys win", async () => {
  await withUpstream(
    () => ({ status: 200, body: { jsonrpc: "2.0", id: 1, result: {} } }),
    async (upstreamUrl, captured) => {
      const relay = await startMcpRelay({ upstreamMcpUrl: upstreamUrl });
      try {
        await fetch(relay.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              _meta: {
                "client/custom": "kept",
                "io.modelcontextprotocol/protocolVersion": "stale",
              },
            },
          }),
        });
        const meta =
          ((captured.body as Record<string, unknown>).params as Record<string, unknown>)
            ._meta as Record<string, unknown>;
        assertEquals(meta["client/custom"], "kept");
        assertEquals(meta["io.modelcontextprotocol/protocolVersion"], "2026-07-28");
      } finally {
        await relay.close();
      }
    },
  );
});

Deno.test("relay mirrors params.name into Mcp-Name for tools/call", async () => {
  await withUpstream(
    () => ({ status: 200, body: { jsonrpc: "2.0", id: 5, result: {} } }),
    async (upstreamUrl, captured) => {
      const relay = await startMcpRelay({ upstreamMcpUrl: upstreamUrl });
      try {
        await fetch(relay.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 5,
            method: "tools/call",
            params: { name: "build123d_execute", arguments: {} },
          }),
        });
        assertEquals(captured.headers["mcp-name"], "build123d_execute");
        assertEquals(captured.headers["mcp-method"], "tools/call");
        await fetch(relay.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 6,
            method: "tools/list",
            params: {},
          }),
        });
        assertEquals(captured.headers["mcp-name"], undefined);
      } finally {
        await relay.close();
      }
    },
  );
});

Deno.test("relay mirrors params.uri into Mcp-Name for resources/read", async () => {
  await withUpstream(
    () => ({ status: 200, body: { jsonrpc: "2.0", id: 8, result: {} } }),
    async (upstreamUrl, captured) => {
      const relay = await startMcpRelay({ upstreamMcpUrl: upstreamUrl });
      try {
        const response = await fetch(relay.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 8,
            method: "resources/read",
            params: { uri: "build123d://exports/part.stl" },
          }),
        });
        assertEquals(response.status, 200);
        assertEquals(captured.headers["mcp-name"], "build123d://exports/part.stl");
        assertEquals(captured.headers["mcp-method"], "resources/read");
      } finally {
        await relay.close();
      }
    },
  );
});

Deno.test("relay rejects batch payloads without contacting upstream", async () => {
  await withUpstream(
    () => ({ status: 200, body: {} }),
    async (upstreamUrl, captured) => {
      const relay = await startMcpRelay({ upstreamMcpUrl: upstreamUrl });
      try {
        const response = await fetch(relay.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify([
            { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
            { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
          ]),
        });
        assertEquals(response.status, 400);
        const body = await response.json() as Record<string, unknown>;
        assertEquals(body.id, null);
        assertEquals(
          (body.error as Record<string, unknown>).message,
          "MCP relay accepts a single JSON-RPC object",
        );
        assertEquals(captured.method, undefined);
      } finally {
        await relay.close();
      }
    },
  );
});

Deno.test("relay forwards notifications and pipes upstream errors", async () => {
  await withUpstream(
    () => ({
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: 9,
        error: { code: -32601, message: "unknown method" },
      },
    }),
    async (upstreamUrl) => {
      const relay = await startMcpRelay({ upstreamMcpUrl: upstreamUrl });
      try {
        const response = await fetch(relay.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/initialized",
            params: {},
          }),
        });
        assertEquals(response.status, 200);
        const body = await response.json() as Record<string, unknown>;
        assertEquals((body.error as Record<string, unknown>).code, -32601);
      } finally {
        await relay.close();
      }
    },
  );
});

Deno.test("relay refuses non-POST, foreign paths, and invalid bodies", async () => {
  await withUpstream(
    () => ({ status: 200, body: {} }),
    async (upstreamUrl) => {
      const relay = await startMcpRelay({ upstreamMcpUrl: upstreamUrl });
      try {
        const base = relay.url.replace(/\/mcp$/, "");
        assertEquals((await fetch(`${base}/other`, { method: "POST" })).status, 404);
        assertEquals((await fetch(relay.url, { method: "GET" })).status, 405);
        const invalid = await fetch(relay.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 3 }),
        });
        assertEquals(invalid.status, 400);
        assertEquals(
          ((await invalid.json()) as Record<string, unknown>).id,
          3,
        );
        const garbage = await fetch(relay.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "not json",
        });
        assertEquals(garbage.status, 400);
      } finally {
        await relay.close();
      }
    },
  );
});

Deno.test("relay reports an unreachable upstream as 502 JSON-RPC", async () => {
  const relay = await startMcpRelay({
    upstreamMcpUrl: "http://127.0.0.1:1/mcp",
    timeoutMs: 5_000,
  });
  try {
    const response = await fetch(relay.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 11,
        method: "tools/list",
        params: {},
      }),
    });
    assertEquals(response.status, 502);
    const body = await response.json() as Record<string, unknown>;
    assertEquals(body.id, 11);
    assertEquals((body.error as Record<string, unknown>).code, -32000);
  } finally {
    await relay.close();
  }
});

Deno.test("relay retargets its upstream without rebinding", async () => {
  const ok = () => ({
    status: 200,
    body: { jsonrpc: "2.0", id: 1, result: { ok: true } },
  });
  await withUpstream(ok, async (firstUrl, firstCaptured) => {
    await withUpstream(ok, async (secondUrl, secondCaptured) => {
      const relay = await startMcpRelay({ upstreamMcpUrl: firstUrl });
      try {
        const stableUrl = relay.url;
        await fetch(relay.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/list",
            params: {},
          }),
        });
        assertEquals(firstCaptured.method, "POST");
        assertEquals(secondCaptured.method, undefined);
        relay.setUpstream(secondUrl);
        assertEquals(relay.url, stableUrl);
        await fetch(relay.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/list",
            params: {},
          }),
        });
        assertEquals(secondCaptured.method, "POST");
        let thrown = "";
        try {
          relay.setUpstream("http://10.0.0.9:3014/mcp");
        } catch (error) {
          thrown = error instanceof Error ? error.message : String(error);
        }
        assert(thrown.includes("loopback"));
      } finally {
        await relay.close();
      }
    });
  });
});

Deno.test("relay tap records exact tools/call pairs only", async () => {
  await withUpstream(
    () => ({ status: 200, body: { jsonrpc: "2.0", id: 9, result: { volume: 1000 } } }),
    async (upstreamUrl) => {
      const tap = createMcpCallTap();
      const relay = await startMcpRelay({ upstreamMcpUrl: upstreamUrl, tap });
      try {
        assertEquals(relay.tap, tap);
        const post = (body: unknown) =>
          fetch(relay.url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
        await post({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
        await post({
          jsonrpc: "2.0",
          id: 9,
          method: "tools/call",
          params: { name: "build123d_export", arguments: { b: 1, a: 2 } },
        });
        const match = tap.takeMatch({
          tool: "build123d_export",
          argsJson: canonicalJson({ a: 2, b: 1 }),
          since: 0,
        });
        assert(match !== undefined);
        assertEquals(JSON.parse(match.resultJson), { volume: 1000 });
        assertEquals(match.failed, false);
        assertEquals(
          tap.takeMatch({ tool: "tools/list", argsJson: "{}", since: 0 }),
          undefined,
        );
      } finally {
        await relay.close();
      }
    },
  );
});

Deno.test("relay refuses a non-loopback upstream", async () => {
  let thrown = "";
  try {
    await startMcpRelay({ upstreamMcpUrl: "http://10.0.0.9:3014/mcp" });
  } catch (error) {
    thrown = error instanceof Error ? error.message : String(error);
  }
  assert(thrown.includes("loopback"));
});
