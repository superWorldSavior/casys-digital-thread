/**
 * Tool runtime engine detection for the Desktop host backend (#56).
 *
 * Pure decision over an injected command runner: no Docker SDK, no global
 * state, no mutation. Four literal outcomes — absent, stopped,
 * incompatible, ready — so callers can branch the reuse path, the
 * app-managed install path, or an honest error without guessing.
 */
import type { CommandRunner } from "../../../src/adapters/shared/docker-observer.ts";

/** Literal engine states. Never collapse stopped into absent: the recovery differs. */
export type ToolRuntimeEngineStatus =
  | "absent"
  | "stopped"
  | "incompatible"
  | "ready";

/** Machine-readable incompatibility reasons. */
export type ToolRuntimeEngineIncompatibility =
  | "os-not-linux"
  | "arch-unsupported"
  | "compose-missing"
  | "probe-unparsable";

export interface ToolRuntimeEngineObservation {
  readonly status: ToolRuntimeEngineStatus;
  /** Human sentence for UI/diagnostics; machines branch on status + reasons. */
  readonly detail: string;
  readonly binaryPresent: boolean;
  readonly daemonReachable: boolean;
  readonly serverVersion?: string;
  readonly serverArch?: string;
  readonly serverOs?: string;
  readonly composeVersion?: string;
  readonly reasons: readonly ToolRuntimeEngineIncompatibility[];
}

/** Server architectures covered by the pinned provider manifest lists. */
const SUPPORTED_ARCHITECTURES = new Set([
  "amd64",
  "x86_64",
  "arm64",
  "aarch64",
]);

interface DockerVersionDocument {
  readonly Client?: { readonly Version?: unknown };
  readonly Server?: {
    readonly Version?: unknown;
    readonly Os?: unknown;
    readonly Arch?: unknown;
  };
}

/**
 * Detects the local OCI engine through read-only CLI probes. Never starts,
 * stops, pulls, or changes anything: detection is safe to run on every
 * status render. Transient probe failures (timeouts, not missing binaries
 * or daemon refusals) are retried once: the first CLI-plugin call in a
 * session can exceed a tight timeout while the engine underneath is fine.
 */
export async function detectToolRuntimeEngine(
  runner: CommandRunner,
  cwd: string,
  options: {
    readonly sleep?: (ms: number) => Promise<void>;
    readonly retryDelayMs?: number;
  } = {},
): Promise<ToolRuntimeEngineObservation> {
  const sleep = options.sleep ??
    ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const retryDelayMs = options.retryDelayMs ?? 500;
  const version = await runProbe(
    runner,
    "docker",
    ["version", "--format", "{{json .}}"],
    cwd,
    sleep,
    retryDelayMs,
  );
  if (!version.success && isBinaryMissing(version.code, version.stderr)) {
    return {
      status: "absent",
      detail:
        "No docker binary was found in the managed locations or on PATH; the app-managed install path applies.",
      binaryPresent: false,
      daemonReachable: false,
      reasons: [],
    };
  }
  const document = parseVersionDocument(version.stdout);
  if (document === undefined) {
    return {
      status: "incompatible",
      detail:
        "The docker version probe could not be parsed; readiness cannot be proven.",
      binaryPresent: true,
      daemonReachable: false,
      reasons: ["probe-unparsable"],
    };
  }
  const server = document.Server;
  const serverVersion = textField(server?.Version);
  if (server === undefined || serverVersion === undefined) {
    return {
      status: "stopped",
      detail: "The docker binary is present but no daemon answered; start the engine.",
      binaryPresent: true,
      daemonReachable: false,
      reasons: [],
    };
  }
  const serverOs = textField(server.Os);
  const serverArch = textField(server.Arch);
  const reasons: ToolRuntimeEngineIncompatibility[] = [];
  if (serverOs !== "linux") reasons.push("os-not-linux");
  if (serverArch === undefined || !SUPPORTED_ARCHITECTURES.has(serverArch)) {
    reasons.push("arch-unsupported");
  }
  const composeVersion = await composePluginVersion(runner, cwd, sleep, retryDelayMs);
  if (composeVersion === undefined) reasons.push("compose-missing");
  if (reasons.length > 0) {
    return {
      status: "incompatible",
      detail: `The reachable engine cannot host Linux provider containers (${
        reasons.join(", ")
      }).`,
      binaryPresent: true,
      daemonReachable: true,
      serverVersion,
      ...(serverArch === undefined ? {} : { serverArch }),
      ...(serverOs === undefined ? {} : { serverOs }),
      ...(composeVersion === undefined ? {} : { composeVersion }),
      reasons,
    };
  }
  return {
    status: "ready",
    detail:
      `Engine ready: server ${serverVersion} (${serverOs}/${serverArch}), compose ${composeVersion}.`,
    binaryPresent: true,
    daemonReachable: true,
    serverVersion,
    serverArch: serverArch!,
    serverOs: serverOs!,
    composeVersion: composeVersion!,
    reasons: [],
  };
}

function isBinaryMissing(code: number, stderr: string): boolean {
  return code === -1 &&
    (/no such file|cannot find|not found|ENOENT/i.test(stderr) ||
      stderr.trim().length === 0);
}

type ProbeResult = Awaited<ReturnType<CommandRunner["run"]>>;

async function runProbe(
  runner: CommandRunner,
  command: string,
  args: string[],
  cwd: string,
  sleep: (ms: number) => Promise<void>,
  retryDelayMs: number,
): Promise<ProbeResult> {
  const first = await runner.run(command, args, cwd);
  if (!isTransientFailure(first.code, first.stderr)) return first;
  await sleep(retryDelayMs);
  return await runner.run(command, args, cwd);
}

/** Timeout-class failures only: a missing binary or a daemon refusal never retries. */
function isTransientFailure(code: number, stderr: string): boolean {
  return code === -1 && !isBinaryMissing(code, stderr);
}

function parseVersionDocument(stdout: string): DockerVersionDocument | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  return parsed as DockerVersionDocument;
}

function textField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function composePluginVersion(
  runner: CommandRunner,
  cwd: string,
  sleep: (ms: number) => Promise<void>,
  retryDelayMs: number,
): Promise<string | undefined> {
  // NOTE: compose takes `--format json`, not the engine's `{{json .}}` template.
  const probed = await runProbe(
    runner,
    "docker",
    ["compose", "version", "--format", "json"],
    cwd,
    sleep,
    retryDelayMs,
  );
  if (!probed.success) return undefined;
  try {
    const parsed: unknown = JSON.parse(probed.stdout);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    return textField((parsed as { version?: unknown }).version);
  } catch {
    return undefined;
  }
}
