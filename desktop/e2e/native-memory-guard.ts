/**
 * Manual macOS guard for native Desktop qualification.
 *
 * The guard launches the exact target itself so its ChildProcess handle remains
 * the authority for signaling the root process. Descendants are pinned by PID
 * and start time before they can be signaled. Samples and lifecycle events are
 * written as JSONL, but a logging failure never disables the memory bound.
 */

const PS = "/bin/ps";
const KILL = "/bin/kill";
const FOOTPRINT = "/usr/bin/footprint";
const SYSCTL = "/usr/sbin/sysctl";
const COMMAND_TIMEOUT_MS = 3_000;

export interface NativeMemoryGuardOptions {
  readonly targetPath: string;
  readonly targetArgs: readonly string[];
  readonly targetHome?: string;
  readonly logPath: string;
  readonly warnBytes: number;
  readonly stopBytes: number;
  /** Net system-wide swap growth; this is a safety bound, not target attribution. */
  readonly systemSwapGrowthStopBytes: number;
  readonly intervalMs: number;
  readonly footprintIntervalMs: number;
  readonly graceMs: number;
}

export interface ProcessRow {
  readonly pid: number;
  readonly parentPid: number;
  readonly rssBytes: number;
  readonly startedAt: string;
}

interface GuardSample {
  readonly at: string;
  readonly pid: number;
  readonly processCount: number;
  readonly treeRssBytes: number;
  readonly footprintBytes: number;
  readonly systemSwapUsedBytes: number;
  readonly systemSwapNetGrowthBytes: number;
}

interface TargetState {
  status?: Deno.CommandStatus;
}

type GuardLog = (value: Record<string, unknown>) => Promise<void>;

if (import.meta.main) {
  await guardNativeProcess(parseOptions(Deno.args));
}

