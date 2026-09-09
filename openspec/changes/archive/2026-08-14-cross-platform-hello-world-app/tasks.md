## 1. Toolchain Setup

- [x] 1.1 Install/verify Rust toolchain (rustup) and Tauri CLI prerequisites for the current OS
- [x] 1.2 Scaffold the Tauri project (`src-tauri/` backend + frontend entry point) at the repo root via `tauri init` / `create-tauri-app`
- [x] 1.3 Add `dev` and `build` scripts (e.g. `tauri dev`, `tauri build`) so the app can be run and packaged from the command line

## 2. Hello World UI

- [x] 2.1 Create a static `index.html` (with minimal CSS) that displays "Hello, World!" in the window content area
- [x] 2.2 Configure the Tauri window (title, default size) in `src-tauri/tauri.conf.json`
- [x] 2.3 Verify default close behavior terminates the process (no custom close handler needed)

## 3. Verification

- [x] 3.1 Run `tauri dev` locally and confirm the window opens showing "Hello, World!"
- [x] 3.2 Run `tauri build` locally and confirm a packaged app launches correctly on the current OS
- [x] 3.3 Document build/run steps (README or CONTRIBUTING) so the app can be built on the other two operating systems
