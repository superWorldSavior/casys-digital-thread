import { assertEquals, assertRejects } from "@std/assert";
import { pinnedOciImageReference } from "../../domain/compile/isolation/local-isolation-runtime.ts";
import { sha256Hex } from "../../domain/kernel/deterministic-json.ts";
import type {
  MicrosandboxImageImportHandle,
  MicrosandboxImageInspection,
} from "../shared/execution/microsandbox-ephemeral-execution-backend.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "./first-party-capability-binding-catalog.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import { samePinnedRepositoryDigest } from "../shared/docker-pinned-repository-digest.ts";
import {
  type FirstPartyMicrosandboxImageCandidateImportPorts,
  firstPartyMicrosandboxImageCandidateStagingReference,
  importFirstPartyMicrosandboxImageCandidate,
  planFirstPartyMicrosandboxImageCandidateImport,
} from "./first-party-microsandbox-image-candidate-import.ts";
import {
  fingerprintFirstPartyMicrosandboxImageCandidateImportSourceReceipt,
  type FirstPartyMicrosandboxImageCandidateImportRecord,
  firstPartyMicrosandboxImageCandidateName,
  firstPartyMicrosandboxImageCandidateReference,
  readBoundFirstPartyMicrosandboxImageCandidateImportRecord,
} from "./first-party-microsandbox-image-candidate-import-record.ts";
import { writeFirstPartyMicrosandboxImageCandidateImportRecord } from "./local-first-party-microsandbox-image-candidate-import-ports.ts";
import {
  bindFirstPartyMicrosandboxImageCandidateReceiptToCurrentMatrix,
  buildFirstPartyMicrosandboxImageCandidateReceipt,
  type FirstPartyMicrosandboxImageCandidateReceipt,
} from "./first-party-microsandbox-image-candidate-receipt.ts";
import {
  createFirstPartyMicrosandboxImageDistributionMatrix,
  fingerprintFirstPartyMicrosandboxImageDistributionMatrix,
} from "./first-party-microsandbox-image-distribution-matrix.ts";

const GIT_SHA = "a".repeat(40);
const PLATFORM_MANIFEST_DIGEST = `sha256:${"f".repeat(64)}`;
const MICROSANDBOX_DIGEST = `sha256:${"9".repeat(64)}`;
const ARCHIVE_PATH = "/tmp/casys-first-party-microsandbox-candidate-test/image.tar";

class CachedImageAbsentError extends Error {
  constructor() {
    super("cached image absent");
    this.name = "CachedImageAbsentError";
  }
}

Deno.test("candidate import plan is read-only and keeps qualification not-run", async () => {
  const { receipt } = await fixtures();
  const plan = planFirstPartyMicrosandboxImageCandidateImport(receipt);
  assertEquals(plan.mode, "plan");
  assertEquals(plan.mutation, false);
  assertEquals(plan.microsandboxManifestDigest, "unobserved");
  assertEquals(plan.plannedPull, receipt.candidate.oci.platformManifestReference);
  assertEquals(
    plan.staging,
    {
      strategy: "generated-at-run",
      repository: "casys/first-party-candidate-staging-ngspice-worker",
      tagPrefix: `${receipt.candidate.locatorTag}-`,
    },
  );
  assertEquals("plannedStagingReference" in plan, false);
  assertEquals(
    plan.plannedCandidateName,
    firstPartyMicrosandboxImageCandidateName("ngspice-worker"),
  );
  assertEquals(plan.artifactCompliance.runtimeQualification, "not-run");
  assertEquals(plan.artifactCompliance.eligibleForPromotion, false);
  assertEquals(
    plan.qualificationTarget.imageReference,
    receipt.candidate.qualificationTarget.imageReference,
  );
});

