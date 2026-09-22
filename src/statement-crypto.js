// Decryption for password-protected Excel (.xlsx Agile/Standard, legacy .xls RC4 CryptoAPI) statements.
//
// No DOM/Tauri dependencies - only Web Crypto (crypto.subtle, available identically in the Tauri
// webview and in Node) for hashing, so this module can be unit-tested directly under Node.
//
// Algorithms verified against msoffcrypto-tool (github.com/nolze/msoffcrypto-tool), a widely-used
// reference implementation, including its published key-derivation test vectors (see
// statement-crypto.test.mjs). AES itself is implemented from scratch (see the "AES block cipher"
// section) because SubtleCrypto's AES-CBC unconditionally removes PKCS#7 padding on decrypt and
// throws on non-padded ciphertext - Office's raw encrypted segments are never PKCS7-padded, and
// SubtleCrypto has no AES-ECB mode at all (Standard-mode encryption uses ECB).

export class IncorrectPasswordError extends Error {
  constructor(message = "Incorrect password") {
    super(message);
    this.name = "IncorrectPasswordError";
  }
}

export class UnsupportedEncryptionError extends Error {
  constructor(message = "Unsupported encryption scheme") {
    super(message);
    this.name = "UnsupportedEncryptionError";
  }
}

// ================= Small byte-buffer helpers =================

function u8(buf) {
  return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
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
function readU16LE(view, off) {
  return view.getUint16(off, true);
}
function readU32LE(view, off) {
  return view.getUint32(off, true);
}
function packU32LE(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}
function utf16leBytes(str) {
  const out = new Uint8Array(str.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < str.length; i++) view.setUint16(i * 2, str.charCodeAt(i), true);
  return out;
}
function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ================= Hashing (via SubtleCrypto - safe, no padding pitfalls) =================

async function sha1(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-1", bytes));
}
async function sha512(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-512", bytes));
}

// ================= AES block cipher (decrypt-only, from scratch) =================
//
// Standard FIPS-197 tables/algorithm. Implemented directly instead of via SubtleCrypto because:
//  - SubtleCrypto has no AES-ECB mode (excluded from the Web Crypto spec entirely).
//  - SubtleCrypto's AES-CBC decrypt always strips PKCS#7 padding and throws on non-padded
//    ciphertext (verified empirically); Office's encrypted segments are raw, unpadded CBC.
// Verified against the official FIPS-197 test vectors in statement-crypto.test.mjs.

const SBOX = new Uint8Array([
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76, 0xca, 0x82, 0xc9,
  0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0, 0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f,
  0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15, 0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07,
  0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75, 0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3,
  0x29, 0xe3, 0x2f, 0x84, 0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58,
  0xcf, 0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8, 0x51, 0xa3,
  0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2, 0xcd, 0x0c, 0x13, 0xec, 0x5f,
  0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73, 0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88,
  0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb, 0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac,
  0x62, 0x91, 0x95, 0xe4, 0x79, 0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a,
  0xae, 0x08, 0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a, 0x70,
  0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e, 0xe1, 0xf8, 0x98, 0x11,
  0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf, 0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42,
  0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
]);

const INV_SBOX = new Uint8Array(256);
for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i;

const RCON = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36, 0x6c, 0xd8, 0xab, 0x4d];

function gmul(a, b) {
  let p = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    const hiBitSet = a & 0x80;
    a = (a << 1) & 0xff;
    if (hiBitSet) a ^= 0x1b;
    b >>= 1;
  }
  return p;
}

// Expands a 16/24/32-byte key into the round-key schedule (Nb=4 words per round, Nr+1 rounds).
function aesKeyExpansion(key) {
  const Nk = key.length / 4;
  const Nr = Nk + 6;
  const Nb = 4;
  const w = new Array((Nb * (Nr + 1)) * 4);
  for (let i = 0; i < Nk * 4; i++) w[i] = key[i];
  for (let i = Nk; i < Nb * (Nr + 1); i++) {
    let t0 = w[4 * (i - 1)],
      t1 = w[4 * (i - 1) + 1],
      t2 = w[4 * (i - 1) + 2],
      t3 = w[4 * (i - 1) + 3];
    if (i % Nk === 0) {
      // RotWord then SubWord then xor Rcon
      const r0 = SBOX[t1],
        r1 = SBOX[t2],
        r2 = SBOX[t3],
        r3 = SBOX[t0];
      t0 = r0 ^ RCON[i / Nk];
      t1 = r1;
      t2 = r2;
      t3 = r3;
    } else if (Nk > 6 && i % Nk === 4) {
      t0 = SBOX[t0];
      t1 = SBOX[t1];
      t2 = SBOX[t2];
      t3 = SBOX[t3];
    }
    w[4 * i] = w[4 * (i - Nk)] ^ t0;
    w[4 * i + 1] = w[4 * (i - Nk) + 1] ^ t1;
    w[4 * i + 2] = w[4 * (i - Nk) + 2] ^ t2;
    w[4 * i + 3] = w[4 * (i - Nk) + 3] ^ t3;
  }
  return { w, Nr };
}

