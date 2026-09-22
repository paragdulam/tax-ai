## MODIFIED Requirements

### Requirement: Transaction extraction from saved statements
The system SHALL extract individual transactions (date, description, amount) from a saved statement's Excel, CSV, or PDF content and store them, associated with that statement, so they can be listed without re-parsing the file each time. For a password-protected Excel or PDF statement, the system SHALL first decrypt the content using the statement's stored password before parsing it.

#### Scenario: Transactions extracted after saving
- **WHEN** a statement finishes saving successfully
- **THEN** any transactions found in its content are stored and associated with that statement

#### Scenario: Statement yields no recognizable transactions
- **WHEN** a saved statement's content contains no rows the system can recognize as transactions (e.g. an unstructured or non-tabular PDF)
- **THEN** the statement is still saved successfully and simply contributes zero transactions, with no error shown to the user

#### Scenario: Password-protected statement extracted with a valid stored password
- **WHEN** transactions are extracted (or re-extracted) for a statement that has a valid stored password
- **THEN** its content is decrypted using that password before parsing, and any transactions found are stored the same as for an unprotected statement

#### Scenario: Password-protected statement extracted without a valid password
- **WHEN** transactions are extracted for a statement that is password-protected and has no valid stored password
- **THEN** extraction contributes zero transactions and the statement's status reflects that a password is required, with no crash and no unrelated error shown
