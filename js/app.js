/* ==========================================================
   BudgetTrack — app.js
   Vanilla JavaScript | No frameworks | Local Storage
   ========================================================== */

'use strict';

/* ==========================================================
   1. STATE
   ========================================================== */

/** @type {Array<{id:number, name:string, amount:number, category:string, date:string}>} */
let transactions = [];

/** @type {string[]} */
let categories = ['Food', 'Transport', 'Fun'];

/** @type {number} spending limit in Rp (0 = no limit) */
let spendingLimit = 0;

/** @type {string} 'light' | 'dark' */
let theme = 'light';

/** Chart.js instance */
let chart = null;

/* ==========================================================
   2. LOCAL STORAGE HELPERS
   ========================================================== */

const LS_KEYS = {
  transactions: 'bt_transactions',
  categories:   'bt_categories',
  limit:        'bt_limit',
  theme:        'bt_theme',
};

function loadData() {
  try {
    const t = localStorage.getItem(LS_KEYS.transactions);
    if (t) transactions = JSON.parse(t);

    const c = localStorage.getItem(LS_KEYS.categories);
    if (c) {
      const saved = JSON.parse(c);
      // Merge: keep defaults + any custom ones saved
      const merged = [...new Set([...categories, ...saved])];
      categories = merged;
    }

    const l = localStorage.getItem(LS_KEYS.limit);
    if (l !== null) spendingLimit = parseFloat(l) || 0;

    const th = localStorage.getItem(LS_KEYS.theme);
    if (th) theme = th;
  } catch (e) {
    console.warn('BudgetTrack: failed to load data from localStorage', e);
  }
}

function saveTransactions() {
  try {
    localStorage.setItem(LS_KEYS.transactions, JSON.stringify(transactions));
  } catch (e) {
    console.warn('BudgetTrack: failed to save transactions', e);
  }
}

function saveCategories() {
  try {
    localStorage.setItem(LS_KEYS.categories, JSON.stringify(categories));
  } catch (e) {
    console.warn('BudgetTrack: failed to save categories', e);
  }
}

function saveLimit() {
  try {
    localStorage.setItem(LS_KEYS.limit, String(spendingLimit));
  } catch (e) {
    console.warn('BudgetTrack: failed to save limit', e);
  }
}

function saveTheme() {
  try {
    localStorage.setItem(LS_KEYS.theme, theme);
  } catch (e) {
    console.warn('BudgetTrack: failed to save theme', e);
  }
}

/* ==========================================================
   3. UTILITIES
   ========================================================== */

/**
 * Format a number as Rupiah string.
 * @param {number} n
 * @returns {string}
 */
function formatRp(n) {
  return 'Rp ' + n.toLocaleString('id-ID');
}

/**
 * Get today's date as YYYY-MM-DD string.
 * @returns {string}
 */
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Format a YYYY-MM date string as "Month YYYY".
 * @param {string} ym  e.g. "2026-10"
 * @returns {string}
 */
function formatMonth(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  const date = new Date(parseInt(y), parseInt(m) - 1, 1);
  return date.toLocaleString('default', { month: 'long', year: 'numeric' });
}

/**
 * Extract YYYY-MM from a YYYY-MM-DD date string.
 * @param {string} date
 * @returns {string}
 */
function toYearMonth(date) {
  return date ? date.slice(0, 7) : '';
}

/**
 * Get all unique YYYY-MM months present in transactions, sorted desc.
 * @returns {string[]}
 */
function getAvailableMonths() {
  const set = new Set(transactions.map(t => toYearMonth(t.date)));
  const currentMonth = todayISO().slice(0, 7);
  set.add(currentMonth); // always include current month
  return [...set].sort((a, b) => b.localeCompare(a));
}

/**
 * Get the currently selected month from the filter dropdown.
 * @returns {string} YYYY-MM
 */
