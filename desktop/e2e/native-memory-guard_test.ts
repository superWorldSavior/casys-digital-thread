import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  parseFootprintBytes,
  parseProcessRows,
  parseSwapUsedBytes,
  processTree,
} from "./native-memory-guard.ts";

Deno.test("native guard retains only the exact descendant tree", () => {
  const rows = parseProcessRows(`
101 1 100 Wed Sep 30 13:00:00 2026
102 101 200 Wed Sep 30 13:00:01 2026
103 102 300 Wed Sep 30 13:00:02 2026
201 1 900 Wed Sep 30 13:00:03 2026
  `);
  assertEquals(processTree(rows, 101), [
    {
      pid: 101,
      parentPid: 1,
      rssBytes: 102_400,
      startedAt: "Wed Sep 30 13:00:00 2026",
    },
    {
      pid: 102,
      parentPid: 101,
      rssBytes: 204_800,
      startedAt: "Wed Sep 30 13:00:01 2026",
    },
    {
      pid: 103,
      parentPid: 102,
      rssBytes: 307_200,
      startedAt: "Wed Sep 30 13:00:02 2026",
    },
  ]);
});

Deno.test("native guard reads single and process-tree footprint output", () => {
  assertEquals(
    parseFootprintBytes("app [42]: Footprint: 123456 B\n"),
    123_456,
  );
  assertEquals(
    parseFootprintBytes(
      "app [42]: Footprint: 123 B\nSummary Footprint: 456789 B\n",
    ),
    456_789,
  );
});

Deno.test("native guard reads macOS swap units", () => {
  assertEquals(
    parseSwapUsedBytes("total = 8192.00M  used = 1024.50M  free = 7167.50M"),
    1024.5 * 1024 ** 2,
  );
  assertEquals(
    parseSwapUsedBytes("total = 64.00G  used = 7.25G  free = 56.75G"),
    7.25 * 1024 ** 3,
  );
});
