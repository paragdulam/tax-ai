import * as pdfjsLib from "./vendor/pdfjs/pdf.mjs";
import { decryptExcelBuffer, IncorrectPasswordError } from "./statement-crypto.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;

const VIEWS = {
  statements: { title: "Statements - TaxShield AI", search: "Search statements, forms, IDs..." },
  review: { title: "TaxShield AI - Transaction Review", search: "Search transactions..." },
  groups: { title: "Groups - TaxShield AI", search: "Search groups..." },
  insights: { title: "Tax Insights - TaxShield AI", search: "Search insights, documents, or data..." },
};

const ACTIVE_CLASSES = ["text-primary", "font-semibold", "border-r-2", "border-primary", "bg-surface-container-low"];
const INACTIVE_CLASSES = ["text-on-surface-variant", "hover:text-on-surface", "hover:bg-surface-container-low"];

const TRANSACTION_CATEGORIES = ["Income", "Personal Expense", "Business Expense", "Internal Transfer"];
const CLASSIFICATION_SELECT_CLASSES =
  "px-2 py-1 text-[11px] font-semibold rounded-sm bg-surface-container border border-outline-variant text-on-surface focus:ring-primary focus:border-primary";

const GROUP_TYPES = ["Product Purchase", "Home Loan", "Car Loan", "Personal Loan", "Other"];
const GROUP_TYPE_ICONS = {
  "Product Purchase": "shopping_bag",
  "Home Loan": "home",
  "Car Loan": "directions_car",
  "Personal Loan": "account_balance_wallet",
  Other: "label",
};

let activeViewName = null;

function setActiveView(name) {
  if (!VIEWS[name]) return;
  activeViewName = name;

  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("hidden", section.dataset.view !== name);
  });

  document.querySelectorAll(".nav-link").forEach((link) => {
    const isActive = link.dataset.view === name;
    link.classList.toggle("active", isActive);
    ACTIVE_CLASSES.forEach((c) => link.classList.toggle(c, isActive));
    INACTIVE_CLASSES.forEach((c) => link.classList.toggle(c, !isActive));

    const icon = link.querySelector(".nav-icon");
    icon.style.fontVariationSettings = isActive ? "'FILL' 1" : "'FILL' 0";
  });

  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    searchInput.placeholder = VIEWS[name].search;
    searchInput.value = "";
  }
  reviewSearchQuery = "";

  const dateFromInput = document.getElementById("review-date-from");
  const dateToInput = document.getElementById("review-date-to");
  if (dateFromInput) dateFromInput.value = "";
  if (dateToInput) dateToInput.value = "";
  reviewDateFrom = "";
  reviewDateTo = "";

  const fileFilterSelect = document.getElementById("review-file-filter");
  if (fileFilterSelect) fileFilterSelect.value = "";
  reviewStatementFilter = "";

  document.title = VIEWS[name].title;
  window.location.hash = name;

  if (name === "review") loadReviewScreen();
  if (name === "groups") loadGroupsScreen();
  if (name === "insights") loadInsightsScreen();
}

document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    setActiveView(link.dataset.view);
  });
});

document.getElementById("review-table-body")?.addEventListener("click", async (event) => {
  const viewStatementBtn = event.target.closest("button[data-view-statement-id]");
  if (viewStatementBtn) {
    openStatementViewer(viewStatementBtn.dataset.viewStatementId, viewStatementBtn.dataset.viewStatementName);
    return;
  }

  const groupBadgeBtn = event.target.closest("button[data-group-id]");
  if (groupBadgeBtn) {
    groupsFocusGroupId = groupBadgeBtn.dataset.groupId;
    setActiveView("groups");
    return;
  }

  const toggleIncludeBtn = event.target.closest("button[data-toggle-include]");
  if (toggleIncludeBtn) {
    const id = toggleIncludeBtn.dataset.toggleInclude;
    const nextValue = toggleIncludeBtn.dataset.currentInclude === "1" ? 0 : 1;
    await ensureStatementsDb();
    await invoke("plugin:sql|execute", {
      db: STATEMENTS_DB,
      query: "UPDATE transactions SET include_in_totals = $1 WHERE id = $2",
      values: [nextValue, id],
    });
    await renderReviewTransactions();
    return;
  }

  const addToGroupBtn = event.target.closest("button[data-add-to-group]");
  if (addToGroupBtn) {
    openGroupEditorModal([addToGroupBtn.dataset.addToGroup]);
    return;
  }

  const removeFromGroupBtn = event.target.closest("button[data-remove-from-group]");
  if (removeFromGroupBtn) {
    await ensureStatementsDb();
    await invoke("plugin:sql|execute", {
      db: STATEMENTS_DB,
      query: "UPDATE transactions SET group_id = NULL WHERE id = $1",
      values: [removeFromGroupBtn.dataset.removeFromGroup],
    });
    await cleanupEmptyGroups();
    await renderReviewTransactions();
  }
});

document.getElementById("review-table-body")?.addEventListener("change", async (event) => {
  const rowCheckbox = event.target.closest("input.transaction-row-checkbox");
  if (rowCheckbox) {
    const id = rowCheckbox.dataset.id;
    if (rowCheckbox.checked) selectedTransactionIds.add(id);
    else selectedTransactionIds.delete(id);
    updateReviewSelectAllCheckbox();
    updateGroupToolbar();
    return;
  }

  const select = event.target.closest("select[data-classification-select]");
  if (!select) return;

  const transactionId = select.dataset.transactionId;
  if (!transactionId) return;

  const classification = select.value;
  const description = select.dataset.transactionDescription || "";
  const category = classification || "Uncategorized";

  await ensureStatementsDb();
  await invoke("plugin:sql|execute", {
    db: STATEMENTS_DB,
    query: "UPDATE transactions SET category = $1 WHERE id = $2",
    values: [category, transactionId],
  });

  if (classification && description.trim()) {
    await promptForSimilarTransactions(transactionId, description, classification);
  }
});

// ================= Similar Transaction Bulk-Classify =================

async function promptForSimilarTransactions(transactionId, description, classification) {
  await ensureStatementsDb();
  const similar = await invoke("plugin:sql|select", {
    db: STATEMENTS_DB,
    query:
      "SELECT t.id, t.date, t.description, t.amount, t.category, s.currency AS statement_currency FROM transactions t LEFT JOIN statements s ON s.id = t.statement_id WHERE t.id != $1 AND LOWER(TRIM(t.description)) = LOWER(TRIM($2)) AND (t.category IS NULL OR LOWER(t.category) != LOWER($3)) ORDER BY t.date DESC",
    values: [transactionId, description, classification],
  });
  if (similar.length === 0) return;

  const overlay = document.getElementById("similar-transactions-overlay");
  const subtitle = document.getElementById("similar-transactions-subtitle");
  const body = document.getElementById("similar-transactions-body");
  if (!overlay || !subtitle || !body) return;

  subtitle.textContent = `Found ${similar.length} other transaction${similar.length === 1 ? "" : "s"} with the same description as "${description}". Mark ${similar.length === 1 ? "it" : "them"} as ${classification} too?`;

  body.innerHTML = similar
    .map(
      (row) => `<label class="flex items-center gap-3 p-2 rounded hover:bg-surface-container-low cursor-pointer">
        <input type="checkbox" class="similar-transaction-checkbox rounded-sm border-outline-variant text-primary focus:ring-primary shrink-0" data-transaction-id="${row.id}" checked />
        <span class="flex-1 min-w-0">
          <span class="block text-body-sm font-body-sm font-semibold text-on-surface truncate">${escapeHtml(row.description || "(no description)")}</span>
          <span class="block text-label-caps font-label-caps text-on-surface-variant">${formatTransactionDate(row.date)} &middot; ${row.category || "Uncategorized"}</span>
        </span>
        <span class="text-mono-data font-mono-data font-semibold shrink-0">${formatCurrency(row.amount, row.statement_currency)}</span>
      </label>`,
    )
    .join("");

  overlay.classList.remove("hidden");

  const closeModal = () => {
    overlay.classList.add("hidden");
    body.innerHTML = "";
  };

  const applyToIds = async (ids) => {
    if (ids.length === 0) {
      closeModal();
      return;
    }
    await ensureStatementsDb();
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(", ");
    await invoke("plugin:sql|execute", {
      db: STATEMENTS_DB,
      query: `UPDATE transactions SET category = $1 WHERE id IN (${placeholders})`,
      values: [classification, ...ids],
    });
    closeModal();
    await renderReviewTransactions();
  };

  document.getElementById("similar-transactions-close").onclick = closeModal;
  document.getElementById("similar-transactions-mark-all").onclick = () => applyToIds(similar.map((row) => row.id));
  document.getElementById("similar-transactions-mark-selected").onclick = () => {
    const checkedIds = Array.from(body.querySelectorAll(".similar-transaction-checkbox:checked")).map(
      (el) => el.dataset.transactionId,
    );
    applyToIds(checkedIds);
  };
}

// ================= Statement Viewer =================

function closeStatementViewer() {
  document.getElementById("statement-viewer-overlay")?.classList.add("hidden");
  const body = document.getElementById("statement-viewer-body");
  if (body) body.innerHTML = "";
}

document.getElementById("statement-viewer-close")?.addEventListener("click", closeStatementViewer);
document.getElementById("statement-viewer-overlay")?.addEventListener("click", (event) => {
  if (event.target.id === "statement-viewer-overlay") closeStatementViewer();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeStatementViewer();
});