function getSelectedMonth() {
  const el = document.getElementById('monthFilter');
  return el ? el.value : todayISO().slice(0, 7);
}

/**
 * Determine a deterministic colour for a custom category.
 * @param {string} name
 * @returns {string} hex colour
 */
function categoryColor(name) {
  const palette = [
    '#48bb78', '#4299e1', '#ed8936', '#9f7aea',
    '#e53e3e', '#38b2ac', '#d69e2e', '#667eea',
    '#fc8181', '#63b3ed', '#68d391', '#b794f4',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

/* ==========================================================
   4. CORE DATA FUNCTIONS
   ========================================================== */

/**
 * Add a new transaction.
 * @param {string} name
 * @param {number} amount
 * @param {string} category
 */
function addTransaction(name, amount, category) {
  const tx = {
    id:       Date.now(),
    name:     name.trim(),
    amount:   Math.abs(amount),
    category: category,
    date:     todayISO(),
  };
  transactions.unshift(tx); // newest first in array
  saveTransactions();
  renderAll();
}

/**
 * Delete a transaction by id.
 * @param {number} id
 */
function deleteTransaction(id) {
  transactions = transactions.filter(t => t.id !== id);
  saveTransactions();
  renderAll();
}

/**
 * Add a new custom category if it doesn't already exist.
 * @param {string} name
 * @returns {boolean} true if added, false if duplicate
 */
function addCategory(name) {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (categories.some(c => c.toLowerCase() === lower)) return false;
  // Capitalise first letter
  categories.push(trimmed.charAt(0).toUpperCase() + trimmed.slice(1));
  saveCategories();
  return true;
}

/**
 * Set a new spending limit.
 * @param {number} amount
 */
function setSpendingLimit(amount) {
  spendingLimit = Math.max(0, amount);
  saveLimit();
  renderBalance();
  renderTransactionList(); // re-check over-limit highlights
}

/* ==========================================================
   5. RENDER — BALANCE
   ========================================================== */

function renderBalance() {
  const totalSpentEl  = document.getElementById('totalSpent');
  const monthlyTotalEl = document.getElementById('monthlyTotal');
  const balanceCard    = document.getElementById('balanceCard');
  const limitBarFill   = document.getElementById('limitBarFill');
  const limitLabel     = document.getElementById('limitLabel');

  // Total across all transactions
  const totalAll = transactions.reduce((sum, t) => sum + t.amount, 0);

  // Total for selected month
  const selectedMonth = getSelectedMonth();
  const totalMonth = transactions
    .filter(t => toYearMonth(t.date) === selectedMonth)
    .reduce((sum, t) => sum + t.amount, 0);

  totalSpentEl.textContent  = formatRp(totalAll);
  monthlyTotalEl.textContent = formatRp(totalMonth);

  // Over-limit styling
  if (spendingLimit > 0) {
    const pct = Math.min((totalMonth / spendingLimit) * 100, 100);
    limitBarFill.style.width = pct + '%';
    limitBarFill.classList.remove('over', 'warn');

    if (totalMonth >= spendingLimit) {
      limitBarFill.classList.add('over');
      balanceCard.classList.add('over-limit');
      limitLabel.textContent = `Over limit! ${formatRp(totalMonth)} / ${formatRp(spendingLimit)}`;
    } else if (pct >= 75) {
      limitBarFill.classList.add('warn');
      balanceCard.classList.remove('over-limit');
      limitLabel.textContent = `${formatRp(totalMonth)} / ${formatRp(spendingLimit)} (${Math.round(pct)}%)`;
    } else {
      balanceCard.classList.remove('over-limit');
      limitLabel.textContent = `${formatRp(totalMonth)} / ${formatRp(spendingLimit)} (${Math.round(pct)}%)`;
    }
  } else {
    limitBarFill.style.width = '0%';
    limitBarFill.classList.remove('over', 'warn');
    balanceCard.classList.remove('over-limit');
    limitLabel.textContent = 'No limit set';
  }
}

/* ==========================================================
   6. RENDER — CATEGORY DROPDOWN
   ========================================================== */

function renderCategoryDropdown() {
  const sel = document.getElementById('itemCategory');
  if (!sel) return;

  const currentVal = sel.value;

  // Build options
  let html = '<option value="">Select category…</option>';
  categories.forEach(cat => {
    html += `<option value="${cat}">${cat}</option>`;
  });
  html += '<option value="__custom__">+ Add custom category…</option>';
  sel.innerHTML = html;

  // Restore selection if still valid
  if (currentVal && currentVal !== '__custom__' && categories.includes(currentVal)) {
    sel.value = currentVal;
  }
}

/* ==========================================================
   7. RENDER — MONTH FILTER DROPDOWN
   ========================================================== */

function renderMonthFilter() {
  const sel = document.getElementById('monthFilter');
  if (!sel) return;

  const currentVal = sel.value;
  const months = getAvailableMonths();
  const currentMonth = todayISO().slice(0, 7);

  let html = '';
  months.forEach(ym => {
    const label = ym === currentMonth ? `${formatMonth(ym)} (Current)` : formatMonth(ym);
    html += `<option value="${ym}">${label}</option>`;
  });
  sel.innerHTML = html;

  // Restore or default to current month
  if (currentVal && months.includes(currentVal)) {
    sel.value = currentVal;
  } else {
    sel.value = currentMonth;
  }
}

/* ==========================================================
   8. RENDER — TRANSACTION LIST
   ========================================================== */

function getSortedFilteredTransactions() {
  const selectedMonth = getSelectedMonth();
  const sortVal = document.getElementById('sortControl')?.value || 'date-desc';

  // Filter by selected month
  let list = transactions.filter(t => toYearMonth(t.date) === selectedMonth);

  // Sort
  list = [...list].sort((a, b) => {
    switch (sortVal) {
      case 'date-asc':     return a.date.localeCompare(b.date);
      case 'date-desc':    return b.date.localeCompare(a.date);
      case 'amount-asc':   return a.amount - b.amount;
      case 'amount-desc':  return b.amount - a.amount;
      case 'category-asc': return a.category.localeCompare(b.category);
      default:             return 0;
    }
  });

  return list;
}

function renderTransactionList() {
  const listEl   = document.getElementById('transactionList');
  const emptyEl  = document.getElementById('listEmpty');
  const countEl  = document.getElementById('txCount');

  const list = getSortedFilteredTransactions();

  // Running total to detect which items push spending over limit
  const selectedMonth = getSelectedMonth();
  const monthTotal = transactions
    .filter(t => toYearMonth(t.date) === selectedMonth)
    .reduce((sum, t) => sum + t.amount, 0);

  countEl.textContent = `${list.length} item${list.length !== 1 ? 's' : ''}`;

  if (list.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }

  emptyEl.classList.add('hidden');

  // Build list HTML
  const html = list.map(tx => {
    const isOverLimit = spendingLimit > 0 && monthTotal > spendingLimit;
    const overClass   = isOverLimit ? ' over-limit-item' : '';
    const dateFormatted = new Date(tx.date).toLocaleDateString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric'
    });
    const safeName = escapeHtml(tx.name);
    const safeCat  = escapeHtml(tx.category);

    return `
      <li class="tx-item${overClass}" data-id="${tx.id}" data-category="${safeCat}">
        <div class="tx-info">
          <p class="tx-name" title="${safeName}">${safeName}</p>
          <div class="tx-meta">
            <span class="tx-date">${dateFormatted}</span>
            <span class="cat-badge cat-${safeCat}">${safeCat}</span>
          </div>
        </div>
        <span class="tx-amount">−${formatRp(tx.amount)}</span>
        <button class="btn-delete" data-id="${tx.id}" aria-label="Delete ${safeName}" title="Delete">✕</button>
      </li>`;
  }).join('');

  listEl.innerHTML = html;
}

