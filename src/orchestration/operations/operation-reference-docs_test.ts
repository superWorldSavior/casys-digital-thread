/**
 * Skills, how-tos, and reference pages teach agents to plan with registered
 * operations. A document that cites an operation the registry does not know
 * is worse than silence: the agent will confidently propose an identifier
 * the server must refuse (the dead inspection-drone reference survived
 * exactly this way). This suite pins every operation reference in those
 * documents to the live registry, so doc drift fails a test instead of a
 * run.
 *
 * Inventory trees: `docs/reference/`, `docs/how-to/`, `.agents/skills/`.
 * Watch only pages whose backtick-quoted citations are live registry keys.
 * Pages that also cite retired identities, capability ids, or grammar globs
 * of the same shape stay listed but unwatched: an unknown citation must
 * fail, and this suite does not edit those pages.
 */
import { assert, assertEquals, assertThrows } from "@std/assert";
import { listRegisteredEngineeringOperationKeys } from "./registry.ts";

const REPO_ROOT = new URL("../../../", import.meta.url);

const INVENTORY_TREES = [
  "docs/reference/",
  "docs/how-to/",
  ".agents/skills/",
] as const;

const AGENT_WORKSPACE_REFERENCE = "docs/reference/agent/agent-workspace.md";

/** Every inventory document whose operation citations are live registry keys. */
const OPERATION_CITING_DOCUMENTS = [
  ".agents/skills/admit-and-run-engineering-source/SKILL.md",
  ".agents/skills/guide-industrial-project/SKILL.md",
  ".agents/skills/recover-engineering-run/SKILL.md",
  "docs/how-to/agents/sequence-a-syson-seed.md",
  "docs/how-to/compile/author-architecture-sysml.md",
  "docs/how-to/compile/author-project-source-workspace.md",
  "docs/how-to/compile/capture-an-agent-resource.md",
  "docs/how-to/compile/compile-brief-parameters.md",
  "docs/how-to/extend/extend-cad-closed-subset.md",
  "docs/how-to/extend/qualify-nested-cad-modules.md",
  "docs/how-to/extend/qualify-documentary-clause-response.md",
  "docs/how-to/extend/qualify-requirements-brief-trace.md",
  "docs/how-to/extend/qualify-requirements-recapture.md",
  "docs/how-to/run/recover-a-quarantined-provider-run.md",
  "docs/how-to/run/recover-prescribed-kinematics-observation.md",
  "docs/how-to/run/run-admitted-spice.md",
  "docs/how-to/verify-design/close-out-a-static-mechanical-proof.md",
  "docs/how-to/verify-design/verify-assembly-integrity.md",
  "docs/how-to/workbench/preview-native-workbench.md",
  "docs/reference/codebase/add-an-operation.md",
  "docs/reference/codebase/cad.md",
  "docs/reference/codebase/compile.md",
  "docs/reference/codebase/impact.md",
  "docs/reference/codebase/make-dfm.md",
  "docs/reference/codebase/modelica.md",
  "docs/reference/codebase/persistence-roots.md",
  "docs/reference/codebase/project-thread-record.md",
  "docs/reference/codebase/workbench-control-plane-desktop.md",
  "docs/reference/contracts/project-brief.md",
  "docs/reference/contracts/thread-viewer-sessions.md",
  "docs/reference/domains/cad/assembly-integrity.md",
  "docs/reference/domains/cad/build123d-workspace-closure-lowering-v1.md",
  "docs/reference/domains/cad/coverage.md",
  "docs/reference/domains/cad/execution-paths.md",
  "docs/reference/domains/cad/module-assembly.md",
  "docs/reference/domains/electrical/README.md",
  "docs/reference/domains/electrical/boundedness.md",
  "docs/reference/domains/electrical/spice-circuit-closed-subset-v1.md",
  "docs/reference/domains/fea/README.md",
  "docs/reference/domains/fea/calculix-static-proof-v3.md",
  "docs/reference/domains/fea/coverage.md",
  "docs/reference/domains/fea/mechanical-proof-case-source.md",
  "docs/reference/domains/fea/mechanical-proof-case-v1.md",
  "docs/reference/domains/mechanism/coverage.md",
  "docs/reference/domains/mechanism/prescribed-kinematics-case-and-architecture-binding.md",
  "docs/reference/domains/mechanism/prescribed-kinematics-evidence-lifecycle.md",
  "docs/reference/domains/project-source-workspace/coverage.md",
  "docs/reference/domains/sensitivity/README.md",
  "docs/reference/domains/sysml/README.md",
  "docs/reference/domains/sysml/language.md",
  "docs/reference/domains/sysml/paths.md",
  "docs/reference/pipeline/compilation-and-isolation.md",
  "docs/reference/pipeline/prescribed-kinematics-observation-recovery.md",
  "docs/reference/providers/syson/evaluation-surface.md",
  "docs/reference/providers/syson/modeling-surface.md",
  "docs/reference/runtime/capability-packs/atomic-runtime-boundaries.md",
  "docs/reference/runtime/capability-packs/capability-runtime-connection.md",
  "docs/reference/runtime/capability-packs/project-capability-intent.md",
] as const;

