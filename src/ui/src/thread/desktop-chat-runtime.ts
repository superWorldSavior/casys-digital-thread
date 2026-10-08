/** Recognize the native bridge without invoking an agent or a host command. */
export function hasDesktopChatBindings(candidate: unknown): boolean {
  // The pinned macOS WebView runtime injects a Proxy whose target is a
  // function. Object-only checks reject that actual native namespace.
  if (
    (typeof candidate !== "object" && typeof candidate !== "function") ||
    candidate === null
  ) return false;
  const namespace = candidate as Record<string, unknown>;
  return typeof namespace.casysChatSnapshot === "function" &&
    typeof namespace.casysChatCommand === "function";
}