// Decrypts exactly one 16-byte block (ECB-equivalent, no chaining). `schedule` from aesKeyExpansion.
function aesDecryptBlock(schedule, block) {
  const { w, Nr } = schedule;
  const state = new Uint8Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) state[r + 4 * c] = block[r + 4 * c];

  const addRoundKey = (round) => {
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++) state[r + 4 * c] ^= w[4 * (round * 4 + c) + r];
  };
  const invSubBytes = () => {
    for (let i = 0; i < 16; i++) state[i] = INV_SBOX[state[i]];
  };
  const invShiftRows = () => {
    // Row r is rotated right by r positions (columns 0..3).
    for (let r = 1; r < 4; r++) {
      const row = [state[r], state[r + 4], state[r + 8], state[r + 12]];
      for (let c = 0; c < 4; c++) state[r + 4 * c] = row[(c - r + 4) % 4];
    }
  };
  const invMixColumns = () => {
    for (let c = 0; c < 4; c++) {
      const a0 = state[4 * c],
        a1 = state[4 * c + 1],
        a2 = state[4 * c + 2],
        a3 = state[4 * c + 3];
      state[4 * c] = gmul(a0, 0x0e) ^ gmul(a1, 0x0b) ^ gmul(a2, 0x0d) ^ gmul(a3, 0x09);
      state[4 * c + 1] = gmul(a0, 0x09) ^ gmul(a1, 0x0e) ^ gmul(a2, 0x0b) ^ gmul(a3, 0x0d);
      state[4 * c + 2] = gmul(a0, 0x0d) ^ gmul(a1, 0x09) ^ gmul(a2, 0x0e) ^ gmul(a3, 0x0b);
      state[4 * c + 3] = gmul(a0, 0x0b) ^ gmul(a1, 0x0d) ^ gmul(a2, 0x09) ^ gmul(a3, 0x0e);
    }
  };

  addRoundKey(Nr);
  for (let round = Nr - 1; round >= 1; round--) {
    invShiftRows();
    invSubBytes();
    addRoundKey(round);
    invMixColumns();
  }
  invShiftRows();
  invSubBytes();
  addRoundKey(0);
  return state;
}

// Decrypts `data` (any length, must be a multiple of 16 bytes) as ECB: each block independently.
function aesEcbDecrypt(key, data) {
  const schedule = aesKeyExpansion(key);
  const out = new Uint8Array(data.length);
  for (let off = 0; off < data.length; off += 16) {
    out.set(aesDecryptBlock(schedule, data.subarray(off, off + 16)), off);
  }
  return out;
}

// Decrypts `data` (multiple of 16 bytes) as raw, non-padded CBC with the given 16-byte IV.
function aesCbcDecryptRaw(key, iv, data) {
  const schedule = aesKeyExpansion(key);
  const out = new Uint8Array(data.length);
  let prev = iv;
  for (let off = 0; off < data.length; off += 16) {
    const block = data.subarray(off, off + 16);
    const decrypted = aesDecryptBlock(schedule, block);
    for (let i = 0; i < 16; i++) out[off + i] = decrypted[i] ^ prev[i];
    prev = block;
  }
  return out;
}

// ================= RC4 (used only for legacy .xls RC4 CryptoAPI; no Web Crypto primitive exists) =================

function rc4Decrypt(key, data) {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xff;
    [S[i], S[j]] = [S[j], S[i]];
  }
  const out = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let n = 0; n < data.length; n++) {
    i = (i + 1) & 0xff;
    j = (j + S[i]) & 0xff;
    [S[i], S[j]] = [S[j], S[i]];
    out[n] = data[n] ^ S[(S[i] + S[j]) & 0xff];
  }
  return out;
}

// ================= CFB (Compound File Binary / OLE2, [MS-CFB]) reader =================
//
// Minimal reader: locates named top-level streams and returns their bytes, plus enough
// positional information to patch a stream's bytes back into a copy of the original file
// (needed for legacy .xls, where XLSX.read() expects a whole valid CFB file, not just the
// decrypted Workbook stream in isolation).

const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const FATSECT = 0xfffffffd;
const DIFSECT = 0xfffffffc;

export function isCfbFile(buffer) {
  const b = u8(buffer);
  if (b.length < 8) return false;
  for (let i = 0; i < 8; i++) if (b[i] !== CFB_SIGNATURE[i]) return false;
  return true;
}

