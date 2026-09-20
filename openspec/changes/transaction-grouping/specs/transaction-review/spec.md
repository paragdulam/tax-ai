## MODIFIED Requirements

### Requirement: Categorization and default category
The system SHALL let the user assign a category to each transaction from a fixed set of categories (Income, Personal Expense, Business Expense, Internal Transfer), and SHALL display "Uncategorized" for any transaction that has not been assigned one.

#### Scenario: Newly extracted transaction has no category
- **WHEN** a transaction is extracted from a saved statement
- **THEN** it is shown in the Review screen's transaction list with category "Uncategorized" until the user assigns one

#### Scenario: Assigning a category
- **WHEN** the user chooses a category for a transaction from the classification control
- **THEN** the transaction's category is updated and reflected immediately in the Review list

## ADDED Requirements

### Requirement: Group indicator and filter on the Review screen
The system SHALL show a group badge (type icon and label) on any transaction linked to a group, and SHALL let the user filter the transaction list to grouped transactions, ungrouped transactions, or a specific group.

#### Scenario: Grouped transaction shows a badge
- **WHEN** a transaction linked to a group is shown in the Review list
- **THEN** its row displays that group's type icon and label

#### Scenario: Filtering by group
- **WHEN** the user selects "Grouped Only", "Ungrouped Only", or a specific group from the group filter
- **THEN** the transaction list shows only transactions matching that filter
