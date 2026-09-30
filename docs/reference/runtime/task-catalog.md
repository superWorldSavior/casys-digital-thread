# Task catalog
> Verified-Against: c12eca2a (2026-09-13).

Audience: contributor · Diátaxis: reference · Kind: inventory

Registered `deno.json` tasks, grouped by intent. Each row names one task and one role.
This page is the contributor inventory, not a how-to and not a second authority model.
Script entry points that have no task stay in
[scripts/README.md](../../../scripts/README.md).

`verify:task-catalog` fails when a registered task has no first-column table row
here, or when a row names a task missing from `deno.json`. A name mentioned only
in prose or in another row's role cell is not cataloged. Adding a task means
adding a row in the matching group. The contributor entry
command is `deno task verify`; see [CONTRIBUTING.md](../../../CONTRIBUTING.md) and the
[documentation index](../../README.md).

The separate `desktop/deno.json` `test` task runs Desktop component tests with
loopback network access, then sidecar and Workbench tests under the repository
import map. Packaged helper integration tests remain dedicated tasks with their
own runtime permissions; the default Desktop test task does not start helpers.

## Contribute

| Task                                            | Role                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| `verify`                                        | Contributor meta-gate: `fmt`, `lint`, `check`, `check:ui`, `test`, then `verify:docs`. |
| `fmt`                                           | Check-only formatting for Deno sources and the Vite UI tree.                           |
| `lint`                                          | Deno lint for `server.ts`, `scripts/`, `src/`, and the admission-compiler experiment.  |
| `check`                                         | Type-check Deno sources by glob; Vite UI stays on `check:ui`.                          |
| `check:ui`                                      | Type-check the Vite Workbench with `tsc --noEmit`.                                     |
| `test`                                          | Full Deno test suite, including source-alpha inventory and OS-lock tests.              |
| `verify:docs`                                   | Local Markdown links and anchors against the repository candidate.                     |
| `verify:task-catalog`                           | Fail if any `deno.json` task is missing from this catalog.                             |
| `verify:doc-code-refs` | Resolve Markdown code locators and line bounds; CI reports historical unresolved references in warn mode. |
| `report:doc-freshness` | Report missing or unknown page-baseline headers and commit age over eight weeks; always exits 0. |
| `verify:evidence`                               | Check committed console evidence fixtures.                                             |
| `verify:thread:presentation`                    | Build and verify the native Workbench presentation bundle.                             |
| `test:capability-runtime-qualification-os-lock` | OS-process lock tests for capability-runtime qualification.                            |

## Diagnose

| Task                                           | Role                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| `verify:generic:core`                          | Focused tests for admission, isolation, CAS, and architecture boundaries. |
| `check:geometry-bundle-v2`                     | Type-check geometry-bundle v2 and related CAD product-structure modules.  |
| `check:technical-compilation-admission-reader` | Type-check the technical-compilation admission reader port and adapter.   |
| `check:build123d-execution-profile`            | Type-check the Build123d isolated execution profile catalog.              |
| `check:build123d-execution`                    | Type-check Build123d isolated execution evidence and composition.         |
| `check:modelica-isolated-execution`            | Type-check admitted and qualified Modelica isolated execution.            |
| `check:calculix-isolated-execution`            | Type-check isolated CalculiX FEA execution and its candidate gates.       |
| `check:resolved-operation-plan`                | Type-check resolved operation plan sealing and the FEA proof executor.    |
| `recover:work-item-successor`                  | Inspect or apply leftover ready work-item successor reconciliation.       |

## Local runtime

