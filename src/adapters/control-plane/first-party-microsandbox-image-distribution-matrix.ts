/**
 * Server-owned candidate OCI distribution plan for first-party Microsandbox
 * worker images.
 *
 * The matrix is derived from bootstrap descriptors. It groups logical
 * catalogued microvm-images by physicalImageId and emits one build entry per
 * physical image. It never chooses a provider, tool, endpoint, or argument,
 * and it never claims or rewrites the catalogued Microsandbox runtime digest.
 *
 * New publication names are lowercase repositories under ghcr.io/superworldsavior/.
 * Historical Casys receipts retain their exact namespace and digest references.
 * Commit tags are applied by the release workflow; this module never emits
 * `latest`, a digest pin, or a mutable alias as the candidate identity.
 */

import type { CapabilityRuntimeCatalog } from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import {
  deterministicJson,
  sha256Hex,
} from "../../domain/kernel/deterministic-json.ts";
import {
  createFirstPartyMicrosandboxImageBootstrapDescriptors,
  type FirstPartyMicrosandboxImageBootstrapDescriptor,
  type FirstPartyMicrosandboxImageBuildRecipe,
} from "./first-party-microsandbox-image-bootstrap.ts";

export const FIRST_PARTY_MICROSANDBOX_IMAGE_DISTRIBUTION_MATRIX_SCHEMA =
  "first-party-microsandbox-image-distribution-matrix/3.0" as const;

/**
 * This release surface is intentionally closed. The catalogue currently has
 * five logical microVM workers and five physical OCI images. Modelica
 * qualified-kit and admitted-source bindings share one installable atom and
 * therefore one logical target. Keeping the cardinalities here makes a
 * missing descriptor fail before a workflow can publish a partial candidate
 * set, without duplicating a worker list in CI configuration.
 */
export const FIRST_PARTY_MICROSANDBOX_IMAGE_DISTRIBUTION_CONTRACT = Object.freeze({
  physicalImageCount: 5,
  logicalTargetCount: 5,
});

const GHCR_REGISTRY = "ghcr.io/superworldsavior" as const;
const HISTORICAL_GHCR_REGISTRY = "ghcr.io/casys-ai" as const;
const PACKAGE_PREFIX = "casys-digital-thread-" as const;
const OCI_REPOSITORY_SEGMENT = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export interface FirstPartyMicrosandboxImageLogicalTarget {
  readonly unitId: string;
  readonly materialId: string;
  readonly recipeId: string;
}

/**
 * Catalogued Microsandbox runtime pin this candidate is later qualified
 * against. Distinct from the GHCR candidate image name.
 */
export interface FirstPartyMicrosandboxImageQualificationTarget {
  readonly imageReference: string;
  readonly manifestDigest: string;
}

export interface FirstPartyMicrosandboxImageDistributionEntry {
  readonly physicalImageId: string;
  readonly packageName: string;
  readonly imageName: string;
  readonly dockerfile: string;
  readonly context: string;
  readonly platform: "linux/arm64";
  readonly expectedUser: string;
  readonly expectedEntrypoint: readonly string[];
  readonly expectedLabels?: Readonly<Record<string, string>>;
  readonly logicalTargets: readonly FirstPartyMicrosandboxImageLogicalTarget[];
  readonly qualificationTarget: FirstPartyMicrosandboxImageQualificationTarget;
}

export interface FirstPartyMicrosandboxImageDistributionMatrix {
  readonly schemaVersion:
    typeof FIRST_PARTY_MICROSANDBOX_IMAGE_DISTRIBUTION_MATRIX_SCHEMA;
  readonly contract: typeof FIRST_PARTY_MICROSANDBOX_IMAGE_DISTRIBUTION_CONTRACT;
  readonly platform: "linux/arm64";
  readonly images: readonly FirstPartyMicrosandboxImageDistributionEntry[];
}

export function createFirstPartyMicrosandboxImageDistributionMatrix(
  catalog: CapabilityRuntimeCatalog,
): FirstPartyMicrosandboxImageDistributionMatrix {
  return planFirstPartyMicrosandboxImageDistribution(
    createFirstPartyMicrosandboxImageBootstrapDescriptors(catalog),
  );
}

export function planFirstPartyMicrosandboxImageDistribution(
  descriptors: readonly FirstPartyMicrosandboxImageBootstrapDescriptor[],
): FirstPartyMicrosandboxImageDistributionMatrix {
  if (descriptors.length === 0) {
    throw new TypeError(
      "First-party Microsandbox image distribution requires bootstrap descriptors.",
    );
  }
  const groups = new Map<string, FirstPartyMicrosandboxImageBootstrapDescriptor[]>();
  const order: string[] = [];
  for (const descriptor of descriptors) {
    const physicalImageId = descriptor.physicalImageId;
    const existing = groups.get(physicalImageId);
    if (existing === undefined) {
      groups.set(physicalImageId, [descriptor]);
      order.push(physicalImageId);
      continue;
    }
    assertSamePhysicalBuildRecipe(
      physicalImageId,
      existing[0]!.buildRecipe,
      descriptor.buildRecipe,
    );
    assertSameQualificationTarget(existing[0]!, descriptor);
    existing.push(descriptor);
  }
  const images = Object.freeze(
    order.map((physicalImageId) =>
      distributionEntry(physicalImageId, groups.get(physicalImageId)!)
    ),
  );
  const matrix = Object.freeze({
    schemaVersion: FIRST_PARTY_MICROSANDBOX_IMAGE_DISTRIBUTION_MATRIX_SCHEMA,
    contract: FIRST_PARTY_MICROSANDBOX_IMAGE_DISTRIBUTION_CONTRACT,
    platform: "linux/arm64",
    images,
  });
  assertFirstPartyMicrosandboxImageDistributionContract(matrix);
  return matrix;
}

