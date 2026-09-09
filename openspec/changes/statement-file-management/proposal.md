## Why

The Statements screen currently only shows a static mockup with hardcoded rows and fake statuses (Processing/OCR Failed/Extracting). Users can't actually get their tax documents into the app yet. Before any real tax-liability features can be built, users need a working way to bring their Excel/PDF statements into the app and have them persist locally between launches.

## What Changes

- Drag-and-drop and "Browse Files" on the Statements screen become functional: dropped/selected files are validated as Excel (`.xlsx`/`.xls`), CSV, or PDF, their bytes are copied into local app storage, and a record is saved to a local SQLite database. No network upload occurs.
- The Uploaded Files table is driven by the real set of saved statements instead of hardcoded mock rows. Status per file reflects what actually happened (e.g. Saved / Failed to save) rather than fictional OCR/extraction states, since no processing pipeline exists yet.
- An empty state is shown on the Uploaded Files panel when no statements have been saved yet.
- A select-all checkbox plus a Delete action let the user remove one or more saved statements, deleting both the database record and the stored file bytes.
- The record count in the panel header and the "Showing X-Y of Z" pagination footer reflect the real, current number of saved statements.
- Removed for now: the "Uploaded Returns (1040)" panel and the "Filter" button.

## Capabilities

### New Capabilities
- `statement-management`: local persistence and management (save, list, delete) of user-provided Excel/CSV/PDF tax statement files, with no network upload.

### Modified Capabilities
- None. `desktop-shell` (window launch/lifecycle) is unaffected by this change.

## Impact

- Adds a local SQLite database (embedded via a Rust dependency) and an app-data directory for storing saved file bytes, both scoped to the app's local data directory.
- Adds Tauri backend commands (Rust) for listing, saving, and deleting statements.
- Rewrites the Statements view's upload flow and file table (`src/index.html`, `src/main.js`) to call these commands instead of rendering static mock markup; adds empty-state markup.
- Removes the "Uploaded Returns (1040)" panel and "Filter" button from the Statements view.
