import { readBoundedHandshakeText } from "../control-plane/parse.ts";
import { wrapOwnedSidecarHandle } from "../control-plane/spawn.ts";
import type { SpawnableChild } from "../control-plane/spawn.ts";
import type { ControlPlaneLayoutProfile } from "../sidecar/contracts.ts";
import {
  CONFIG_DIGEST_PATTERN,
  type DesktopWorkbenchProjection,
  LAUNCH_ID_PATTERN,
  WORKBENCH_ACCESS_HEADER,
  WORKBENCH_ACCESS_TOKEN_PATTERN,
  WORKBENCH_HANDSHAKE_SCHEMA,
  WORKBENCH_HEALTH_SCHEMA,
  WORKBENCH_INSPECT_SCHEMA,
  WORKBENCH_MARKER_SCHEMA,
  WORKBENCH_ORIGIN,
  WORKBENCH_VERSION,
  WORKBENCH_WORKSPACE_ID,
  type WorkbenchHandshake,
  type WorkbenchHealthDocument,
  type WorkbenchHostResult,
  type WorkbenchInspectDocument,
  type WorkbenchMarker,
  type WorkbenchOwnedHandle,
} from "./contracts.ts";

const HANDSHAKE_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 2_000;
const STOP_TIMEOUT_MS = 2_000;

export interface WorkbenchHostPorts {
  readonly fetch: typeof fetch;
  readonly createLaunchId: () => string;
  readonly runInspect: () => Promise<string>;
  readonly spawn: (launchId: string) => WorkbenchOwnedHandle;
}

export interface WorkbenchHostOptions {
  readonly ports: WorkbenchHostPorts;
  readonly handshakeTimeoutMs?: number;
  readonly probeTimeoutMs?: number;
  readonly stopTimeoutMs?: number;
}

export class WorkbenchHost {
  #owned: WorkbenchOwnedHandle | undefined;
  #startGate: Promise<WorkbenchHostResult> | undefined;
  #stopGate: Promise<void> | undefined;

  constructor(readonly options: WorkbenchHostOptions) {}

