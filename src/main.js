import * as pdfjsLib from "./vendor/pdfjs/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.min.mjs";

const VIEWS = {
  dashboard: { title: "TaxShield AI Dashboard", search: "Search..." },
  statements: { title: "Statements - TaxShield AI", search: "Search statements, forms, IDs..." },
  review: { title: "TaxShield AI - Transaction Review", search: "Search transactions..." },
  insights: { title: "Tax Insights - TaxShield AI", search: "Search insights, documents, or data..." },
};

const ACTIVE_CLASSES = ["text-primary", "font-semibold", "border-r-2", "border-primary", "bg-surface-container-low"];
const INACTIVE_CLASSES = ["text-on-surface-variant", "hover:text-on-surface", "hover:bg-surface-container-low"];

function setActiveView(name) {
  if (!VIEWS[name]) return;

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
  if (searchInput) searchInput.placeholder = VIEWS[name].search;

  document.title = VIEWS[name].title;
  window.location.hash = name;

  if (name === "review") loadReviewScreen();
}

document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    setActiveView(link.dataset.view);
  });
});

// ================= Statement Management =================

const invoke = window.__TAURI__.core.invoke;
const STATEMENTS_DB = "sqlite:taxai.db";
const MAX_STATEMENT_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const ALLOWED_STATEMENT_EXTENSIONS = new Set(["xlsx", "xls", "csv", "pdf"]);
const STATEMENT_STATUS_FAILED_TO_PARSE = "failed_to_parse";

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

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
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
    let [, m, d, y] = match;
    if (y.length === 2) y = (Number(y) < 70 ? "20" : "19") + y;
    m = m.padStart(2, "0");
    d = d.padStart(2, "0");
    if (Number(m) > 12 || Number(d) > 31) return null;
    return `${y}-${m}-${d}`;
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
  str = str.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(str)) return null;
  const num = Number(str);
  if (Number.isNaN(num)) return null;
  return negative ? -num : num;
}

function detectColumns(headerRow) {
  const headers = headerRow.map((h) => (h ?? "").toString().trim().toLowerCase());
  const findIndex = (patterns) => headers.findIndex((h) => patterns.some((p) => p.test(h)));

  return {
    dateCol: findIndex([/^date$/, /transaction date/, /posted date/, /post date/]),
    descCol: findIndex([/^description$/, /memo/, /merchant/, /payee/, /details/, /narrative/]),
    amountCol: findIndex([/^amount$/, /^amt$/]),
    debitCol: findIndex([/^debit$/, /withdrawal/, /money out/]),
    creditCol: findIndex([/^credit$/, /deposit/, /money in/]),
  };
}

