# Standalone chat and MCP connection boundary (Desktop host)

> Verified-Against: 0be84e7e + uncommitted #58/#59 implementation (2026-09-30).
> Source behavior below; the current packaged Muse journey in #53 remains unproved.

Audience: both · Diátaxis: reference · Kind: contract note

Parent: iteration 1 MCP host. Catalogue (#54) owns discovery beyond the connectable
list; viewers (#50) own MCP App rendering; #51 owns durable artifact reopening.

## Conversation kinds

- `project`: bound to one explicit `projectId`. Fixed Digital Thread MCP, project system
  prompt, every user message prefixed with the bound id. Existing stored conversations
  (with `projectId`, no kind) restore as project conversations, including their ACP
  session store.
- `standalone`: no project, brief, SysML, or Thread baseline. Its Session Canvas is a
  presentation layout, not an engineering model. Zero engineering MCPs until one is
  explicitly enabled. No Casys admitted-language subset is imposed on ordinary calls:
  the provider's own tool contracts determine supported inputs and results.

## Supported MCP connection boundary (#49)

- Transport: `streamable-http` loopback endpoints only, declared in
  `config/mcp-fleet.json`. No stdio, no SSE, no remote endpoint, no caller-supplied URL:
  `mcp.enable` names a registry id.
- Connectable in this iteration: `build123d` only (`http://127.0.0.1:3014/mcp`, tools
  `build123d_execute`, `build123d_export`, `build123d_observe_assembly_integrity`,
  `build123d_project_2d`).
- MCP servers are fixed when an ACP runtime is created (pinned `acpx@3c927fc` offers no
  per-session override). The host separates project, zero-MCP standalone, and attached
  standalone runtimes by MCP set and agent profile. An attached standalone turn receives
  a fresh relay scope and native ACP session/load token; the underlying provider relay
  is shared. Enabling, retrying, or disabling an MCP changes the agent session while the
  coordinator preserves the transcript and its per-profile context-delivery markers.
- Agent-facing servers go through the host-owned loopback relay
  (`desktop/src/chat-host/mcp-relay.ts`): Casys providers fail closed without the
  `mcp-protocol-version` header and the full `io.modelcontextprotocol/*` `_meta`, which
  the pinned stock codex MCP client does not send (proven: direct wiring fails the
  handshake with `-32020 missing_header` on pinned codex 0.144.6, observed manually).
  The relay injects the exact convention per request (`mcp-protocol-version`,
  `mcp-method`, `Mcp-Name` mirroring `params.name` for `tools/call` and `params.uri` for
  `resources/read`) and pipes JSON back. It accepts a single JSON-RPC object per request
  (batch arrays are refused with 400), binds 127.0.0.1 on an ephemeral port, forwards
  POST /mcp only to the fixed registry upstream, carries no credentials, and its URL
  never reaches the renderer. The host probe still targets the provider directly with
  the conformant client.
- For attached standalone turns, a random scope path on that relay belongs to one ACP
  session and one turn. The host observes the exact `tools/call` request and provider
  response on that path before forwarding the response. Calls outside an active scope
  are refused. Native ACP tool cards remain text in the transcript; their optional
  `rawOutput` is not the authority for the captured viewer result. A bounded, failed
  archive read stays marked `missing`; it never fabricates an export or reruns a tool.
  The development correlation tap is optional and is not required in production.
- The host probes the endpoint directly (health, discovery, tool listing, expected-tools
  check) before attaching. A connection failure is reported as `MCP connection failed`
  with the agent kept on the zero-MCP runtime; it is never reported as a tool execution
  failure. Tool execution failures surface through the turn transcript instead.
- `mcp.enable` re-probes, so enable doubles as the reconnect path; `mcp.disable`
  detaches back to zero MCPs. Attachment changes are refused while a turn is queued or
  active, or an interaction is pending.
- Context continuity across the restart: the coordinator tracks, per agent-session key,
  which transcript message ids that ACP session already holds (`knownMessageIdsByKey`,
  persisted). A persistent key resumes its own history server-side, so on ensure the
  coordinator seeds only unseen ids as a bounded history block prepended to the first
  turn text (30 messages / 12 000 chars total / 1 500 chars per message,
  oldest-first with a truncation note, current turn excluded, history-only with no
  re-execution). The seed rides the turn text
  because the pinned codex adapter drops session `_meta.systemPrompt`. Enable, disable,
  and re-probe each reseed exactly the delta. Restart restore prunes the map against
  the live transcript. Ids are marked only at confirmed prompt submission
  (`promptStarted` on async runtimes): a cancel or failure before submission
  leaves them unmarked and drops the handle, so the retry re-ensures and
  reseeds with no tool replay.
- Connection ownership, endpoints, and credentials stay host-side. The renderer sees
  identity and state only (`id`, `displayName`, `status`, tool names). Project
  conversations refuse `mcp.enable`/`mcp.disable`: standalone access cannot change the
  fixed project MCP, and no standalone flow manufactures engineering approval.

## Agent profiles and saved results (#58/#59)

Muse is the default profile. The packaged host resolves its executable from the explicit
`MUSE_CODE_EXECUTABLE` or `~/.local/bin/muse`, reads its reported version, then sets the exact
path for the bundled Muse ACP adapter. Codex is a selectable legacy profile; a missing
optional Codex adapter or executable disables that profile without preventing Muse from
starting. Custom ACP profiles come from the strict user-owned `agent-profiles.json`, not
from a model response or viewer. An agent switch retains the conversation and result
history while keeping native sessions and context markers separate by profile. A profile
file reload invalidates changed adapters after active turns have settled.

Each retained provider result has a `viewerId` tied to its captured message and original
agent, session and turn. A reused native tool-call id cannot replace another result.
While connected, the owning MCP can open the live App viewer. Source and retained export
bytes remain available through **Saved work** after disconnect or restart; a missing
archive falls back only to a live read whose bytes match the saved version digest.

## Permissions

Every tool request reaches the host permission callback before the `deny-all` fallback.
The UI renders the agent's sanitized options with a "Not MRTR" framing, and the decision
is forwarded to the pinned runtime. Retention of `allow_always` is owned by the agent
session, not by the host. No MRTR workflow is attached to ordinary iterations.