function buildStatementPreviewTable(rows) {
  const table = document.createElement("table");
  table.className = "w-full text-left border-collapse text-mono-data-sm font-mono-data-sm";
  rows.forEach((row, i) => {
    const tr = document.createElement("tr");
    tr.className = i === 0 ? "bg-surface-container-low font-semibold" : "border-b border-outline-variant";
    row.forEach((cell) => {
      const td = document.createElement("td");
      td.className = "p-table-cell-padding whitespace-nowrap";
      td.textContent = excelCellToString(cell);
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  return table;
}

async function renderStatementPreview(body, statement) {
  const ext = (statement.file_type || "").toLowerCase();
  body.innerHTML = "";
  body.classList.remove("flex", "items-center", "justify-center");

  // Password-protected files are decrypted automatically using the stored password - no prompt
  // is shown here; if none is stored yet, the user is pointed at the row's "Unlock" action.
  const password = ext === "pdf" || ext === "xlsx" || ext === "xls" ? await getStoredStatementPassword(statement.id).catch(() => null) : null;

  if (ext === "pdf") {
    const { buffer, password: resolvedPassword } = await getStatementFileBytes(statement, password);
    const pdf = await pdfjsLib.getDocument({ data: buffer.slice(0), password: resolvedPassword || undefined }).promise;
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.3 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.className = "mx-auto mb-4 border border-outline-variant shadow-sm";
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      body.appendChild(canvas);
    }
  } else if (ext === "csv") {
    const rows = parseCsvContent(base64ToText(statement.content_base64));
    body.appendChild(buildStatementPreviewTable(rows));
  } else if (ext === "xlsx" || ext === "xls") {
    const { buffer } = await getStatementFileBytes(statement, password);
    const workbook = window.XLSX.read(new Uint8Array(buffer), { type: "array" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = sheetName ? workbook.Sheets[sheetName] : null;
    const rows = worksheet
      ? window.XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false, defval: "" })
      : [];
    body.appendChild(buildStatementPreviewTable(rows));
  } else {
    body.classList.add("flex", "items-center", "justify-center");
    body.textContent = "Preview isn't available for this file type.";
  }
}

async function openStatementViewer(statementId, filename) {
  const overlay = document.getElementById("statement-viewer-overlay");
  const title = document.getElementById("statement-viewer-title");
  const body = document.getElementById("statement-viewer-body");
  if (!overlay || !title || !body) return;

  title.textContent = filename || "Statement";
  body.className = "flex-1 overflow-auto p-4 flex items-center justify-center text-body-sm font-body-sm text-on-surface-variant";
  body.textContent = "Loading…";
  overlay.classList.remove("hidden");

  try {
    await ensureStatementsDb();
    const rows = await invoke("plugin:sql|select", {
      db: STATEMENTS_DB,
      query: "SELECT id, filename, file_type, content_base64, bank_name, account_last4, display_name FROM statements WHERE id = $1",
      values: [statementId],
    });
    const statement = rows[0];
    if (!statement) {
      body.textContent = "This statement file is no longer available.";
      return;
    }
    title.textContent = resolveStatementDisplayName(statement.display_name, statement.bank_name, statement.account_last4, statement.filename);
    await renderStatementPreview(body, statement);
  } catch (err) {
    if (err instanceof PasswordRequiredError) {
      body.className = "flex-1 overflow-auto p-4 flex items-center justify-center text-body-sm font-body-sm text-on-surface-variant";
      body.textContent = "This file is password-protected. Use “Unlock” on the Statements screen to view it.";
      return;
    }
    console.error(`Failed to load statement ${statementId}`, err);
    body.className = "flex-1 overflow-auto p-4 flex items-center justify-center text-body-sm font-body-sm text-error";
    body.textContent = "Failed to load this file.";
  }
}

// ================= Statement Management =================

const invoke = window.__TAURI__.core.invoke;
const STATEMENTS_DB = "sqlite:taxai.db";
const MAX_STATEMENT_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const ALLOWED_STATEMENT_EXTENSIONS = new Set(["xlsx", "xls", "csv", "pdf"]);
const STATEMENT_STATUS_FAILED_TO_PARSE = "failed_to_parse";
const STATEMENT_STATUS_PASSWORD_REQUIRED = "password_required";

let dbReadyPromise = null;
function ensureStatementsDb() {
  if (!dbReadyPromise) {
    dbReadyPromise = invoke("plugin:sql|load", { db: STATEMENTS_DB });
  }
  return dbReadyPromise;
}

function statementFileExtension(filename) {
  const match = /\.([^.]+)$/.exec(filename);
  return match ? match[1].toLowerCase() : "";
}

function formatStatementSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function formatStatementDate(isoString) {
  return isoString.slice(0, 10);
}

// Indian financial year: April 1 - March 31.
function financialYearInfo(isoDate) {
  const [year, month] = isoDate.slice(0, 10).split("-").map(Number);
  const startYear = month >= 4 ? year : year - 1;
  return { startYear, label: `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}` };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function sha256Hex(buffer) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function formatAccountLabel(bankName, last4) {
  return bankName ? `${bankName}${last4 ? ` - ${last4}` : ""}` : null;
}

// A user-set display_name always wins; otherwise fall back to the auto-detected bank label, then
// the raw filename. This is the one place that decides a statement's name - every screen that
// shows a statement's name (Statements list, Review screen, file filter dropdown, viewer title)
// goes through this so a rename is reflected everywhere at once.
function resolveStatementDisplayName(displayName, bankName, last4, filename) {
  return displayName || formatAccountLabel(bankName, last4) || filename || "Unknown file";
}

function showStatementError(message) {
  const el = document.getElementById("statement-error");
  if (!el) return;
  if (!message) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.textContent = message;
  el.classList.remove("hidden");
}

// ================= Password Protection =================

class PasswordRequiredError extends Error {
  constructor() {
    super("Password required");
    this.name = "PasswordRequiredError";
  }
}

const APP_SECRETS_MASTER_KEY_ID = "master_key";
let masterKeyPromise = null;

// Local, app-generated AES-GCM key used to encrypt stored statement passwords at rest. Generated
// once and kept in the same local SQLite database (app_secrets table) - this protects against
// casual inspection of a DB export/backup, but (since the key lives alongside what it encrypts)
// not against an attacker with full read access to the app's local data directory.
async function getOrCreateMasterKey() {
  if (!masterKeyPromise) {
    masterKeyPromise = (async () => {
      await ensureStatementsDb();
      const rows = await invoke("plugin:sql|select", {
        db: STATEMENTS_DB,
        query: "SELECT key_base64 FROM app_secrets WHERE id = $1",
        values: [APP_SECRETS_MASTER_KEY_ID],
      });
      if (rows.length > 0) {
        return crypto.subtle.importKey("raw", base64ToArrayBuffer(rows[0].key_base64), "AES-GCM", false, ["encrypt", "decrypt"]);
      }
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
      const raw = await crypto.subtle.exportKey("raw", key);
      await invoke("plugin:sql|execute", {
        db: STATEMENTS_DB,
        query: "INSERT INTO app_secrets (id, key_base64, created_at) VALUES ($1, $2, $3)",
        values: [APP_SECRETS_MASTER_KEY_ID, arrayBufferToBase64(raw), new Date().toISOString()],
      });
      return key;
    })();
  }
  return masterKeyPromise;
}

async function encryptStoredPassword(password) {
  const key = await getOrCreateMasterKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(password));
  return { passwordEncrypted: arrayBufferToBase64(ciphertext), passwordIv: arrayBufferToBase64(iv.buffer) };
}

async function decryptStoredPassword(passwordEncryptedBase64, passwordIvBase64) {
  const key = await getOrCreateMasterKey();
  const iv = new Uint8Array(base64ToArrayBuffer(passwordIvBase64));
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, base64ToArrayBuffer(passwordEncryptedBase64));
  return new TextDecoder().decode(plaintext);
}

async function saveStatementPassword(statementId, password) {
  const { passwordEncrypted, passwordIv } = await encryptStoredPassword(password);
  await ensureStatementsDb();
  await invoke("plugin:sql|execute", {
    db: STATEMENTS_DB,
    query: "UPDATE statements SET password_encrypted = $1, password_iv = $2, status = 'saved' WHERE id = $3",
    values: [passwordEncrypted, passwordIv, statementId],
  });
}

// Looks up and decrypts a statement's stored password, or null if none is stored.
async function getStoredStatementPassword(statementId) {
  await ensureStatementsDb();
  const rows = await invoke("plugin:sql|select", {
    db: STATEMENTS_DB,
    query: "SELECT password_encrypted, password_iv FROM statements WHERE id = $1",
    values: [statementId],
  });
  const row = rows[0];
  if (!row || !row.password_encrypted || !row.password_iv) return null;
  return decryptStoredPassword(row.password_encrypted, row.password_iv);
}

// Shared access point for a statement's (possibly encrypted) file content. For unprotected files
// and CSV, returns the original bytes unchanged. For a password-protected Excel file, returns
// already-decrypted bytes ready for XLSX.read(). For a password-protected PDF, decryption happens
// inside pdfjsLib.getDocument() itself, so this returns the original bytes plus the verified
// password for the caller to pass through. Throws PasswordRequiredError (no password supplied for
// a protected file) or IncorrectPasswordError (wrong password supplied).
async function getStatementFileBytes(statement, password) {
  const buffer = base64ToArrayBuffer(statement.content_base64);
  const ext = (statement.file_type || "").toLowerCase();

  if (ext === "xlsx" || ext === "xls") {
    try {
      window.XLSX.read(new Uint8Array(buffer), { type: "array" });
      return { buffer, password: null };
    } catch (err) {
      if (!/password-protected/i.test((err && err.message) || "")) throw err;
    }
    if (!password) throw new PasswordRequiredError();
    const decrypted = await decryptExcelBuffer(new Uint8Array(buffer), password, ext);
    return { buffer: decrypted, password: null };
  }

  if (ext === "pdf") {
    try {
      await pdfjsLib.getDocument({ data: buffer.slice(0), password: password || undefined }).promise;
      return { buffer, password: password || null };
    } catch (err) {
      if (!(err instanceof pdfjsLib.PasswordException)) throw err;
      if (err.code === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD) throw new IncorrectPasswordError();
      throw new PasswordRequiredError();
    }
  }

  return { buffer, password: null };
}

// ================= Password prompt modal =================

// Holds the active prompt's submit handler while the modal is open (rebuilt fresh on every
// promptForPassword() call); null when no prompt is showing. Kept separate from the outer
// Promise's own resolve function, which each attemptSubmit closure calls directly.
let activePasswordPrompt = null;

function closePasswordPrompt() {
  document.getElementById("statement-password-overlay")?.classList.add("hidden");
  activePasswordPrompt = null;
}

// Shows the password modal for `subtitle` (typically a filename); resolves with the entered
// password string, or null if the user cancels. Automatically retries on IncorrectPasswordError
// thrown by `attemptFn(password)`, showing an inline error and keeping the modal open.
function promptForPassword(subtitle, attemptFn) {
  const overlay = document.getElementById("statement-password-overlay");
  const subtitleEl = document.getElementById("statement-password-subtitle");
  const input = document.getElementById("statement-password-input");
  const errorEl = document.getElementById("statement-password-error");
  if (!overlay || !input) return Promise.resolve(null);

  subtitleEl.textContent = subtitle || "";
  input.value = "";
  errorEl.classList.add("hidden");
  errorEl.textContent = "";
  overlay.classList.remove("hidden");

  return new Promise((resolveOuter) => {
    async function attemptSubmit(password) {
      if (password === null) {
        closePasswordPrompt();
        resolveOuter(null);
        return;
      }
      try {
        await attemptFn(password);
        closePasswordPrompt();
        resolveOuter(password);
      } catch (err) {
        if (err instanceof IncorrectPasswordError) {
          errorEl.textContent = "Incorrect password. Try again.";
          errorEl.classList.remove("hidden");
          input.value = "";
          input.focus();
          // activePasswordPrompt keeps pointing at this same attemptSubmit - modal stays open
        } else {
          console.error("Password verification failed", err);
          errorEl.textContent = "Something went wrong verifying this password.";
          errorEl.classList.remove("hidden");
        }
      }
    }
    activePasswordPrompt = attemptSubmit;
    input.focus();
  });
}

document.getElementById("statement-password-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.getElementById("statement-password-input");
  activePasswordPrompt?.(input.value);
});
document.getElementById("statement-password-cancel")?.addEventListener("click", () => {
  activePasswordPrompt?.(null);
});
document.getElementById("statement-password-overlay")?.addEventListener("click", (event) => {
  if (event.target.id === "statement-password-overlay") activePasswordPrompt?.(null);
});

// ================= Transaction Extraction =================

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function base64ToText(base64) {
  return new TextDecoder("utf-8").decode(base64ToArrayBuffer(base64));
}

function parseDate(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;

  let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;

  match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(str);
  if (match) {
    let [, a, b, y] = match;
    if (y.length === 2) y = (Number(y) < 70 ? "20" : "19") + y;
    // Separator-delimited dates are ambiguous (DD/MM vs MM/DD). Prefer day-first,
    // since that's the convention used by the bank/card statements this app parses,
    // falling back to month-first only when day-first is impossible.
    let day = Number(a);
    let month = Number(b);
    if (month > 12 || day < 1) [day, month] = [month, day];
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const parsed = Date.parse(str);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return null;
}

function parseAmount(value) {
  if (value === null || value === undefined) return null;
  let str = String(value).trim();
  if (!str) return null;

  let negative = false;
  if (/^\(.*\)$/.test(str)) {
    negative = true;
    str = str.slice(1, -1);
  }
  if (str.startsWith("-")) {
    negative = true;
    str = str.slice(1);
  } else if (str.startsWith("+")) {
    str = str.slice(1);
  }
  str = str.replace(/[$₹€£,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(str)) return null;
  const num = Number(str);
  if (Number.isNaN(num)) return null;
  return negative ? -num : num;
}

function detectColumns(headerRow) {
  const headers = headerRow.map((h) => (h ?? "").toString().trim().toLowerCase());
  const findIndex = (patterns) => headers.findIndex((h) => patterns.some((p) => p.test(h)));

  // Prefer an exact "Amount"/"Amt" header; otherwise take the first column whose name
  // contains "amount" as a whole word, skipping foreign-currency amount columns
  // (e.g. "Intl.Amount" on card statements) in favor of the local-currency one.
  let amountCol = findIndex([/^amount$/, /^amt$/]);
  if (amountCol === -1) {
    amountCol = headers.findIndex((h) => /\bamount\b/.test(h) && !/\b(intl|international|foreign)\b/.test(h));
  }
  if (amountCol === -1) amountCol = findIndex([/\bamount\b/]);

  return {
    dateCol: findIndex([/^date$/, /transaction date/, /posted date/, /post date/, /value date/, /txn date/]),
    descCol: findIndex([/^description$/, /memo/, /merchant/, /payee/, /details/, /narrative/, /narration/, /particulars/]),
    amountCol,
    debitCol: findIndex([/^debit$/, /withdrawal/, /money out/]),
    creditCol: findIndex([/^credit$/, /deposit/, /money in/]),
    signCol: findIndex([/^cr\/dr$/, /^dr\/cr$/, /^cr\s*\/\s*dr$/, /^dr\s*\/\s*cr$/]),
  };
}

function rowLooksLikeHeader(cols) {
  const hasAmount = cols.amountCol !== -1;
  const hasDebitCredit = cols.debitCol !== -1 || cols.creditCol !== -1;
  return cols.dateCol !== -1 && (hasAmount || hasDebitCredit);
}

// Real-world statement exports (bank/card) usually prefix the actual transaction table
// with several rows of account info, addresses, and balance summaries. Scan for the
// first row that actually looks like a transaction table header instead of assuming row 0.
function findHeaderRowIndex(rows) {
  const MAX_PREAMBLE_ROWS = 40;
  const limit = Math.min(rows.length, MAX_PREAMBLE_ROWS);
  for (let i = 0; i < limit; i++) {
    if (rowLooksLikeHeader(detectColumns(rows[i]))) return i;
  }
  return -1;
}

function extractRowsFromTable(headerRow, dataRows, isCreditCard) {
  const cols = detectColumns(headerRow);
  const hasAmount = cols.amountCol !== -1;
  const hasDebitCredit = cols.debitCol !== -1 || cols.creditCol !== -1;
  if (cols.dateCol === -1 || (!hasAmount && !hasDebitCredit)) return [];

  const transactions = [];
  for (const row of dataRows) {
    const date = parseDate(row[cols.dateCol]);
    if (date === null) continue;

    let amount;
    if (hasDebitCredit) {
      const debit = cols.debitCol !== -1 ? parseAmount(row[cols.debitCol]) : null;
      const credit = cols.creditCol !== -1 ? parseAmount(row[cols.creditCol]) : null;
      if (debit === null && credit === null) continue;
      amount = (credit ?? 0) - Math.abs(debit ?? 0);
    } else {
      const raw = parseAmount(row[cols.amountCol]);
      if (raw === null) continue;
      if (cols.signCol !== -1) {
        const sign = (row[cols.signCol] ?? "").toString().trim().toLowerCase();
        amount = sign.startsWith("d") ? -Math.abs(raw) : Math.abs(raw);
      } else {
        // A bare signed "Amount" column with no Debit/Credit indicator means opposite things
        // depending on the source: on a bank statement positive = money in, but on a credit card
        // statement positive conventionally means a charge added to what you owe (an expense) -
        // flip it so it matches our "positive = deposit" convention either way.
        amount = isCreditCard ? -raw : raw;
      }
    }

    const description = cols.descCol !== -1 ? (row[cols.descCol] ?? "").toString().trim() : "";
    transactions.push({ date, description, amount });
  }
  return transactions;
}

function parseCsvLine(line) {
  const cells = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

function parseCsvContent(text) {
  return text
    .split(/\r\n|\r|\n/)
    .filter((line) => line.length > 0)
    .map(parseCsvLine);
}

function excelCellToString(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") return "";
  return String(value);
}

async function extractExcelTransactions(buffer, isCreditCard) {
  const workbook = window.XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const worksheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!worksheet) return [];

  const rows = window.XLSX.utils
    .sheet_to_json(worksheet, { header: 1, blankrows: false, defval: "" })
    .map((row) => row.map(excelCellToString));

  const headerIdx = findHeaderRowIndex(rows);
  if (headerIdx === -1) return [];
  return extractRowsFromTable(rows[headerIdx], rows.slice(headerIdx + 1), isCreditCard);
}

function extractCsvTransactions(text, isCreditCard) {
  const rows = parseCsvContent(text);
  const headerIdx = findHeaderRowIndex(rows);
  if (headerIdx === -1) return [];
  return extractRowsFromTable(rows[headerIdx], rows.slice(headerIdx + 1), isCreditCard);
}

function groupPdfTextItemsIntoLines(items) {
  const lineMap = new Map();
  for (const item of items) {
    const y = Math.round(item.transform[5]);
    if (!lineMap.has(y)) lineMap.set(y, []);
    lineMap.get(y).push(item);
  }
  const sortedYs = Array.from(lineMap.keys()).sort((a, b) => b - a);
  return sortedYs.map((y) =>
    lineMap
      .get(y)
      .sort((a, b) => a.transform[4] - b.transform[4])
      .map((item) => item.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

const PDF_TRANSACTION_LINE_RE =
  /^(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\s+(.+?)\s+(\(?-?\+?\$?[\d,]+\.\d{2}\)?)$/;

// Some credit card statements (e.g. SBI Card) don't sign amounts with +/- at all - every line ends
// with a literal "Credit"/"Debit"/"Monthly Installments" word right before the amount instead, and
// everything is otherwise printed as a plain positive number. Try this more specific shape first;
// "Debit" (a purchase) becomes negative, "Credit" (a refund/cashback/payment) stays positive.
const PDF_TYPED_TRANSACTION_LINE_RE =
  /^(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\s+(.+?)\s+(credit|debit|monthly installments)\s+([\d,]+\.\d{2})$/i;

async function extractPdfTransactions(buffer, password) {
  const doc = await pdfjsLib.getDocument({ data: buffer, password: password || undefined }).promise;
  const transactions = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const lines = groupPdfTextItemsIntoLines(textContent.items);

    for (const line of lines) {
      const typedMatch = PDF_TYPED_TRANSACTION_LINE_RE.exec(line);
      if (typedMatch) {
        const date = parseDate(typedMatch[1]);
        const rawAmount = parseAmount(typedMatch[4]);
        if (date === null || rawAmount === null) continue;
        const amount = typedMatch[3].toLowerCase() === "debit" ? -Math.abs(rawAmount) : Math.abs(rawAmount);
        transactions.push({ date, description: typedMatch[2].trim(), amount });
        continue;
      }

      const match = PDF_TRANSACTION_LINE_RE.exec(line);
      if (!match) continue;
      const date = parseDate(match[1]);
      const amount = parseAmount(match[3]);
      if (date === null || amount === null) continue;
      transactions.push({ date, description: match[2].trim(), amount });
    }
  }

  return transactions;
}

const CREDIT_CARD_KEYWORDS = [
  "credit card statement",
  "minimum amount due",
  "credit limit",
  "payment due date",
  "total amount due",
  "reward points",
];
const SAVINGS_ACCOUNT_KEYWORDS = [
  "savings account",
  "ifsc",
  "balance carried forward",
  "opening balance",
  "closing balance",
  "account number",
];
// Current-account exports (e.g. ICICI's net-banking "Transaction History" download) often don't
// say "current account" anywhere in the sheet — these are the distinctive column/section labels
// that show up instead.
const CURRENT_ACCOUNT_KEYWORDS = ["detailed statement", "txn posted date", "chequeno", "cheque no"];
// Filename pattern is a strong, standalone signal: this bank's current-account export tool always
// names files "OpTransactionHistory...", regardless of what the sheet content says.
const CURRENT_ACCOUNT_FILENAME_RE = /^optransactionhistory/i;

function detectAccountType(rawText, filename) {
  if (filename && CURRENT_ACCOUNT_FILENAME_RE.test(filename)) return "current";

  const text = rawText.toLowerCase();
  const scores = {
    credit_card: CREDIT_CARD_KEYWORDS.filter((keyword) => text.includes(keyword)).length,
    savings: SAVINGS_ACCOUNT_KEYWORDS.filter((keyword) => text.includes(keyword)).length,
    current: CURRENT_ACCOUNT_KEYWORDS.filter((keyword) => text.includes(keyword)).length,
  };
  const [bestType, bestScore] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return bestScore > 0 ? bestType : "unknown";
}

// Text before the transaction table's header row is where a statement's own account/bank details
// live (title, branch, IFSC, account number) - transaction narrations after that point routinely
// mention *other* people's banks (UPI/NEFT counterparties), so keeping the two separate avoids
// picking up a counterparty's bank/account as if it were the statement owner's.
async function getStatementTextSections(statement, password) {
  const splitPreamble = (rows) => {
    const headerIdx = findHeaderRowIndex(rows);
    const preambleRows = headerIdx === -1 ? rows : rows.slice(0, headerIdx);
    return { fullText: rows.map((r) => r.join(" ")).join(" "), preambleText: preambleRows.map((r) => r.join(" ")).join(" ") };
  };

  if (statement.file_type === "csv") {
    return splitPreamble(parseCsvContent(base64ToText(statement.content_base64)));
  }
  if (statement.file_type === "xlsx" || statement.file_type === "xls") {
    const { buffer } = await getStatementFileBytes(statement, password);
    const workbook = window.XLSX.read(new Uint8Array(buffer), { type: "array" });
    const parts = workbook.SheetNames.map((name) =>
      splitPreamble(
        window.XLSX.utils
          .sheet_to_json(workbook.Sheets[name], { header: 1, blankrows: false, defval: "" })
          .map((row) => row.map(excelCellToString)),
      ),
    );
    return {
      fullText: parts.map((p) => p.fullText).join(" "),
      preambleText: parts.map((p) => p.preambleText).join(" "),
    };
  }
  if (statement.file_type === "pdf") {
    const { buffer, password: resolvedPassword } = await getStatementFileBytes(statement, password);
    const doc = await pdfjsLib.getDocument({ data: buffer.slice(0), password: resolvedPassword || undefined }).promise;
    const pageTexts = [];
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const textContent = await page.getTextContent();
      pageTexts.push(textContent.items.map((item) => item.str).join(" "));
    }
    return { fullText: pageTexts.join(" "), preambleText: pageTexts[0] || "" };
  }
  return { fullText: "", preambleText: "" };
}

// IFSC's first 4 letters identify the bank (RBI standard) - reliable when a statement literally
// labels its own IFSC (e.g. "RTGS/NEFT IFSC :HDFC0000359"), which counterparty mentions elsewhere
// in the document normally don't do.
const IFSC_BANK_PREFIXES = {
  HDFC: "HDFC Bank",
  ICIC: "ICICI Bank",
  SBIN: "State Bank of India",
  UTIB: "Axis Bank",
  KKBK: "Kotak Mahindra Bank",
  IDFB: "IDFC FIRST Bank",
  INDB: "IndusInd Bank",
  YESB: "Yes Bank",
  RATN: "RBL Bank",
  CNRB: "Canara Bank",
  UBIN: "Union Bank of India",
  FDRL: "Federal Bank",
  PUNB: "Punjab National Bank",
  BARB: "Bank of Baroda",
  BKID: "Bank of India",
  IOBA: "Indian Overseas Bank",
  IBKL: "IDBI Bank",
  CBIN: "Central Bank of India",
  MAHB: "Bank of Maharashtra",
  UCBA: "UCO Bank",
  DBSS: "DBS Bank India",
  HSBC: "HSBC Bank",
  SCBL: "Standard Chartered Bank",
  CITI: "Citibank",
};
const BANK_NAME_KEYWORDS = [
  { re: /hdfc/i, name: "HDFC Bank" },
  { re: /icici/i, name: "ICICI Bank" },
  { re: /\bstate bank of india\b|\bsbi\b/i, name: "State Bank of India" },
  { re: /axis bank/i, name: "Axis Bank" },
  { re: /kotak/i, name: "Kotak Mahindra Bank" },
  { re: /idfc/i, name: "IDFC FIRST Bank" },
  { re: /indusind/i, name: "IndusInd Bank" },
  { re: /yes bank/i, name: "Yes Bank" },
  { re: /rbl bank/i, name: "RBL Bank" },
  { re: /canara/i, name: "Canara Bank" },
  { re: /union bank/i, name: "Union Bank of India" },
  { re: /federal bank/i, name: "Federal Bank" },
  { re: /punjab national bank|\bpnb\b/i, name: "Punjab National Bank" },
  { re: /bank of baroda/i, name: "Bank of Baroda" },
];

// Checked in this order so a currency's own symbol/code takes priority over a stray "$"/"USD" that
// might appear elsewhere in the document (e.g. a foreign-currency EMI line item on an otherwise
// INR-denominated Indian credit card statement, which literally spells out "USD" for that one
// line). Indian statements often label their amount column "Rs." rather than using "₹" or "INR".
const CURRENCY_PATTERNS = [
  { code: "INR", re: /₹|\binr\b|\brs\b/i },
  { code: "EUR", re: /€|\beur\b/i },
  { code: "GBP", re: /£|\bgbp\b/i },
  { code: "USD", re: /\$|\busd\b/i },
];

function detectCurrency(fullText) {
  for (const { code, re } of CURRENCY_PATTERNS) {
    if (re.test(fullText)) return code;
  }
  return "INR";
}

function detectBankName(fullText, filename) {
  const ifscMatch = /ifsc\s*[:\-]?\s*([a-z]{4}0[a-z0-9]{6})/i.exec(fullText);
  if (ifscMatch) {
    const bank = IFSC_BANK_PREFIXES[ifscMatch[1].slice(0, 4).toUpperCase()];
    if (bank) return bank;
  }
  if (filename && CURRENT_ACCOUNT_FILENAME_RE.test(filename)) return "ICICI Bank";

  let best = null;
  for (const { re, name } of BANK_NAME_KEYWORDS) {
    const matches = fullText.match(new RegExp(re.source, `${re.flags.replace("g", "")}g`));
    const count = matches ? matches.length : 0;
    if (count > 0 && (!best || count > best.count)) best = { name, count };
  }
  return best ? best.name : null;
}

// Masked numbers like "XXXXX2455" also show up for unrelated IDs (e.g. "Customer ID: XXXXX2455"),
// not just the account number - prefer a match whose nearby preceding text actually says
// account/a-c/savings, falling back to the first masked match only if none qualifies.
function findMaskedAccountNumber(text) {
  const re = /x{2,}(\d{4})\b/gi;
  let match;
  let fallback = null;
  while ((match = re.exec(text))) {
    const context = text.slice(Math.max(0, match.index - 40), match.index).toLowerCase();
    if (context.includes("account") || context.includes("a/c") || context.includes("savings")) {
      return match[1];
    }
    if (!fallback) fallback = match[1];
  }
  return fallback;
}

function detectAccountLast4(preambleText, fullText, filename) {
  for (const text of [preambleText, fullText]) {
    const labeled = /account\s*no\.?\s*[:\-]?\s*(\d{6,})/i.exec(text);
    if (labeled) return labeled[1].slice(-4);

    // Card numbers masked as separate 4-char groups, e.g. "XXXX-XXXX-XXXX-3600" or "4315 XXXX XXXX 8007".
    const groupedCard =
      /(?:x{4}[\s-]){2,3}(\d{4})\b/i.exec(text) || /\d{4}\s?x{4}\s?x{4}\s?(\d{4})/i.exec(text);
    if (groupedCard) return groupedCard[1];

    const masked = findMaskedAccountNumber(text);
    if (masked) return masked;

    const inrSuffixed = /\(inr\)\s*-\s*(\d+)/i.exec(text);
    if (inrSuffixed) return inrSuffixed[1].slice(-4);
  }
  if (filename) {
    const maskedFilename = /x{2,}(\d{4})\b/i.exec(filename);
    if (maskedFilename) return maskedFilename[1];
  }
  return null;
}

async function extractTransactionsForStatement(statement) {
  // Password-protected statements are unlocked automatically here using their stored password
  // (set during upload or via the "Unlock" action) - no prompt is shown on this path.
  const password = statement.id ? await getStoredStatementPassword(statement.id).catch(() => null) : null;

  let accountType = "unknown";
  let bankName = null;
  let accountLast4 = null;
  let currency = "INR";
  let passwordNeeded = false;
  try {
    const { fullText, preambleText } = await getStatementTextSections(statement, password);
    accountType = detectAccountType(fullText, statement.filename);
    bankName = detectBankName(fullText, statement.filename);
    accountLast4 = detectAccountLast4(preambleText, fullText, statement.filename);
    currency = detectCurrency(fullText);
  } catch (err) {
    if (err instanceof PasswordRequiredError || err instanceof IncorrectPasswordError) {
      passwordNeeded = true;
    } else {
      console.error(`Failed to detect account metadata for statement ${statement.id}`, err);
    }
  }
  const isCreditCard = accountType === "credit_card";

  let rows = [];
  let parseFailed = false;
  if (!passwordNeeded) {
    try {
      if (statement.file_type === "xlsx" || statement.file_type === "xls") {
        const { buffer } = await getStatementFileBytes(statement, password);
        rows = await extractExcelTransactions(buffer, isCreditCard);
      } else if (statement.file_type === "csv") {
        rows = extractCsvTransactions(base64ToText(statement.content_base64), isCreditCard);
      } else if (statement.file_type === "pdf") {
        const { buffer, password: resolvedPassword } = await getStatementFileBytes(statement, password);
        rows = await extractPdfTransactions(buffer, resolvedPassword);
      }
    } catch (err) {
      if (err instanceof PasswordRequiredError || err instanceof IncorrectPasswordError) {
        passwordNeeded = true;
      } else {
        console.error(`Failed to extract transactions for statement ${statement.id}`, err);
        parseFailed = true;
      }
      rows = [];
    }
  }

  await ensureStatementsDb();

  if (passwordNeeded) {
    await invoke("plugin:sql|execute", {
      db: STATEMENTS_DB,
      query: "UPDATE statements SET status = $1 WHERE id = $2",
      values: [STATEMENT_STATUS_PASSWORD_REQUIRED, statement.id],
    });
    return;
  }

  if (parseFailed) {
    await invoke("plugin:sql|execute", {
      db: STATEMENTS_DB,
      query: "UPDATE statements SET status = $1 WHERE id = $2",
      values: [STATEMENT_STATUS_FAILED_TO_PARSE, statement.id],
    });
    return;
  }

  // Extraction succeeded: clear any stale failed status from a previous attempt, and fill in
  // detected metadata only where it's still unset (never clobbers a manual account_type override).
  await invoke("plugin:sql|execute", {
    db: STATEMENTS_DB,
    query:
      "UPDATE statements SET status = 'saved', account_type = CASE WHEN account_type = 'unknown' THEN $1 ELSE account_type END, bank_name = COALESCE(bank_name, $2), account_last4 = COALESCE(account_last4, $3), currency = COALESCE(currency, $5) WHERE id = $4",
    values: [accountType, bankName, accountLast4, statement.id, currency],
  });

  if (rows.length === 0) return;

  const createdAt = new Date().toISOString();
  let duplicateCount = 0;
  for (const row of rows) {
    const existing = await invoke("plugin:sql|select", {
      db: STATEMENTS_DB,
      query: "SELECT 1 FROM transactions WHERE date = $1 AND description = $2 AND amount = $3 LIMIT 1",
      values: [row.date, row.description, row.amount],
    });
    if (existing.length > 0) {
      duplicateCount += 1;
      continue;
    }

    await invoke("plugin:sql|execute", {
      db: STATEMENTS_DB,
      query:
        "INSERT INTO transactions (id, statement_id, date, description, amount, category, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      values: [crypto.randomUUID(), statement.id, row.date, row.description, row.amount, "Uncategorized", createdAt],
    });
  }
  if (duplicateCount > 0) {
    console.info(`Skipped ${duplicateCount} duplicate transaction(s) already present from another statement for "${statement.filename || statement.id}".`);
  }
}

async function saveStatementFile(file) {
  const ext = statementFileExtension(file.name);
  if (!ALLOWED_STATEMENT_EXTENSIONS.has(ext)) {
    showStatementError(`"${file.name}" is not a supported file type. Only .xlsx, .xls, .csv, and .pdf files are accepted.`);
    return;
  }
  if (file.size > MAX_STATEMENT_FILE_SIZE) {
    showStatementError(`"${file.name}" is larger than 50MB and was not saved.`);
    return;
  }

  await ensureStatementsDb();
  const buffer = await file.arrayBuffer();
  const contentBase64 = arrayBufferToBase64(buffer);
  const contentHash = await sha256Hex(buffer);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const duplicateRows = await invoke("plugin:sql|select", {
    db: STATEMENTS_DB,
    query: "SELECT filename FROM statements WHERE content_hash = $1 LIMIT 1",
    values: [contentHash],
  });
  if (duplicateRows.length > 0) {
    showStatementError(`"${file.name}" is a duplicate of "${duplicateRows[0].filename}" (already uploaded) and was not saved.`);
    return;
  }

  // Password-protected Excel/PDF files are detected and unlocked before saving, so they behave
  // like unprotected files from here on. Cancelling (or exhausting retries) still saves the file,
  // with status "Password required", so the upload isn't lost - the user can unlock it later.
  const probeStatement = { file_type: ext, content_base64: contentBase64 };
  let verifiedPassword = null;
  let needsPassword = false;
  try {
    await getStatementFileBytes(probeStatement, null);
  } catch (err) {
    if (err instanceof PasswordRequiredError) {
      needsPassword = true;
    }
    // Any other error (corrupt/unrecognized content) is left for extractTransactionsForStatement
    // to rediscover and reflect as "Failed to parse", matching today's behavior.
  }
  if (needsPassword) {
    verifiedPassword = await promptForPassword(file.name, (password) => getStatementFileBytes(probeStatement, password));
  }

  const status = needsPassword && verifiedPassword === null ? STATEMENT_STATUS_PASSWORD_REQUIRED : "saved";

  try {
    await invoke("plugin:sql|execute", {
      db: STATEMENTS_DB,
      query:
        "INSERT INTO statements (id, filename, file_type, size_bytes, content_base64, content_hash, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      values: [id, file.name, ext, file.size, contentBase64, contentHash, status, createdAt],
    });
  } catch (err) {
    showStatementError(`Failed to save "${file.name}".`);
    console.error(err);
    return;
  }

  if (verifiedPassword !== null) {
    await saveStatementPassword(id, verifiedPassword);
  }
  if (status === STATEMENT_STATUS_PASSWORD_REQUIRED) {
    return; // no password supplied - skip extraction until the user unlocks it
  }

  await extractTransactionsForStatement({ id, filename: file.name, file_type: ext, content_base64: contentBase64 });
}

async function saveStatementFiles(fileList) {
  showStatementError(null);
  const files = Array.from(fileList);
  for (const file of files) {
    await saveStatementFile(file);
  }
  await renderStatements();
}

// Prompts for the password on a "Password required" statement; on success, stores it and
// re-runs extraction, bringing the statement to the same state as if it had unlocked on upload.
async function unlockStatement(statementId, filename) {
  await ensureStatementsDb();
  const rows = await invoke("plugin:sql|select", {
    db: STATEMENTS_DB,
    query: "SELECT id, filename, file_type, content_base64 FROM statements WHERE id = $1",
    values: [statementId],
  });
  const statement = rows[0];
  if (!statement) return;

  const verifiedPassword = await promptForPassword(filename || statement.filename, (password) => getStatementFileBytes(statement, password));
  if (verifiedPassword === null) return; // cancelled - leave status as Password required

  await saveStatementPassword(statementId, verifiedPassword);
  await extractTransactionsForStatement(statement);
  await renderStatements();
}

const ACCOUNT_TYPE_LABELS = {
  savings: "Savings",
  credit_card: "Credit Card",
  current: "Current Account",
  unknown: "Unknown",
};
const ACCOUNT_TYPE_CYCLE = { unknown: "savings", savings: "credit_card", credit_card: "current", current: "savings" };
const ACCOUNT_TYPE_STYLES = {
  savings: "text-success",
  credit_card: "text-data-blue",
  current: "text-secondary",
  unknown: "text-on-surface-variant",
};

function accountTypeBadgeMarkup(statementId, accountType) {
  const type = ACCOUNT_TYPE_LABELS[accountType] ? accountType : "unknown";
  return `<button type="button" class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-surface-container-high border border-outline-variant ${ACCOUNT_TYPE_STYLES[type]} text-mono-data-sm font-medium hover:opacity-80 transition-opacity" data-account-type-id="${statementId}" data-account-type="${type}" title="Click to change">${ACCOUNT_TYPE_LABELS[type]}</button>`;
}

// ================= Statement Rename =================

function startEditingStatementName(statementId) {
  const wrap = document.querySelector(`[data-statement-name-wrap="${statementId}"]`);
  const textSpan = wrap?.querySelector(`[data-statement-name-text="${statementId}"]`);
  const editBtn = wrap?.querySelector(`[data-statement-name-edit="${statementId}"]`);
  if (!wrap || !textSpan || !editBtn) return;

  const currentName = textSpan.textContent;
  const textSpanClass = textSpan.className;

  const input = document.createElement("input");
  input.type = "text";
  input.value = currentName;
  input.className =
    "statement-name-input flex-1 min-w-0 max-w-[220px] px-2 py-0.5 rounded-sm border border-primary bg-surface-container-lowest text-on-surface text-body-sm font-body-sm font-medium focus:outline-none";

  textSpan.replaceWith(input);
  editBtn.classList.add("hidden");
  input.focus();
  input.select();

  let settled = false;

  const restoreSpan = (name) => {
    const span = document.createElement("span");
    span.className = textSpanClass;
    span.dataset.statementNameText = statementId;
    span.textContent = name;
    input.replaceWith(span);
    editBtn.classList.remove("hidden");
  };

  const commit = async () => {
    if (settled) return;
    settled = true;
    const newName = input.value.trim();
    if (!newName) {
      restoreSpan(currentName);
      return;
    }
    if (newName === currentName) {
      restoreSpan(currentName);
      return;
    }
    await ensureStatementsDb();
    await invoke("plugin:sql|execute", {
      db: STATEMENTS_DB,
      query: "UPDATE statements SET display_name = $1 WHERE id = $2",
      values: [newName, statementId],
    });
    await renderStatements();
  };

  const cancel = () => {
    if (settled) return;
    settled = true;
    restoreSpan(currentName);
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  });
  input.addEventListener("blur", commit);
}

document.getElementById("statement-table-body")?.addEventListener("click", async (event) => {
  const fyHeader = event.target.closest("tr[data-fy-toggle]");
  if (fyHeader) {
    const label = fyHeader.dataset.fyToggle;
    if (collapsedStatementFYs.has(label)) collapsedStatementFYs.delete(label);
    else collapsedStatementFYs.add(label);
    const nowCollapsed = collapsedStatementFYs.has(label);
    fyHeader.querySelector(".material-symbols-outlined")?.classList.toggle("rotate-90", !nowCollapsed);
    document.querySelectorAll(`#statement-table-body tr[data-fy-group="${label}"]`).forEach((tr) => {
      tr.classList.toggle("hidden", nowCollapsed);
    });
    return;
  }

  const viewStatementBtn = event.target.closest("button[data-view-statement-id]");
  if (viewStatementBtn) {
    openStatementViewer(viewStatementBtn.dataset.viewStatementId, viewStatementBtn.dataset.viewStatementName);
    return;
  }

  const editBtn = event.target.closest("button[data-statement-name-edit]");
  if (editBtn) {
    startEditingStatementName(editBtn.dataset.statementNameEdit);
    return;
  }

  const unlockBtn = event.target.closest("button[data-unlock-statement-id]");
  if (unlockBtn) {
    unlockStatement(unlockBtn.dataset.unlockStatementId, unlockBtn.dataset.unlockStatementName);
    return;
  }

  const badge = event.target.closest("button[data-account-type-id]");
  if (!badge) return;

  const statementId = badge.dataset.accountTypeId;
  const nextType = ACCOUNT_TYPE_CYCLE[badge.dataset.accountType] || "savings";

  badge.outerHTML = accountTypeBadgeMarkup(statementId, nextType);

  await ensureStatementsDb();
  await invoke("plugin:sql|execute", {
    db: STATEMENTS_DB,
    query: "UPDATE statements SET account_type = $1 WHERE id = $2",
    values: [nextType, statementId],
  });
});

let selectedStatementIds = new Set();
let collapsedStatementFYs = new Set();
let statementFYsInitialized = false;

function updateDeleteButton() {
  const btn = document.getElementById("delete-selected-btn");
  const label = document.getElementById("delete-selected-label");
  if (!btn || !label) return;
  if (selectedStatementIds.size > 0) {
    btn.classList.remove("hidden");
    btn.classList.add("flex");
    label.textContent = `Delete (${selectedStatementIds.size})`;
  } else {
    btn.classList.add("hidden");
    btn.classList.remove("flex");
  }
}

function statementRowMarkup(row, fyLabel, collapsed) {
  const icon = row.file_type === "pdf" ? "picture_as_pdf" : "description";
  const iconColor = row.file_type === "pdf" ? "text-warning" : "text-data-blue";
  const checked = selectedStatementIds.has(row.id) ? "checked" : "";
  const failedBadge = (label) =>
    `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-surface-container-high border border-error/30 text-mono-data-sm text-error font-medium"><span class="w-1.5 h-1.5 rounded-full bg-error"></span> ${label}</span>`;
  const passwordRequiredBadge = `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-surface-container-high border border-warning/30 text-mono-data-sm text-warning font-medium"><span class="material-symbols-outlined text-[14px]">lock</span> Password required</span>`;
  const statusBadge =
    row.status === "saved"
      ? `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-surface-container-high border border-outline-variant text-mono-data-sm text-on-surface"><span class="w-1.5 h-1.5 rounded-full bg-success"></span> Saved</span>`
      : row.status === STATEMENT_STATUS_FAILED_TO_PARSE
        ? failedBadge("Failed to parse")
        : row.status === STATEMENT_STATUS_PASSWORD_REQUIRED
          ? passwordRequiredBadge
          : failedBadge("Failed");
  const unlockButton =
    row.status === STATEMENT_STATUS_PASSWORD_REQUIRED
      ? `<button type="button" class="mt-1 text-label-caps font-label-caps text-data-blue hover:underline" data-unlock-statement-id="${row.id}" data-unlock-statement-name="${escapeHtml(row.filename)}">Unlock</button>`
      : "";
  const displayName = resolveStatementDisplayName(row.display_name, row.bank_name, row.account_last4, row.filename);
  const fileLink = `<button type="button" class="mt-0.5 block text-label-caps font-label-caps text-data-blue hover:underline truncate max-w-[220px] text-left" data-view-statement-id="${row.id}" data-view-statement-name="${escapeHtml(displayName)}">${displayName !== row.filename ? escapeHtml(row.filename) : "View file"}</button>`;
  return `<tr class="hover:bg-surface-container-low transition-colors group cursor-default ${collapsed ? "hidden" : ""}" data-row-id="${row.id}" data-fy-group="${escapeHtml(fyLabel)}">
      <td class="p-table-cell-padding text-center"><input class="row-checkbox rounded-sm border-outline-variant text-primary focus:ring-primary w-3.5 h-3.5" type="checkbox" data-id="${row.id}" ${checked} /></td>
      <td class="p-table-cell-padding">
        <div class="font-medium flex items-center gap-2" data-statement-name-wrap="${row.id}">
          <span class="material-symbols-outlined ${iconColor} text-[18px] shrink-0">${icon}</span>
          <span class="statement-name-text truncate max-w-[220px]" data-statement-name-text="${row.id}">${escapeHtml(displayName)}</span>
          <button type="button" class="statement-name-edit-btn text-on-surface-variant hover:text-on-surface opacity-0 group-hover:opacity-100 transition-opacity shrink-0" data-statement-name-edit="${row.id}" title="Rename">
            <span class="material-symbols-outlined text-[18px]">edit</span>
          </button>
        </div>
        ${fileLink}
      </td>
      <td class="p-table-cell-padding text-mono-data font-mono-data text-right text-on-surface-variant">${formatStatementDate(row.created_at)}</td>
      <td class="p-table-cell-padding text-mono-data font-mono-data text-right text-on-surface-variant">${formatStatementSize(row.size_bytes)}</td>
      <td class="p-table-cell-padding">${statusBadge}${unlockButton}</td>
      <td class="p-table-cell-padding">${accountTypeBadgeMarkup(row.id, row.account_type)}</td>
    </tr>`;
}

async function renderStatements() {
  await ensureStatementsDb();
  await backfillAccountTypeDetection();
  const rows = await invoke("plugin:sql|select", {
    db: STATEMENTS_DB,
    query:
      "SELECT id, filename, file_type, size_bytes, status, created_at, account_type, bank_name, account_last4, display_name, " +
      "(SELECT MIN(date) FROM transactions WHERE transactions.statement_id = statements.id) AS earliest_transaction_date " +
      "FROM statements ORDER BY created_at DESC",
    values: [],
  });

  const rowIds = new Set(rows.map((row) => row.id));
  selectedStatementIds = new Set([...selectedStatementIds].filter((id) => rowIds.has(id)));

  const countBadge = document.getElementById("statement-count-badge");
  const emptyState = document.getElementById("statement-empty-state");
  const tableWrap = document.getElementById("statement-table-wrap");
  const tbody = document.getElementById("statement-table-body");
  const pagination = document.getElementById("statement-pagination");
  const paginationLabel = document.getElementById("statement-pagination-label");
  const selectAllCheckbox = document.getElementById("select-all-checkbox");

  const count = rows.length;
  countBadge.textContent = `${count} Record${count === 1 ? "" : "s"}`;

  if (count === 0) {
    emptyState.classList.remove("hidden");
    tableWrap.classList.add("hidden");
    pagination.classList.add("hidden");
    if (selectAllCheckbox) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
    }
    updateDeleteButton();
    return;
  }

  emptyState.classList.add("hidden");
  tableWrap.classList.remove("hidden");
  pagination.classList.remove("hidden");
  paginationLabel.textContent = `Showing 1-${count} of ${count}`;

  const fyGroups = new Map(); // label -> { startYear, rows: [] }
  for (const row of rows) {
    const { startYear, label } = financialYearInfo(row.earliest_transaction_date || row.created_at);
    if (!fyGroups.has(label)) fyGroups.set(label, { startYear, rows: [] });
    fyGroups.get(label).rows.push(row);
  }
  const sortedFYLabels = [...fyGroups.keys()].sort((a, b) => fyGroups.get(b).startYear - fyGroups.get(a).startYear);

  if (!statementFYsInitialized) {
    statementFYsInitialized = true;
    collapsedStatementFYs = new Set(sortedFYLabels.slice(1));
  }

  tbody.innerHTML = sortedFYLabels
    .map((label) => {
      const group = fyGroups.get(label);
      const collapsed = collapsedStatementFYs.has(label);
      const headerRow = `<tr class="bg-surface-container-low hover:bg-surface-container transition-colors cursor-pointer select-none" data-fy-toggle="${escapeHtml(label)}">
          <td colspan="6" class="p-table-cell-padding">
            <div class="flex items-center gap-2 font-semibold text-on-surface">
              <span class="material-symbols-outlined text-[18px] transition-transform ${collapsed ? "" : "rotate-90"}">chevron_right</span>
              ${escapeHtml(label)}
              <span class="text-label-caps font-label-caps text-on-surface-variant font-normal">${group.rows.length} statement${group.rows.length === 1 ? "" : "s"}</span>
            </div>
          </td>
        </tr>`;
      return headerRow + group.rows.map((row) => statementRowMarkup(row, label, collapsed)).join("");
    })
    .join("");

  if (selectAllCheckbox) {
    selectAllCheckbox.checked = selectedStatementIds.size === count;
    selectAllCheckbox.indeterminate = selectedStatementIds.size > 0 && selectedStatementIds.size < count;
  }

  tbody.querySelectorAll(".row-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const id = checkbox.dataset.id;
      if (checkbox.checked) selectedStatementIds.add(id);
      else selectedStatementIds.delete(id);

      if (selectAllCheckbox) {
        selectAllCheckbox.checked = selectedStatementIds.size === rows.length;
        selectAllCheckbox.indeterminate = selectedStatementIds.size > 0 && selectedStatementIds.size < rows.length;
      }
      updateDeleteButton();
    });
  });

  updateDeleteButton();
}

async function deleteSelectedStatements() {
  if (selectedStatementIds.size === 0) return;
  await ensureStatementsDb();
  const ids = Array.from(selectedStatementIds);
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
  await invoke("plugin:sql|execute", {
    db: STATEMENTS_DB,
    query: `DELETE FROM transactions WHERE statement_id IN (${placeholders})`,
    values: ids,
  });
  await invoke("plugin:sql|execute", {
    db: STATEMENTS_DB,
    query: `DELETE FROM statements WHERE id IN (${placeholders})`,
    values: ids,
  });
  await cleanupEmptyGroups();
  selectedStatementIds.clear();
  await renderStatements();
}

document.getElementById("select-all-checkbox")?.addEventListener("change", (event) => {
  const checked = event.target.checked;
  document.querySelectorAll("#statement-table-body .row-checkbox").forEach((checkbox) => {
    checkbox.checked = checked;
    const id = checkbox.dataset.id;
    if (checked) selectedStatementIds.add(id);
    else selectedStatementIds.delete(id);
  });
  updateDeleteButton();
});

document.getElementById("delete-selected-btn")?.addEventListener("click", () => {
  deleteSelectedStatements();
});

const fileInput = document.getElementById("file-input");
document.getElementById("browse-files-btn")?.addEventListener("click", () => fileInput?.click());
document.getElementById("browse-files-dropzone-btn")?.addEventListener("click", () => fileInput?.click());
fileInput?.addEventListener("change", (event) => {
  if (event.target.files && event.target.files.length > 0) {
    saveStatementFiles(event.target.files);
  }
  event.target.value = "";
});

const dropzone = document.getElementById("dropzone");
if (dropzone) {
  ["dragenter", "dragover"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add("border-primary");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.remove("border-primary");
    });
  });
  dropzone.addEventListener("drop", (event) => {
    if (event.dataTransfer && event.dataTransfer.files.length > 0) {
      saveStatementFiles(event.dataTransfer.files);
    }
  });
}

