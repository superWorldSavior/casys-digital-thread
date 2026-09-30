import { fileURLToPath } from "node:url";
import { dirname, relative, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { defineConfig, type Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";
import {
  FORBIDDEN_WORKBENCH_AUTHORITY_MARKERS,
  WORKBENCH_GRAPH_ROOT,
  type WorkbenchAuthorityGraph,
} from "../../scripts/gates/workbench-authority-graph.ts";

const MCP_APP_SCRIPT_NONCE_META_NAME = "casys-mcp-app-script-nonce";

function trimGeneratedHtml(): Plugin {
  return {
    name: "trim-generated-html",
    enforce: "post",
    generateBundle(_, bundle) {
      for (const output of Object.values(bundle)) {
        if (
          output.type === "asset" && output.fileName.endsWith(".html") &&
          typeof output.source === "string"
        ) {
          output.source = output.source
            .replace(/^[ ]+\t/gm, "\t")
            .replace(/[ \t]+$/gm, "");
        }
      }
    },
  };
}

function workbenchRootRewrite(): Plugin {
  return {
    name: "workbench-root-rewrite",
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (request.url === "/" || request.url === "") {
          request.url = "/native-workbench.html";
        }
        next();
      });
    },
  };
}

function developmentMcpAppScriptNonce(): Plugin {
  const nonce = randomBytes(32).toString("base64url");
  if (!/^[A-Za-z0-9_-]{43}$/.test(nonce)) {
    throw new Error("Vite could not create the Workbench MCP App nonce.");
  }
  return {
    name: "development-mcp-app-script-nonce",
    apply: "serve",
    transformIndexHtml: {
      order: "pre",
      handler: () => [{
        tag: "meta",
        attrs: { name: MCP_APP_SCRIPT_NONCE_META_NAME, content: nonce },
        injectTo: "head-prepend",
      }],
    },
  };
}

/** Build evidence follows Workbench imports, excluding its sibling DesktopChat. */
function workbenchAuthorityGraph(): Plugin {
  return {
    name: "workbench-authority-graph",
    apply: "build",
    generateBundle() {
      const repoRoot = resolve(root, "../..");
      const workbenchId = resolve(repoRoot, WORKBENCH_GRAPH_ROOT);
      const normalizedId = (id: string) =>
        id.startsWith(repoRoot) ? relative(repoRoot, id) : id;
      const seen = new Set<string>();
      const modules: WorkbenchAuthorityGraph["modules"][number][] = [];
      const pending = [workbenchId];
      while (pending.length > 0) {
        const id = pending.pop()!;
        if (seen.has(id)) continue;
        const info = this.getModuleInfo(id);
        if (info === null || info.code === null) {
          this.error(`Workbench authority graph cannot resolve ${id}.`);
        }
        seen.add(id);
        const imports = [...info.importedIds, ...info.dynamicallyImportedIds];
        const semantic = new Set<string>();
        collectSemanticStrings(this.parse(info.code), semantic);
        modules.push({
          id: normalizedId(id),
          imports: imports.map(normalizedId).sort(),
          markers: FORBIDDEN_WORKBENCH_AUTHORITY_MARKERS.filter((marker) =>
            [...semantic].some((token) => token.includes(marker))
          ),
        });
        pending.push(...imports);
      }
      const graph: WorkbenchAuthorityGraph = {
        version: 1,
        root: WORKBENCH_GRAPH_ROOT,
        modules: modules.sort((a, b) => a.id.localeCompare(b.id)),
      };
      this.emitFile({
        type: "asset",
        fileName: "workbench-authority-graph.json",
        source: JSON.stringify(graph),
      });
    },
  };
}

/** AST nodes omit comments, including the read-only host's negative examples. */
function collectSemanticStrings(node: unknown, strings: Set<string>): void {
  if (Array.isArray(node)) {
    for (const child of node) collectSemanticStrings(child, strings);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  if (record.type === "ImportExpression") {
    const source = record.source as Record<string, unknown> | undefined;
    if (
      (source?.type !== "Literal" && source?.type !== "StringLiteral") ||
      typeof source.value !== "string"
    ) {
      throw new Error(
        "Workbench authority graph has an unresolved dynamic import.",
      );
    }
  }
  if (typeof record.type === "string") {
    if (typeof record.name === "string") strings.add(record.name);
    if (typeof record.value === "string") strings.add(record.value);
    if (record.type === "TemplateElement") {
      const value = record.value as Record<string, unknown> | undefined;
      if (typeof value?.raw === "string") strings.add(value.raw);
      if (typeof value?.cooked === "string") strings.add(value.cooked);
    }
  }
  for (const [key, value] of Object.entries(record)) {
    if (key !== "comments" && typeof value === "object") {
      collectSemanticStrings(value, strings);
    }
  }
}

const root = dirname(fileURLToPath(import.meta.url));
const workbenchBffPort = environmentPort("CASYS_COCKPIT_BFF_PORT", 5175);
const nativeUiPort = environmentPort("CASYS_COCKPIT_UI_PORT", 5173);
const workbenchBffOrigin = `http://127.0.0.1:${workbenchBffPort}`;

function environmentPort(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  const port = Number(value);
  if (port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return port;
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    trimGeneratedHtml(),
    workbenchAuthorityGraph(),
    workbenchRootRewrite(),
    developmentMcpAppScriptNonce(),
  ],
  base: "./",
  /**
   * Le cockpit rend en Preact. Ark UI ne publie pas de paquet Preact : on
   * garde `@ark-ui/react` et on redirige react/react-dom vers `preact/compat`,
   * de sorte qu'aucun react-dom n'entre dans le bundle.
   */
  resolve: {
    alias: {
      "react/jsx-runtime": "preact/jsx-runtime",
      "react/jsx-dev-runtime": "preact/jsx-dev-runtime",
      "react-dom/client": "preact/compat/client",
      "react-dom/test-utils": "preact/test-utils",
      "react-dom": "preact/compat",
      react: "preact/compat",
    },
  },
  server: {
    host: "127.0.0.1",
    port: nativeUiPort,
    strictPort: true,
    open: "/native-workbench.html",
    proxy: {
      "/api": {
        target: workbenchBffOrigin,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist/thread",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(root, "native-workbench.html"),
    },
  },
});
