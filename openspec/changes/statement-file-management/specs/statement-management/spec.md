## Purpose

Lets users bring their Excel, CSV, and PDF tax statements into the app and keep them stored locally, with no network upload, so the data is available for future tax-processing features.

## ADDED Requirements

### Requirement: Accepted file types and size
The system SHALL accept only Excel (`.xlsx`, `.xls`), CSV (`.csv`), and PDF (`.pdf`) files for statement upload, up to 50MB each, whether provided via drag-and-drop or the file browser.

#### Scenario: Supported file dropped or selected
- **WHEN** a user drags a `.xlsx`, `.xls`, `.csv`, or `.pdf` file onto the upload area, or selects one via "Browse Files"
- **THEN** the file is accepted and saving begins

#### Scenario: Unsupported file type rejected
- **WHEN** a user drags or selects a file that is not `.xlsx`, `.xls`, `.csv`, or `.pdf`
- **THEN** the file is rejected, no record is saved, and the user sees an error indicating the file type is unsupported

#### Scenario: Oversized file rejected
- **WHEN** a user drags or selects a supported file type larger than 50MB
- **THEN** the file is rejected, no record is saved, and the user sees an error indicating the file is too large

### Requirement: Local-only persistence
The system SHALL save accepted statement files entirely on the local machine (file bytes plus a database record) and SHALL NOT transmit them over the network.

#### Scenario: Statement saved locally
- **WHEN** an accepted file finishes saving
- **THEN** its bytes are stored in local app storage and a corresponding record (filename, file type, size, upload date, status) is inserted into the local database
- **AND** no network request is made to transmit the file

### Requirement: Statement listing reflects saved statements
The system SHALL display the Uploaded Files table using the current set of statements saved in the local database, not fixed sample data.

#### Scenario: Newly saved statement appears in the list
- **WHEN** a statement finishes saving successfully
- **THEN** it appears in the Uploaded Files table without requiring an app restart

#### Scenario: Statements persist across restarts
- **WHEN** the user closes and reopens the app
- **THEN** previously saved statements still appear in the Uploaded Files table

### Requirement: Empty state
The system SHALL show an empty state in place of the Uploaded Files table when no statements have been saved yet.

#### Scenario: No statements saved
- **WHEN** the Statements screen is opened and zero statements exist in the local database
- **THEN** the Uploaded Files table is replaced with an empty state indicating no statements have been uploaded yet

### Requirement: Select and delete statements
The system SHALL let the user select one or more statements, via individual checkboxes or a select-all checkbox, and delete the selected statements.

#### Scenario: Select all statements
- **WHEN** the user checks the select-all checkbox
- **THEN** every statement row's checkbox becomes checked

#### Scenario: Delete selected statements
- **WHEN** the user has one or more statements selected and confirms deletion
- **THEN** each selected statement's database record and stored file bytes are removed
- **AND** the deleted statements no longer appear in the Uploaded Files table

### Requirement: Accurate statement count display
The system SHALL display the count in the Uploaded Files panel header and the pagination footer as the true, current number of saved statements.

#### Scenario: Count reflects saved statements
- **WHEN** the Statements screen is showing N saved statements
- **THEN** the panel header count and the pagination footer both show N (or the correct current-page range and total N when paginated)

#### Scenario: Count updates after a change
- **WHEN** a statement is saved or deleted
- **THEN** the panel header count and pagination footer update to reflect the new total