Deno.test("candidate import records three typed digest identities in operation order", async () => {
  const { receipt, indexDocument, matrix } = await fixtures();
  const ports = fakePorts({ receipt, indexDocument });
  const record = await importFirstPartyMicrosandboxImageCandidate({
    receipt,
    matrix,
    ports,
  });
  const staging = firstPartyMicrosandboxImageCandidateStagingReference(
    receipt,
    "attempt-a",
  );
  const candidate = firstPartyMicrosandboxImageCandidateReference(
    "ngspice-worker",
    MICROSANDBOX_DIGEST,
  );
  const cacheReference = canonicalCandidateCacheReference(candidate);
  assertEquals(record.identities.ociIndexDigest, receipt.candidate.oci.indexDigest);
  assertEquals(
    record.identities.ociPlatformManifestDigest,
    PLATFORM_MANIFEST_DIGEST,
  );
  assertEquals(record.identities.microsandboxManifestDigest, MICROSANDBOX_DIGEST);
  assertEquals(record.import.status, "imported");
  assertEquals(record.artifactCompliance.runtimeQualification, "not-run");
  assertEquals(record.artifactCompliance.eligibleForPromotion, false);
  assertEquals(record.candidate.microsandbox.candidateReference, candidate);
  assertEquals(cacheReference, `docker.io/${candidate}`);
  assertEquals(
    record.candidate.microsandbox.candidateReference === cacheReference,
    false,
  );
  assertEquals(
    record.candidate.qualificationTarget.imageReference === candidate,
    false,
  );
  assertEquals(
    record.sourceReceipt.fingerprint,
    await fingerprintFirstPartyMicrosandboxImageCandidateImportSourceReceipt(
      record.sourceReceipt.receipt,
    ),
  );
  assertEquals(
    deterministicJson(record.sourceReceipt.receipt),
    deterministicJson(receipt),
  );
  const bound = await readBoundFirstPartyMicrosandboxImageCandidateImportRecord(
    deterministicJson(record),
    matrix,
  );
  assertEquals(deterministicJson(bound), deterministicJson(record));
  assertEquals(ports.operations, [
    "createStagingToken:attempt-a",
    `inspectCachedImage:${staging}`,
    `inspectOciIndex:${receipt.candidate.oci.indexReference}`,
    `pullByDigest:${receipt.candidate.oci.platformManifestReference}`,
    `inspectDockerImage:${receipt.candidate.oci.platformManifestReference}`,
    "createTemporaryArchive",
    `saveDockerImage:${receipt.candidate.oci.platformManifestReference}`,
    `loadImageFromArchive:${staging}`,
    `inspectCachedImage:${staging}`,
    `inspectCachedImage:${cacheReference}`,
    `removeExactCachedImage:${staging}`,
    `loadImageFromArchive:${cacheReference}`,
    `inspectCachedImage:${cacheReference}`,
    "writeImportRecord",
    "cleanup",
  ]);
  assertEquals(ports.loads.map((load) => load.tag), [staging, cacheReference]);
  assertEquals(ports.exactCachedImageRemoves, [staging]);
  assertEquals(ports.loads.some((load) => load.tag === candidate), false);
  assertEquals(ports.exactCachedImageRemoves.includes(candidate), false);
  assertNeverTouchesCatalogPin(ports, receipt);
});

Deno.test("candidate import accepts equal OCI and Microsandbox hash text while preserving typed fields", async () => {
  const { receipt, indexDocument, matrix } = await fixtures();
  const record = await importFirstPartyMicrosandboxImageCandidate({
    receipt,
    matrix,
    ports: fakePorts({
      receipt,
      indexDocument,
      microsandboxDigest: PLATFORM_MANIFEST_DIGEST,
    }),
  });
  assertEquals(
    record.identities.ociPlatformManifestDigest,
    PLATFORM_MANIFEST_DIGEST,
  );
  assertEquals(
    record.identities.microsandboxManifestDigest,
    PLATFORM_MANIFEST_DIGEST,
  );
  assertEquals(record.identities.ociIndexDigest, receipt.candidate.oci.indexDigest);
  assertEquals(record.candidate.oci.platformManifestDigest, PLATFORM_MANIFEST_DIGEST);
  assertEquals(
    record.candidate.microsandbox.manifestDigest,
    PLATFORM_MANIFEST_DIGEST,
  );
});

Deno.test("historical candidate import pulls and saves the original Casys digest under the personal matrix", async () => {
  const { receipt, indexDocument, matrix } = await historicalFixtures();
  const ports = fakePorts({ receipt, indexDocument });
  const record = await importFirstPartyMicrosandboxImageCandidate({
    receipt,
    matrix,
    ports,
  });
  assertEquals(ports.pulls, [receipt.candidate.oci.platformManifestReference]);
  assertEquals(ports.saves, ports.pulls);
  assertEquals(ports.pulls[0]!.startsWith("ghcr.io/casys-ai/"), true);
  assertEquals(
    deterministicJson(record.sourceReceipt.receipt),
    deterministicJson(receipt),
  );
  assertEquals(record.candidate.oci, receipt.candidate.oci);
  assertNeverTouchesCatalogPin(ports, receipt);
});

Deno.test("historical candidate import rejects a personal repository digest even with the same digest text", async () => {
  const { receipt, indexDocument, matrix } = await historicalFixtures();
  const ports = fakePorts({
    receipt,
    indexDocument,
    docker: {
      ...dockerInspectJson(receipt),
      RepoDigests: [receipt.candidate.oci.platformManifestReference.replace(
        "ghcr.io/casys-ai/",
        "ghcr.io/superworldsavior/",
      )],
    },
  });
  await assertRejects(
    () => importFirstPartyMicrosandboxImageCandidate({ receipt, matrix, ports }),
    Error,
    "not the exact linux/arm64 first-party candidate",
  );
  assertEquals(ports.loads, []);
  assertEquals(ports.saves, []);
  assertNeverTouchesCatalogPin(ports, receipt);
});

Deno.test("candidate import is deterministic for the same receipt and observations", async () => {
  const { receipt, indexDocument, matrix } = await fixtures();
  const first = await importFirstPartyMicrosandboxImageCandidate({
    receipt,
    matrix,
    ports: fakePorts({ receipt, indexDocument }),
  });
  const second = await importFirstPartyMicrosandboxImageCandidate({
    receipt,
    matrix,
    ports: fakePorts({ receipt, indexDocument }),
  });
  assertEquals(first, second);
});

