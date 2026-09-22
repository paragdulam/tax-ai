## Why

Password-protected Excel (`.xlsx`/`.xls`) and PDF statements are common for bank and credit card downloads, but today they silently fail: the file saves with a "Failed to parse" status, yields zero transactions, and the in-app viewer shows an error, with no way for the user to unlock it. Users need a way to supply the password so these statements work the same as unprotected ones.

## What Changes

- When a dropped/selected file turns out to be password-protected, the user is prompted for its password immediately during upload, before saving; the file is decrypted, saved, and its transactions are extracted right away, same as an unprotected file.
- If the user cancels the password prompt or repeatedly enters the wrong password, the file is still saved (so the user doesn't lose the upload) with a new "Password required" status and zero extracted transactions; a "Unlock" action on that row lets the user supply the password later.
- The password entered for a statement is stored locally, encrypted at rest with an app-managed local key (never sent over the network), so the app does not need to re-prompt on subsequent extraction runs, viewer opens, or app restarts.
- The statement viewer (preview modal) decrypts on the fly using the stored password when opening a password-protected file, instead of failing.
- Adds decryption support for modern Office Open XML password protection (`.xlsx`, both "Standard"/RC4 and "Agile"/AES schemes) and legacy binary `.xls` (RC4 CryptoAPI) protection, implemented in-app via the Web Crypto API, since the bundled Excel library (community-edition SheetJS) cannot decrypt either format on its own.
- Adds password support for encrypted PDFs using the already-bundled PDF library's native password handling (owner or user password).
- **BREAKING**: none — existing unprotected files and previously-saved "Failed to parse" statements are unaffected; a stored password column is added additively via a database migration, existing statement rows are left untouched.

## Capabilities

### Modified Capabilities
- `statement-management`: adds password capture/storage, a "Password required" status, an "Unlock" action, and password-aware statement viewing for encrypted Excel/PDF statements.
- `transaction-review`: extraction for password-protected Excel/PDF statements now uses the stored password to decrypt before parsing, instead of always failing.

## Impact

- **Database**: new additive SQLite migration (next version after 11) adding an encrypted-password column (plus its nonce/salt) to the `statements` table, and a `password_required` status value; no existing rows are modified or dropped.
- **Frontend (`src/main.js`)**: upload flow (`saveStatementFile`/`saveStatementFiles`), extraction flow (`extractTransactionsForStatement`), and the statement viewer (`renderStatementPreview`/`openStatementViewer`) all gain password-aware paths; new password-prompt modal and "Unlock" row action UI; new local encryption/decryption helpers (Web Crypto) for the stored password and for decrypting `.xlsx`/`.xls` content before handing it to SheetJS.
- **Dependencies**: no new npm/crates dependencies required — decryption is implemented against the Web Crypto API already available in the Tauri webview; PDF password handling uses the existing bundled `pdfjsLib`.
- **Status badges**: statement list gains a new "Password required" badge distinct from the existing "Failed to parse"/"Failed" badges.
