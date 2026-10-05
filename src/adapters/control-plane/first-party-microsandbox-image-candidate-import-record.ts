/**
 * Pure first-party Microsandbox candidate-import record. Parse rebuilds the
 * exact document from the preserved candidate receipt and the observed
 * Microsandbox digest; it recalculates the source-receipt fingerprint.
 * Bind re-binds that receipt to the current distribution matrix and proves
 * the recorded identities against it. Later qualification gates take only a
 * bound record. This module never selects a provider, image, digest,
 * platform, tool, or argument, and never claims qualification or promotion.
 *
 * OCI index, linux/arm64 platform-manifest, and Microsandbox digest remain
 * separate provenance fields even when their hash text coincides.
 */

import {
  deterministicJson,
  sha256Hex,
} from "../../domain/kernel/deterministic-json.ts";
import {
  bindFirstPartyMicrosandboxImageCandidateReceiptToCurrentMatrix,
  FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_RECEIPT_SCHEMA,
  type FirstPartyMicrosandboxImageCandidateReceipt,
  parseFirstPartyMicrosandboxImageCandidateReceipt,
} from "./first-party-microsandbox-image-candidate-receipt.ts";
import {
  assertFirstPartyMicrosandboxCandidateImageName,
  assertFirstPartyMicrosandboxImageDistributionContract,
  FIRST_PARTY_MICROSANDBOX_IMAGE_DISTRIBUTION_MATRIX_SCHEMA,
  firstPartyMicrosandboxGhcrPackageName,
  type FirstPartyMicrosandboxImageDistributionEntry,
  type FirstPartyMicrosandboxImageDistributionMatrix,
  type FirstPartyMicrosandboxImageQualificationTarget,
} from "./first-party-microsandbox-image-distribution-matrix.ts";

export const FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA =
  "first-party-microsandbox-image-candidate-import/3.0" as const;

export const FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_DIRECTORY =
  "state/local/first-party-microsandbox-image-candidate-import" as const;

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const GIT_SHA = /^[0-9a-f]{40}$/u;
const LOCATOR_TAG = /^git-[0-9a-f]{40}-run-[1-9][0-9]*-[1-9][0-9]*$/u;
const CANDIDATE_REPOSITORY_PREFIX = "casys/first-party-candidate-" as const;
const PULL_POLICY_NEVER = "never" as const;

export interface FirstPartyMicrosandboxImageCandidateImportRecord {
  readonly schemaVersion:
    typeof FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA;
  readonly candidate: {
    readonly physicalImageId: string;
    readonly imageName: string;
    readonly oci: FirstPartyMicrosandboxImageCandidateReceipt["candidate"]["oci"];
    readonly microsandbox: {
      readonly candidateReference: string;
      readonly manifestDigest: string;
    };
    readonly locatorTag: string;
    readonly locatorReference: string;
    readonly git: FirstPartyMicrosandboxImageCandidateReceipt["candidate"]["git"];
    readonly qualificationTarget: FirstPartyMicrosandboxImageQualificationTarget;
  };
  readonly identities: {
    readonly ociIndexDigest: string;
    readonly ociPlatformManifestDigest: string;
    readonly microsandboxManifestDigest: string;
  };
  readonly inputMatrix: {
    readonly fingerprint: string;
    readonly schemaVersion:
      typeof FIRST_PARTY_MICROSANDBOX_IMAGE_DISTRIBUTION_MATRIX_SCHEMA;
  };
  readonly sourceReceipt: {
    readonly fingerprint: string;
    readonly schemaVersion:
      typeof FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_RECEIPT_SCHEMA;
    readonly receipt: FirstPartyMicrosandboxImageCandidateReceipt;
  };
  readonly artifactCompliance: {
    readonly licence: "unresolved";
    readonly anonymousPull: "not-run";
    readonly runtimeQualification: "not-run";
    readonly eligibleForPromotion: false;
    readonly sbom: "requested";
    readonly provenance: "requested";
  };
  readonly import: {
    readonly status: "imported" | "already-cached";
    readonly hostArchitecture: "arm64";
    readonly pullPolicy: typeof PULL_POLICY_NEVER;
  };
}