// Parses a CFB container. Returns { getEntry(name) } where an entry is
// { size, read(): Uint8Array, patch(newBytes, wholeFileCopy) } or null if not found.
export function parseCFB(buffer) {
  const bytes = u8(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!isCfbFile(bytes)) throw new UnsupportedEncryptionError("Not a compound file (OLE2/CFB)");

  const sectorShift = readU16LE(view, 30);
  const miniSectorShift = readU16LE(view, 32);
  const numFatSectors = readU32LE(view, 44);
  const firstDirSector = readU32LE(view, 48);
  const miniStreamCutoff = readU32LE(view, 56);
  const firstMiniFatSector = readU32LE(view, 60);
  const numMiniFatSectors = readU32LE(view, 64);
  const firstDifatSector = readU32LE(view, 68);
  const numDifatSectors = readU32LE(view, 72);

  const sectorSize = 1 << sectorShift;
  const miniSectorSize = 1 << miniSectorShift;
  const sectorOffset = (sectorNum) => 512 + sectorNum * sectorSize;
  const readSector = (sectorNum) => bytes.subarray(sectorOffset(sectorNum), sectorOffset(sectorNum) + sectorSize);

  // --- DIFAT: locations of every FAT sector. First 109 are in the header itself. ---
  const fatSectorLocations = [];
  for (let i = 0; i < 109 && fatSectorLocations.length < numFatSectors; i++) {
    const loc = readU32LE(view, 76 + i * 4);
    if (loc !== FREESECT) fatSectorLocations.push(loc);
  }
  let difatSector = firstDifatSector;
  for (let s = 0; s < numDifatSectors && difatSector !== ENDOFCHAIN; s++) {
    const sec = readSector(difatSector);
    const secView = new DataView(sec.buffer, sec.byteOffset, sec.byteLength);
    const entriesPerSector = sectorSize / 4 - 1;
    for (let i = 0; i < entriesPerSector && fatSectorLocations.length < numFatSectors; i++) {
      const loc = secView.getUint32(i * 4, true);
      if (loc !== FREESECT) fatSectorLocations.push(loc);
    }
    difatSector = secView.getUint32(sectorSize - 4, true);
  }

  // --- FAT: concatenation of all FAT sectors' entries. ---
  const fatEntriesPerSector = sectorSize / 4;
  const fat = new Uint32Array(fatSectorLocations.length * fatEntriesPerSector);
  fatSectorLocations.forEach((loc, idx) => {
    const sec = readSector(loc);
    const secView = new DataView(sec.buffer, sec.byteOffset, sec.byteLength);
    for (let i = 0; i < fatEntriesPerSector; i++) fat[idx * fatEntriesPerSector + i] = secView.getUint32(i * 4, true);
  });

  // Follows a regular-sector chain, returning the sector numbers in order.
  function chainFrom(startSector) {
    const chain = [];
    let sec = startSector;
    const seen = new Set();
    while (sec !== ENDOFCHAIN && sec !== FREESECT && !seen.has(sec)) {
      seen.add(sec);
      chain.push(sec);
      sec = fat[sec];
    }
    return chain;
  }
  function readChainBytes(startSector, size) {
    const chain = chainFrom(startSector);
    const out = new Uint8Array(chain.length * sectorSize);
    chain.forEach((sec, i) => out.set(readSector(sec), i * sectorSize));
    return out.subarray(0, size);
  }

  // --- Directory entries (128 bytes each, across the directory sector chain). ---
  const dirChain = chainFrom(firstDirSector);
  const entries = [];
  for (const sec of dirChain) {
    const secBytes = readSector(sec);
    const secView = new DataView(secBytes.buffer, secBytes.byteOffset, secBytes.byteLength);
    for (let off = 0; off < sectorSize; off += 128) {
      const objectType = secBytes[off + 66];
      if (objectType === 0) continue; // unused entry
      const nameLen = secView.getUint16(off + 64, true);
      const nameChars = Math.max(0, Math.floor((nameLen - 2) / 2));
      let name = "";
      for (let i = 0; i < nameChars; i++) name += String.fromCharCode(secView.getUint16(off + i * 2, true));
      entries.push({
        name,
        isStream: objectType === 2,
        isRoot: objectType === 5,
        startSector: secView.getUint32(off + 116, true),
        // Only the low 4 bytes matter for the sizes used by real Office files.
        size: secView.getUint32(off + 120, true),
      });
    }
  }
  const root = entries.find((e) => e.isRoot);

  // --- Mini FAT + mini stream (small streams, < miniStreamCutoff, live inside the root's data). ---
  const miniStream = root ? readChainBytes(root.startSector, root.size) : new Uint8Array(0);
  const miniFatChain = chainFrom(firstMiniFatSector);
  const miniFatEntriesPerSector = sectorSize / 4;
  const miniFat = new Uint32Array(miniFatChain.length * miniFatEntriesPerSector);
  miniFatChain.forEach((sec, idx) => {
    const secBytes = readSector(sec);
    const secView = new DataView(secBytes.buffer, secBytes.byteOffset, secBytes.byteLength);
    for (let i = 0; i < miniFatEntriesPerSector; i++)
      miniFat[idx * miniFatEntriesPerSector + i] = secView.getUint32(i * 4, true);
  });
  function miniChainFrom(startSector) {
    const chain = [];
    let sec = startSector;
    const seen = new Set();
    while (sec !== ENDOFCHAIN && sec !== FREESECT && !seen.has(sec)) {
      seen.add(sec);
      chain.push(sec);
      sec = miniFat[sec];
    }
    return chain;
  }
  function readMiniChainBytes(startSector, size) {
    const chain = miniChainFrom(startSector);
    const out = new Uint8Array(chain.length * miniSectorSize);
    chain.forEach((sec, i) => out.set(miniStream.subarray(sec * miniSectorSize, (sec + 1) * miniSectorSize), i * miniSectorSize));
    return out.subarray(0, size);
  }

  function getEntry(name) {
    const entry = entries.find((e) => e.isStream && e.name === name);
    if (!entry) return null;
    const useMini = entry.size < miniStreamCutoff;
    return {
      size: entry.size,
      read() {
        return useMini ? readMiniChainBytes(entry.startSector, entry.size) : readChainBytes(entry.startSector, entry.size);
      },
      // Returns a full copy of the file with this stream's bytes replaced by `newBytes`
      // (must be exactly entry.size bytes - CFB sector/directory layout is never changed).
      patch(newBytes) {
        if (newBytes.length !== entry.size) {
          throw new Error("statement-crypto: patch() requires a same-size replacement buffer");
        }
        const out = bytes.slice();
        if (useMini) {
          const chain = miniChainFrom(entry.startSector);
          let written = 0;
          for (const sec of chain) {
            const chunk = newBytes.subarray(written, written + miniSectorSize);
            // Mini-stream sectors live inside the root entry's regular-sector chain; resolve
            // this mini-sector's absolute file offset via the root's chain.
            const rootChain = chainFrom(root.startSector);
            const miniSectorsPerRegular = sectorSize / miniSectorSize;
            const regularIdx = Math.floor(sec / miniSectorsPerRegular);
            const withinRegular = sec % miniSectorsPerRegular;
            const fileOff = sectorOffset(rootChain[regularIdx]) + withinRegular * miniSectorSize;
            out.set(chunk, fileOff);
            written += miniSectorSize;
          }
        } else {
          const chain = chainFrom(entry.startSector);
          let written = 0;
          for (const sec of chain) {
            const chunk = newBytes.subarray(written, written + sectorSize);
            out.set(chunk, sectorOffset(sec));
            written += sectorSize;
          }
        }
        return out;
      },
    };
  }

  return { getEntry };
}