Deno.test("candidate import verifies the historical matrix before Docker or Microsandbox", async () => {
  const { receipt, indexDocument, matrix } = await fixtures();
  const stale = JSON.parse(deterministicJson(receipt)) as Record<string, unknown>;
  const inputMatrix = JSON.parse(deterministicJson(stale.inputMatrix)) as Record<
    string,
    unknown
  >;
  inputMatrix.fingerprint = `sha256:${"0".repeat(64)}`;
  stale.inputMatrix = inputMatrix;
  const ports = fakePorts({ receipt, indexDocument });
  await assertRejects(
    () =>
      importFirstPartyMicrosandboxImageCandidate({
        receipt: stale as unknown as FirstPartyMicrosandboxImageCandidateReceipt,
        matrix,
        ports,
      }),
    TypeError,
    "exact historical distribution matrix",
  );
  assertEquals(ports.operations, []);
  assertEquals(ports.pulls, []);
  assertEquals(ports.loads, []);
  assertNeverTouchesCatalogPin(ports, receipt);
});

Deno.test("candidate import binds an unbound current receipt before Docker or Microsandbox", async () => {
  const { receipt, indexDocument, matrix } = await fixtures();
  const unbound = buildFirstPartyMicrosandboxImageCandidateReceipt({
    matrix,
    matrixFingerprint: receipt.inputMatrix.fingerprint,
    physicalImageId: receipt.candidate.physicalImageId,
    ociIndexDigest: receipt.candidate.oci.indexDigest,
    platformManifestDigest: receipt.candidate.oci.platformManifestDigest,
    locatorTag: receipt.candidate.locatorTag,
    gitSha: receipt.candidate.git.sha,
    gitTag: receipt.candidate.git.tag,
    buildMetadata: receipt.candidate.build.metadata,
  });
  const ports = fakePorts({ receipt: unbound, indexDocument });
  const record = await importFirstPartyMicrosandboxImageCandidate({
    receipt: unbound,
    matrix,
    ports,
  });
  assertEquals(record.import.status, "imported");
  assertEquals(ports.pulls.length > 0, true);
  assertNeverTouchesCatalogPin(ports, unbound);
});

Deno.test("non-arm64 host fails before Docker or Microsandbox mutation", async () => {
  const { receipt, indexDocument, matrix } = await fixtures();
  const ports = fakePorts({
    receipt,
    indexDocument,
    hostArchitecture: "amd64",
  });
  await assertRejects(
    () => importFirstPartyMicrosandboxImageCandidate({ receipt, matrix, ports }),
    Error,
    "native linux/arm64",
  );
  assertEquals(ports.operations, []);
  assertEquals(ports.pulls, []);
  assertEquals(ports.loads, []);
  assertNeverTouchesCatalogPin(ports, receipt);
});

Deno.test("wrong Docker platform or runtime metadata fails closed before Microsandbox load", async () => {
  const { receipt, indexDocument, matrix } = await fixtures();
  const platform = fakePorts({
    receipt,
    indexDocument,
    docker: dockerInspectJson(receipt, { architecture: "amd64" }),
  });
  await assertRejects(
    () =>
      importFirstPartyMicrosandboxImageCandidate({ receipt, matrix, ports: platform }),
    Error,
    "exact linux/arm64 first-party candidate",
  );
  assertEquals(platform.saves, []);
  assertEquals(platform.loads, []);
  assertEquals(platform.exactCachedImageRemoves, []);
  assertEquals(platform.tempCreated, 0);
  assertEquals(platform.cleaned, 0);
  assertNeverTouchesCatalogPin(platform, receipt);

  const runtime = fakePorts({
    receipt,
    indexDocument,
    docker: dockerInspectJson(receipt, { user: "root" }),
  });
  await assertRejects(
    () =>
      importFirstPartyMicrosandboxImageCandidate({ receipt, matrix, ports: runtime }),
    Error,
    "exact linux/arm64 first-party candidate",
  );
  assertEquals(runtime.loads, []);
  assertNeverTouchesCatalogPin(runtime, receipt);
});

Deno.test("OCI index inspect tolerates a single trailing newline on the raw bytes", async () => {
  const { receipt, indexDocument, matrix } = await fixtures();
  const ports = fakePorts({
    receipt,
    indexDocument: `${indexDocument}\n`,
  });
  const record = await importFirstPartyMicrosandboxImageCandidate({
    receipt,
    matrix,
    ports,
  });
  assertEquals(record.identities.ociIndexDigest, receipt.candidate.oci.indexDigest);
  assertEquals(record.import.status, "imported");
});

Deno.test("OCI index with the wrong platform child fails before pull", async () => {
  const { receipt, matrix } = await fixtures();
  const indexDocument = JSON.stringify({
    schemaVersion: 2,
    manifests: [{
      digest: PLATFORM_MANIFEST_DIGEST,
      platform: { os: "linux", architecture: "amd64" },
    }],
  });
  const indexDigest = `sha256:${await sha256Hex(
    new TextEncoder().encode(indexDocument),
  )}`;
  const mismatched = await boundReceipt({
    ociIndexDigest: indexDigest,
    buildMetadata: { "containerimage.digest": indexDigest },
  });
  const ports = fakePorts({ receipt: mismatched, indexDocument });
  await assertRejects(
    () =>
      importFirstPartyMicrosandboxImageCandidate({
        receipt: mismatched,
        matrix,
        ports,
      }),
    Error,
    "exactly one linux/arm64 child manifest",
  );
  assertEquals(ports.pulls, []);
  assertEquals(ports.loads, []);
  assertNeverTouchesCatalogPin(ports, receipt);
});