| Task                                                              | Role                                                                      |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `start`                                                           | Cold Digital Thread MCP server and project control.                       |
| `start:yolo`                                                      | Start with loopback auto-confirm of positive MRTR decisions.              |
| `start:agent`                                                     | Build the Thread UI, then supervise the local agent stack.                |
| `dev`                                                             | Start the Digital Thread server with `--watch`.                           |
| `preview:thread`                                                  | Vite HMR Workbench on :5173 with the read-only BFF on :5175.              |
| `preview:cockpit`                                                 | Frozen native Workbench bundle served by the BFF on :5175.                |
| `preview:browser`                                                 | Retired Console MCP App harness; the task refuses to start it.            |
| `capability:admin`                                                | Private local capability lock, revoke, and remove.                        |
| `capability:qualify`                                              | Private Chrono and CalculiX qualification review, apply, and recover.     |
| `thread:viewer-apps:materialize`                                  | Materialize the local catalog of registered Thread viewer Apps.           |
| `thread:capture-syson-inventory`                                  | Capture SysON and Build123d inventories into local state.                 |
| `verify:yolo:local`                                               | Tests for the local YOLO approval flow.                                   |
| `prepare:build123d:microsandbox`                                  | Observe or import the exact qualified Build123d microVM pin.              |
| `prepare:ngspice:microsandbox`                                    | Observe, reconstruct, or import the ngspice worker pin.                   |
| `prepare:geometry-module:microsandbox`                            | Observe, reconstruct, or import the geometry-module assembler pin.        |
| `verify:build123d:microsandbox:vertical`                          | Digest-pinned active Build123d microVM vertical.                          |
| `verify:modelica:microsandbox:vertical`                           | Digest-pinned Modelica microVM vertical with qualification capture.       |
| `verify:calculix:microsandbox:vertical`                           | Digest-pinned CalculiX microVM vertical.                                  |
| `verify:geometry-module:microsandbox:qualification`               | Active-pin geometry-module assembler qualification.                       |
| `verify:build123d-isolated-worker:candidate-qualification`        | Maintainer qualification of a cached Build123d worker candidate.          |
| `verify:geometry-module-assembler-worker:candidate-qualification` | Maintainer qualification of a cached geometry-module assembler candidate. |
| `verify:calculix-worker:candidate-qualification`                  | Maintainer qualification of a cached CalculiX worker candidate.           |
| `verify:modelica-worker:candidate-qualification`                  | Maintainer qualification of a cached Modelica worker candidate.           |
| `verify:ngspice-worker:candidate-qualification`                   | Maintainer qualification of a cached ngspice worker candidate.            |

## Release

| Task                                                  | Role                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| `release:source-alpha:build`                          | Build the source-alpha archive, SBOM, notices, and checksums.        |
| `release:source-alpha:render`                         | Re-render third-party notices from the generated CycloneDX document. |
| `release:source-alpha:verify`                         | Rebuild and compare the source-alpha inventory without publishing.   |
| `test:source-alpha-inventory`                         | Tests for the source-alpha inventory and archive scripts.            |
| `release:first-party-microvm-images:matrix`           | Print the first-party microVM candidate-image matrix.                |
| `release:first-party-microvm-images:import-candidate` | Import a first-party microVM candidate from a receipt.               |

## Probes

| Task                                 | Role                                                             |
| ------------------------------------ | ---------------------------------------------------------------- |
| `mcp:call`                           | Loopback `tools/call` against the local MCP server.              |
| `probe:constraint-solver`            | Read-only probe of a SysON constraint-solver element.            |
| `probe:build123d-contract`           | Read-only probe of the local Build123d MCP contract.             |
| `probe:spice-contract`               | Read-only probe of the local SPICE MCP contract.                 |
| `probe:calculix-contract`            | Read-only probe of the local CalculiX MCP contract.              |
| `probe:archive-cascade`              | Read-only probe of the local archive cascade.                    |
| `probe:wall-hook-wh01-source`        | Load the wall-hook WH01 example source through the local server. |
| `probe:requirement-units`            | Probe SysML requirement unit handling.                           |
| `probe:requirement-literals`         | Probe SysML requirement literal forms.                           |
| `probe:architecture-attribute-value` | Probe architecture attribute-value handling.                     |