/**
 * Inventory pages that match the citation regex but name at least one
 * identifier the registry does not know, or a glob that matches nothing
 * registered. They stay off the watch list.
 */
const UNWATCHED_CITING_DOCUMENTS = [
  ".agents/skills/admit-and-run-engineering-source/references/source-gates.md",
  "docs/how-to/compile/compile-fea-parameters.md",
  "docs/how-to/compile/compile-sensitivity-parameters.md",
  "docs/how-to/prepare-project-response.md",
  "docs/how-to/run/run-admitted-modelica.md",
  "docs/how-to/verify-design/review-and-correct-after-a-proof.md",
  "docs/how-to/verify-design/review-cross-domain-impact.md",
  "docs/how-to/verify-design/verify-a-new-design-from-scratch.md",
  "docs/how-to/verify-design/verify-a-new-wall-hook-from-source.md",
  "docs/how-to/verify-design/verify-prescribed-kinematics.md",
  "docs/how-to/verify-design/walk-through-an-engineering-project.md",
  "docs/reference/agent/agent-workspace.md",
  "docs/reference/agent/lookalike-traps.md",
  "docs/reference/codebase/fea.md",
  "docs/reference/codebase/sensitivity.md",
  "docs/reference/codebase/sysml-architecture-requirements.md",
  "docs/reference/contracts/engineering-project.md",
  "docs/reference/contracts/thread-workflows.md",
  "docs/reference/domains/buy/README.md",
  "docs/reference/domains/buy/production-estimates.md",
  "docs/reference/domains/impact/coverage.md",
  "docs/reference/domains/mechanism/operations.md",
  "docs/reference/domains/mechanism/prescribed-kinematics-method-and-evaluation.md",
  "docs/reference/domains/modelica/coverage.md",
  "docs/reference/domains/modelica/execution.md",
  "docs/reference/domains/sysml/coverage.md",
  "docs/reference/pipeline/admitted-source-isolated-execution.md",
  "docs/reference/pipeline/analysis-authority-pipeline.md",
  "docs/reference/providers/provider-analysis-oracle-taxonomy.md",
  "docs/reference/providers/spice/README.md",
  "docs/reference/providers/syson/authority-and-runtime.md",
  "docs/reference/runtime/agent-control-plane.md",
  "docs/reference/runtime/capability-packs/atomic-runtime-catalog.md",
  "docs/reference/runtime/capability-packs/qualified-binding-catalog.md",
  "docs/reference/runtime/local-runtime-and-ports.md",
  // `casys.*` names Docker container labels, not registered operations.
  "docs/reference/runtime/tool-runtime-backend-decision.md",
] as const;

/** Backtick-quoted exact operation references: `family.name@version`. */
const LITERAL_OPERATION_PATTERN = /`([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+@\d+)`/g;

/**
 * Backtick-quoted operation family globs such as `analyze.*sensitivity*`.
 * The family prefix before the first dot must be alphabetic so file globs
 * like `*.ts` never register as operation references.
 */
const GLOB_OPERATION_PATTERN = /`([a-z][a-z0-9-]*(?:\.[a-z0-9*-]+)+)`/g;

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replaceAll(".", "\\.").replaceAll("*", "[a-z0-9.-]*");
  return new RegExp(`^${escaped}(?:@\\d+)?$`);
}

function extractReferences(text: string): {
  literals: readonly string[];
  globs: readonly string[];
} {
  const literals = [...text.matchAll(LITERAL_OPERATION_PATTERN)]
    .map((match) => match[1]);
  const globs = [...text.matchAll(GLOB_OPERATION_PATTERN)]
    .map((match) => match[1])
    .filter((candidate) => candidate.includes("*"));
  return { literals: [...new Set(literals)], globs: [...new Set(globs)] };
}

async function readReferences(document: string): Promise<{
  literals: readonly string[];
  globs: readonly string[];
}> {
  const text = await Deno.readTextFile(new URL(document, REPO_ROOT));
  return extractReferences(text);
}

function toRepoRelative(file: URL): string {
  const root = REPO_ROOT.href;
  if (!file.href.startsWith(root)) {
    throw new Error(`${file.href} is outside the repository root`);
  }
  return decodeURIComponent(file.href.slice(root.length));
}

