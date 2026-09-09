## Why

The Review screen currently shows four hardcoded mock transactions with fake merchants and categories. Now that statements can actually be saved locally (`statement-management`), the next step is turning those saved files into a real, browsable transaction list - the whole point of collecting statements in the first place.

## What Changes

- Excel (`.xlsx`/`.xls`), CSV, and PDF statements are parsed into individual transaction rows (date, description, amount) as soon as they're saved, and stored in a new local `transactions` table.
- The Review screen's table is driven by real transactions from that table instead of hardcoded rows, paginated at 20 transactions per page with functional Previous/Next controls and an accurate "Showing X-Y of Z" label.
- "Suggested Category" shows "Uncategorized" for every real transaction, since no categorization logic exists yet. Building an interface to define/assign categories (e.g. in Settings) is explicitly deferred to a later change.
- The transaction table's container grows to fill the available vertical space on the Review screen instead of the current cramped, fixed-height card.
- Deleting a statement (via `statement-management`) also deletes the transactions extracted from it.
- **Non-Goals for this change** (existing UI left in place but inert): the filter tabs (All/Uncategorized/Business/Personal), the per-row Business/Personal classification toggle, "Export", and "Mark All Reviewed" - none of these are wired to real data or logic yet.

## Capabilities

### New Capabilities
- `transaction-review`: extracting transactions from saved statement files and displaying them as a paginated list on the Review screen.

### Modified Capabilities
- `statement-management`: deleting a statement must also delete the transactions extracted from it, so no orphaned transaction rows are left behind.

## Impact

- Adds a client-side parsing step for Excel/CSV (via a spreadsheet-parsing library) and PDF (via a PDF text-extraction library) statement files, run when a statement is saved.
- Adds a new `transactions` table to the local SQLite database (`tauri-plugin-sql`, already in use), with rows referencing their source statement.
- Rewrites the Review view (`src/index.html`, `src/main.js`) to query and paginate real transactions instead of rendering static mock markup.
- Extends the statement deletion flow to also remove the deleted statement's transactions.
