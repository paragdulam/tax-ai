## Why

Selecting a legacy `.xls` file on the Statements screen produces no transactions and no error: `extractExcelTransactions` (`src/main.js`) parses Excel files with `workbook.xlsx.load()` from the vendored ExcelJS library, which only understands the modern OOXML `.xlsx` format. A real binary `.xls` (BIFF8) file throws during parsing; that error is caught and swallowed (`console.error` only), so the statement contributes zero rows to the transaction list even though `.xls` is explicitly listed as an accepted, supported format.

## What Changes

- Legacy binary `.xls` files are actually parsed (not just accepted by extension) so their transactions extract and appear in the Review screen's transaction list, matching the existing behavior for `.xlsx`.
- Extraction failures caused by a parsing error (corrupt or unparseable file content) are visibly surfaced to the user and distinguished from a statement that legitimately contains zero recognizable transactions, which continues to save silently with no error as today.
- The Uploaded Files table reflects this distinction: a statement whose extraction failed shows a status indicating the failure instead of always showing "Saved".

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `transaction-review`: extraction from saved Excel statements must support legacy `.xls` (BIFF8) files, not just `.xlsx`; an extraction failure caused by a parsing error (as opposed to a file with no recognizable transactions) must be visibly surfaced to the user instead of failing silently.
- `statement-management`: a saved statement's status must reflect an extraction/parsing failure (e.g. "Failed to parse") distinct from a normal "Saved" status, so the Uploaded Files table shows when a file didn't actually process.

## Impact

- `src/main.js`: `extractExcelTransactions` needs a parsing path that handles legacy `.xls` binary content (ExcelJS's `workbook.xlsx.load()` cannot read it); `extractTransactionsForStatement`'s catch block needs to distinguish a genuine parse error from "no rows found" and propagate that distinction; `saveStatementFile`/`renderStatements` need to persist and display a failure status per statement.
- `src/vendor/`: likely adds or replaces the Excel parsing dependency (or adds a legacy-`.xls`-capable library alongside ExcelJS), since ExcelJS itself has no `.xls` support to enable.
- Local SQLite schema (`statements` table): the `status` column's possible values gain a failure state; existing rows already saved with status `"saved"` are unaffected.
