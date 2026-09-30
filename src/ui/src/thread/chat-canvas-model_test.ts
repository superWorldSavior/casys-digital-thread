import { assertEquals } from "@std/assert";
import type {
  ChatCanvasLayoutDto,
  ChatToolViewerDto,
} from "../../../presentation/desktop/chat/contracts.ts";
import {
  addCanvasGroup,
  addCanvasNote,
  applyNodeGroup,
  applyNodeMove,
  applyNodeResize,
  applyNodeTitle,
  applyNoteDone,
  applyNoteText,
  autoPlace,
  nodeDisplayTitle,
  placeViewerNode,
  removeCanvasNode,
  resolveCanvasNodes,
} from "./chat-canvas-model.ts";

function viewer(toolCallId: string): ChatToolViewerDto {
  return {
    toolCallId,
    messageId: "message-1",
    tool: "build123d_export",
    appUri: "ui://mcp-build123d/results-viewer",
  };
}

function layout(): ChatCanvasLayoutDto {
  return {
    version: 1,
    nodes: [
      {
        id: "node-viewer",
        kind: "viewer",
        x: 10,
        y: 20,
        z: 1,
        toolCallId: "tool-1",
      },
      { id: "node-note", kind: "note", x: 30, y: 40, z: 2, text: "hello" },
    ],
    groups: [{ id: "group-1", title: "Review" }],
  };
}

Deno.test("canvas resolution splits placed nodes from unplaced viewers", () => {
  const resolved = resolveCanvasNodes(layout(), [
    viewer("tool-1"),
    viewer("tool-2"),
  ]);
  assertEquals(resolved.placed.map((entry) => entry.node.id), [
    "node-viewer",
    "node-note",
  ]);
  assertEquals(resolved.placed[0].viewer?.toolCallId, "tool-1");
  assertEquals(resolved.unplaced.map((entry) => entry.toolCallId), ["tool-2"]);
  assertEquals(resolved.groups.length, 1);
});

Deno.test("canvas resolution drops viewer nodes without a live result", () => {
  const resolved = resolveCanvasNodes(layout(), []);
  assertEquals(resolved.placed.map((entry) => entry.node.id), ["node-note"]);
  assertEquals(resolved.unplaced, []);
});

Deno.test("canvas auto placement cascades deterministically", () => {
  assertEquals(autoPlace(0), { x: 24, y: 24 });
  assertEquals(autoPlace(1), { x: 72, y: 72 });
  assertEquals(autoPlace(8), { x: 24, y: 24 });
});

Deno.test("canvas node edits move, resize, group, and remove", () => {
  const moved = applyNodeMove(layout(), "node-note", 100, 200);
  assertEquals(moved.nodes[1]?.x, 100);
  assertEquals(moved.nodes[1]?.y, 200);
  assertEquals(applyNodeMove(layout(), "missing", 1, 1), layout());
  const resized = applyNodeResize(layout(), "node-note", 320, 180);
  assertEquals(resized.nodes[1]?.width, 320);
  assertEquals(resized.nodes[1]?.height, 180);
  assertEquals(applyNodeResize(layout(), "node-note", 0, 10), layout());
  const grouped = applyNodeGroup(layout(), "node-note", "group-1");
  assertEquals(grouped.nodes[1]?.groupId, "group-1");
  assertEquals(applyNodeGroup(layout(), "node-note", "missing"), layout());
  const ungrouped = applyNodeGroup(grouped, "node-note", undefined);
  assertEquals(ungrouped.nodes[1]?.groupId, undefined);
  const removed = removeCanvasNode(layout(), "node-note");
  assertEquals(removed.nodes.map((node) => node.id), ["node-viewer"]);
  assertEquals(removeCanvasNode(layout(), "missing"), layout());
});

Deno.test("canvas titles, text, and done toggle per kind", () => {
  const titled = applyNodeTitle(layout(), "node-viewer", "First export");
  assertEquals(titled.nodes[0]?.title, "First export");
  assertEquals(nodeDisplayTitle(titled.nodes[0]!, "build123d_export"), "First export");
  const untitled = applyNodeTitle(titled, "node-viewer", undefined);
  assertEquals(untitled.nodes[0]?.title, undefined);
  assertEquals(
    nodeDisplayTitle(untitled.nodes[0]!, "build123d_export"),
    "build123d_export",
  );
  assertEquals(nodeDisplayTitle({ kind: "note" }), "Note");
  assertEquals(applyNodeTitle(layout(), "missing", "x"), layout());
  const edited = applyNoteText(layout(), "node-note", "updated");
  assertEquals(edited.nodes[1]?.text, "updated");
  assertEquals(applyNoteText(layout(), "node-note", ""), layout());
  assertEquals(applyNoteText(layout(), "node-viewer", "x"), layout());
  const done = applyNoteDone(layout(), "node-note", true);
  assertEquals(done.nodes[1]?.done, true);
  const undone = applyNoteDone(done, "node-note", false);
  assertEquals(undone.nodes[1]?.done, undefined);
  assertEquals(applyNoteDone(layout(), "node-viewer", true), layout());
});

Deno.test("canvas additions guard duplicates and order z", () => {
  const noted = addCanvasNote(layout(), { id: "n", text: "t", x: 1, y: 1 });
  assertEquals(noted.nodes.length, 3);
  assertEquals(noted.nodes[2]?.z, 3);
  assertEquals(
    addCanvasNote(layout(), { id: "node-note", text: "t", x: 1, y: 1 }),
    layout(),
  );
  const grouped = addCanvasGroup(layout(), { id: "g2", title: "Later" });
  assertEquals(grouped.groups.length, 2);
  assertEquals(
    addCanvasGroup(layout(), { id: "group-1", title: "x" }),
    layout(),
  );
  const placed = placeViewerNode(layout(), { id: "n2", toolCallId: "tool-9" });
  assertEquals(placed.nodes.length, 3);
  assertEquals(placed.nodes[2]?.x, 120);
  assertEquals(
    placeViewerNode(layout(), { id: "n2", toolCallId: "tool-1" }),
    layout(),
  );
});
