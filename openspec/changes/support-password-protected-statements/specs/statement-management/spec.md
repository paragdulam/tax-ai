## ADDED Requirements

### Requirement: Password-protected file upload prompts for a password
The system SHALL detect when a dropped/selected Excel (`.xlsx`, `.xls`) or PDF file is password-protected and prompt the user for its password before the file is saved.

#### Scenario: Password-protected file detected during upload
- **WHEN** a user drags or selects a `.xlsx`, `.xls`, or `.pdf` file that is password-protected
- **THEN** a password prompt is shown before the file is saved

#### Scenario: Correct password entered
- **WHEN** the user enters the correct password in the prompt
- **THEN** the file is decrypted, saved, and its transactions are extracted, the same as an unprotected file

#### Scenario: Incorrect password entered
- **WHEN** the user enters an incorrect password in the prompt
- **THEN** an error is shown and the user can retry entering the password without losing the upload

#### Scenario: Password prompt cancelled or repeatedly incorrect
- **WHEN** the user cancels the password prompt, or does not supply a correct password after retrying
- **THEN** the file is still saved with a "Password required" status and contributes zero transactions

### Requirement: Password required status and manual unlock
The system SHALL show a distinct "Password required" status for a saved statement whose password was not supplied or was incorrect, and SHALL let the user supply the password later via an "Unlock" action on that statement's row.

#### Scenario: Statement shown with Password required status
- **WHEN** a saved statement has no valid stored password
- **THEN** its row in the Uploaded Files table shows a "Password required" status distinct from "Saved" and "Failed to parse"

#### Scenario: Unlocking a statement
- **WHEN** the user chooses "Unlock" on a "Password required" statement and enters the correct password
- **THEN** the statement is decrypted, its transactions are extracted, and its status becomes "Saved"

#### Scenario: Unlocking with the wrong password
- **WHEN** the user chooses "Unlock" on a "Password required" statement and enters an incorrect password
- **THEN** an error is shown and the statement's status remains "Password required"

### Requirement: Stored password reused for local access
The system SHALL store, locally and encrypted at rest, the password successfully used to unlock a statement, and SHALL use it automatically for later transaction extraction and for opening the statement viewer, without re-prompting the user.

#### Scenario: Re-extraction reuses the stored password
- **WHEN** a previously-unlocked statement's transactions are re-extracted (e.g. after an app restart)
- **THEN** the stored password is used automatically to decrypt its content, with no password prompt shown

#### Scenario: Viewer reuses the stored password
- **WHEN** the user opens the statement viewer for a previously-unlocked password-protected statement
- **THEN** its content is decrypted automatically using the stored password and displayed, with no password prompt shown

## MODIFIED Requirements

### Requirement: Local-only persistence
The system SHALL save accepted statement files entirely on the local machine (file bytes plus a database record) and SHALL NOT transmit them over the network. For a password-protected statement, the password SHALL also be stored locally, encrypted at rest, and SHALL NOT be transmitted over the network.

#### Scenario: Statement saved locally
- **WHEN** an accepted file finishes saving
- **THEN** its bytes are stored in local app storage and a corresponding record (filename, file type, size, upload date, status) is inserted into the local database
- **AND** no network request is made to transmit the file

#### Scenario: Password stored locally and encrypted
- **WHEN** a password-protected statement is successfully unlocked
- **THEN** its password is stored encrypted at rest in local app storage
- **AND** no network request is made to transmit the password

### Requirement: Select and delete statements
The system SHALL let the user select one or more statements, via individual checkboxes or a select-all checkbox, and delete the selected statements. Deleting a statement SHALL also delete any transactions extracted from it and any password stored for it.

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

#### Scenario: Deleting a statement removes its stored password
- **WHEN** a statement that has a stored password is deleted
- **THEN** its stored encrypted password is also removed from local storage