export function firstPartyMicrosandboxImageCandidateName(
  physicalImageId: string,
): string {
  firstPartyMicrosandboxGhcrPackageName(physicalImageId);
  return `${CANDIDATE_REPOSITORY_PREFIX}${physicalImageId}`;
}

export function firstPartyMicrosandboxImageCandidateReference(
  physicalImageId: string,
  microsandboxManifestDigest: string,
): string {
  assertSha256(
    microsandboxManifestDigest,
    "candidate Microsandbox manifest digest",
  );
  return `${
    firstPartyMicrosandboxImageCandidateName(physicalImageId)
  }@${microsandboxManifestDigest}`;
}

export async function fingerprintFirstPartyMicrosandboxImageCandidateImportSourceReceipt(
  receipt: FirstPartyMicrosandboxImageCandidateReceipt,
): Promise<string> {
  const exact = parseFirstPartyMicrosandboxImageCandidateReceipt(
    JSON.parse(deterministicJson(receipt)),
  );
  return `sha256:${await sha256Hex(
    new TextEncoder().encode(deterministicJson(exact)),
  )}`;
}

export async function fingerprintFirstPartyMicrosandboxImageCandidateImportRecord(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
): Promise<string> {
  const exact = await parseFirstPartyMicrosandboxImageCandidateImportRecord(
    JSON.parse(deterministicJson(record)),
  );
  return `sha256:${await sha256Hex(
    new TextEncoder().encode(deterministicJson(exact)),
  )}`;
}

export async function buildFirstPartyMicrosandboxImageCandidateImportRecord(
  input: {
    readonly receipt: FirstPartyMicrosandboxImageCandidateReceipt;
    readonly microsandboxManifestDigest: string;
    readonly status: "imported" | "already-cached";
  },
): Promise<FirstPartyMicrosandboxImageCandidateImportRecord> {
  assertLiteralNotRunCompliance(input.receipt.artifactCompliance);
  const receipt = parseFirstPartyMicrosandboxImageCandidateReceipt(
    JSON.parse(deterministicJson(input.receipt)),
  );
  const rebuilt = rebuildImportRecord({
    receipt,
    sourceReceiptFingerprint:
      await fingerprintFirstPartyMicrosandboxImageCandidateImportSourceReceipt(
        receipt,
      ),
    microsandboxManifestDigest: input.microsandboxManifestDigest,
    status: input.status,
  });
  return await parseFirstPartyMicrosandboxImageCandidateImportRecord(
    JSON.parse(deterministicJson(rebuilt)),
  );
}

export async function parseFirstPartyMicrosandboxImageCandidateImportRecord(
  value: unknown,
): Promise<FirstPartyMicrosandboxImageCandidateImportRecord> {
  const root = jsonObject(value, "candidate import record");
  if (
    root.schemaVersion !==
      FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA
  ) {
    throw new TypeError(
      "Candidate import record schema is not first-party-microsandbox-image-candidate-import/3.0.",
    );
  }
  const candidate = jsonObject(root.candidate, "candidate import record candidate");
  const microsandbox = jsonObject(
    candidate.microsandbox,
    "candidate import record microsandbox",
  );
  const inputMatrix = jsonObject(
    root.inputMatrix,
    "candidate import record input matrix",
  );
  const sourceReceipt = jsonObject(
    root.sourceReceipt,
    "candidate import record source receipt",
  );
  const imported = jsonObject(root.import, "candidate import record import");
  if (
    inputMatrix.schemaVersion !==
      FIRST_PARTY_MICROSANDBOX_IMAGE_DISTRIBUTION_MATRIX_SCHEMA
  ) {
    throw new TypeError(
      "Candidate import record input matrix schema is not the current distribution matrix schema.",
    );
  }
  if (
    sourceReceipt.schemaVersion !==
      FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_RECEIPT_SCHEMA
  ) {
    throw new TypeError(
      "Candidate import record source receipt schema is not the current candidate receipt schema.",
    );
  }
  jsonObject(sourceReceipt.receipt, "candidate import record source receipt");
  const receipt = parseFirstPartyMicrosandboxImageCandidateReceipt(
    sourceReceipt.receipt,
  );
  const sourceReceiptFingerprint =
    await fingerprintFirstPartyMicrosandboxImageCandidateImportSourceReceipt(
      receipt,
    );
  if (
    requiredString(
      sourceReceipt.fingerprint,
      "candidate import record source receipt fingerprint",
    ) !== sourceReceiptFingerprint
  ) {
    throw new TypeError(
      "Candidate import record source receipt fingerprint is not the SHA-256 of the exact rebuilt candidate receipt.",
    );
  }
  const rebuilt = rebuildImportRecord({
    receipt,
    sourceReceiptFingerprint,
    microsandboxManifestDigest: requiredString(
      microsandbox.manifestDigest,
      "candidate import record Microsandbox manifest digest",
    ),
    status: requiredImportStatus(imported.status),
  });
  if (deterministicJson(rebuilt) !== deterministicJson(value)) {
    throw new TypeError(
      "Candidate import record is not the exact rebuilt first-party import record.",
    );
  }
  return rebuilt;
}

