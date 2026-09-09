## Context

The Statements screen (`src/index.html`, `src/main.js`) is currently static markup with hardcoded rows — no backend exists yet beyond the Tauri shell from the `desktop-shell` capability. See proposal.md - Why for motivation. The user has confirmed: SQLite as the local database, and storing actual file bytes (not just metadata references).

## Goals / Non-Goals

**Goals:**
- Wire drag-and-drop and "Browse Files" to real file acceptance, local persistence, and a live-updating table - all with zero network calls.
- Keep the added Rust surface area minimal, consistent with the project's "no bundler, minimal backend" trajectory so far.

**Non-Goals:**
- Parsing/OCR of statement contents - files are stored as opaque bytes for now.
- Cloud sync or any network transmission of statement data.
- Delete confirmation dialogs - deletion is immediate for this iteration.
- Filtering/search (the Filter button is being removed) and the 1040 returns panel - both explicitly out of scope per the proposal.

## Decisions

- **Database: `tauri-plugin-sql` (SQLite) driven directly from the frontend.** Rather than hand-writing Rust `#[tauri::command]`s for each CRUD operation, `tauri-plugin-sql` lets `src/main.js` run parameterized SQL directly (`Database.load()`, `.execute()`, `.select()`). This keeps the change to "add one plugin + a migration" instead of a bespoke Rust API surface, matching how minimal the Rust side has stayed so far. Alternative considered: hand-rolled `rusqlite` + custom commands - rejected as more Rust code for no behavioral benefit at this stage.
- **File bytes stored as base64 TEXT in the `statements` table, not a separate file on disk.** One SQLite file becomes the single source of truth: saving inserts a row (with bytes), deleting removes a row (bytes go with it) - directly satisfying "delete it from db" with no separate file-cleanup step to keep in sync. Alternative considered: write bytes to `$APPDATA/statements/` and store just the path - rejected for now because it adds a second thing (files on disk) that can drift out of sync with the DB rows; can revisit if file sizes/volume make base64-in-SQLite impractical.
- **Reading file bytes via the browser File API, not Tauri's fs/dialog plugins.** A hidden native `<input type="file" accept=".xlsx,.xls,.csv,.pdf" multiple>` (triggered by the visible "Browse Files" button) and standard HTML5 drag-and-drop both hand JS `File` objects with `.arrayBuffer()` directly - no Rust file-path reads needed. This requires setting `dragDropEnabled: false` on the window in `tauri.conf.json`, since Tauri v2 intercepts OS drag-and-drop by default and would otherwise suppress the browser's native DnD events.
- **Schema:** single `statements` table - `id` (uuid, primary key), `filename` (text), `file_type` (text, `xlsx`/`xls`/`csv`/`pdf`), `size_bytes` (integer), `content_base64` (text), `status` (text, `saved`/`failed`), `created_at` (text, ISO 8601). Applied via a `tauri-plugin-sql` migration run at startup.
- **No delete confirmation.** Matches the terse, iterative "for now" framing of the request; add a confirmation step later if accidental deletes become a problem.

## Risks / Trade-offs

- [Base64 inflates storage ~33% and round-trips through Tauri's IPC as one large JSON string] → Acceptable given the existing 50MB per-file cap and prototype stage; revisit with real BLOB storage or filesystem storage if file sizes or volume grow.
- [`dragDropEnabled: false` disables Tauri's native OS drag-drop event, which some other future feature might have wanted] → No current feature depends on it; the plain HTML5 File API covers everything this change needs.
- [No delete confirmation risks accidental data loss] → Acceptable for this iteration per the Decisions above; cheap to add a confirm step later without changing the spec's observable "delete removes the record and bytes" behavior.

## Migration Plan

This is a new table with no prior persisted data (the Statements screen has never persisted anything before this change), so there is no data migration - only the `tauri-plugin-sql` schema migration that creates the `statements` table on first run.