/** SHA-256 of the exact current distribution-matrix document. */
export async function fingerprintFirstPartyMicrosandboxImageDistributionMatrix(
  matrix: FirstPartyMicrosandboxImageDistributionMatrix,
): Promise<string> {
  assertFirstPartyMicrosandboxImageDistributionContract(matrix);
  return `sha256:${await sha256Hex(
    new TextEncoder().encode(deterministicJson(matrix)),
  )}`;
}

/**
 * Runtime guard shared by release adapters. It is deliberately cardinality
 * and identity based: physical image IDs stay unique, and each logical
 * target is unique. Grouping still allows distinct descriptors to share one
 * physical publication only when they already pin the same image.
 */
export function assertFirstPartyMicrosandboxImageDistributionContract(
  matrix: FirstPartyMicrosandboxImageDistributionMatrix,
): void {
  const { contract, images } = matrix;
  if (
    matrix.schemaVersion !==
      FIRST_PARTY_MICROSANDBOX_IMAGE_DISTRIBUTION_MATRIX_SCHEMA ||
    matrix.platform !== "linux/arm64"
  ) {
    throw new TypeError(
      "First-party Microsandbox image distribution declares an unsupported schema or platform.",
    );
  }
  if (
    contract.physicalImageCount !==
      FIRST_PARTY_MICROSANDBOX_IMAGE_DISTRIBUTION_CONTRACT.physicalImageCount ||
    contract.logicalTargetCount !==
      FIRST_PARTY_MICROSANDBOX_IMAGE_DISTRIBUTION_CONTRACT.logicalTargetCount
  ) {
    throw new TypeError(
      "First-party Microsandbox image distribution declares an unsupported contract.",
    );
  }
  if (images.length !== contract.physicalImageCount) {
    throw new TypeError(
      `First-party Microsandbox image distribution requires exactly ${contract.physicalImageCount} physical images, received ${images.length}.`,
    );
  }
  const physicalImageIds = new Set(images.map((image) => image.physicalImageId));
  if (physicalImageIds.size !== images.length) {
    throw new TypeError(
      "First-party Microsandbox image distribution contains duplicate physical image ids.",
    );
  }
  const logicalTargets = images.flatMap((image) => image.logicalTargets);
  if (logicalTargets.length !== contract.logicalTargetCount) {
    throw new TypeError(
      `First-party Microsandbox image distribution requires exactly ${contract.logicalTargetCount} logical targets, received ${logicalTargets.length}.`,
    );
  }
  const logicalTargetIds = new Set(
    logicalTargets.map((target) =>
      `${target.unitId}\u0000${target.materialId}\u0000${target.recipeId}`
    ),
  );
  if (logicalTargetIds.size !== logicalTargets.length) {
    throw new TypeError(
      "First-party Microsandbox image distribution contains duplicate logical targets.",
    );
  }
  if (images.some((image) => image.logicalTargets.length === 0)) {
    throw new TypeError(
      "Every first-party Microsandbox physical image must cover a logical target.",
    );
  }
  for (const image of images) {
    if (
      image.packageName !== firstPartyMicrosandboxGhcrPackageName(image.physicalImageId)
    ) {
      throw new TypeError(
        "First-party Microsandbox package name must match its physical image id.",
      );
    }
    assertFirstPartyMicrosandboxCandidateImageName(
      image.imageName,
      image.physicalImageId,
    );
  }
}

/** The two exact publication identities; not a caller-selected registry. */
export function assertFirstPartyMicrosandboxCandidateImageName(
  imageName: string,
  physicalImageId: string,
): void {
  const packageName = firstPartyMicrosandboxGhcrPackageName(physicalImageId);
  if (
    imageName !== `${GHCR_REGISTRY}/${packageName}` &&
    imageName !== `${HISTORICAL_GHCR_REGISTRY}/${packageName}`
  ) {
    throw new TypeError(
      "Candidate imageName must be the exact current or historical first-party GHCR repository for its physical image id.",
    );
  }
}

/**
 * Preserve a historical entry without rewriting its receipt. Only the exact
 * Casys-to-personal publication-name relocation may differ; every build,
 * logical target, expected runtime label and qualification pin stays exact.
 */
