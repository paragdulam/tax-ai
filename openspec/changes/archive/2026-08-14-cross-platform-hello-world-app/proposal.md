## Why

TaxAI needs a desktop distribution that runs on Windows, macOS, and Linux from a single codebase. Before building real tax-filing functionality on top of it, we need a minimal, working cross-platform desktop app skeleton to validate the toolchain, build pipeline, and packaging for all three operating systems.

## What Changes

- Scaffold a new Tauri-based desktop application (Rust shell + web-based UI) in the repo.
- The app opens a single native window and displays a "Hello, World!" message on launch.
- Establish dev and build scripts so the app can be run locally and packaged for Windows, macOS, and Linux.
- No tax-filing functionality, data persistence, or network calls are included in this change - it is strictly the application shell.

## Capabilities

### New Capabilities
- `desktop-shell`: Cross-platform desktop application shell that launches a native window on Windows, macOS, and Linux and renders a Hello World UI.

### Modified Capabilities
- None (greenfield addition; no existing specs are affected).

## Impact

- Adds a new Tauri project (Rust `src-tauri/` backend + minimal HTML/JS/CSS frontend) to the repo root.
- Introduces new build/runtime dependencies: Rust toolchain, Tauri CLI, and a Node-based frontend tooling setup for local development.
- No impact on existing code, since the repository currently contains no application code.