/** Simple HTML entity escaping to prevent XSS in dynamic content */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ==========================================================
   9. RENDER — PIE CHART
   ========================================================== */

function renderChart() {
  const canvas   = document.getElementById('spendingChart');
  const emptyEl  = document.getElementById('chartEmpty');
  const selectedMonth = getSelectedMonth();

  // Aggregate by category for selected month
  const monthly = transactions.filter(t => toYearMonth(t.date) === selectedMonth);

  /** @type {Record<string, number>} */
  const totals = {};
  monthly.forEach(t => {
    totals[t.category] = (totals[t.category] || 0) + t.amount;
  });

  const labels = Object.keys(totals);
  const data   = Object.values(totals);
  const colors = labels.map(l => categoryColor(l));

  if (labels.length === 0) {
    canvas.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    if (chart) { chart.destroy(); chart = null; }
    return;
  }

  canvas.classList.remove('hidden');
  emptyEl.classList.add('hidden');

  if (chart) {
    // Update existing chart
    chart.data.labels                     = labels;
    chart.data.datasets[0].data           = data;
    chart.data.datasets[0].backgroundColor = colors;
    chart.update();
  } else {
    // Create chart
    chart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: getComputedStyle(document.documentElement)
            .getPropertyValue('--bg-card').trim() || '#fff',
          hoverOffset: 8,
        }],
      },
      options: {
        responsive:  true,
        cutout:      '55%',
        animation:   { duration: 400 },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              padding:   16,
              font:      { size: 12, weight: '600' },
              color:     getComputedStyle(document.body)
                           .getPropertyValue('--text-secondary').trim() || '#4a5568',
              usePointStyle: true,
              pointStyleWidth: 10,
            },
          },
          tooltip: {
            callbacks: {
              label(ctx) {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct   = total ? Math.round((ctx.parsed / total) * 100) : 0;
                return ` ${ctx.label}: ${formatRp(ctx.parsed)} (${pct}%)`;
              },
            },
          },
        },
      },
    });
  }
}