export function firstPartyMicrosandboxDistributionEntriesAreCompatible(
  historical: FirstPartyMicrosandboxImageDistributionEntry,
  current: FirstPartyMicrosandboxImageDistributionEntry,
): boolean {
  const currentName = firstPartyMicrosandboxGhcrImageName(current.packageName);
  if (current.imageName !== currentName) {
    throw new TypeError(
      "The current publication matrix must use the personal GHCR namespace.",
    );
  }
  assertFirstPartyMicrosandboxCandidateImageName(
    historical.imageName,
    historical.physicalImageId,
  );
  return deterministicJson({ ...historical, imageName: currentName }) ===
    deterministicJson(current);
}

function distributionEntry(
  physicalImageId: string,
  descriptors: readonly FirstPartyMicrosandboxImageBootstrapDescriptor[],
): FirstPartyMicrosandboxImageDistributionEntry {
  const recipe = descriptors[0]!.buildRecipe;
  const packageName = firstPartyMicrosandboxGhcrPackageName(physicalImageId);
  const imageName = firstPartyMicrosandboxGhcrImageName(packageName);
  const qualification = descriptors[0]!;
  return Object.freeze({
    physicalImageId,
    packageName,
    imageName,
    dockerfile: recipe.dockerfile,
    context: recipe.context,
    platform: recipe.platform,
    expectedUser: recipe.user,
    expectedEntrypoint: Object.freeze([...recipe.entrypoint]),
    ...(recipe.labels === undefined
      ? {}
      : { expectedLabels: Object.freeze({ ...recipe.labels }) }),
    logicalTargets: Object.freeze(descriptors.map((descriptor) =>
      Object.freeze({
        unitId: descriptor.unitId,
        materialId: descriptor.materialId,
        recipeId: descriptor.recipeId,
      })
    )),
    qualificationTarget: Object.freeze({
      imageReference: qualification.targetImageReference,
      manifestDigest: qualification.target.manifestDigest,
    }),
  });
}

export function firstPartyMicrosandboxGhcrPackageName(
  physicalImageId: string,
): string {
  if (!OCI_REPOSITORY_SEGMENT.test(physicalImageId)) {
    throw new TypeError(
      "First-party Microsandbox physical image id must be a lowercase OCI repository segment.",
    );
  }
  const packageName = `${PACKAGE_PREFIX}${physicalImageId}`;
  assertCandidateGhcrRepositoryName(packageName);
  return packageName;
}

export function firstPartyMicrosandboxGhcrImageName(packageName: string): string {
  const imageName = `${GHCR_REGISTRY}/${packageName}`;
  assertCandidateGhcrRepositoryName(packageName);
  assertCandidateGhcrImageName(imageName);
  return imageName;
}

function assertCandidateGhcrRepositoryName(packageName: string): void {
  if (packageName !== packageName.toLowerCase()) {
    throw new TypeError(
      "First-party Microsandbox GHCR package names must be lowercase.",
    );
  }
  if (
    packageName.includes("@") || packageName.includes(":") ||
    packageName.endsWith("latest") || packageName.includes("/")
  ) {
    throw new TypeError(
      "First-party Microsandbox GHCR package names cannot be digest pins, tags, or latest aliases.",
    );
  }
  if (!OCI_REPOSITORY_SEGMENT.test(packageName)) {
    throw new TypeError(
      "First-party Microsandbox GHCR package names must be lowercase OCI repository segments.",
    );
  }
}

function assertCandidateGhcrImageName(imageName: string): void {
  if (imageName !== imageName.toLowerCase()) {
    throw new TypeError(
      "First-party Microsandbox publication references must be lowercase.",
    );
  }
  if (
    imageName.includes("@") || imageName.includes(":") ||
    imageName.endsWith("/latest") || imageName.endsWith("latest")
  ) {
    throw new TypeError(
      "First-party Microsandbox publication references cannot be digest pins, tags, or latest aliases.",
    );
  }
  const prefix = `${GHCR_REGISTRY}/`;
  if (!imageName.startsWith(prefix)) {
    throw new TypeError(
      "First-party Microsandbox publication references must use ghcr.io/superworldsavior/.",
    );
  }
  const packageName = imageName.slice(prefix.length);
  assertCandidateGhcrRepositoryName(packageName);
}

function assertSamePhysicalBuildRecipe(
  physicalImageId: string,
  left: FirstPartyMicrosandboxImageBuildRecipe,
  right: FirstPartyMicrosandboxImageBuildRecipe,
): void {
  if (deterministicJson(left) !== deterministicJson(right)) {
    throw new TypeError(
      `First-party Microsandbox physical image ${physicalImageId} has divergent build recipes.`,
    );
  }
}

function assertSameQualificationTarget(
  left: FirstPartyMicrosandboxImageBootstrapDescriptor,
  right: FirstPartyMicrosandboxImageBootstrapDescriptor,
): void {
  if (
    left.targetImageReference !== right.targetImageReference ||
    left.target.manifestDigest !== right.target.manifestDigest
  ) {
    throw new TypeError(
      `First-party Microsandbox physical image ${left.physicalImageId} has divergent qualification targets.`,
    );
  }
}
