## MODIFIED Requirements

### Requirement: Select and delete statements
The system SHALL let the user select one or more statements, via individual checkboxes or a select-all checkbox, and delete the selected statements. Deleting a statement SHALL also delete any transactions extracted from it.

#### Scenario: Select all statements
- **WHEN** the user checks the select-all checkbox
- **THEN** every statement row's checkbox becomes checked

#### Scenario: Delete selected statements
- **WHEN** the user has one or more statements selected and confirms deletion
- **THEN** each selected statement's database record and stored file bytes are removed
- **AND** the deleted statements no longer appear in the Uploaded Files table

#### Scenario: Deleting a statement removes its transactions
- **WHEN** a statement that has extracted transactions is deleted
- **THEN** those transactions are also removed and no longer appear in the Review screen's transaction list