/* ==========================================================
   10. RENDER — MONTHLY SUMMARY
   ========================================================== */

function renderMonthlySummary() {
  const summaryList  = document.getElementById('summaryList');
  const summaryEmpty = document.getElementById('summaryEmpty');
  const summaryMonth = document.getElementById('summaryMonthLabel');

  const selectedMonth = getSelectedMonth();
  summaryMonth.textContent = formatMonth(selectedMonth);

  const monthly = transactions.filter(t => toYearMonth(t.date) === selectedMonth);

  /** @type {Record<string, number>} */
  const totals = {};
  monthly.forEach(t => {
    totals[t.category] = (totals[t.category] || 0) + t.amount;
  });

  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const grandTotal = entries.reduce((s, [, v]) => s + v, 0);

  if (entries.length === 0) {
    summaryList.innerHTML = '';
    summaryEmpty.classList.remove('hidden');
    return;
  }

  summaryEmpty.classList.add('hidden');

  summaryList.innerHTML = entries.map(([cat, amt]) => {
    const pct   = grandTotal ? Math.round((amt / grandTotal) * 100) : 0;
    const color = categoryColor(cat);
    return `
      <li class="summary-item">
        <span class="summary-cat-name">${escapeHtml(cat)}</span>
        <div class="summary-bar-track">
          <div class="summary-bar-fill" style="width:${pct}%; background-color:${color};"></div>
        </div>
        <span class="summary-cat-amount">${formatRp(amt)}</span>
      </li>`;
  }).join('');
}

/* ==========================================================
   11. RENDER ALL
   ========================================================== */

function renderAll() {
  renderMonthFilter();    // keep month list up to date
  renderBalance();
  renderTransactionList();
  renderChart();
  renderMonthlySummary();
}

/* ==========================================================
   12. THEME
   ========================================================== */

