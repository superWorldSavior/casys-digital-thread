/**
 * Closed server-owned profile for the named assembly-integrity adapter.
 *
 * Concrete provider/native producer identities live here rather than in the
 * domain or application ports. The configured image digest is deployment
 * configuration only; it does not assert that an MCP call reached that runtime.
 */

import type {
  AssemblyIntegrityObserverProfileCatalog,
} from "../../../application/ports/out/cad/assembly-integrity/assembly-integrity-observer.ts";
import {
  type AssemblyIntegrityObserverProfile,
  type AssemblyIntegrityObserverProfileRef,
  createAssemblyIntegrityObserverProfile,
  sameAssemblyIntegrityObserverProfileRef,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-observer-profile.ts";
import { validateContentFingerprint } from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { exactRecord } from "../../../domain/kernel/case-validation.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  ASSEMBLY_INTEGRITY_MAXIMUM_OCCURRENCES,
  ASSEMBLY_INTEGRITY_MAXIMUM_PAIRS,
  ASSEMBLY_INTEGRITY_MAXIMUM_STEP_BYTES,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-input-bundle.ts";

export const ASSEMBLY_INTEGRITY_OBSERVER_PROFILE = Object.freeze(
  {
    id: "assembly-integrity-observer",
    version: "1.0.0",
  } as const,
);

export const ASSEMBLY_INTEGRITY_OBSERVER_CAPABILITY = Object.freeze(
  {
    id: "assembly-integrity-observer",
    version: "1.0.0",
  } as const,
);

export class AssemblyIntegrityObserverProfileNotRegisteredError extends Error {
  constructor(readonly profile: AssemblyIntegrityObserverProfileRef) {
    super(
      `No assembly-integrity observer profile is registered for ${profile.id}@${profile.version}.`,
    );
    this.name = "AssemblyIntegrityObserverProfileNotRegisteredError";
  }
}

/**
 * Server-composition input only. It is an exact published image identity, not
 * a project field, public-tool argument, or fallback runtime selector.
 */
export interface FixedAssemblyIntegrityObserverProfileCatalogOptions {
  readonly imageDigest: ContentFingerprint;
}

/**
 * One exact registration and no mutation/listing surface. Future composition
 * may replace this fixed catalogue with a persisted reviewed profile reader
 * without changing the provider-neutral port.
 */
export class FixedAssemblyIntegrityObserverProfileCatalog
  implements AssemblyIntegrityObserverProfileCatalog {
  readonly #profile: Promise<AssemblyIntegrityObserverProfile>;

  constructor(value: FixedAssemblyIntegrityObserverProfileCatalogOptions) {
    const root = exactRecord(
      value,
      ["imageDigest"],
      "$fixedAssemblyIntegrityObserverProfileCatalog",
    );
    const imageDigest = validateContentFingerprint(
      root.imageDigest,
      "$fixedAssemblyIntegrityObserverProfileCatalog.imageDigest",
    );
    this.#profile = createAssemblyIntegrityObserverProfile({
      schemaVersion: "assembly-integrity-observer-profile/1.0",
      profile: ASSEMBLY_INTEGRITY_OBSERVER_PROFILE,
      capability: ASSEMBLY_INTEGRITY_OBSERVER_CAPABILITY,
      method: {
        id: "assembly-integrity-factual-v1",
        version: "1.0.0",
        linearToleranceMm: 0.000001,
      },
      producer: {
        rawSchemaVersion: "build123d-assembly-integrity-observation/1.0",
        engine: { id: "cadquery-ocp", version: "7.9.3.1" },
        package: { id: "mcp-build123d", version: "0.7.1" },
      },
      configuredRuntime: { kind: "image-digest", imageDigest },
      maximumStepBytes: ASSEMBLY_INTEGRITY_MAXIMUM_STEP_BYTES,
      maximumOccurrences: ASSEMBLY_INTEGRITY_MAXIMUM_OCCURRENCES,
      maximumPairs: ASSEMBLY_INTEGRITY_MAXIMUM_PAIRS,
    });
  }

  initial(): Promise<AssemblyIntegrityObserverProfile> {
    if (arguments.length !== 0) {
      throw new TypeError("initial does not accept caller input.");
    }
    return this.#profile;
  }

  async resolve(
    profile: AssemblyIntegrityObserverProfileRef,
  ): Promise<AssemblyIntegrityObserverProfile> {
    if (
      !sameAssemblyIntegrityObserverProfileRef(
        profile,
        ASSEMBLY_INTEGRITY_OBSERVER_PROFILE,
      )
    ) {
      throw new AssemblyIntegrityObserverProfileNotRegisteredError(profile);
    }
    return await this.#profile;
  }
}