async function collectMarkdownFiles(root: URL): Promise<string[]> {
  const files: string[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const dir = queue.pop()!;
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isDirectory) {
        queue.push(new URL(`${entry.name}/`, dir));
        continue;
      }
      if (entry.isFile && entry.name.endsWith(".md")) {
        files.push(toRepoRelative(new URL(entry.name, dir)));
      }
    }
  }
  return files;
}

async function discoverCitingDocuments(): Promise<string[]> {
  const citing: string[] = [];
  for (const tree of INVENTORY_TREES) {
    for (const document of await collectMarkdownFiles(new URL(tree, REPO_ROOT))) {
      const { literals, globs } = await readReferences(document);
      if (literals.length + globs.length > 0) citing.push(document);
    }
  }
  return citing.toSorted();
}

function unknownLiterals(
  literals: readonly string[],
  registered: ReadonlySet<string>,
): string[] {
  return literals.filter((id) => !registered.has(id)).toSorted();
}

/**
 * Operation identities owned by the §5 table: backtick-quoted ids in the
 * first column only. Paired accept/reject cells legitimately yield two ids;
 * an id merely mentioned in a later column (prerequisite, bytes reopened)
 * grants no row and must not mask a missing identity.
 */
function extractTableOperationIdentities(table: string): string[] {
  const identities = new Set<string>();
  for (const line of table.split("\n")) {
    if (!line.startsWith("|")) continue;
    const firstColumn = line.split("|")[1] ?? "";
    for (const match of firstColumn.matchAll(LITERAL_OPERATION_PATTERN)) {
      identities.add(match[1]);
    }
  }
  return [...identities].toSorted();
}

function deadGlobs(
  globs: readonly string[],
  registered: readonly string[],
): string[] {
  return globs.filter((glob) => {
    const pattern = globToRegExp(glob);
    return !registered.some((key) => pattern.test(key));
  }).toSorted();
}

function registeredOperationsTable(text: string): string {
  const sectionStart = text.indexOf("## 5. Registered operations");
  assert(
    sectionStart >= 0,
    `${AGENT_WORKSPACE_REFERENCE} is missing the registered operations heading`,
  );
  const sectionEnd = text.indexOf("\n## ", sectionStart + 1);
  const section = text.slice(
    sectionStart,
    sectionEnd === -1 ? undefined : sectionEnd,
  );
  const lines = section.split("\n");
  const tableStart = lines.findIndex((line) => /^\| Operation\b/.test(line));
  assert(
    tableStart >= 0,
    `${AGENT_WORKSPACE_REFERENCE} is missing the registered operations table`,
  );
  let tableEnd = tableStart;
  while (tableEnd < lines.length && lines[tableEnd].startsWith("|")) {
    tableEnd += 1;
  }
  return lines.slice(tableStart, tableEnd).join("\n");
}

Deno.test(
  "every operation-citing document still cites at least one operation reference",
  async () => {
    for (const document of OPERATION_CITING_DOCUMENTS) {
      const { literals, globs } = await readReferences(document);
      assert(
        literals.length + globs.length > 0,
        `${document} no longer cites any operation identifier, so this suite ` +
          "protects nothing there. Either the document lost its references " +
          "by accident, or this watch list must change alongside it.",
      );
    }
  },
);

Deno.test(
  "every operation id cited by the path documents exists in the registry",
  async () => {
    const registered = new Set(listRegisteredEngineeringOperationKeys());
    for (const document of OPERATION_CITING_DOCUMENTS) {
      const { literals } = await readReferences(document);
      const unknown = unknownLiterals(literals, registered);
      assertEquals(
        unknown,
        [],
        `${document} cites operation ids the registry does not know: ` +
          `${unknown.join(", ")}. Registered keys: ` +
          `${[...registered].sort().join(", ")}`,
      );
    }
  },
);

Deno.test(
  "every operation glob cited by the path documents matches at least one registered operation",
  async () => {
    const registered = listRegisteredEngineeringOperationKeys();
    for (const document of OPERATION_CITING_DOCUMENTS) {
      const { globs } = await readReferences(document);
      const dead = deadGlobs(globs, registered);
      assertEquals(
        dead,
        [],
        `${document} cites operation patterns that match nothing registered: ` +
          `${dead.join(", ")}. A pattern that matches nothing teaches the ` +
          `agent a vocabulary the server will refuse.`,
      );
    }
  },
);

