## 1. Vendor a combined .xls/.xlsx parser

- [x] 1.1 Vendor a browser-compatible library that reads both legacy `.xls` (BIFF8) and `.xlsx` (e.g. SheetJS `xlsx` UMD build) into `src/vendor/`
- [x] 1.2 Update `src/index.html` to load the new vendor script in place of `vendor/exceljs.min.js`, and remove the now-unused ExcelJS file

## 2. Rework Excel extraction

- [x] 2.1 Rewrite `extractExcelTransactions` in `src/main.js` to load the workbook via the new library's API (both `.xls` and `.xlsx` buffers) instead of `window.ExcelJS.Workbook().xlsx.load()`
- [x] 2.2 Re-derive the cell-to-string conversion (`excelCellToString`) against the new library's cell value model, preserving current fallback-to-`""` behavior for unrecognized value shapes
- [x] 2.3 Keep header-row detection and the `extractRowsFromTable` hand-off unchanged so downstream extraction logic is untouched

## 3. Surface parse failures distinctly

- [x] 3.1 In `extractTransactionsForStatement`, change the catch path so a thrown parsing error is distinguishable from a successful parse that returns zero rows (rather than collapsing both to `rows = []`)
- [x] 3.2 Propagate that outcome to `saveStatementFile` so it writes a status value indicating parse failure (e.g. `"failed_to_parse"`) instead of `"saved"` when extraction throws
- [x] 3.3 Update `renderStatements` to render a distinct label/style for the failure status in the Uploaded Files table, alongside the existing "Saved" rendering

## 4. Verify

- [ ] 4.1 Manually verify a real legacy `.xls` statement: file saves, appears in the Uploaded Files table as "Saved", and its transactions appear in the Review screen's transaction list
- [ ] 4.2 Manually verify a genuinely corrupt/unparseable file: it saves and shows the new failure status, with no transactions, and no unhandled promise rejection in the console
- [ ] 4.3 Manually verify an existing `.xlsx` statement still extracts correctly (no regression from the library swap)
- [ ] 4.4 Manually verify a statement with no recognizable rows (e.g. unstructured PDF) still saves silently with the normal "Saved" status, per the unchanged existing scenario
