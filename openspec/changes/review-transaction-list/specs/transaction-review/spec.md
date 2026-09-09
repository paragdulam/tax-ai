## Purpose

Turns saved Excel/CSV/PDF statements into individual transaction rows and presents them as a paginated, browsable list on the Review screen.

## ADDED Requirements

### Requirement: Transaction extraction from saved statements
The system SHALL extract individual transactions (date, description, amount) from a saved statement's Excel, CSV, or PDF content and store them, associated with that statement, so they can be listed without re-parsing the file each time.

#### Scenario: Transactions extracted after saving
- **WHEN** a statement finishes saving successfully
- **THEN** any transactions found in its content are stored and associated with that statement

#### Scenario: Statement yields no recognizable transactions
- **WHEN** a saved statement's content contains no rows the system can recognize as transactions (e.g. an unstructured or non-tabular PDF)
- **THEN** the statement is still saved successfully and simply contributes zero transactions, with no error shown to the user

### Requirement: Uncategorized by default
The system SHALL display "Uncategorized" as the category for every extracted transaction, since no categorization logic exists yet.

#### Scenario: Newly extracted transaction has no category
- **WHEN** a transaction is extracted from a saved statement
- **THEN** it is shown in the Review screen's transaction list with category "Uncategorized"

### Requirement: Paginated transaction list
The system SHALL display extracted transactions on the Review screen, 20 per page, with Previous and Next controls to move between pages.

#### Scenario: First page shown by default
- **WHEN** the Review screen is opened
- **THEN** the first 20 transactions (most recent first) are shown, and Previous is disabled

#### Scenario: Navigating to the next page
- **WHEN** there are more than 20 transactions and the user clicks Next
- **THEN** the next 20 transactions are shown, and the displayed range updates accordingly

#### Scenario: Navigating to the last page
- **WHEN** the user is on the last page of results
- **THEN** Next is disabled

#### Scenario: Fewer than 20 transactions total
- **WHEN** the total number of transactions is 20 or fewer
- **THEN** all transactions are shown on a single page and both Previous and Next are disabled

### Requirement: Transaction list fills available space
The system SHALL size the transaction table's container to use the available vertical space on the Review screen rather than a fixed, cramped height.

#### Scenario: Table expands to fill the screen
- **WHEN** the Review screen is displayed at a typical desktop window size
- **THEN** the transaction table's container extends down to fill the remaining vertical space instead of leaving empty space below a short, fixed-height card