export async function guardNativeProcess(
  options: NativeMemoryGuardOptions,
): Promise<void> {
  validateOptions(options);
  const logFile = await Deno.open(options.logPath, {
    create: true,
    append: true,
    write: true,
    mode: 0o600,
  });
  const write = bestEffortJsonlWriter(logFile);
  let target: Deno.ChildProcess | undefined;
  const known = new Map<string, ProcessRow>();
  const state: TargetState = {};
  try {
    // Fail before launch if the two mandatory safety sensors are unavailable.
    await readProcessRows();
    const initialSwap = await readSwapUsedBytes();
    target = new Deno.Command(options.targetPath, {
      args: [...options.targetArgs],
      ...(options.targetHome === undefined
        ? {}
        : { env: { HOME: options.targetHome } }),
      stdin: "null",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn();
    const status = target.status.then((value) => {
      state.status = value;
      return value;
    });
    const root = await waitForRoot(target.pid, state);
    if (root === undefined) {
      const exited = await status;
      await write({
        event: "target-exited-before-monitoring",
        at: new Date().toISOString(),
        pid: target.pid,
        status: exited,
      });
      return;
    }
    known.set(processKey(root), root);
    await write({
      event: "guard-started",
      at: new Date().toISOString(),
      pid: target.pid,
      targetPath: options.targetPath,
      targetStartedAt: root.startedAt,
      warnBytes: options.warnBytes,
      stopBytes: options.stopBytes,
      systemSwapGrowthStopBytes: options.systemSwapGrowthStopBytes,
      intervalMs: options.intervalMs,
      footprintIntervalMs: options.footprintIntervalMs,
      graceMs: options.graceMs,
      initialSystemSwapUsedBytes: initialSwap,
    });

    let warned = false;
    let lastFootprintAt = 0;
    let footprintBytes = 0;
    while (true) {
      let rows: readonly ProcessRow[];
      try {
        rows = await readProcessRows();
      } catch (error) {
        await write({
          event: "monitoring-unavailable",
          at: new Date().toISOString(),
          sensor: "process-list",
          error: readError(error),
        });
        await stopOwnedTree(target, root, known, state, options.graceMs, write);
        return;
      }
      const currentRoot = matchingProcess(rows, root);
      if (currentRoot === undefined) {
        await stopSurvivingDescendants(known, options.graceMs, write);
        const exited = await status;
        await write({
          event: "target-exited",
          at: new Date().toISOString(),
          pid: root.pid,
          status: exited,
        });
        return;
      }
      const tree = processTree(rows, root.pid);
      for (const row of tree) known.set(processKey(row), row);
      const now = Date.now();
      const treeRssBytes = tree.reduce((total, row) => total + row.rssBytes, 0);
      let reason = treeRssBytes >= options.stopBytes ? "memory-bound" : undefined;
      try {
        if (now - lastFootprintAt >= options.footprintIntervalMs) {
          footprintBytes = await readFootprintBytes(root.pid);
          lastFootprintAt = now;
        }
      } catch (error) {
        reason = "footprint-unavailable";
        await write({
          event: "monitoring-unavailable",
          at: new Date().toISOString(),
          sensor: "footprint",
          error: readError(error),
        });
      }
      let systemSwapUsedBytes = initialSwap;
      try {
        systemSwapUsedBytes = await readSwapUsedBytes();
      } catch (error) {
        reason = "system-swap-unavailable";
        await write({
          event: "monitoring-unavailable",
          at: new Date().toISOString(),
          sensor: "system-swap",
          error: readError(error),
        });
      }
      const sample: GuardSample = {
        at: new Date(now).toISOString(),
        pid: root.pid,
        processCount: tree.length,
        treeRssBytes,
        footprintBytes,
        systemSwapUsedBytes,
        systemSwapNetGrowthBytes: Math.max(0, systemSwapUsedBytes - initialSwap),
      };
      const measuredBytes = Math.max(treeRssBytes, footprintBytes);
      if (reason === undefined && measuredBytes >= options.stopBytes) {
        reason = "memory-bound";
      }
      if (
        reason === undefined &&
        sample.systemSwapNetGrowthBytes >= options.systemSwapGrowthStopBytes
      ) {
        reason = "system-swap-net-growth-bound";
      }
      await write({ event: "sample", ...sample });
      if (!warned && measuredBytes >= options.warnBytes) {
        warned = true;
        console.error(
          `[memory-guard] warning: ${formatMib(measuredBytes)} MiB for PID ${root.pid}`,
        );
        await write({ event: "warning", measuredBytes, ...sample });
      }
      if (reason !== undefined) {
        console.error(`[memory-guard] stopping PID ${root.pid}: ${reason}`);
        await write({ event: "stop-requested", reason, measuredBytes, ...sample });
        await stopOwnedTree(target, root, known, state, options.graceMs, write);
        return;
      }
      await delay(options.intervalMs);
    }
  } finally {
    if (target !== undefined && state.status === undefined) {
      try {
        target.kill("SIGKILL");
      } catch {
        // The owned child may have exited between the final sample and cleanup.
      }
      await target.status.catch(() => undefined);
    }
    logFile.close();
  }
}

export function parseProcessRows(text: string): readonly ProcessRow[] {
  return text.split("\n").flatMap((line): ProcessRow[] => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/);
    if (match === null) return [];
    return [{
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      rssBytes: Number(match[3]) * 1024,
      startedAt: match[4].trim(),
    }];
  });
}

export function processTree(
  rows: readonly ProcessRow[],
  rootPid: number,
): readonly ProcessRow[] {
  const retained = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (!retained.has(row.pid) && retained.has(row.parentPid)) {
        retained.add(row.pid);
        changed = true;
      }
    }
  }
  return rows.filter((row) => retained.has(row.pid));
}

export function parseFootprintBytes(text: string): number | undefined {
  const summary = text.match(/Summary Footprint:\s+(\d+) B/);
  if (summary !== null) return Number(summary[1]);
  const single = text.match(/Footprint:\s+(\d+) B/);
  return single === null ? undefined : Number(single[1]);
}

export function parseSwapUsedBytes(text: string): number {
  const match = text.match(/used\s*=\s*([0-9.]+)([KMGTP])/i);
  if (match === null) throw new Error("macOS swap usage output is invalid");
  const powers: Record<string, number> = { K: 1, M: 2, G: 3, T: 4, P: 5 };
  return Number(match[1]) * 1024 ** powers[match[2].toUpperCase()];
}