// ================= ECMA-376 Agile encryption (.xlsx, Excel 2010+ default) =================

const AGILE_BLOCK_KEY_VERIFIER_INPUT = Uint8Array.from([0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]);
const AGILE_BLOCK_KEY_VERIFIER_HASH = Uint8Array.from([0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e]);
const AGILE_BLOCK_KEY_KEY_VALUE = Uint8Array.from([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]);

const HASH_FUNCS = { SHA1: sha1, SHA512: sha512 };

function xmlAttr(xml, tagLocalName, attrName, ns) {
  const tagRe = new RegExp(`<(?:[\\w.-]+:)?${tagLocalName}\\b([^>]*?)/?>`, "i");
  const m = xml.match(tagRe);
  if (!m) return null;
  const attrs = m[1];
  const attrRe = new RegExp(`${attrName}="([^"]*)"`);
  const am = attrs.match(attrRe);
  return am ? am[1] : null;
}

function parseAgileEncryptionInfo(xml) {
  const hashAlgorithm = (xmlAttr(xml, "p:encryptedKey", "hashAlgorithm") || "").toUpperCase();
  return {
    keyDataSaltValue: Uint8Array.from(atob(xmlAttr(xml, "keyData", "saltValue")), (c) => c.charCodeAt(0)),
    keyDataHashAlgorithm: (xmlAttr(xml, "keyData", "hashAlgorithm") || "").toUpperCase(),
    passwordSalt: Uint8Array.from(atob(xmlAttr(xml, "p:encryptedKey", "saltValue")), (c) => c.charCodeAt(0)),
    passwordHashAlgorithm: hashAlgorithm,
    passwordKeyBits: parseInt(xmlAttr(xml, "p:encryptedKey", "keyBits"), 10),
    spinCount: parseInt(xmlAttr(xml, "p:encryptedKey", "spinCount"), 10),
    encryptedVerifierHashInput: Uint8Array.from(atob(xmlAttr(xml, "p:encryptedKey", "encryptedVerifierHashInput")), (c) => c.charCodeAt(0)),
    encryptedVerifierHashValue: Uint8Array.from(atob(xmlAttr(xml, "p:encryptedKey", "encryptedVerifierHashValue")), (c) => c.charCodeAt(0)),
    encryptedKeyValue: Uint8Array.from(atob(xmlAttr(xml, "p:encryptedKey", "encryptedKeyValue")), (c) => c.charCodeAt(0)),
  };
}

