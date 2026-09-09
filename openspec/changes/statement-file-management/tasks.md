## 1. Database Setup

- [x] 1.1 Add `tauri-plugin-sql` (sqlite feature) as a Rust dependency and register it in `src-tauri/src/lib.rs`
- [x] 1.2 Add the `@tauri-apps/plugin-sql` JS package and grant the plugin's permissions in `src-tauri/capabilities/default.json`
- [x] 1.3 Define a migration creating the `statements` table (`id`, `filename`, `file_type`, `size_bytes`, `content_base64`, `status`, `created_at`) and wire it into plugin setup
- [x] 1.4 Set `dragDropEnabled: false` on the main window in `tauri.conf.json` so native HTML5 drag-and-drop fires in the webview

## 2. Upload Flow

- [x] 2.1 Replace the visible "Browse Files" button's behavior to trigger a hidden `<input type="file" accept=".xlsx,.xls,.csv,.pdf" multiple>`
- [x] 2.2 Wire the drag-and-drop area's `dragover`/`drop` handlers to read files via the File API
- [x] 2.3 Validate each file's extension (`.xlsx`/`.xls`/`.csv`/`.pdf`) and size (<= 50MB); show an error and skip saving for files that fail validation
- [x] 2.4 For each accepted file, read its bytes, base64-encode them, and insert a row into `statements` via the SQL plugin with status `saved` (or `failed` if the insert errors)

## 3. Statements Table

- [x] 3.1 Remove the hardcoded mock rows and replace them with a render function that queries `statements` (via the SQL plugin) and builds the table rows
- [x] 3.2 Add an empty state (shown when the query returns zero rows) replacing the table
- [x] 3.3 Update the panel header record count and the "Showing X-Y of Z" footer to reflect the real row count
- [x] 3.4 Re-render the table (and counts) immediately after a successful save

## 4. Selection and Delete

- [x] 4.1 Wire the header select-all checkbox to check/uncheck every row checkbox
- [x] 4.2 Track selected row IDs as checkboxes are toggled
- [x] 4.3 Add a Delete button (visible/enabled when at least one row is selected) that deletes the selected rows from `statements` via the SQL plugin
- [x] 4.4 Re-render the table, counts, and empty state immediately after a delete

## 5. Screen Cleanup

- [x] 5.1 Remove the "Uploaded Returns (1040)" panel from the Statements view
- [x] 5.2 Remove the "Filter" button from the Statements view
- [x] 5.3 Update the drag-and-drop area's help text to say "Support Excel (.xlsx, .xls), CSV, and PDF formats up to 50MB"

## 6. Verification

- [x] 6.1 Run `cargo check` in `src-tauri/` to confirm the Rust side compiles
- [ ] 6.2 Run the app (`npm run dev`) and manually verify: empty state on first launch, drag-and-drop save, browse-files save, rejection of an unsupported file type, select-all, delete, and that counts stay correct throughout
- [ ] 6.3 Quit and relaunch the app to confirm previously saved statements still appear (local persistence)
