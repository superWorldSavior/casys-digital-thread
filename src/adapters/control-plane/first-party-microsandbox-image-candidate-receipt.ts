/**
 * Pure candidate-receipt model for first-party Microsandbox OCI builds.
 *
 * This is release evidence, not a runtime qualification record. In
 * particular, the candidate OCI index and platform-manifest digests are
 * deliberately separate from the existing Microsandbox manifest digest that a
 * later, reviewed qualification may compare against.
 */

import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import {
  assertFirstPartyMicrosandboxImageDistributionContract,
  fingerprintFirstPartyMicrosandboxImageDistributionMatrix,
  firstPartyMicrosandboxDistributionEntriesAreCompatible,
  type FirstPartyMicrosandboxImageDistributionEntry,
  type FirstPartyMicrosandboxImageDistributionMatrix,
} from "./first-party-microsandbox-image-distribution-matrix.ts";

export const FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_RECEIPT_SCHEMA =
  "first-party-microsandbox-image-candidate-receipt/1.0" as const;

/**
 * Binding policy for reusing one immutable image receipt after unrelated
 * entries in the server-owned distribution matrix have changed. The receipt
 * keeps its complete historical matrix and fingerprint. Only its selected
 * physical-image entry may bind to the current matrix. Only the exact historical
 * Casys-to-personal imageName relocation may differ; all other fields must remain
 * byte-for-byte identical under deterministic JSON.
 */
export const FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_ENTRY_COMPATIBILITY_SCHEMA =
  "first-party-microsandbox-image-candidate-entry-compatibility/2.0" as const;

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const GIT_SHA = /^[0-9a-f]{40}$/u;
const LOCATOR_TAG = /^git-[0-9a-f]{40}-run-[1-9][0-9]*-[1-9][0-9]*$/u;

export interface FirstPartyMicrosandboxCandidateJsonObject {
  readonly [key: string]: FirstPartyMicrosandboxCandidateJsonValue;
}

export type FirstPartyMicrosandboxCandidateJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly FirstPartyMicrosandboxCandidateJsonValue[]
  | FirstPartyMicrosandboxCandidateJsonObject;

export type FirstPartyMicrosandboxCandidateBuildMetadata =
  FirstPartyMicrosandboxCandidateJsonObject;

export interface FirstPartyMicrosandboxImageCandidateReceiptInput {
  readonly matrix: FirstPartyMicrosandboxImageDistributionMatrix;
  readonly matrixFingerprint: string;
  readonly physicalImageId: string;
  /** Buildx output: OCI index digest, including requested attestations. */
  readonly ociIndexDigest: string;
  /** Exact linux/arm64 image manifest selected from that raw OCI index. */
  readonly platformManifestDigest: string;
  readonly locatorTag: string;
  readonly gitSha: string;
  readonly gitTag: string;
  readonly buildMetadata: FirstPartyMicrosandboxCandidateBuildMetadata;
}

export interface FirstPartyMicrosandboxImageCandidateReceipt {
  readonly schemaVersion:
    typeof FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_RECEIPT_SCHEMA;
  readonly candidate: {
    readonly physicalImageId: string;
    readonly imageName: string;
    readonly oci: {
      readonly indexDigest: string;
      readonly indexReference: string;
      readonly platformManifestDigest: string;
      readonly platformManifestReference: string;
    };
    readonly locatorTag: string;
    readonly locatorReference: string;
    readonly git: {
      readonly sha: string;
      readonly tag: string;
    };
    readonly build: {
      readonly dockerfile: string;
      readonly context: string;
      readonly platform: "linux/arm64";
      readonly metadata: FirstPartyMicrosandboxCandidateBuildMetadata;
    };
    readonly logicalTargets:
      FirstPartyMicrosandboxImageDistributionEntry["logicalTargets"];
    readonly expectedRuntime: {
      readonly user: string;
      readonly entrypoint: readonly string[];
      readonly labels?: Readonly<Record<string, string>>;
    };
    /** Existing Microsandbox runtime identity; never rewritten by this receipt. */
    readonly qualificationTarget:
      FirstPartyMicrosandboxImageDistributionEntry["qualificationTarget"];
  };
  /** The complete, server-owned planning input used for this candidate. */
  readonly inputMatrix: {
    readonly fingerprint: string;
    readonly schemaVersion:
      FirstPartyMicrosandboxImageDistributionMatrix["schemaVersion"];
    readonly contract: FirstPartyMicrosandboxImageDistributionMatrix["contract"];
    readonly platform: "linux/arm64";
    readonly images: readonly FirstPartyMicrosandboxImageDistributionEntry[];
  };
  /** Literal artifact-review state: a successful push proves none of these. */
  readonly artifactCompliance: {
    readonly licence: "unresolved";
    readonly anonymousPull: "not-run";
    readonly runtimeQualification: "not-run";
    readonly eligibleForPromotion: false;
    readonly sbom: "requested";
    readonly provenance: "requested";
  };
}

