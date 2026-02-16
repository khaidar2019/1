const els = {
  numbersInput: document.getElementById('numbersInput'),
  csvInput: document.getElementById('csvInput'),
  clearContactsBtn: document.getElementById('clearContactsBtn'),
  messageInput: document.getElementById('messageInput'),
  minDelay: document.getElementById('minDelay'),
  maxDelay: document.getElementById('maxDelay'),
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  exportBtn: document.getElementById('exportBtn'),
  progressBar: document.getElementById('progressBar'),
  totalCount: document.getElementById('totalCount'),
  sentCount: document.getElementById('sentCount'),
  failedCount: document.getElementById('failedCount'),
  statusText: document.getElementById('statusText'),
  themeToggle: document.getElementById('themeToggle')
};

let csvContacts = [];
let latestReport = [];

init();

async function init() {
  bindEvents();
  await loadSavedSession();
  await refreshState();
}

function bindEvents() {
  els.csvInput.addEventListener('change', onCsvUpload);
  els.clearContactsBtn.addEventListener('click', () => {
    csvContacts = [];
    els.csvInput.value = '';
    setStatus('CSV contacts cleared.');
  });
  els.startBtn.addEventListener('click', onStart);
  els.stopBtn.addEventListener('click', onStop);
  els.exportBtn.addEventListener('click', onExportReport);
  els.themeToggle.addEventListener('click', toggleTheme);

  [els.numbersInput, els.messageInput, els.minDelay, els.maxDelay].forEach((el) => {
    el.addEventListener('input', saveSessionDebounced);
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'PROGRESS_UPDATE') {
      paintProgress(message.payload);
    }
  });
}

let saveTimer;
function saveSessionDebounced() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSession, 250);
}

async function saveSession() {
  const payload = {
    numbersRaw: els.numbersInput.value,
    messageTemplate: els.messageInput.value,
    minDelay: Number(els.minDelay.value || 5),
    maxDelay: Number(els.maxDelay.value || 15),
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  };
  await chrome.storage.local.set({ waSession: payload });
}

async function loadSavedSession() {
  const { waSession } = await chrome.storage.local.get('waSession');
  if (!waSession) {
    applyTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    return;
  }
  els.numbersInput.value = waSession.numbersRaw || '';
  els.messageInput.value = waSession.messageTemplate || '';
  els.minDelay.value = waSession.minDelay || 5;
  els.maxDelay.value = waSession.maxDelay || 15;
  applyTheme(waSession.theme || 'light');
}

function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  els.themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
  saveSession();
}

function toggleTheme() {
  const nextTheme = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
  applyTheme(nextTheme);
}

async function refreshState() {
  const state = await sendMessage({ type: 'GET_STATE' });
  if (state) {
    paintProgress(state);
  }
}

async function onCsvUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const text = await file.text();
  const rows = parseCsv(text);
  if (!rows.length) {
    setStatus('CSV parsing failed or file is empty.');
    return;
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const nameIndex = header.indexOf('name');
  const phoneIndex = header.indexOf('phone');

  if (phoneIndex === -1) {
    setStatus('CSV must include columns: name, phone.');
    return;
  }

  csvContacts = rows.slice(1)
    .map((cols) => ({
      name: nameIndex !== -1 ? (cols[nameIndex] || '').trim() : '',
      phone: normalizePhone(cols[phoneIndex] || '')
    }))
    .filter((c) => c.phone.length > 0);

  setStatus(`Loaded ${csvContacts.length} contacts from CSV.`);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell.trim());
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell.trim());
      if (row.some((v) => v.length > 0)) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some((v) => v.length > 0)) rows.push(row);
  }

  return rows;
}

function parseManualContacts(input) {
  const tokens = input
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean);

  return tokens.map((token) => ({
    name: '',
    phone: normalizePhone(token)
  }));
}

function normalizePhone(phoneRaw) {
  return String(phoneRaw || '').replace(/[^\d]/g, '');
}

function isValidPhone(phone) {
  return /^\d{6,15}$/.test(phone);
}

async function onStart() {
  const manualContacts = parseManualContacts(els.numbersInput.value);
  const messageTemplate = els.messageInput.value.trim();

  if (!messageTemplate) {
    setStatus('Please enter a message template.');
    return;
  }

  const mergedContacts = [...csvContacts, ...manualContacts];
  const uniqueMap = new Map();

  for (const contact of mergedContacts) {
    if (!contact.phone) continue;
    if (!uniqueMap.has(contact.phone)) uniqueMap.set(contact.phone, contact);
  }

  const contacts = [...uniqueMap.values()];
  if (!contacts.length) {
    setStatus('No contacts found. Enter numbers or upload CSV.');
    return;
  }

  const minDelaySec = Number(els.minDelay.value);
  const maxDelaySec = Number(els.maxDelay.value);
  if (!Number.isFinite(minDelaySec) || !Number.isFinite(maxDelaySec) || minDelaySec < 1 || maxDelaySec < minDelaySec) {
    setStatus('Invalid delay range. Make sure min >= 1 and max >= min.');
    return;
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.url?.startsWith('https://web.whatsapp.com/')) {
    setStatus('Please open and login to WhatsApp Web.');
    return;
  }

  await saveSession();

  const response = await sendMessage({
    type: 'START_BULK_SEND',
    payload: {
      contacts,
      template: messageTemplate,
      minDelayMs: minDelaySec * 1000,
      maxDelayMs: maxDelaySec * 1000,
      targetTabId: activeTab.id
    }
  });

  if (!response?.ok) {
    setStatus(response?.error || 'Failed to start.');
    return;
  }

  setStatus('Sending started...');
}

async function onStop() {
  await sendMessage({ type: 'STOP_BULK_SEND' });
  setStatus('Stopping...');
}

function onExportReport() {
  if (!latestReport.length) {
    setStatus('No report available yet.');
    return;
  }

  const lines = ['phone,name,status,error'];
  for (const item of latestReport) {
    lines.push([
      csvEscape(item.phone),
      csvEscape(item.name || ''),
      csvEscape(item.status),
      csvEscape(item.error || '')
    ].join(','));
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `wa-bulk-report-${Date.now()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function paintProgress(state) {
  const total = Number(state.total || 0);
  const sent = Number(state.sent || 0);
  const failed = Number(state.failed || 0);
  const percent = total > 0 ? Math.min(100, Math.round(((sent + failed) / total) * 100)) : 0;

  els.totalCount.textContent = String(total);
  els.sentCount.textContent = String(sent);
  els.failedCount.textContent = String(failed);
  els.progressBar.style.width = `${percent}%`;
  els.statusText.textContent = state.status || 'Idle';

  els.startBtn.disabled = !!state.isRunning;
  els.stopBtn.disabled = !state.isRunning;
  latestReport = Array.isArray(state.report) ? state.report : [];
}

function setStatus(text) {
  els.statusText.textContent = text;
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}
