import { assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";

const MATRIX_TASK = "release:first-party-microvm-images:matrix";
const MATRIX_SCRIPT = "scripts/release/export-first-party-microsandbox-image-matrix.ts";
const WORKFLOW_PATH = ".github/workflows/publish-first-party-microvm-images.yml";
const UNIQUE_COMMIT_RUN_TAG =
  "git-${{ github.sha }}-run-${{ github.run_id }}-${{ github.run_attempt }}";
const PINNED_ACTIONS = {
  checkout: "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
  setupDeno: "denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed",
  uploadArtifact: "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
  setupBuildx: "docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f",
  login: "docker/login-action@c94ce9fb468520275223c153574b00df6fe4bcc9",
  buildPush: "docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8",
} as const;
const GIT_MUTATION = /\bgit\s+(add|commit|push)\b/;
const GH_PR = /\bgh\s+pr\b/;
const MUTATING_ACTION = /commit|pull-request|create-pr/;

Deno.test("matrix export task is planning-only and reads the worktree", async () => {
  const config = JSON.parse(await Deno.readTextFile("deno.json")) as {
    tasks: Record<string, string>;
  };
  const command = config.tasks[MATRIX_TASK];
  assertEquals(command !== undefined, true);
  assertEquals(command!.includes("--no-prompt"), true);
  assertEquals(command!.includes("--frozen"), true);
  assertEquals(command!.includes("--allow-read=."), true);
  assertEquals(command!.includes("--allow-run"), false);
  assertEquals(command!.includes("--allow-write"), false);
  assertEquals(command!.includes("--allow-net"), false);
  assertEquals(command!.includes("docker"), false);
  assertEquals(command!.includes(MATRIX_SCRIPT), true);
});

Deno.test(
  "publish workflow is opt-in, least-privilege, native ARM, and non-mutating",
  async () => {
    const workflow = parseWorkflow(await Deno.readTextFile(WORKFLOW_PATH));
    assertEquals(Object.keys(workflow.on).toSorted(), ["workflow_dispatch"]);
    assertEquals(workflow.permissions, {});

    const prepare = workflow.jobs.prepare;
    const build = workflow.jobs.build;
    if (!prepare || !build) {
      throw new TypeError("publish workflow must declare prepare and build jobs");
    }
    const identityGuard = prepare.steps.find((step) =>
      (step.run ?? "").includes("GITHUB_REPOSITORY_ID")
    );
    assertEquals(
      (identityGuard?.run ?? "").includes('"superWorldSavior/casys-digital-thread"'),
      true,
    );
    assertEquals((identityGuard?.run ?? "").includes('"1316957248"'), true);
    assertEquals(prepare.permissions, { contents: "read" });
    assertEquals(build.permissions, {
      contents: "read",
      packages: "write",
    });
    assertEquals(build["runs-on"], "ubuntu-24.04-arm");
    assertEquals(build.env?.IMAGE_TAG, UNIQUE_COMMIT_RUN_TAG);
    assertEquals(
      build.env?.MATRIX_DOCUMENT,
      "${{ needs.prepare.outputs.matrix_document }}",
    );
    assertEquals(
      prepare.outputs?.["matrix_document"],
      "${{ steps.export.outputs.matrix_document }}",
    );

    const push = build.steps.find((step) =>
      (step.uses ?? "").startsWith("docker/build-push-action@")
    );
    assertEquals(
      push?.with?.tags,
      "${{ matrix.imageName }}:${{ env.IMAGE_TAG }}",
    );
    assertEquals(push?.with?.platforms, "${{ matrix.platform }}");
    assertEquals(push?.with?.push, true);
    assertEquals(push?.with?.provenance, true);
    assertEquals(push?.with?.sbom, true);
    assertEquals(
      String(push?.with?.labels ?? "").includes(
        "org.opencontainers.image.licenses",
      ),
      false,
    );
    assertEquals(
      build.steps.find((step) =>
        (step.uses ?? "").startsWith("docker/setup-buildx-action@")
      )?.with?.driver,
      "docker-container",
    );
    assertEquals(
      build.steps.some((step) =>
        (step.run ?? "").includes("MATRIX_DOCUMENT") &&
        (step.run ?? "").includes("matrix.json")
      ),
      true,
    );
    const exportStep = prepare.steps.find((step) =>
      (step.run ?? "").includes("logical_contract_count")
    );
    assertEquals(
      (exportStep?.run ?? "").includes(
        "first-party-microsandbox-image-distribution-matrix/3.0",
      ),
      true,
    );
    assertEquals(
      (exportStep?.run ?? "").includes("five-physical/five-logical"),
      true,
    );
    assertEquals(
      (exportStep?.run ?? "").includes(
        '.imageName != ("ghcr.io/superworldsavior/" + .packageName)',
      ),
      true,
    );
    assertEquals(
      (exportStep?.run ?? "").includes("distribution-matrix/2.0"),
      false,
    );
    assertEquals(
      (exportStep?.run ?? "").includes("five-physical/six-logical"),
      false,
    );
    assertEquals(
      (exportStep?.run ?? "").includes("unique_physical_count") &&
        (exportStep?.run ?? "").includes("{include: .images}"),
      true,
    );
    const restoreStep = build.steps.find((step) =>
      (step.run ?? "").includes(
        "Prepare did not provide the complete distribution matrix.",
      )
    );
    assertEquals(
      (restoreStep?.run ?? "").includes(
        "first-party-microsandbox-image-distribution-matrix/3.0",
      ),
      true,
    );
    assertEquals(
      (restoreStep?.run ?? "").includes(
        "first-party-microsandbox-image-distribution-matrix/2.0",
      ),
      false,
    );
    assertEquals(
      build.steps.some((step) =>
        (step.run ?? "").includes(
          "write-first-party-microsandbox-image-candidate-receipt.ts",
        ) &&
        (step.run ?? "").includes("build-metadata.json")
      ),
      true,
    );
    assertEquals(
      build.steps.some((step) =>
        (step.run ?? "").includes("imagetools inspect --raw") &&
        (step.run ?? "").includes("oci-index.json") &&
        (step.run ?? "").includes("PLATFORM_MANIFEST_DIGEST")
      ),
      true,
    );
    const receiptArtifact = build.steps.find((step) =>
      (step.uses ?? "").startsWith("actions/upload-artifact@")
    );
    assertEquals(
      String(receiptArtifact?.with?.path ?? "").includes("oci-index.json"),
      true,
    );
    assertEquals(
      [...prepare.steps, ...build.steps].map((step) => step.uses).filter(
        (uses): uses is string => uses !== undefined,
      ),
      [
        PINNED_ACTIONS.checkout,
        PINNED_ACTIONS.setupDeno,
        PINNED_ACTIONS.uploadArtifact,
        PINNED_ACTIONS.checkout,
        PINNED_ACTIONS.setupDeno,
        PINNED_ACTIONS.setupBuildx,
        PINNED_ACTIONS.login,
        PINNED_ACTIONS.buildPush,
        PINNED_ACTIONS.uploadArtifact,
      ],
    );

    const steps = [...prepare.steps, ...build.steps];
    for (const step of steps) {
      const action = (step.uses ?? "").split("@")[0]!.toLowerCase();
      assertEquals(action.includes("qemu"), false);
      assertEquals(MUTATING_ACTION.test(action), false);
      const script = step.run ?? "";
      assertEquals(GIT_MUTATION.test(script), false);
      assertEquals(GH_PR.test(script), false);
    }
  },
);

interface WorkflowDocument {
  readonly on: Record<string, unknown>;
  readonly permissions?: Record<string, unknown>;
  readonly jobs: Record<string, WorkflowJob>;
}

interface WorkflowJob {
  readonly "runs-on"?: string;
  readonly permissions?: Record<string, string>;
  readonly outputs?: Record<string, string>;
  readonly env?: Record<string, string>;
  readonly steps: readonly WorkflowStep[];
}

interface WorkflowStep {
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Record<string, unknown>;
}

function parseWorkflow(source: string): WorkflowDocument {
  const root = mapping(parseYaml(source), "workflow");
  return {
    on: mapping(root.on, "on"),
    permissions: optionalRecord(root.permissions),
    jobs: Object.fromEntries(
      Object.entries(mapping(root.jobs, "jobs")).map(([name, job]) => {
        const record = mapping(job, `jobs.${name}`);
        return [name, {
          "runs-on": optionalString(record["runs-on"]),
          permissions: optionalStringRecord(record.permissions),
          outputs: optionalStringRecord(record.outputs),
          env: optionalStringRecord(record.env),
          steps: array(record.steps, `jobs.${name}.steps`).map((step, index) => {
            const item = mapping(step, `jobs.${name}.steps[${index}]`);
            return {
              uses: optionalString(item.uses),
              run: optionalString(item.run),
              with: optionalRecord(item.with),
            };
          }),
        }];
      }),
    ),
  };
}

function mapping(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be a mapping.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be a sequence.`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalStringRecord(
  value: unknown,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  const record = mapping(value, "record");
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string") result[key] = item;
  }
  return result;
}

function optionalRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  return mapping(value, "record");
}
