# How-to: import a first-party microVM image candidate

Audience: maintainer · Diátaxis: how-to · Kind: release procedure

Import and inspect one first-party Microsandbox image candidate from an exact repository
receipt. This is maintainer-only local cache work. It does not qualify a worker, promote
a pin, or rewrite the catalogue. Contract:
[first-party microVM distribution](../../reference/runtime/capability-packs/first-party-microvm-distribution.md).
Publication remains
[Publish first-party microVM images](publish-first-party-microvm-images.md).

Do not use `prepare:*:microsandbox` or `acquireFirstPartyMicrosandboxImage` for this
candidate. Those paths import under the active catalogue pin.

## 1. Start from an exact receipt

On the reviewed ARM Mac, take an exact `receipt.json` produced by this repository. The
receipt already names the OCI index digest, the `linux/arm64` platform-manifest digest,
the existing qualification target, and the complete historical distribution matrix. OCI
index, OCI platform-manifest, and later Microsandbox identities are separately typed and
recorded. Their digest text may happen to be equal; that coincidence never merges their
provenance.

Binding uses `first-party-microsandbox-image-candidate-entry-compatibility/2.0`. It
recalculates the fingerprint of the complete historical matrix preserved in the receipt,
then compares the selected physical-image entry with its unique current entry. The only
permitted difference is its exact publication name moving from
`ghcr.io/casys-ai/casys-digital-thread-<physicalImageId>` to
`ghcr.io/superworldsavior/casys-digital-thread-<physicalImageId>`. The receipt and
import record retain the historical name, source fingerprint, SHA and OCI digest
references; import pulls those original bytes. All other selected-entry fields must
remain byte-for-byte identical, including the recipe, runtime contract, logical targets
and qualification target. A change to another physical image does not invalidate this
candidate. An arbitrary owner, package, alias or selected-entry change fails closed
before Docker or Microsandbox.

## 2. Plan first

```bash
deno task release:first-party-microvm-images:import-candidate --receipt=<path>
```

Default mode is planning/read. It validates the receipt's historical matrix fingerprint
and binds its exact selected entry to the current server-owned matrix, then prints the
planned pull plus the generated-at-run staging namespace and tag prefix. It does not
call Docker or Microsandbox, and does not pretend to know the per-invocation staging
reference. Output keeps `runtimeQualification=not-run` and `eligibleForPromotion=false`.
Domain qualification is not run. Promotion is false.

The CLI accepts only `--receipt=<path>` and optional `--run`. It refuses provider,
image, digest, platform, command, endpoint, tool, or worker inputs.

## 3. Import only with `--run`

```bash
deno task release:first-party-microvm-images:import-candidate --receipt=<path> --run
```

`--run` is the explicit mutation acknowledgement. The import orchestration re-parses the
receipt, verifies its complete historical matrix fingerprint, and re-binds its selected
entry to the current server-owned matrix before any Docker or Microsandbox effect.
Callers cannot select a provider, image, digest, platform, tool, or argument. The flow
then re-reads the exact OCI index, pulls the receipt's platform-manifest reference,
inspects OS/arch/user/entrypoint/labels, saves, generates an invocation-owned nonce,
preflights that exact non-catalog staging tag is absent, then loads Microsandbox under
it. The returned `Image.load` handles must include that requested staging tag and must
not include the active catalogue pin. The flow records the observed Microsandbox digest,
removes only its proven-owned staging reference, and re-imports the same archive under
the canonical Microsandbox cache reference
`docker.io/casys/first-party-candidate-<physicalImageId>@sha256:<observed-msb-digest>`
derived by `pinnedOciImageReference`. The factual import record still stores the short
`casys/first-party-candidate-<physicalImageId>@sha256:<observed-msb-digest>` identity.
Microsandbox 0.6.8 has no relabel API; the second load is a re-import, not an in-place
retag.

Temporary archive and owned staging are removed on success and failure. The final
candidate cache and the local import record are retained on success; the random staging
reference is not persisted. If writing that factual record fails, the flow quarantines
only the exact final candidate it just imported. An incoherent or coherent pre-existing
final candidate is never deleted. The active catalogue pin is never loaded, rewritten,
or deleted.

## 4. Hand the bound record to a per-domain qualification gate

The import record is the later-gate input: a later per-domain qualification reads only
`readBoundFirstPartyMicrosandboxImageCandidateImportRecord` against the current
server-owned matrix. Callers do not select a provider, image, digest, platform, tool, or
argument. The record preserves the exact source candidate receipt, recalculates and
verifies its fingerprint on parse/bind, keeps OCI index, platform-manifest, and
Microsandbox digest as separate identities, and leaves `runtimeQualification=not-run`
and `eligibleForPromotion=false`.

Per-domain candidate qualification is a separate maintainer path:
[Qualify a first-party microVM image candidate](qualify-a-first-party-microvm-image-candidate.md).
Do not run those gates from this import command, and do not edit catalogue pins.
