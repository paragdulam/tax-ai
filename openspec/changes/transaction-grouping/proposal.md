## Why

Transactions that belong to the same real-world purchase - a product bought on EMI and its monthly installment debits, a Home Loan EMI series, a Car Loan EMI series - currently show up as unrelated one-off rows on the Review screen, with no way to see them as a single purchase or loan.

A prior attempt at cross-transaction linking exists in the migration history: version 7 added a bare `transactions.transfer_group_id` column (paired with an "Inter-Account Transfer" category), and version 8 fully reverted it. No UI, JS logic, or matching algorithm was ever built for it, and no openspec proposal was ever written - it shipped as a schema-only change with no working feature, which is the most likely reason it was abandoned. This change ships the schema together with full UI (creation, auto-suggestion, and a dedicated screen) in one pass, and goes through this repo's openspec workflow so there's a design record this time.

## What Changes

- Users can select transactions on the Review screen and group them into a named "purchase" - either creating a new group (fixed type: Product Purchase, Home Loan, Car Loan, Personal Loan, or Other, plus a free-form label) or adding to an existing one.
- The app proactively detects likely recurring EMI/loan series (same description + amount, roughly monthly cadence, spanning multiple statements) and surfaces a dismissible suggestion to group them; dismissals are remembered so the same series doesn't keep re-prompting.
- Grouped transactions show a badge (type icon + label) inline on the Review screen, and a new group filter (`All Groups` / `Grouped Only` / `Ungrouped Only` / a specific group) is added alongside the existing category/file/date filters.
- A new "Groups" screen lists every group with its transaction count and totals, and drills down into a group's transactions with per-row remove-from-group and edit (type/label) actions. Deleting a group unlinks its transactions rather than deleting them.
- Independently of grouping, each transaction gets a "Consider / Don't Consider" toggle (`include_in_totals`) that controls whether it counts toward category totals and Insights - a purchase can be grouped for organization without changing whether its installments count as expenses, or vice versa.
- Insights' income/expense totals, category breakdown, and top-expenditure table all respect the include-in-totals flag, defaulting to "considered" so existing behavior is unchanged for anyone who never touches the toggle.
- Deleting a statement (which already cascades to delete its transactions) now also cleans up any group left with zero remaining members.

## Capabilities

### New Capabilities
- `transaction-grouping`: manually and automatically grouping related transactions (purchases, EMI/loan series) into a labeled group, viewing/editing/deleting groups on a dedicated screen, and independently toggling whether a transaction counts toward totals/Insights.

### Modified Capabilities
- `transaction-review`: the "Uncategorized by default... since no categorization logic exists yet" requirement is stale (categorization already shipped via `TRANSACTION_CATEGORIES` and the similar-transaction bulk-classify flow) and is reconciled here; the Review screen also gains group badges, a group filter, and per-row group/include-in-totals actions.

## Impact

- New `transaction_groups` and `group_suggestion_dismissals` tables, and new `transactions.group_id` / `transactions.include_in_totals` columns (migrations 10-11 in `src-tauri/src/lib.rs`).
- New "Groups" nav item and screen (`src/index.html`, `src/main.js`).
- Review screen: row template, filter clause, and main query gain group awareness; row checkboxes (previously dead markup) become functional for multi-select.
- Insights' three aggregate queries gain an `include_in_totals = 1` filter.
- Statement deletion's cascade now also removes emptied groups.