export function buildFirstPartyMicrosandboxImageCandidateReceipt(
  input: FirstPartyMicrosandboxImageCandidateReceiptInput,
): FirstPartyMicrosandboxImageCandidateReceipt {
  assertFirstPartyMicrosandboxImageDistributionContract(input.matrix);
  assertSha256(input.matrixFingerprint, "matrix fingerprint");
  assertSha256(input.ociIndexDigest, "candidate OCI index digest");
  assertSha256(
    input.platformManifestDigest,
    "candidate linux/arm64 OCI manifest digest",
  );
  assertGitSha(input.gitSha);
  assertGitTag(input.gitTag);
  assertLocatorTag(input.locatorTag, input.gitSha);
  const selected = selectPhysicalImage(input.matrix, input.physicalImageId);
  const indexReference = `${selected.imageName}@${input.ociIndexDigest}`;
  const platformManifestReference =
    `${selected.imageName}@${input.platformManifestDigest}`;
  const locatorReference = `${selected.imageName}:${input.locatorTag}`;
  const buildMetadata = copyJsonObject(input.buildMetadata, "build metadata");
  assertBuildMetadataIndexDigest(buildMetadata, input.ociIndexDigest);

  return Object.freeze({
    schemaVersion: FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_RECEIPT_SCHEMA,
    candidate: Object.freeze({
      physicalImageId: selected.physicalImageId,
      imageName: selected.imageName,
      oci: Object.freeze({
        indexDigest: input.ociIndexDigest,
        indexReference,
        platformManifestDigest: input.platformManifestDigest,
        platformManifestReference,
      }),
      locatorTag: input.locatorTag,
      locatorReference,
      git: Object.freeze({ sha: input.gitSha, tag: input.gitTag }),
      build: Object.freeze({
        dockerfile: selected.dockerfile,
        context: selected.context,
        platform: selected.platform,
        metadata: buildMetadata,
      }),
      logicalTargets: copyLogicalTargets(selected.logicalTargets),
      expectedRuntime: Object.freeze({
        user: selected.expectedUser,
        entrypoint: Object.freeze([...selected.expectedEntrypoint]),
        ...(selected.expectedLabels === undefined
          ? {}
          : { labels: Object.freeze({ ...selected.expectedLabels }) }),
      }),
      qualificationTarget: Object.freeze({ ...selected.qualificationTarget }),
    }),
    inputMatrix: Object.freeze({
      fingerprint: input.matrixFingerprint,
      schemaVersion: input.matrix.schemaVersion,
      contract: Object.freeze({ ...input.matrix.contract }),
      platform: input.matrix.platform,
      images: Object.freeze(input.matrix.images.map(copyDistributionEntry)),
    }),
    artifactCompliance: Object.freeze({
      licence: "unresolved",
      anonymousPull: "not-run",
      runtimeQualification: "not-run",
      eligibleForPromotion: false,
      sbom: "requested",
      provenance: "requested",
    }),
  });
}

