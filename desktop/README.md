# Casys Digital Thread Desktop

This package is the Deno Desktop shell implemented through Lot 4. It contains one native
system WebView, two dedicated compiled Deno helpers for the existing control plane and
read-only Workbench BFF, and a separate packaged Chat Host. These remain distinct
privilege and lifecycle processes, not a second authority model or general Deno/Node
CLI.

The Workbench reuses the existing Preact/Vite product UI and GET/SSE BFF. Its integrated
Chat React surface feature-detects two narrow native bindings. Both surfaces remain
presentation-only. The web UI, Deno BFF/proxy, closed Chat DTOs, and host protocols are
OS-independent product layers; macOS remains the only distribution proved by the current
packager.

## Current behavior

- Product `0.4.0` and Chat Host `0.6.0`, Workbench `0.3.0`, Deno and Deno Desktop
  runtime `2.9.2`, and control plane server `0.2.0` are exact pins. The WebView engine
  remains OS-owned and is labelled that way in the manifest.
- Before any helper process is considered, Desktop validates the embedded manifest,
  observed Deno/Desktop/product versions, selected finite platform application-support
  layout, product identifier, and exact `active` + `sidecar` declarations.
- Runtime resolves the control-plane and Workbench helpers from `Deno.execPath()` plus
  one closed bundle layout selected by `DesktopPlatform`. There is no checkout helper,
  PATH lookup, ambiguous layout, or general Deno CLI fallback.
- Desktop passes the already validated layout profile through each Deno helper's closed
  CLI grammar. The Workbench derives the existing control-plane and sibling lifecycle
  roots from that profile with native separators; neither renderer nor helper chooses a
  project root.
- Chat starts only after the validated product bootstrap is live and the manifest
  declares exact active sidecar `chat-host@0.6.0`. Production then resolves only the
  target-owned `casys-chat-host` package layout. A recovery-required bootstrap, wrong
  required pin, unsupported target, missing required artifact, or lookalike executable
  produces no Chat Host child. A missing optional Codex adapter or executable disables
  Codex in the selector without blocking the Muse default; present Codex bytes still
  have to match their pins.
- Muse is the default ACP agent. The Chat Host resolves `~/.local/bin/muse` or an
  explicit `MUSE_CODE_EXECUTABLE`, reads its version, and forwards that exact path to
  the bundled Muse adapter. Agent profiles keep their native sessions and context
  markers separate. An attached standalone turn captures its exact MCP call and result
  through a private scope on the shared relay, regardless of the agent's optional ACP
  `rawOutput`. The renderer receives only the bounded saved-result DTO.
- The helper's read-only `inspect` mode supplies the exact embedded-asset digest,
  configuration state, lock, and marker. Desktop then either reconnects to an exact
  identity or starts one helper and waits for its bounded readiness handshake.
- Both helpers use exact inspect/start/reconnect ownership. A foreign, stale,
  mismatched, or ambiguous listener is never adopted, replaced, or killed. Shutdown
  closes only the child handle retained by the Desktop process; stdin EOF is the crash
  lifeline. On `SIGINT` or `SIGTERM`, Desktop drains the renderer and requests bounded
  owned-child cleanup through EOF, `SIGTERM`, then `SIGKILL` before explicitly exiting
  the native process. For the Workbench, a bounded final wait that still has no terminal
  process status is an explicit `termination-unresolved` failure: its host retains the
  owned handle, the application exposes a retryable failed stop, and the native
  supervisor withholds explicit process exit while retrying. A fake child proves the
  unresolved and retry edges even when the first `SIGKILL` is ignored. The moved-bundle
  E2E separately proves marker removal, port closure, and no owned orphan for the real
  packaged helper, including repeated signals. This Lot 3 follow-up does not change the
  older control-plane host's bounded terminal-timeout behavior, so it makes no universal
  no-orphan claim across every Desktop component.
- Control-plane readiness, engineering-provider health, and persisted evidence remain
  separate states. Providers may be `unavailable` without counts. Indexed or `demo` run
  records remain `candidate-unverified`; they are not promoted to verified Thread
  evidence.
