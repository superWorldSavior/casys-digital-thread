import rawManifest from "./component-manifest.json" with { type: "json" };
import { createDesktopShellHandler } from "./src/application/shell-handler.ts";
import {
  drainAndExitDesktop,
  drainDesktopForWindowClose,
  installDesktopShutdownSignals,
  installDesktopWindowClose,
} from "./src/application/shutdown.ts";
import { startDesktopApplication } from "./src/application/startup.ts";
import { createWorkbenchProjectFocusAuthority } from "./src/application/workbench-project-focus.ts";
import { registerDesktopChatBindings } from "./src/chat/bindings.ts";
import { createDownloadsFileSaver } from "./src/chat/file-saver.ts";
import { connectableMcpServers } from "./src/chat/mcp-servers.ts";
import { createRegistryViewerBackend } from "./src/chat/viewer-backend.ts";
import { registerDesktopCatalogueBindings } from "./src/catalogue/bindings.ts";
import { startCatalogueService } from "./src/catalogue/startup.ts";
import { createExternalUrlOpener } from "./src/chat/external-url.ts";
import { startPackagedChatHost } from "./src/chat-host/startup.ts";
import {
  synchronizeStartupDemand,
  withToolRuntimeDemand,
} from "./src/tool-runtime/chat-demand.ts";
import {
  type LifecycleReconcileReport,
  MANAGED_TOOL_IDS,
} from "./src/tool-runtime/lifecycle.ts";
import {
  CONTROL_PLANE_PRODUCT_IDENTIFIER,
  CONTROL_PLANE_SERVER_NAME,
  ControlPlaneHost,
  createDenoControlPlanePorts,
} from "./src/control-plane/mod.ts";
import type { DesktopPlatform, EnvironmentReader } from "./src/host/mod.ts";
import { createDenoWorkbenchHost } from "./src/workbench/host.ts";

function desktopPlatform(os: typeof Deno.build.os): DesktopPlatform {
  switch (os) {
    case "darwin":
      return "macOS";
    case "windows":
      return "Windows";
    case "linux":
      return "Linux";
    default:
      throw new Error(`Deno Desktop does not support ${os}.`);
  }
}

const readEnvironment: EnvironmentReader = (name) => {
  try {
    return Deno.env.get(name);
  } catch (error) {
    // Missing named permission is represented in the recovery-required view.
    if (error instanceof Deno.errors.PermissionDenied) return undefined;
    throw error;
  }
};

const platform = desktopPlatform(Deno.build.os);
const application = await startDesktopApplication({
  manifest: rawManifest,
  actualDenoVersion: Deno.version.deno,
  // Deno Desktop ships in the same pinned runtime binary as Deno itself.
  actualDesktopRuntimeVersion: Deno.version.deno,
  actualProductVersion: Deno.desktopVersion,
  platform,
  env: readEnvironment,
  executablePath: Deno.execPath(),
}, {
  createControlPlane(launch) {
    const host = new ControlPlaneHost({
      helperPath: launch.helperPath,
      cwd: launch.launchCwd,
      platform: launch.platform,
      layoutProfile: launch.layoutProfile,
      relativeWorkspace: launch.relativeWorkspace,
      expected: {
        productIdentifier: CONTROL_PLANE_PRODUCT_IDENTIFIER,
        productVersion: launch.productVersion,
        serverName: CONTROL_PLANE_SERVER_NAME,
        serverVersion: launch.controlPlaneVersion,
      },
      ports: createDenoControlPlanePorts(launch.platform),
    });
    return {
      async start() {
        return (await host.startResult()).projection;
      },
      stop: () => host.stop(),
    };
  },
  createWorkbench(launch) {
    const host = createDenoWorkbenchHost(
      launch.helperPath,
      launch.launchCwd,
      launch.layoutProfile,
    );
    return {
      start: () => host.start(),
      stop: () => host.stop(),
    };
  },
});

