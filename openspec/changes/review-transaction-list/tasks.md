## 1. Database

- [x] 1.1 Add a migration creating the `transactions` table (`id`, `statement_id`, `date`, `description`, `amount`, `category` default `'Uncategorized'`, `created_at`) in `src-tauri/src/lib.rs`
- [x] 1.2 Add an index on `transactions.statement_id` for delete/lookup performance

## 2. Vendor Parsing Libraries

- [x] 2.1 Vendor `exceljs`'s browser build (`dist/exceljs.min.js`) into `src/vendor/exceljs.min.js` and load it via a `<script>` tag in `src/index.html`
- [x] 2.2 Vendor `pdfjs-dist`'s `build/pdf.mjs` and `build/pdf.worker.min.mjs` into `src/vendor/pdfjs/` and configure `GlobalWorkerOptions.workerSrc` to the vendored worker path

## 3. Extraction Logic

- [x] 3.1 Write a CSV line parser (quoted-field aware) that returns rows of string cells
- [x] 3.2 Write a header-based column detector (date / description / amount, or debit+credit columns) shared by the Excel and CSV parsers
- [x] 3.3 Implement Excel extraction: read the first worksheet via `ExcelJS`, apply the column detector, produce `{date, description, amount}` rows
- [x] 3.4 Implement CSV extraction: parse via the CSV line parser, apply the column detector, produce `{date, description, amount}` rows
- [x] 3.5 Implement PDF extraction: extract text per page via `pdfjs-dist`, group text items into lines by vertical position, apply a date/description/amount regex per line, skip non-matching lines
- [x] 3.6 Implement `extractTransactionsForStatement(statement)` that dispatches to the right extractor by `file_type`, decodes the statement's base64 content, and inserts resulting rows into `transactions` with `category = 'Uncategorized'`
- [x] 3.7 Call `extractTransactionsForStatement` immediately after a statement is successfully saved (extend the existing save flow in `src/main.js`)

## 4. Backfill

- [x] 4.1 On Review screen load, query for statements with zero rows in `transactions` and run extraction for each before rendering the list

## 5. Cascade Delete

- [x] 5.1 Extend the existing statement delete flow (`deleteSelectedStatements` in `src/main.js`) to also delete `transactions` rows for the deleted statement IDs

## 6. Review Screen UI

- [x] 6.1 Replace the hardcoded mock rows in the Review view (`src/index.html`) with a render function that queries `transactions` (joined or looked up against `statements` for the source filename if needed) ordered by date descending
- [x] 6.2 Implement pagination: 20 transactions per page, with Previous/Next buttons enabled/disabled based on current page and total count, and an accurate "Showing X-Y of Z" label
- [x] 6.3 Wire Previous/Next click handlers to move between pages and re-render
- [x] 6.4 Render each row's category as "Uncategorized" and format amounts with the existing signed `-$X.XX` / `+$X.XX` styling
- [x] 6.5 Adjust the Review view's layout so the transaction table's container grows to fill the available vertical space instead of a fixed/cramped height

## 7. Verification

- [x] 7.1 Run `cargo check` in `src-tauri/` to confirm the Rust side compiles
- [ ] 7.2 Run the app (`npm run dev`), save an Excel, a CSV, and a PDF statement, and confirm transactions appear on the Review screen for each
- [ ] 7.3 Save more than 20 transactions worth of statements and verify pagination (Previous/Next enabling, page contents, and the range label) behaves correctly
- [ ] 7.4 Delete a statement from the Statements screen and confirm its transactions disappear from Review
- [ ] 7.5 Verify a statement with no extractable transactions (e.g. a non-tabular PDF) saves without error and simply contributes no rows
