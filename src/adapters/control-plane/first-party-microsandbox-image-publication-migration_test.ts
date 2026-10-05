import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "./first-party-capability-binding-catalog.ts";
import { createFirstPartyMicrosandboxImageBootstrapDescriptors } from "./first-party-microsandbox-image-bootstrap.ts";
import {
  bindFirstPartyMicrosandboxImageCandidateReceiptToCurrentMatrix,
  buildFirstPartyMicrosandboxImageCandidateReceipt,
  readBoundFirstPartyMicrosandboxImageCandidateReceipt,
} from "./first-party-microsandbox-image-candidate-receipt.ts";
import {
  buildFirstPartyMicrosandboxImageCandidateImportRecord,
  readBoundFirstPartyMicrosandboxImageCandidateImportRecord,
} from "./first-party-microsandbox-image-candidate-import-record.ts";
import { planFirstPartyMicrosandboxImageCandidateImport } from "./first-party-microsandbox-image-candidate-import.ts";
import {
  createFirstPartyMicrosandboxImageDistributionMatrix,
  fingerprintFirstPartyMicrosandboxImageDistributionMatrix,
  type FirstPartyMicrosandboxImageDistributionMatrix,
} from "./first-party-microsandbox-image-distribution-matrix.ts";

const PERSONAL = "ghcr.io/superworldsavior/";
const HISTORICAL = "ghcr.io/casys-ai/";
const SHA = "a".repeat(40);
const INDEX = `sha256:${"b".repeat(64)}`;
const PLATFORM = `sha256:${"c".repeat(64)}`;
const MICROSANDBOX = `sha256:${"d".repeat(64)}`;

Deno.test("personal publication leaves the qualified Casys acquisition sources and runtime pins intact", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const descriptors = createFirstPartyMicrosandboxImageBootstrapDescriptors(catalog);
  const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
  assertEquals(
    matrix.images.every((image) => image.imageName.startsWith(PERSONAL)),
    true,
  );
  const publishedSources = descriptors.filter((descriptor) =>
    descriptor.source.kind === "oci-digest"
  );
  assertEquals(publishedSources.length, 2);
  for (const descriptor of publishedSources) {
    if (descriptor.source.kind !== "oci-digest") {
      throw new Error("Expected an OCI source");
    }
    assertEquals(descriptor.source.reference.startsWith(HISTORICAL), true);
    const image = matrix.images.find((entry) =>
      entry.physicalImageId === descriptor.physicalImageId
    )!;
    assertEquals(
      image.qualificationTarget.manifestDigest,
      descriptor.target.manifestDigest,
    );
    assertEquals(
      image.qualificationTarget.imageReference.includes(
        descriptor.target.manifestDigest,
      ),
      true,
    );
    assertEquals(image.imageName === descriptor.source.reference, false);
  }
});

Deno.test("historical receipts and import records bind after relocation without retagging their recorded bytes", async () => {
  const { current, historical, receipt } = await fixture();
  const receiptBytes = deterministicJson(receipt);
  const bound = await readBoundFirstPartyMicrosandboxImageCandidateReceipt(
    receiptBytes,
    current,
  );
  assertEquals(deterministicJson(bound), receiptBytes);
  assertEquals(
    bound.inputMatrix.fingerprint,
    await fingerprintFirstPartyMicrosandboxImageDistributionMatrix(historical),
  );
  assertEquals(
    bound.inputMatrix.fingerprint ===
      await fingerprintFirstPartyMicrosandboxImageDistributionMatrix(current),
    false,
  );
  assertEquals(
    bound.candidate.oci.indexReference,
    `${HISTORICAL}casys-digital-thread-ngspice-worker@${INDEX}`,
  );
  assertEquals(
    planFirstPartyMicrosandboxImageCandidateImport(bound).plannedPull,
    `${HISTORICAL}casys-digital-thread-ngspice-worker@${PLATFORM}`,
  );
  const record = await buildFirstPartyMicrosandboxImageCandidateImportRecord({
    receipt: bound,
    microsandboxManifestDigest: MICROSANDBOX,
    status: "imported",
  });
  const recordBytes = deterministicJson(record);
  const reread = await readBoundFirstPartyMicrosandboxImageCandidateImportRecord(
    recordBytes,
    current,
  );
  assertEquals(deterministicJson(reread), recordBytes);
  assertEquals(
    reread.sourceReceipt.receipt.candidate.imageName,
    bound.candidate.imageName,
  );
  assertEquals(reread.identities, {
    ociIndexDigest: INDEX,
    ociPlatformManifestDigest: PLATFORM,
    microsandboxManifestDigest: MICROSANDBOX,
  });
  assertEquals(reread.artifactCompliance.eligibleForPromotion, false);
});

