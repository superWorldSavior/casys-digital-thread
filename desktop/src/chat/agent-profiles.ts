/**
 * Host-owned agent profiles (#58). The reasoning agent behind a Casys
 * conversation is a replaceable ACP backend: Muse by default, Codex as a
 * selectable alternative, plus explicitly user-registered custom adapters.
 *
 * Pure and Deno-safe: no node imports, no filesystem, no subprocess. The
 * chat host resolves binaries, loads the user file, and builds per-profile
 * environments in `../chat-host/agent-host.ts`; the coordinator consumes
 * definitions and key scoping from here.
 */

/** Built-in Muse profile: the default for new conversations. */
export const MUSE_AGENT_PROFILE_ID = "casys-muse" as const;
/** Built-in Codex profile: the selectable legacy alternative. */
export const CODEX_AGENT_PROFILE_ID = "casys-codex" as const;
/** Default for new conversations and unknown stored defaults. */
export const DEFAULT_AGENT_PROFILE_ID = MUSE_AGENT_PROFILE_ID;
/**
 * Legacy profile. Its session and runtime keys stay bare so pre-profile
 * conversations resume byte-identical sessions; every other profile is
 * namespaced. Existing conversations without a stored profile id read as
 * legacy and are never relabelled.
 */
export const LEGACY_AGENT_PROFILE_ID = CODEX_AGENT_PROFILE_ID;

/** ACP registry key per built-in profile. */
export const MUSE_AGENT_NAME = "casys-muse" as const;
export const CODEX_AGENT_NAME = "casys-codex" as const;

/** Bundled adapter kinds, resolved against the packaged runtime root. */
export type BuiltinAgentKind = "bundled-muse" | "bundled-codex";

/**
 * How the ACP adapter process launches. `node-entry` runs a JS entry under
 * the packaged Node; `command` spawns an absolute executable directly.
 * Both are literal: no shell, no interpolation, no PATH lookup.
 */
export type AgentLaunch =
  | { readonly kind: "node-entry"; readonly entry: string }
  | {
    readonly kind: "command";
    readonly path: string;
    readonly args: readonly string[];
  };

/**
 * Agent profiles carry no environment: acpx persists session options with
 * a snake_case key policy, so uppercase env injection is unrepresentable.
 * Agents inherit the full host environment, as before profiles existed.
 */
export interface AgentProfileDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly agentName: string;
  /** Built-in adapter kind, or null for a user-registered profile. */
  readonly builtin: BuiltinAgentKind | null;
  /** Launch for user-registered profiles; builtins resolve their own. */
  readonly launch: AgentLaunch | null;
  /** Recovery shown when a turn fails with the auth-required shape. */
  readonly authRecovery: string;
  /** True only when the adapter verifiably exposes model controls. */
  readonly modelsExposed: boolean;
}

export const MUSE_AUTH_RECOVERY =
  "The selected agent (Muse) is not signed in. Run `muse login` in a terminal, then send your message again. The app never sees your credentials.";
export const CODEX_AUTH_RECOVERY =
  "The selected agent (Codex) is not signed in. Install the Codex CLI, run `codex login` in a terminal, then send your message again. The app never sees your credentials.";

export const BUILTIN_AGENT_PROFILES: readonly AgentProfileDefinition[] = Object
  .freeze([
    Object.freeze({
      id: MUSE_AGENT_PROFILE_ID,
      displayName: "Muse",
      agentName: MUSE_AGENT_NAME,
      builtin: "bundled-muse",
      launch: null,
      authRecovery: MUSE_AUTH_RECOVERY,
      modelsExposed: false,
    }),
    Object.freeze({
      id: CODEX_AGENT_PROFILE_ID,
      displayName: "Codex",
      agentName: CODEX_AGENT_NAME,
      builtin: "bundled-codex",
      launch: null,
      authRecovery: CODEX_AUTH_RECOVERY,
      modelsExposed: false,
    }),
  ]);

/** Maximum user-registered profiles per file. */
export const MAX_CUSTOM_AGENT_PROFILES = 8;

