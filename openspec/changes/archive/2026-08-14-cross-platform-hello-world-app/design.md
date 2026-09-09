## Context

The repository currently has no application code - this is the first code added to TaxAI. See proposal.md - Why for motivation. The user has selected Tauri (Rust native shell + web-based UI) over Electron, Flutter Desktop, and .NET MAUI/Avalonia as the desktop framework.

## Goals / Non-Goals

**Goals:**
- Stand up a minimal, working Tauri project structure that builds and runs on Windows, macOS, and Linux.
- Keep the frontend UI as plain HTML/CSS/JS (no framework) since the UI surface is a single static message.

**Non-Goals:**
- Choosing a frontend framework (React/Vue/Svelte) for future screens - deferred until real UI needs exist.
- Setting up CI/CD pipelines for automated multi-OS builds - this change only needs to build locally on each OS.
- Auto-update, code signing, or installer polish.

## Decisions

- **Framework: Tauri.** Chosen by the user over Electron for smaller binary/memory footprint; over Flutter/MAUI because the team may reuse web UI code later. Trade-off: requires a Rust toolchain on every dev machine, which Electron would not.
- **Frontend: static HTML/CSS/JS, no bundler.** For a single Hello World screen, a bundler (Vite, webpack) adds setup cost with no benefit. Revisit once the UI grows beyond a static page.
- **Project layout:** standard Tauri layout - `src-tauri/` for the Rust backend and `src/` (or repo root `index.html`) for the frontend, following `tauri init` conventions so future contributors recognize the structure.
- **Window close = process exit:** use Tauri's default window-close behavior (no custom "hide to tray" logic), matching the spec's close requirement and keeping the shell minimal.

## Risks / Trade-offs

- [Rust toolchain is an unfamiliar dependency for a JS-oriented team] → Document setup steps (rustup install) in the change's task list / README so any contributor can build it.
- [Tauri has a smaller plugin ecosystem than Electron] → Not a concern for this change since no OS-native integrations are needed yet; revisit if future features need capabilities Tauri lacks.
- [Building installers for all three OSes requires access to each OS or CI runners] → Out of scope for this change; local `tauri dev`/`tauri build` on the developer's current OS is sufficient to satisfy the spec.
