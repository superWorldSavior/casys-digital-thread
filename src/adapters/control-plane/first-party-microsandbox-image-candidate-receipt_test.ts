import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "./first-party-capability-binding-catalog.ts";
import {
  bindFirstPartyMicrosandboxImageCandidateReceiptToCurrentMatrix,
  buildFirstPartyMicrosandboxImageCandidateReceipt,
  FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_RECEIPT_SCHEMA,
  parseFirstPartyMicrosandboxImageCandidateReceipt,
  readBoundFirstPartyMicrosandboxImageCandidateReceipt,
  renderFirstPartyMicrosandboxImageCandidateReceiptText,
} from "./first-party-microsandbox-image-candidate-receipt.ts";
import {
  createFirstPartyMicrosandboxImageDistributionMatrix,
  fingerprintFirstPartyMicrosandboxImageDistributionMatrix,
  type FirstPartyMicrosandboxImageDistributionMatrix,
} from "./first-party-microsandbox-image-distribution-matrix.ts";

const GIT_SHA = "a".repeat(40);
const OCI_INDEX_DIGEST = `sha256:${"b".repeat(64)}`;
const PLATFORM_MANIFEST_DIGEST = `sha256:${"d".repeat(64)}`;
const MATRIX_FINGERPRINT = `sha256:${"c".repeat(64)}`;

Deno.test("candidate receipt preserves exact build facts while keeping promotion unresolved", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
  const receipt = buildFirstPartyMicrosandboxImageCandidateReceipt({
    matrix,
    matrixFingerprint: MATRIX_FINGERPRINT,
    physicalImageId: "modelica-microsandbox-worker",
    ociIndexDigest: OCI_INDEX_DIGEST,
    platformManifestDigest: PLATFORM_MANIFEST_DIGEST,
    locatorTag: `git-${GIT_SHA}-run-42-1`,
    gitSha: GIT_SHA,
    gitTag: "first-party-microvm-v0.1.0",
    buildMetadata: {
      "containerimage.digest": OCI_INDEX_DIGEST,
      nested: { platform: "linux/arm64" },
    },
  });

  assertEquals(
    receipt.schemaVersion,
    FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_RECEIPT_SCHEMA,
  );
  assertEquals(
    receipt.candidate.oci.indexReference,
    "ghcr.io/superworldsavior/casys-digital-thread-modelica-microsandbox-worker@" +
      OCI_INDEX_DIGEST,
  );
  assertEquals(
    receipt.candidate.oci.platformManifestReference,
    "ghcr.io/superworldsavior/casys-digital-thread-modelica-microsandbox-worker@" +
      PLATFORM_MANIFEST_DIGEST,
  );
  assertEquals(
    receipt.candidate.locatorReference,
    "ghcr.io/superworldsavior/casys-digital-thread-modelica-microsandbox-worker:" +
      `git-${GIT_SHA}-run-42-1`,
  );
  assertEquals(receipt.candidate.logicalTargets.length, 1);
  assertEquals(receipt.inputMatrix.images.length, 5);
  assertEquals(receipt.inputMatrix.contract.logicalTargetCount, 5);
  assertEquals(
    receipt.inputMatrix.schemaVersion,
    "first-party-microsandbox-image-distribution-matrix/3.0",
  );
  assertEquals(receipt.artifactCompliance, {
    licence: "unresolved",
    anonymousPull: "not-run",
    runtimeQualification: "not-run",
    eligibleForPromotion: false,
    sbom: "requested",
    provenance: "requested",
  });
  const text = renderFirstPartyMicrosandboxImageCandidateReceiptText(receipt);
  assertEquals(
    text.includes(`oci.indexReference=${receipt.candidate.oci.indexReference}`),
    true,
  );
  assertEquals(text.includes("eligibleForPromotion=false"), true);
  assertEquals(text.includes("licence=unresolved"), true);
});

Deno.test("candidate receipt rejects incomplete matrix and mutable locator facts", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
  const input = {
    matrix,
    matrixFingerprint: MATRIX_FINGERPRINT,
    physicalImageId: "ngspice-worker",
    ociIndexDigest: OCI_INDEX_DIGEST,
    platformManifestDigest: PLATFORM_MANIFEST_DIGEST,
    locatorTag: `git-${GIT_SHA}-run-42-1`,
    gitSha: GIT_SHA,
    gitTag: "first-party-microvm-v0.1.0",
    buildMetadata: {},
  };
  assertThrows(
    () =>
      buildFirstPartyMicrosandboxImageCandidateReceipt({
        ...input,
        matrix: { ...matrix, images: matrix.images.slice(1) },
      }),
    TypeError,
    "exactly 5 physical images",
  );
  assertThrows(
    () =>
      buildFirstPartyMicrosandboxImageCandidateReceipt({
        ...input,
        locatorTag: "latest",
      }),
    TypeError,
    "locator tag",
  );
  assertThrows(
    () =>
      buildFirstPartyMicrosandboxImageCandidateReceipt({
        ...input,
        buildMetadata: { "containerimage.digest": PLATFORM_MANIFEST_DIGEST },
      }),
    TypeError,
    "containerimage.digest must exactly match",
  );
});

