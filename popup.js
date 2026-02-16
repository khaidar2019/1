const fileInput = document.getElementById('fileInput');
const messageInput = document.getElementById('messageInput');
const waCheckbox = document.getElementById('waCheckbox');
const tgCheckbox = document.getElementById('tgCheckbox');
const minDelayInput = document.getElementById('minDelay');
const maxDelayInput = document.getElementById('maxDelay');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const openWaBtn = document.getElementById('openWaBtn');
const openTgBtn = document.getElementById('openTgBtn');
const authStatus = document.getElementById('authStatus');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const logsContainer = document.getElementById('logs');

function appendLog(text, type = 'muted') {
  const p = document.createElement('p');
  p.className = `log-item ${type}`;
  p.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  logsContainer.prepend(p);
}

function normalizePhone(rawValue) {
  const digits = String(rawValue ?? '').replace(/\D/g, '');
  if (!digits) return null;

  // Expected format: 992XXXXXXXXX (12 digits total for country code + number).
  if (!digits.startsWith('992')) return null;
  if (digits.length !== 12) return null;

  return digits;
}

async function parseExcelFile(file) {
  appendLog('Reading Excel file...', 'muted');
  const arrayBuffer = await file.arrayBuffer();

  // SheetJS API contract requested by spec.
  const workbook = await XLSX.read(arrayBuffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return { numbers: [], invalidCount: 0 };

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const unique = new Set();
  let invalidCount = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const firstColumnValue = rows[i]?.[0];
    if (firstColumnValue === undefined || firstColumnValue === null || String(firstColumnValue).trim() === '') continue;

    const normalized = normalizePhone(firstColumnValue);
    if (!normalized) {
      invalidCount += 1;
      continue;
    }

    unique.add(normalized);
  }

  return { numbers: [...unique], invalidCount };
}

function updateProgress(current, total) {
  progressBar.max = Math.max(total, 1);
  progressBar.value = current;
  progressText.textContent = `Current: ${current} / ${total}`;
}

function updateAuthStatusText(status) {
  const wa = status.whatsapp ? 'WA ✅' : 'WA ❌';
  const tg = status.telegram ? 'TG ✅' : 'TG ❌';
  authStatus.textContent = `Auth status: ${wa} | ${tg}`;
}

async function saveConfig() {
  const config = {
    message: messageInput.value,
    sendWhatsApp: waCheckbox.checked,
    sendTelegram: tgCheckbox.checked,
    minDelaySec: Number(minDelayInput.value) || 8,
    maxDelaySec: Number(maxDelayInput.value) || 20
  };
  await chrome.storage.local.set({ bulkConfig: config });
}

async function restoreConfig() {
  const { bulkConfig } = await chrome.storage.local.get(['bulkConfig']);
  const cfg = bulkConfig || {};

  messageInput.value = cfg.message ?? '';
  waCheckbox.checked = cfg.sendWhatsApp ?? true;
  tgCheckbox.checked = cfg.sendTelegram ?? true;
  minDelayInput.value = String(cfg.minDelaySec ?? 8);
  maxDelayInput.value = String(cfg.maxDelaySec ?? 20);
}

async function refreshAuthStatus() {
  const status = await chrome.runtime.sendMessage({ type: 'CHECK_AUTH_STATUS' });
  updateAuthStatusText(status || { whatsapp: false, telegram: false });
  return status;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'BULK_PROGRESS') {
    updateProgress(message.current, message.total);
    return;
  }

  if (message?.type === 'BULK_LOG') {
    appendLog(message.text, message.level || 'muted');
    return;
  }

  if (message?.type === 'BULK_DONE') {
    appendLog('Process finished.', 'ok');
  }
});

startBtn.addEventListener('click', async () => {
  try {
    const selectedFile = fileInput.files?.[0];
    const message = messageInput.value.trim();
    const minDelaySec = Number(minDelayInput.value);
    const maxDelaySec = Number(maxDelayInput.value);

    if (!selectedFile) {
      appendLog('Please select an .xlsx file.', 'err');
      return;
    }

    if (!message) {
      appendLog('Message is required.', 'err');
      return;
    }

    if (!waCheckbox.checked && !tgCheckbox.checked) {
      appendLog('Select at least one platform.', 'err');
      return;
    }

    if (!Number.isFinite(minDelaySec) || !Number.isFinite(maxDelaySec) || minDelaySec < 1 || maxDelaySec < minDelaySec) {
      appendLog('Invalid delay settings.', 'err');
      return;
    }

    const auth = await refreshAuthStatus();
    if (waCheckbox.checked && !auth.whatsapp) {
      appendLog('WhatsApp is not authorized. Click "Open WhatsApp" and scan QR.', 'err');
      return;
    }

    if (tgCheckbox.checked && !auth.telegram) {
      appendLog('Telegram is not authorized. Click "Open Telegram" and sign in.', 'err');
      return;
    }

    const { numbers, invalidCount } = await parseExcelFile(selectedFile);
    if (!numbers.length) {
      appendLog('No valid phone numbers found in Excel column A.', 'err');
      return;
    }

    appendLog(`Parsed numbers: ${numbers.length}. Invalid skipped: ${invalidCount}.`, invalidCount ? 'skip' : 'ok');

    await saveConfig();
    updateProgress(0, numbers.length);

    const response = await chrome.runtime.sendMessage({
      type: 'START_BULK',
      payload: {
        numbers,
        message,
        sendWhatsApp: waCheckbox.checked,
        sendTelegram: tgCheckbox.checked,
        minDelayMs: minDelaySec * 1000,
        maxDelayMs: maxDelaySec * 1000
      }
    });

    if (!response?.ok) appendLog(response?.error || 'Failed to start bulk process.', 'err');
  } catch (error) {
    appendLog(`Failed to start: ${error.message}`, 'err');
  }
});

stopBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'STOP_BULK' });
  appendLog('Stop requested by user.', 'skip');
});

openWaBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'OPEN_LOGIN_TAB', platform: 'whatsapp' });
  appendLog('Opened WhatsApp Web tab.', 'muted');
});

openTgBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'OPEN_LOGIN_TAB', platform: 'telegram' });
  appendLog('Opened Telegram Web tab.', 'muted');
});

for (const control of [messageInput, waCheckbox, tgCheckbox, minDelayInput, maxDelayInput]) {
  control.addEventListener('change', () => {
    saveConfig().catch(() => {});
  });
}
messageInput.addEventListener('input', () => {
  saveConfig().catch(() => {});
});

(async () => {
  await restoreConfig();

  const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  if (state) updateProgress(state.current || 0, state.total || 0);

  await refreshAuthStatus();
})();