renderStatements();

// ================= Review Screen =================

const TRANSACTIONS_PER_PAGE = 20;
let reviewCurrentPage = 0;
let reviewCurrentFilter = ""; // "" = All Transactions, otherwise an exact category value
let reviewSearchQuery = "";
let reviewSearchDebounceTimer = null;
let reviewDateFrom = ""; // "" = no lower bound, otherwise an ISO "YYYY-MM-DD" date
let reviewDateTo = ""; // "" = no upper bound, otherwise an ISO "YYYY-MM-DD" date
let reviewStatementFilter = ""; // "" = All Files, otherwise a statement id

document.getElementById("search-input")?.addEventListener("input", (event) => {
  if (activeViewName !== "review") return;
  const value = event.target.value;
  clearTimeout(reviewSearchDebounceTimer);
  reviewSearchDebounceTimer = setTimeout(() => {
    if (activeViewName !== "review") return;
    reviewSearchQuery = value.trim();
    reviewCurrentPage = 0;
    selectedTransactionIds.clear();
    renderReviewTransactions();
  }, 200);
});

document.getElementById("review-date-from")?.addEventListener("change", (event) => {
  reviewDateFrom = event.target.value;
  reviewCurrentPage = 0;
  selectedTransactionIds.clear();
  renderReviewTransactions();
});

