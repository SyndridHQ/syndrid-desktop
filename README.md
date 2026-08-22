# Syndrid Desktop

Syndrid Desktop is the native visual engineering workbench for the Syndrid runtime.

The desktop is intentionally a client of [`SyndridHQ/syndridcli`](https://github.com/SyndridHQ/syndridcli): SyndridCLI owns model execution, routing, orchestration, tools, MCP, sessions, permissions, memory, and runtime lifecycle. The desktop observes, controls, and explains those capabilities through the Syndrid app-server protocol.

> **Breadth at rest, precision in use.**

## Current foundation

- Tauri 2 + React + TypeScript shell
- Windows/macOS CI checks
- native app-server process supervision
- stdio JSONL transport (the app-server's default production-oriented local transport)
- required `initialize` / `initialized` handshake
- real `thread/list`, `thread/read`, and `thread/resume` session flows
- event-driven runtime notifications and stderr diagnostics
- measured shell first-frame diagnostic
- no second agent harness in the desktop process

## Development

Prerequisites:

- Node.js 22+
- current stable Rust toolchain
- a current SyndridCLI/Codex-compatible binary on `PATH`, or `SYNDRID_APP_SERVER_BINARY` set to the runtime executable

```bash
npm install
npm run typecheck
npm run build
npm run tauri dev
```

The native supervisor tries, in order:

1. an explicit binary supplied by the desktop command,
2. `SYNDRID_APP_SERVER_BINARY`,
3. `syndrid`,
4. `codex`.

Whichever binary is selected is invoked as `app-server --listen stdio://`.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the runtime ownership boundary and protocol direction.
