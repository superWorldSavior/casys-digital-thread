import { assertEquals } from "@std/assert";
import { hasDesktopChatBindings } from "./src/thread/desktop-chat-runtime.ts";

Deno.test("native callable WebView binding Proxy is detected without invoking it", () => {
  let calls = 0;
  // The actual pinned Laufey WebView bridge targets a function and exposes
  // callable property Proxies. It therefore has typeof === 'function'.
  const createProxy = (): unknown =>
    new Proxy(() => undefined, {
      get(_target, property) {
        if (
          property === "then" || property === "catch" ||
          property === "finally" || property === "constructor" ||
          property === Symbol.toStringTag
        ) return undefined;
        return createProxy();
      },
      apply() {
        calls += 1;
        return Promise.resolve();
      },
    });
  const namespace = createProxy();
  assertEquals(typeof namespace, "function");
  assertEquals(hasDesktopChatBindings(namespace), true);
  assertEquals(calls, 0);
});

Deno.test("browser preview and incomplete namespaces stay unavailable", () => {
  for (
    const candidate of [
      undefined,
      null,
      {},
      () => undefined,
      { casysChatSnapshot: () => undefined },
      { casysChatSnapshot: () => undefined, casysChatCommand: "missing" },
    ]
  ) assertEquals(hasDesktopChatBindings(candidate), false);
  assertEquals(
    hasDesktopChatBindings({
      casysChatSnapshot: () => undefined,
      casysChatCommand: () => undefined,
    }),
    true,
  );
});