async function agileDeriveIteratedHash(password, salt, hashAlgorithm, spinCount) {
  const hashFn = HASH_FUNCS[hashAlgorithm] || sha512;
  let h = await hashFn(concatBytes(salt, utf16leBytes(password)));
  for (let i = 0; i < spinCount; i++) {
    h = await hashFn(concatBytes(packU32LE(i), h));
  }
  return h;
}
async function agileDeriveKey(iteratedHash, blockKey, hashAlgorithm, keyBits) {
  const hashFn = HASH_FUNCS[hashAlgorithm] || sha512;
  const full = await hashFn(concatBytes(iteratedHash, blockKey));
  return full.subarray(0, keyBits / 8);
}

async function decryptXlsxAgile(cfb, password) {
  const infoStream = cfb.getEntry("EncryptionInfo");
  const packageStream = cfb.getEntry("EncryptedPackage");
  if (!infoStream || !packageStream) throw new UnsupportedEncryptionError("Missing EncryptionInfo/EncryptedPackage stream");

  const infoBytes = infoStream.read();
  // First 8 bytes: versionMajor(2) versionMinor(2) flags(4); the rest is the XML descriptor.
  const xml = new TextDecoder("utf-8").decode(infoBytes.subarray(8));
  const info = parseAgileEncryptionInfo(xml);

  const iteratedHash = await agileDeriveIteratedHash(password, info.passwordSalt, info.passwordHashAlgorithm, info.spinCount);
  const verifierInputKey = await agileDeriveKey(iteratedHash, AGILE_BLOCK_KEY_VERIFIER_INPUT, info.passwordHashAlgorithm, info.passwordKeyBits);
  const verifierHashKey = await agileDeriveKey(iteratedHash, AGILE_BLOCK_KEY_VERIFIER_HASH, info.passwordHashAlgorithm, info.passwordKeyBits);
  const keyValueKey = await agileDeriveKey(iteratedHash, AGILE_BLOCK_KEY_KEY_VALUE, info.passwordHashAlgorithm, info.passwordKeyBits);

  const verifierHashInput = aesCbcDecryptRaw(verifierInputKey, info.passwordSalt, info.encryptedVerifierHashInput);
  const hashFn = HASH_FUNCS[info.passwordHashAlgorithm] || sha512;
  const actualHash = await hashFn(verifierHashInput);
  const expectedHash = aesCbcDecryptRaw(verifierHashKey, info.passwordSalt, info.encryptedVerifierHashValue);
  if (!bytesEqual(actualHash, expectedHash.subarray(0, actualHash.length))) {
    throw new IncorrectPasswordError();
  }

  const secretKey = aesCbcDecryptRaw(keyValueKey, info.passwordSalt, info.encryptedKeyValue);

  // Package: 8-byte little-endian total size, then 4096-byte AES-CBC segments, each with its
  // own IV derived from keyDataSaltValue + the segment index.
  const packageBytes = packageStream.read();
  const packageView = new DataView(packageBytes.buffer, packageBytes.byteOffset, packageBytes.byteLength);
  const totalSize = Number(packageView.getBigUint64(0, true));
  const SEGMENT_LENGTH = 4096;
  const keyDataHashFn = HASH_FUNCS[info.keyDataHashAlgorithm] || sha512;
  const out = new Uint8Array(totalSize);
  let outOff = 0;
  for (let off = 8, segIdx = 0; off < packageBytes.length; off += SEGMENT_LENGTH, segIdx++) {
    const segment = packageBytes.subarray(off, Math.min(off + SEGMENT_LENGTH, packageBytes.length));
    const iv = (await keyDataHashFn(concatBytes(info.keyDataSaltValue, packU32LE(segIdx)))).subarray(0, 16);
    const decrypted = aesCbcDecryptRaw(secretKey, iv, segment);
    const take = Math.min(decrypted.length, totalSize - outOff);
    out.set(decrypted.subarray(0, take), outOff);
    outOff += take;
    if (outOff >= totalSize) break;
  }
  return out;
}

// ================= ECMA-376 Standard encryption (.xlsx, AES-ECB variant) =================