Deno.test("historical namespace compatibility cannot admit selected recipe or runtime identity drift", async () => {
  const { current, receipt } = await fixture();
  const changes = [
    { dockerfile: "images/other/Dockerfile" },
    { context: "other" },
    { expectedUser: "root" },
    { expectedEntrypoint: ["other-worker"] },
    { expectedLabels: { "casys.worker.contract": "other" } },
    { logicalTargets: [{ unitId: "other", materialId: "other", recipeId: "other" }] },
    {
      qualificationTarget: {
        imageReference: `casys/other@${MICROSANDBOX}`,
        manifestDigest: MICROSANDBOX,
      },
    },
  ];
  for (const change of changes) {
    const altered = {
      ...current,
      images: current.images.map((image) =>
        image.physicalImageId === receipt.candidate.physicalImageId
          ? { ...image, ...change }
          : image
      ),
    };
    await assertRejects(
      () =>
        bindFirstPartyMicrosandboxImageCandidateReceiptToCurrentMatrix(
          receipt,
          altered,
        ),
      TypeError,
      "selected entry",
    );
  }
});

Deno.test("historical candidate admission does not allow other owners, aliases or repository names", async () => {
  const { current } = await fixture();
  for (
    const imageName of [
      "ghcr.io/superworldsavior-copy/casys-digital-thread-ngspice-worker",
      "ghcr.io/casys-ai/another-worker",
      "ghcr.io/casys-ai/casys-digital-thread-ngspice-worker:latest",
      "ghcr.io/Casys-AI/casys-digital-thread-ngspice-worker",
    ]
  ) {
    const matrix = {
      ...current,
      images: current.images.map((image) =>
        image.physicalImageId === "ngspice-worker" ? { ...image, imageName } : image
      ),
    };
    assertThrows(
      () => buildReceipt(matrix, `sha256:${"e".repeat(64)}`),
      TypeError,
      "exact current or historical",
    );
  }
  const { historical, receipt } = await fixture();
  await assertRejects(
    () =>
      bindFirstPartyMicrosandboxImageCandidateReceiptToCurrentMatrix(
        receipt,
        historical,
      ),
    TypeError,
    "current publication matrix",
  );
});

Deno.test("namespace relocation cannot rewrite a historical OCI source, fingerprint, SHA or digest", async () => {
  const { current, receipt } = await fixture();
  const value = JSON.parse(deterministicJson(receipt));
  value.candidate.oci.platformManifestReference =
    `${PERSONAL}casys-digital-thread-ngspice-worker@${PLATFORM}`;
  await assertRejects(
    () =>
      readBoundFirstPartyMicrosandboxImageCandidateReceipt(
        JSON.stringify(value),
        current,
      ),
    TypeError,
    "exact rebuilt",
  );
  const badFingerprint = {
    ...receipt,
    inputMatrix: { ...receipt.inputMatrix, fingerprint: `sha256:${"e".repeat(64)}` },
  };
  await assertRejects(
    () =>
      readBoundFirstPartyMicrosandboxImageCandidateReceipt(
        deterministicJson(badFingerprint),
        current,
      ),
    TypeError,
    "exact historical distribution matrix",
  );
  const badSha = {
    ...receipt,
    candidate: {
      ...receipt.candidate,
      git: { ...receipt.candidate.git, sha: "f".repeat(40) },
    },
  };
  await assertRejects(
    () =>
      readBoundFirstPartyMicrosandboxImageCandidateReceipt(
        deterministicJson(badSha),
        current,
      ),
    TypeError,
    "locator tag",
  );
  const badDigest = {
    ...receipt,
    candidate: {
      ...receipt.candidate,
      oci: { ...receipt.candidate.oci, indexDigest: PLATFORM },
    },
  };
  await assertRejects(
    () =>
      readBoundFirstPartyMicrosandboxImageCandidateReceipt(
        deterministicJson(badDigest),
        current,
      ),
    TypeError,
    "containerimage.digest must exactly match",
  );
});

async function fixture() {
  const current = createFirstPartyMicrosandboxImageDistributionMatrix(
    await createFirstPartyCapabilityRuntimeCatalog(),
  );
  const historical = {
    ...current,
    images: current.images.map((image) => ({
      ...image,
      imageName: image.imageName.replace(PERSONAL, HISTORICAL),
    })),
  };
  const receipt = buildReceipt(
    historical,
    await fingerprintFirstPartyMicrosandboxImageDistributionMatrix(historical),
  );
  return { current, historical, receipt };
}

function buildReceipt(
  matrix: FirstPartyMicrosandboxImageDistributionMatrix,
  fingerprint: string,
) {
  return buildFirstPartyMicrosandboxImageCandidateReceipt({
    matrix,
    matrixFingerprint: fingerprint,
    physicalImageId: "ngspice-worker",
    ociIndexDigest: INDEX,
    platformManifestDigest: PLATFORM,
    locatorTag: `git-${SHA}-run-42-1`,
    gitSha: SHA,
    gitTag: "first-party-microvm-v0.1.0",
    buildMetadata: { "containerimage.digest": INDEX },
  });
}
