## Context

`statement-management` already saves statement files (base64 bytes) into a local SQLite `statements` table via `tauri-plugin-sql`, driven entirely from `src/main.js` with no custom Rust commands. The Review screen (`src/index.html`) is still static mock markup. See proposal.md - Why for motivation. The user confirmed: parse Excel, CSV, *and* PDF; show "Uncategorized" for now (category management deferred); parse once at save time and store results in a `transactions` table.

## Goals / Non-Goals

**Goals:**
- Extract real transactions from saved statements and list them on Review, paginated at 20/page with working Previous/Next.
- Keep parsing entirely client-side (webview JS), consistent with the project's "no custom Rust commands, no network calls" trajectory so far.
- Don't introduce a dependency with a known, directly-exploitable vulnerability for our threat model (parsing untrusted user-supplied files).

**Non-Goals:**
- Real categorization logic - every transaction shows "Uncategorized"; a Settings-based category management UI is a separate future change.
- Wiring the filter tabs (All/Uncategorized/Business/Personal), the Business/Personal classification toggle, "Export", or "Mark All Reviewed" - all remain visually present but inert, per proposal.md.
- Perfect PDF table extraction - PDF statements vary too much in layout for a general solution; this ships a best-effort line-heuristic extractor (see Risks).

## Decisions

- **Excel parsing: `exceljs`, not `xlsx` (SheetJS).** The npm-published `xlsx@0.18.5` has two unpatched high-severity advisories (prototype pollution, ReDoS - GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9) with "no fix available" via npm; SheetJS only ships patches through their own CDN, which we'd rather not take a runtime or install-time dependency on. `exceljs` has no high-severity findings for our use (only a moderate advisory in a transitive `uuid` dependency used for *writing* files, a feature we never call - we only use its read/parsing API) and ships a proper browser build (`dist/exceljs.min.js`, exposes `window.ExcelJS`). We vendor that one file into `src/vendor/` (same pattern as the self-hosted fonts) rather than loading it from a CDN at runtime.
- **CSV parsing: hand-rolled, no dependency.** CSV is simple enough (comma-split with quoted-field handling) that adding a library isn't justified - one small parsing function in `main.js`.
- **PDF parsing: `pdfjs-dist` (Mozilla PDF.js).** Zero known vulnerabilities, actively maintained, and its `build/pdf.mjs` is a self-contained ES module with no bare-specifier imports of its own - it can be vendored into `src/vendor/pdfjs/` and loaded via a plain relative `import`, no bundler needed. We use it only for text extraction (`getTextContent()` per page), not rendering.
- **PDF line-heuristic extraction.** Text items are grouped into lines by vertical position, then each line is tested against a regex expecting `<date> ... <description> ... <amount>`. Lines that don't match are skipped. This works for simple, single-column tabular statement PDFs and will miss complex multi-column layouts or scanned (image-only) PDFs - acceptable given the Non-Goal above and the spec's explicit "yields no recognizable transactions" scenario.
- **Schema:** new `transactions` table - `id` (uuid, primary key), `statement_id` (text, references `statements.id`), `date` (text), `description` (text), `amount` (real; negative = money out, positive = money in, matching the UI's existing `-$450.00`/`+$2,450.00` convention), `category` (text, default `'Uncategorized'`), `created_at` (text, ISO 8601). No SQL foreign-key constraint is declared (consistent with the rest of the schema so far); cascade delete is done explicitly in JS.
- **Extraction timing: at save time, plus opportunistic backfill.** `saveStatementFile()` (from `statement-management`) runs extraction right after a successful insert. Additionally, when the Review screen first loads, it checks for any statement with zero transactions and no prior extraction attempt, and extracts those too - this covers statements saved before this change shipped, without needing a formal migration step.
- **Column detection for Excel/CSV:** first row is treated as a header; column purpose is guessed by name (`date`, `description`/`memo`/`merchant`/`payee`, `amount`, or separate `debit`/`credit` columns combined into one signed amount). Rows that don't yield a parseable date and amount are skipped rather than guessed at.

## Risks / Trade-offs

- [`exceljs`'s transitive `uuid` dependency carries a moderate advisory] → We only call ExcelJS's read/parse API, never its file-writing/UUID-generating paths, so this advisory's code path is never exercised; still worth re-checking on future upgrades.
- [PDF line-heuristic extraction is best-effort and will under-extract or miss transactions on complex/scanned PDFs] → Acceptable per Non-Goals; the spec requires graceful "zero transactions" behavior, not perfect extraction. Revisit with a real PDF table-extraction approach if this becomes a frequent pain point.
- [Vendoring `exceljs.min.js` and `pdfjs-dist`'s build output means manually re-copying files on future version bumps, instead of an automated build step] → Matches the project's existing font-vendoring pattern; acceptable at this scale. Revisit if vendored assets multiply further.
- [Client-side parsing of large PDFs/spreadsheets runs on the UI thread's async JS, not a background worker beyond pdf.js's own internal worker] → Acceptable given the existing 50MB per-file cap; revisit if large files cause noticeable UI jank.

## Migration Plan

New `transactions` table via a `tauri-plugin-sql` migration, no existing transaction data to migrate. Statements saved before this change ships are backfilled opportunistically (see Decisions) the first time the Review screen loads after the update - no manual migration step required.
