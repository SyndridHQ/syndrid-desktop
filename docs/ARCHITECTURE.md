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

The first vertical slice deliberately uses the app-server's production-oriented default stdio transport. The current runtime documentation describes stdio as newline-delimited JSON and websocket transport as experimental/unsupported.

## Native layer ownership

The Tauri Rust layer may own OS integration such as process supervision, PTY/ConPTY, filesystem watching, keychain/credential access, notifications, and user-controlled local terminal sessions.

Agent-owned commands remain SyndridCLI-owned.

## Protocol client

The initial client implements the required initialize -> initialized handshake and real `thread/list`, `thread/read`, and `thread/resume` requests. The method names and fields in this slice were verified against SyndridCLI main at `f7c52d2332c2854d177c26e3e2edcd9e979d5602`.

The repository should move toward consuming the complete generated TypeScript schema from `codex-rs/app-server-protocol/schema/typescript` rather than hand-maintaining an expanding protocol mirror. Keep the handwritten facade narrow until protocol generation/sync is automated.

## Performance posture

- No app-server process per session.
- No panel polling in the initial runtime path.
- One JSONL stream feeds request completion and runtime notifications.
- Heavy editor, terminal, graph, browser, and document features are not dependencies of the base shell yet.
- Measured shell first-frame timing is shown as a diagnostic rather than claiming an unmeasured startup target.
- Long/unbounded collections must be virtualized when introduced.

Product principle: **Breadth at rest, precision in use.**