export function parseFirstPartyMicrosandboxImageCandidateReceipt(
  value: unknown,
): FirstPartyMicrosandboxImageCandidateReceipt {
  const root = jsonObject(value, "candidate receipt");
  if (
    root.schemaVersion !== FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_RECEIPT_SCHEMA
  ) {
    throw new TypeError(
      "Candidate receipt schema is not first-party-microsandbox-image-candidate-receipt/1.0.",
    );
  }
  const candidate = jsonObject(root.candidate, "candidate receipt candidate");
  const oci = jsonObject(candidate.oci, "candidate receipt oci");
  const git = jsonObject(candidate.git, "candidate receipt git");
  const build = jsonObject(candidate.build, "candidate receipt build");
  const inputMatrix = jsonObject(
    root.inputMatrix,
    "candidate receipt input matrix",
  );
  const matrix = {
    schemaVersion: inputMatrix.schemaVersion,
    contract: inputMatrix.contract,
    platform: inputMatrix.platform,
    images: inputMatrix.images,
  } as FirstPartyMicrosandboxImageDistributionMatrix;
  const rebuilt = buildFirstPartyMicrosandboxImageCandidateReceipt({
    matrix,
    matrixFingerprint: requiredString(
      inputMatrix.fingerprint,
      "candidate receipt matrix fingerprint",
    ),
    physicalImageId: requiredString(
      candidate.physicalImageId,
      "candidate receipt physicalImageId",
    ),
    ociIndexDigest: requiredString(
      oci.indexDigest,
      "candidate receipt OCI index digest",
    ),
    platformManifestDigest: requiredString(
      oci.platformManifestDigest,
      "candidate receipt linux/arm64 OCI manifest digest",
    ),
    locatorTag: requiredString(candidate.locatorTag, "candidate receipt locator tag"),
    gitSha: requiredString(git.sha, "candidate receipt git SHA"),
    gitTag: requiredString(git.tag, "candidate receipt git tag"),
    buildMetadata: copyJsonObject(build.metadata, "build metadata"),
  });
  if (deterministicJson(rebuilt) !== deterministicJson(value)) {
    throw new TypeError(
      "Candidate receipt is not the exact rebuilt first-party receipt.",
    );
  }
  return rebuilt;
}

export async function bindFirstPartyMicrosandboxImageCandidateReceiptToCurrentMatrix(
  receipt: FirstPartyMicrosandboxImageCandidateReceipt,
  matrix: FirstPartyMicrosandboxImageDistributionMatrix,
): Promise<FirstPartyMicrosandboxImageCandidateReceipt> {
  assertFirstPartyMicrosandboxImageDistributionContract(matrix);
  const historicalMatrix = receiptInputMatrix(receipt);
  const historicalFingerprint =
    await fingerprintFirstPartyMicrosandboxImageDistributionMatrix(
      historicalMatrix,
    );
  if (receipt.inputMatrix.fingerprint !== historicalFingerprint) {
    throw new TypeError(
      "Candidate receipt matrix fingerprint is not the SHA-256 of its exact historical distribution matrix.",
    );
  }
  const historicalEntry = selectPhysicalImage(
    historicalMatrix,
    receipt.candidate.physicalImageId,
  );
  const currentEntry = selectPhysicalImage(
    matrix,
    receipt.candidate.physicalImageId,
  );
  if (
    !firstPartyMicrosandboxDistributionEntriesAreCompatible(
      historicalEntry,
      currentEntry,
    )
  ) {
    throw new TypeError(
      `Candidate receipt selected entry is not compatible with the current server-owned distribution entry under ${FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_ENTRY_COMPATIBILITY_SCHEMA}.`,
    );
  }
  return receipt;
}

export async function readBoundFirstPartyMicrosandboxImageCandidateReceipt(
  source: string,
  matrix: FirstPartyMicrosandboxImageDistributionMatrix,
): Promise<FirstPartyMicrosandboxImageCandidateReceipt> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new TypeError(`Candidate receipt must be valid JSON: ${detail}`);
  }
  const receipt = parseFirstPartyMicrosandboxImageCandidateReceipt(parsed);
  return await bindFirstPartyMicrosandboxImageCandidateReceiptToCurrentMatrix(
    receipt,
    matrix,
  );
}

export function renderFirstPartyMicrosandboxImageCandidateReceiptText(
  receipt: FirstPartyMicrosandboxImageCandidateReceipt,
): string {
  const { candidate, artifactCompliance, inputMatrix } = receipt;
  return [
    `schemaVersion=${receipt.schemaVersion}`,
    `physicalImageId=${candidate.physicalImageId}`,
    `imageName=${candidate.imageName}`,
    `oci.indexDigest=${candidate.oci.indexDigest}`,
    `oci.indexReference=${candidate.oci.indexReference}`,
    `oci.platformManifestDigest=${candidate.oci.platformManifestDigest}`,
    `oci.platformManifestReference=${candidate.oci.platformManifestReference}`,
    `locatorTag=${candidate.locatorTag}`,
    `locatorReference=${candidate.locatorReference}`,
    `gitSha=${candidate.git.sha}`,
    `gitTag=${candidate.git.tag}`,
    `dockerfile=${candidate.build.dockerfile}`,
    `context=${candidate.build.context}`,
    `platform=${candidate.build.platform}`,
    `matrixFingerprint=${inputMatrix.fingerprint}`,
    `matrixSchemaVersion=${inputMatrix.schemaVersion}`,
    `physicalImageCount=${inputMatrix.contract.physicalImageCount}`,
    `logicalTargetCount=${inputMatrix.contract.logicalTargetCount}`,
    `logicalTargets=${
      candidate.logicalTargets.map((target) => target.recipeId).join(",")
    }`,
    `qualificationTarget.imageReference=${candidate.qualificationTarget.imageReference}`,
    `qualificationTarget.manifestDigest=${candidate.qualificationTarget.manifestDigest}`,
    `licence=${artifactCompliance.licence}`,
    `anonymousPull=${artifactCompliance.anonymousPull}`,
    `runtimeQualification=${artifactCompliance.runtimeQualification}`,
    `eligibleForPromotion=${artifactCompliance.eligibleForPromotion}`,
    `sbom=${artifactCompliance.sbom}`,
    `provenance=${artifactCompliance.provenance}`,
    "",
  ].join("\n");
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
      `Candidate receipt requires exactly one matrix image for ${physicalImageId}.`,
    );
  }
  return matches[0]!;
}