  async start(): Promise<WorkbenchHostResult> {
    if (this.#startGate) return await this.#startGate;
    const gate = this.#startExclusive();
    this.#startGate = gate;
    try {
      return await gate;
    } finally {
      if (this.#startGate === gate) this.#startGate = undefined;
    }
  }

  async stop(): Promise<void> {
    if (this.#stopGate) return await this.#stopGate;
    const handle = this.#owned;
    if (!handle) return;
    const gate = this.#stopOwned(handle);
    this.#stopGate = gate;
    try {
      await gate;
    } finally {
      if (this.#stopGate === gate) this.#stopGate = undefined;
    }
  }

  async #startExclusive(): Promise<WorkbenchHostResult> {
    if (this.#owned !== undefined) {
      return unavailable("termination-unresolved", true);
    }
    const inspected = await this.#inspect();
    if (!inspected) return unavailable("helper-unavailable");
    const reconnected = await this.#reconnect(inspected);
    if (reconnected) return reconnected;
    if (inspected.configuration !== "verified") {
      return unavailable("configuration-unavailable");
    }
    if (inspected.marker !== null || inspected.lock !== "free") {
      return unavailable("marker-invalid", true);
    }
    const listener = await probeListenerPresence(
      this.options.ports.fetch,
      this.options.probeTimeoutMs,
    );
    if (listener === "present") {
      return unavailable("listener-conflict", true);
    }
    if (listener === "ambiguous") return unavailable("probe-failed", true);

    const launchId = this.options.ports.createLaunchId();
    let child: WorkbenchOwnedHandle;
    try {
      child = this.options.ports.spawn(launchId);
    } catch {
      return await this.#recoverReconnect() ?? unavailable("helper-unavailable", true);
    }
    this.#owned = child;
    const handshake = await this.#handshake(child, launchId);
    if (!handshake) {
      if (!(await this.#stopRetainedAfterStartupFailure(child))) {
        return unavailable("termination-unresolved", true);
      }
      return await this.#recoverReconnect() ?? unavailable("startup-failed", true);
    }
    const health = await probeHealth(
      this.options.ports.fetch,
      handshake.accessToken,
      this.options.probeTimeoutMs,
    );
    if (
      !health || health.launchId !== launchId ||
      health.configDigest !== handshake.configDigest
    ) {
      if (!(await this.#stopRetainedAfterStartupFailure(child))) {
        return unavailable("termination-unresolved", true);
      }
      return unavailable("startup-failed", true);
    }
    return ready("owned-ready", handshake.accessToken);
  }

  async #stopOwned(handle: WorkbenchOwnedHandle): Promise<void> {
    const terminated = await stopHandle(
      handle,
      this.options.stopTimeoutMs ?? STOP_TIMEOUT_MS,
    );
    if (!terminated) throw new WorkbenchTerminationUnresolvedError();
    if (this.#owned === handle) this.#owned = undefined;
  }

  async #stopRetainedAfterStartupFailure(
    handle: WorkbenchOwnedHandle,
  ): Promise<boolean> {
    const terminated = await stopHandle(
      handle,
      this.options.stopTimeoutMs ?? STOP_TIMEOUT_MS,
    );
    if (terminated && this.#owned === handle) this.#owned = undefined;
    return terminated;
  }

  async #recoverReconnect(): Promise<WorkbenchHostResult | undefined> {
    const inspect = await this.#inspect();
    return inspect ? await this.#reconnect(inspect) : undefined;
  }

  async #reconnect(
    inspect: WorkbenchInspectDocument,
  ): Promise<WorkbenchHostResult | undefined> {
    if (
      inspect.configuration !== "verified" || inspect.lock !== "held" ||
      inspect.marker === null || inspect.accessToken === undefined ||
      inspect.configDigest !== inspect.marker.configDigest
    ) return undefined;
    const health = await probeHealth(
      this.options.ports.fetch,
      inspect.accessToken,
      this.options.probeTimeoutMs,
    );
    if (
      !health || health.launchId !== inspect.marker.launchId ||
      health.configDigest !== inspect.marker.configDigest
    ) return undefined;
    return ready("reconnected-ready", inspect.accessToken);
  }

  async #inspect(): Promise<WorkbenchInspectDocument | undefined> {
    try {
      return parseWorkbenchInspect(await this.options.ports.runInspect());
    } catch {
      return undefined;
    }
  }

  async #handshake(
    child: WorkbenchOwnedHandle,
    launchId: string,
  ): Promise<WorkbenchHandshake | undefined> {
    if (child.stdout === null) return undefined;
    const result = await Promise.race([
      readBoundedHandshakeText(child.stdout, {
        timeoutMs: this.options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS,
      }),
      child.status.then(() => undefined, () => undefined),
    ]);
    if (result === undefined || !result.ok) return undefined;
    try {
      const parsed = parseWorkbenchHandshake(result.value);
      return parsed.launchId === launchId ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
}

export class WorkbenchTerminationUnresolvedError extends Error {
  override readonly name = "WorkbenchTerminationUnresolvedError";

  constructor() {
    super(
      "Owned Workbench termination remains unresolved after bounded shutdown escalation.",
    );
  }
}

export function createDenoWorkbenchHost(
  helperPath: string,
  cwd: string,
  layoutProfile: ControlPlaneLayoutProfile,
): WorkbenchHost {
  const command = (
    args: readonly string[],
    stdout: "piped" | "null",
    stdin: "piped" | "null" = "piped",
  ) =>
    new Deno.Command(helperPath, {
      args: [...args],
      cwd,
      env: {},
      clearEnv: true,
      stdin,
      stdout,
      stderr: "null",
    });
  return new WorkbenchHost({
    ports: {
      fetch: globalThis.fetch.bind(globalThis),
      createLaunchId: () => crypto.randomUUID(),
      async runInspect() {
        const output = await command(
          [
            "inspect",
            `--layout-profile=${layoutProfile}`,
          ],
          "piped",
          "null",
        ).output();
        if (!output.success) throw new Error("Workbench inspect failed.");
        return new TextDecoder().decode(output.stdout);
      },
      spawn(launchId) {
        const child = command(
          [
            "start",
            `--layout-profile=${layoutProfile}`,
            `--launch-id=${launchId}`,
          ],
          "piped",
        ).spawn() as SpawnableChild;
        return wrapOwnedSidecarHandle(child);
      },
    },
  });
}

export function parseWorkbenchInspect(text: string): WorkbenchInspectDocument {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) throw new TypeError("Workbench inspect must be an object.");
  exactKeys(value, [
    "schema",
    "version",
    "configuration",
    ...(value.configDigest === undefined ? [] : ["configDigest"]),
    "lock",
    "marker",
    ...(value.accessToken === undefined ? [] : ["accessToken"]),
  ]);
  if (
    value.schema !== WORKBENCH_INSPECT_SCHEMA ||
    value.version !== WORKBENCH_VERSION ||
    !["verified", "unavailable", "error"].includes(String(value.configuration)) ||
    !["held", "free", "unavailable"].includes(String(value.lock)) ||
    !(value.marker === null || isRecord(value.marker))
  ) throw new TypeError("Workbench inspect has an unsupported contract.");
  const marker = value.marker === null ? null : parseMarker(value.marker);
  if (
    value.configuration === "verified" &&
    (typeof value.configDigest !== "string" ||
      !CONFIG_DIGEST_PATTERN.test(value.configDigest))
  ) throw new TypeError("Workbench inspect config digest is invalid.");
  if (
    value.accessToken !== undefined &&
    (typeof value.accessToken !== "string" ||
      !WORKBENCH_ACCESS_TOKEN_PATTERN.test(value.accessToken))
  ) throw new TypeError("Workbench inspect token is invalid.");
  if ((marker === null) !== (value.accessToken === undefined)) {
    throw new TypeError("Workbench inspect marker and token are incomplete.");
  }
  if (
    marker !== null && value.configDigest !== undefined &&
    marker.configDigest !== value.configDigest
  ) throw new TypeError("Workbench inspect configuration identity is stale.");
  return structuredClone(value as unknown as WorkbenchInspectDocument);
}

export function parseWorkbenchHandshake(text: string): WorkbenchHandshake {
  const value: unknown = JSON.parse(text);
  if (isRecord(value)) {
    exactKeys(value, [
      "schema",
      "status",
      "version",
      "launchId",
      "configDigest",
      "accessToken",
    ]);
  }
  if (
    !isRecord(value) || value.schema !== WORKBENCH_HANDSHAKE_SCHEMA ||
    value.status !== "ready" || value.version !== WORKBENCH_VERSION ||
    typeof value.launchId !== "string" ||
    !LAUNCH_ID_PATTERN.test(value.launchId) ||
    typeof value.configDigest !== "string" ||
    !CONFIG_DIGEST_PATTERN.test(value.configDigest) ||
    typeof value.accessToken !== "string" ||
    !WORKBENCH_ACCESS_TOKEN_PATTERN.test(value.accessToken)
  ) throw new TypeError("Workbench handshake has an unsupported contract.");
  return structuredClone(value as unknown as WorkbenchHandshake);
}

async function probeHealth(
  fetchImpl: typeof fetch,
  token: string,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<WorkbenchHealthDocument | undefined> {
  try {
    const response = await fetchImpl(`${WORKBENCH_ORIGIN}/healthz`, {
      method: "GET",
      headers: { [WORKBENCH_ACCESS_HEADER]: token },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return undefined;
    const value: unknown = await response.json();
    if (isRecord(value)) {
      exactKeys(value, [
        "schema",
        "status",
        "version",
        "launchId",
        "configDigest",
        "workspaceId",
      ]);
    }
    if (
      !isRecord(value) || value.schema !== WORKBENCH_HEALTH_SCHEMA ||
      value.status !== "ok" || value.version !== WORKBENCH_VERSION ||
      typeof value.launchId !== "string" ||
      !LAUNCH_ID_PATTERN.test(value.launchId) ||
      typeof value.configDigest !== "string" ||
      !CONFIG_DIGEST_PATTERN.test(value.configDigest) ||
      value.workspaceId !== WORKBENCH_WORKSPACE_ID
    ) return undefined;
    return structuredClone(value as unknown as WorkbenchHealthDocument);
  } catch {
    return undefined;
  }
}

async function probeListenerPresence(
  fetchImpl: typeof fetch,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<"present" | "absent" | "ambiguous"> {
  try {
    await fetchImpl(`${WORKBENCH_ORIGIN}/healthz`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return "present";
  } catch (error) {
    return isConnectionRefused(error) ? "absent" : "ambiguous";
  }
}

function isConnectionRefused(error: unknown, depth = 0): boolean {
  if (depth > 4) return false;
  if (
    error instanceof Deno.errors.ConnectionRefused ||
    (error instanceof Error &&
      /\b(?:ECONNREFUSED|connection refused)\b/i.test(error.message))
  ) return true;
  if (isRecord(error)) {
    if (error.code === "ECONNREFUSED" || error.name === "ConnectionRefused") {
      return true;
    }
    if (Object.hasOwn(error, "cause")) {
      return isConnectionRefused(error.cause, depth + 1);
    }
  }
  return false;
}

function parseMarker(value: Record<string, unknown>): WorkbenchMarker {
  exactKeys(value, [
    "schema",
    "version",
    "launchId",
    "pid",
    "configDigest",
    "tokenDigest",
    "startedAt",
  ]);
  if (
    value.schema !== WORKBENCH_MARKER_SCHEMA ||
    value.version !== WORKBENCH_VERSION ||
    typeof value.launchId !== "string" || !LAUNCH_ID_PATTERN.test(value.launchId) ||
    !Number.isSafeInteger(value.pid) || (value.pid as number) < 1 ||
    typeof value.configDigest !== "string" ||
    !CONFIG_DIGEST_PATTERN.test(value.configDigest) ||
    typeof value.tokenDigest !== "string" ||
    !CONFIG_DIGEST_PATTERN.test(value.tokenDigest) ||
    typeof value.startedAt !== "string" || Number.isNaN(Date.parse(value.startedAt))
  ) throw new TypeError("Workbench marker is invalid.");
  return structuredClone(value as unknown as WorkbenchMarker);
}

function ready(
  lifecycle: "owned-ready" | "reconnected-ready",
  accessToken: string,
): WorkbenchHostResult {
  return Object.freeze({
    projection: Object.freeze({ lifecycle, version: WORKBENCH_VERSION }),
    session: Object.freeze({ origin: WORKBENCH_ORIGIN, accessToken }),
  });
}

function unavailable(
  recoveryCode: NonNullable<DesktopWorkbenchProjection["recoveryCode"]>,
  recoveryRequired = false,
): WorkbenchHostResult {
  return Object.freeze({
    projection: Object.freeze({
      lifecycle: recoveryRequired ? "recovery-required" : "unavailable",
      recoveryCode,
    }),
  });
}

async function stopHandle(
  handle: WorkbenchOwnedHandle,
  timeoutMs: number,
): Promise<boolean> {
  handle.closeStdin();
  if (await waitForExit(handle, timeoutMs)) return true;
  handle.kill("SIGTERM");
  if (await waitForExit(handle, timeoutMs)) return true;
  handle.kill("SIGKILL");
  return await waitForExit(handle, timeoutMs);
}

async function waitForExit(
  handle: WorkbenchOwnedHandle,
  timeoutMs: number,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      handle.status.then(() => true, () => false),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) throw new TypeError("Workbench document contains unsupported fields.");
}
