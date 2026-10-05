import { assertEquals, assertRejects } from "@std/assert";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "./first-party-capability-binding-catalog.ts";
import {
  bindFirstPartyMicrosandboxImageCandidateReceiptToCurrentMatrix,
  buildFirstPartyMicrosandboxImageCandidateReceipt,
  FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_RECEIPT_SCHEMA,
  type FirstPartyMicrosandboxImageCandidateReceipt,
} from "./first-party-microsandbox-image-candidate-receipt.ts";
import {
  bindFirstPartyMicrosandboxImageCandidateImportRecordToCurrentMatrix,
  buildFirstPartyMicrosandboxImageCandidateImportRecord,
  fingerprintFirstPartyMicrosandboxImageCandidateImportSourceReceipt,
  FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA,
  type FirstPartyMicrosandboxImageCandidateImportRecord,
  firstPartyMicrosandboxImageCandidateName,
  firstPartyMicrosandboxImageCandidateReference,
  parseFirstPartyMicrosandboxImageCandidateImportRecord,
  readBoundFirstPartyMicrosandboxImageCandidateImportRecord,
} from "./first-party-microsandbox-image-candidate-import-record.ts";
import {
  createFirstPartyMicrosandboxImageDistributionMatrix,
  fingerprintFirstPartyMicrosandboxImageDistributionMatrix,
  FIRST_PARTY_MICROSANDBOX_IMAGE_DISTRIBUTION_MATRIX_SCHEMA,
  type FirstPartyMicrosandboxImageDistributionMatrix,
} from "./first-party-microsandbox-image-distribution-matrix.ts";

const GIT_SHA = "a".repeat(40);
const PLATFORM_MANIFEST_DIGEST = `sha256:${"f".repeat(64)}`;
const MICROSANDBOX_DIGEST = `sha256:${"9".repeat(64)}`;
const OCI_INDEX_DIGEST = `sha256:${"b".repeat(64)}`;

Deno.test("candidate import record round-trips through parse, bind, and readBound", async () => {
  const { record, matrix, receipt } = await fixtures();
  const parsed = await parseFirstPartyMicrosandboxImageCandidateImportRecord(
    JSON.parse(deterministicJson(record)),
  );
  assertEquals(deterministicJson(parsed), deterministicJson(record));
  assertEquals(
    parsed.schemaVersion,
    FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA,
  );
  assertEquals(
    parsed.candidate.imageName,
    receipt.candidate.imageName,
  );
  assertEquals(
    parsed.candidate.microsandbox.candidateReference,
    firstPartyMicrosandboxImageCandidateReference(
      "ngspice-worker",
      MICROSANDBOX_DIGEST,
    ),
  );
  assertEquals(
    parsed.sourceReceipt.schemaVersion,
    FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_RECEIPT_SCHEMA,
  );
  assertEquals(
    deterministicJson(parsed.sourceReceipt.receipt),
    deterministicJson(receipt),
  );
  assertEquals(
    parsed.sourceReceipt.fingerprint,
    await fingerprintFirstPartyMicrosandboxImageCandidateImportSourceReceipt(
      parsed.sourceReceipt.receipt,
    ),
  );
  const bound =
    await bindFirstPartyMicrosandboxImageCandidateImportRecordToCurrentMatrix(
      parsed,
      matrix,
    );
  assertEquals(deterministicJson(bound), deterministicJson(record));
  const reread = await readBoundFirstPartyMicrosandboxImageCandidateImportRecord(
    `${deterministicJson(record)}\n`,
    matrix,
  );
  assertEquals(deterministicJson(reread), deterministicJson(record));
  assertEquals(Object.isFrozen(reread), true);
});

Deno.test("candidate import record rejects an unknown field by exact rebuild", async () => {
  const { record } = await fixtures();
  const source = jsonObject(record);
  source.extra = true;
  const snapshot = deterministicJson(source);
  await assertRejects(
    () => parseFirstPartyMicrosandboxImageCandidateImportRecord(source),
    TypeError,
    "exact rebuilt first-party import record",
  );
  assertEquals(deterministicJson(source), snapshot);
});

Deno.test("candidate import record parse refuses a tampered nested receipt", async () => {
  const { record } = await fixtures();
  const source = jsonObject(record);
  const sourceReceipt = jsonObject(source.sourceReceipt);
  const nested = jsonObject(sourceReceipt.receipt);
  const candidate = jsonObject(nested.candidate);
  candidate.imageName = "ghcr.io/casys-ai/casys-digital-thread-calculix-worker";
  nested.candidate = candidate;
  sourceReceipt.receipt = nested;
  source.sourceReceipt = sourceReceipt;
  await assertRejects(
    () => parseFirstPartyMicrosandboxImageCandidateImportRecord(source),
    TypeError,
    "exact rebuilt first-party receipt",
  );
});

