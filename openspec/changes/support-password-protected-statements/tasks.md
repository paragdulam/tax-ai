## 1. Database migration

- [x] 1.1 Add migration version 12 to `src-tauri/src/lib.rs`: `ALTER TABLE statements ADD COLUMN password_encrypted TEXT;`, `ALTER TABLE statements ADD COLUMN password_iv TEXT;`, and `CREATE TABLE IF NOT EXISTS app_secrets (id TEXT PRIMARY KEY, key_base64 TEXT NOT NULL, created_at TEXT NOT NULL);`
- [x] 1.2 Verify against an existing local `taxai.db` (with pre-existing statements/transactions) that the migration applies cleanly, adds the new columns/table, and leaves every existing row's data untouched

## 2. Local master key and password encryption helpers

- [x] 2.1 Add a helper to get-or-create the `app_secrets` master key: on first use, generate a random 256-bit AES-GCM key via `crypto.getRandomValues`/`crypto.subtle.generateKey`, store it base64-encoded in `app_secrets`; on later use, read and reuse it — `getOrCreateMasterKey` in `src/main.js`
- [x] 2.2 Add `encryptStoredPassword(password)` / `decryptStoredPassword(password_encrypted, password_iv)` helpers using `SubtleCrypto` AES-GCM with a random 96-bit IV per encryption
- [x] 2.3 Add `saveStatementPassword(statementId, password)` (encrypts and writes `password_encrypted`/`password_iv`, sets status to `saved`). **Deviation from plan**: no separate `clearStatementPassword` — deleting a statement already removes `password_encrypted`/`password_iv` since they're columns on the `statements` row (see task 9.1)

## 3. Excel decryption (new `src/statement-crypto.js` module)

- [x] 3.1 Add a minimal CFB (compound file / OLE2) reader (header + FAT/MiniFAT + directory parsing) exposing a `getEntry(name)` accessor (read + same-size patch), good enough to pull `EncryptionInfo` + `EncryptedPackage` (`.xlsx`) or the raw `Workbook` stream (`.xls`) out of the container — `src/statement-crypto.js`
- [x] 3.2 Parse the `EncryptionInfo` stream header to distinguish Agile vs. Standard encryption and read its key-derivation parameters (salt, spin count / hash algorithm, key bits); for Standard, restrict to its AES algorithm IDs (0x660E/0x660F/0x6610)
- [x] 3.3 Implement Agile decryption: iterated SHA-512 key derivation via `SubtleCrypto.digest` (per spin count) combined with the three fixed block-key constants, AES-CBC decrypt with per-segment derived IVs, reassembling the plaintext OOXML zip. **Deviation from plan**: AES itself is hand-implemented from scratch (FIPS-197, verified against official test vectors), not via `SubtleCrypto.decrypt` — empirically confirmed `SubtleCrypto`'s AES-CBC unconditionally removes PKCS#7 padding and throws on Office's raw non-padded ciphertext.
- [x] 3.4 Implement Standard decryption: SHA-1 50,000-round + 0x36/0x5C padding key derivation, AES-ECB decrypt (via the from-scratch AES block cipher, since Web Crypto has no ECB mode at all), producing the plaintext OOXML zip
- [x] 3.5 Implement legacy `.xls` RC4 CryptoAPI decryption: parse the `FilePass` BIFF record (salt, key size, encrypted verifier) to verify the password, hand-written RC4 keystream generator (Web Crypto has no RC4) re-keyed every 1024 bytes via SHA-1-based derivation, and a BIFF-record walk that decrypts most record bodies while passing `BOF`/`FilePass`/`UsrExcl`/`FileLock`/`InterfaceHdr`/`RRDInfo`/`RRDHead` through unencrypted and leaving `BoundSheet8`'s first 4 bytes unencrypted, reassembling a plain `Workbook` stream. Empirically confirmed (via a synthetic probe run against the real bundled SheetJS) that leaving a zeroed `FilePass` record in place afterward does not block `XLSX.read()`.
- [x] 3.6 Wire all three paths so their plaintext output is handed to the existing, unmodified `XLSX.read()`
- [x] 3.7 Unit tests (`src/statement-crypto.test.mjs`, run via `node src/statement-crypto.test.mjs`): AES-128/192/256 against FIPS-197 vectors; RC4 against published vectors; all three key-derivation schemes against `msoffcrypto-tool`'s doctest vectors. Agile and Standard are each verified end-to-end (byte-identical) against genuinely-encrypted `.xlsx` fixtures under `src/test-fixtures/` (Standard's built by hand from the same verified math, independently round-tripped through `msoffcrypto-tool` before being trusted). Legacy `.xls` has no genuine full-file fixture (no LibreOffice/MS Office available) but its record-walk logic is verified via a synthetic encrypt/decrypt round trip. This process caught and fixed 3 real bugs (two byte-offset errors, one missing destination-offset in a buffer write) before they could ship.

## 4. Shared decrypted-content accessor

