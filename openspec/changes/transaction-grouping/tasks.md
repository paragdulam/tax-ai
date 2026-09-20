## 1. Database

- [x] 1.1 Add migration 10 (`transaction_groups` table, `transactions.group_id`, `transactions.include_in_totals`) to `src-tauri/src/lib.rs`
- [x] 1.2 Add migration 11 (`group_suggestion_dismissals` table) to `src-tauri/src/lib.rs`

## 2. Group Creation/Editing UI (Review screen)

- [x] 2.1 Wire the Review table's row and header checkboxes into a `selectedTransactionIds` Set, page-scoped (cleared on filter/search/date/page changes)
- [x] 2.2 Add a selection toolbar (count + Add to Group + Clear) shown when the selection is non-empty
- [x] 2.3 Add a group editor modal (create-new with type + label, or add-to-existing) and wire Save to `transaction_groups` insert + `transactions.group_id` assignment
- [x] 2.4 Add a single-row "Add to group" shortcut in the row action icons

## 3. Auto-Suggest EMI/Loan Series

- [x] 3.1 Implement `findEmiGroupSuggestions()`: cluster ungrouped transactions by normalized description + amount, filter by ≥2 statements and ~monthly date spacing, exclude dismissed signatures
- [x] 3.2 Add a dismissible suggestion banner on Review, populated on screen load
- [x] 3.3 Add a suggestions review overlay (per-cluster Create Group / Not a Group) and a `group_suggestion_dismissals` write on dismiss

## 4. Per-Transaction Consider/Don't-Consider Toggle

- [x] 4.1 Add a row-level toggle button that flips `transactions.include_in_totals`
- [x] 4.2 Render excluded transactions visually muted with an "Excluded" indicator
- [x] 4.3 Add `include_in_totals = 1` to Insights' income/expense totals, category breakdown, and top-expenditure queries

## 5. Inline Review Indicators

- [x] 5.1 Join `transaction_groups` into the Review row query and render a type-icon + label badge on grouped rows, clickable to the Groups screen
- [x] 5.2 Add a group filter (`All Groups` / `Grouped Only` / `Ungrouped Only` / specific group) to the filter bar and `buildReviewFilterClause()`

## 6. Groups Screen

- [x] 6.1 Add a "Groups" nav item and view section, wired into `VIEWS` / `setActiveView()`
- [x] 6.2 List groups with transaction count, considered/excluded totals, and created date
- [x] 6.3 Drill-down overlay: editable type/label, per-transaction remove-from-group and include/exclude toggle
- [x] 6.4 Delete-group action: unlink transactions, then delete the group row

## 7. Cascade/Consistency

- [x] 7.1 Add `cleanupEmptyGroups()` and call it after statement deletion and after any remove-from-group action

## 8. Verification

- [x] 8.1 `cargo check` in `src-tauri/` to confirm the new migrations compile
- [x] 8.2 Launch the app (`npm run tauri dev`) and confirm Review, Groups, and Insights all load without SQL errors against the new schema/columns
- [ ] 8.3 Manually create a group from Review, confirm the badge, the Groups screen listing/totals, and the group filter all reflect it
- [ ] 8.4 Seed same-amount/same-description transactions ~30 days apart across 2+ statements, confirm the suggestion banner appears; accept one cluster, dismiss another, reload and confirm the dismissed one doesn't reappear
- [ ] 8.5 Toggle include/exclude on a transaction inside and outside a group; confirm Insights totals update accordingly and that toggling doesn't require or affect grouping
- [ ] 8.6 Delete a statement whose transactions were a group's only members; confirm the group disappears and no row references a nonexistent group
- [ ] 8.7 Delete a group via the Groups screen and confirm its transactions remain in Review, now ungrouped