Deno.test("candidate import record parse recalculates the source-receipt fingerprint", async () => {
  const { record } = await fixtures();
  const source = jsonObject(record);
  const sourceReceipt = jsonObject(source.sourceReceipt);
  sourceReceipt.fingerprint = `sha256:${"0".repeat(64)}`;
  source.sourceReceipt = sourceReceipt;
  const snapshot = deterministicJson(source);
  await assertRejects(
    () => parseFirstPartyMicrosandboxImageCandidateImportRecord(source),
    TypeError,
    "SHA-256 of the exact rebuilt candidate receipt",
  );
  assertEquals(deterministicJson(source), snapshot);
});

Deno.test("candidate import record bind refuses a stale historical matrix fingerprint", async () => {
  const { matrix, receipt } = await fixtures();
  const staleReceipt = buildFirstPartyMicrosandboxImageCandidateReceipt({
    matrix,
    matrixFingerprint: `sha256:${"0".repeat(64)}`,
    physicalImageId: receipt.candidate.physicalImageId,
    ociIndexDigest: receipt.candidate.oci.indexDigest,
    platformManifestDigest: receipt.candidate.oci.platformManifestDigest,
    locatorTag: receipt.candidate.locatorTag,
    gitSha: receipt.candidate.git.sha,
    gitTag: receipt.candidate.git.tag,
    buildMetadata: receipt.candidate.build.metadata,
  });
  const record = await buildFirstPartyMicrosandboxImageCandidateImportRecord({
    receipt: staleReceipt,
    microsandboxManifestDigest: MICROSANDBOX_DIGEST,
    status: "imported",
  });
  const parsed = await parseFirstPartyMicrosandboxImageCandidateImportRecord(
    JSON.parse(deterministicJson(record)),
  );
  await assertRejects(
    () =>
      bindFirstPartyMicrosandboxImageCandidateImportRecordToCurrentMatrix(
        parsed,
        matrix,
      ),
    TypeError,
    "exact historical distribution matrix",
  );
});

Deno.test("candidate import record bind accepts unrelated matrix drift and refuses selected-entry drift", async () => {
  const { matrix, record } = await fixtures();
  const unrelatedDrift = withChangedQualificationTarget(
    matrix,
    "calculix-worker",
    "7",
  );
  const bound =
    await bindFirstPartyMicrosandboxImageCandidateImportRecordToCurrentMatrix(
      record,
      unrelatedDrift,
    );
  assertEquals(deterministicJson(bound), deterministicJson(record));

  const selectedEntryDrift = withChangedQualificationTarget(
    matrix,
    "ngspice-worker",
    "8",
  );
  await assertRejects(
    () =>
      bindFirstPartyMicrosandboxImageCandidateImportRecordToCurrentMatrix(
        record,
        selectedEntryDrift,
      ),
    TypeError,
    "candidate-entry-compatibility/2.0",
  );
});

Deno.test("candidate import record parse refuses a tampered physical image id", async () => {
  const { record } = await fixtures();
  const source = jsonObject(record);
  const candidate = jsonObject(source.candidate);
  candidate.physicalImageId = "calculix-worker";
  source.candidate = candidate;
  const snapshot = deterministicJson(source);
  await assertRejects(
    () => parseFirstPartyMicrosandboxImageCandidateImportRecord(source),
    TypeError,
    "exact rebuilt first-party import record",
  );
  assertEquals(deterministicJson(source), snapshot);
});

Deno.test("candidate import record parse refuses a tampered image name", async () => {
  const { record } = await fixtures();
  const source = jsonObject(record);
  const candidate = jsonObject(source.candidate);
  candidate.imageName = "ghcr.io/casys-ai/casys-digital-thread-calculix-worker";
  source.candidate = candidate;
  await assertRejects(
    () => parseFirstPartyMicrosandboxImageCandidateImportRecord(source),
    TypeError,
    "exact rebuilt first-party import record",
  );
});