Deno.test("save failure cleans the archive and never loads or removes a catalog pin", async () => {
  const { receipt, indexDocument, matrix } = await fixtures();
  const ports = fakePorts({
    receipt,
    indexDocument,
    saveError: new Error("docker image save failed"),
  });
  await assertRejects(
    () => importFirstPartyMicrosandboxImageCandidate({ receipt, matrix, ports }),
    Error,
    "docker image save failed",
  );
  assertEquals(ports.tempCreated, 1);
  assertEquals(ports.cleaned, 1);
  assertEquals(ports.loads, []);
  assertEquals(ports.exactCachedImageRemoves, []);
  assertNeverTouchesCatalogPin(ports, receipt);
});

Deno.test("a pre-existing invocation staging reference fails before mutation and is never deleted", async () => {
  const { receipt, indexDocument, matrix } = await fixtures();
  const stagingToken = "already-present";
  const staging = firstPartyMicrosandboxImageCandidateStagingReference(
    receipt,
    stagingToken,
  );
  const ports = fakePorts({
    receipt,
    indexDocument,
    stagingToken,
    initiallyCached: [candidateInspection(receipt, staging, MICROSANDBOX_DIGEST)],
  });
  await assertRejects(
    () => importFirstPartyMicrosandboxImageCandidate({ receipt, matrix, ports }),
    Error,
    "staging reference already exists",
  );
  assertEquals(ports.operations, [
    `createStagingToken:${stagingToken}`,
    `inspectCachedImage:${staging}`,
  ]);
  assertEquals(ports.loads, []);
  assertEquals(ports.exactCachedImageRemoves, []);
  assertEquals(ports.tempCreated, 0);
  assertNeverTouchesCatalogPin(ports, receipt);
});

Deno.test("retry and concurrent imports use distinct invocation staging while keeping the factual record deterministic", async () => {
  const { receipt, indexDocument, matrix } = await fixtures();
  const retry = fakePorts({
    receipt,
    indexDocument,
    stagingToken: "retry-a",
  });
  const left = fakePorts({
    receipt,
    indexDocument,
    stagingToken: "concurrent-left",
  });
  const right = fakePorts({
    receipt,
    indexDocument,
    stagingToken: "concurrent-right",
  });
  const retryRecord = await importFirstPartyMicrosandboxImageCandidate({
    receipt,
    matrix,
    ports: retry,
  });
  const [leftRecord, rightRecord] = await Promise.all([
    importFirstPartyMicrosandboxImageCandidate({ receipt, matrix, ports: left }),
    importFirstPartyMicrosandboxImageCandidate({ receipt, matrix, ports: right }),
  ]);
  const stagingReferences = [retry, left, right].map((ports) => ports.loads[0]!.tag);
  assertEquals(new Set(stagingReferences).size, 3);
  assertEquals(retryRecord, leftRecord);
  assertEquals(leftRecord, rightRecord);
  assertEquals("stagingReference" in retryRecord.candidate.microsandbox, false);
});

Deno.test("candidate import refuses an archive load that did not apply its requested staging tag", async () => {
  const { receipt, indexDocument, matrix } = await fixtures();
  const ports = fakePorts({
    receipt,
    indexDocument,
    stagingLoadReferences: ["casys/archive-returned-other:tag"],
  });
  await assertRejects(
    () => importFirstPartyMicrosandboxImageCandidate({ receipt, matrix, ports }),
    Error,
    "did not apply the requested staging reference",
  );
  assertEquals(ports.exactCachedImageRemoves, []);
  assertEquals(ports.records, []);
  assertNeverTouchesCatalogPin(ports, receipt);
});

Deno.test("candidate import refuses an archive load that returns the active catalogue pin without deleting it", async () => {
  const { receipt, indexDocument, matrix } = await fixtures();
  const staging = firstPartyMicrosandboxImageCandidateStagingReference(
    receipt,
    "attempt-a",
  );
  const ports = fakePorts({
    receipt,
    indexDocument,
    stagingLoadReferences: [
      staging,
      receipt.candidate.qualificationTarget.imageReference.replace(
        /^docker\.io\//u,
        "",
      ),
    ],
  });
  await assertRejects(
    () => importFirstPartyMicrosandboxImageCandidate({ receipt, matrix, ports }),
    Error,
    "returned the active catalogue pin",
  );
  assertEquals(ports.exactCachedImageRemoves, [staging]);
  assertNeverTouchesCatalogPin(ports, receipt);
});

Deno.test("candidate import refuses a final load that did not apply its requested candidate tag", async () => {
  const { receipt, indexDocument, matrix } = await fixtures();
  const staging = firstPartyMicrosandboxImageCandidateStagingReference(
    receipt,
    "attempt-a",
  );
  const candidate = firstPartyMicrosandboxImageCandidateReference(
    "ngspice-worker",
    MICROSANDBOX_DIGEST,
  );
  const cacheReference = canonicalCandidateCacheReference(candidate);
  const ports = fakePorts({
    receipt,
    indexDocument,
    candidateLoadReferences: ["casys/archive-returned-other:tag"],
  });
  await assertRejects(
    () => importFirstPartyMicrosandboxImageCandidate({ receipt, matrix, ports }),
    Error,
    "did not apply the requested final candidate reference",
  );
  assertEquals(ports.loads.map((load) => load.tag), [staging, cacheReference]);
  assertEquals(ports.exactCachedImageRemoves, [staging]);
  assertEquals(ports.records, []);
  assertNeverTouchesCatalogPin(ports, receipt);
});