function extractRowsFromTable(headerRow, dataRows) {
  const cols = detectColumns(headerRow);
  const hasAmount = cols.amountCol !== -1;
  const hasDebitCredit = cols.debitCol !== -1 || cols.creditCol !== -1;
  if (cols.dateCol === -1 || (!hasAmount && !hasDebitCredit)) return [];

  const transactions = [];
  for (const row of dataRows) {
    const date = parseDate(row[cols.dateCol]);
    if (date === null) continue;

    let amount;
    if (hasAmount) {
      amount = parseAmount(row[cols.amountCol]);
      if (amount === null) continue;
    } else {
      const debit = cols.debitCol !== -1 ? parseAmount(row[cols.debitCol]) : null;
      const credit = cols.creditCol !== -1 ? parseAmount(row[cols.creditCol]) : null;
      if (debit === null && credit === null) continue;
      amount = (credit ?? 0) - Math.abs(debit ?? 0);
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

async function extractExcelTransactions(buffer) {
  const workbook = window.XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const worksheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!worksheet) return [];

  const rows = window.XLSX.utils
    .sheet_to_json(worksheet, { header: 1, blankrows: false, defval: "" })
    .map((row) => row.map(excelCellToString));
  if (rows.length < 2) return [];

  const [header, ...dataRows] = rows;
  return extractRowsFromTable(header, dataRows);
}

function extractCsvTransactions(text) {
  const rows = parseCsvContent(text);
  if (rows.length < 2) return [];
  const [header, ...dataRows] = rows;
  return extractRowsFromTable(header, dataRows);
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

async function extractPdfTransactions(buffer) {
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  const transactions = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const lines = groupPdfTextItemsIntoLines(textContent.items);

    for (const line of lines) {
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

async function extractTransactionsForStatement(statement) {
  let rows = [];
  let parseFailed = false;
  try {
    if (statement.file_type === "xlsx" || statement.file_type === "xls") {
      rows = await extractExcelTransactions(base64ToArrayBuffer(statement.content_base64));
    } else if (statement.file_type === "csv") {
      rows = extractCsvTransactions(base64ToText(statement.content_base64));
    } else if (statement.file_type === "pdf") {
      rows = await extractPdfTransactions(base64ToArrayBuffer(statement.content_base64));
    }
  } catch (err) {
    console.error(`Failed to extract transactions for statement ${statement.id}`, err);
    parseFailed = true;
    rows = [];
  }

  await ensureStatementsDb();

  if (parseFailed) {
    await invoke("plugin:sql|execute", {
      db: STATEMENTS_DB,
      query: "UPDATE statements SET status = $1 WHERE id = $2",
      values: [STATEMENT_STATUS_FAILED_TO_PARSE, statement.id],
    });
    return;
  }

  if (rows.length === 0) return;

  const createdAt = new Date().toISOString();
  for (const row of rows) {
    await invoke("plugin:sql|execute", {
      db: STATEMENTS_DB,
      query:
        "INSERT INTO transactions (id, statement_id, date, description, amount, category, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      values: [crypto.randomUUID(), statement.id, row.date, row.description, row.amount, "Uncategorized", createdAt],
    });
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
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  try {
    await invoke("plugin:sql|execute", {
      db: STATEMENTS_DB,
      query:
        "INSERT INTO statements (id, filename, file_type, size_bytes, content_base64, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      values: [id, file.name, ext, file.size, contentBase64, "saved", createdAt],
    });
  } catch (err) {
    showStatementError(`Failed to save "${file.name}".`);
    console.error(err);
    return;
  }

  await extractTransactionsForStatement({ id, file_type: ext, content_base64: contentBase64 });
}

async function saveStatementFiles(fileList) {
  showStatementError(null);
  const files = Array.from(fileList);
  for (const file of files) {
    await saveStatementFile(file);
  }
  await renderStatements();
}

let selectedStatementIds = new Set();

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

async function renderStatements() {
  await ensureStatementsDb();
  const rows = await invoke("plugin:sql|select", {
    db: STATEMENTS_DB,
    query: "SELECT id, filename, file_type, size_bytes, status, created_at FROM statements ORDER BY created_at DESC",
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

  tbody.innerHTML = rows
    .map((row) => {
      const icon = row.file_type === "pdf" ? "picture_as_pdf" : "description";
      const iconColor = row.file_type === "pdf" ? "text-warning" : "text-data-blue";
      const checked = selectedStatementIds.has(row.id) ? "checked" : "";
      const failedBadge = (label) =>
        `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-surface-container-high border border-error/30 text-mono-data-sm text-error font-medium"><span class="w-1.5 h-1.5 rounded-full bg-error"></span> ${label}</span>`;
      const statusBadge =
        row.status === "saved"
          ? `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-surface-container-high border border-outline-variant text-mono-data-sm text-on-surface"><span class="w-1.5 h-1.5 rounded-full bg-success"></span> Saved</span>`
          : row.status === STATEMENT_STATUS_FAILED_TO_PARSE
            ? failedBadge("Failed to parse")
            : failedBadge("Failed");
      return `<tr class="hover:bg-surface-container-low transition-colors group cursor-default" data-row-id="${row.id}">
          <td class="p-table-cell-padding text-center"><input class="row-checkbox rounded-sm border-outline-variant text-primary focus:ring-primary w-3.5 h-3.5" type="checkbox" data-id="${row.id}" ${checked} /></td>
          <td class="p-table-cell-padding font-medium flex items-center gap-2"><span class="material-symbols-outlined ${iconColor} text-[18px]">${icon}</span>${escapeHtml(row.filename)}</td>
          <td class="p-table-cell-padding text-mono-data font-mono-data text-right text-on-surface-variant">${formatStatementDate(row.created_at)}</td>
          <td class="p-table-cell-padding text-mono-data font-mono-data text-right text-on-surface-variant">${formatStatementSize(row.size_bytes)}</td>
          <td class="p-table-cell-padding">${statusBadge}</td>
        </tr>`;
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

async function backfillTransactionExtraction() {
  await ensureStatementsDb();
  const statements = await invoke("plugin:sql|select", {
    db: STATEMENTS_DB,
    query:
      "SELECT id, file_type, content_base64 FROM statements WHERE id NOT IN (SELECT DISTINCT statement_id FROM transactions)",
    values: [],
  });
  for (const statement of statements) {
    await extractTransactionsForStatement(statement);
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

function formatTransactionAmount(amount) {
  const sign = amount < 0 ? "-" : "+";
  const formatted = Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}$${formatted}`;
}

function reviewTransactionRow(row) {
  const amountClass = row.amount >= 0 ? "text-success" : "";
  return `<tr class="hover:bg-surface-container-low transition-colors group">
      <td class="p-table-cell-padding"><input class="rounded-sm border-outline-variant text-primary focus:ring-primary" type="checkbox" /></td>
      <td class="p-table-cell-padding text-on-surface-variant">${formatTransactionDate(row.date)}</td>
      <td class="p-table-cell-padding font-semibold text-on-surface">${escapeHtml(row.description || "(no description)")}</td>
      <td class="p-table-cell-padding"><span class="inline-flex items-center gap-1 text-warning text-[11px] font-semibold"><span class="material-symbols-outlined text-[12px]">warning</span> Uncategorized</span></td>
      <td class="p-table-cell-padding text-right text-mono-data font-mono-data font-semibold ${amountClass}">${formatTransactionAmount(row.amount)}</td>
      <td class="p-table-cell-padding text-center">
        <div class="inline-flex bg-surface-container p-0.5 rounded border border-outline-variant">
          <button class="px-2 py-1 text-[11px] font-semibold text-on-surface-variant hover:text-on-surface rounded-sm">Bus</button>
          <button class="px-2 py-1 text-[11px] font-semibold text-on-surface-variant hover:text-on-surface rounded-sm">Per</button>
        </div>
      </td>
      <td class="p-table-cell-padding text-center"><button class="text-on-surface-variant hover:text-on-surface opacity-0 group-hover:opacity-100 transition-opacity"><span class="material-symbols-outlined text-[18px]">more_vert</span></button></td>
    </tr>`;
}

async function renderReviewTransactions() {
  await ensureStatementsDb();

  const emptyState = document.getElementById("review-empty-state");
  const tableWrap = document.getElementById("review-table-wrap");
  const tbody = document.getElementById("review-table-body");
  const paginationLabel = document.getElementById("review-pagination-label");
  const prevBtn = document.getElementById("review-prev-btn");
  const nextBtn = document.getElementById("review-next-btn");

  const countRows = await invoke("plugin:sql|select", {
    db: STATEMENTS_DB,
    query: "SELECT COUNT(*) as count FROM transactions",
    values: [],
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

  const rows = await invoke("plugin:sql|select", {
    db: STATEMENTS_DB,
    query:
      "SELECT id, date, description, amount, category FROM transactions ORDER BY date DESC, created_at DESC LIMIT $1 OFFSET $2",
    values: [TRANSACTIONS_PER_PAGE, offset],
  });

  const rangeStart = offset + 1;
  const rangeEnd = offset + rows.length;
  paginationLabel.textContent = `Showing ${rangeStart}-${rangeEnd} of ${total} transactions`;
  prevBtn.disabled = reviewCurrentPage === 0;
  nextBtn.disabled = rangeEnd >= total;

  tbody.innerHTML = rows.map(reviewTransactionRow).join("");
}

async function loadReviewScreen() {
  reviewCurrentPage = 0;
  await backfillTransactionExtraction();
  await renderReviewTransactions();
}

document.getElementById("review-prev-btn")?.addEventListener("click", () => {
  if (reviewCurrentPage > 0) {
    reviewCurrentPage -= 1;
    renderReviewTransactions();
  }
});

document.getElementById("review-next-btn")?.addEventListener("click", () => {
  reviewCurrentPage += 1;
  renderReviewTransactions();
});

const initialView = window.location.hash.replace("#", "") || "dashboard";
setActiveView(VIEWS[initialView] ? initialView : "dashboard");
