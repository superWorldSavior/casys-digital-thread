# How-to: publish first-party microVM images

Audience: maintainer · Diátaxis: how-to · Kind: release procedure

Publish candidate `linux/arm64` OCI images for the five physical first-party
Microsandbox workers. This is opt-in infrastructure release. It does not update the
catalogue pin, qualify a worker, or make a GHCR package public. Contract:
[first-party microVM distribution](../../reference/runtime/capability-packs/first-party-microvm-distribution.md).

Do not run this path to repair a local cache miss. Local acquisition still observes the
exact Microsandbox target and, on miss, reconstructs the in-repo Dockerfile as a
candidate recipe.

The workflow requires `superWorldSavior/casys-digital-thread` with repository ID
`1316957248`. Before creating or pushing a release tag, complete the public repository
preflight. A candidate pushed to a private GHCR package remains private; do not use this
procedure as a shortcut around the separate visibility and anonymous-pull review.

## 1. Review the planning matrix

From a clean checkout of the exact commit you intend to publish:

```bash
deno task release:first-party-microvm-images:matrix
```

The command prints compact JSON on stdout. It performs no network, Docker, or file
writes. Its versioned contract requires exactly five unique physical images and five
logical targets; Modelica qualified-kit and admitted-source bindings share one
installable atom and therefore one entry. Confirm lowercase
`ghcr.io/superworldsavior/casys-digital-thread-<physicalImageId>` names and no `latest`
or digest publication identity.

The personal namespace is for future candidates. Existing Casys digest-pinned
acquisition sources, Microsandbox runtime pins and historical receipts stay unchanged.
Moving the publication name does not qualify an equivalent image or establish an
anonymous pull from a new package.

## 2. Invoke the workflow on an exact git tag

Create and push a git tag for that commit, then dispatch
`.github/workflows/publish-first-party-microvm-images.yml` on that tag. The workflow
refuses a branch ref. It checks out the tagged commit, rebuilds the matrix, and builds
each image on `ubuntu-24.04-arm` with Docker Buildx. It logs in with `GITHUB_TOKEN`. The
`prepare` job has `contents: read`; the `build` job has `contents: read` and
`packages: write`. It does not use QEMU, a PAT, or `latest`.

Each candidate receives the unique locator tag
`git-<full commit SHA>-run-<workflow run id>-<run attempt>`. This prevents a normal
dispatch or rerun from replacing a previous candidate built from moving APT inputs. The
receipt records three separate identities: the Buildx OCI index digest, the exact
`linux/arm64` manifest selected from that raw index, and the existing Microsandbox
qualification target. Neither candidate identity is an automatic runtime pin. Buildx
provenance and SBOM are only marked `requested`; a receipt does not claim that either
attestation was attached or reviewed. Per-image JSON/text receipts, Buildx metadata, and
the raw OCI index are uploaded as artifacts and summarized by the job.

If the ARM runner is unavailable, stop. Do not switch the job to `ubuntu-latest` or add
QEMU.

## 3. Treat GHCR output as a candidate

New packages are not assumed public. A private package is not anonymous runtime
availability. Visibility, org policy, and aggregate-image licence/SBOM review are
separate maintainer decisions. The candidate receipt keeps `licence: unresolved`,
`anonymousPull: not-run`, `runtimeQualification: not-run`, and
`eligibleForPromotion: false` until those later checks are actually recorded. APT-based
rebuilds are not bit-reproducible.

The published digest is not the catalogued Microsandbox runtime digest.

## 4. Import on the target ARM Mac before any pin change

On the reviewed ARM Mac, import from the exact receipt with
[Import a first-party microVM image candidate](import-a-first-party-microvm-image-candidate.md).
That path pulls the receipt's `linux/arm64` platform manifest, observes a distinct
Microsandbox digest, and stores a non-catalog candidate. It does not replace the active
catalogue pin or load under that active identity.

Domain qualification remains a later, separate review. Promotion is a later, reviewed
catalogue change. Review the full matrix, the raw OCI index, the selected arm64
manifest, Buildx metadata, package visibility, and artefact licences before any
anonymous pull or target-Mac qualification. This workflow must not edit
`src/adapters/control-plane/` pins, worker contracts, or the capability-runtime
catalogue.