Deno.test("candidate import refuses a final load that only applied the short candidate identity", async () => {
  const { receipt, indexDocument, matrix } = await fixtures();
  const staging = firstPartyMicrosandboxImageCandidateStagingReference(
    receipt,
    "attempt-a",
  );
  const candidate = firstPartyMicrosandboxImageCandidateReference(
    "ngspice-worker",
    MICROSANDBOX_DIGEST,
  );
  const cacheReference = canonicalCandidateCacheReference(candidate);
  const ports = fakePorts({
    receipt,
    indexDocument,
    candidateLoadReferences: [candidate],
  });
  await assertRejects(
    () => importFirstPartyMicrosandboxImageCandidate({ receipt, matrix, ports }),
    Error,
    "did not apply the requested final candidate reference",
  );
  assertEquals(ports.loads.map((load) => load.tag), [staging, cacheReference]);
  assertEquals(ports.exactCachedImageRemoves, [staging]);
  assertEquals(ports.records, []);
  assertNeverTouchesCatalogPin(ports, receipt);
});

Deno.test("record-write failure quarantines only the final candidate newly imported by this invocation", async () => {
  const { receipt, indexDocument, matrix } = await fixtures();
  const staging = firstPartyMicrosandboxImageCandidateStagingReference(
    receipt,
    "attempt-a",
  );
  const candidate = firstPartyMicrosandboxImageCandidateReference(
    "ngspice-worker",
    MICROSANDBOX_DIGEST,
  );
  const cacheReference = canonicalCandidateCacheReference(candidate);
  const ports = fakePorts({
    receipt,
    indexDocument,
    writeRecordError: new Error("record filesystem unavailable"),
  });
  await assertRejects(
    () => importFirstPartyMicrosandboxImageCandidate({ receipt, matrix, ports }),
    Error,
    "record filesystem unavailable",
  );
  assertEquals(ports.loads.map((load) => load.tag), [staging, cacheReference]);
  assertEquals(ports.exactCachedImageRemoves, [staging, cacheReference]);
  assertEquals(ports.exactCachedImageRemoves.includes(candidate), false);
  assertEquals(ports.records, []);
  assertNeverTouchesCatalogPin(ports, receipt);
});

Deno.test("record-write failure retains a coherent pre-existing final candidate", async () => {
  const { receipt, indexDocument, matrix } = await fixtures();
  const staging = firstPartyMicrosandboxImageCandidateStagingReference(
    receipt,
    "attempt-a",
  );
  const candidate = firstPartyMicrosandboxImageCandidateReference(
    "ngspice-worker",
    MICROSANDBOX_DIGEST,
  );
  const cacheReference = canonicalCandidateCacheReference(candidate);
  const ports = fakePorts({
    receipt,
    indexDocument,
    preexisting: candidateInspection(receipt, cacheReference, MICROSANDBOX_DIGEST),
    writeRecordError: new Error("record filesystem unavailable"),
  });
  await assertRejects(
    () => importFirstPartyMicrosandboxImageCandidate({ receipt, matrix, ports }),
    Error,
    "record filesystem unavailable",
  );
  assertEquals(ports.exactCachedImageRemoves, [staging]);
  assertNeverTouchesCatalogPin(ports, receipt);
});

Deno.test("incoherent pre-existing final candidate fails without deletion", async () => {
  const { receipt, indexDocument, matrix } = await fixtures();
  const candidate = firstPartyMicrosandboxImageCandidateReference(
    "ngspice-worker",
    MICROSANDBOX_DIGEST,
  );
  const cacheReference = canonicalCandidateCacheReference(candidate);
  const staging = firstPartyMicrosandboxImageCandidateStagingReference(
    receipt,
    "attempt-a",
  );
  const ports = fakePorts({
    receipt,
    indexDocument,
    preexisting: {
      ...candidateInspection(receipt, cacheReference, MICROSANDBOX_DIGEST),
      user: "root",
    },
  });
  await assertRejects(
    () => importFirstPartyMicrosandboxImageCandidate({ receipt, matrix, ports }),
    Error,
    "incoherent pre-existing first-party Microsandbox candidate must not be deleted",
  );
  assertEquals(ports.loads.map((load) => load.tag), [staging]);
  assertEquals(ports.exactCachedImageRemoves, [staging]);
  assertEquals(ports.exactCachedImageRemoves.includes(cacheReference), false);
  assertEquals(ports.exactCachedImageRemoves.includes(candidate), false);
  assertEquals(ports.records, []);
  assertEquals(ports.cleaned, 1);
  assertNeverTouchesCatalogPin(ports, receipt);
});

