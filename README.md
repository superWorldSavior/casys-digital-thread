# Casys Digital Thread

Casys Digital Thread is an experimental, local-first engineering control plane. It turns
reviewed project intent into traceable technical artifacts and bounded evidence through
registered operations: deterministic engineering tools compute, humans retain
consequential decisions, and the Workbench projects persisted state read-only.

> **Status: active research / alpha.** The repository contains implemented contracts,
> registered engineering operations, a native read-only Workbench, and dated local pilot
> evidence. Coverage remains partial. A successful tool run is not by itself a
> whole-product, manufacturing, conformity, release, or certification verdict.

## The engineering loop

```text
Human intent and consequential decisions
                  |
                  v
Agent proposes registered operations
                  |
                  v
Server selects parsing, lowering, provider, runtime and recovery
                  |
                  v
Exact artifacts -> persisted evidence -> bounded verdict
                  |
                  v
Read-only Workbench projection
```

The project supports idea-first, CAD-first, and reverse-engineering entry paths. Each
path must recover explicit intent before it can make equivalent requirement claims.
SysML, geometry, simulation, measurement, evaluation, and manufacturing evidence remain
distinct records; one does not silently stand in for another. The current product
boundary is described in
[Product direction](docs/explanations/product/product-direction.md).

“Local-first” means that project state, the control plane, the Workbench, and registered
local execution paths are designed to live on the operator's machine. It does not mean
that every installation is offline: agent providers, ERP systems, container registries,
or other reviewed integrations may still use the network.

## Authority model

| Actor     | Owns                                                                        | Does not own                                                   |
| --------- | --------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Human     | Intent and consequential decisions                                          | Provider envelopes or solver payloads                          |
| Agent     | Proposals, plans, queues, and execution of registered operations            | Provider, tool, arguments, lowering, runtime, or self-approval |
| Server    | Sequences, profiles, parsers, lowering, recovery, and canonical publication | Human intent                                                   |
| Workbench | Passive `GET` + SSE projection                                              | Commands, MCP authority, or provider credentials               |

Agents must start with [AGENTS.md](AGENTS.md), then the
[agent workspace reference](docs/reference/agent/agent-workspace.md). The registered
catalogue and backend code are authoritative; UI copy, examples, and internal planning
records are not a second authority model.

## Choose a path

| Goal                                                    | Start here                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Understand the product and its three judgement branches | [Product direction](docs/explanations/product/product-direction.md)                                     |
| Walk through a dated engineering project                | [Walk through an engineering project](docs/how-to/verify-design/walk-through-an-engineering-project.md) |
| Verify a new design from scratch                        | [Verify a new design](docs/how-to/verify-design/verify-a-new-design-from-scratch.md)                    |
| Walk a new Behave-only wall hook from this checkout     | [Verify a new wall hook from source](docs/how-to/verify-design/verify-a-new-wall-hook-from-source.md)   |
| Preview the read-only Workbench                         | [Preview the native Workbench](docs/how-to/workbench/preview-native-workbench.md)                       |
| Understand the local runtime and ports                  | [Local runtime and ports](docs/reference/runtime/local-runtime-and-ports.md)                            |
| Find the implementation behind a capability             | [Codebase map](docs/reference/codebase/codebase-map.md)                                                 |
| Browse all documentation by purpose                     | [Documentation guide](docs/README.md)                                                                   |

A bounded local demonstration how-to walks a **new** Behave-only wall hook from this
checkout. It is not a product, release, or certification tutorial, and it does not
maintain historical `wall-hook-wh01`, `dl04`, or `dl05` state. Other walkthroughs remain
how-to guides because they solve concrete tasks and may depend on explicitly named local
or dated evidence.

## Validate a source checkout

The repository CI currently uses Deno 2.9.2 and Node.js 24. Docker is required for the
provider topology, but not for the contributor gates below.

```bash
npm --prefix src/ui ci
deno task verify
```

This entry command runs `fmt`, `lint`, `check`, `check:ui`, `test`, then
`verify:docs`. It does not run `verify:evidence`, `verify:thread:presentation`,
or `verify:task-catalog`.

See [Validate a source checkout](docs/how-to/setup/validate-a-source-checkout.md) for
the full source-validation sequence.

Ordinary Digital Thread start is cold Deno (`deno task start`). Do not treat
`docker compose up -d` as the atelier start or a clone-only quick start:
CapabilityRuntime providers are H1 JIT launch groups, not the root Compose project. The
complete provider-backed atelier currently has additional prerequisites: published
images must be accessible, local microVM worker images must be prepared, and the
optional ERPNext bridge expects its external repository, environment, and Docker
network. The
[local runtime reference](docs/reference/runtime/local-runtime-and-ports.md) and the
task-specific how-to guide state the exact boundary for each path.

## Repository map

| Path                            | Purpose                                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `server.ts`, `src/`             | Project control, domain contracts, orchestration, persistence, and projections                             |
| `desktop/`                      | Native desktop shell and packaged chat/runtime integration                                                 |
| `src/ui/`                       | Read-only React + Vite Workbench                                                                           |
| `docker-compose.yml`, `config/` | Maintainer diagnostic Compose topology and reviewed runtime configuration; H1 JIT groups are not this file |
| `scripts/`                      | Gates, probes, runners, and local serving commands                                                         |
| `state/fixtures/`               | Checked-in, explicitly labelled test and demonstration fixtures                                            |
| `state/local/`                  | Ignored local project, Thread, CAS, and execution state; never commit it                                   |
| `docs/how-to/`                  | Goal-oriented procedures                                                                                   |
| `docs/reference/`               | Exact contracts, runtime facts, providers, and code locations                                              |
| `docs/explanations/`            | Product and architecture reasoning                                                                         |
| `docs/annex/project-dossiers/`  | Dated, non-authoritative observations from engineering projects                                            |

Engineering provider servers are maintained in separate repositories and run here from
reviewed images. Related public building blocks include
[`mcp-syson`](https://github.com/superWorldSavior/mcp-syson),
[`mcp-build123d`](https://github.com/superWorldSavior/mcp-build123d),
[`mcp-calculix`](https://github.com/superWorldSavior/mcp-calculix),
[`mcp-modelica`](https://github.com/superWorldSavior/mcp-modelica),
[`mcp-spice`](https://github.com/superWorldSavior/mcp-spice), and
[`constraint-solver`](https://github.com/superWorldSavior/constraint-solver).

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change. Security issues belong
in the private reporting path described in [SECURITY.md](SECURITY.md), not in a public
issue. Before changing repository visibility, complete the
[public release checklist](docs/how-to/maintainers/prepare-a-public-release.md).

## License

Copyright © 2026 Casys AI.

This repository is licensed under the
[GNU Affero General Public License v3.0 only (AGPL-3.0-only)](LICENSE). Provider images,
external systems, bundled runtimes, and third-party dependencies retain their own
licences and notice obligations; this repository's licence is not an aggregate licence
claim for them.