document.getElementById("review-date-to")?.addEventListener("change", (event) => {
  reviewDateTo = event.target.value;
  reviewCurrentPage = 0;
  selectedTransactionIds.clear();
  renderReviewTransactions();
});

document.getElementById("review-date-clear")?.addEventListener("click", () => {
  reviewDateFrom = "";
  reviewDateTo = "";
  const dateFromInput = document.getElementById("review-date-from");
  const dateToInput = document.getElementById("review-date-to");
  if (dateFromInput) dateFromInput.value = "";
  if (dateToInput) dateToInput.value = "";
  reviewCurrentPage = 0;
  selectedTransactionIds.clear();
  renderReviewTransactions();
});

document.getElementById("review-file-filter")?.addEventListener("change", (event) => {
  reviewStatementFilter = event.target.value;
  reviewCurrentPage = 0;
  selectedTransactionIds.clear();
  renderReviewTransactions();
});

async function populateReviewFileFilter() {
  await ensureStatementsDb();
  const select = document.getElementById("review-file-filter");
  if (!select) return;

  const statements = await invoke("plugin:sql|select", {
    db: STATEMENTS_DB,
    query: "SELECT id, filename, bank_name, account_last4, display_name FROM statements ORDER BY created_at DESC",
    values: [],
  });

  const previousValue = reviewStatementFilter;
  select.innerHTML =
    `<option value="">All Files</option>` +
    statements
      .map(
        (s) =>
          `<option value="${escapeHtml(s.id)}">${escapeHtml(resolveStatementDisplayName(s.display_name, s.bank_name, s.account_last4, s.filename))}</option>`,
      )
      .join("");

  const stillExists = statements.some((s) => s.id === previousValue);
  reviewStatementFilter = stillExists ? previousValue : "";
  select.value = reviewStatementFilter;
}

