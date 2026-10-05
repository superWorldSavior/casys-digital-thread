import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import { canonicalJson, createMcpCallTap } from "./mcp-tap.ts";

function entry(tool: string, argsJson: string, at: number, resultJson = "{}") {
  return { tool, argsJson, resultJson, failed: false, at };
}

Deno.test("tap matches exactly one unconsumed record and consumes it", () => {
  const tap = createMcpCallTap();
  tap.record(entry("build123d_export", '{"a":1}', 1000, '{"v":1}'));
  const first = tap.takeMatch({
    tool: "build123d_export",
    argsJson: '{"a":1}',
    since: 0,
  });
  assert(first !== undefined && first.resultJson === '{"v":1}');
  assertEquals(
    tap.takeMatch({ tool: "build123d_export", argsJson: '{"a":1}', since: 0 }),
    undefined,
  );
});

Deno.test("tap skips on ambiguity without consuming", () => {
  const tap = createMcpCallTap();
  tap.record(entry("t", '{"a":1}', 1000));
  tap.record(entry("t", '{"a":1}', 1001));
  assertEquals(tap.takeMatch({ tool: "t", argsJson: '{"a":1}', since: 0 }), undefined);
  // Recency disambiguates: the stale record drops out, the fresh one matches.
  assert(tap.takeMatch({ tool: "t", argsJson: '{"a":1}', since: 1001 }) !== undefined);
});

Deno.test("tap skips stale records and unknown tools", () => {
  const tap = createMcpCallTap();
  tap.record(entry("t", '{"a":1}', 1000));
  assertEquals(
    tap.takeMatch({ tool: "t", argsJson: '{"a":1}', since: 1001 }),
    undefined,
  );
  assertEquals(
    tap.takeMatch({ tool: "other", argsJson: '{"a":1}', since: 0 }),
    undefined,
  );
  assertEquals(tap.takeMatch({ tool: "t", argsJson: '{"a":2}', since: 0 }), undefined);
  // Stale skip consumed nothing: a fresh query still matches.
  assert(tap.takeMatch({ tool: "t", argsJson: '{"a":1}', since: 0 }) !== undefined);
});

Deno.test("tap drops oldest entries past the bound", () => {
  const tap = createMcpCallTap(2);
  tap.record(entry("a", "{}", 1));
  tap.record(entry("b", "{}", 2));
  tap.record(entry("c", "{}", 3));
  assertEquals(tap.takeMatch({ tool: "a", argsJson: "{}", since: 0 }), undefined);
  assert(tap.takeMatch({ tool: "b", argsJson: "{}", since: 0 }) !== undefined);
});

Deno.test("canonical json ignores key order at any depth", () => {
  assertEquals(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
  assertEquals(canonicalJson([3, 2]), "[3,2]");
  assertEquals(canonicalJson("x"), '"x"');
});
