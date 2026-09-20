## Context

See proposal.md - Why for the full history. In short: a bare `transfer_group_id` column was added (migration 7) and reverted (migration 8) with zero UI ever built for it and no design record. The user confirmed (via clarifying questions): grouping is manual-with-auto-suggest; whether a group's transactions count toward totals is a separate, per-transaction decision, not tied to grouping; group type is a fixed enum plus a free-form label; and this ships both inline Review indicators and a dedicated Groups screen.

## Goals / Non-Goals

**Goals:**
- Ship the schema change together with a fully working UI (creation, suggestion, display, editing, deletion) in this same change - never schema-only.
- Keep grouping purely organizational: it never implicitly changes what counts in Insights.
- Give the user an independent, per-transaction lever (`include_in_totals`) for totals, usable with or without a group.

**Non-Goals:**
- Automatic re-categorization of totals by group type (e.g. auto-excluding EMI installments once grouped as a loan) - the per-transaction toggle is the only lever; grouping never implicitly flips it.
- Cross-page persistent selection on the Review screen - selection is scoped to the current page/filter view for this first version, since transactions are paginated.
- Perfect EMI-series detection - the heuristic (same normalized description + amount, ~monthly spacing, ≥2 statements) is a best-effort suggestion the user must confirm or dismiss, never an automatic group.

## Decisions

- **Creation flow:** multi-select checkboxes on Review (previously dead markup) feed a modal that either creates a new `transaction_groups` row or assigns to an existing one; a single-row shortcut opens the same modal for one transaction. No group is ever created without an explicit user action.
- **Suggestion heuristic:** cluster ungrouped transactions by `(LOWER(TRIM(description)), ABS(amount))`, require ≥2 occurrences across ≥2 distinct statements, then filter in JS for consecutive-date gaps of 20-40 days (absorbs short/long months). Runs once per Review screen load - cheap, and naturally catches a new installment the next time Review is opened rather than needing a hook on every statement save.
- **Dismissal memory:** keyed by a `(description, amount)` signature in `group_suggestion_dismissals`, not by the specific transaction ids seen at suggestion time - so dismissing a series also suppresses its future installments, not just the ones visible today.
- **Selection scope:** page-scoped (cleared on filter/search/date/page changes). Simpler than trying to track a persistent cross-page selection set against a paginated, filterable query; acceptable because a group is almost always assembled from transactions visible together after filtering (e.g. by description search).
- **No SQL foreign keys** on `group_id` (or anywhere else new) - matches the existing schema, which has none; cascades (unlinking on delete, cleaning up emptied groups) are done explicitly in JS, same as the existing statement→transaction cascade.
- **`include_in_totals` defaults to 1** (considered) on every row, existing and new, so nothing changes for any user who never touches the toggle - it's purely additive.
- **Group deletion unlinks, never deletes** the underlying transactions - a group is a label on top of real transaction rows, not a container that owns them.

## Risks / Trade-offs

- [EMI-suggestion heuristic can false-positive on two unrelated recurring debits of the same amount, or false-negative on EMIs with slightly varying amounts (e.g. a final adjusted installment)] → Mitigated by requiring it to span ≥2 *distinct statements* (not just ≥2 rows) and by always requiring explicit user confirmation before a group is created; the user can also just use manual grouping when the heuristic misses.
- [Page-scoped selection means a user can't select transactions across two pages in one pass] → Acceptable for v1; revisit if grouping large series (>20 rows) becomes a common workflow complaint.
- [`include_in_totals` and `group_id` are independent, which is more flexible but also two separate mental models the user has to learn] → This is the user's explicit, stated preference (grouping ≠ totals effect), not an oversight.

## Migration Plan

Two additive migrations (versions 10 and 11) - new tables plus two new nullable/defaulted columns on `transactions`. No backfill needed: `group_id` defaults to `NULL` (ungrouped) and `include_in_totals` defaults to `1` (considered) for every existing row, which reproduces today's behavior exactly until a user opts into grouping or exclusion.
