## Context

Today content decryption is not attempted anywhere: `extractExcelTransactions`/`extractPdfTransactions` (parsing for transactions), `getStatementTextSections` (bank/account-type detection), and `renderStatementPreview` (the viewer modal) all call `window.XLSX.read(...)` or `pdfjsLib.getDocument({ data })` directly on the raw saved bytes with no password. All three sit downstream of `content_base64`, the statement's original file bytes stored as-is in the `statements` SQLite table (`src-tauri/src/lib.rs` migration v1; no separate app-data directory exists despite an earlier proposal's assumption otherwise - see `openspec/changes/statement-file-management/proposal.md` - the implementation evolved to store bytes directly in SQLite).

The bundled Excel library, `src/vendor/xlsx.full.min.js` (SheetJS community edition, exposed as `window.XLSX`), already detects encrypted `.xlsx`/`.xls` files correctly and throws `Error("File is password-protected")` (or the ECMA-376-Extensible variant) - it just has no decrypt implementation wired in (`decrypt_agile`/`decrypt_std76` are referenced behind `typeof x !== "undefined"` guards that are never satisfied in this build). It does, however, expose its compound-file (OLE2/CFB) container parser as `window.XLSX.CFB` (`.read()`/`.find()`), which both `.xlsx`'s `EncryptionInfo`/`EncryptedPackage` streams and legacy `.xls`'s in-stream `FilePass` encryption live inside.

The bundled PDF library, `src/vendor/pdfjs/pdf.mjs` (pdf.js), already supports decrypting password-protected PDFs natively - `pdfjsLib.getDocument({ data, password })` decrypts before parsing, and calling it without a password on a protected file rejects with a `PasswordException` whose `code` distinguishes "needs a password" from "wrong password".

See proposal.md for motivation; see the delta specs for required behavior.

## Goals / Non-Goals

**Goals:**
- Decrypt password-protected `.xlsx` (Agile/AES and Standard/RC4-CryptoAPI OOXML encryption) and legacy `.xls` (RC4 CryptoAPI) files entirely in-app, with no new npm or Cargo dependency.
- Decrypt password-protected PDFs using pdf.js's existing, already-bundled support.
- Store a successfully-used password locally, encrypted at rest, reused automatically by extraction, metadata detection, and the viewer.
- Keep the change additive at the data layer: no existing `statements`/`transactions` rows are altered or dropped by the migration.

**Non-Goals:**
- OS-level secret storage (keychain/Credential Manager) for the stored password. That would need a new native dependency (e.g. a `keyring` crate or `tauri-plugin-stronghold`); this design uses an app-generated local key instead (see Decisions). Revisit if the threat model changes.
- Decrypting the pre-1997 Excel 95/5.0 "XOR obfuscation" scheme (legacy `.xls`, `FilePass` encryption type 0), a distinct and now essentially extinct format from the RC4 CryptoAPI scheme real-world `.xls` exports use. Files in that scheme keep today's "Failed to parse" behavior.
- Decrypting the (very rare, effectively unseen in real `.xlsx` files) RC4-keyed variant of ECMA-376 "Standard" encryption - only its far more common AES-keyed variant is implemented. Files using it keep today's "Failed to parse" behavior.
- Any change to how unprotected files are handled - this design only adds new paths that trigger when content is detected as encrypted.

## Decisions

### 1. Detect encryption by attempting the normal parse first, not by hand-parsing containers up front
For Excel, call `XLSX.read()` (or `pdfjsLib.getDocument()` for PDF) exactly as today; if it throws/rejects with the library's own "password-protected" error (`Error` message matching `/password-protected/i` for XLSX; `PasswordException` for PDF), treat the file as encrypted and enter the password flow. Only on that specific error - other parse failures still fall back to today's "Failed to parse" behavior.
- **Why**: SheetJS and pdf.js already correctly identify their own encrypted formats; re-detecting via manual CFB inspection would duplicate that logic and risk drifting from it.
- **Alternative considered**: Pre-parse the CFB container ourselves to check for `/EncryptionInfo` before ever calling `XLSX.read()`. Rejected - `.xls`'s in-stream `FilePass` encryption doesn't have a separate stream to look for, so this still needs a try-then-classify fallback for that case anyway.

