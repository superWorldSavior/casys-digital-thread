/**
 * Host-owned agent runtime factory (#58). Implements AgentProfileHost for
 * the chat host: built-ins plus the user file, persisted default, cached
 * availability, and one cached ACP adapter per profile + MCP set.
 * Bundled into the Node chat host: only `node:` imports, no `Deno.*`.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type AgentProfileDefinition,
  type AgentProfileHost,
  type AgentProfileStatus,
  BUILTIN_AGENT_PROFILES,
  CODEX_AGENT_PROFILE_ID,
  MUSE_AGENT_PROFILE_ID,
  profileRuntimeKey,
  resolveDefaultProfileId,
} from "../chat/agent-profiles.ts";
import { type ChatRuntimeAdapter, chatRuntimeKey } from "../chat/runtime-port.ts";
import {
  builtinAdapterEntry,
  loadAgentProfilesFile,
  type MuseHostStatus,
  type MuseResolveDeps,
  resolveMuseHost,
  saveAgentProfilesFile,
} from "./agent-host.ts";
import type { PinnedMcpServer, PinnedRuntimeOptions } from "./runtime-adapter.ts";

export interface AgentRuntimeFactoryOptions {
  readonly dataRoot: string;
  readonly workspaceRoot: string;
  /** Packaged runtime root holding the bundled adapter entries. */
  readonly runtimeRoot: string;
  readonly nodeExecutable: string;
  readonly acpxRuntimeUrl: string;
  /** Pinned Codex binary version for status reporting. */
  readonly codexVersion: string;
  /** An absent optional Codex artifact disables only that profile. */
  readonly codexMissingReason?: string;
  /** Fixed Digital Thread relay URL for the project runtime. */
  readonly projectRelayUrl: string;
  readonly appEnv: Readonly<Record<string, string | undefined>>;
  readonly mcpDisplayName: (mcpId: string) => string;
  /** Relay URL for an attached MCP, or undefined when unattached. */
  readonly relayUrl: (mcpId: string) => string | undefined;
  readonly createAdapter: (
    options: PinnedRuntimeOptions,
  ) => Promise<ChatRuntimeAdapter>;
  readonly museDeps?: MuseResolveDeps;
}

export class AgentRuntimeFactory implements AgentProfileHost {
  readonly #options: AgentRuntimeFactoryOptions;
  #customs: readonly AgentProfileDefinition[];
  #storedDefault: string | undefined;
  #museStatus: MuseHostStatus;
  #customAvailability = new Map<string, { available: boolean; reason?: string }>();
  readonly #adapters = new Map<string, ChatRuntimeAdapter>();
  readonly #inflight = new Map<string, Promise<ChatRuntimeAdapter>>();

  private constructor(
    options: AgentRuntimeFactoryOptions,
    customs: readonly AgentProfileDefinition[],
    storedDefault: string | undefined,
    museStatus: MuseHostStatus,
  ) {
    this.#options = options;
    this.#customs = customs;
    this.#storedDefault = storedDefault;
    this.#museStatus = museStatus;
    this.#refreshCustomAvailability();
  }

  static async create(
    options: AgentRuntimeFactoryOptions,
  ): Promise<{ factory: AgentRuntimeFactory; profilesError?: string }> {
    const loaded = await loadAgentProfilesFile(options.dataRoot);
    const customs = loaded.ok ? loaded.file.profiles : [];
    const storedDefault = loaded.ok ? loaded.file.defaultProfileId : undefined;
    const museStatus = await resolveMuseHost(options.appEnv, options.museDeps);
    return {
      factory: new AgentRuntimeFactory(options, customs, storedDefault, museStatus),
      ...(loaded.ok ? {} : { profilesError: loaded.error }),
    };
  }