function parseEncryptionHeader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    flags: readU32LE(view, 0),
    sizeExtra: readU32LE(view, 4),
    algId: readU32LE(view, 8),
    algIdHash: readU32LE(view, 12),
    keySize: readU32LE(view, 16),
    providerType: readU32LE(view, 20),
  };
}
function parseEncryptionVerifierAes(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const saltSize = readU32LE(view, 0);
  const salt = bytes.subarray(4, 4 + saltSize);
  const encryptedVerifier = bytes.subarray(4 + saltSize, 4 + saltSize + 16);
  const verifierHashSize = readU32LE(view, 4 + saltSize + 16);
  const encryptedVerifierHash = bytes.subarray(4 + saltSize + 20, 4 + saltSize + 20 + 32);
  return { saltSize, salt, encryptedVerifier, verifierHashSize, encryptedVerifierHash };
}

const STANDARD_AES_ALG_IDS = new Set([0x0000660e, 0x0000660f, 0x00006610]); // AES-128/192/256

async function standardDeriveKey(password, salt, keyBits) {
  const ITER_COUNT = 50000;
  let h = await sha1(concatBytes(salt, utf16leBytes(password)));
  for (let i = 0; i < ITER_COUNT; i++) h = await sha1(concatBytes(packU32LE(i), h));
  const hFinal = await sha1(concatBytes(h, packU32LE(0)));

  const xorBytes = (a, pad) => {
    const out = new Uint8Array(64);
    for (let i = 0; i < 64; i++) out[i] = (i < a.length ? a[i] : 0) ^ pad;
    return out;
  };
  const x1 = await sha1(xorBytes(hFinal, 0x36));
  const cbRequiredKeyLength = keyBits / 8;
  return x1.subarray(0, cbRequiredKeyLength);
}

async function decryptXlsxStandard(cfb, password) {
  const infoStream = cfb.getEntry("EncryptionInfo");
  const packageStream = cfb.getEntry("EncryptedPackage");
  if (!infoStream || !packageStream) throw new UnsupportedEncryptionError("Missing EncryptionInfo/EncryptedPackage stream");

  const infoBytes = infoStream.read();
  const infoView = new DataView(infoBytes.buffer, infoBytes.byteOffset, infoBytes.byteLength);
  // Layout: versionMajor(2) versionMinor(2) headerFlags(4) encryptionHeaderSize(4) header verifier
  // (unlike Agile, there is no extra 4-byte field after the version pair here).
  const headerSize = readU32LE(infoView, 8);
  const header = parseEncryptionHeader(infoBytes.subarray(12, 12 + headerSize));
  const verifier = parseEncryptionVerifierAes(infoBytes.subarray(12 + headerSize));

  if (!STANDARD_AES_ALG_IDS.has(header.algId)) {
    throw new UnsupportedEncryptionError("Non-AES Standard-mode Excel encryption is not supported");
  }

  const key = await standardDeriveKey(password, verifier.salt, header.keySize);
  const decryptedVerifier = aesEcbDecrypt(key, verifier.encryptedVerifier);
  const expectedHash = await sha1(decryptedVerifier);
  const decryptedVerifierHash = aesEcbDecrypt(key, verifier.encryptedVerifierHash);
  if (!bytesEqual(expectedHash, decryptedVerifierHash.subarray(0, expectedHash.length))) {
    throw new IncorrectPasswordError();
  }

  const packageBytes = packageStream.read();
  const packageView = new DataView(packageBytes.buffer, packageBytes.byteOffset, packageBytes.byteLength);
  const totalSize = readU32LE(packageView, 0);
  const decrypted = aesEcbDecrypt(key, packageBytes.subarray(8));
  return decrypted.subarray(0, totalSize);
}

// ================= .xlsx dispatcher =================

async function decryptXlsxBuffer(buffer, password) {
  const cfb = parseCFB(buffer);
  const infoStream = cfb.getEntry("EncryptionInfo");
  if (!infoStream) throw new UnsupportedEncryptionError("No EncryptionInfo stream found");
  const infoBytes = infoStream.read();
  const infoView = new DataView(infoBytes.buffer, infoBytes.byteOffset, infoBytes.byteLength);
  const versionMajor = readU16LE(infoView, 0);
  const versionMinor = readU16LE(infoView, 2);

  if (versionMajor === 4 && versionMinor === 4) {
    return decryptXlsxAgile(cfb, password);
  }
  if ([2, 3, 4].includes(versionMajor) && versionMinor === 2) {
    return decryptXlsxStandard(cfb, password);
  }
  throw new UnsupportedEncryptionError(`Unsupported EncryptionInfo version (${versionMajor}.${versionMinor})`);
}

// ================= Legacy .xls (BIFF8) RC4 CryptoAPI encryption =================