const FILTER_BTN_ACTIVE_CLASSES = ["bg-surface-container-high", "text-on-surface", "font-semibold", "border-transparent"];
const FILTER_BTN_INACTIVE_CLASSES = [
  "bg-surface-container-lowest",
  "text-on-surface-variant",
  "border-outline-variant",
  "hover:bg-surface-container-low",
];

function updateReviewFilterButtonStyles() {
  document.querySelectorAll("#review-filter-bar .review-filter-btn").forEach((btn) => {
    const isActive = btn.dataset.filter === reviewCurrentFilter;
    btn.classList.toggle("border", true);
    FILTER_BTN_ACTIVE_CLASSES.forEach((c) => btn.classList.toggle(c, isActive));
    FILTER_BTN_INACTIVE_CLASSES.forEach((c) => btn.classList.toggle(c, !isActive));
  });
}

document.getElementById("review-filter-bar")?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-filter]");
  if (!button) return;
  reviewCurrentFilter = button.dataset.filter;
  reviewCurrentPage = 0;
  selectedTransactionIds.clear();
  updateReviewFilterButtonStyles();
  renderReviewTransactions();
});

// ================= Transaction Grouping =================

let selectedTransactionIds = new Set();
let reviewGroupFilter = ""; // "" = All Groups, "__grouped__", "__ungrouped__", or a group id
let groupsFocusGroupId = null;

function updateReviewSelectAllCheckbox() {
  const selectAllCheckbox = document.getElementById("review-select-all-checkbox");
  if (!selectAllCheckbox) return;
  const rowCheckboxes = document.querySelectorAll("#review-table-body .transaction-row-checkbox");
  const total = rowCheckboxes.length;
  const checkedCount = Array.from(rowCheckboxes).filter((cb) => cb.checked).length;
  selectAllCheckbox.checked = total > 0 && checkedCount === total;
  selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < total;
}

function updateGroupToolbar() {
  const toolbar = document.getElementById("review-selection-toolbar");
  const countLabel = document.getElementById("review-selection-count");
  if (!toolbar || !countLabel) return;
  const count = selectedTransactionIds.size;
  toolbar.classList.toggle("hidden", count === 0);
  countLabel.textContent = `${count} selected`;
}

document.getElementById("review-select-all-checkbox")?.addEventListener("change", (event) => {
  const checked = event.target.checked;
  document.querySelectorAll("#review-table-body .transaction-row-checkbox").forEach((checkbox) => {
    checkbox.checked = checked;
    const id = checkbox.dataset.id;
    if (checked) selectedTransactionIds.add(id);
    else selectedTransactionIds.delete(id);
  });
  updateGroupToolbar();
});

document.getElementById("review-clear-selection-btn")?.addEventListener("click", () => {
  selectedTransactionIds.clear();
  document.querySelectorAll("#review-table-body .transaction-row-checkbox").forEach((cb) => (cb.checked = false));
  updateReviewSelectAllCheckbox();
  updateGroupToolbar();
});

document.getElementById("review-add-to-group-btn")?.addEventListener("click", () => {
  if (selectedTransactionIds.size === 0) return;
  openGroupEditorModal([...selectedTransactionIds]);
});

document.getElementById("review-bulk-category-select")?.addEventListener("change", async (event) => {
  const select = event.target;
  const value = select.value;
  if (value === "__placeholder__") return;
  if (selectedTransactionIds.size === 0) {
    select.value = "__placeholder__";
    return;
  }

  const category = value || "Uncategorized";
  const ids = [...selectedTransactionIds];
  await ensureStatementsDb();
  const placeholders = ids.map((_, i) => `$${i + 2}`).join(", ");
  await invoke("plugin:sql|execute", {
    db: STATEMENTS_DB,
    query: `UPDATE transactions SET category = $1 WHERE id IN (${placeholders})`,
    values: [category, ...ids],
  });
  select.value = "__placeholder__";
  await renderReviewTransactions();
});

document.getElementById("review-group-filter")?.addEventListener("change", (event) => {
  reviewGroupFilter = event.target.value;
  reviewCurrentPage = 0;
  selectedTransactionIds.clear();
  renderReviewTransactions();
});

async function populateReviewGroupFilter() {
  await ensureStatementsDb();
  const select = document.getElementById("review-group-filter");
  if (!select) return;

  const groups = await invoke("plugin:sql|select", {
    db: STATEMENTS_DB,
    query: "SELECT id, group_type, label FROM transaction_groups ORDER BY created_at DESC",
    values: [],
  });

  const previousValue = reviewGroupFilter;
  select.innerHTML =
    `<option value="">All Groups</option>` +
    `<option value="__grouped__">Grouped Only</option>` +
    `<option value="__ungrouped__">Ungrouped Only</option>` +
    groups.map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.group_type)}: ${escapeHtml(g.label)}</option>`).join("");

  const stillExists = previousValue === "" || previousValue === "__grouped__" || previousValue === "__ungrouped__" || groups.some((g) => g.id === previousValue);
  reviewGroupFilter = stillExists ? previousValue : "";
  select.value = reviewGroupFilter;
}

async function cleanupEmptyGroups() {
  await ensureStatementsDb();
  await invoke("plugin:sql|execute", {
    db: STATEMENTS_DB,
    query: "DELETE FROM transaction_groups WHERE id NOT IN (SELECT DISTINCT group_id FROM transactions WHERE group_id IS NOT NULL)",
    values: [],
  });
}

async function assignTransactionsToGroup(ids, groupId) {
  if (ids.length === 0) return;
  await ensureStatementsDb();
  const placeholders = ids.map((_, i) => `$${i + 2}`).join(", ");
  await invoke("plugin:sql|execute", {
    db: STATEMENTS_DB,
    query: `UPDATE transactions SET group_id = $1 WHERE id IN (${placeholders})`,
    values: [groupId, ...ids],
  });
}

async function openGroupEditorModal(transactionIds, suggestedLabel = "") {
  await ensureStatementsDb();
  const overlay = document.getElementById("group-editor-overlay");
  const typeSelect = document.getElementById("group-editor-type-select");
  const labelInput = document.getElementById("group-editor-label-input");
  const existingSelect = document.getElementById("group-editor-existing-select");
  const newRadio = document.getElementById("group-editor-mode-new");
  const existingRadio = document.getElementById("group-editor-mode-existing");
  if (!overlay || !typeSelect || !labelInput || !existingSelect || !newRadio || !existingRadio) return;

  typeSelect.innerHTML = GROUP_TYPES.map((t) => `<option value="${t}">${t}</option>`).join("");
  labelInput.value = suggestedLabel;

  const groups = await invoke("plugin:sql|select", {
    db: STATEMENTS_DB,
    query: "SELECT id, group_type, label FROM transaction_groups ORDER BY created_at DESC",
    values: [],
  });
  existingSelect.innerHTML = groups
    .map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.group_type)}: ${escapeHtml(g.label)}</option>`)
    .join("");
  existingRadio.disabled = groups.length === 0;
  newRadio.checked = true;
  existingRadio.checked = false;

  overlay.dataset.transactionIds = JSON.stringify(transactionIds);
  overlay.classList.remove("hidden");
}

function closeGroupEditorModal() {
  document.getElementById("group-editor-overlay")?.classList.add("hidden");
}

document.getElementById("group-editor-cancel")?.addEventListener("click", closeGroupEditorModal);

