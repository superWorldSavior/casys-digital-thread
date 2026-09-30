# How-to: reach a first saved Build123d result

Audience: user · Diátaxis: how-to · Kind: how-to

Build path: from a source checkout on macOS, build the app with `deno task package`
(from `desktop/`) and open `dist/CasysDigitalThread.app`. There is no separate installer
yet; do not look for a download link. Product `0.4.0`, Chat Host `0.6.0`, Node
`26.5.0` and Build123d `0.7.1` have a real packaged-host proof with Codex through
ACPX on macOS/arm64. This is a headless integration proof, not a completed native
UI or clean-machine installation proof for #53. Windows and Linux Chat artifacts
remain `missing-pins` and are out of scope.

Choose an agent and use its supported sign-in. The qualified journey uses Codex's
existing ChatGPT login, without an OpenAI API key. You need no Docker CLI skills:
the app prepares its own provider. Muse is also selectable: install Muse Code and
sign in through `muse login` in a terminal. The packaged host resolves `~/.local/bin/muse` or an explicit
`MUSE_CODE_EXECUTABLE` and passes that exact path to its bundled ACP adapter. If Muse is
missing or not signed in, the chat names the selected agent and gives a recovery step.
An absent optional Codex adapter or executable disables Codex, not Muse.

## 1. Open a chat

Launch the app and open a normal chat. Choose **Codex** in the agent selector and
save it as your default if desired. A fresh profile initially selects Muse; the
saved choice applies to future conversations. Use the recovery instructions for
the selected agent if it needs sign-in. Do not paste credentials into the chat.

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

The agent asks for permission to run the tool; allow it. For this script the expected
volume is `1000 mm^3`.

## 4. Edit it

Send an edited script, for example `Box(10, 10, 20)`, and confirm the new reported
volume (`2000 mm^3`). The transcript keeps both results.

## 5. View and export

Ask the agent to export the edited geometry through Build123d and approve that tool call.
While Build123d is connected, use **View build123d_export result** to inspect a captured
result. Use **Export source** for the exact submitted input and **Export file** for each
retained output. The **Saved work** list keeps these result versions and export buttons
after you disconnect the MCP or reopen the chat; opening the live App viewer still needs
its owning MCP connected. If an export could not be retained, the list gives its reason
and the file requires a verified live read or a new run.

The host now captures the exact MCP request and response in a scope assigned to the
current turn. It does not need the Muse adapter to expose structured ACP `rawOutput` for
saved results. An ACP tool card remains a text transcript item; the saved result has its
own durable viewer identity. The actual packaged Codex path and an output-less ACP
fixture both retain results and exported bytes. Muse-specific real turns and the
native UI journey remain unproved; a fixture is not Muse qualification.

## 6. Close and reopen

Quit the app and reopen it. Check that the conversation, results, selected agent,
source export and retained files reappear. Reopening saved work must not execute a tool;
the provider starts again only when you use it.

## Observed timings (not targets)

Measured on 2026-09-30 with the actual packaged Chat Host, Codex and Docker already
running: setup 11.5 s; first geometry at 29.5 s; edited geometry at 46.7 s; three saved
exports at 64.2 s; shutdown and offline reopen at 65.2 s. These are cumulative driver
times, not a UI stopwatch or a target. See the [qualification record](../../reference/runtime/desktop-host-qualification-2026-09-30.md).

## If something is missing

- No Docker daemon: the app reports the runtime unavailable instead of a result. Start
  Docker Desktop and retry the enable step.
- Muse not signed in: run `muse login` in a terminal, then send again.
- Codex configuration incompatible: the bundled version may reject settings from a
  different CLI version. Use a compatible configuration for this profile. The proof
  reused existing authentication in a temporary private profile without copying the
  operator's configuration; it did not change that configuration.
- Another agent: the selector offers separate ACP profiles, each with its own sessions.
  Switching mid-conversation preserves history; each message records which agent
  produced it.

Provider-side "Use with Casys" documentation lives in the provider's own repository and
is linked once that destination is verified there.