- The renderer receives only closed lifecycle and `casys-desktop-chat/1.0` DTOs through
  narrow native bindings. It never receives a token, pid, launch id, runtime-image
  digest, helper origin/path, storage path, process handle, ACP handle, MCP/provider
  credential, raw provider payload, or arbitrary HTML. Saved-work inspection can expose
  the recorded result and artifact digests for provenance; these do not grant provider
  or lifecycle authority.
- When the Workbench helper is ready, the WebView root is the embedded Workbench. The
  Desktop host proxies only an exact path allowlist through `GET` and `HEAD`; SSE stays
  GET-only. It injects a host-only session capability and forwards only bounded `Accept`
  and `Last-Event-ID` headers. POST, MCP, lifecycle, health, command and unknown paths
  are rejected. If the helper is unavailable, the root remains the static diagnostics
  shell and Workbench API reads return a literal `unavailable` document.
- Project focus is the existing durable `primary` cockpit focus. With no focus, the
  read-only root lists sanitized persisted projects but provides no selection link or
  command. No hidden default, second project store, or second evidence authority exists.

## Runtime boundary

The Desktop host reads only its named layout and agent-credential environment entries,
runs only packaged `casys-control-plane`, `casys-workbench`, `casys-chat-host`, the
platform external-URL opener, and the five managed `docker` paths, and reaches only
loopback `127.0.0.1` (control plane, Workbench BFF, and ephemeral app-managed provider
ports). It retains host filesystem read and write; FFI and general subprocess permission
are denied and runtime remote imports are denied. Narrowing the host filesystem grant
remains hardening debt.

The separately compiled helper receives read/write access only to the product root
below. In the currently proved macOS distribution it is resolved against the validated
`$HOME/Library/Application Support` launch directory:

```text
ai.casys.digital-thread
```

Its control-plane workspace is the fixed `ai.casys.digital-thread/control-plane`
subdirectory; the helper cannot traverse the rest of `HOME`.

Its network allowlist contains only the registered loopback control plane/provider
ports. Environment, subprocess, FFI, system, and remote-import permissions are denied.
It has no Docker permission and never searches a checkout or Compose root. The helper
uses the existing server composition and server-owned sequencing; Desktop does not gain
provider/tool/argument authority.

The Workbench helper is narrower. It can read only the existing
`ai.casys.digital-thread/control-plane` workspace and its separately owned
`ai.casys.digital-thread/workbench-runtime` lifecycle directory, write only that
lifecycle directory, and bind only `127.0.0.1:5176`. It has no environment, subprocess,
Docker, FFI, system or remote-import authority. Its private token is mode `0600`, bound
to the exact marker, retained only by the Desktop host, and removed by the owning helper
on shutdown.

These closed allowlists describe the packaged runtime binaries. The development
`deno task test` and `deno task sidecar:test` harnesses currently use unscoped
`--allow-read --allow-write` to exercise filesystem fixtures and generated artifacts.
Those test permissions are not embedded in the Desktop host or helper; narrowing them
remains test-harness hardening debt.

The workspace resolver treats platform layout as closed input data and its macOS,
Windows, and Linux contracts are covered by unit tests. The Deno host, portable web UI,
BFF/proxy, closed Chat DTO/IPC contract, storage semantics, and React UI are
platform-independent. macOS `darwin-arm64` is the only implemented and tested native
package target. Windows and Linux Chat artifacts intentionally remain `missing-pins` and
stop before launch; their later packagers must stage the same least-privilege contracts
under native application-support roots:

| Platform | Product root                                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------------- |
| macOS    | `$HOME/Library/Application Support/ai.casys.digital-thread`                                                                 |
| Linux    | `$XDG_DATA_HOME/ai.casys.digital-thread`; the `$HOME/.local/share/...` fallback is layout data but currently non-launchable |
| Windows  | `%LOCALAPPDATA%\\ai.casys.digital-thread`; roaming config under `%APPDATA%`                                                 |