export async function bindFirstPartyMicrosandboxImageCandidateImportRecordToCurrentMatrix(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
  matrix: FirstPartyMicrosandboxImageDistributionMatrix,
): Promise<FirstPartyMicrosandboxImageCandidateImportRecord> {
  const parsed = await parseFirstPartyMicrosandboxImageCandidateImportRecord(
    JSON.parse(deterministicJson(record)),
  );
  assertFirstPartyMicrosandboxImageDistributionContract(matrix);
  if (parsed.inputMatrix.schemaVersion !== matrix.schemaVersion) {
    throw new TypeError(
      "Candidate import record input matrix schema is not the current server-owned distribution matrix.",
    );
  }
  await bindFirstPartyMicrosandboxImageCandidateReceiptToCurrentMatrix(
    parsed.sourceReceipt.receipt,
    matrix,
  );
  const selected = selectPhysicalImage(
    matrix,
    parsed.candidate.physicalImageId,
  );
  assertRecordMatchesSelectedMatrixEntry(parsed, selected);
  return parsed;
}

export async function readBoundFirstPartyMicrosandboxImageCandidateImportRecord(
  source: string,
  matrix: FirstPartyMicrosandboxImageDistributionMatrix,
): Promise<FirstPartyMicrosandboxImageCandidateImportRecord> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new TypeError(`Candidate import record must be valid JSON: ${detail}`);
  }
  const record = await parseFirstPartyMicrosandboxImageCandidateImportRecord(
    parsed,
  );
  return await bindFirstPartyMicrosandboxImageCandidateImportRecordToCurrentMatrix(
    record,
    matrix,
  );
}

export function renderFirstPartyMicrosandboxImageCandidateImportRecordText(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
): string {
  return [
    `schemaVersion=${record.schemaVersion}`,
    `status=${record.import.status}`,
    `physicalImageId=${record.candidate.physicalImageId}`,
    `imageName=${record.candidate.imageName}`,
    `oci.indexDigest=${record.identities.ociIndexDigest}`,
    `oci.platformManifestDigest=${record.identities.ociPlatformManifestDigest}`,
    `microsandbox.manifestDigest=${record.identities.microsandboxManifestDigest}`,
    `microsandbox.candidateReference=${record.candidate.microsandbox.candidateReference}`,
    `qualificationTarget.imageReference=${record.candidate.qualificationTarget.imageReference}`,
    `sourceReceipt.fingerprint=${record.sourceReceipt.fingerprint}`,
    `matrixFingerprint=${record.inputMatrix.fingerprint}`,
    `hostArchitecture=${record.import.hostArchitecture}`,
    `pullPolicy=${record.import.pullPolicy}`,
    `runtimeQualification=${record.artifactCompliance.runtimeQualification}`,
    `eligibleForPromotion=${record.artifactCompliance.eligibleForPromotion}`,
    "Domain qualification remains not-run. Promotion is false.",
    "",
  ].join("\n");
}