export interface AgentProfilesFile {
  readonly profiles: readonly AgentProfileDefinition[];
  readonly defaultProfileId?: string;
}

const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;
const WINDOWS_ABSOLUTE_PATTERN = /^[A-Za-z]:[\\/]/;
const UNC_PATTERN = /^\\\\[^\\]+\\/;

function isAbsoluteAsciiPath(value: string): boolean {
  return value.startsWith("/") || WINDOWS_ABSOLUTE_PATTERN.test(value) ||
    UNC_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(
  value: unknown,
  field: string,
  max: number,
): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new TypeError(`agent profile ${field} must be 1-${max} chars`);
  }
  return value;
}

/**
 * Parses the user-registered profiles file (`agent-profiles.json`). Strict
 * and fail-closed: any violation rejects the whole file, never a single
 * entry, so a half-loaded registry is unrepresentable. Callers keep the
 * built-ins and report the reason; the file never modifies built-ins.
 */
export function parseAgentProfilesFile(value: unknown): AgentProfilesFile {
  if (!isRecord(value)) throw new TypeError("agent profiles file must be an object");
  const rawProfiles = value.profiles ?? [];
  if (!Array.isArray(rawProfiles)) {
    throw new TypeError("agent profiles file.profiles must be an array");
  }
  if (rawProfiles.length > MAX_CUSTOM_AGENT_PROFILES) {
    throw new TypeError(
      `agent profiles file holds at most ${MAX_CUSTOM_AGENT_PROFILES} profiles`,
    );
  }
  const profiles = rawProfiles.map((entry, index) => parseCustomProfile(entry, index));
  const ids = new Set(profiles.map((profile) => profile.id));
  if (ids.size !== profiles.length) {
    throw new TypeError("agent profiles file has duplicate profile ids");
  }
  if (value.defaultProfileId === undefined) {
    return { profiles: Object.freeze(profiles) };
  }
  const defaultProfileId = text(value.defaultProfileId, "defaultProfileId", 48);
  if (!PROFILE_ID_PATTERN.test(defaultProfileId)) {
    throw new TypeError("agent profiles file defaultProfileId is invalid");
  }
  return { profiles: Object.freeze(profiles), defaultProfileId };
}

function parseCustomProfile(entry: unknown, index: number): AgentProfileDefinition {
  const where = `profiles[${index}]`;
  if (!isRecord(entry)) throw new TypeError(`agent ${where} must be an object`);
  const id = text(entry.id, `${where}.id`, 48);
  if (!PROFILE_ID_PATTERN.test(id)) {
    throw new TypeError(`agent ${where}.id is invalid`);
  }
  if (id === MUSE_AGENT_PROFILE_ID || id === CODEX_AGENT_PROFILE_ID) {
    throw new TypeError(`agent ${where}.id collides with a built-in profile`);
  }
  const displayName = text(entry.displayName, `${where}.displayName`, 64);
  const agentName = text(entry.agentName, `${where}.agentName`, 64);
  if (!PROFILE_ID_PATTERN.test(agentName)) {
    throw new TypeError(`agent ${where}.agentName is invalid`);
  }
  const launch = parseLaunch(entry.launch, where);
  const authRecovery = text(entry.authRecovery, `${where}.authRecovery`, 500);
  if (typeof entry.modelsExposed !== "boolean") {
    throw new TypeError(`agent ${where}.modelsExposed must be a boolean`);
  }
  return Object.freeze({
    id,
    displayName,
    agentName,
    builtin: null,
    launch,
    authRecovery,
    modelsExposed: entry.modelsExposed,
  });
}