  get definitions(): readonly AgentProfileDefinition[] {
    return Object.freeze([...BUILTIN_AGENT_PROFILES, ...this.#customs]);
  }

  defaultProfileId(): string {
    return resolveDefaultProfileId(
      this.#storedDefault,
      this.definitions.map((entry) => entry.id),
    );
  }

  /** Resolved executable passed to the bundled Muse adapter's child environment. */
  museExecutablePath(): string | undefined {
    return this.#museStatus.ok ? this.#museStatus.host.path : undefined;
  }

  statusOf(profileId: string): AgentProfileStatus {
    const definition = this.definitions.find((entry) => entry.id === profileId);
    if (definition === undefined) throw new Error("agent profile is unknown");
    if (profileId === MUSE_AGENT_PROFILE_ID) {
      return this.#museStatus.ok
        ? { definition, available: true, version: this.#museStatus.host.version }
        : { definition, available: false, missingReason: this.#museStatus.reason };
    }
    if (profileId === CODEX_AGENT_PROFILE_ID) {
      return this.#options.codexMissingReason === undefined
        ? { definition, available: true, version: this.#options.codexVersion }
        : {
          definition,
          available: false,
          missingReason: this.#options.codexMissingReason,
        };
    }
    const cached = this.#customAvailability.get(profileId) ?? { available: false };
    return cached.available ? { definition, available: true } : {
      definition,
      available: false,
      missingReason: cached.reason ?? "custom agent is unavailable",
    };
  }

  async ensureRuntime(
    profileId: string,
    baseRuntimeKey: string,
  ): Promise<ChatRuntimeAdapter> {
    const definition = this.definitions.find((entry) => entry.id === profileId);
    if (definition === undefined) throw new Error("agent profile is unknown");
    const status = this.statusOf(profileId);
    if (!status.available) {
      throw new Error(
        status.missingReason ?? `${definition.displayName} is unavailable.`,
      );
    }
    const key = profileRuntimeKey(baseRuntimeKey, profileId);
    const cached = this.#adapters.get(key);
    if (cached !== undefined) return cached;
    const running = this.#inflight.get(key);
    if (running !== undefined) return running;
    const created = this.#createRuntime(definition, baseRuntimeKey).then(
      (adapter) => {
        this.#adapters.set(key, adapter);
        this.#inflight.delete(key);
        return adapter;
      },
      (error) => {
        this.#inflight.delete(key);
        throw error;
      },
    );
    this.#inflight.set(key, created);
    return await created;
  }

  /**
   * Closes and drops every profiled adapter for one standalone MCP.
   * Returns the profiled keys so the host can unregister them. Close
   * failures are ignored: idle agent hosts expire on their own side.
   */
  async releaseStandalone(mcpId: string): Promise<readonly string[]> {
    const baseKey = chatRuntimeKey("standalone", mcpId);
    const released: string[] = [];
    for (const definition of this.definitions) {
      const key = profileRuntimeKey(baseKey, definition.id);
      const adapter = this.#adapters.get(key);
      if (adapter === undefined) continue;
      this.#adapters.delete(key);
      released.push(key);
      await adapter.close().catch(() => undefined);
    }
    return released;
  }

  async saveDefault(profileId: string): Promise<void> {
    if (!this.definitions.some((entry) => entry.id === profileId)) {
      throw new Error("agent profile is unknown");
    }
    await saveAgentProfilesFile(this.#options.dataRoot, {
      profiles: this.#customs,
      defaultProfileId: profileId,
    });
    this.#storedDefault = profileId;
  }

  async reload(): Promise<
    | { readonly ok: true; readonly invalidatedRuntimeKeys: readonly string[] }
    | { readonly ok: false; readonly error: string }
  > {
    const loaded = await loadAgentProfilesFile(this.#options.dataRoot);
    if (!loaded.ok) return { ok: false, error: loaded.error };
    const previous = new Map(this.#customs.map((entry) => [entry.id, entry]));
    const previousAvailability = new Map(this.#customAvailability);
    const previousMusePath = this.museExecutablePath();
    this.#customs = loaded.file.profiles;
    this.#storedDefault = loaded.file.defaultProfileId;
    this.#museStatus = await resolveMuseHost(
      this.#options.appEnv,
      this.#options.museDeps,
    );
    this.#refreshCustomAvailability();
    const next = new Map(this.#customs.map((entry) => [entry.id, entry]));
    const changed = new Set<string>();
    for (const [id, former] of previous) {
      const current = next.get(id);
      if (
        current === undefined || JSON.stringify(former) !== JSON.stringify(current) ||
        previousAvailability.get(id)?.available !==
          this.#customAvailability.get(id)?.available
      ) changed.add(id);
    }
    if (previousMusePath !== this.museExecutablePath()) {
      changed.add(MUSE_AGENT_PROFILE_ID);
    }
    const invalidatedRuntimeKeys: string[] = [];
    for (const key of this.#adapters.keys()) {
      if (!changed.has(profileIdOfRuntimeKey(key))) continue;
      this.#adapters.delete(key);
      invalidatedRuntimeKeys.push(key);
    }
    return { ok: true, invalidatedRuntimeKeys: Object.freeze(invalidatedRuntimeKeys) };
  }

  async #createRuntime(
    definition: AgentProfileDefinition,
    baseRuntimeKey: string,
  ): Promise<ChatRuntimeAdapter> {
    return await this.#options.createAdapter({
      dataRoot: this.#options.dataRoot,
      workspaceRoot: this.#options.workspaceRoot,
      acpxRuntimeUrl: this.#options.acpxRuntimeUrl,
      agentName: definition.agentName,
      agentArgv: this.#agentArgv(definition),
      mcpServers: this.#mcpServers(baseRuntimeKey),
      sessionStoreDir: sessionStoreName(definition.id, baseRuntimeKey),
    });
  }

  #agentArgv(definition: AgentProfileDefinition): readonly string[] {
    if (definition.builtin !== null) {
      return Object.freeze([
        this.#options.nodeExecutable,
        join(this.#options.runtimeRoot, builtinAdapterEntry(definition.builtin)),
      ]);
    }
    const launch = definition.launch;
    if (launch === null) throw new Error("custom agent has no launch configuration");
    if (launch.kind === "node-entry") {
      return Object.freeze([this.#options.nodeExecutable, launch.entry]);
    }
    return Object.freeze([launch.path, ...launch.args]);
  }

  #mcpServers(baseRuntimeKey: string): readonly PinnedMcpServer[] {
    if (baseRuntimeKey === "project") {
      return Object.freeze([{
        name: "casys-digital-thread",
        url: this.#options.projectRelayUrl,
      }]);
    }
    const mcpId = mcpIdOfRuntimeKey(baseRuntimeKey);
    if (mcpId === undefined) return Object.freeze([]);
    const url = this.#options.relayUrl(mcpId);
    if (url === undefined) throw new Error(`MCP "${mcpId}" is not attached.`);
    return Object.freeze([{ name: this.#options.mcpDisplayName(mcpId), url }]);
  }

  #refreshCustomAvailability(): void {
    this.#customAvailability.clear();
    for (const custom of this.#customs) {
      const launch = custom.launch;
      const target = launch === null
        ? undefined
        : launch.kind === "node-entry"
        ? launch.entry
        : launch.path;
      if (target === undefined || !existsSync(target)) {
        this.#customAvailability.set(custom.id, {
          available: false,
          reason: `custom agent entry does not exist: ${target ?? "missing"}`,
        });
      } else {
        this.#customAvailability.set(custom.id, { available: true });
      }
    }
  }
}

/** `standalone+mcp:<id>` -> `<id>`; base keys yield undefined. */
function mcpIdOfRuntimeKey(baseKey: string): string | undefined {
  const marker = "+mcp:";
  const index = baseKey.indexOf(marker);
  if (index === -1) return undefined;
  const mcpId = baseKey.slice(index + marker.length);
  if (mcpId === "") throw new Error("runtime key is invalid");
  return mcpId;
}

/** Profile segment of a profiled runtime key; bare keys read as legacy. */
function profileIdOfRuntimeKey(key: string): string {
  const index = key.lastIndexOf("@");
  if (index === -1) return CODEX_AGENT_PROFILE_ID;
  return key.slice(index + 1);
}

/**
 * Session store name below the data root. The legacy profile keeps the
 * historical names so native sessions resume; every other profile is
 * namespaced and starts fresh.
 */
function sessionStoreName(profileId: string, baseKey: string): string {
  if (profileId === CODEX_AGENT_PROFILE_ID) {
    if (baseKey === "project") return "acpx-sessions";
    const mcpId = mcpIdOfRuntimeKey(baseKey);
    if (mcpId !== undefined) return `acpx-sessions-standalone-${mcpId}`;
    return "acpx-sessions-standalone";
  }
  return `acpx-sessions-${profileId}-${baseKey.replace(/[^a-z0-9]+/gi, "-")}`;
}
