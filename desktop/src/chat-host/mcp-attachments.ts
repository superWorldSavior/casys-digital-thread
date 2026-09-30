/**
 * Lazy per-MCP attachments for the Chat Host (#57, profiles #58).
 *
 * Relays start only when Desktop assigns a provider endpoint (on demand),
 * never for unused catalogue entries. A binding change retargets the
 * existing relay in place, so agent runtimes and their session stores
 * survive provider restarts. The relay is profile-independent and shared;
 * agent runtimes are created per profile on demand by the runtime factory
 * and dropped for every profile on release. Endpoints are host-assigned:
 * unknown ids and non-loopback URLs are refused.
 */
import type { McpRelay, McpRelayScope } from "./mcp-relay.ts";
import type { McpCallTap } from "../chat/mcp-tap.ts";

export interface McpAttachmentEndpoint {
  readonly mcpUrl: string;
  readonly healthUrl: string;
}

export interface McpAttachmentManagerOptions {
  readonly connectableIds: readonly string[];
  readonly startRelay: (upstreamMcpUrl: string) => Promise<McpRelay>;
  /** Drops every profiled runtime for an MCP after its relay closes. */
  readonly releaseRuntimes: (mcpId: string) => void;
}

export class McpAttachmentManager {
  readonly #connectable: ReadonlySet<string>;
  readonly #startRelay: (upstreamMcpUrl: string) => Promise<McpRelay>;
  readonly #releaseRuntimes: (mcpId: string) => void;
  readonly #endpoints = new Map<string, McpAttachmentEndpoint>();
  readonly #relays = new Map<string, McpRelay>();

  constructor(options: McpAttachmentManagerOptions) {
    this.#connectable = new Set(options.connectableIds);
    this.#startRelay = options.startRelay;
    this.#releaseRuntimes = options.releaseRuntimes;
  }

  resolve(mcpId: string): McpAttachmentEndpoint | undefined {
    return this.#endpoints.get(mcpId);
  }

  relayUrl(mcpId: string): string | undefined {
    return this.#relays.get(mcpId)?.url;
  }

  /** One revocable turn endpoint on the existing provider relay listener. */
  openScope(mcpId: string): McpRelayScope {
    this.#requireConnectable(mcpId);
    const relay = this.#relays.get(mcpId);
    if (relay?.createScope === undefined) {
      throw new Error("The MCP provider is not attached for result capture.");
    }
    return relay.createScope();
  }

  /** DEV-ONLY tap of one attached MCP relay, if the relay carries one. */
  relayTap(mcpId: string): McpCallTap | undefined {
    return this.#relays.get(mcpId)?.tap;
  }

  /**
   * Ensures the relay and runtime for one MCP at its assigned endpoint.
   * Idempotent: an unchanged endpoint reuses everything, a changed one
   * retargets the relay in place and keeps the runtime.
   */
  async ensure(mcpId: string, endpoint: McpAttachmentEndpoint): Promise<void> {
    this.#requireConnectable(mcpId);
    checkedEndpoint(endpoint);
    const relay = this.#relays.get(mcpId);
    if (relay === undefined) {
      const created = await this.#startRelay(endpoint.mcpUrl);
      this.#relays.set(mcpId, created);
      this.#endpoints.set(mcpId, endpoint);
      return;
    }
    relay.setUpstream(endpoint.mcpUrl);
    this.#endpoints.set(mcpId, endpoint);
  }

  /**
   * Closes the relay and drops every profiled runtime for one MCP.
   * Sessions persist on disk; the next ensure recreates the relay while
   * runtimes return on demand. Unknown or absent ids report absent
   * without failing.
   */
  async release(mcpId: string): Promise<"released" | "absent"> {
    const relay = this.#relays.get(mcpId);
    if (relay === undefined) return "absent";
    try {
      await relay.close();
    } finally {
      this.#relays.delete(mcpId);
      this.#endpoints.delete(mcpId);
      this.#releaseRuntimes(mcpId);
    }
    return "released";
  }

  async closeAll(): Promise<void> {
    const ids = [...this.#relays.keys()];
    await Promise.allSettled(ids.map((id) => this.release(id)));
  }

  #requireConnectable(mcpId: string): void {
    if (!this.#connectable.has(mcpId)) {
      throw new Error(`MCP "${mcpId}" is not connectable.`);
    }
  }
}

function checkedEndpoint(endpoint: McpAttachmentEndpoint): void {
  for (const key of ["mcpUrl", "healthUrl"] as const) {
    const value = endpoint[key];
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(`Attachment ${key} must be a non-empty URL.`);
    }
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new TypeError(`Attachment ${key} must be an absolute URL.`);
    }
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
    ) {
      throw new TypeError(`Attachment ${key} must be loopback HTTP(S).`);
    }
  }
}

export interface McpEnsureIpcPayload {
  readonly mcpId: string;
  readonly mcpUrl: string;
  readonly healthUrl: string;
}

export interface McpReleaseIpcPayload {
  readonly mcpId: string;
}

/** Strict IPC payload parsers, shared by the host entrypoint. */
export function parseMcpEnsurePayload(value: unknown): McpEnsureIpcPayload {
  const record = ipcRecord(value, "mcp.ensure");
  const mcpId = record.mcpId;
  const mcpUrl = record.mcpUrl;
  const healthUrl = record.healthUrl;
  if (typeof mcpId !== "string" || mcpId.trim() === "" || mcpId.length > 64) {
    throw new TypeError("mcp.ensure mcpId is invalid.");
  }
  if (typeof mcpUrl !== "string" || mcpUrl.length > 2048) {
    throw new TypeError("mcp.ensure mcpUrl is invalid.");
  }
  if (typeof healthUrl !== "string" || healthUrl.length > 2048) {
    throw new TypeError("mcp.ensure healthUrl is invalid.");
  }
  return { mcpId, mcpUrl, healthUrl };
}

export function parseMcpReleasePayload(value: unknown): McpReleaseIpcPayload {
  const record = ipcRecord(value, "mcp.release");
  const mcpId = record.mcpId;
  if (typeof mcpId !== "string" || mcpId.trim() === "" || mcpId.length > 64) {
    throw new TypeError("mcp.release mcpId is invalid.");
  }
  return { mcpId };
}

function ipcRecord(value: unknown, method: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${method} payload must be an object.`);
  }
  return value as Record<string, unknown>;
}
