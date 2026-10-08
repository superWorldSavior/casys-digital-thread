import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";

function occurrences(source: string, value: string): number {
  return source.split(value).length - 1;
}

async function readProjectSources(): Promise<string> {
  const directory = new URL("./src/project/", import.meta.url);
  const sources: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    if (!entry.isFile || !/\.tsx?$/.test(entry.name)) continue;
    sources.push(await Deno.readTextFile(new URL(entry.name, directory)));
  }
  return sources.join("\n");
}

Deno.test("browser preview keeps one real Project Chat body without simulating native authority", async () => {
  const chat = await Deno.readTextFile(
    new URL("./src/thread/desktop-chat.tsx", import.meta.url),
  );
  const shell = await Deno.readTextFile(
    new URL("./src/thread/native-preview.tsx", import.meta.url),
  );
  const styles = await Deno.readTextFile(
    new URL("./src/styles/18-desktop-chat.css", import.meta.url),
  );

  assertEquals(chat.includes("if (!bindings) return null"), false);
  assertStringIncludes(
    shell,
    "useState(desktopChatRuntimeAvailable)",
  );
  assertEquals(shell.includes("setChatOpen(true)"), false);
  assertStringIncludes(
    shell,
    'data-chat-open={chatOpen ? "true" : "false"}',
  );
  assertStringIncludes(
    shell,
    'data-project-chat-panel={projectChatAvailable ? "true" : "false"}',
  );
  assertEquals(
    shell.indexOf("<DesktopChat"),
    shell.lastIndexOf("<DesktopChat"),
  );
  assertEquals(
    shell.indexOf("<DesktopChat") <
      shell.indexOf('id="native-preview-content"'),
    true,
  );

  assertStringIncludes(chat, "const panel = (");
  assertEquals(chat.includes("createPortal"), false);
  assertEquals(chat.includes("spatialHost"), false);
  assertEquals(chat.includes('data-chat-presentation="whiteboard"'), false);
  assertStringIncludes(
    chat,
    'data-chat-runtime={nativeChatAvailable ? "native" : "browser-preview"}',
  );
  assertStringIncludes(
    chat,
    "<BrowserPreviewUnavailable projectId={projectId} />",
  );
  assertStringIncludes(chat, "Browser preview · non-native");
  assertMatch(
    chat,
    /No\s+conversation is loaded and no command can be sent from this panel\./,
  );
  assertStringIncludes(chat, "disabled={!interactive}");
  assertStringIncludes(styles, ".desktop-chat-preview");
  assertStringIncludes(
    styles,
    ".desktop-chat .desktop-chat-rail-button:disabled",
  );

  assertEquals(occurrences(chat, 'content: "desktop-chat-panel"'), 1);
  assertEquals(occurrences(chat, 'title: "desktop-chat-title"'), 1);
  assertEquals(occurrences(chat, 'description: "desktop-chat-description"'), 1);
  assertEquals(occurrences(chat, 'id="desktop-chat-message"'), 1);
  assertEquals(occurrences(chat, "<ArkDialog.Content"), 1);
  assertMatch(
    chat,
    /<Conversation\s+key=\{selected\.id\}\s+conversation=\{selected\}/,
  );
  assertStringIncludes(chat, "key={conversation.id}");
  assertStringIncludes(chat, "key={message.id}");

  assertEquals(chat.includes("Casys agent console"), false);
  assertEquals(chat.includes("›_"), false);
  assertEquals(chat.includes("function ChatIcon"), false);
  assertEquals(chat.includes("function CloseIcon"), false);
  assertEquals(chat.includes("<button"), false);
  assertEquals(chat.includes("globalThis.bindings ="), false);
  assertEquals(chat.includes("casysChatSnapshot: async"), false);
  assertEquals(chat.includes("casysChatCommand: async"), false);
});

