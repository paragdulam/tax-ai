## 1. Reset Local Database

- [ ] 1.1 Delete `~/Library/Application Support/com.taxai.desktop/taxai.db` so both migrations reapply cleanly on next launch

## 2. Statements Screen Error Handling

- [ ] 2.1 Wrap `renderStatements()`'s body in try/catch; on failure call `showStatementError` with a message like "Failed to load statements." and log the error
- [ ] 2.2 In `saveStatementFiles()`/`saveStatementFile()`, catch failures beyond the existing insert try/catch (e.g. from `extractTransactionsForStatement`) so any thrown error shows via `showStatementError` instead of aborting silently before `renderStatements()` runs
- [ ] 2.3 In `deleteSelectedStatements()`, wrap the delete calls in try/catch and show an error via `showStatementError` on failure
- [ ] 2.4 In `ensureStatementsDb()`, reset `dbReadyPromise` to `null` when the underlying `plugin:sql|load` call rejects, so the next call retries instead of replaying a cached rejection

## 3. Review Screen Error Handling

- [ ] 3.1 Add an inline error element to the Review view in `src/index.html` (matching the pattern of `statement-error` on the Statements screen)
- [ ] 3.2 Add a `showReviewError` helper in `src/main.js` mirroring `showStatementError`
- [ ] 3.3 Wrap `loadReviewScreen()` (backfill + render) in try/catch; on failure call `showReviewError` and log the error

## 4. Verification

- [ ] 4.1 Relaunch the app and confirm `_sqlx_migrations` has rows for both version 1 and version 2 after the reset
- [ ] 4.2 Re-upload the 6 statement files used in earlier testing and confirm they save successfully and produce transactions on the Review screen
- [ ] 4.3 Simulate a failure (e.g. temporarily rename/lock the db file, or pass an invalid query) and confirm the Statements screen and Review screen each show a visible error instead of silently doing nothing
- [ ] 4.4 Confirm a normal successful save/list/delete flow still works with no spurious error shown
