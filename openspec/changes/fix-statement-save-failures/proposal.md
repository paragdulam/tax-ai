## Why

Statement uploads (both "Browse Files" and drag-and-drop) currently fail silently: nothing happens after picking or dropping a file, and no error is shown. Root-caused this session: the `transactions` table migration (added for `review-transaction-list`) never actually applies, because sqlx detects that the earlier `create statements table` migration's SQL text no longer byte-matches what was recorded when it first ran against the local dev database, and refuses to run any further migrations as a result (`VersionMismatch(1)`). That failure rejects the cached database-ready promise in `main.js`, and nothing in the save, render, or review-load paths catches or displays a rejected database call, so every subsequent save and read silently no-ops for the rest of the app session.

## What Changes

- Reset the local dev database (`~/Library/Application Support/com.taxai.desktop/taxai.db`) so both migrations apply cleanly from a blank slate. The 6 statement rows currently in it were saved before the `transactions` table migration existed and can be re-uploaded from their original files.
- Surface a visible error to the user whenever a statement fails to save or the Statements/Review screens fail to load data, instead of failing silently. This covers database/migration failures in addition to the file-type and size validation errors already shown today.
- Stop permanently caching a rejected database-ready promise, so a transient failure doesn't lock up the rest of the session without at least allowing a retry on the next action.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `statement-management`: statement save and listing failures (not just file validation failures) must be visibly surfaced to the user rather than failing silently.
- `transaction-review`: Review screen failures to load or extract transactions must be visibly surfaced to the user rather than failing silently.

## Impact

- `src-tauri/src/lib.rs`: no code change expected (the migration SQL itself is valid), but the local dev database must be reset out-of-band since its migration-tracking state is corrupted.
- `src/main.js`: `ensureStatementsDb()`, `saveStatementFile()`, `renderStatements()`, and `loadReviewScreen()`/`renderReviewTransactions()`/`backfillTransactionExtraction()` need error handling so database failures reach the user via the existing `showStatementError` mechanism (or an equivalent for the Review screen) instead of being swallowed as unhandled promise rejections.
- Local file: `~/Library/Application Support/com.taxai.desktop/taxai.db` (outside the repo) needs to be deleted as part of applying this fix.