function parseLaunch(value: unknown, where: string): AgentLaunch {
  if (!isRecord(value)) throw new TypeError(`agent ${where}.launch must be an object`);
  if (value.kind === "node-entry") {
    const entry = text(value.entry, `${where}.launch.entry`, 1024);
    if (!isAbsoluteAsciiPath(entry)) {
      throw new TypeError(`agent ${where}.launch.entry must be an absolute path`);
    }
    return Object.freeze({ kind: "node-entry", entry });
  }
  if (value.kind === "command") {
    const path = text(value.path, `${where}.launch.path`, 1024);
    if (!isAbsoluteAsciiPath(path)) {
      throw new TypeError(`agent ${where}.launch.path must be an absolute path`);
    }
    if (!Array.isArray(value.args)) {
      throw new TypeError(`agent ${where}.launch.args must be an array`);
    }
    if (value.args.length > 32) {
      throw new TypeError(`agent ${where}.launch.args holds at most 32 entries`);
    }
    for (const arg of value.args) {
      if (typeof arg !== "string" || arg.length > 1024) {
        throw new TypeError(`agent ${where}.launch.args must be short strings`);
      }
    }
    return Object.freeze({
      kind: "command",
      path,
      args: Object.freeze([...value.args]),
    });
  }
  throw new TypeError(`agent ${where}.launch.kind must be node-entry or command`);
}

/**
 * Resolves the effective default: the stored id when it names a known
 * profile, else the Muse default. Unknown stored ids fail safe to the
 * default without touching any conversation.
 */
export function resolveDefaultProfileId(
  stored: string | undefined,
  knownIds: readonly string[],
): string {
  if (stored !== undefined && knownIds.includes(stored)) return stored;
  return DEFAULT_AGENT_PROFILE_ID;
}

/** Live availability of one profile for snapshot projection. */
export interface AgentProfileStatus {
  readonly definition: AgentProfileDefinition;
  readonly available: boolean;
  readonly version?: string;
  readonly missingReason?: string;
}

/**
 * Host-owned profile services consumed by the coordinator. Implemented by
 * the chat host (built-ins, user file, binary resolution, runtime
 * factory); faked in coordinator tests. Deno-safe types only: the
 * `ChatRuntimeAdapter` import is type-only.
 */
export interface AgentProfileHost {
  /** All known definitions: built-ins first, then valid customs. */
  readonly definitions: readonly AgentProfileDefinition[];
  /** Effective default id (stored when known, else the Muse default). */
  defaultProfileId(): string;
  /** Cached availability snapshot for one profile. */
  statusOf(profileId: string): AgentProfileStatus;
  /**
   * Creates (or returns) the ACP adapter for a profile + base runtime key.
   * Rejects with an explicit reason when the profile cannot run; the
   * caller never falls back to another profile.
   */
  ensureRuntime(
    profileId: string,
    baseRuntimeKey: string,
  ): Promise<import("./runtime-port.ts").ChatRuntimeAdapter>;
  /** Persists the default; must not touch any conversation. */
  saveDefault(profileId: string): Promise<void>;
  /** Re-reads the user file; returns the new registry or the reason. */
  reload(): Promise<
    { readonly ok: true } | { readonly ok: false; readonly error: string }
  >;
}

/**
 * Scopes a bare session key by profile. The legacy profile keeps the bare
 * key so pre-profile conversations resume identical sessions; every other
 * profile is namespaced and starts fresh.
 */
export function profileSessionKey(baseKey: string, profileId: string): string {
  if (profileId === LEGACY_AGENT_PROFILE_ID) return baseKey;
  return `${baseKey}/agent/${profileId}`;
}

/**
 * Scopes a runtime key by profile with the same legacy rule as session
 * keys, so runtime/session identities stay aligned per profile.
 */
export function profileRuntimeKey(baseKey: string, profileId: string): string {
  if (profileId === LEGACY_AGENT_PROFILE_ID) return baseKey;
  return `${baseKey}@${profileId}`;
}

/**
 * ACP SDK `RequestError.authRequired` (-32000) surfaces with a stable
 * `Authentication required` prefix plus an optional `: detail` suffix on
 * both shipped adapters. Anything else falls through: a missed variant
 * keeps the raw message instead of inventing recovery.
 */
const AGENT_AUTH_REQUIRED_PREFIX = "Authentication required";

export function isAgentAuthFailure(message: string): boolean {
  if (!message.startsWith(AGENT_AUTH_REQUIRED_PREFIX)) return false;
  const rest = message.slice(AGENT_AUTH_REQUIRED_PREFIX.length);
  return rest === "" || rest.startsWith(":");
}
