## Context

See proposal.md - Why. The relevant code is entirely client-side, vendored into the Tauri webview (no Rust involved): `src/index.html` loads `vendor/exceljs.min.js`, and `src/main.js`'s `extractExcelTransactions` (called from `extractTransactionsForStatement` for `file_type === "xlsx" || "xls"`) does `new window.ExcelJS.Workbook()` then `workbook.xlsx.load(buffer)`. ExcelJS's `.xlsx` loader only understands the OOXML zip/XML format; it has no reader for the legacy binary `.xls` (BIFF8/OLE2) format at all - not a bug to fix in how it's called, a capability it doesn't have. ExcelJS is used nowhere else in the app (grep confirms one call site, one script tag).

## Goals / Non-Goals

**Goals:**
- Parse real legacy `.xls` files into the same `{date, description, amount}` row shape `extractRowsFromTable` already expects, so downstream extraction/storage logic is untouched.
- Make a parsing failure (throws) distinguishable from a structurally-valid-but-empty result, all the way from `extractTransactionsForStatement` through to the statements table's `status` column and the Uploaded Files UI.
- Keep the change scoped to the Excel path; CSV and PDF extraction are unaffected.

**Non-Goals:**
- Fixing the (possibly stale) DB-migration silent-failure issue described in the separate `fix-statement-save-failures` change - out of scope here; that failure mode is unrelated to file format.
- Adding retry/re-parse UI for a failed statement (e.g. a "retry extraction" button) - the fix only needs the failure to be visible, not recoverable in this change.
- Categorization, validation, or any change to what counts as a "recognizable transaction row".

## Decisions

**Replace ExcelJS with a single library that reads both `.xls` and `.xlsx`.**
ExcelJS has no legacy-`.xls` reader to add to; some other parser is required regardless. Two shapes were available:
- (a) Keep ExcelJS for `.xlsx` and vendor a second, `.xls`-only library alongside it, branching on `file_type` inside `extractExcelTransactions`.
- (b) Vendor a single library that reads both formats (e.g. SheetJS `xlsx`, a widely-used browser-compatible UMD build) and drop ExcelJS entirely, since nothing else in the app depends on it.

Chosen: (b). One parser, one code path, one dependency to keep current - and it removes a vendored file instead of adding a second one alongside the first. The `excelCellToString`-equivalent cell-to-string conversion and the `rows.length < 2` / header-row handling in `extractExcelTransactions` stay conceptually the same; only how the workbook is loaded and how a worksheet's rows are walked changes to the new library's API.

**Distinguish "parse error" from "zero rows" with a sentinel, not a special row shape.**
`extractTransactionsForStatement` currently does `try { rows = ... } catch { rows = [] }` and returns early on `rows.length === 0` - both a thrown error and a legitimately empty statement collapse to the same "nothing happened" outcome. The fix lets the catch block record that a real error occurred (as opposed to setting `rows = []` silently) and passes that outcome back to the caller (`saveStatementFile`), which already controls the `status` value written on INSERT. No new table is needed - `status` gains one more legal value alongside `"saved"`.

**Reuse the existing `status` column rather than adding a new one.**
`statements.status` is already free-text (`"saved"` today) and already rendered in the Uploaded Files table. Adding a value like `"failed_to_parse"` (mapped to a "Failed to parse" label in the UI, styled like the existing failure-ish states) avoids a schema migration beyond what already exists.

## Risks / Trade-offs

- [Swapping the Excel library changes cell-value coercion edge cases (e.g. how formulas, merged cells, or rich text are read back) since the new library's value model differs from ExcelJS's] → `excelCellToString`'s job (turn a cell into the row-extraction string) is small and already defensive (`typeof v === "object"` handling); re-derive it against the new library's plain-value model and keep the same fallback-to-`""` behavior for anything unrecognized, so behavior for already-working `.xlsx` files doesn't regress.
- [A password-protected or genuinely corrupt `.xls`/`.xlsx` will still throw, just from a different library] → that's exactly the case this change makes visible instead of silent, so it's the intended new behavior, not a regression.
- [Existing statements already saved with today's silent-failure behavior won't retroactively gain a "Failed to parse" status or newly-extracted transactions] → out of scope per Non-Goals; only newly-saved statements go through the fixed path. The user can re-upload an affected file if they want it picked up.