Deno.test("coherent pre-existing final candidate is retained without a second load", async () => {
  const { receipt, indexDocument, matrix } = await fixtures();
  const candidate = firstPartyMicrosandboxImageCandidateReference(
    "ngspice-worker",
    MICROSANDBOX_DIGEST,
  );
  const cacheReference = canonicalCandidateCacheReference(candidate);
  const staging = firstPartyMicrosandboxImageCandidateStagingReference(
    receipt,
    "attempt-a",
  );
  const ports = fakePorts({
    receipt,
    indexDocument,
    preexisting: candidateInspection(receipt, cacheReference, MICROSANDBOX_DIGEST),
  });
  const record = await importFirstPartyMicrosandboxImageCandidate({
    receipt,
    matrix,
    ports,
  });
  assertEquals(record.import.status, "already-cached");
  assertEquals(record.candidate.microsandbox.candidateReference, candidate);
  assertEquals(record.artifactCompliance.eligibleForPromotion, false);
  assertEquals(
    ports.operations.includes(`inspectCachedImage:${cacheReference}`),
    true,
  );
  assertEquals(ports.operations.includes(`inspectCachedImage:${candidate}`), false);
  assertEquals(ports.loads.map((load) => load.tag), [staging]);
  assertEquals(ports.exactCachedImageRemoves, [staging]);
  assertEquals(ports.cleaned, 1);
  assertNeverTouchesCatalogPin(ports, receipt);
});

Deno.test("short-identity pre-existing cache is not the canonical candidate and is not deleted", async () => {
  const { receipt, indexDocument, matrix } = await fixtures();
  const candidate = firstPartyMicrosandboxImageCandidateReference(
    "ngspice-worker",
    MICROSANDBOX_DIGEST,
  );
  const cacheReference = canonicalCandidateCacheReference(candidate);
  const staging = firstPartyMicrosandboxImageCandidateStagingReference(
    receipt,
    "attempt-a",
  );
  const ports = fakePorts({
    receipt,
    indexDocument,
    preexisting: candidateInspection(receipt, candidate, MICROSANDBOX_DIGEST),
  });
  const record = await importFirstPartyMicrosandboxImageCandidate({
    receipt,
    matrix,
    ports,
  });
  assertEquals(record.import.status, "imported");
  assertEquals(record.candidate.microsandbox.candidateReference, candidate);
  assertEquals(record.artifactCompliance.eligibleForPromotion, false);
  assertEquals(ports.loads.map((load) => load.tag), [staging, cacheReference]);
  assertEquals(ports.exactCachedImageRemoves, [staging]);
  assertEquals(ports.exactCachedImageRemoves.includes(candidate), false);
  assertNeverTouchesCatalogPin(ports, receipt);
});