function rebuildImportRecord(input: {
  readonly receipt: FirstPartyMicrosandboxImageCandidateReceipt;
  readonly sourceReceiptFingerprint: string;
  readonly microsandboxManifestDigest: string;
  readonly status: "imported" | "already-cached";
}): FirstPartyMicrosandboxImageCandidateImportRecord {
  const receipt = parseFirstPartyMicrosandboxImageCandidateReceipt(
    JSON.parse(deterministicJson(input.receipt)),
  );
  assertLiteralNotRunCompliance(receipt.artifactCompliance);
  assertSha256(
    receipt.candidate.oci.indexDigest,
    "candidate import record OCI index digest",
  );
  assertSha256(
    receipt.candidate.oci.platformManifestDigest,
    "candidate import record linux/arm64 OCI manifest digest",
  );
  assertSha256(
    input.microsandboxManifestDigest,
    "candidate import record Microsandbox manifest digest",
  );
  assertSha256(
    receipt.inputMatrix.fingerprint,
    "candidate import record matrix fingerprint",
  );
  assertSha256(
    input.sourceReceiptFingerprint,
    "candidate import record source receipt fingerprint",
  );
  assertGitSha(receipt.candidate.git.sha);
  assertGitTag(receipt.candidate.git.tag);
  assertLocatorTag(receipt.candidate.locatorTag, receipt.candidate.git.sha);
  const imageName = receipt.candidate.imageName;
  assertFirstPartyMicrosandboxCandidateImageName(
    imageName,
    receipt.candidate.physicalImageId,
  );
  const candidateReference = firstPartyMicrosandboxImageCandidateReference(
    receipt.candidate.physicalImageId,
    input.microsandboxManifestDigest,
  );
  const qualificationTarget = copyQualificationTarget(
    receipt.candidate.qualificationTarget,
  );
  if (qualificationTarget.imageReference === candidateReference) {
    throw new TypeError(
      "Candidate import record qualification target must not be the candidate reference.",
    );
  }
  return Object.freeze({
    schemaVersion: FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA,
    candidate: Object.freeze({
      physicalImageId: receipt.candidate.physicalImageId,
      imageName,
      oci: receipt.candidate.oci,
      microsandbox: Object.freeze({
        candidateReference,
        manifestDigest: input.microsandboxManifestDigest,
      }),
      locatorTag: receipt.candidate.locatorTag,
      locatorReference: receipt.candidate.locatorReference,
      git: receipt.candidate.git,
      qualificationTarget,
    }),
    identities: Object.freeze({
      ociIndexDigest: receipt.candidate.oci.indexDigest,
      ociPlatformManifestDigest: receipt.candidate.oci.platformManifestDigest,
      microsandboxManifestDigest: input.microsandboxManifestDigest,
    }),
    inputMatrix: Object.freeze({
      fingerprint: receipt.inputMatrix.fingerprint,
      schemaVersion: FIRST_PARTY_MICROSANDBOX_IMAGE_DISTRIBUTION_MATRIX_SCHEMA,
    }),
    sourceReceipt: Object.freeze({
      fingerprint: input.sourceReceiptFingerprint,
      schemaVersion: FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_RECEIPT_SCHEMA,
      receipt,
    }),
    artifactCompliance: Object.freeze({
      licence: "unresolved" as const,
      anonymousPull: "not-run" as const,
      runtimeQualification: "not-run" as const,
      eligibleForPromotion: false as const,
      sbom: "requested" as const,
      provenance: "requested" as const,
    }),
    import: Object.freeze({
      status: input.status,
      hostArchitecture: "arm64" as const,
      pullPolicy: PULL_POLICY_NEVER,
    }),
  });
}