function applyTheme() {
  const body     = document.body;
  const icon     = document.getElementById('themeIcon');

  if (theme === 'dark') {
    body.classList.add('dark');
    if (icon) icon.textContent = '☀️';
  } else {
    body.classList.remove('dark');
    if (icon) icon.textContent = '🌙';
  }

  // Re-render chart to pick up new text colours
  if (chart) {
    const textColor = getComputedStyle(body)
      .getPropertyValue('--text-secondary').trim();
    const bgColor = getComputedStyle(body)
      .getPropertyValue('--bg-card').trim();

    chart.data.datasets[0].borderColor = bgColor;
    chart.options.plugins.legend.labels.color = textColor;
    chart.update();
  }
}

function toggleTheme() {
  theme = theme === 'dark' ? 'light' : 'dark';
  saveTheme();
  applyTheme();
}

/* ==========================================================
   13. FORM VALIDATION & SUBMIT
   ========================================================== */

/** Show or hide a field error. */
function setFieldError(inputEl, errorEl, message) {
  if (message) {
    inputEl.classList.add('error-field');
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  } else {
    inputEl.classList.remove('error-field');
    errorEl.classList.add('hidden');
  }
}

/** Clear all form errors. */
function clearFormErrors() {
  ['itemName', 'itemAmount', 'itemCategory'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('error-field');
  });
  ['nameError', 'amountError', 'categoryError'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
}

function handleFormSubmit(e) {
  e.preventDefault();
  clearFormErrors();

  const nameEl   = document.getElementById('itemName');
  const amtEl    = document.getElementById('itemAmount');
  const catEl    = document.getElementById('itemCategory');

  const name     = nameEl.value.trim();
  const amount   = parseFloat(amtEl.value);
  const category = catEl.value;

  let valid = true;

  if (!name) {
    setFieldError(nameEl, document.getElementById('nameError'), 'Please enter an item name.');
    valid = false;
  }

  if (!amtEl.value || isNaN(amount) || amount <= 0) {
    setFieldError(amtEl, document.getElementById('amountError'), 'Please enter a valid amount greater than 0.');
    valid = false;
  }

  if (!category || category === '__custom__') {
    setFieldError(catEl, document.getElementById('categoryError'), 'Please select a valid category.');
    valid = false;
  }

  if (!valid) return;

  addTransaction(name, amount, category);

  // Reset form
  nameEl.value  = '';
  amtEl.value   = '';
  catEl.value   = '';
  nameEl.focus();
}

/* ==========================================================
   14. CUSTOM CATEGORY FLOW
   ========================================================== */

function showCustomCategoryInput() {
  document.getElementById('customCategoryGroup').classList.remove('hidden');
  document.getElementById('customCategoryInput').focus();
}

function hideCustomCategoryInput() {
  const group = document.getElementById('customCategoryGroup');
  const input = document.getElementById('customCategoryInput');
  const errEl = document.getElementById('customCatError');
  group.classList.add('hidden');
  input.value = '';
  errEl.classList.add('hidden');
  // Reset category select back to blank
  document.getElementById('itemCategory').value = '';
}

function handleAddCustomCategory() {
  const input  = document.getElementById('customCategoryInput');
  const errEl  = document.getElementById('customCatError');
  const name   = input.value.trim();

  if (!name) {
    errEl.textContent = 'Please enter a category name.';
    errEl.classList.remove('hidden');
    input.focus();
    return;
  }

  const added = addCategory(name);

  if (!added) {
    errEl.textContent = `"${escapeHtml(name)}" already exists.`;
    errEl.classList.remove('hidden');
    input.select();
    return;
  }

  // Rebuild dropdown and select the new category
  renderCategoryDropdown();
  const sel = document.getElementById('itemCategory');
  // Find the newly added category option
  const capitalised = name.charAt(0).toUpperCase() + name.slice(1);
  sel.value = capitalised;

  hideCustomCategoryInput();
}