Deno.test("native Chat commands remain owned by the Desktop sibling, never Project or Workbench", async () => {
  const chat = await Deno.readTextFile(
    new URL("./src/thread/desktop-chat.tsx", import.meta.url),
  );
  const shell = await Deno.readTextFile(
    new URL("./src/thread/native-preview.tsx", import.meta.url),
  );
  const workbench = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );
  const projectSources = await readProjectSources();
  const projectedSurfaces = [shell, workbench, projectSources].join("\n");

  assertStringIncludes(chat, "if (bindings === undefined) return;");
  assertStringIncludes(chat, "if (!bindings) return undefined;");
  assertStringIncludes(chat, "await bindings.casysChatSnapshot");
  assertStringIncludes(chat, "await bindings.casysChatCommand(request)");
  assertStringIncludes(chat, "interactive={nativeChatAvailable}");
  assertStringIncludes(chat, "export function desktopChatRuntimeAvailable");

  for (
    const privilegedToken of [
      "globalThis.bindings",
      "DesktopBindings",
      "casysChatSnapshot",
      "casysChatCommand",
      "DesktopChatBindingCommandRequest",
      "DESKTOP_CHAT_PROTOCOL",
      "desktopBindings(",
      "presentation/desktop/chat/contracts.ts",
    ]
  ) {
    assertEquals(
      projectedSurfaces.includes(privilegedToken),
      false,
      `${privilegedToken} escaped the Desktop Chat sibling`,
    );
  }
  assertEquals(workbench.includes("DesktopChat"), false);
  assertEquals(projectSources.includes("<DesktopChat"), false);
  assertEquals(projectSources.includes("desktop-chat.tsx"), false);
});

Deno.test("Project Chat uses fixed panel, left sheet, compact modal, and fallback panel presentations", async () => {
  const chat = await Deno.readTextFile(
    new URL("./src/thread/desktop-chat.tsx", import.meta.url),
  );

  assertStringIncludes(chat, 'useMediaQuery("(max-width: 899px)")');
  assertStringIncludes(chat, 'useMediaQuery("(max-width: 767px)")');
  assertStringIncludes(chat, 'useMediaQuery("(min-width: 1200px)")');
  assertStringIncludes(
    chat,
    'const fixedPanelAvailable = typeof projectId === "string"',
  );
  assertStringIncludes(
    chat,
    "const fixedProjectPanel = fixedPanelAvailable && wideDesktop",
  );
  assertStringIncludes(
    chat,
    "const projectSheet = fixedPanelAvailable && !wideDesktop && !compactModal",
  );
  assertStringIncludes(chat, 'key={compactModal ? "modal" : "panel"}');
  assertStringIncludes(chat, "modal={compactModal}");
  assertStringIncludes(chat, "trapFocus={compactModal}");
  assertStringIncludes(chat, "preventScroll={compactModal}");
  assertStringIncludes(chat, "closeOnInteractOutside={compactModal}");
  assertStringIncludes(
    chat,
    "closeOnEscape={!fixedPanelAvailable || compactModal}",
  );
  for (
    const presentation of ["project-panel", "project-sheet", "modal", "panel"]
  ) {
    assertStringIncludes(chat, `"${presentation}"`);
  }
  assertStringIncludes(chat, "<ArkDialog.Backdrop");
  assertStringIncludes(chat, "<ArkDialog.Positioner");
  assertStringIncludes(chat, "<ArkDialog.CloseTrigger asChild>");
  assertMatch(
    chat,
    /aria-label=\{fixedPanelAvailable\s*\?\s*"Close project chat"\s*:\s*"Close chat"\}/,
  );
  assertStringIncludes(chat, "aria-pressed={!selectedId}");
  assertStringIncludes(chat, "aria-pressed={conversation.id === selectedId}");
});

Deno.test("responsive Chat restores launcher focus and limits manual Escape handling to fallback panels", async () => {
  const chat = await Deno.readTextFile(
    new URL("./src/thread/desktop-chat.tsx", import.meta.url),
  );

  assertStringIncludes(
    chat,
    "const triggerRef = useRef<HTMLButtonElement>(null)",
  );
  assertStringIncludes(
    chat,
    "previous.open && !open && !previous.compactModal",
  );
  assertStringIncludes(chat, "triggerRef.current?.focus()");
  assertStringIncludes(chat, "ref={triggerRef}");
  assertStringIncludes(chat, 'aria-controls="desktop-chat-panel"');
  assertStringIncludes(
    chat,
    "if (!open || fixedPanelAvailable || compactModal) return;",
  );
  assertStringIncludes(chat, 'if (event.key === "Escape") onOpenChange(false)');
  assertStringIncludes(chat, 'globalThis.addEventListener("keydown", dismiss)');
});