The matching runtime bundle-path contracts are also closed and unit-tested. Only the
first row is produced and signature-verified by the current packager:

| Platform | Executable contract                                      | Helper contract                                       | Distribution proof |
| -------- | -------------------------------------------------------- | ----------------------------------------------------- | ------------------ |
| macOS    | `<root>.app/Contents/MacOS/<executable>`                 | `<root>.app/Contents/Helpers/<helper>`                | proved             |
| Linux    | `<prefix>/casys-digital-thread/bin/casys-digital-thread` | `<prefix>/casys-digital-thread/libexec/<helper>`      | not shipped        |
| Windows  | `<prefix>\\CasysDigitalThread\\CasysDigitalThread.exe`   | `<prefix>\\CasysDigitalThread\\Helpers\\<helper>.exe` | not shipped        |

The Windows and Linux rows are path contracts, not claims that a native package,
launcher, signature, or install flow has passed. Their future packagers must place the
exact artifacts there and compile the same closed sources with target-specific
filesystem and helper-executable grants; absent or non-conforming artifacts stay
unavailable. The current relative grant is executable for the `linux-xdg` profile and is
exercised by the actually compiled helper. The deeper `linux-home` profile is rejected
before either lifecycle factory because it lies outside that grant; a compiled helper
invocation independently proves the resulting permission denial. These are
permission-contract proofs, not Linux distribution proof.

## Commands

From this directory:

```sh
deno task verify
deno task workbench:test
deno task sidecar:test
deno task chat:test
deno task chat:mrtr-test
deno task package
```

There is intentionally no checkout `dev` task. Production resolves only the nested
signed helpers from `Deno.execPath()`, and an HMR process cannot reproduce that bundle
topology without adding a second helper lookup or broader subprocess permission. Use the
packaged app for native runtime checks.

`package` builds the Vite Workbench, compiles both dedicated Deno helpers, prepares the
exact Chat Host runtime, builds `dist/CasysDigitalThread.app`, and stages the closed
artifacts under `Contents/Helpers`. A minimal native launcher validates the unsymlinked
packaged runtime and helpers, places the signed Helpers directory first on the initial
process `PATH`, then `exec`s the Deno Desktop runtime. This lets Deno resolve exact
basename-scoped `run` permissions before JavaScript starts while keeping a relocated
bundle functional. It does not grant general subprocess access or add a checkout lookup.
Packaging rejects a bundled general Deno or Node CLI, signs the helpers, runtimes,
launchers, and outer app, then verifies every signature. The closed Chat Host launcher
accepts only one exact `--data-root` argument and executes a fixed private official Node
`26.5.0` plus fixed `main.mjs`; package and runtime gates verify Node, acpx/runtime,
lifeline, Muse adapter, and the optional Codex adapter and executable when present
against their digests. The current build still bundles Codex; a missing optional runtime
artifact disables that profile at launch. Packaging also fixes and verifies
`LSMinimumSystemVersion` at macOS 14.0, matching the launchers and Deno Desktop runtime
deployment target. `dist/` is ignored. The focused tasks rebuild their artifacts from
exact pins rather than relying on ambient Node/acpx or a checkout runtime.

`workbench:test` is the isolated Lot 3 gate: it rebuilds only the portable web bundle
and Workbench helper, then tests its closed lifecycle and compiled offline GET/SSE path
on private loopback `:5176`. `sidecar:test` additionally exercises the older control
plane on `:3020` and therefore requires that port to be free. `chat:test` and
`chat:mrtr-test` exercise the separate Chat Host and server-validated MRTR path.

Deno Desktop and config-file permission sets are experimental in Deno 2.9.2. The ad-hoc
signature proves local bundle integrity; it is not a Developer ID signature or a
notarized public release.

The renderer and host preserve the authority model in [AGENTS.md](../AGENTS.md): the
agent proposes registered operations, the human signs consequential decisions, the
server owns sequences/profiles/lowering/recovery, and the Workbench remains a read-only
`GET` + SSE projection. The implemented acpx Chat Host is its own sidecar and must not
be merged into the control-plane helper.
