## Context

`ensureStatementsDb()` in `src/main.js` caches the promise from `invoke("plugin:sql|load", ...)` in `dbReadyPromise` and every other database function (`saveStatementFile`, `renderStatements`, `deleteSelectedStatements`, `extractTransactionsForStatement`, `backfillTransactionExtraction`, `renderReviewTransactions`) awaits it first, uncaught. `tauri-plugin-sql`'s `db:load` command runs `sqlx::migrate::Migrator::run(pool)` on first load per db, which returns `Err` if it can't apply migrations - and that `Err` propagates straight to a rejected JS promise with nothing downstream to catch it.

Root-caused this session by reproducing the exact migration list from `src-tauri/src/lib.rs` in an isolated Rust binary against a copy of the app's real local database (`~/Library/Application Support/com.taxai.desktop/taxai.db`): `migrator.run(&pool)` returns `MigrateError::VersionMismatch(1)`. sqlx checksums every already-applied migration's SQL text against its current definition before running anything new; migration 1 (`create statements table`) no longer byte-matches what's recorded in that database's `_sqlx_migrations` table (its 6 rows were saved in an earlier session, before migration 2 - the `transactions` table - existed in `lib.rs`). Because of the mismatch, sqlx refuses to run migration 2 at all, `db:load` fails, `dbReadyPromise` becomes a permanently-rejected promise for the rest of the process's life, and every later save/read silently no-ops.

See proposal.md - Why for the user-facing symptom this produces.

## Goals / Non-Goals

**Goals:**
- Get the local dev database back into a state where both migrations apply.
- Make any future database failure (migration, load, save, read) visible to the user instead of a silent no-op.
- Avoid permanently poisoning `dbReadyPromise` on a single failure, so a later retry isn't blocked for the rest of the session for no reason.

**Non-Goals:**
- Preserving the 6 statement rows already in the corrupted local database (user confirmed a reset is acceptable; they can re-upload the same files).
- General-purpose retry/backoff logic for database operations - just don't cache a rejected promise forever.
- Changing migration authoring practice beyond what's needed here (e.g. no migration-tooling or checksum-pinning work).

## Decisions

- **Reset the local dev database rather than reverse-engineer migration 1's original SQL text.** The exact original text isn't recoverable without git history (this repo's `.git` isn't scoped to the project directory - a separate, already-flagged issue), and hand-patching `_sqlx_migrations` checksums is fragile and easy to get subtly wrong. This is pre-release local dev/test data on a single machine, not a shipped install base, so deleting `~/Library/Application Support/com.taxai.desktop/taxai.db` and letting both migrations reapply from scratch is the reliable fix. User confirmed this trade-off.
- **Surface errors through the existing `showStatementError` banner for the Statements screen, and an equivalent inline error element for the Review screen.** Both screens already have (or, for Review, need) a single error slot near the top of their content; reusing that pattern is simpler than introducing a new toast/notification system for this fix.
- **Reset `dbReadyPromise` to `null` after a rejected load**, so the next call to `ensureStatementsDb()` retries `plugin:sql|load` instead of replaying a cached rejection. This doesn't fix a genuinely broken database, but it means a transient failure (e.g. a momentary file-lock) doesn't require an app restart to recover from.
- **Catch at the call sites that already know how to show an error, not inside `ensureStatementsDb()` itself.** `ensureStatementsDb()` stays a thin wrapper; `saveStatementFile`, `saveStatementFiles`, `renderStatements`, `deleteSelectedStatements`, `loadReviewScreen`/`renderReviewTransactions` each wrap their own top-level `await` chain in try/catch and call the appropriate error-display function, since each already knows the right user-facing message for its context.

## Risks / Trade-offs

- [Resetting the database loses the 6 previously-saved statement rows] → Accepted; user confirmed, and the original files are still on disk to re-upload.
- [A future edit to an already-applied migration's SQL will reproduce this exact failure mode again] → Not fixed by this change (out of scope per Non-Goals); worth a project-level reminder to never edit a migration's `sql` string after it has shipped/applied - always add a new migration instead.
- [Wrapping more call sites in try/catch could mask a bug by showing a generic error instead of surfacing it during development] → Mitigated by still `console.error`-logging the underlying error in every catch block, matching the existing `saveStatementFile` pattern.

## Migration Plan

1. Delete `~/Library/Application Support/com.taxai.desktop/taxai.db` (outside the repo; not a code change).
2. Ship the error-handling changes in `src/main.js`.
3. Relaunch the app; confirm both migrations apply cleanly (`_sqlx_migrations` has rows for version 1 and 2) and re-upload the 6 statements used in earlier testing to confirm transactions now extract correctly.
