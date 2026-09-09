## ADDED Requirements

### Requirement: Visible error on save or load failure
The system SHALL show a visible error to the user when a statement fails to save, or when the Uploaded Files table fails to load, for any reason (including a local database failure), rather than failing silently.

#### Scenario: Save fails for a reason other than validation
- **WHEN** a statement passes file-type and size validation but fails to save because of a local database error
- **THEN** the user sees an error indicating the save failed

#### Scenario: Statement list fails to load
- **WHEN** the Statements screen cannot read statements from the local database
- **THEN** the user sees an error indicating the list failed to load, instead of an empty or stale table with no explanation
