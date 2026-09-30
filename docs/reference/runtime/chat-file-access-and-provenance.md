# Chat file access: menus, permissions, provenance (Desktop host, iteration 1)

> Verified-Against: 0be84e7e + uncommitted #58/#59 implementation
> (2026-09-30). Source behavior; current packaged Muse journey still awaits #53.

Audience: both · Diátaxis: reference · Kind: contract note

Parent: iteration 1 MCP host. Connection boundary in
[standalone chat and MCP connection boundary](standalone-chat-mcp-boundary.md);
lifecycle in the #56 record; capture and reopen in the #50/#51 records.
Connectable in this iteration: `build123d` only.

## Menus (#52-4)

### Catalogue card (`desktop-chat.tsx` CatalogueView)

One card per curated entry: `Prepared` / `Running` / `Capable` badges, engine
badge, `default` badge, then Tools (name, summary, In, Out), Examples, Viewers
(label, URI, `available in Casys` or `planned`), Tested distribution (version,
release, revision), Platforms, guidance, and the live availability detail.

Buttons, each disabled while a turn or another command runs:

- `Prepare` → `catalogue.prepare`: ready the owned endpoint (#56 flow).
- `Check` → `catalogue.probe`: re-probe liveness and tool match.
- `Set default` / `Default ✓` → `catalogue.defaults.set`: toggle default mark.
- `This chat` row: `Enable in this chat` / `Switch to this tool` →
  `mcp.enable`; the enabled badge (`enabled · <name> · <n> tools`);
  `Disconnect` → `mcp.disable`; on failure, `connection failed` + `Retry`.
- `Back to chat` closes the panel. Every outcome renders on a `role=status`
  line. There is no Update button: no update command exists in the catalogue
  protocol, and the parser rejects `catalogue.update` (#52-2).

### Viewer Exports menu (`chat-viewer-panel.tsx` ViewerExports)

Rendered under a live MCP App viewer while its owning MCP is connected:

- `Export source` writes the exact tool input: `<tool>-v<rev>.py` when the
  input carries a `script` string, else `<tool>-v<rev>-input.json`. Entries
  captured before saving existed use the `source` tag instead of a revision;
  no version is fabricated.
- One `Export <fileName>` button per archived artifact, using the manifest
  file name (`<sha256>.<ext>` for provider artifacts). When retained bytes
  are missing, the button tooltip reads `Try a live read; retained bytes are
  missing: <reason>` and the reason renders next to it.
- Each export reports `Saved <path> (<bytes> bytes[, saved bytes|live read])`:
  `saved bytes` came from the chat archive, `live read` from the provider.

### Saved work list (`chat-session-work.tsx`)

Read-only. One row per result version with its revision, outcome, and
retained exports. Its source and saved file export actions remain available after MCP
detach or chat restart; the live App viewer still needs the owning MCP connection.
Legacy entries show `Captured before saving existed. Re-run the tool to save this
result.` Missing bytes show a regeneration hint naming the version and file; trimming
messages never deletes saved bytes.

## Permissions (#52-8)

### Tool execution gate

An agent-proposed script runs only inside a conversation with an explicitly
enabled MCP (`mcp.enable` names a registry id; no caller-supplied URL), and
each run passes the operator gate: `permission.resolve` with `allow_once` /
`allow_always`, or an elicitation accept with `persist: once`. The provider
executes arbitrary Python by design — its own contract states `Do not expose
this server to untrusted callers` — so the enable + per-call gate is the
trust boundary, not script review. No Casys admitted-language subset is
imposed on ordinary chat calls.

### Download writes (`file-saver.ts`, binding `casysChatSaveFile`)

- Destination is `<HOME>/Downloads` only, created recursively. An
  unavailable home refuses with an explicit error.
- Names are sanitized to a narrow charset, 96 characters, no hidden files;
  `.` / `..` / empty fall back to `casys-export.bin`.
- Writes use `createNew`: an existing name is never overwritten. Retries
  append `-2`, `-3`, … (suffix room reserved before the length cap) up to 100
  attempts, mode `0o600`. The response carries the exact path and byte count.
- The saver never writes into chat data, Thread state, or the provider. Saved
  copies are independent: editing them cannot affect the archive.

### Chat store writes (`store.ts`)

Conversations live below a dedicated product-data directory only:
`conversations.json` (index + result manifests), `transcripts/<id>.json`
(messages), `artifacts/<sha256>.bin` (retained export bytes). Directories are
`0o700`, files `0o600`, every write is atomic (temporary file + rename).
Retention is 30 days / 50 conversations / 400 messages per conversation; only
bytes unreferenced by every retained conversation prune. Nothing is written
into Thread/CAS state.

### Bounds

- Tool input and result JSON: 262,144 bytes each (`TOOL_RESULT_JSON_MAX`).
- Work archive file: 524,288 bytes (`WORK_ARCHIVE_MAX_BYTES`).
- Viewer payload bytes: 8,388,608 (`VIEWER_BYTES_MAX`).
- Provider ceiling: 32 MiB per promotable artifact; the host never widens it.

## Provenance (#52-8)

Every captured result carries a durable `viewerId`, a 1-based `revision`, origin agent,
session and turn, and a `resultDigest` (`sha256:<hex>` over the canonical exact result
JSON). An exact redelivery is idempotent only for the same call and exact origin, input,
outcome and result; a native tool-call id reused by another session creates a new version.
The `viewerId` selects the saved result independently of the native call id.
Each archived artifact records `uri`, `fileName`, `mimeType`, `bytes`,
`sha256`, `state` (`saved` | `missing`), plus `savedAt` or `reason`.
Retained bytes are keyed by digest and served back with `source: "saved"`; a
reopened export whose digest does not match is a defect, not a fallback.

Provider artifacts are digest-bound but process-memory-only: a provider
restart deliberately orphans previously issued URIs, and the chat archive is
the durable copy (#51 E2E). Chat transcripts are history, not evidence: the
UI states that transcript history is separate from authoritative Thread/CAS
evidence.

The production host observes exact `tools/call` request/response pairs in the active
standalone turn's private relay scope. This capture does not depend on an ACP agent
exposing structured `rawOutput`; native ACP tool cards remain transcript text. An
unretained artifact stays `missing`. When saved bytes are gone, a live provider read is
accepted for that version only if its size and digest still match the recorded manifest.

## Out-of-subset execution (#52-4)

The chat path imposes no Digital Thread closed subset: a builder-style script
(`with BuildPart() as …`, rejected by `build123d-closed-subset-v1`) executes
through the same enable → run → export → save journey whenever the provider
accepts it. The #52 issue record carries the journey proof run.