function receiptInputMatrix(
  receipt: FirstPartyMicrosandboxImageCandidateReceipt,
): FirstPartyMicrosandboxImageDistributionMatrix {
  return Object.freeze({
    schemaVersion: receipt.inputMatrix.schemaVersion,
    contract: receipt.inputMatrix.contract,
    platform: receipt.inputMatrix.platform,
    images: receipt.inputMatrix.images,
  });
}

function assertSha256(value: string, label: string): void {
  if (!SHA256.test(value)) {
    throw new TypeError(`${label} must be an exact lowercase sha256 digest.`);
  }
}

function assertGitSha(value: string): void {
  if (!GIT_SHA.test(value)) {
    throw new TypeError(
      "Candidate receipt git SHA must be a full lowercase commit SHA.",
    );
  }
}

function assertGitTag(value: string): void {
  if (value.length === 0 || /[\r\n\0]/u.test(value)) {
    throw new TypeError("Candidate receipt git tag must be a non-empty single line.");
  }
}

function assertLocatorTag(value: string, gitSha: string): void {
  if (!LOCATOR_TAG.test(value) || !value.startsWith(`git-${gitSha}-`)) {
    throw new TypeError(
      "Candidate receipt locator tag must bind the full git SHA and workflow run.",
    );
  }
}

function assertBuildMetadataIndexDigest(
  metadata: FirstPartyMicrosandboxCandidateBuildMetadata,
  ociIndexDigest: string,
): void {
  if (metadata["containerimage.digest"] !== ociIndexDigest) {
    throw new TypeError(
      "Buildx metadata containerimage.digest must exactly match the candidate OCI index digest.",
    );
  }
}

function copyLogicalTargets(
  targets: FirstPartyMicrosandboxImageDistributionEntry["logicalTargets"],
): FirstPartyMicrosandboxImageDistributionEntry["logicalTargets"] {
  return Object.freeze(targets.map((target) => Object.freeze({ ...target })));
}

function copyDistributionEntry(
  entry: FirstPartyMicrosandboxImageDistributionEntry,
): FirstPartyMicrosandboxImageDistributionEntry {
  return Object.freeze({
    physicalImageId: entry.physicalImageId,
    packageName: entry.packageName,
    imageName: entry.imageName,
    dockerfile: entry.dockerfile,
    context: entry.context,
    platform: entry.platform,
    expectedUser: entry.expectedUser,
    expectedEntrypoint: Object.freeze([...entry.expectedEntrypoint]),
    ...(entry.expectedLabels === undefined
      ? {}
      : { expectedLabels: Object.freeze({ ...entry.expectedLabels }) }),
    logicalTargets: copyLogicalTargets(entry.logicalTargets),
    qualificationTarget: Object.freeze({ ...entry.qualificationTarget }),
  });
}

function copyJsonObject(
  value: unknown,
  path: string,
): FirstPartyMicrosandboxCandidateBuildMetadata {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be a JSON object.`);
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map((
        [key, item],
      ) => [key, copyJsonValue(item, `${path}.${key}`)]),
    ),
  );
}

function copyJsonValue(
  value: unknown,
  path: string,
): FirstPartyMicrosandboxCandidateJsonValue {
  if (
    value === null || typeof value === "boolean" || typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} must be finite JSON data.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((item, index) => copyJsonValue(item, `${path}[${index}]`)),
    );
  }
  if (typeof value === "object") {
    return copyJsonObject(value as FirstPartyMicrosandboxCandidateJsonObject, path);
  }
  throw new TypeError(`${path} must be JSON data.`);
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
