import { assertEquals, assertMatch } from "@std/assert";
import { createFirstPartyCapabilityRuntimeCatalog } from "../../src/adapters/control-plane/first-party-capability-binding-catalog.ts";
import { createFirstPartyMicrosandboxImageDistributionMatrix } from "../../src/adapters/control-plane/first-party-microsandbox-image-distribution-matrix.ts";
import { deterministicJson } from "../../src/domain/kernel/deterministic-json.ts";

const SCRIPT = new URL(
  "./write-first-party-microsandbox-image-candidate-receipt.ts",
  import.meta.url,
).pathname;
const GIT_SHA = "d".repeat(40);
const OCI_INDEX_DIGEST = `sha256:${"e".repeat(64)}`;
const PLATFORM_MANIFEST_DIGEST = `sha256:${"f".repeat(64)}`;

Deno.test("candidate receipt writer binds the full matrix and exact Buildx outputs", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-candidate-receipt-" });
  try {
    const catalog = await createFirstPartyCapabilityRuntimeCatalog();
    const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
    const matrixPath = `${directory}/matrix.json`;
    const metadataPath = `${directory}/build-metadata.json`;
    await Deno.writeTextFile(matrixPath, deterministicJson(matrix));
    await Deno.writeTextFile(
      metadataPath,
      JSON.stringify({
        "containerimage.digest": OCI_INDEX_DIGEST,
        "buildx.build.ref": "exact-build-output",
      }),
    );

    const success = await invokeWriter(directory, matrixPath, metadataPath);
    assertEquals(success.code, 0, new TextDecoder().decode(success.stderr));
    const receipt = JSON.parse(
      await Deno.readTextFile(`${directory}/receipt.json`),
    );
    assertEquals(receipt.candidate.physicalImageId, "ngspice-worker");
    assertEquals(
      receipt.candidate.oci.indexReference,
      "ghcr.io/superworldsavior/casys-digital-thread-ngspice-worker@" +
        OCI_INDEX_DIGEST,
    );
    assertEquals(
      receipt.candidate.oci.platformManifestReference,
      "ghcr.io/superworldsavior/casys-digital-thread-ngspice-worker@" +
        PLATFORM_MANIFEST_DIGEST,
    );
    assertEquals(receipt.inputMatrix.images.length, 5);
    assertEquals(receipt.inputMatrix.contract.logicalTargetCount, 5);
    assertEquals(
      receipt.inputMatrix.schemaVersion,
      "first-party-microsandbox-image-distribution-matrix/3.0",
    );
    assertEquals(
      receipt.candidate.build.metadata["buildx.build.ref"],
      "exact-build-output",
    );
    const text = await Deno.readTextFile(`${directory}/receipt.txt`);
    assertMatch(text, /anonymousPull=not-run/u);
    assertMatch(text, /runtimeQualification=not-run/u);

    await Deno.writeTextFile(
      metadataPath,
      JSON.stringify({ "containerimage.digest": PLATFORM_MANIFEST_DIGEST }),
    );
    const mismatchedMetadata = await invokeWriter(directory, matrixPath, metadataPath);
    assertEquals(mismatchedMetadata.code !== 0, true);
    assertMatch(
      new TextDecoder().decode(mismatchedMetadata.stderr),
      /containerimage\.digest must exactly match/u,
    );
    await Deno.writeTextFile(
      metadataPath,
      JSON.stringify({ "containerimage.digest": OCI_INDEX_DIGEST }),
    );

    await Deno.writeTextFile(
      matrixPath,
      deterministicJson({ ...matrix, images: matrix.images.slice(1) }),
    );
    const rejected = await invokeWriter(directory, matrixPath, metadataPath);
    assertEquals(rejected.code !== 0, true);
    assertMatch(
      new TextDecoder().decode(rejected.stderr),
      /complete server-owned distribution matrix/u,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

function invokeWriter(
  directory: string,
  matrixPath: string,
  metadataPath: string,
): Promise<Deno.CommandOutput> {
  return new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--no-prompt",
      "--frozen",
      `--allow-read=.,${directory}`,
      `--allow-write=${directory}`,
      SCRIPT,
      "--matrix",
      matrixPath,
      "--build-metadata",
      metadataPath,
      "--physical-image-id",
      "ngspice-worker",
      "--oci-index-digest",
      OCI_INDEX_DIGEST,
      "--platform-manifest-digest",
      PLATFORM_MANIFEST_DIGEST,
      "--locator-tag",
      `git-${GIT_SHA}-run-42-1`,
      "--git-sha",
      GIT_SHA,
      "--git-tag",
      "first-party-microvm-v0.1.0",
      "--output-directory",
      directory,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
}