function bestEffortJsonlWriter(file: Deno.FsFile): GuardLog {
  const encoder = new TextEncoder();
  let healthy = true;
  return async (value) => {
    if (!healthy) return;
    const bytes = encoder.encode(`${JSON.stringify(value)}\n`);
    try {
      let offset = 0;
      while (offset < bytes.length) {
        const written = await file.write(bytes.subarray(offset));
        if (written === 0) throw new Error("guard log made no write progress");
        offset += written;
      }
    } catch (error) {
      healthy = false;
      console.error(`[memory-guard] log unavailable: ${readError(error)}`);
    }
  };
}

async function waitForRoot(
  pid: number,
  state: TargetState,
): Promise<ProcessRow | undefined> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const root = (await readProcessRows()).find((row) => row.pid === pid);
    if (root !== undefined) return root;
    if (state.status !== undefined) return undefined;
    await delay(25);
  }
  throw new Error("owned target did not appear in the process table");
}

async function readProcessRows(): Promise<readonly ProcessRow[]> {
  const output = await command(PS, ["-axo", "pid=,ppid=,rss=,lstart="]);
  return parseProcessRows(output);
}

async function readFootprintBytes(pid: number): Promise<number> {
  const output = await command(FOOTPRINT, [
    "-p",
    String(pid),
    "-t",
    "--noCategories",
    "-f",
    "bytes",
    "--swapped",
  ]);
  const value = parseFootprintBytes(output);
  if (value === undefined) throw new Error("macOS footprint output is invalid");
  return value;
}

async function readSwapUsedBytes(): Promise<number> {
  return parseSwapUsedBytes(await command(SYSCTL, ["vm.swapusage"]));
}

async function command(program: string, args: readonly string[]): Promise<string> {
  const output = await new Deno.Command(program, {
    args: [...args],
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
  }).output();
  if (!output.success) throw new Error(`${program} failed with code ${output.code}`);
  return new TextDecoder().decode(output.stdout);
}

async function stopOwnedTree(
  target: Deno.ChildProcess,
  root: ProcessRow,
  known: Map<string, ProcessRow>,
  state: TargetState,
  graceMs: number,
  write: GuardLog,
): Promise<void> {
  await addCurrentTree(root, known);
  await signalKnownDescendants(known, root, "SIGTERM");
  signalOwnedTarget(target, state, "SIGTERM");
  if (await waitForKnownExit(known, state, graceMs)) {
    await write({
      event: "target-stopped",
      at: new Date().toISOString(),
      signal: "SIGTERM",
    });
    return;
  }
  await addCurrentTree(root, known);
  await signalKnownDescendants(known, root, "SIGKILL");
  signalOwnedTarget(target, state, "SIGKILL");
  if (await waitForKnownExit(known, state, graceMs)) {
    await write({
      event: "target-killed",
      at: new Date().toISOString(),
      signal: "SIGKILL",
    });
    return;
  }
  await write({
    event: "target-stop-unresolved",
    at: new Date().toISOString(),
  });
  throw new Error("native target tree termination remained unresolved");
}

async function stopSurvivingDescendants(
  known: Map<string, ProcessRow>,
  graceMs: number,
  write: GuardLog,
): Promise<void> {
  const survivors = await matchingKnownProcesses(known);
  if (survivors.length === 0) return;
  await write({
    event: "orphaned-descendants",
    at: new Date().toISOString(),
    processes: survivors.map((row) => ({ pid: row.pid, startedAt: row.startedAt })),
  });
  for (const row of [...survivors].reverse()) await signalExact(row, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if ((await matchingKnownProcesses(known)).length === 0) return;
    await delay(Math.min(250, graceMs));
  }
  for (const row of [...await matchingKnownProcesses(known)].reverse()) {
    await signalExact(row, "SIGKILL");
  }
  if ((await matchingKnownProcesses(known)).length !== 0) {
    throw new Error("orphaned native descendants remained after SIGKILL");
  }
}

async function addCurrentTree(
  root: ProcessRow,
  known: Map<string, ProcessRow>,
): Promise<void> {
  const rows = await readProcessRows().catch(() => []);
  if (matchingProcess(rows, root) === undefined) return;
  for (const row of processTree(rows, root.pid)) known.set(processKey(row), row);
}

async function signalKnownDescendants(
  known: Map<string, ProcessRow>,
  root: ProcessRow,
  signal: Deno.Signal,
): Promise<void> {
  const living = await matchingKnownProcesses(known);
  for (const row of living.filter((row) => row.pid !== root.pid).reverse()) {
    await signalExact(row, signal);
  }
}