Deno.test(
  "every citing document in the inventory trees is classified as watched or unwatched",
  async () => {
    const discovered = await discoverCitingDocuments();
    const classified = [
      ...OPERATION_CITING_DOCUMENTS,
      ...UNWATCHED_CITING_DOCUMENTS,
    ].toSorted();
    assertEquals(
      discovered,
      classified,
      "A new or removed operation-citing page must be added to the watch " +
        "list when every citation is a live registry key, or to the " +
        "unwatched inventory when it still names an unknown id or dead glob.",
    );
  },
);

Deno.test(
  "unwatched citing documents still contain a non-registry citation",
  async () => {
    const registeredList = listRegisteredEngineeringOperationKeys();
    const registered = new Set(registeredList);
    for (const document of UNWATCHED_CITING_DOCUMENTS) {
      const { literals, globs } = await readReferences(document);
      const unknown = unknownLiterals(literals, registered);
      const dead = deadGlobs(globs, registeredList);
      assert(
        unknown.length + dead.length > 0,
        `${document} no longer cites an unknown operation id or a dead ` +
          "glob. Move it onto the watch list.",
      );
    }
  },
);

function assertTableOperationIdentities(
  table: string,
  registered: readonly string[],
): void {
  const cited = extractTableOperationIdentities(table);
  assert(
    cited.length > 0,
    `${AGENT_WORKSPACE_REFERENCE} operations table no longer cites any ` +
      "operation identifier, so the reverse pin protects nothing.",
  );
  const citedSet = new Set(cited);
  const missing = registered.filter((key) => !citedSet.has(key)).toSorted();
  assertEquals(
    missing,
    [],
    `${AGENT_WORKSPACE_REFERENCE} operations table is missing ` +
      `${missing.length} registry keys: ${missing.join(", ")}. ` +
      "Add the missing rows from the registered descriptors; do not " +
      "weaken this guard.",
  );
  const stale = unknownLiterals(cited, new Set(registered));
  assertEquals(
    stale,
    [],
    `${AGENT_WORKSPACE_REFERENCE} operations table cites ` +
      `${stale.length} unknown operation ids: ${stale.join(", ")}. ` +
      "Remove the withdrawn row; historical references outside the table " +
      "stay untouched.",
  );
}

Deno.test(
  "agent-workspace operations table cites exactly the registered operation keys",
  async () => {
    const registered = listRegisteredEngineeringOperationKeys();
    const text = await Deno.readTextFile(
      new URL(AGENT_WORKSPACE_REFERENCE, REPO_ROOT),
    );
    const table = registeredOperationsTable(text);
    assertTableOperationIdentities(table, registered);
  },
);

Deno.test(
  "agent-workspace table authority is the first column, not description mentions",
  () => {
    const table = [
      "| Operation | Execution | What a success is |",
      "| --- | --- | --- |",
      "| `verify.alpha-thing@1` | trusted | Mentions `verify.beta-thing@1` |",
    ].join("\n");
    // The whole-cell extraction still sees the mention: that is the trap.
    assert(
      extractReferences(table).literals.includes("verify.beta-thing@1"),
    );
    const identities = extractTableOperationIdentities(table);
    assertEquals(identities, ["verify.alpha-thing@1"]);
    const registered = ["verify.alpha-thing@1", "verify.beta-thing@1"];
    assertThrows(
      () => assertTableOperationIdentities(table, registered),
      Error,
      "missing",
    );
  },
);

Deno.test(
  "agent-workspace table rejects a withdrawn first-column row",
  () => {
    const table = [
      "| Operation | Execution |",
      "| --- | --- |",
      "| `verify.alpha-thing@1` | trusted |",
      "| `architecture.author-inspection-drone@3` | retired |",
    ].join("\n");
    assertThrows(
      () => assertTableOperationIdentities(table, ["verify.alpha-thing@1"]),
      Error,
      "unknown operation ids",
    );
  },
);

Deno.test(
  "agent-workspace table accepts paired accept/reject cells",
  () => {
    const table = [
      "| Operation | Execution |",
      "| --- | --- |",
      "| `decide.accept-gamma-thing@1` / `decide.reject-gamma-thing@1` | trusted, **human origin** |",
    ].join("\n");
    assertTableOperationIdentities(table, [
      "decide.accept-gamma-thing@1",
      "decide.reject-gamma-thing@1",
    ]);
  },
);

Deno.test(
  "agent-workspace table ignores historical references outside the table",
  () => {
    const document = [
      "# Reference",
      "",
      "## 5. Registered operations",
      "",
      "| Operation | Execution |",
      "| --- | --- |",
      "| `verify.alpha-thing@1` | trusted |",
      "",
      "`architecture.author-inspection-drone@3` is retired and unregistered.",
      "",
      "## 6. Next",
    ].join("\n");
    assertTableOperationIdentities(registeredOperationsTable(document), [
      "verify.alpha-thing@1",
    ]);
  },
);