document.getElementById("group-editor-save")?.addEventListener("click", async () => {
  const overlay = document.getElementById("group-editor-overlay");
  if (!overlay) return;
  const transactionIds = JSON.parse(overlay.dataset.transactionIds || "[]");
  if (transactionIds.length === 0) {
    closeGroupEditorModal();
    return;
  }

  const useExisting = document.getElementById("group-editor-mode-existing")?.checked;
  await ensureStatementsDb();

  if (useExisting) {
    const existingSelect = document.getElementById("group-editor-existing-select");
    const groupId = existingSelect?.value;
    if (!groupId) return;
    await assignTransactionsToGroup(transactionIds, groupId);
  } else {
    const groupType = document.getElementById("group-editor-type-select")?.value || "Other";
    const label = (document.getElementById("group-editor-label-input")?.value || "").trim();
    if (!label) return;
    const groupId = crypto.randomUUID();
    await invoke("plugin:sql|execute", {
      db: STATEMENTS_DB,
      query: "INSERT INTO transaction_groups (id, group_type, label, created_at) VALUES ($1, $2, $3, $4)",
      values: [groupId, groupType, label, new Date().toISOString()],
    });
    await assignTransactionsToGroup(transactionIds, groupId);
  }

  closeGroupEditorModal();
  selectedTransactionIds.clear();
  updateGroupToolbar();
  await populateReviewGroupFilter();
  await renderReviewTransactions();
  if (activeViewName === "groups") await loadGroupsScreen();
});

// ================= EMI/Loan Series Suggestions =================

function daysBetween(isoDateA, isoDateB) {
  const a = new Date(`${isoDateA}T00:00:00Z`).getTime();
  const b = new Date(`${isoDateB}T00:00:00Z`).getTime();
  return Math.abs(b - a) / (1000 * 60 * 60 * 24);
}

async function findEmiGroupSuggestions() {
  await ensureStatementsDb();
  const clusters = await invoke("plugin:sql|select", {
    db: STATEMENTS_DB,
    query:
      "SELECT LOWER(TRIM(t.description)) AS norm_desc, ABS(t.amount) AS abs_amount, MIN(t.description) AS sample_description, " +
      "GROUP_CONCAT(t.id) AS ids, GROUP_CONCAT(t.date) AS dates, COUNT(*) AS occurrences, COUNT(DISTINCT t.statement_id) AS statement_count " +
      "FROM transactions t WHERE t.group_id IS NULL GROUP BY LOWER(TRIM(t.description)), ABS(t.amount) " +
      "HAVING occurrences >= 2 AND statement_count >= 2",
    values: [],
  });

  const dismissals = await invoke("plugin:sql|select", {
    db: STATEMENTS_DB,
    query: "SELECT signature FROM group_suggestion_dismissals",
    values: [],
  });
  const dismissedSignatures = new Set(dismissals.map((d) => d.signature));

  const suggestions = [];
  for (const cluster of clusters) {
    const signature = `${cluster.norm_desc}|${cluster.abs_amount.toFixed(2)}`;
    if (dismissedSignatures.has(signature)) continue;

    const ids = cluster.ids.split(",");
    const dates = cluster.dates.split(",").sort();
    let monthlyGaps = 0;
    for (let i = 1; i < dates.length; i++) {
      const gap = daysBetween(dates[i - 1], dates[i]);
      if (gap >= 20 && gap <= 40) monthlyGaps += 1;
    }
    if (monthlyGaps < dates.length - 1) continue;

    suggestions.push({
      signature,
      description: cluster.sample_description,
      amount: cluster.abs_amount,
      ids,
      dates,
    });
  }
  return suggestions;
}

async function dismissGroupSuggestion(signature) {
  await ensureStatementsDb();
  await invoke("plugin:sql|execute", {
    db: STATEMENTS_DB,
    query: "INSERT OR IGNORE INTO group_suggestion_dismissals (id, signature, dismissed_at) VALUES ($1, $2, $3)",
    values: [crypto.randomUUID(), signature, new Date().toISOString()],
  });
}

let currentGroupSuggestions = [];

async function renderGroupSuggestionBanner() {
  const banner = document.getElementById("group-suggestions-banner");
  const countLabel = document.getElementById("group-suggestions-count");
  if (!banner || !countLabel) return;

  currentGroupSuggestions = await findEmiGroupSuggestions();
  banner.classList.toggle("hidden", currentGroupSuggestions.length === 0);
  const n = currentGroupSuggestions.length;
  countLabel.textContent = `We found ${n} possible recurring EMI/loan series.`;
}

function renderGroupSuggestionsOverlayBody() {
  const body = document.getElementById("group-suggestions-body");
  if (!body) return;
  body.innerHTML = currentGroupSuggestions
    .map(
      (s, index) => `<div class="border border-outline-variant rounded p-3 flex items-center justify-between gap-3" data-suggestion-index="${index}">
        <div class="min-w-0">
          <div class="font-semibold text-on-surface truncate">${escapeHtml(s.description || "(no description)")}</div>
          <div class="text-label-caps font-label-caps text-on-surface-variant">${s.ids.length} occurrences &middot; ${formatCurrency(s.amount)} each</div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button type="button" class="group-suggestion-dismiss px-3 py-1.5 border border-outline-variant rounded text-body-sm font-body-sm hover:bg-surface-container-low transition-colors" data-suggestion-index="${index}">Not a Group</button>
          <button type="button" class="group-suggestion-create px-3 py-1.5 bg-primary text-on-primary rounded text-body-sm font-body-sm font-semibold hover:bg-surface-tint transition-colors" data-suggestion-index="${index}">Create Group</button>
        </div>
      </div>`,
    )
    .join("");
}

document.getElementById("group-suggestions-review-btn")?.addEventListener("click", () => {
  renderGroupSuggestionsOverlayBody();
  document.getElementById("group-suggestions-overlay")?.classList.remove("hidden");
});

document.getElementById("group-suggestions-banner-dismiss")?.addEventListener("click", () => {
  document.getElementById("group-suggestions-banner")?.classList.add("hidden");
});

document.getElementById("group-suggestions-close")?.addEventListener("click", () => {
  document.getElementById("group-suggestions-overlay")?.classList.add("hidden");
});

document.getElementById("group-suggestions-body")?.addEventListener("click", async (event) => {
  const dismissBtn = event.target.closest(".group-suggestion-dismiss");
  if (dismissBtn) {
    const suggestion = currentGroupSuggestions[Number(dismissBtn.dataset.suggestionIndex)];
    if (suggestion) await dismissGroupSuggestion(suggestion.signature);
    await renderGroupSuggestionBanner();
    renderGroupSuggestionsOverlayBody();
    return;
  }

  const createBtn = event.target.closest(".group-suggestion-create");
  if (createBtn) {
    const suggestion = currentGroupSuggestions[Number(createBtn.dataset.suggestionIndex)];
    if (!suggestion) return;
    document.getElementById("group-suggestions-overlay")?.classList.add("hidden");
    openGroupEditorModal(suggestion.ids, suggestion.description || "");
  }
});

// ================= Groups Screen =================

async function loadGroupsScreen() {
  await ensureStatementsDb();
  await renderGroupsList();
  if (groupsFocusGroupId) {
    const groupId = groupsFocusGroupId;
    groupsFocusGroupId = null;
    await openGroupDetail(groupId);
  }
}

async function renderGroupsList() {
  await ensureStatementsDb();
  const emptyState = document.getElementById("groups-empty-state");
  const tableWrap = document.getElementById("groups-table-wrap");
  const tbody = document.getElementById("groups-table-body");
  if (!emptyState || !tableWrap || !tbody) return;

  const groups = await invoke("plugin:sql|select", {
    db: STATEMENTS_DB,
    query:
      "SELECT g.id, g.group_type, g.label, g.created_at, COUNT(t.id) AS txn_count, " +
      "COALESCE(SUM(CASE WHEN t.include_in_totals = 1 THEN t.amount ELSE 0 END), 0) AS considered_total, " +
      "COALESCE(SUM(CASE WHEN t.include_in_totals = 0 THEN t.amount ELSE 0 END), 0) AS excluded_total " +
      "FROM transaction_groups g LEFT JOIN transactions t ON t.group_id = g.id GROUP BY g.id ORDER BY g.created_at DESC",
    values: [],
  });

  if (groups.length === 0) {
    emptyState.classList.remove("hidden");
    tableWrap.classList.add("hidden");
    return;
  }

  emptyState.classList.add("hidden");
  tableWrap.classList.remove("hidden");

  tbody.innerHTML = groups
    .map(
      (g) => `<tr class="hover:bg-surface-container-low transition-colors cursor-pointer" data-open-group="${g.id}">
        <td class="p-table-cell-padding">
          <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-primary-container text-on-primary-container text-label-caps font-label-caps">
            <span class="material-symbols-outlined text-[14px]">${GROUP_TYPE_ICONS[g.group_type] || "label"}</span>
            ${escapeHtml(g.group_type)}
          </span>
        </td>
        <td class="p-table-cell-padding font-semibold text-on-surface">${escapeHtml(g.label)}</td>
        <td class="p-table-cell-padding text-center text-on-surface-variant">${g.txn_count}</td>
        <td class="p-table-cell-padding text-right text-mono-data font-mono-data font-semibold">${formatCurrency(g.considered_total)}</td>
        <td class="p-table-cell-padding text-right text-mono-data font-mono-data text-on-surface-variant">${g.excluded_total ? formatCurrency(g.excluded_total) : "-"}</td>
        <td class="p-table-cell-padding text-on-surface-variant">${formatTransactionDate(g.created_at.slice(0, 10))}</td>
        <td class="p-table-cell-padding text-center">
          <button type="button" class="text-on-surface-variant hover:text-error" data-delete-group="${g.id}" title="Delete group">
            <span class="material-symbols-outlined text-[18px]">delete</span>
          </button>
        </td>
      </tr>`,
    )
    .join("");
}

document.getElementById("groups-table-body")?.addEventListener("click", async (event) => {
  const deleteBtn = event.target.closest("button[data-delete-group]");
  if (deleteBtn) {
    event.stopPropagation();
    const groupId = deleteBtn.dataset.deleteGroup;
    await ensureStatementsDb();
    await invoke("plugin:sql|execute", {
      db: STATEMENTS_DB,
      query: "UPDATE transactions SET group_id = NULL WHERE group_id = $1",
      values: [groupId],
    });
    await invoke("plugin:sql|execute", {
      db: STATEMENTS_DB,
      query: "DELETE FROM transaction_groups WHERE id = $1",
      values: [groupId],
    });
    await renderGroupsList();
    return;
  }

  const row = event.target.closest("tr[data-open-group]");
  if (row) await openGroupDetail(row.dataset.openGroup);
});

async function openGroupDetail(groupId) {
  await ensureStatementsDb();
  const overlay = document.getElementById("group-detail-overlay");
  const typeSelect = document.getElementById("group-detail-type-select");
  const labelInput = document.getElementById("group-detail-label-input");
  const body = document.getElementById("group-detail-body");
  if (!overlay || !typeSelect || !labelInput || !body) return;

  const groupRows = await invoke("plugin:sql|select", {
    db: STATEMENTS_DB,
    query: "SELECT id, group_type, label FROM transaction_groups WHERE id = $1",
    values: [groupId],
  });
  const group = groupRows[0];
  if (!group) return;

  overlay.dataset.groupId = groupId;
  typeSelect.innerHTML = GROUP_TYPES.map((t) => `<option value="${t}" ${t === group.group_type ? "selected" : ""}>${t}</option>`).join("");
  labelInput.value = group.label;

  await renderGroupDetailTransactions(groupId);
  overlay.classList.remove("hidden");
}

async function renderGroupDetailTransactions(groupId) {
  const body = document.getElementById("group-detail-body");
  if (!body) return;

  const rows = await invoke("plugin:sql|select", {
    db: STATEMENTS_DB,
    query:
      "SELECT t.id, t.date, t.description, t.amount, t.include_in_totals, s.currency AS statement_currency " +
      "FROM transactions t LEFT JOIN statements s ON s.id = t.statement_id WHERE t.group_id = $1 ORDER BY t.date DESC",
    values: [groupId],
  });

  body.innerHTML = rows
    .map((row) => {
      const included = row.include_in_totals !== 0;
      return `<div class="flex items-center justify-between gap-3 p-2 rounded hover:bg-surface-container-low ${included ? "" : "opacity-60"}">
        <span class="flex-1 min-w-0">
          <span class="block text-body-sm font-body-sm font-semibold text-on-surface truncate">${escapeHtml(row.description || "(no description)")}</span>
          <span class="block text-label-caps font-label-caps text-on-surface-variant">${formatTransactionDate(row.date)}${included ? "" : " &middot; Excluded"}</span>
        </span>
        <span class="text-mono-data font-mono-data font-semibold shrink-0 ${row.amount > 0 ? "text-success" : "text-error"}">${formatCurrency(row.amount, row.statement_currency)}</span>
        <span class="flex items-center gap-1 shrink-0">
          <button type="button" class="text-on-surface-variant hover:text-on-surface" data-group-detail-toggle-include="${row.id}" data-current-include="${included ? "1" : "0"}" title="${included ? "Exclude from totals" : "Include in totals"}">
            <span class="material-symbols-outlined text-[18px]">${included ? "visibility" : "visibility_off"}</span>
          </button>
          <button type="button" class="text-on-surface-variant hover:text-error" data-group-detail-remove="${row.id}" title="Remove from group">
            <span class="material-symbols-outlined text-[18px]">link_off</span>
          </button>
        </span>
      </div>`;
    })
    .join("");
}

document.getElementById("group-detail-body")?.addEventListener("click", async (event) => {
  const overlay = document.getElementById("group-detail-overlay");
  const groupId = overlay?.dataset.groupId;

  const toggleBtn = event.target.closest("button[data-group-detail-toggle-include]");
  if (toggleBtn) {
    const id = toggleBtn.dataset.groupDetailToggleInclude;
    const nextValue = toggleBtn.dataset.currentInclude === "1" ? 0 : 1;
    await ensureStatementsDb();
    await invoke("plugin:sql|execute", {
      db: STATEMENTS_DB,
      query: "UPDATE transactions SET include_in_totals = $1 WHERE id = $2",
      values: [nextValue, id],
    });
    if (groupId) await renderGroupDetailTransactions(groupId);
    await renderGroupsList();
    return;
  }

  const removeBtn = event.target.closest("button[data-group-detail-remove]");
  if (removeBtn) {
    const id = removeBtn.dataset.groupDetailRemove;
    await ensureStatementsDb();
    await invoke("plugin:sql|execute", {
      db: STATEMENTS_DB,
      query: "UPDATE transactions SET group_id = NULL WHERE id = $1",
      values: [id],
    });
    await cleanupEmptyGroups();
    if (groupId) await renderGroupDetailTransactions(groupId);
    await renderGroupsList();
  }
});

