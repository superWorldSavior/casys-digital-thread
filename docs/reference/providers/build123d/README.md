# Reference: mcp-build123d provider surface
> Verified-Against: eae55b5d (2026-08-31).

Audience: agent · Diátaxis: reference · Kind: provider contract

`mcp-build123d` is a provider, not a registered Digital Thread operation or a geometry
verdict. The maintainer-only `deno task probe:build123d-contract` is read-only: it uses
only `GET /health`, MCP `server/discover`, `tools/list`, and `resources/list` at the
code-owned loopback endpoint. It never issues `tools/call`, reads an artifact resource,
executes CAD, or selects a provider argument.

## Reviewed 0.7.1 OCI identity

Both Compose services pin the dedicated multi-architecture OCI index:

`ghcr.io/casys-ai/mcp-build123d@sha256:6ca7396795de60db038f943cd5df8582c0e5538910d0b56da652bbd461865af4`

| Field                | Reviewed value                                                            |
| -------------------- | ------------------------------------------------------------------------- |
| Release tag          | `v0.7.1`                                                                  |
| Source tag commit    | `8f05e216dfea26339dc2c50e2a48060bf8a4d51a`                                |
| Runtime              | Deno `2.9.6`                                                              |
| Linux AMD64 manifest | `sha256:91b30048f0f74b67c3c4ed3e874652db95502b6cd1db58ec0a30f35fa4546946` |
| Linux ARM64 manifest | `sha256:66c14c537f31205043b7eca4c4dd2a27a308464e71b3a4809ff07ba9f0641e07` |

The index exposes SBOM/provenance attestations. The local candidate verifies the exact
OCI labels `source`, `revision`, and `version` alongside its cache digest; that is a
supply-chain identity check, not a legal or product qualification.

The image owns its `/tini -- docker-entrypoint.sh` ENTRYPOINT and default HTTP CMD
`deno run -A server.ts --hostname=0.0.0.0 --port=3014`. Compose must not reintroduce the
legacy `engineering-toolchain` `build123d` subcommand.

## Declared discovery surface

The exact live `0.7.1` discovery/schema fingerprint is
`sha256:28e6c8c95c929513bcc1db87dd04bd8fb9dc98fe53c1e12dddd75bb6dc6fcd79`. The declared
names are `build123d_execute`, `build123d_export`,
`build123d_observe_assembly_integrity`, and `build123d_project_2d`; the declared viewer
resources are `ui://mcp-build123d/results-viewer`,
`ui://mcp-build123d/assembly-viewer`, and `ui://mcp-build123d/drawing-viewer`.
`build123d_project_2d` returns fixed STEP-to-SVG inspection views only; it is not a
dimensioned manufacturing drawing and the atelier calls no new tool for it. A changed
schema, viewer URI, release identity, or fleet/Compose pin makes the preflight literal
`contract-divergent`.

For `build123d_export`, the server-owned `timeout_ms` argument is an integer in
`[1, 60000]`; the Digital Thread submits its fixed maximum, `60000`. This provider
argument is distinct from the 120000 ms HTTP client deadline and from any 120000 ms
isolated-microVM limit.

This tells a maintainer only that the declared provider surface matches. It does not
prove a CAD execution, an OCCT observation, canonical geometry, admission, a product
proof, or an engineering verdict.

## Two services, two authority boundaries

`mcp-build123d` mounts the shared `exports` volume and is used only by server-fixed
recipes. `mcp-build123d-sandbox` runs the same provider release with its separate
`build123d-sandbox-exports` volume for agent-proposed source. The sandbox result remains
a private draft until its separately registered review and canonical seal; pinning the
same provider image does not join those authorities.