const browserWindow = new Deno.BrowserWindow();
const chatHost = await startPackagedChatHost({
  launchable: application.chatHostLaunchable,
  executablePath: Deno.execPath(),
  platform,
  arch: Deno.build.arch,
  env: readEnvironment,
  childEnv: chatHostEnvironment,
});
const startedCatalogue = await startCatalogueService({
  platform,
  env: readEnvironment,
  onProviderStopped: (toolId) => {
    void chatHost?.mcpRelease(toolId).catch(() => undefined);
  },
});
const catalogue = startedCatalogue?.service;
const lifecycle = startedCatalogue?.lifecycle;
if (lifecycle !== undefined) {
  for (const toolId of MANAGED_TOOL_IDS) {
    const report = await lifecycle.reconcile(toolId);
    reportLifecycleReconcile(report);
  }
  await synchronizeStartupDemand(chatHost, lifecycle, MANAGED_TOOL_IDS);
}
registerDesktopChatBindings(
  browserWindow,
  chatHost === undefined || lifecycle === undefined
    ? chatHost
    : withToolRuntimeDemand(chatHost, lifecycle),
  createExternalUrlOpener(platform),
  application.workbenchSession === undefined
    ? undefined
    : createWorkbenchProjectFocusAuthority(application.workbenchSession),
  createRegistryViewerBackend({
    servers: connectableMcpServers(),
    // Always present: without a lifecycle every server resolves unassigned
    // and reads fail closed instead of hitting a stale fleet address.
    resolveEndpoint: (server) => lifecycle?.resolveEndpoint(server),
  }),
  createDownloadsFileSaver(readEnvironment("HOME")),
);
registerDesktopCatalogueBindings(browserWindow, catalogue);

let server: Deno.HttpServer;
try {
  server = Deno.serve(
    createDesktopShellHandler(
      application.model,
      application.workbenchSession,
    ),
  );
} catch (error) {
  await application.stop().catch(() => undefined);
  throw error;
}
const signalShutdown = Promise.withResolvers<void>();
const windowShutdown = Promise.withResolvers<void>();
const windowClose = installDesktopWindowClose(browserWindow, () => {
  windowShutdown.resolve();
});
const cleanupSignals = installDesktopShutdownSignals(() => {
  signalShutdown.resolve();
}, {
  add: (signal, listener) => Deno.addSignalListener(signal, listener),
  remove: (signal, listener) => Deno.removeSignalListener(signal, listener),
});

let resourcesDrained = false;
try {
  while (true) {
    const outcome = await Promise.race([
      server.finished.then(() => "server" as const),
      signalShutdown.promise.then(() => "signal" as const),
      windowShutdown.promise.then(() => "window" as const),
    ]);
    if (outcome === "server") break;
    if (outcome === "signal") {
      await drainAndExitDesktop({
        stopApplication: stopDesktopResources,
        shutdownServer: () => server.shutdown(),
        exitProcess: (code) => Deno.exit(code),
      });
      resourcesDrained = true;
      break;
    }
    const drained = await drainDesktopForWindowClose({
      stopApplication: stopDesktopResources,
      shutdownServer: () => server.shutdown(),
    });
    if (drained.status === "drained") {
      resourcesDrained = true;
      Deno.exit(0);
    }
    console.error(
      `Desktop close cleanup failed: ${drained.stage} drain is unresolved; terminating the invisible host.`,
    );
    Deno.exit(1);
  }
} finally {
  cleanupSignals();
  windowClose.cleanup();
  if (!resourcesDrained) await stopDesktopResources();
}

/**
 * Shutdown drain policy (#57): the Chat Host stops first (bounded graceful
 * shutdown settles or cancels active turns and closes relays), then owned
 * provider containers stop. Volumes and images are always retained; every
 * unresolved stop is reported, never swallowed.
 */
async function stopDesktopResources(): Promise<void> {
  const stopped = await Promise.allSettled([
    (async () => {
      const result = await chatHost?.stop();
      if (result?.status === "unresolved") {
        throw new Error(result.reason ?? "Chat Host process exit is unresolved");
      }
    })(),
    application.stop(),
  ]);
  const errors = stopped.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : []
  );
  if (lifecycle !== undefined) {
    const drained = await lifecycle.drain();
    for (const entry of drained.unresolved) {
      errors.push(new Error(`provider drain ${entry.toolId}: ${entry.detail}`));
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "Desktop owned-resource shutdown failed");
  }
}

function reportLifecycleReconcile(report: LifecycleReconcileReport): void {
  if (
    !report.adopted && report.stoppedDuplicates === 0 && report.removedStale === 0 &&
    report.priorUnresolved.length === 0
  ) {
    return;
  }
  console.error(
    `tool-runtime reconcile ${report.toolId}: adopted=${report.adopted} ` +
      `stoppedDuplicates=${report.stoppedDuplicates} removedStale=${report.removedStale} ` +
      `priorUnresolved=${report.priorUnresolved.length} notes=${
        report.notes.join("; ")
      }`,
  );
}

function chatHostEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (
    const name of [
      "HOME",
      "XDG_CONFIG_HOME",
      "CODEX_HOME",
      "OPENAI_API_KEY",
      "META_API_KEY",
      "MUSE_CODE_EXECUTABLE",
    ] as const
  ) {
    try {
      const value = Deno.env.get(name);
      if (value !== undefined) env[name] = value;
    } catch (error) {
      if (!(error instanceof Deno.errors.PermissionDenied)) throw error;
    }
  }
  return env;
}
