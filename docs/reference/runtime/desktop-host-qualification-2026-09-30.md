# Desktop host qualification — 2026-09-30

Audience: contributor · Diátaxis: reference · Kind: evidence

This record concerns a local macOS/arm64 package built from the working checkout
based on `0be84e7edba3c2f71f87d01867104039c048b3be`, with the accompanying host,
archive, lifecycle and Canvas corrections. It is not a published release or a
completed first-install/user-interface acceptance for issue #53.

## Real Codex and Build123d journey

The actual `CasysDigitalThread.app/Contents/Helpers/casys-chat-host` was exercised
through its normal IPC client and the same managed-runtime/demand services used
by Desktop. The driver used a fresh chat/runtime data directory, the pinned ACPX
runtime, Codex ACP adapter `1.1.5`, bundled Codex `0.144.6`, Node `26.5.0`, and the
published Build123d `0.7.1` image. It did not use a prerecorded solver result or
the development correlation tap.

The operator's ambient Codex configuration was rejected by the bundled CLI at
session creation. The proof reused only its existing `auth.json` in a private
0700 temporary profile (file 0600), omitted the incompatible configuration, and
removed this copy after shutdown. It did not edit the original configuration or
require a new login or an OpenAI API key. The host now reports this specific
configuration failure with a fixed recovery message instead of `Internal error`.

| Check | Observed result |
| --- | --- |
| Selected/default agent | `casys-codex`, persisted and retained after restart |
| First actual tool turn | `Box(10,10,10)`, volume 1000 mm³ |
| Second actual tool turn | `Box(10,10,20)`, volume 2000 mm³ |
| Export | One actual export call retained STEP, STL and glTF files |
| Live App | `viewer.open` returned the expected App fingerprint; WebView pixels not inspected |
| Result provenance | Exact submitted source and result retained, with three distinct viewer identities |
| Canvas | Three viewer references persisted and reopened unchanged via the host contract |
| Offline reopen | Exact saved file sizes/digests and input/result digest unchanged, no provider restart |
| Shutdown | No owned Build123d container remained running; all nine unrelated containers stayed running |

The first successful run ended in 65.2 seconds: setup 11.5 s, first geometry
29.5 s, edited geometry 46.7 s, saved exports 64.2 s. These are cumulative headless
driver measurements with Docker already running and the image locally available.
They do not measure UI clicks, a download/install, or a user's sign-in time.

The final package was exercised again after the runtime error mapping and type
boundary corrections. It passed in 81.4 seconds (setup 24.0 s, first geometry
44.1 s, edit 57.2 s, exports 79.7 s). The three actual agent turns required three
form confirmations and no ACP permission prompts; the driver accepted those
forms. There was one terminal driver launch; native UI steps remain unmeasured.
Both runs produced the same three exported file digests.

The final run's retained evidence directory was
`/tmp/casys-sep30-codex-34f9119d923fc608`; its retained input/result digest was
`43afcc8597d66dd3add9859ed3b515559d3b690c5dc1d528c39dd0af7fa90039`.
The first run's directory was `/tmp/casys-sep30-codex-c09046ac5e02432e`.
The exported file SHA-256 values were:

- STEP: `dad0ef4de2eaf91ceef1def96ca100dc78267100e10ae87528f236a1f6e7498f`
- STL: `f9fd9f2012a6dfc5d1a59fde3482f0c9b9937afdc3fca662c1d112c5c9fdba85`
- glTF: `0a1b316c8e9a6db1cba4c1fcab23221ab8d1cb0c1364ce03f23edf9e578c1ab2`

## Reproduce

From `desktop/`, after `deno task package`, use an existing compatible Codex login
and a running supported Docker engine:

```sh
deno run --allow-read --allow-write=/tmp --allow-env \
  --allow-run=docker,/opt/homebrew/bin/docker,dist/CasysDigitalThread.app/Contents/Helpers/casys-chat-host \
  --allow-net=127.0.0.1 e2e/standalone-build123d-journey.ts
```

This manual probe performs three real model turns and permits their tool requests
once. It creates and drains an app-owned provider, preserves pre-existing
containers, and retains its proof data. It is not a default unit test.

The deterministic packaged integration test additionally uses a deliberately
output-less ACP agent and a local fixture provider. It verifies two distinct
per-turn relay URLs, native session creation/load, exact archived input/results,
two export revisions and offline bytes after restart. It exercises the actual
packaged helper and pinned ACPX, but does not qualify a real Muse model or Docker:

```sh
deno test --allow-read --allow-write --allow-net=127.0.0.1 \
  --allow-run=dist/CasysDigitalThread.app/Contents/Helpers/casys-chat-host \
  src/build/packaged-mcp-capture_e2e_test.ts
```

## Source and fixture validation

The final validation passed 6,138 source/experiment tests, 254 script tests,
six source-inventory tests and the one OS qualification-lock test. These were
run as the four declared root segments; only the failing script segment was
repeated after its fixture/index repairs. The first source segment was not
needlessly replayed. All required root segments are now green.

The targeted Desktop component suite passed 432 tests with the Desktop configuration
and loopback networking. The repaired default Desktop test task then passed all
495 Desktop-graph tests and 67 sidecar/Workbench tests under their proper root
configuration (562 total). Its dedicated packaged integrations remain separate. The real packaged capture fixture passed separately using
the final app helper. Root/Desktop type checks, UI types, formatting, lint,
source evidence, documentation and read-only presentation gates passed.

## Remaining acceptance

The native UI create/view/edit/export/reopen sequence, full clean-machine Docker
installation, public download/installer, notarization and real Muse turns remain
unproved. The temporary Codex configuration used here is a test arrangement,
not a shipped account-setup feature. Issue #53 stays open for these delivery and
user-journey checks. User-configured ACP adapters require their own qualification.
