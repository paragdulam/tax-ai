## ADDED Requirements

### Requirement: Visible error on Review screen load failure
The system SHALL show a visible error to the user when the Review screen fails to extract or load transactions because of a local database failure, rather than failing silently.

#### Scenario: Review screen fails to load transactions
- **WHEN** the Review screen cannot read or extract transactions from the local database
- **THEN** the user sees an error indicating the transaction list failed to load, instead of an empty or stale list with no explanation