document.getElementById("group-detail-close")?.addEventListener("click", () => {
  document.getElementById("group-detail-overlay")?.classList.add("hidden");
});

document.getElementById("group-detail-save")?.addEventListener("click", async () => {
  const overlay = document.getElementById("group-detail-overlay");
  const groupId = overlay?.dataset.groupId;
  if (!groupId) return;
  const groupType = document.getElementById("group-detail-type-select")?.value || "Other";
  const label = (document.getElementById("group-detail-label-input")?.value || "").trim();
  if (!label) return;

  await ensureStatementsDb();
  await invoke("plugin:sql|execute", {
    db: STATEMENTS_DB,
    query: "UPDATE transaction_groups SET group_type = $1, label = $2 WHERE id = $3",
    values: [groupType, label, groupId],
  });
  await renderGroupsList();
});

async function backfillTransactionExtraction() {
  await ensureStatementsDb();
  const statements = await invoke("plugin:sql|select", {
    db: STATEMENTS_DB,
    query:
      "SELECT id, filename, file_type, content_base64 FROM statements WHERE id NOT IN (SELECT DISTINCT statement_id FROM transactions)",
    values: [],
  });
  for (const statement of statements) {
    await extractTransactionsForStatement(statement);
  }
}

async function backfillAccountTypeDetection() {
  await ensureStatementsDb();
  const statements = await invoke("plugin:sql|select", {
    db: STATEMENTS_DB,
    query:
      "SELECT id, filename, file_type, content_base64 FROM statements WHERE account_type = 'unknown' OR bank_name IS NULL OR account_last4 IS NULL OR currency IS NULL",
    values: [],
  });
  for (const statement of statements) {
    let accountType = "unknown";
    let bankName = null;
    let accountLast4 = null;
    let currency = "INR";
    try {
      const { fullText, preambleText } = await getStatementTextSections(statement);
      accountType = detectAccountType(fullText, statement.filename);
      bankName = detectBankName(fullText, statement.filename);
      accountLast4 = detectAccountLast4(preambleText, fullText, statement.filename);
      currency = detectCurrency(fullText);
    } catch (err) {
      console.error(`Failed to detect account metadata for statement ${statement.id}`, err);
      continue;
    }
    await invoke("plugin:sql|execute", {
      db: STATEMENTS_DB,
      query:
        "UPDATE statements SET account_type = CASE WHEN account_type = 'unknown' THEN $1 ELSE account_type END, bank_name = COALESCE(bank_name, $2), account_last4 = COALESCE(account_last4, $3), currency = COALESCE(currency, $5) WHERE id = $4",
      values: [accountType, bankName, accountLast4, statement.id, currency],
    });
  }
}

function formatTransactionDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

const CURRENCY_LOCALES = { INR: "en-IN", USD: "en-US", EUR: "en-IE", GBP: "en-GB" };