Deno.test("import record writer is idempotent and refuses an incoherent collision", async () => {
  const { receipt, indexDocument, matrix } = await fixtures();
  const record = await importFirstPartyMicrosandboxImageCandidate({
    receipt,
    matrix,
    ports: fakePorts({ receipt, indexDocument }),
  });
  const directory = await Deno.makeTempDir({
    prefix: "casys-candidate-import-record-",
  });
  try {
    await writeFirstPartyMicrosandboxImageCandidateImportRecord(record, directory);
    await writeFirstPartyMicrosandboxImageCandidateImportRecord(record, directory);
    const tampered: FirstPartyMicrosandboxImageCandidateImportRecord = {
      ...record,
      import: { ...record.import, status: "already-cached" },
    };
    await assertRejects(
      () => writeFirstPartyMicrosandboxImageCandidateImportRecord(tampered, directory),
      Error,
      "incoherent first-party candidate import record already exists",
    );
    const written = JSON.parse(
      await Deno.readTextFile(
        `${directory}/ngspice-worker/${
          [
            receipt.candidate.oci.indexDigest.slice(7),
            PLATFORM_MANIFEST_DIGEST.slice(7),
            MICROSANDBOX_DIGEST.slice(7),
          ].join("-")
        }.json`,
      ),
    );
    assertEquals(deterministicJson(written), deterministicJson(record));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("candidate import module never calls catalog-pin acquisition", async () => {
  const orchestration = await Deno.readTextFile(
    new URL("./first-party-microsandbox-image-candidate-import.ts", import.meta.url),
  );
  const ports = await Deno.readTextFile(
    new URL(
      "./local-first-party-microsandbox-image-candidate-import-ports.ts",
      import.meta.url,
    ),
  );
  const acquisitionImport = orchestration.match(
    /import \{([^}]+)\} from "\.\/first-party-microsandbox-image-acquisition\.ts"/u,
  );
  assertEquals(acquisitionImport !== null, true);
  assertEquals(
    acquisitionImport![1]!.includes("acquireFirstPartyMicrosandboxImage"),
    false,
  );
  assertEquals(orchestration.includes("acquireFirstPartyMicrosandboxImage("), false);
  assertEquals(orchestration.includes("buildDockerImage"), false);
  assertEquals(orchestration.includes('new Deno.Command("docker"'), false);
  assertEquals(ports.includes("acquireFirstPartyMicrosandboxImage"), false);
  assertEquals(ports.includes("buildDockerImage"), false);
  assertEquals(ports.includes("Image.prune"), false);
  assertEquals(ports.includes("force: true"), false);
  assertEquals(orchestration.includes("Image.prune"), false);
  assertEquals(orchestration.includes("force: true"), false);
});

interface FakePorts extends FirstPartyMicrosandboxImageCandidateImportPorts {
  readonly operations: string[];
  readonly pulls: string[];
  readonly saves: string[];
  readonly loads: Array<{ archivePath: string; tag: string }>;
  readonly exactCachedImageRemoves: string[];
  readonly records: FirstPartyMicrosandboxImageCandidateImportRecord[];
  tempCreated: number;
  cleaned: number;
}

function fakePorts(options: {
  readonly receipt: FirstPartyMicrosandboxImageCandidateReceipt;
  readonly indexDocument: string;
  readonly docker?: unknown;
  readonly preexisting?: MicrosandboxImageInspection;
  readonly initiallyCached?: readonly MicrosandboxImageInspection[];
  readonly saveError?: Error;
  readonly writeRecordError?: Error;
  readonly hostArchitecture?: string;
  readonly stagingToken?: string;
  readonly microsandboxDigest?: string;
  readonly stagingLoadReferences?: readonly string[];
  readonly candidateLoadReferences?: readonly string[];
}): FakePorts {
  const operations: string[] = [];
  const pulls: string[] = [];
  const saves: string[] = [];
  const loads: FakePorts["loads"] = [];
  const exactCachedImageRemoves: string[] = [];
  const records: FirstPartyMicrosandboxImageCandidateImportRecord[] = [];
  const loaded = new Map<string, MicrosandboxImageInspection>();
  const initiallyCached = new Map(
    [
      ...(options.preexisting === undefined ? [] : [options.preexisting]),
      ...(options.initiallyCached ?? []),
    ].map((image) => [image.reference, image] as const),
  );
  const stagingToken = options.stagingToken ?? "attempt-a";
  const microsandboxDigest = options.microsandboxDigest ?? MICROSANDBOX_DIGEST;
  const ports: FakePorts = {
    hostArchitecture: options.hostArchitecture ?? "arm64",
    operations,
    pulls,
    saves,
    loads,
    exactCachedImageRemoves,
    records,
    tempCreated: 0,
    cleaned: 0,
    createStagingToken() {
      operations.push(`createStagingToken:${stagingToken}`);
      return stagingToken;
    },
    inspectOciIndex(reference) {
      operations.push(`inspectOciIndex:${reference}`);
      return Promise.resolve(options.indexDocument);
    },
    pullByDigest(reference) {
      operations.push(`pullByDigest:${reference}`);
      pulls.push(reference);
      return Promise.resolve();
    },
    inspectDockerImage(reference) {
      operations.push(`inspectDockerImage:${reference}`);
      if (options.docker !== undefined) return Promise.resolve(options.docker);
      if (pulls.length === 0) return Promise.resolve(undefined);
      return Promise.resolve(dockerInspectJson(options.receipt));
    },
    saveDockerImage(reference, archivePath) {
      operations.push(`saveDockerImage:${reference}`);
      if (options.saveError) return Promise.reject(options.saveError);
      saves.push(reference);
      assertEquals(archivePath, ARCHIVE_PATH);
      return Promise.resolve();
    },
    loadImageFromArchive(archivePath, tag) {
      operations.push(`loadImageFromArchive:${tag}`);
      loads.push({ archivePath, tag });
      const references = tag.includes("first-party-candidate-staging-")
        ? options.stagingLoadReferences ?? [tag]
        : options.candidateLoadReferences ?? [tag];
      for (const reference of references) {
        loaded.set(
          reference,
          candidateInspection(options.receipt, reference, microsandboxDigest),
        );
      }
      return Promise.resolve(
        Object.freeze(references.map((reference) => importHandle(reference))),
      );
    },
    inspectCachedImage(reference) {
      operations.push(`inspectCachedImage:${reference}`);
      const loadedImage = loaded.get(reference);
      if (loadedImage) return Promise.resolve(loadedImage);
      const existing = initiallyCached.get(reference);
      if (existing !== undefined) return Promise.resolve(existing);
      return Promise.reject(new CachedImageAbsentError());
    },
    isImageNotFound(error) {
      return error instanceof CachedImageAbsentError;
    },
    removeExactCachedImage(reference) {
      operations.push(`removeExactCachedImage:${reference}`);
      exactCachedImageRemoves.push(reference);
      loaded.delete(reference);
      initiallyCached.delete(reference);
      return Promise.resolve();
    },
    createTemporaryArchiveDirectory() {
      operations.push("createTemporaryArchive");
      ports.tempCreated++;
      return Promise.resolve({
        directory: "/tmp/casys-first-party-microsandbox-candidate-test",
        archivePath: ARCHIVE_PATH,
        cleanup: () => {
          operations.push("cleanup");
          ports.cleaned++;
          return Promise.resolve();
        },
      });
    },
    writeImportRecord(record) {
      operations.push("writeImportRecord");
      if (options.writeRecordError !== undefined) {
        return Promise.reject(options.writeRecordError);
      }
      records.push(record);
      return Promise.resolve();
    },
  };
  return ports;
}

function assertNeverTouchesCatalogPin(
  ports: FakePorts,
  receipt: FirstPartyMicrosandboxImageCandidateReceipt,
): void {
  const pin = receipt.candidate.qualificationTarget.imageReference;
  assertEquals(ports.loads.some((load) => isCatalogPin(load.tag, pin)), false);
  assertEquals(
    ports.exactCachedImageRemoves.some((reference) => isCatalogPin(reference, pin)),
    false,
  );
  assertEquals(ports.pulls.some((reference) => isCatalogPin(reference, pin)), false);
  assertEquals(
    ports.operations.some((operation) =>
      operation.startsWith("inspectCachedImage:") &&
      isCatalogPin(operation.slice("inspectCachedImage:".length), pin)
    ),
    false,
  );
  assertEquals(
    ports.operations.some((operation) =>
      operation.startsWith("loadImageFromArchive:") &&
      isCatalogPin(operation.slice("loadImageFromArchive:".length), pin)
    ),
    false,
  );
  assertEquals(
    ports.operations.some((operation) =>
      operation.startsWith("removeExactCachedImage:") &&
      isCatalogPin(operation.slice("removeExactCachedImage:".length), pin)
    ),
    false,
  );
}

function isCatalogPin(reference: string, catalogPin: string): boolean {
  return reference === catalogPin ||
    samePinnedRepositoryDigest(reference, catalogPin);
}

function canonicalCandidateCacheReference(candidateReference: string): string {
  return pinnedOciImageReference(candidateReference, "$test");
}

function candidateInspection(
  receipt: FirstPartyMicrosandboxImageCandidateReceipt,
  reference: string,
  digest: string,
): MicrosandboxImageInspection {
  return {
    reference,
    manifestDigest: digest,
    os: "linux",
    architecture: "arm64",
    user: receipt.candidate.expectedRuntime.user,
    entrypoint: [...receipt.candidate.expectedRuntime.entrypoint],
    command: null,
    environment: {},
    labels: {},
  };
}

function importHandle(reference: string): MicrosandboxImageImportHandle {
  return Object.freeze({
    reference,
    manifestDigest: MICROSANDBOX_DIGEST,
    architecture: "arm64",
    os: "linux",
  });
}

function dockerInspectJson(
  receipt: FirstPartyMicrosandboxImageCandidateReceipt,
  overrides: { architecture?: string; user?: string } = {},
): Record<string, unknown> {
  return {
    RepoDigests: [receipt.candidate.oci.platformManifestReference],
    Os: "linux",
    Architecture: overrides.architecture ?? "arm64",
    Config: {
      User: overrides.user ?? receipt.candidate.expectedRuntime.user,
      Entrypoint: [...receipt.candidate.expectedRuntime.entrypoint],
      Labels: receipt.candidate.expectedRuntime.labels === undefined
        ? {}
        : { ...receipt.candidate.expectedRuntime.labels },
    },
  };
}

async function fixtures(): Promise<{
  readonly receipt: FirstPartyMicrosandboxImageCandidateReceipt;
  readonly indexDocument: string;
  readonly matrix: Awaited<ReturnType<typeof currentMatrix>>;
}> {
  const indexDocument = JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [
      {
        mediaType: "application/vnd.oci.image.manifest.v1+json",
        digest: PLATFORM_MANIFEST_DIGEST,
        size: 1,
        platform: { os: "linux", architecture: "arm64" },
      },
      {
        mediaType: "application/vnd.oci.image.manifest.v1+json",
        digest: `sha256:${"e".repeat(64)}`,
        size: 1,
        platform: { os: "unknown", architecture: "unknown" },
      },
    ],
  });
  const ociIndexDigest = `sha256:${await sha256Hex(
    new TextEncoder().encode(indexDocument),
  )}`;
  const receipt = await boundReceipt({
    ociIndexDigest,
    buildMetadata: { "containerimage.digest": ociIndexDigest },
  });
  return { receipt, indexDocument, matrix: await currentMatrix() };
}

