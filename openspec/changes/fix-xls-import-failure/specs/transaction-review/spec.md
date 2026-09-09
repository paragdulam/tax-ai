## MODIFIED Requirements

### Requirement: Transaction extraction from saved statements
The system SHALL extract individual transactions (date, description, amount) from a saved statement's Excel (`.xlsx` and legacy `.xls`), CSV, or PDF content and store them, associated with that statement, so they can be listed without re-parsing the file each time.

#### Scenario: Transactions extracted after saving
- **WHEN** a statement finishes saving successfully
- **THEN** any transactions found in its content are stored and associated with that statement

#### Scenario: Legacy .xls statement transactions extracted
- **WHEN** a saved statement is a legacy binary `.xls` file containing recognizable transaction rows
- **THEN** its transactions are extracted and stored the same as they would be for an equivalent `.xlsx` file

#### Scenario: Statement yields no recognizable transactions
- **WHEN** a saved statement's content contains no rows the system can recognize as transactions (e.g. an unstructured or non-tabular PDF)
- **THEN** the statement is still saved successfully and simply contributes zero transactions, with no error shown to the user

## ADDED Requirements

### Requirement: Extraction failures are surfaced to the user
The system SHALL distinguish a statement whose content could not be parsed at all (e.g. corrupted file, content the parser cannot read) from one that was parsed successfully but simply contained no recognizable transactions, and SHALL visibly indicate the former to the user instead of failing silently.

#### Scenario: Parsing error surfaced
- **WHEN** extracting transactions from a saved statement raises a parsing error rather than returning rows (including zero rows)
- **THEN** the failure is visibly indicated to the user, distinct from a statement that legitimately yields zero transactions