function formatCurrency(amount, currencyCode) {
  const currency = currencyCode || "INR";
  const locale = CURRENCY_LOCALES[currency] || "en-IN";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function reviewTransactionRow(row) {
  const included = row.include_in_totals !== 0;
  const groupBadge = row.group_id
    ? `<button type="button" class="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded-sm bg-primary-container text-on-primary-container text-label-caps font-label-caps hover:opacity-80 transition-opacity" data-group-id="${escapeHtml(row.group_id)}" title="View group">
        <span class="material-symbols-outlined text-[14px]">${GROUP_TYPE_ICONS[row.group_type] || "label"}</span>
        ${escapeHtml(row.group_label || row.group_type || "Group")}
      </button>`
    : "";
  const excludedBadge = included
    ? ""
    : `<span class="inline-flex items-center mt-1 px-1.5 py-0.5 rounded-sm bg-surface-container-high border border-outline-variant text-label-caps font-label-caps text-on-surface-variant">Excluded</span>`;

  return `<tr class="hover:bg-surface-container-low transition-colors group ${included ? "" : "opacity-60"}">
      <td class="p-table-cell-padding"><input class="transaction-row-checkbox rounded-sm border-outline-variant text-primary focus:ring-primary" type="checkbox" data-id="${row.id}" ${selectedTransactionIds.has(row.id) ? "checked" : ""} /></td>
      <td class="p-table-cell-padding text-on-surface-variant">${formatTransactionDate(row.date)}</td>
      <td class="p-table-cell-padding">
        <div class="font-semibold text-on-surface">${escapeHtml(row.description || "(no description)")}</div>
        ${
          row.statement_id
            ? `<button type="button" class="mt-0.5 block text-label-caps font-label-caps text-data-blue hover:underline truncate max-w-[220px] text-left" data-view-statement-id="${escapeHtml(String(row.statement_id))}" data-view-statement-name="${escapeHtml(resolveStatementDisplayName(row.statement_display_name, row.statement_bank_name, row.statement_account_last4, row.statement_filename))}">${escapeHtml(resolveStatementDisplayName(row.statement_display_name, row.statement_bank_name, row.statement_account_last4, row.statement_filename))}</button>`
            : ""
        }
        ${groupBadge || excludedBadge ? `<div class="flex items-center gap-1 flex-wrap">${groupBadge}${excludedBadge}</div>` : ""}
      </td>
      <td class="p-table-cell-padding text-right text-mono-data font-mono-data font-semibold ${row.amount > 0 ? "text-success" : "text-error"}">${formatCurrency(row.amount, row.statement_currency)}</td>
      <td class="p-table-cell-padding text-center">
        <select class="${CLASSIFICATION_SELECT_CLASSES}" data-classification-select data-transaction-id="${row.id}" data-transaction-description="${escapeHtml(row.description || "")}">
          <option value="" ${!row.category || row.category === "Uncategorized" ? "selected" : ""}>Uncategorized</option>
          ${TRANSACTION_CATEGORIES.map(
            (option) => `<option value="${option}" ${row.category === option ? "selected" : ""}>${option}</option>`,
          ).join("")}
        </select>
      </td>
      <td class="p-table-cell-padding text-center">
        <div class="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button type="button" class="text-on-surface-variant hover:text-on-surface" data-toggle-include="${row.id}" data-current-include="${included ? "1" : "0"}" title="${included ? "Exclude from totals" : "Include in totals"}">
            <span class="material-symbols-outlined text-[18px]">${included ? "visibility" : "visibility_off"}</span>
          </button>
          ${
            row.group_id
              ? `<button type="button" class="text-on-surface-variant hover:text-error" data-remove-from-group="${row.id}" title="Remove from group"><span class="material-symbols-outlined text-[18px]">link_off</span></button>`
              : `<button type="button" class="text-on-surface-variant hover:text-on-surface" data-add-to-group="${row.id}" title="Add to group"><span class="material-symbols-outlined text-[18px]">link</span></button>`
          }
        </div>
      </td>
    </tr>`;
}

function buildReviewFilterClause() {
  const conditions = [];
  const params = [];
  if (reviewCurrentFilter) {
    params.push(reviewCurrentFilter);
    conditions.push(`t.category = $${params.length}`);
  }
  if (reviewSearchQuery) {
    params.push(`%${reviewSearchQuery.toLowerCase()}%`);
    const descParamIndex = params.length;
    params.push(`%${reviewSearchQuery}%`);
    const amountParamIndex = params.length;
    // printf('%.2f', ...) matches the 2-decimal format shown in the Amount column (and keeps the
    // sign), so typing e.g. "500" or "-500" finds transactions around that amount as substrings.
    conditions.push(`(LOWER(t.description) LIKE $${descParamIndex} OR printf('%.2f', t.amount) LIKE $${amountParamIndex})`);
  }
  if (reviewDateFrom) {
    params.push(reviewDateFrom);
    conditions.push(`t.date >= $${params.length}`);
  }
  if (reviewDateTo) {
    params.push(reviewDateTo);
    conditions.push(`t.date <= $${params.length}`);
  }
  if (reviewStatementFilter) {
    params.push(reviewStatementFilter);
    conditions.push(`t.statement_id = $${params.length}`);
  }
  if (reviewGroupFilter === "__grouped__") {
    conditions.push("t.group_id IS NOT NULL");
  } else if (reviewGroupFilter === "__ungrouped__") {
    conditions.push("t.group_id IS NULL");
  } else if (reviewGroupFilter) {
    params.push(reviewGroupFilter);
    conditions.push(`t.group_id = $${params.length}`);
  }
  return { clause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", params };
}

// ================= Review Export =================

const REVIEW_EXPORT_HEADERS = ["Date", "Description", "Amount", "Currency", "Category", "Statement", "Group", "Considered"];

async function fetchReviewTransactionsForExport() {
  await ensureStatementsDb();
  const { clause, params } = buildReviewFilterClause();
  return invoke("plugin:sql|select", {
    db: STATEMENTS_DB,
    query:
      `SELECT t.date, t.description, t.amount, t.category, t.include_in_totals, t.group_id, tg.group_type AS group_type, tg.label AS group_label, s.filename AS statement_filename, s.bank_name AS statement_bank_name, s.account_last4 AS statement_account_last4, s.currency AS statement_currency, s.display_name AS statement_display_name FROM transactions t LEFT JOIN statements s ON s.id = t.statement_id LEFT JOIN transaction_groups tg ON tg.id = t.group_id ${clause} ORDER BY t.date DESC, t.created_at DESC`,
    values: params,
  });
}

function buildReviewExportRows(rows) {
  return rows.map((row) => [
    row.date,
    row.description || "",
    row.amount,
    row.statement_currency || "INR",
    normalizeTransactionCategory(row.category),
    row.statement_filename
      ? resolveStatementDisplayName(row.statement_display_name, row.statement_bank_name, row.statement_account_last4, row.statement_filename)
      : "",
    row.group_id ? `${row.group_type}: ${row.group_label}` : "",
    row.include_in_totals === 0 ? "No" : "Yes",
  ]);
}

function csvEscape(value) {
  const str = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function exportReviewTransactions(format) {
  const rows = await fetchReviewTransactionsForExport();
  const exportRows = buildReviewExportRows(rows);
  const dateStamp = new Date().toISOString().slice(0, 10);

  if (format === "csv") {
    const csv = [REVIEW_EXPORT_HEADERS, ...exportRows].map((line) => line.map(csvEscape).join(",")).join("\r\n");
    downloadFile(`transactions-${dateStamp}.csv`, csv, "text/csv;charset=utf-8;");
  } else if (format === "xlsx") {
    const worksheet = window.XLSX.utils.aoa_to_sheet([REVIEW_EXPORT_HEADERS, ...exportRows]);
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, worksheet, "Transactions");
    window.XLSX.writeFile(workbook, `transactions-${dateStamp}.xlsx`);
  }
}

document.getElementById("review-export-btn")?.addEventListener("click", (event) => {
  event.stopPropagation();
  document.getElementById("review-export-menu")?.classList.toggle("hidden");
});

document.addEventListener("click", () => {
  document.getElementById("review-export-menu")?.classList.add("hidden");
});

document.getElementById("review-export-menu")?.addEventListener("click", async (event) => {
  const btn = event.target.closest("button[data-export-format]");
  if (!btn) return;
  document.getElementById("review-export-menu")?.classList.add("hidden");
  await exportReviewTransactions(btn.dataset.exportFormat);
});

async function renderReviewTransactions() {
  await ensureStatementsDb();

  const emptyState = document.getElementById("review-empty-state");
  const tableWrap = document.getElementById("review-table-wrap");
  const tbody = document.getElementById("review-table-body");
  const paginationLabel = document.getElementById("review-pagination-label");
  const prevBtn = document.getElementById("review-prev-btn");
  const nextBtn = document.getElementById("review-next-btn");

  const { clause: countWhereClause, params: countParams } = buildReviewFilterClause();
  const countRows = await invoke("plugin:sql|select", {
    db: STATEMENTS_DB,
    query: `SELECT COUNT(*) as count FROM transactions t ${countWhereClause}`,
    values: countParams,
  });
  const total = countRows[0]?.count ?? 0;

  if (total === 0) {
    emptyState.classList.remove("hidden");
    tableWrap.classList.add("hidden");
    paginationLabel.textContent = "Showing 0 of 0 transactions";
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  emptyState.classList.add("hidden");
  tableWrap.classList.remove("hidden");

  const totalPages = Math.max(1, Math.ceil(total / TRANSACTIONS_PER_PAGE));
  reviewCurrentPage = Math.min(reviewCurrentPage, totalPages - 1);
  const offset = reviewCurrentPage * TRANSACTIONS_PER_PAGE;

  const { clause: whereClause, params } = buildReviewFilterClause();
  params.push(TRANSACTIONS_PER_PAGE, offset);

  const rows = await invoke("plugin:sql|select", {
    db: STATEMENTS_DB,
    query:
      `SELECT t.id, t.date, t.description, t.amount, t.category, t.include_in_totals, t.group_id, tg.group_type AS group_type, tg.label AS group_label, s.id AS statement_id, s.filename AS statement_filename, s.bank_name AS statement_bank_name, s.account_last4 AS statement_account_last4, s.currency AS statement_currency, s.display_name AS statement_display_name FROM transactions t LEFT JOIN statements s ON s.id = t.statement_id LEFT JOIN transaction_groups tg ON tg.id = t.group_id ${whereClause} ORDER BY t.date DESC, t.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    values: params,
  });

  const rangeStart = offset + 1;
  const rangeEnd = offset + rows.length;
  paginationLabel.textContent = `Showing ${rangeStart}-${rangeEnd} of ${total} transactions`;
  prevBtn.disabled = reviewCurrentPage === 0;
  nextBtn.disabled = rangeEnd >= total;

  const rowIds = new Set(rows.map((row) => row.id));
  selectedTransactionIds = new Set([...selectedTransactionIds].filter((id) => rowIds.has(id)));
  tbody.innerHTML = rows.map(reviewTransactionRow).join("");
  updateReviewSelectAllCheckbox();
  updateGroupToolbar();
}

async function loadReviewScreen() {
  reviewCurrentPage = 0;
  await backfillTransactionExtraction();
  await populateReviewFileFilter();
  await populateReviewGroupFilter();
  await renderReviewTransactions();
  await renderGroupSuggestionBanner();
}

function normalizeTransactionCategory(category) {
  return TRANSACTION_CATEGORIES.includes(category) ? category : "Uncategorized";
}

// ================= Tax Estimate (FY 2026-27 / AY 2027-28, India) =================
// Sources: Section 87A rebate thresholds and slab tables as published by ClearTax, Canara HSBC
// Life, Bajaj Housing Finance and BankBazaar for FY 2026-27 (accessed Sep 2026). This is a
// simplified estimate - it deliberately excludes surcharge, marginal relief above the rebate
// cliff, and itemized deductions (80C/80D/HRA/home loan interest) since the app doesn't collect
// that data; the UI states this explicitly next to the numbers.
const TAX_REGIMES = {
  "New Regime": {
    standardDeduction: 75000,
    rebateThreshold: 1200000,
    rebateMax: 60000,
    slabs: [
      { upTo: 400000, rate: 0 },
      { upTo: 800000, rate: 0.05 },
      { upTo: 1200000, rate: 0.1 },
      { upTo: 1600000, rate: 0.15 },
      { upTo: 2000000, rate: 0.2 },
      { upTo: 2400000, rate: 0.25 },
      { upTo: Infinity, rate: 0.3 },
    ],
  },
  "Old Regime": {
    standardDeduction: 50000,
    rebateThreshold: 500000,
    rebateMax: 12500,
    slabs: [
      { upTo: 250000, rate: 0 },
      { upTo: 500000, rate: 0.05 },
      { upTo: 1000000, rate: 0.2 },
      { upTo: Infinity, rate: 0.3 },
    ],
  },
};

const CESS_RATE = 0.04;

// Only salaried income gets the standard deduction - self-employed/business profiles are taxed
// on actual profit (gross income less the business expenses already tracked in this app).
const TAX_PROFILES = {
  Salaried: { usesStandardDeduction: true },
  "Self Employed": { usesStandardDeduction: false },
  Business: { usesStandardDeduction: false },
};

function computeSlabTax(taxableIncome, slabs) {
  let tax = 0;
  let lowerBound = 0;
  for (const { upTo, rate } of slabs) {
    if (taxableIncome <= lowerBound) break;
    const slabAmount = Math.min(taxableIncome, upTo) - lowerBound;
    tax += slabAmount * rate;
    lowerBound = upTo;
  }
  return tax;
}

function computeRegimeTax(grossIncome, deductibleExpenses, profileName, regimeName) {
  const regime = TAX_REGIMES[regimeName];
  const profile = TAX_PROFILES[profileName] || TAX_PROFILES.Salaried;
  const deduction = profile.usesStandardDeduction ? regime.standardDeduction : deductibleExpenses;
  const taxableIncome = Math.max(0, grossIncome - deduction);

  const slabTax = computeSlabTax(taxableIncome, regime.slabs);
  const rebate = taxableIncome <= regime.rebateThreshold ? Math.min(slabTax, regime.rebateMax) : 0;
  const taxAfterRebate = slabTax - rebate;
  const cess = taxAfterRebate * CESS_RATE;
  const totalPayable = taxAfterRebate + cess;

  return { taxableIncome, deduction, slabTax, rebate, taxAfterRebate, cess, totalPayable };
}

let insightsProfileType = "Salaried";
let insightsLatestTotals = { income: 0, expenses: 0 };

function renderTaxEstimate() {
  const profileLabel = document.getElementById("insights-tax-profile-label");
  const regimesEl = document.getElementById("insights-tax-regimes");
  if (!profileLabel || !regimesEl) return;

  const { income, expenses } = insightsLatestTotals;
  profileLabel.textContent = insightsProfileType;

  const results = Object.keys(TAX_REGIMES).map((regimeName) => ({
    regimeName,
    ...computeRegimeTax(income, expenses, insightsProfileType, regimeName),
  }));
  const cheapestTotal = Math.min(...results.map((r) => r.totalPayable));

  regimesEl.innerHTML = results
    .map(({ regimeName, taxableIncome, rebate, cess, totalPayable }) => {
      const isRecommended = totalPayable === cheapestTotal;
      return `<div class="border ${isRecommended ? "border-success" : "border-outline-variant"} rounded-lg p-4">
        <div class="flex items-center justify-between mb-3">
          <h4 class="text-body-sm font-body-sm font-semibold text-on-surface">${regimeName}</h4>
          ${isRecommended ? `<span class="text-label-caps font-label-caps text-success uppercase">Lower Tax</span>` : ""}
        </div>
        <div class="flex justify-between text-body-sm font-body-sm text-on-surface-variant py-1">
          <span>Taxable Income</span>
          <span class="text-mono-data-sm font-mono-data-sm text-on-surface">${formatCurrency(taxableIncome)}</span>
        </div>
        <div class="flex justify-between text-body-sm font-body-sm text-on-surface-variant py-1">
          <span>Section 87A Rebate</span>
          <span class="text-mono-data-sm font-mono-data-sm text-on-surface">${formatCurrency(rebate)}</span>
        </div>
        <div class="flex justify-between text-body-sm font-body-sm text-on-surface-variant py-1">
          <span>Health &amp; Education Cess (4%)</span>
          <span class="text-mono-data-sm font-mono-data-sm text-on-surface">${formatCurrency(cess)}</span>
        </div>
        <div class="flex justify-between items-center mt-2 pt-2 border-t border-outline-variant">
          <span class="text-body-sm font-body-sm font-semibold text-on-surface">Total Tax Payable</span>
          <span class="text-title-sm font-title-sm font-semibold text-primary">${formatCurrency(totalPayable)}</span>
        </div>
      </div>`;
    })
    .join("");
}

document.getElementById("insights-profile-select")?.addEventListener("change", (event) => {
  insightsProfileType = event.target.value;
  renderTaxEstimate();
});

// ================= Tax Slabs Info Modal =================

function formatSlabRange(lowerBound, upTo) {
  if (upTo === Infinity) return `Above ${formatCurrency(lowerBound)}`;
  if (lowerBound === 0) return `Up to ${formatCurrency(upTo)}`;
  return `${formatCurrency(lowerBound)} - ${formatCurrency(upTo)}`;
}

function renderTaxSlabsInfoBody(profileName) {
  const bodyEl = document.getElementById("tax-slabs-info-body");
  if (!bodyEl) return;
  const profile = TAX_PROFILES[profileName] || TAX_PROFILES.Salaried;

  bodyEl.innerHTML = Object.entries(TAX_REGIMES)
    .map(([regimeName, regime]) => {
      let lowerBound = 0;
      const rows = regime.slabs
        .map(({ upTo, rate }) => {
          const range = formatSlabRange(lowerBound, upTo);
          lowerBound = upTo;
          return `<tr class="border-b border-outline-variant last:border-0">
            <td class="py-1.5 pr-2 text-body-sm font-body-sm text-on-surface-variant">${range}</td>
            <td class="py-1.5 text-right text-mono-data-sm font-mono-data-sm text-on-surface">${rate === 0 ? "Nil" : `${Math.round(rate * 100)}%`}</td>
          </tr>`;
        })
        .join("");
      return `<div class="border border-outline-variant rounded-lg p-4">
        <h4 class="text-body-sm font-body-sm font-semibold text-on-surface mb-2">${regimeName}</h4>
        <table class="w-full border-collapse mb-3">
          <thead>
            <tr class="border-b border-outline-variant">
              <th class="py-1 pr-2 text-left text-label-caps font-label-caps text-on-surface-variant uppercase">Income Slab</th>
              <th class="py-1 text-right text-label-caps font-label-caps text-on-surface-variant uppercase">Rate</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="text-body-sm font-body-sm text-on-surface-variant space-y-1">
          <p>Standard Deduction: <span class="text-on-surface font-semibold">${
            profile.usesStandardDeduction ? formatCurrency(regime.standardDeduction) : "Not applicable (profit already net of expenses)"
          }</span></p>
          <p>Section 87A Rebate: <span class="text-on-surface font-semibold">Full rebate up to ${formatCurrency(regime.rebateMax)} tax if taxable income &le; ${formatCurrency(regime.rebateThreshold)}</span></p>
          <p>Health &amp; Education Cess: <span class="text-on-surface font-semibold">${CESS_RATE * 100}% of tax after rebate</span></p>
        </div>
      </div>`;
    })
    .join("");
}

function setActiveTaxSlabsInfoTab(profileName) {
  document.querySelectorAll(".tax-slabs-info-tab").forEach((btn) => {
    const active = btn.dataset.profile === profileName;
    btn.classList.toggle("border-primary", active);
    btn.classList.toggle("text-primary", active);
    btn.classList.toggle("border-transparent", !active);
    btn.classList.toggle("text-on-surface-variant", !active);
  });
}

function renderTaxSlabsInfoModal() {
  const tabsEl = document.getElementById("tax-slabs-info-tabs");
  if (!tabsEl) return;
  const profiles = Object.keys(TAX_PROFILES);
  const defaultProfile = profiles.includes(insightsProfileType) ? insightsProfileType : profiles[0];

  tabsEl.innerHTML = profiles
    .map(
      (name) =>
        `<button type="button" data-profile="${name}" class="tax-slabs-info-tab px-3 py-2 text-body-sm font-body-sm font-semibold border-b-2 transition-colors">${name}</button>`,
    )
    .join("");

  tabsEl.querySelectorAll(".tax-slabs-info-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      setActiveTaxSlabsInfoTab(btn.dataset.profile);
      renderTaxSlabsInfoBody(btn.dataset.profile);
    });
  });

  setActiveTaxSlabsInfoTab(defaultProfile);
  renderTaxSlabsInfoBody(defaultProfile);
}

function closeTaxSlabsInfoModal() {
  document.getElementById("tax-slabs-info-overlay")?.classList.add("hidden");
}

document.getElementById("insights-tax-info-btn")?.addEventListener("click", () => {
  renderTaxSlabsInfoModal();
  document.getElementById("tax-slabs-info-overlay")?.classList.remove("hidden");
});
document.getElementById("tax-slabs-info-close")?.addEventListener("click", closeTaxSlabsInfoModal);
document.getElementById("tax-slabs-info-overlay")?.addEventListener("click", (event) => {
  if (event.target.id === "tax-slabs-info-overlay") closeTaxSlabsInfoModal();
});

const CATEGORY_COLORS = {
  Income: "#1a754c",
  "Personal Expense": "#515f74",
  "Business Expense": "#008cc7",
  "Internal Transfer": "#a67300",
  Uncategorized: "#45464d",
};

// Renders a horizontal bar chart: one row per category, sorted largest-first, each bar's width
// proportional to its share of the largest category's total.
function renderCategoryBarChart(chartEl, totalsByCategory) {
  const buckets = Object.entries(totalsByCategory)
    .filter(([, total]) => total > 0)
    .sort((a, b) => b[1] - a[1]);
  const grandTotal = buckets.reduce((sum, [, total]) => sum + total, 0);
  const maxTotal = Math.max(0, ...buckets.map(([, total]) => total));

  if (buckets.length === 0 || grandTotal === 0) {
    chartEl.innerHTML = `<div class="w-full h-full flex items-center justify-center text-body-sm font-body-sm text-on-surface-variant">No transactions yet</div>`;
    return;
  }

  chartEl.innerHTML = `<div class="w-full h-full flex flex-col justify-center gap-3 p-4">
    ${buckets
      .map(([label, total]) => {
        const pct = maxTotal > 0 ? Math.max(2, Math.round((total / maxTotal) * 100)) : 0;
        const share = Math.round((total / grandTotal) * 100);
        return `<div class="flex items-center gap-3">
          <span class="w-32 shrink-0 text-body-sm font-body-sm text-on-surface-variant truncate">${escapeHtml(label)}</span>
          <div class="flex-1 h-4 bg-surface-container-high rounded-sm overflow-hidden">
            <div class="h-full rounded-sm" style="width: ${pct}%; background-color: ${CATEGORY_COLORS[label] || "#45464d"}"></div>
          </div>
          <span class="w-12 shrink-0 text-right text-mono-data-sm font-mono-data-sm text-on-surface-variant">${share}%</span>
          <span class="w-28 shrink-0 text-right text-mono-data-sm font-mono-data-sm font-semibold text-on-surface">${formatCurrency(total)}</span>
        </div>`;
      })
      .join("")}
  </div>`;
}

async function loadInsightsScreen() {
  await ensureStatementsDb();

  const grossIncomeEl = document.getElementById("insights-gross-income");
  const deductibleExpensesEl = document.getElementById("insights-deductible-expenses");
  const expenseRatioEl = document.getElementById("insights-expense-ratio");
  const chartEl = document.getElementById("insights-category-chart");

  const totalsRows = await invoke("plugin:sql|select", {
    db: STATEMENTS_DB,
    query:
      "SELECT COALESCE(SUM(CASE WHEN category = 'Income' THEN amount ELSE 0 END), 0) AS income, " +
      "COALESCE(SUM(CASE WHEN category = 'Business Expense' THEN ABS(amount) ELSE 0 END), 0) AS expenses " +
      "FROM transactions WHERE include_in_totals = 1",
    values: [],
  });
  const income = totalsRows[0]?.income ?? 0;
  const expenses = totalsRows[0]?.expenses ?? 0;

  grossIncomeEl.textContent = formatCurrency(income);
  deductibleExpensesEl.textContent = formatCurrency(expenses);
  expenseRatioEl.textContent = `${income > 0 ? Math.round((expenses / income) * 100) : 0}% of Gross Income`;

  insightsLatestTotals = { income, expenses };
  const profileSelect = document.getElementById("insights-profile-select");
  if (profileSelect) profileSelect.value = insightsProfileType;
  renderTaxEstimate();

  const categoryRows = await invoke("plugin:sql|select", {
    db: STATEMENTS_DB,
    query: "SELECT category, SUM(ABS(amount)) AS total FROM transactions WHERE include_in_totals = 1 GROUP BY category",
    values: [],
  });

  const totalsByCategory = { ...Object.fromEntries(TRANSACTION_CATEGORIES.map((c) => [c, 0])), Uncategorized: 0 };
  for (const row of categoryRows) {
    const normalized = normalizeTransactionCategory(row.category);
    totalsByCategory[normalized] += row.total ?? 0;
  }

  renderCategoryBarChart(chartEl, totalsByCategory);
}

document.getElementById("review-prev-btn")?.addEventListener("click", () => {
  if (reviewCurrentPage > 0) {
    reviewCurrentPage -= 1;
    selectedTransactionIds.clear();
    renderReviewTransactions();
  }
});

document.getElementById("review-next-btn")?.addEventListener("click", () => {
  reviewCurrentPage += 1;
  selectedTransactionIds.clear();
  renderReviewTransactions();
});

const initialView = window.location.hash.replace("#", "") || "statements";
setActiveView(VIEWS[initialView] ? initialView : "statements");