Deno.test("candidate receipt parse rebuilds the exact document and binds the current matrix", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
  const fingerprint = await fingerprintFirstPartyMicrosandboxImageDistributionMatrix(
    matrix,
  );
  const receipt = buildFirstPartyMicrosandboxImageCandidateReceipt({
    matrix,
    matrixFingerprint: fingerprint,
    physicalImageId: "ngspice-worker",
    ociIndexDigest: OCI_INDEX_DIGEST,
    platformManifestDigest: PLATFORM_MANIFEST_DIGEST,
    locatorTag: `git-${GIT_SHA}-run-7-1`,
    gitSha: GIT_SHA,
    gitTag: "first-party-microvm-v0.1.0",
    buildMetadata: { "containerimage.digest": OCI_INDEX_DIGEST },
  });
  const parsed = parseFirstPartyMicrosandboxImageCandidateReceipt(
    JSON.parse(deterministicJson(receipt)),
  );
  assertEquals(deterministicJson(parsed), deterministicJson(receipt));
  const bound = await bindFirstPartyMicrosandboxImageCandidateReceiptToCurrentMatrix(
    parsed,
    matrix,
  );
  assertEquals(bound.inputMatrix.fingerprint, fingerprint);
  const reread = await readBoundFirstPartyMicrosandboxImageCandidateReceipt(
    `${deterministicJson(receipt)}\n`,
    matrix,
  );
  assertEquals(reread.candidate.physicalImageId, "ngspice-worker");
});

Deno.test("candidate receipt bind refuses a fingerprint that is not its historical matrix", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
  const receipt = buildFirstPartyMicrosandboxImageCandidateReceipt({
    matrix,
    matrixFingerprint: MATRIX_FINGERPRINT,
    physicalImageId: "ngspice-worker",
    ociIndexDigest: OCI_INDEX_DIGEST,
    platformManifestDigest: PLATFORM_MANIFEST_DIGEST,
    locatorTag: `git-${GIT_SHA}-run-7-1`,
    gitSha: GIT_SHA,
    gitTag: "first-party-microvm-v0.1.0",
    buildMetadata: { "containerimage.digest": OCI_INDEX_DIGEST },
  });
  await assertRejects(
    () =>
      bindFirstPartyMicrosandboxImageCandidateReceiptToCurrentMatrix(receipt, matrix),
    TypeError,
    "exact historical distribution matrix",
  );
  assertThrows(
    () =>
      parseFirstPartyMicrosandboxImageCandidateReceipt({
        ...receipt,
        candidate: {
          ...receipt.candidate,
          oci: {
            ...receipt.candidate.oci,
            indexReference: "ghcr.io/example/not-the-receipt@sha256:00",
          },
        },
      }),
    TypeError,
    "exact rebuilt first-party receipt",
  );
});

Deno.test("candidate receipt bind accepts unrelated matrix drift and refuses selected-entry drift", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
  const receipt = buildFirstPartyMicrosandboxImageCandidateReceipt({
    matrix,
    matrixFingerprint: await fingerprintFirstPartyMicrosandboxImageDistributionMatrix(
      matrix,
    ),
    physicalImageId: "ngspice-worker",
    ociIndexDigest: OCI_INDEX_DIGEST,
    platformManifestDigest: PLATFORM_MANIFEST_DIGEST,
    locatorTag: `git-${GIT_SHA}-run-7-1`,
    gitSha: GIT_SHA,
    gitTag: "first-party-microvm-v0.1.0",
    buildMetadata: { "containerimage.digest": OCI_INDEX_DIGEST },
  });

  const unrelatedDrift = withChangedQualificationTarget(
    matrix,
    "calculix-worker",
    "8",
  );
  const bound = await bindFirstPartyMicrosandboxImageCandidateReceiptToCurrentMatrix(
    receipt,
    unrelatedDrift,
  );
  assertEquals(bound.inputMatrix.fingerprint, receipt.inputMatrix.fingerprint);

  const selectedEntryDrift = withChangedQualificationTarget(
    matrix,
    "ngspice-worker",
    "9",
  );
  await assertRejects(
    () =>
      bindFirstPartyMicrosandboxImageCandidateReceiptToCurrentMatrix(
        receipt,
        selectedEntryDrift,
      ),
    TypeError,
    "candidate-entry-compatibility/2.0",
  );
});

function withChangedQualificationTarget(
  matrix: FirstPartyMicrosandboxImageDistributionMatrix,
  physicalImageId: string,
  digestCharacter: string,
): FirstPartyMicrosandboxImageDistributionMatrix {
  const manifestDigest = `sha256:${digestCharacter.repeat(64)}`;
  return {
    ...matrix,
    images: matrix.images.map((entry) =>
      entry.physicalImageId === physicalImageId
        ? {
          ...entry,
          qualificationTarget: {
            imageReference: `docker.io/casys/${physicalImageId}@${manifestDigest}`,
            manifestDigest,
          },
        }
        : entry
    ),
  };
}
