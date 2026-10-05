import { createHash } from "node:crypto";
import pins from "../../chat-runtime/pins.json" with { type: "json" };
import { MACOS_MINIMUM_SYSTEM_VERSION } from "./macos-bundle-contract.ts";
import { resolveTargetArtifacts } from "../chat-host/target.ts";

const NPM = "/opt/homebrew/bin/npm";
const TAR = "/usr/bin/tar";
const OTOOL = "/usr/bin/otool";
const CLANG = "/usr/bin/clang";
const CHAT_RUNTIME_STAGE = "dist/chat-host-runtime";
const CHAT_HOST_EXECUTABLE = "dist/helpers/casys-chat-host";
const TARGET = "darwin-arm64" as const;
const target = resolveTargetArtifacts(TARGET);
const ACPX_ARCHIVE_URL =
  `https://codeload.github.com/Casys-AI/acpx/tar.gz/${pins.acpx.commit}`;

if (Deno.build.os !== "darwin" || Deno.build.arch !== "aarch64") {
  throw new Error("Lot 4 Chat Host packaging currently targets darwin-arm64 only.");
}
await assertCommandVersion(NPM, ["--version"], pins.packageManager.npmVersion);

const temporaryRoot = await Deno.makeTempDir({
  dir: "/tmp",
  prefix: "casys-chat-runtime-",
});
try {
  const archivePath = `${temporaryRoot}/acpx.tgz`;
  const response = await fetch(ACPX_ARCHIVE_URL, { redirect: "error" });
  if (!response.ok) throw new Error(`acpx archive download failed: ${response.status}`);
  const archive = new Uint8Array(await response.arrayBuffer());
  const archiveDigest = sha256(archive);
  if (archiveDigest !== pins.acpx.archiveSha256) {
    throw new Error("acpx commit archive digest does not match the Lot 4 pin.");
  }
  await Deno.writeFile(archivePath, archive, { mode: 0o600 });
  await run(TAR, ["-xzf", archivePath, "-C", temporaryRoot]);
  const sourceRoot = await findExtractedAcpxRoot(temporaryRoot);
  const nodeArchivePath = `${temporaryRoot}/node.tgz`;
  const nodeResponse = await fetch(target.nodeArchive, { redirect: "error" });
  if (!nodeResponse.ok) {
    throw new Error(`Node archive download failed: ${nodeResponse.status}`);
  }
  const nodeArchive = new Uint8Array(await nodeResponse.arrayBuffer());
  if (sha256(nodeArchive) !== target.nodeArchiveSha256) {
    throw new Error("official Node archive digest does not match the Lot 4 pin.");
  }
  await Deno.writeFile(nodeArchivePath, nodeArchive, { mode: 0o600 });
  await run(TAR, ["-xzf", nodeArchivePath, "-C", temporaryRoot]);
  const officialNode =
    `${temporaryRoot}/node-v${pins.nodeVersion}-darwin-arm64/bin/node`;
  await assertFileDigest(
    officialNode,
    target.nodeBinarySha256,
    "official Node runtime",
  );
  await assertPortableNode(officialNode);

  await runPnpm(sourceRoot, ["install", "--frozen-lockfile"]);
  await runPnpm(sourceRoot, ["build"]);
  await assertFileDigest(
    `${sourceRoot}/dist/runtime.js`,
    pins.acpx.runtimeSha256,
    "acpx/runtime",
  );
  await assertFileDigest(
    `${sourceRoot}/dist/native/lifeline`,
    target.acpxLifelineSha256,
    "acpx lifeline",
  );

  await Deno.remove(CHAT_RUNTIME_STAGE, { recursive: true }).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  });
  await Deno.mkdir(`${CHAT_RUNTIME_STAGE}/adapter`, {
    recursive: true,
    mode: 0o700,
  });
  await Deno.mkdir("dist/helpers", { recursive: true, mode: 0o700 });
  await runPnpm(sourceRoot, [
    "--dir",
    sourceRoot,
    "--filter",
    "acpx",
    "deploy",
    "--prod",
    "--legacy",
    `${Deno.cwd()}/${CHAT_RUNTIME_STAGE}/acpx`,
  ]);

  await Deno.copyFile(
    "chat-runtime/package.json",
    `${CHAT_RUNTIME_STAGE}/adapter/package.json`,
  );
  await Deno.copyFile(
    "chat-runtime/package-lock.json",
    `${CHAT_RUNTIME_STAGE}/adapter/package-lock.json`,
  );
  await run(NPM, ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: `${Deno.cwd()}/${CHAT_RUNTIME_STAGE}/adapter`,
  });

  await run("deno", [
    "bundle",
    "--config=deno.json",
    "--deny-import",
    "src/chat-host/main.ts",
    "--output",
    `${CHAT_RUNTIME_STAGE}/main.mjs`,
  ]);
  await Deno.copyFile(officialNode, `${CHAT_RUNTIME_STAGE}/node`);
  await Deno.chmod(`${CHAT_RUNTIME_STAGE}/node`, 0o755);
  await run(CLANG, [
    "-Os",
    "-Wall",
    "-Wextra",
    "-Werror",
    `-mmacosx-version-min=${MACOS_MINIMUM_SYSTEM_VERSION}`,
    "src/build/chat-host-launcher.c",
    "-o",
    CHAT_HOST_EXECUTABLE,
  ]);

  const adapterEntry =
    `${CHAT_RUNTIME_STAGE}/adapter/node_modules/@agentclientprotocol/codex-acp/dist/index.js`;
  const codexExecutable =
    `${CHAT_RUNTIME_STAGE}/adapter/node_modules/${target.codexPackage}/${target.codexBinaryPath}`;
  await assertFileDigest(
    codexExecutable,
    target.codexBinarySha256,
    "packaged Codex executable",
  );
  const museAdapterEntry =
    `${CHAT_RUNTIME_STAGE}/adapter/node_modules/@bex-co/muse-code-acp/dist/index.js`;
  await assertFileDigest(
    museAdapterEntry,
    pins.adapterMuse.entrySha256,
    "packaged Muse adapter entry",
  );
  const manifest = {
    schemaVersion: "casys-chat-host-bundle/1.0",
    target: TARGET,
    targetStatus: "implemented-tested",
    nodeVersion: pins.nodeVersion,
    acpxVersion: pins.acpx.version,
    acpxCommit: pins.acpx.commit,
    adapterVersion: pins.adapter.version,
    codexPackageVersion: pins.adapter.codexPackageVersion,
    museAdapterVersion: pins.adapterMuse.version,
    files: {
      node: {
        path: "node",
        sha256: await fileSha256(`${CHAT_RUNTIME_STAGE}/node`),
      },
      launcher: {
        path: "../../Helpers/casys-chat-host",
        sha256: await fileSha256(CHAT_HOST_EXECUTABLE),
      },
      entry: {
        path: "main.mjs",
        sha256: await fileSha256(`${CHAT_RUNTIME_STAGE}/main.mjs`),
      },
      acpxRuntime: {
        path: "acpx/dist/runtime.js",
        sha256: await fileSha256(`${CHAT_RUNTIME_STAGE}/acpx/dist/runtime.js`),
      },
      acpxLifeline: {
        path: "acpx/dist/native/lifeline",
        sha256: await fileSha256(`${CHAT_RUNTIME_STAGE}/acpx/dist/native/lifeline`),
      },
      adapter: {
        path: "adapter/node_modules/@agentclientprotocol/codex-acp/dist/index.js",
        sha256: await fileSha256(adapterEntry),
      },
      codexExecutable: {
        path: `adapter/node_modules/${target.codexPackage}/${target.codexBinaryPath}`,
        sha256: await fileSha256(codexExecutable),
      },
      museAdapter: {
        path: "adapter/node_modules/@bex-co/muse-code-acp/dist/index.js",
        sha256: await fileSha256(museAdapterEntry),
      },
    },
  };
  await Deno.writeTextFile(
    `${CHAT_RUNTIME_STAGE}/bundle-manifest.json`,
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(
    `Prepared Chat Host acpx ${pins.acpx.version}@${
      pins.acpx.commit.slice(0, 7)
    } with adapters codex ${pins.adapter.version} and muse ${pins.adapterMuse.version}.`,
  );
} finally {
  await Deno.remove(temporaryRoot, { recursive: true });
}