const BIFF_RECORD = { BOF: 2057, FilePass: 47, BoundSheet8: 133, InterfaceHdr: 225, RRDHead: 312, UsrExcl: 404, FileLock: 405, RRDInfo: 406 };
const BIFF_UNENCRYPTED_PASSTHROUGH = new Set([
  BIFF_RECORD.BOF,
  BIFF_RECORD.FilePass,
  BIFF_RECORD.UsrExcl,
  BIFF_RECORD.FileLock,
  BIFF_RECORD.InterfaceHdr,
  BIFF_RECORD.RRDInfo,
  BIFF_RECORD.RRDHead,
]);

function rc4CryptoApiMakeKey(password, salt, keyBits, block) {
  return sha1(concatBytes(salt, utf16leBytes(password))).then((h0) =>
    sha1(concatBytes(h0, packU32LE(block))).then((hfinal) => {
      if (keyBits === 40) return concatBytes(hfinal.subarray(0, 5), new Uint8Array(11));
      return hfinal.subarray(0, keyBits / 8);
    }),
  );
}

// Locates the FilePass record in the Workbook stream and returns its parsed RC4 CryptoAPI header,
// or null if the workbook isn't RC4-CryptoAPI-encrypted (unencrypted, or the unsupported legacy
// XOR-obfuscation / plain-RC4 "type 1" scheme - see design.md Non-Goals).
function findFilePassRc4CryptoApi(workbookBytes) {
  const view = new DataView(workbookBytes.buffer, workbookBytes.byteOffset, workbookBytes.byteLength);
  let off = 0;
  const bofNum = readU16LE(view, 0);
  if (bofNum !== BIFF_RECORD.BOF) throw new UnsupportedEncryptionError("Not a recognizable BIFF8 Workbook stream");
  off += 4 + readU16LE(view, 2); // skip BOF record

  while (off + 4 <= workbookBytes.length) {
    const num = readU16LE(view, off);
    const size = readU16LE(view, off + 2);
    if (num === BIFF_RECORD.FilePass) {
      const body = workbookBytes.subarray(off + 4, off + 4 + size);
      const bodyView = new DataView(body.buffer, body.byteOffset, body.byteLength);
      const wEncryptionType = readU16LE(bodyView, 0);
      if (wEncryptionType !== 0x0001) return { unsupported: true }; // XOR obfuscation (type 0)
      const vMajor = readU16LE(bodyView, 2);
      const vMinor = readU16LE(bodyView, 4);
      if (!([2, 3, 4].includes(vMajor) && vMinor === 2)) return { unsupported: true }; // plain RC4 "type 1"
      // Body layout: wEncryptionType(2) vMajor(2) vMinor(2) flags(4) headerSize(4) EncryptionHeader verifier
      const headerSize = readU32LE(bodyView, 10);
      const header = parseEncryptionHeader(body.subarray(14, 14 + headerSize));
      const verifierBytes = body.subarray(14 + headerSize);
      const verifierView = new DataView(verifierBytes.buffer, verifierBytes.byteOffset, verifierBytes.byteLength);
      const saltSize = readU32LE(verifierView, 0);
      const salt = verifierBytes.subarray(4, 4 + saltSize);
      const encryptedVerifier = verifierBytes.subarray(4 + saltSize, 4 + saltSize + 16);
      const encryptedVerifierHash = verifierBytes.subarray(4 + saltSize + 20, 4 + saltSize + 20 + 20);
      const keyBits = header.keySize === 0 ? 40 : header.keySize;
      return { filePassOffset: off, filePassSize: size, salt, encryptedVerifier, encryptedVerifierHash, keyBits };
    }
    off += 4 + size;
  }
  return null;
}

