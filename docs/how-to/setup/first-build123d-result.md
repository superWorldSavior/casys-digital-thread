# How-to: reach a first saved Build123d result

Audience: user · Diátaxis: how-to · Kind: how-to

Download path: from a source checkout on macOS, build the app with `deno task package`
(from `desktop/`) and open `dist/CasysDigitalThread.app`. There is no separate installer
yet; do not look for a download link. This guide covers the proved macOS flow only:
product `0.4.0`, Chat Host `0.6.0`, Muse adapter `0.7.0`, Muse CLI `1.4.0`, Node
`26.5.0`, Docker Engine `29.x`. Windows and Linux Chat artifacts remain `missing-pins`
and are out of scope.

You need no Codex login and no OpenAI API key. You need no Docker CLI skills: the app
prepares its own provider. You need a Muse login (`muse login` in a terminal); if it is
missing the chat tells you so and keeps ordinary chat usable.

## 1. Open a chat

Launch the app and open a normal chat. The agent selector shows Muse as the selected
default. If Muse is not signed in, the first send fails with recovery text telling you
to run `muse login` in a terminal and retry. The app never sees your credentials.

## 2. Enable Build123d

In the catalogue, select Build123d for the conversation. The app starts the provider on
an ephemeral loopback port by itself; a fixed historical port or a container you already
run never blocks it, and unrelated Docker containers are left alone. No SysON, ERPNext,
solver, or Compose stack is required.

## 3. Ask for a first geometry

Send:

```text
Run build123d_execute with exactly this script, unchanged:
from build123d import *
result = Box(10, 10, 10)
Then report the volume.
```

The agent asks once for permission to run the tool; allow it. The chat reports
`1000 mm^3`.

## 4. Edit it

Send an edited script, for example `Box(10, 10, 20)`, and confirm the new reported
volume (`2000 mm^3`). The transcript keeps both results.

## 5. Export (current limitation)

`build123d_export` runs through Muse and the provider executes it, but the Muse adapter
(`0.7.0`) forwards only a text summary of MCP tool results to the chat host — no
structured output, no artifact URIs. Saved export archives and live viewers therefore do
not appear with Muse in the packaged app. Export archives were proved through the Codex
profile before agent profiles existed (#52 journey); re-proof on the current tree is
pending. This guide will gain an export step once the adapter forwards tool outputs.

Development only: starting the chat host with `CASYS_DEV_RELAY_TAP=1` enables relay
correlation taps that attribute exact provider responses to output-less tool events
(unique match or nothing, never a wrong result). This exercises viewers and archives
with Muse in dev; it is not production behavior and the packaged app never enables it.

## 6. Close and reopen

Quit the app and reopen it: the conversation, both results, and the selected Muse agent
are restored from saved work. Nothing re-executes on reopen; the provider restarts only
when you use it again.

## Observed timings (not targets)

Measured on macOS with Docker already running, 2026-09-28: enable ~10 s, first turn ~38
s (one permission prompt), edit turn ~28 s, end to end ~77 s. Your machine and account
will differ; these numbers are observations, not promises.

## If something is missing

- No Docker daemon: the app reports the runtime unavailable instead of a result. Start
  Docker Desktop and retry the enable step.
- Muse not signed in: run `muse login` in a terminal, then send again.
- Another agent: the selector also offers Codex (legacy, keeps its own sessions).
  Switching mid-conversation preserves history; each message records which agent
  produced it.

Provider-side "Use with Casys" documentation lives in the provider's own repository and
is linked once that destination is verified there.