/* ==========================================================
   15. SPENDING LIMIT UI
   ========================================================== */

function showLimitInput() {
  const row = document.getElementById('limitInputRow');
  const inp = document.getElementById('limitInput');
  row.classList.remove('hidden');
  if (spendingLimit > 0) inp.value = spendingLimit;
  inp.focus();
}

function hideLimitInput() {
  document.getElementById('limitInputRow').classList.add('hidden');
  document.getElementById('limitInput').value = '';
}

function handleSaveLimit() {
  const inp    = document.getElementById('limitInput');
  const amount = parseFloat(inp.value);
  if (isNaN(amount) || amount < 0) {
    inp.classList.add('error-field');
    inp.focus();
    return;
  }
  inp.classList.remove('error-field');
  setSpendingLimit(amount);
  hideLimitInput();
}

/* ==========================================================
   16. EVENT LISTENERS
   ========================================================== */

function attachEventListeners() {
  // Form submit
  document.getElementById('transactionForm')
    .addEventListener('submit', handleFormSubmit);

  // Category dropdown change
  document.getElementById('itemCategory').addEventListener('change', function () {
    if (this.value === '__custom__') {
      showCustomCategoryInput();
    } else {
      document.getElementById('customCategoryGroup').classList.add('hidden');
    }
  });

  // Custom category buttons
  document.getElementById('addCategoryBtn')
    .addEventListener('click', handleAddCustomCategory);

  document.getElementById('cancelCategoryBtn')
    .addEventListener('click', hideCustomCategoryInput);

  // Allow Enter key in custom category input
  document.getElementById('customCategoryInput')
    .addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); handleAddCustomCategory(); }
      if (e.key === 'Escape') hideCustomCategoryInput();
    });

  // Delete transaction (event delegation)
  document.getElementById('transactionList').addEventListener('click', function (e) {
    const btn = e.target.closest('.btn-delete');
    if (!btn) return;
    const id = parseInt(btn.dataset.id, 10);
    if (!isNaN(id)) deleteTransaction(id);
  });

  // Month filter
  document.getElementById('monthFilter').addEventListener('change', renderAll);

  // Sort control
  document.getElementById('sortControl').addEventListener('change', function () {
    renderTransactionList();
  });

  // Set limit
  document.getElementById('setLimitBtn').addEventListener('click', showLimitInput);
  document.getElementById('saveLimitBtn').addEventListener('click', handleSaveLimit);
  document.getElementById('cancelLimitBtn').addEventListener('click', hideLimitInput);

  // Allow Enter in limit input
  document.getElementById('limitInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); handleSaveLimit(); }
    if (e.key === 'Escape') hideLimitInput();
  });

  // Theme toggle
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);

  // Monthly summary toggle
  document.getElementById('summaryToggle').addEventListener('click', function () {
    const body    = document.getElementById('summaryBody');
    const arrow   = document.getElementById('summaryArrow');
    const expanded = !body.classList.contains('hidden');

    if (expanded) {
      body.classList.add('hidden');
      arrow.classList.remove('open');
      this.setAttribute('aria-expanded', 'false');
    } else {
      body.classList.remove('hidden');
      arrow.classList.add('open');
      this.setAttribute('aria-expanded', 'true');
      renderMonthlySummary(); // refresh on open
    }
  });

  // Live clear error on input
  document.getElementById('itemName').addEventListener('input', function () {
    if (this.value.trim()) setFieldError(this, document.getElementById('nameError'), '');
  });
  document.getElementById('itemAmount').addEventListener('input', function () {
    const v = parseFloat(this.value);
    if (!isNaN(v) && v > 0) setFieldError(this, document.getElementById('amountError'), '');
  });
}

/* ==========================================================
   17. INIT
   ========================================================== */

function init() {
  loadData();
  applyTheme();
  renderCategoryDropdown();
  renderAll();
  attachEventListeners();
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
