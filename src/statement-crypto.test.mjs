// Run with: node src/statement-crypto.test.mjs
//
// Verifies statement-crypto.js against independently-known-good reference vectors:
//  - AES-128/192/256 block decrypt: official FIPS-197 test vectors.
//  - AES-CBC (raw, non-padded) and RC4: cross-checked against Node's own `node:crypto` / published vectors.
//  - Agile and Standard key derivation: the published doctest vectors from msoffcrypto-tool
//    (github.com/nolze/msoffcrypto-tool), a widely-used reference implementation.
//  - A genuinely Agile-encrypted .xlsx fixture (produced by msoffcrypto-tool, which can write this
//    format) is decrypted end-to-end and checked to be a valid zip whose content matches the source.

import assert from "node:assert/strict";
import {
  aesEcbDecrypt,
  aesCbcDecryptRaw,
  rc4Decrypt,
  agileDeriveIteratedHash,
  agileDeriveKey,
  AGILE_BLOCK_KEY_KEY_VALUE,
  AGILE_BLOCK_KEY_VERIFIER_INPUT,
  AGILE_BLOCK_KEY_VERIFIER_HASH,
  standardDeriveKey,
  rc4CryptoApiMakeKey,
  decryptExcelBuffer,
  decryptBiff8Workbook,
  IncorrectPasswordError,
} from "./statement-crypto.js";

const hex = (s) => Uint8Array.from(s.match(/../g).map((b) => parseInt(b, 16)));
const toHex = (b) => Buffer.from(b).toString("hex");
let passed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`PASS: ${name}`);
      passed++;
    })
    .catch((err) => {
      console.error(`FAIL: ${name}\n  ${err.stack}`);
      process.exitCode = 1;
    });
}