Deno.test("candidate import record parse refuses a tampered OCI or candidate reference", async () => {
  const { record } = await fixtures();
  const source = jsonObject(record);
  const candidate = jsonObject(source.candidate);
  const oci = jsonObject(candidate.oci);
  oci.indexReference = `${candidate.imageName}@sha256:${"0".repeat(64)}`;
  candidate.oci = oci;
  source.candidate = candidate;
  await assertRejects(
    () => parseFirstPartyMicrosandboxImageCandidateImportRecord(source),
    TypeError,
    "exact rebuilt first-party import record",
  );

  const refSource = jsonObject(record);
  const refCandidate = jsonObject(refSource.candidate);
  const microsandbox = jsonObject(refCandidate.microsandbox);
  microsandbox.candidateReference = "casys/archive-returned-other@sha256:" +
    "9".repeat(64);
  refCandidate.microsandbox = microsandbox;
  refSource.candidate = refCandidate;
  await assertRejects(
    () => parseFirstPartyMicrosandboxImageCandidateImportRecord(refSource),
    TypeError,
    "exact rebuilt first-party import record",
  );
});

Deno.test("candidate import record parse refuses a tampered digest", async () => {
  const { record } = await fixtures();
  const uppercase = jsonObject(record);
  const candidate = jsonObject(uppercase.candidate);
  const oci = jsonObject(candidate.oci);
  oci.indexDigest = `sha256:${"B".repeat(64)}`;
  candidate.oci = oci;
  uppercase.candidate = candidate;
  await assertRejects(
    () => parseFirstPartyMicrosandboxImageCandidateImportRecord(uppercase),
    TypeError,
    "exact rebuilt first-party import record",
  );

  const identity = jsonObject(record);
  const identities = jsonObject(identity.identities);
  identities.ociIndexDigest = `sha256:${"0".repeat(64)}`;
  identity.identities = identities;
  await assertRejects(
    () => parseFirstPartyMicrosandboxImageCandidateImportRecord(identity),
    TypeError,
    "exact rebuilt first-party import record",
  );
});

Deno.test("candidate import record parse refuses a tampered catalogue pin", async () => {
  const { record } = await fixtures();
  const source = jsonObject(record);
  const candidate = jsonObject(source.candidate);
  candidate.qualificationTarget = {
    imageReference: `casys/other-worker@sha256:${"0".repeat(64)}`,
    manifestDigest: `sha256:${"0".repeat(64)}`,
  };
  source.candidate = candidate;
  const snapshot = deterministicJson(source);
  await assertRejects(
    () => parseFirstPartyMicrosandboxImageCandidateImportRecord(source),
    TypeError,
    "exact rebuilt first-party import record",
  );
  assertEquals(deterministicJson(source), snapshot);
});

Deno.test("candidate import record parse refuses a tampered compliance or host state", async () => {
  const { record } = await fixtures();
  const compliance = jsonObject(record);
  const artifactCompliance = jsonObject(compliance.artifactCompliance);
  artifactCompliance.runtimeQualification = "pass";
  artifactCompliance.eligibleForPromotion = true;
  compliance.artifactCompliance = artifactCompliance;
  await assertRejects(
    () => parseFirstPartyMicrosandboxImageCandidateImportRecord(compliance),
    TypeError,
    "exact rebuilt first-party import record",
  );

  const host = jsonObject(record);
  const imported = jsonObject(host.import);
  imported.hostArchitecture = "amd64";
  imported.pullPolicy = "always";
  host.import = imported;
  await assertRejects(
    () => parseFirstPartyMicrosandboxImageCandidateImportRecord(host),
    TypeError,
    "exact rebuilt first-party import record",
  );
});

Deno.test("candidate import record accepts equal OCI and Microsandbox digest text", async () => {
  const { receipt, matrix } = await fixtures();
  const record = await buildFirstPartyMicrosandboxImageCandidateImportRecord({
    receipt,
    microsandboxManifestDigest: PLATFORM_MANIFEST_DIGEST,
    status: "imported",
  });
  assertEquals(
    record.identities.ociPlatformManifestDigest,
    PLATFORM_MANIFEST_DIGEST,
  );
  assertEquals(
    record.identities.microsandboxManifestDigest,
    PLATFORM_MANIFEST_DIGEST,
  );
  assertEquals(
    record.identities.ociIndexDigest === PLATFORM_MANIFEST_DIGEST,
    false,
  );
  assertEquals(
    record.candidate.oci.platformManifestDigest,
    record.candidate.microsandbox.manifestDigest,
  );
  assertEquals(
    record.candidate.microsandbox.candidateReference,
    `${
      firstPartyMicrosandboxImageCandidateName("ngspice-worker")
    }@${PLATFORM_MANIFEST_DIGEST}`,
  );
  assertEquals(
    record.candidate.qualificationTarget.imageReference ===
      record.candidate.microsandbox.candidateReference,
    false,
  );
  const bound = await readBoundFirstPartyMicrosandboxImageCandidateImportRecord(
    deterministicJson(record),
    matrix,
  );
  assertEquals(deterministicJson(bound), deterministicJson(record));
});