async function boundReceipt(input: {
  readonly ociIndexDigest: string;
  readonly buildMetadata: { readonly "containerimage.digest": string };
}): Promise<FirstPartyMicrosandboxImageCandidateReceipt> {
  const matrix = await currentMatrix();
  const receipt = buildFirstPartyMicrosandboxImageCandidateReceipt({
    matrix,
    matrixFingerprint: await fingerprintFirstPartyMicrosandboxImageDistributionMatrix(
      matrix,
    ),
    physicalImageId: "ngspice-worker",
    ociIndexDigest: input.ociIndexDigest,
    platformManifestDigest: PLATFORM_MANIFEST_DIGEST,
    locatorTag: `git-${GIT_SHA}-run-42-1`,
    gitSha: GIT_SHA,
    gitTag: "first-party-microvm-v0.1.0",
    buildMetadata: input.buildMetadata,
  });
  return await bindFirstPartyMicrosandboxImageCandidateReceiptToCurrentMatrix(
    receipt,
    matrix,
  );
}

async function historicalFixtures() {
  const { receipt: personal, indexDocument, matrix } = await fixtures();
  const historical = {
    ...matrix,
    images: matrix.images.map((image) => ({
      ...image,
      imageName: image.imageName.replace(
        "ghcr.io/superworldsavior/",
        "ghcr.io/casys-ai/",
      ),
    })),
  };
  const receipt = buildFirstPartyMicrosandboxImageCandidateReceipt({
    matrix: historical,
    matrixFingerprint: await fingerprintFirstPartyMicrosandboxImageDistributionMatrix(
      historical,
    ),
    physicalImageId: personal.candidate.physicalImageId,
    ociIndexDigest: personal.candidate.oci.indexDigest,
    platformManifestDigest: personal.candidate.oci.platformManifestDigest,
    locatorTag: personal.candidate.locatorTag,
    gitSha: personal.candidate.git.sha,
    gitTag: personal.candidate.git.tag,
    buildMetadata: personal.candidate.build.metadata,
  });
  return { receipt, indexDocument, matrix };
}

async function currentMatrix() {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  return createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
}