function assertRecordMatchesSelectedMatrixEntry(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
  selected: FirstPartyMicrosandboxImageDistributionEntry,
): void {
  // The preserved source receipt has already been bound to this current entry.
  // Keep the original repository alongside its original OCI digests, not a retag.
  const imageName = record.candidate.imageName;
  assertFirstPartyMicrosandboxCandidateImageName(imageName, selected.physicalImageId);
  if (
    record.candidate.oci.indexReference !==
      `${imageName}@${record.candidate.oci.indexDigest}` ||
    record.candidate.oci.platformManifestReference !==
      `${imageName}@${record.candidate.oci.platformManifestDigest}`
  ) {
    throw new TypeError(
      "Candidate import record OCI references must use the preserved receipt imageName and recorded digests.",
    );
  }
  if (
    deterministicJson(record.candidate.qualificationTarget) !==
      deterministicJson(selected.qualificationTarget)
  ) {
    throw new TypeError(
      "Candidate import record qualification target is not the current matrix entry.",
    );
  }
  const expectedCandidateReference = firstPartyMicrosandboxImageCandidateReference(
    selected.physicalImageId,
    record.identities.microsandboxManifestDigest,
  );
  if (
    record.candidate.microsandbox.candidateReference !== expectedCandidateReference
  ) {
    throw new TypeError(
      "Candidate import record candidateReference is not casys/first-party-candidate-<physicalImageId>@sha256:<recorded Microsandbox digest>.",
    );
  }
  if (
    record.candidate.microsandbox.candidateReference ===
      selected.qualificationTarget.imageReference
  ) {
    throw new TypeError(
      "Candidate import record qualification target must not be the candidate reference.",
    );
  }
  if (
    record.import.hostArchitecture !== "arm64" ||
    record.import.pullPolicy !== PULL_POLICY_NEVER
  ) {
    throw new TypeError(
      "Candidate import record host architecture and pull policy must remain arm64/never.",
    );
  }
  if (
    record.artifactCompliance.licence !== "unresolved" ||
    record.artifactCompliance.anonymousPull !== "not-run" ||
    record.artifactCompliance.runtimeQualification !== "not-run" ||
    record.artifactCompliance.eligibleForPromotion !== false ||
    record.artifactCompliance.sbom !== "requested" ||
    record.artifactCompliance.provenance !== "requested"
  ) {
    throw new TypeError(
      "Candidate import record compliance states must remain literal and non-promoted.",
    );
  }
}

function selectPhysicalImage(
  matrix: FirstPartyMicrosandboxImageDistributionMatrix,
  physicalImageId: string,
): FirstPartyMicrosandboxImageDistributionEntry {
  const matches = matrix.images.filter((image) =>
    image.physicalImageId === physicalImageId
  );
  if (matches.length !== 1) {
    throw new TypeError(
      `Candidate import record requires exactly one matrix image for ${physicalImageId}.`,
    );
  }
  return matches[0]!;
}

function copyQualificationTarget(
  value: FirstPartyMicrosandboxImageQualificationTarget,
): FirstPartyMicrosandboxImageQualificationTarget {
  assertSha256(
    value.manifestDigest,
    "candidate import record qualification target digest",
  );
  if (
    typeof value.imageReference !== "string" ||
    value.imageReference.length === 0 ||
    !value.imageReference.endsWith(`@${value.manifestDigest}`) ||
    value.imageReference.endsWith(":latest")
  ) {
    throw new TypeError(
      "Candidate import record qualification target must be a digest-pinned reference.",
    );
  }
  return Object.freeze({
    imageReference: value.imageReference,
    manifestDigest: value.manifestDigest,
  });
}

function assertLiteralNotRunCompliance(value: {
  readonly runtimeQualification: string;
  readonly eligibleForPromotion: boolean;
}): void {
  if (
    value.runtimeQualification !== "not-run" ||
    value.eligibleForPromotion !== false
  ) {
    throw new TypeError(
      "Candidate import requires runtimeQualification=not-run and eligibleForPromotion=false.",
    );
  }
}

function assertSha256(value: string, label: string): void {
  if (!SHA256.test(value)) {
    throw new TypeError(`${label} must be an exact lowercase sha256 digest.`);
  }
}

function assertGitSha(value: string): void {
  if (!GIT_SHA.test(value)) {
    throw new TypeError(
      "Candidate import record git SHA must be a full lowercase commit SHA.",
    );
  }
}

function assertGitTag(value: string): void {
  if (value.length === 0 || /[\r\n\0]/u.test(value)) {
    throw new TypeError(
      "Candidate import record git tag must be a non-empty single line.",
    );
  }
}

function assertLocatorTag(value: string, gitSha: string): void {
  if (!LOCATOR_TAG.test(value) || !value.startsWith(`git-${gitSha}-`)) {
    throw new TypeError(
      "Candidate import record locator tag must bind the full git SHA and workflow run.",
    );
  }
}

function jsonObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function requiredImportStatus(
  value: unknown,
): "imported" | "already-cached" {
  if (value !== "imported" && value !== "already-cached") {
    throw new TypeError(
      "Candidate import record status must be imported or already-cached.",
    );
  }
  return value;
}
