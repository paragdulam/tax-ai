## Purpose

Lets related transactions - a purchase and its EMI installments, a Home Loan or Car Loan EMI series - be linked into a labeled group, viewed and managed on a dedicated Groups screen, and lets each transaction independently opt in or out of counting toward totals/Insights regardless of grouping.

## ADDED Requirements

### Requirement: Manual group creation from selected transactions
The system SHALL let the user select one or more transactions on the Review screen and create a new group or add them to an existing group.

#### Scenario: Create a new group from selection
- **WHEN** the user selects one or more transactions and chooses to create a new group with a type and label
- **THEN** a new group is created and the selected transactions are linked to it

#### Scenario: Add selection to an existing group
- **WHEN** the user selects one or more transactions and chooses an existing group
- **THEN** the selected transactions are linked to that existing group

### Requirement: Fixed group type with free-form label
The system SHALL require every group to have one of a fixed set of types (Product Purchase, Home Loan, Car Loan, Personal Loan, Other) and a free-form text label.

#### Scenario: Group displays its type and label
- **WHEN** a group is shown on the Review screen or the Groups screen
- **THEN** it displays its type's icon and its label

### Requirement: Auto-suggested EMI/loan series detection
The system SHALL detect clusters of ungrouped transactions that share a normalized description and amount, appear across at least two statements, and recur at roughly monthly intervals, and SHALL surface them as a dismissible grouping suggestion.

#### Scenario: Suggestion appears for a recurring series
- **WHEN** the Review screen loads and at least one qualifying recurring cluster of ungrouped transactions exists
- **THEN** a suggestion banner is shown offering to review and group them

#### Scenario: Dismissed suggestions are remembered
- **WHEN** the user marks a suggested cluster as "Not a Group"
- **THEN** that description-and-amount combination is not suggested again, including for future transactions matching the same combination

### Requirement: Groups screen with drill-down
The system SHALL provide a Groups screen listing every group with its transaction count and totals, and allow drilling into a group to see its linked transactions.

#### Scenario: Groups list shows totals
- **WHEN** the Groups screen is opened
- **THEN** each group shows its transaction count and the sum of its considered transactions

#### Scenario: Drill-down shows linked transactions
- **WHEN** the user opens a group's detail view
- **THEN** all transactions currently linked to that group are listed, each with an action to remove it from the group

### Requirement: Deleting a group unlinks its transactions
The system SHALL, when a group is deleted, unlink its transactions rather than deleting them.

#### Scenario: Group deletion preserves transactions
- **WHEN** the user deletes a group
- **THEN** the group record is removed and its previously-linked transactions remain in the Review list, now ungrouped

### Requirement: Per-transaction include/exclude from totals, independent of grouping
The system SHALL let the user toggle, per transaction, whether it is considered in category totals and Insights, independently of whether that transaction belongs to a group.

#### Scenario: Excluding a transaction removes it from totals
- **WHEN** the user marks a transaction as not considered
- **THEN** it is excluded from the Insights income/expense totals, category breakdown, and top-expenditure figures

#### Scenario: Exclusion works without grouping
- **WHEN** the user marks an ungrouped transaction as not considered
- **THEN** the exclusion applies without requiring the transaction to be part of any group

#### Scenario: New and existing transactions default to considered
- **WHEN** a transaction is extracted from a statement or already exists from before this change
- **THEN** it is considered in totals by default until the user explicitly excludes it