- [x] 4.1 Add `getStatementFileBytes(statement, password)` that: for unprotected files, returns the original bytes unchanged; for protected Excel files, runs the Excel decryption path (group 3, via `decryptExcelBuffer`) and returns already-decrypted bytes; for protected PDFs, returns the original bytes plus the verified password (decryption happens inside `pdfjsLib.getDocument({ data, password })` itself)
- [x] 4.2 `IncorrectPasswordError`/`UnsupportedEncryptionError` are defined in `statement-crypto.js` and reused; `PasswordRequiredError` is defined in `main.js` (app/UX-level "no password supplied" signal, thrown when a protected file's probe succeeds detecting encryption but no password was passed in)
- [x] 4.3 Detect "this file needs a password" by attempting the normal parse first and classifying the resulting error (`/password-protected/i` message for Excel via `XLSX.read`; `PasswordException` + `PasswordResponses` codes for PDF via `pdfjsLib`), per design.md Decision 1
- [x] 4.4 Replaced the direct `XLSX.read`/`pdfjsLib.getDocument` calls in `extractExcelTransactions` (via its caller)/`extractPdfTransactions`, `getStatementTextSections`, and `renderStatementPreview` with calls through `getStatementFileBytes`, passing the statement's stored (decrypted) password where available

## 5. Password prompt UI

- [x] 5.1 Add a password-prompt modal (input + submit + cancel) in `index.html`/`main.js` (`promptForPassword`), reusable for both the upload-time flow and the "Unlock" action
- [x] 5.2 Wire retry-on-wrong-password: on `IncorrectPasswordError`, show an inline error in the modal and let the user try again without closing it
- [x] 5.3 Add a `password_required` status badge to `statementRowMarkup` (distinct styling from "Saved" and "Failed to parse"/"Failed")
- [x] 5.4 Add an "Unlock" row action, shown only when `status === 'password_required'`, that opens the password prompt for that statement

## 6. Upload flow integration

- [x] 6.1 In `saveStatementFile`, before the `INSERT INTO statements` call, run the encryption probe (task 4.3) on Excel/PDF files; if protected, show the password prompt (task 5.1) before proceeding
- [x] 6.2 On successful password entry during upload: decrypt via `getStatementFileBytes`, proceed with the existing insert + `saveStatementPassword` + `extractTransactionsForStatement` flow, status `saved`
- [x] 6.3 On cancel or exhausted retries during upload: still insert the statement row, with status `password_required` and zero extracted transactions, matching the existing "always save the upload" convention
- [x] 6.4 CSV and unprotected Excel/PDF files continue through the existing path unchanged

## 7. Unlock flow integration

- [x] 7.1 Wire the "Unlock" action (task 5.4) to: prompt for the password, validate it via `getStatementFileBytes`, and on success call `saveStatementPassword` followed by `extractTransactionsForStatement` (updating status to `saved`) — `unlockStatement` in `src/main.js`
- [x] 7.2 On an incorrect password during unlock, leave the statement's status as `password_required` and show the inline retry error (task 5.2)

## 8. Re-extraction and viewer reuse of the stored password

- [x] 8.1 Update `extractTransactionsForStatement` (and any re-extraction/backfill call sites) to look up and decrypt the statement's stored password before parsing, with no prompt shown
- [x] 8.2 Update `openStatementViewer`/`renderStatementPreview` to look up and decrypt the statement's stored password automatically for password-protected statements, with no prompt shown; if no valid password is stored, show a message pointing the user at the row's "Unlock" action instead of failing silently

## 9. Deletion cleanup

- [x] 9.1 No code change needed: `password_encrypted`/`password_iv` are columns on the `statements` row, so the existing `DELETE FROM statements WHERE id IN (...)` in `deleteSelectedStatements` already removes them. The shared `app_secrets` master key is intentionally not per-statement, so nothing else to clean up.

## 10. Manual verification

- [x] 10.0 Verified automatically: `cargo check` (Rust compiles), `npm run build:css` (Tailwind build), `node --check src/main.js` (syntax), and `node src/statement-crypto.test.mjs` (10/10 crypto tests pass). Ran the real app (`npm run dev`) against the actual local `taxai.db` (7 pre-existing statements, 1806 transactions): it started cleanly with no JS/Rust errors, migration 12 applied for real (`password_encrypted`/`password_iv` columns and `app_secrets` table now present), and the existing statement list plus its account-metadata backfill (which exercises the refactored `getStatementTextSections`/`getStatementFileBytes` on real unprotected files) both completed without error. All pre-existing data confirmed byte-identical afterward.
- [ ] 10.1 Upload an Agile-encrypted `.xlsx`, a Standard-encrypted `.xlsx`, an RC4-encrypted `.xls`, and a password-protected PDF; confirm each prompts, saves, and extracts transactions correctly. **Not run live** - driving the native Tauri window's interactive UI (password modal, upload dialog) is outside this session's tool access (no native-window automation available, only DOM/browser tooling). Ready-made fixtures for this, all with password `Password1234_`: `src/test-fixtures/agile_encrypted.xlsx`, `src/test-fixtures/standard_encrypted.xlsx`, `src/test-fixtures/password_protected.pdf` (no legacy `.xls` fixture - see design.md's testing note)
- [ ] 10.2 Cancel the password prompt on upload; confirm the file is saved with "Password required" and zero transactions, then use "Unlock" to complete it. **Not run live**, same reason as 10.1
- [ ] 10.3 Restart the app and confirm previously-unlocked password-protected statements re-extract and open in the viewer with no re-prompt. **Not run live**
- [ ] 10.4 Delete an unlocked password-protected statement; confirm its transactions and stored password are gone. **Not run live**
- [x] 10.5 Pre-existing statements (unprotected, saved before this change) confirmed unaffected via the real app run in 10.0: listing, the metadata-detection/extraction backfill, and row counts all matched before/after with no errors
