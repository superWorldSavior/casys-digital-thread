/**
 * Host-side agent profile support (#58). Loads the user-registered
 * profiles file, resolves the external Muse binary, and builds
 * per-profile child environments. Bundled into the Node chat host: only
 * `node:` imports, no `Deno.*` APIs. Pure validation lives in
 * `../chat/agent-profiles.ts`.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, promises as fs, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import {
  type AgentLaunch,
  type AgentProfileDefinition,
  type AgentProfilesFile,
  BUILTIN_AGENT_PROFILES,
  parseAgentProfilesFile,
} from "../chat/agent-profiles.ts";

/** User-registered profiles + persisted default, below the chat data root. */
export const AGENT_PROFILES_FILENAME = "agent-profiles.json";

/** Bundled adapter entry, relative to the packaged runtime root. */
export function builtinAdapterEntry(kind: "bundled-muse" | "bundled-codex"): string {
  const packagePath = kind === "bundled-muse"
    ? ["@bex-co", "muse-code-acp"]
    : ["@agentclientprotocol", "codex-acp"];
  return ["adapter", "node_modules", ...packagePath, "dist", "index.js"].join("/");
}

/**
 * An unused optional adapter may be absent. A present artifact must still
 * match its pin; a corrupt or unreadable artifact is never treated as absent.
 */
export function verifyOptionalPinnedArtifact(
  path: string,
  expectedSha256: string,
  label: string,
): boolean {
  let resolved: string;
  try {
    resolved = realpathSync(path);
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
  const digest = createHash("sha256").update(readFileSync(resolved)).digest("hex");
  if (digest !== expectedSha256) throw new Error(`${label} digest mismatch`);
  return true;
}

export type LoadAgentProfiles =
  | { readonly ok: true; readonly file: AgentProfilesFile }
  | { readonly ok: false; readonly error: string };

/**
 * Loads the user profiles file. A missing file is not an error (built-ins
 * only). Malformed JSON or schema violations fail closed with a reason;
 * callers keep the built-ins and surface the reason, never half a registry.
 */
export async function loadAgentProfilesFile(
  dataRoot: string,
): Promise<LoadAgentProfiles> {
  const path = join(dataRoot, AGENT_PROFILES_FILENAME);
  let text: string;
  try {
    text = await fs.readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return { ok: true, file: { profiles: [] } };
    return {
      ok: false,
      error: `cannot read ${AGENT_PROFILES_FILENAME}: ${safeMessage(error)}`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: `${AGENT_PROFILES_FILENAME} is not valid JSON` };
  }
  try {
    return { ok: true, file: parseAgentProfilesFile(parsed) };
  } catch (error) {
    return { ok: false, error: safeMessage(error) };
  }
}

/**
 * Persists the default profile id, preserving user-registered entries. An
 * unreadable or invalid existing file is replaced by a defaults-only file
 * rather than merged; the file holds settings, never credentials.
 */
export async function saveAgentProfilesFile(
  dataRoot: string,
  file: AgentProfilesFile,
): Promise<void> {
  const path = join(dataRoot, AGENT_PROFILES_FILENAME);
  const profiles = file.profiles.map((profile) => ({
    id: profile.id,
    displayName: profile.displayName,
    agentName: profile.agentName,
    launch: launchToJson(profile.launch),
    authRecovery: profile.authRecovery,
    modelsExposed: profile.modelsExposed,
  }));
  const document: Record<string, unknown> = { profiles };
  if (file.defaultProfileId !== undefined) {
    document.defaultProfileId = file.defaultProfileId;
  }
  await fs.writeFile(path, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
}

function launchToJson(launch: AgentLaunch | null): unknown {
  if (launch === null) throw new TypeError("built-in profiles are not persisted");
  if (launch.kind === "node-entry") return { kind: "node-entry", entry: launch.entry };
  return { kind: "command", path: launch.path, args: [...launch.args] };
}

/** Resolved external Muse host binary. */
export interface MuseHostResolution {
  readonly path: string;
  readonly version: string;
}

export type MuseHostStatus =
  | { readonly ok: true; readonly host: MuseHostResolution }
  | { readonly ok: false; readonly reason: string };

export interface MuseResolveDeps {
  readonly isExecutable: (path: string) => Promise<boolean>;
  readonly readVersion: (path: string) => Promise<string | undefined>;
  readonly pathSeparator: string;
}

async function defaultIsExecutable(path: string): Promise<boolean> {
  try {
    await fs.access(path, constants.X_OK);
    return (await fs.stat(path)).isFile();
  } catch {
    return false;
  }
}

function defaultReadVersion(path: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(path, ["--version"], { timeout: 10_000 }, (error, stdout) => {
      if (error) return resolve(undefined);
      resolve(parseMuseVersion(stdout));
    });
  });
}

