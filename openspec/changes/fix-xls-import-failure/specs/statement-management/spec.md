## ADDED Requirements

### Requirement: Failed extraction is reflected in statement status
The system SHALL show a status in the Uploaded Files table that distinguishes a statement whose content failed to parse from one that saved and processed normally.

#### Scenario: Parsing failure shown in the table
- **WHEN** a saved statement's transaction extraction fails with a parsing error (not merely zero recognizable transactions)
- **THEN** the Uploaded Files table shows a status for that row indicating the failure (e.g. "Failed to parse") instead of the normal "Saved" status

#### Scenario: Normal statement keeps its saved status
- **WHEN** a saved statement's content is parsed successfully, whether or not it yields any transactions
- **THEN** the Uploaded Files table continues to show its normal "Saved" status