Deno.test("candidate import record parse and bind do not mutate the source", async () => {
  const { record, matrix } = await fixtures();
  const source = freezeJson(JSON.parse(deterministicJson(record)));
  const snapshot = deterministicJson(source);
  const parsed = await parseFirstPartyMicrosandboxImageCandidateImportRecord(
    source,
  );
  await bindFirstPartyMicrosandboxImageCandidateImportRecordToCurrentMatrix(
    parsed,
    matrix,
  );
  assertEquals(deterministicJson(source), snapshot);

  const unknown = freezeJson({
    ...JSON.parse(deterministicJson(record)) as Record<string, unknown>,
    extra: true,
  });
  const unknownSnapshot = deterministicJson(unknown);
  await assertRejects(
    () => parseFirstPartyMicrosandboxImageCandidateImportRecord(unknown),
    TypeError,
    "exact rebuilt first-party import record",
  );
  assertEquals(deterministicJson(unknown), unknownSnapshot);

  const pin = freezeJson(retargetQualification(record));
  const pinSnapshot = deterministicJson(pin);
  await assertRejects(
    () => parseFirstPartyMicrosandboxImageCandidateImportRecord(pin),
    TypeError,
    "exact rebuilt first-party import record",
  );
  assertEquals(deterministicJson(pin), pinSnapshot);
  assertEquals(deterministicJson(source), snapshot);
});

Deno.test("candidate import record parse refuses missing or ill-typed fields", async () => {
  const { record } = await fixtures();
  const missing = jsonObject(record);
  delete missing.sourceReceipt;
  await assertRejects(
    () => parseFirstPartyMicrosandboxImageCandidateImportRecord(missing),
    TypeError,
    "source receipt",
  );
  const missingReceipt = jsonObject(record);
  const sourceReceipt = jsonObject(missingReceipt.sourceReceipt);
  delete sourceReceipt.receipt;
  missingReceipt.sourceReceipt = sourceReceipt;
  await assertRejects(
    () => parseFirstPartyMicrosandboxImageCandidateImportRecord(missingReceipt),
    TypeError,
    "source receipt",
  );
  const illTyped = jsonObject(record);
  illTyped.import = true;
  await assertRejects(
    () => parseFirstPartyMicrosandboxImageCandidateImportRecord(illTyped),
    TypeError,
    "must be a JSON object",
  );
});

async function fixtures(): Promise<{
  readonly receipt: FirstPartyMicrosandboxImageCandidateReceipt;
  readonly record: FirstPartyMicrosandboxImageCandidateImportRecord;
  readonly matrix: FirstPartyMicrosandboxImageDistributionMatrix;
}> {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
  const receipt = await bindFirstPartyMicrosandboxImageCandidateReceiptToCurrentMatrix(
    buildFirstPartyMicrosandboxImageCandidateReceipt({
      matrix,
      matrixFingerprint: await fingerprintFirstPartyMicrosandboxImageDistributionMatrix(
        matrix,
      ),
      physicalImageId: "ngspice-worker",
      ociIndexDigest: OCI_INDEX_DIGEST,
      platformManifestDigest: PLATFORM_MANIFEST_DIGEST,
      locatorTag: `git-${GIT_SHA}-run-42-1`,
      gitSha: GIT_SHA,
      gitTag: "first-party-microvm-v0.1.0",
      buildMetadata: { "containerimage.digest": OCI_INDEX_DIGEST },
    }),
    matrix,
  );
  const record = await buildFirstPartyMicrosandboxImageCandidateImportRecord({
    receipt,
    microsandboxManifestDigest: MICROSANDBOX_DIGEST,
    status: "imported",
  });
  assertEquals(
    record.inputMatrix.schemaVersion,
    FIRST_PARTY_MICROSANDBOX_IMAGE_DISTRIBUTION_MATRIX_SCHEMA,
  );
  return { receipt, record, matrix };
}

function retargetQualification(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
): Record<string, unknown> {
  const source = jsonObject(record);
  const candidate = jsonObject(source.candidate);
  candidate.qualificationTarget = {
    imageReference: `casys/other-worker@sha256:${"0".repeat(64)}`,
    manifestDigest: `sha256:${"0".repeat(64)}`,
  };
  source.candidate = candidate;
  return source;
}

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

function jsonObject(value: unknown): Record<string, unknown> {
  return JSON.parse(deterministicJson(value)) as Record<string, unknown>;
}

function freezeJson(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (const item of value) freezeJson(item);
    return Object.freeze(value);
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    freezeJson(item);
  }
  return Object.freeze(value);
}