/** `Muse Code 1.4.0 (...)` -> `1.4.0`; anything else is unparseable. */
export function parseMuseVersion(output: string): string | undefined {
  const match = /^Muse Code (\S+)/m.exec(output.trim());
  return match?.[1];
}

/**
 * Resolves the external Muse binary: explicit `MUSE_CODE_EXECUTABLE`,
 * then `$HOME/.local/bin/muse`, then PATH lookup. Reports the version or
 * an explicit missing-prerequisite reason; never throws, never shells out
 * beyond the version probe.
 */
export async function resolveMuseHost(
  env: Readonly<Record<string, string | undefined>>,
  deps: MuseResolveDeps = {
    isExecutable: defaultIsExecutable,
    readVersion: defaultReadVersion,
    pathSeparator: process.platform === "win32" ? ";" : ":",
  },
): Promise<MuseHostStatus> {
  const override = env.MUSE_CODE_EXECUTABLE;
  if (override !== undefined && override !== "") {
    if (!await deps.isExecutable(override)) {
      return {
        ok: false,
        reason: `MUSE_CODE_EXECUTABLE is not an executable file: ${override}`,
      };
    }
    return await withVersion(override, deps.readVersion);
  }
  const home = env.HOME ?? env.USERPROFILE;
  if (home !== undefined && home !== "") {
    const localBin = join(
      home,
      ".local",
      "bin",
      process.platform === "win32" ? "muse.exe" : "muse",
    );
    if (await deps.isExecutable(localBin)) {
      return await withVersion(localBin, deps.readVersion);
    }
  }
  const found = await findOnPath(env.PATH ?? "", "muse", deps);
  if (found !== undefined) return await withVersion(found, deps.readVersion);
  return {
    ok: false,
    reason:
      "No Muse executable found (MUSE_CODE_EXECUTABLE, ~/.local/bin/muse, or PATH)",
  };
}

async function withVersion(
  path: string,
  readVersion: (path: string) => Promise<string | undefined>,
): Promise<MuseHostStatus> {
  const version = await readVersion(path);
  if (version === undefined) {
    return { ok: false, reason: `Muse executable did not report a version: ${path}` };
  }
  return { ok: true, host: { path, version } };
}

async function findOnPath(
  pathValue: string,
  name: string,
  deps: MuseResolveDeps,
): Promise<string | undefined> {
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of pathValue.split(deps.pathSeparator)) {
    if (dir === "") continue;
    for (const extension of extensions) {
      const candidate = join(dir, `${name}${extension}`);
      if (await deps.isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

/** All known definitions: built-ins first, then valid customs. */
export function knownAgentProfiles(
  customs: readonly AgentProfileDefinition[],
): readonly AgentProfileDefinition[] {
  return Object.freeze([...BUILTIN_AGENT_PROFILES, ...customs]);
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    (error as { code?: unknown }).code === "ENOENT";
}

function safeMessage(error: unknown): string {
  if (typeof error === "string") return error.slice(0, 300);
  if (error instanceof Error) return error.message.slice(0, 300);
  return "unknown error";
}