// Decrypts a raw BIFF8 Workbook stream buffer (no CFB dependency - kept pure/standalone so the
// record-walk bookkeeping can be unit-tested directly against a synthetic buffer, independent of
// the CFB reader). Returns a same-size plaintext Workbook stream buffer.
async function decryptBiff8Workbook(workbookBytes, password) {
  const filePass = findFilePassRc4CryptoApi(workbookBytes);
  if (!filePass) throw new UnsupportedEncryptionError("No FilePass record found (file is not encrypted)");
  if (filePass.unsupported) {
    throw new UnsupportedEncryptionError("This legacy Excel encryption scheme (XOR obfuscation or plain RC4) is not supported");
  }

  const verifyKey = await rc4CryptoApiMakeKey(password, filePass.salt, filePass.keyBits, 0);
  const verifyPlain = rc4Decrypt(verifyKey, concatBytes(filePass.encryptedVerifier, filePass.encryptedVerifierHash));
  const verifier = verifyPlain.subarray(0, 16);
  const verifierHash = verifyPlain.subarray(16, 36);
  const expectedHash = await sha1(verifier);
  if (!bytesEqual(expectedHash, verifierHash.subarray(0, expectedHash.length))) {
    throw new IncorrectPasswordError();
  }

  // Walk every BIFF record, decrypting bodies (RC4-CryptoAPI, re-keyed every 1024 bytes) while
  // passing specific record types through unencrypted, and leaving BoundSheet8's first 4 bytes
  // (lbPlyPos) unencrypted - matching real Excel's own encryption scope exactly.
  const RC4_BLOCK_SIZE = 1024;
  const view = new DataView(workbookBytes.buffer, workbookBytes.byteOffset, workbookBytes.byteLength);
  const out = new Uint8Array(workbookBytes.length);
  out.set(workbookBytes.subarray(0, 4 + readU16LE(view, 2))); // copy BOF record as-is

  // Collect the byte ranges (within the stream) that are actually RC4-encrypted, in order, so we
  // can decrypt them as one continuous re-keyed-every-1024-bytes ciphertext stream.
  const encryptedRanges = []; // { start, end, destStart } - destStart is where plaintext goes in `out`
  let off = 4 + readU16LE(view, 2);
  while (off + 4 <= workbookBytes.length) {
    const num = readU16LE(view, off);
    const size = readU16LE(view, off + 2);
    const bodyStart = off + 4;
    const bodyEnd = bodyStart + size;
    out.set(workbookBytes.subarray(off, bodyStart), off); // record header itself is never encrypted

    if (num === BIFF_RECORD.FilePass) {
      out.fill(0, bodyStart, bodyEnd); // content irrelevant; zero it like the reference implementation
    } else if (BIFF_UNENCRYPTED_PASSTHROUGH.has(num)) {
      out.set(workbookBytes.subarray(bodyStart, bodyEnd), bodyStart);
    } else if (num === BIFF_RECORD.BoundSheet8) {
      out.set(workbookBytes.subarray(bodyStart, bodyStart + 4), bodyStart); // lbPlyPos: unencrypted
      encryptedRanges.push({ start: bodyStart + 4, end: bodyEnd, destStart: bodyStart + 4 });
    } else {
      encryptedRanges.push({ start: bodyStart, end: bodyEnd, destStart: bodyStart });
    }
    off = bodyEnd;
  }

  // Concatenate the encrypted ranges into one buffer, decrypt as a single RC4-CryptoAPI stream
  // (re-keyed every RC4_BLOCK_SIZE bytes), then scatter the plaintext back to its destinations.
  const cipherConcat = concatBytes(...encryptedRanges.map((r) => workbookBytes.subarray(r.start, r.end)));
  const plainConcat = new Uint8Array(cipherConcat.length);
  let block = 1; // block 0 was used for the verifier; stream data starts at block 1
  for (let pos = 0; pos < cipherConcat.length; pos += RC4_BLOCK_SIZE) {
    const chunk = cipherConcat.subarray(pos, Math.min(pos + RC4_BLOCK_SIZE, cipherConcat.length));
    const key = await rc4CryptoApiMakeKey(password, filePass.salt, filePass.keyBits, block);
    plainConcat.set(rc4Decrypt(key, chunk), pos);
    block += 1;
  }
  let consumed = 0;
  for (const r of encryptedRanges) {
    const len = r.end - r.start;
    out.set(plainConcat.subarray(consumed, consumed + len), r.destStart);
    consumed += len;
  }

  return out;
}

async function decryptXlsBiff8(cfb, password) {
  const workbookEntry = cfb.getEntry("Workbook") || cfb.getEntry("Book");
  if (!workbookEntry) throw new UnsupportedEncryptionError("No Workbook/Book stream found");
  const decrypted = await decryptBiff8Workbook(workbookEntry.read(), password);
  return workbookEntry.patch(decrypted);
}

// ================= Top-level: decrypt an Excel file's raw bytes given a password =================

// Returns decrypted bytes ready for XLSX.read(): a plain OOXML zip for .xlsx, or a whole
// (patched) CFB file for .xls. Throws IncorrectPasswordError / UnsupportedEncryptionError.
export async function decryptExcelBuffer(buffer, password, fileType) {
  const bytes = u8(buffer);
  if (fileType === "xls") {
    const cfb = parseCFB(bytes);
    return decryptXlsBiff8(cfb, password);
  }
  return decryptXlsxBuffer(bytes, password);
}

export {
  aesEcbDecrypt,
  aesCbcDecryptRaw,
  rc4Decrypt,
  sha1,
  sha512,
  parseAgileEncryptionInfo,
  agileDeriveIteratedHash,
  agileDeriveKey,
  AGILE_BLOCK_KEY_VERIFIER_INPUT,
  AGILE_BLOCK_KEY_VERIFIER_HASH,
  AGILE_BLOCK_KEY_KEY_VALUE,
  standardDeriveKey,
  rc4CryptoApiMakeKey,
  decryptXlsxAgile,
  decryptXlsxStandard,
  decryptXlsBiff8,
  decryptBiff8Workbook,
  findFilePassRc4CryptoApi,
};