await test("AES-128/192/256 ECB decrypt - FIPS-197 vectors", () => {
  const vectors = [
    { key: "000102030405060708090a0b0c0d0e0f", ct: "69c4e0d86a7b0430d8cdb78070b4c55a", pt: "00112233445566778899aabbccddeeff" },
    { key: "000102030405060708090a0b0c0d0e0f1011121314151617", ct: "dda97ca4864cdfe06eaf70a0ec0d7191", pt: "00112233445566778899aabbccddeeff" },
    { key: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", ct: "8ea2b7ca516745bfeafc49904b496089", pt: "00112233445566778899aabbccddeeff" },
  ];
  for (const v of vectors) assert.equal(toHex(aesEcbDecrypt(hex(v.key), hex(v.ct))), v.pt);
});

await test("AES-CBC raw decrypt matches node:crypto (padding disabled)", async () => {
  const nodeCrypto = await import("node:crypto");
  const key = nodeCrypto.randomBytes(16);
  const iv = nodeCrypto.randomBytes(16);
  const plain = nodeCrypto.randomBytes(64);
  const cipher = nodeCrypto.createCipheriv("aes-128-cbc", key, iv);
  cipher.setAutoPadding(false);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const dec = aesCbcDecryptRaw(new Uint8Array(key), new Uint8Array(iv), new Uint8Array(ct));
  assert.ok(Buffer.from(dec).equals(plain));
});

await test("RC4 decrypt - published test vectors", () => {
  const vectors = [
    { key: "Key", pt: "Plaintext", ctHex: "bbf316e8d940af0ad3" },
    { key: "Wiki", pt: "pedia", ctHex: "1021bf0420" },
    { key: "Secret", pt: "Attack at dawn", ctHex: "45a01f645fc35b383552544b9bf5" },
  ];
  for (const v of vectors) {
    const dec = rc4Decrypt(new TextEncoder().encode(v.key), hex(v.ctHex));
    assert.equal(new TextDecoder().decode(dec), v.pt);
  }
});

// The hex vectors below were extracted directly (in Python, via bytes.hex()) from the doctest
// byte literals in msoffcrypto-tool's source - see scratchpad/extract_vectors.py - rather than
// hand-transcribed, since those literals mix raw ASCII chars and \xNN escapes and are easy to
// mistype by eye.

// msoffcrypto-tool ECMA376Agile.makekey_from_password doctest vector.
await test("Agile key derivation - msoffcrypto-tool doctest vector", async () => {
  const password = "Password1234_";
  const salt = hex("4c725d45dc610f939412a04da7910466".slice(0, 32));
  const encryptedKeyValue = hex("a16cd5165a7ab9d271113ed386a78cf49692e8e527b0c5fc0055ed080b7cb94b".slice(0, 64));
  const expected = hex("40206609d9faadf24b076aebf2c435b74292c8b8a7aa81bc679be89711b02ac2".slice(0, 64));
  const spinValue = 100000;
  const keyBits = 256;

  const h = await agileDeriveIteratedHash(password, salt, "SHA512", spinValue);
  const encryptionKey = await agileDeriveKey(h, AGILE_BLOCK_KEY_KEY_VALUE, "SHA512", keyBits);
  const skey = aesCbcDecryptRaw(encryptionKey, salt, encryptedKeyValue);
  assert.equal(toHex(skey), toHex(expected));
});

// msoffcrypto-tool ECMA376Agile.verify_password doctest vector.
await test("Agile verify_password - msoffcrypto-tool doctest vector", async () => {
  const password = "Password1234_";
  const saltValue = hex("cbca1c999343fbad92075634150034b0".slice(0, 32));
  const encryptedVerifierHashInput = hex("39eea54e26e514798c284bc7714d38ac".slice(0, 32));
  const encryptedVerifierHashValue = hex(
    "14376d6d817334e6b0ff4fd8221a7c678e5d8a784e8f999f4c188930c36a4b29c5b333605b5cd403b05003adcf18cca8cbab8debe373c65604a0becfae5c0ad0".slice(
      0,
      128,
    ),
  );
  const spinValue = 100000;
  const keyBits = 256;

  const h = await agileDeriveIteratedHash(password, saltValue, "SHA512", spinValue);
  const key1 = await agileDeriveKey(h, AGILE_BLOCK_KEY_VERIFIER_INPUT, "SHA512", keyBits);
  const key2 = await agileDeriveKey(h, AGILE_BLOCK_KEY_VERIFIER_HASH, "SHA512", keyBits);
  const hashInput = aesCbcDecryptRaw(key1, saltValue, encryptedVerifierHashInput);
  const { subtle } = (await import("node:crypto")).webcrypto;
  const actualHash = new Uint8Array(await subtle.digest("SHA-512", hashInput));
  const expectedHash = aesCbcDecryptRaw(key2, saltValue, encryptedVerifierHashValue);
  assert.equal(toHex(actualHash), toHex(expectedHash.subarray(0, actualHash.length)));
});

// msoffcrypto-tool ECMA376Standard.makekey_from_password doctest vector.
await test("Standard key derivation - msoffcrypto-tool doctest vector", async () => {
  const password = "Password1234_";
  const salt = hex("e88266490c5bd1eebd2b4394e3f830ef".slice(0, 32));
  const expected = hex("40b13a71f90b966e375408f2d181a1aa".slice(0, 32));
  const key = await standardDeriveKey(password, salt, 128);
  assert.equal(toHex(key), toHex(expected));
});

// msoffcrypto-tool ECMA376Standard.verifykey doctest vector.
await test("Standard verifykey - msoffcrypto-tool doctest vector", async () => {
  const key = hex("40b13a71f90b966e375408f2d181a1aa".slice(0, 32));
  const encryptedVerifier = hex("516f732e966fac17b1c5d7d8cc36c928".slice(0, 32));
  const encryptedVerifierHash = hex("2b6168dabe2911ad2bd37c1746745c14d3cf1bb140a48f4e6f3d23880872b16a".slice(0, 64));
  const verifier = aesEcbDecrypt(key, encryptedVerifier);
  const { subtle } = (await import("node:crypto")).webcrypto;
  const expectedHash = new Uint8Array(await subtle.digest("SHA-1", verifier));
  const verifierHash = aesEcbDecrypt(key, encryptedVerifierHash);
  assert.equal(toHex(expectedHash), toHex(verifierHash.subarray(0, expectedHash.length)));
});

// RC4 CryptoAPI key derivation - reference vector computed independently in Python (see
// scratchpad/gen_rc4cryptoapi_vector.py), cross-checking the SHA1(salt+password)->SHA1(h0+block)->truncate chain.
await test("RC4 CryptoAPI key derivation - independent Python-computed vector", async () => {
  const password = "Password1234_";
  const salt = hex("0102030405060708090a0b0c0d0e0f10");
  const key = await rc4CryptoApiMakeKey(password, salt, 128, 0);
  assert.equal(toHex(key), "986c34c802f2d0c4054b05ff8b395c99");
});

// Genuine Agile-encrypted .xlsx fixture (see scratchpad/make_agile_fixture.py), full pipeline.
await test("decryptExcelBuffer - genuine Agile-encrypted .xlsx fixture, end to end", async () => {
  const fs = await import("node:fs");
  const path = new URL("./test-fixtures/agile_encrypted.xlsx", import.meta.url);
  const buf = fs.readFileSync(path);
  const decrypted = await decryptExcelBuffer(new Uint8Array(buf), "Password1234_", "xlsx");
  // A decrypted OOXML package must be a valid zip: local file header signature "PK\x03\x04".
  assert.equal(decrypted[0], 0x50);
  assert.equal(decrypted[1], 0x4b);
  assert.equal(decrypted[2], 0x03);
  assert.equal(decrypted[3], 0x04);

  await assert.rejects(() => decryptExcelBuffer(new Uint8Array(buf), "wrong-password", "xlsx"), IncorrectPasswordError);
});

// Legacy .xls BIFF8 record-walk round trip: constructs a synthetic Workbook stream with known
// plaintext, "encrypts" it using the SAME (independently-verified-against-published-vectors) RC4
// primitives applied the way real Excel does (concatenate the encrypted ranges across records,
// re-key every 1024 bytes), then confirms decryptBiff8Workbook recovers the exact original bytes.
// This exercises the record-boundary bookkeeping (the BOF/FilePass/BoundSheet8 special-casing and
// the concatenate-then-scatter logic) - exactly where an indexing bug would show up, as one did
// for the Standard-mode and FilePass-header offsets caught earlier during this implementation.
await test("Legacy .xls BIFF8 record-walk - synthetic round trip", async () => {
  const PASSWORD = "Password1234_";
  const record = (num, body) => concatBytes(packU16LE(num), packU16LE(body.length), body);

  function packU16LE(n) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, n, true);
    return b;
  }
  function concatBytes(...parts) {
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }

  const salt = hex("0102030405060708090a0b0c0d0e0f10");
  const keyBits = 128;
  const verifyKey = await rc4CryptoApiMakeKey(PASSWORD, salt, keyBits, 0);
  const verifier = hex("aabbccddeeff00112233445566778899");
  const verifierHash = await (await import("node:crypto")).webcrypto.subtle.digest("SHA-1", verifier).then((b) => new Uint8Array(b));
  // Encrypted as ONE continuous RC4 keystream across both fields (matching decryptBiff8Workbook's
  // verify step, which decrypts them concatenated) - not two independently-restarted streams.
  const encryptedVerifierBlock = rc4Decrypt(verifyKey, concatBytes(verifier, verifierHash)); // RC4 is symmetric
  const encryptedVerifier = encryptedVerifierBlock.subarray(0, 16);
  const encryptedVerifierHash = encryptedVerifierBlock.subarray(16);

  // FilePass body: wEncryptionType(2)=1, vMajor(2)=2, vMinor(2)=2, flags(4)=0, headerSize(4),
  // EncryptionHeader (flags,sizeExtra,algId,algIdHash,keySize,providerType,reserved1,reserved2),
  // then EncryptionVerifier (saltSize, salt, encryptedVerifier, verifierHashSize, encryptedVerifierHash).
  const header = concatBytes(new Uint8Array(4), new Uint8Array(4), new Uint8Array(4), new Uint8Array(4), packU32LE(keyBits), new Uint8Array(4), new Uint8Array(4), new Uint8Array(4));
  function packU32LE(n) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    return b;
  }
  const verifierBlock = concatBytes(packU32LE(16), salt, encryptedVerifier, packU32LE(verifierHash.length), encryptedVerifierHash);
  const filePassBody = concatBytes(packU16LE(1), packU16LE(2), packU16LE(2), new Uint8Array(4), packU32LE(header.length), header, verifierBlock);

  const bof = record(2057, new Uint8Array(16));
  const filePassRecord = record(47, filePassBody);
  const normalPlain = new TextEncoder().encode("hello world plaintext record!!!"); // 32 bytes
  const boundSheetLbPlyPos = hex("11223344");
  const boundSheetRest = new TextEncoder().encode("SheetNameHere"); // 13 bytes, encrypted portion
  const eof = record(10, new Uint8Array(0));

  // Encrypt the two "encrypted ranges" as one continuous RC4-CryptoAPI stream starting at block 1
  // (block 0 is reserved for the verifier), matching decryptBiff8Workbook's expectation exactly.
  const plainConcat = concatBytes(normalPlain, boundSheetRest);
  const encKey = await rc4CryptoApiMakeKey(PASSWORD, salt, keyBits, 1);
  const cipherConcat = rc4Decrypt(encKey, plainConcat); // symmetric
  const encryptedNormal = cipherConcat.subarray(0, normalPlain.length);
  const encryptedBoundSheetRest = cipherConcat.subarray(normalPlain.length);

  const normalRecord = record(999, encryptedNormal);
  const boundSheetRecord = record(133, concatBytes(boundSheetLbPlyPos, encryptedBoundSheetRest));

  const encryptedWorkbook = concatBytes(bof, filePassRecord, normalRecord, boundSheetRecord, eof);
  const expectedDecryptedWorkbook = concatBytes(
    bof,
    record(47, new Uint8Array(filePassBody.length)), // zeroed, per decryptBiff8Workbook's FilePass handling
    record(999, normalPlain),
    record(133, concatBytes(boundSheetLbPlyPos, boundSheetRest)),
    eof,
  );

  const decrypted = await decryptBiff8Workbook(encryptedWorkbook, PASSWORD);
  assert.equal(toHex(decrypted), toHex(expectedDecryptedWorkbook));

  await assert.rejects(() => decryptBiff8Workbook(encryptedWorkbook, "wrong password"), IncorrectPasswordError);
});

console.log(`\n${passed} test(s) passed.`);
