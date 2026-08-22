# Syndrid Desktop architecture

## Runtime boundary

`SyndridHQ/syndridcli` is authoritative for agent execution. Syndrid Desktop does not implement a second agent loop, provider router, MCP runtime, permission engine, memory system, session store, or orchestration lifecycle.

```text
Syndrid Desktop
    |  Tauri commands/events
    v
small native desktop layer
    |  stdio JSONL
    v
Syndrid app-server
    |
    v
SyndridCLI runtime/harness
```

The desktop deliberately uses the app-server's production-oriented default stdio transport. Runtime state is event-driven; the UI must not reconstruct lifecycle state by scraping logs or polling when an app-server event exists.

## Native layer ownership

The Tauri Rust layer may own OS integration such as process supervision, PTY/ConPTY, filesystem watching, keychain/credential access, notifications, and user-controlled local terminal sessions.

Agent-owned commands remain SyndridCLI-owned. Windows and macOS implementations must remain platform-guarded rather than assuming WSL, a POSIX shell, or a single path model.

## Protocol client

The client implements the required `initialize` -> `initialized` handshake and currently connects real runtime flows including:

- `thread/list`, `thread/start`, `thread/read`, and `thread/resume`
- `turn/start` and `turn/interrupt`
- streamed `item/agentMessage/delta`, `turn/started`, and `turn/completed`
- persisted transcript hydration through `thread/read(includeTurns: true)`
- runtime-discovered `model/list` and `modelProvider/capabilities/read`
- structured execution activity from `item/started` and `item/completed`
- bidirectional server requests for command/file approval UI

The narrow facade is pinned to SyndridCLI commit `5a83a6b21e7f7e4287be9ef20a33f50262c771f2`. The authoritative generated TypeScript schema lives under `codex-rs/app-server-protocol/schema/typescript` in `SyndridHQ/syndridcli`.

App-server `RequestId` values are `string | number`. Client-originated requests and server-originated requests use independent ID namespaces, so inbound messages are classified structurally: `{ id, method, ... }` is a server request, `{ id, result/error }` is a response, and `{ method, ... }` without an ID is a notification. Do not infer direction from the numeric value of an ID.

The repository should move toward consuming the complete generated TypeScript schema rather than hand-maintaining an expanding protocol mirror. Keep the handwritten facade narrow until protocol generation/sync is automated.

## Approval ownership

SyndridCLI decides when approval is required and sends the corresponding server request. Desktop only presents the request and returns a schema-supported decision. It must not independently infer whether a command or file change is safe enough to bypass the runtime policy engine.

Current desktop coverage includes command execution and file-change approvals. Other server-request families must be added from their generated request/response contracts rather than answered generically.

## Performance posture

- No app-server process per session.
- No panel polling in the runtime path.
- One JSONL stream feeds request completion, server requests, and runtime notifications.
- Runtime activity history is bounded in memory.
- Model/provider catalogs are loaded only after runtime connection.
- Heavy editor, terminal, graph, browser, and document features are not dependencies of the base shell yet.
- Measured shell first-frame timing is shown as a diagnostic rather than claiming an unmeasured startup target.
- Long/unbounded collections must be virtualized when introduced.
- Hidden surfaces must not keep animations, polling loops, or unnecessary background work alive.

Product principle: **Breadth at rest, precision in use.**
