# Tool runtime tested matrix (Desktop host, iteration 1)

> Verified-Against: uncommitted #56 (2026-09-27). Measured setup evidence for
> the two backend paths; unmeasured cells stay literal.

Audience: both · Diátaxis: reference · Kind: evidence

Decision: [backend decision](tool-runtime-backend-decision.md). First MCP:
Build123d v0.7.0 (`ghcr.io/casys-ai/mcp-build123d@sha256:aa9ae126…bcc5a9`).

## Matrix

| OS / CPU | Engine | Reuse path | Fresh (no-engine) path |
| --- | --- | --- | --- |
| macOS / arm64 | Docker Desktop 29.7.2 (linux/aarch64), compose 5.3.1 | **Measured end to end** (below) | **Measured to the install boundary** (below); full DMG install unmeasured |
| macOS / amd64 | any | Unclaimed | Unclaimed |
| Windows / amd64 | any | Unclaimed | Unclaimed |
| Linux / amd64, arm64 | any | Unclaimed | Unclaimed |

Unclaimed means untested and unsupported: the backend refuses with explicit
recovery codes instead of guessing (`install-unsupported-platform`,
`arch-unsupported`, `os-not-linux`).

## Reuse path, measured (macOS/arm64, Docker Desktop present)

Driver: `ToolRuntimeHost.prepare("build123d")` against the real daemon
(`/tmp/tool-runtime-e2e.ts`, disposable workdir).

- Engine detection: `ready`, server 29.7.2 linux/aarch64, compose 5.3.1,
  ~50–220 ms per call.
- Fresh prepare: **8.6 s** wall (image already local, so pull is a
  verify-only pass): digest + `linux/arm64` verified from image inspect,
  owned Compose project `casys-host-build123d` started (loopback
  127.0.0.1:3014, 2g/2cpu/pids-128, no-new-privileges, cap_drop ALL),
  readiness via `/health` + `tools/list` containing the fleet-expected
  tools, then a real `build123d_execute` smoke: `Box(10, 10, 10)` →
  1000 mm³, 1 solid, 6 faces, 12 edges, exactly as asserted.
- Resume prepare (existing done intent): **405 ms**, smoke trusted from the
  journal and not re-executed (0 additional tool calls).
- Foreign workloads untouched: 9 unrelated containers before and after;
  the owned container added exactly one and `stop` + `remove` took it back
  to 9 with zero orphans.
- Removal semantics verified: `stop`/`remove` act on owned label filters
  only; the exports volume is retained; images are never pruned (no
  `prune`/`rmi` in the flow; `removeImage` additionally refuses while any
  container references the pin).
- Status projection: engine `ready`, tool `ready`, image 383,020,127 bytes,
  1 owned container, 1 retained volume; renderer projection carries no
  paths, ports, container ids, or digests.

## Fresh path, measured to the install boundary (macOS/arm64)

- Engine-absent detection proven at #56 by hiding `docker` from `PATH`
  (status `absent`, app-managed recovery). Since the #54
  `DockerResolvingRunner`, absolute managed paths are probed before PATH,
  so PATH-hiding alone no longer yields `absent` on a standard install.
- Declined approval returns `install-approval-required` with zero side
  effects (no download, no mount, no admin prompt).
- Approved flow is unit-proven end to end with stubbed OS tools: pinned
  DMG URL download → Apple Developer ID authority gate (wrong authority
  fails closed before any mount or `osascript` call) → mount-point
  sanitization → admin `cp` via `osascript` (the only OS authorization)
  → detach → app launch → bounded daemon wait → reuse path.
- **Not measured**: the real ~700 MB DMG download and the real admin
  install on a clean machine. #53 must measure that journey before any
  fresh-install claim beyond this boundary.

## Deliberate non-goals in this iteration

- No shared adoption of foreign running providers: a port conflict returns
  `port-conflict` with recovery instead of executing against containers
  Casys does not own.
- No engine auto-start: a stopped engine returns `engine-stopped`; starting
  it is one explicit operator action.
- No volume deletion anywhere and no image pruning; `update` archives the
  prior intent, keeps the old image, and retains volumes.
- Chat availability while the runtime is down is structural: runtime shell
  components never report `error`, so the shell degrades instead of
  requiring recovery; preparation failures are contained outcomes, never
  crashes.