async function runPnpm(cwd: string, args: readonly string[]): Promise<void> {
  await run(NPM, [
    "exec",
    "--yes",
    `pnpm@${pins.packageManager.pnpmVersion}`,
    "--",
    ...args,
  ], { cwd });
}

async function run(
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string } = {},
): Promise<void> {
  const output = await new Deno.Command(command, {
    args: [...args],
    cwd: options.cwd,
    stdin: "null",
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!output.success) {
    throw new Error(`${command} failed with code ${output.code}`);
  }
}

async function assertCommandVersion(
  command: string,
  args: readonly string[],
  expected: string,
): Promise<void> {
  const output = await new Deno.Command(command, {
    args: [...args],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  const actual = new TextDecoder().decode(output.stdout).trim();
  if (!output.success || actual !== expected) {
    throw new Error(
      `${command} must report exact version ${expected}; got ${actual || "error"}.`,
    );
  }
}

async function assertPortableNode(path: string): Promise<void> {
  const output = await new Deno.Command(OTOOL, {
    args: ["-L", path],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) throw new Error("otool rejected the official Node runtime.");
  const lines = new TextDecoder().decode(output.stdout).split("\n").slice(1)
    .map((line) => line.trim()).filter(Boolean);
  if (
    lines.length === 0 ||
    lines.some((line) =>
      line.startsWith("@rpath/") || line.includes("/opt/homebrew/") ||
      (!line.startsWith("/System/Library/") && !line.startsWith("/usr/lib/"))
    )
  ) {
    throw new Error("official Node runtime has a non-system dynamic dependency.");
  }
  const loadCommands = await new Deno.Command(OTOOL, {
    args: ["-l", path],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!loadCommands.success) {
    throw new Error("otool could not read Node load commands.");
  }
  const loadText = new TextDecoder().decode(loadCommands.stdout);
  const match = loadText.match(/cmd LC_BUILD_VERSION[\s\S]*?\n\s*minos\s+([0-9.]+)/);
  if (match === null || compareVersions(match[1], MACOS_MINIMUM_SYSTEM_VERSION) > 0) {
    throw new Error(
      `official Node minimum macOS ${
        match?.[1] ?? "unknown"
      } exceeds ${MACOS_MINIMUM_SYSTEM_VERSION}.`,
    );
  }
}

function compareVersions(left: string, right: string): number {
  const lhs = left.split(".").map(Number);
  const rhs = right.split(".").map(Number);
  for (let index = 0; index < Math.max(lhs.length, rhs.length); index++) {
    const difference = (lhs[index] ?? 0) - (rhs[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

async function findExtractedAcpxRoot(root: string): Promise<string> {
  const expectedPrefix = "acpx-";
  const entries = [];
  for await (const entry of Deno.readDir(root)) {
    if (entry.isDirectory && entry.name.startsWith(expectedPrefix)) {
      entries.push(entry.name);
    }
  }
  if (entries.length !== 1) {
    throw new Error("acpx archive has an unexpected root layout.");
  }
  return `${root}/${entries[0]}`;
}

async function assertFileDigest(
  path: string,
  expected: string,
  label: string,
): Promise<void> {
  const actual = await fileSha256(path);
  if (actual !== expected) throw new Error(`${label} digest mismatch: ${actual}.`);
}

async function fileSha256(path: string): Promise<string> {
  return sha256(await Deno.readFile(path));
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