function signalOwnedTarget(
  target: Deno.ChildProcess,
  state: TargetState,
  signal: Deno.Signal,
): void {
  if (state.status !== undefined) return;
  try {
    target.kill(signal);
  } catch {
    // ChildProcess owns the root identity; an already-exited child needs no signal.
  }
}

async function signalExact(row: ProcessRow, signal: Deno.Signal): Promise<void> {
  const current = matchingProcess(await readProcessRows(), row);
  if (current === undefined) return;
  const output = await new Deno.Command(KILL, {
    args: [`-${signal}`, String(row.pid)],
    stdout: "null",
    stderr: "null",
    signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
  }).output();
  if (!output.success && matchingProcess(await readProcessRows(), row) !== undefined) {
    throw new Error(`${KILL} failed with code ${output.code}`);
  }
}

async function waitForKnownExit(
  known: Map<string, ProcessRow>,
  state: TargetState,
  graceMs: number,
): Promise<boolean> {
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (
      state.status !== undefined && (await matchingKnownProcesses(known)).length === 0
    ) {
      return true;
    }
    await delay(Math.min(250, graceMs));
  }
  return state.status !== undefined &&
    (await matchingKnownProcesses(known)).length === 0;
}

async function matchingKnownProcesses(
  known: Map<string, ProcessRow>,
): Promise<readonly ProcessRow[]> {
  const rows = await readProcessRows();
  return [...known.values()].filter((expected) =>
    matchingProcess(rows, expected) !== undefined
  );
}

function matchingProcess(
  rows: readonly ProcessRow[],
  expected: ProcessRow,
): ProcessRow | undefined {
  return rows.find((row) =>
    row.pid === expected.pid && row.startedAt === expected.startedAt
  );
}

function processKey(row: ProcessRow): string {
  return `${row.pid}:${row.startedAt}`;
}

function parseOptions(args: readonly string[]): NativeMemoryGuardOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new TypeError("Arguments must be --name value pairs");
    }
    values.set(key.slice(2), value);
  }
  const number = (name: string, fallback?: number): number => {
    const raw = values.get(name);
    if (raw === undefined && fallback !== undefined) return fallback;
    if (raw === undefined) throw new TypeError(`Missing --${name}`);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) throw new TypeError(`Invalid --${name}`);
    return parsed;
  };
  const text = (name: string): string => {
    const value = values.get(name);
    if (value === undefined) throw new TypeError(`Missing --${name}`);
    return value;
  };
  const rawArgs = values.get("target-args") ?? "[]";
  const targetArgs: unknown = JSON.parse(rawArgs);
  if (
    !Array.isArray(targetArgs) || !targetArgs.every((arg) => typeof arg === "string")
  ) {
    throw new TypeError("--target-args must be a JSON string array");
  }
  const mib = (name: string, fallback: number): number =>
    number(name, fallback) * 1024 ** 2;
  return {
    targetPath: text("target"),
    targetArgs,
    ...(values.has("target-home") ? { targetHome: text("target-home") } : {}),
    logPath: text("log"),
    warnBytes: mib("warn-mib", 4096),
    stopBytes: mib("stop-mib", 6144),
    systemSwapGrowthStopBytes: mib("system-swap-growth-mib", 2048),
    intervalMs: number("interval-ms", 2000),
    footprintIntervalMs: number("footprint-interval-ms", 10_000),
    graceMs: number("grace-ms", 5000),
  };
}

function validateOptions(options: NativeMemoryGuardOptions): void {
  for (const [name, value] of Object.entries(options)) {
    if (
      name === "targetPath" || name === "targetArgs" || name === "targetHome" ||
      name === "logPath"
    ) continue;
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`${name} must be a positive safe integer`);
    }
  }
  if (options.warnBytes >= options.stopBytes) {
    throw new TypeError("warnBytes must be lower than stopBytes");
  }
  if (options.targetPath.trim().length === 0 || options.logPath.trim().length === 0) {
    throw new TypeError("targetPath and logPath must not be empty");
  }
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown monitoring failure";
}

function formatMib(bytes: number): string {
  return (bytes / 1024 ** 2).toFixed(1);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