### 2. Implement OOXML/legacy Excel decryption with a small hand-rolled CFB reader + Web Crypto, not a new library
`window.XLSX.CFB`'s parsing API is internal/undocumented in the minified bundle, so rather than reverse-engineer it, add a small self-contained CFB (compound file / OLE2, [MS-CFB]) reader good enough to locate named streams (`EncryptionInfo`, `EncryptedPackage`, `Workbook`) - the same approach taken by every reference implementation surveyed (e.g. Python's `olefile` + `msoffcrypto-tool`). Algorithm details below are verified against `msoffcrypto-tool`'s implementation (a widely-used, spec-conformant reference), including its doctest key-derivation vectors, which are ported into this project's own unit tests:
- **Agile encryption** (`.xlsx`, Excel 2010+ default): iterated SHA-512 hashing of password+salt (`SubtleCrypto.digest`, looped per the encryption descriptor's spin count, typically 100,000) to derive an intermediate hash, combined with one of three fixed 8-byte "block keys" to derive purpose-specific keys (verifier-input, verifier-hash, key-value), then AES-CBC-decrypt (`SubtleCrypto.decrypt`) the 4096-byte package segments, each with its own derived IV.
- **Standard encryption** (`.xlsx`, the ECMA-376 "binary EncryptionInfo" mode, still `.xlsx`-only): key derived via 50,000 rounds of SHA-1 over password+salt, then an 0x36/0x5C HMAC-style padding step (`SubtleCrypto.digest`), decrypted with **AES in ECB mode** - which `SubtleCrypto` does not expose directly (by design). Worked around by calling `SubtleCrypto`'s AES-CBC decrypt independently per 16-byte block with a zero IV, which is mathematically identical to ECB for a single block. Scoped to the AES algorithm IDs (128/192/256-bit); the theoretical RC4-keyed variant of Standard mode is not implemented (see Non-Goals) since it does not occur in modern `.xlsx` files.
- **Legacy `.xls` (binary BIFF8) RC4 CryptoAPI**: this is not a flat stream decrypt. The `Workbook` CFB stream is a sequence of BIFF records; a `FilePass` record marks the workbook encrypted and carries the RC4 CryptoAPI header (salt, key size, encrypted verifier). Decryption means walking every record, decrypting most record bodies (RC4-CryptoAPI-keyed, SHA-1-based derivation, re-keyed every 1024 bytes) while passing several record types through unencrypted verbatim (`BOF`, `FilePass`, `UsrExcl`, `FileLock`, `InterfaceHdr`, `RRDInfo`, `RRDHead`), and leaving the `BoundSheet8` record's first 4 bytes (`lbPlyPos`) unencrypted while decrypting the rest - then reassembling a plain BIFF8 `Workbook` stream byte-for-byte. RC4 itself has no Web Crypto primitive, so it is hand-implemented (~20 lines: standard KSA/PRGA). The pre-1997 XOR-obfuscation scheme (`wEncryptionType == 0`) is explicitly out of scope (see Non-Goals).
- No MD5 is needed anywhere in this design - every scheme above derives its key using SHA-1 or SHA-512, both available via `SubtleCrypto.digest`.
- Feed the resulting plaintext bytes (a normal OOXML zip for `.xlsx`, or a reassembled plain BIFF8 `Workbook` stream for `.xls`) back into the existing, unmodified `XLSX.read()`.
- Ship this as a new standalone module, `src/statement-crypto.js`, rather than growing `main.js` further - it has no DOM/Tauri dependencies, which also makes it runnable/testable directly under Node.
- **Why**: avoids adding SheetJS Pro (paid) or any other new dependency; the algorithms are fixed, publicly-documented (MS-OFFCRYPTO) constructions, not something that benefits from an external implementation.
- **Alternative considered**: Move decryption to Rust (new crate) and expose a Tauri command. Rejected for this change - no suitable, well-maintained crate was identified, and doing it in Rust would mean shipping the file bytes and password across the IPC boundary for no real benefit, since the JS side already owns all other parsing.
- **Testing note**: Agile and Standard decryption are each verified end-to-end (`src/statement-crypto.test.mjs`) against genuinely-encrypted `.xlsx` fixtures - decrypting back to byte-identical plaintext - using Python's `msoffcrypto-tool` (which can write Agile natively) and a hand-built-but-genuine Standard-mode container (constructed with the same verified key-derivation math, using `msoffcrypto-tool`'s own CFB container writer, and independently round-tripped through `msoffcrypto-tool`'s own decrypt path before being trusted as a fixture). This process caught and fixed two real byte-offset bugs in the initial port (both in EncryptionInfo header framing). Legacy `.xls` RC4-CryptoAPI has no genuine end-to-end fixture (no LibreOffice/MS Office available to produce one), but its BIFF8 record-walk logic is verified via a synthetic round-trip test (construct known plaintext, encrypt with the same independently-vetted RC4 primitives, confirm `decryptBiff8Workbook` recovers it exactly) - this process caught and fixed two further bugs (a FilePass-header field offset, and a missing destination offset that silently corrupted output). All three schemes' key derivation is additionally checked against `msoffcrypto-tool`'s published doctest vectors. The residual gap versus Agile/PDF is a genuine full-file fixture for `.xls` specifically.

### 3. One shared decrypted-content accessor, not four separate call sites
Today, three separate call sites independently call `XLSX.read()`/`getDocument()` on raw bytes: `extractExcelTransactions`/`extractPdfTransactions` (via `extractTransactionsForStatement`), `getStatementTextSections` (metadata detection), and `renderStatementPreview` (viewer). Add one function, e.g. `getStatementFileBytes(statement, password)`, that returns decrypted bytes (or the original bytes untouched, for unprotected files) and throws typed errors (`PasswordRequiredError`, `IncorrectPasswordError`) the callers can branch on. Route all four use sites (including the new pre-save detection step) through it instead of open-coding decryption in each.
- **Why**: password/encryption handling must stay consistent across extraction, detection, preview, and upload-time probing; a single accessor avoids the four call sites drifting.

### 4. Prompt before saving; on cancel/failure, save anyway with "Password required"
On drop/select, read the file's bytes and run them through the encryption probe (goal 1) before the existing `INSERT INTO statements` runs. If protected, show the password prompt (with retry-on-wrong-password); on success, proceed through the existing save+extract path using the now-decrypted bytes. On cancel or exhausted retries, still insert the statement row (status `password_required`) so the upload isn't lost, matching the existing "always save, reflect failure via status" pattern already used for `failed_to_parse`.
- **Why**: matches the explicit answer to prompt immediately, while reusing the app's existing "never lose an upload" convention rather than introducing a new one.

### 5. Store the password encrypted with an app-generated local key, kept in the same SQLite database
Add a single-row `app_secrets` table holding a randomly-generated 256-bit AES-GCM master key (`crypto.getRandomValues`, generated once on first use). Each statement's password is encrypted with that master key (`SubtleCrypto.encrypt`, AES-GCM, random 96-bit IV per row) and stored as two new `statements` columns: `password_encrypted` (base64 ciphertext+tag) and `password_iv` (base64 IV). Decrypt on demand wherever a password is needed.
- **Why**: satisfies "encrypted at rest" (a plain DB dump/export doesn't show plaintext passwords) without a new native dependency, consistent with the rest of the app's local-only, dependency-light approach.
- **Trade-off accepted**: since the master key lives in the same local SQLite file as the encrypted passwords, this does not defend against an attacker with full read access to the app's local data directory - only against casual inspection, accidental sharing of a DB export, etc. True OS-keychain-backed protection is a Non-Goal here (see above); call this out to the user as a known limitation, not a silent gap.

### 6. Additive migration, version 12
Follow the existing `Migration` list pattern in `src-tauri/src/lib.rs` (currently ends at version 11):
```
ALTER TABLE statements ADD COLUMN password_encrypted TEXT;
ALTER TABLE statements ADD COLUMN password_iv TEXT;
CREATE TABLE IF NOT EXISTS app_secrets (
    id TEXT PRIMARY KEY,
    key_base64 TEXT NOT NULL,
    created_at TEXT NOT NULL
);
```
No `UPDATE`/`DROP` on existing rows; new columns default to `NULL`, which the code treats as "no password stored" for every pre-existing row (all currently unprotected, so behavior for them is unchanged). The new `password_required` status value needs no schema change since `status` is already a free-text column.
- **Why**: mirrors every prior migration in this file exactly (e.g. v9's `display_name`, v6's `currency`) - additive `ALTER TABLE`/`CREATE TABLE IF NOT EXISTS` only, verified safe under `tauri-plugin-sql`'s migration runner which applies each version once and tracks the applied version per database file.

## Risks / Trade-offs

- **[Risk]** Hand-rolled Agile/Standard/legacy-RC4 decryption (Decision 2) is intricate and easy to get subtly wrong (wrong iteration count, wrong block-key derivation, wrong BIFF8 record handling) → **Mitigation**: key-derivation math is unit-tested against independently-computed reference vectors for all three schemes; Agile is additionally verified end-to-end against a genuinely-encrypted fixture. Standard and legacy-`.xls` lack an end-to-end genuine-file test in this environment (no LibreOffice/MS Office available to produce one) - flagged as residual risk, and the "unsupported/undetected variant" path falls back to today's "Failed to parse" rather than crashing, so a bug here degrades to the pre-existing behavior instead of breaking the app.
- **[Risk]** Local-key password storage (Decision 5) is weaker than OS-keychain storage → **Mitigation**: documented as a known, explicit trade-off (see Decision 5); revisit with a keychain-backed store if/when the app takes on a native-dependency budget.
- **[Risk]** Consolidating four call sites into one accessor (Decision 3) touches every existing statement-content code path → **Mitigation**: the accessor's fallback behavior for unprotected files is byte-identical passthrough, so existing unprotected-file behavior is a regression risk only if the accessor itself has bugs; cover with the same file fixtures used for encrypted-file testing plus the existing unprotected ones.

## Migration Plan

Ship the version-12 migration (Decision 6) and the new code paths together; `tauri-plugin-sql` applies it automatically on next app launch, in order, with no manual step. No rollback path is provided (consistent with every prior migration in this project) - a rollback would mean shipping a previous app version, which does not read the new columns and simply ignores them.
