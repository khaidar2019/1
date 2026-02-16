const fileInput = document.getElementById('fileInput');
const messageInput = document.getElementById('messageInput');
const waCheckbox = document.getElementById('waCheckbox');
const tgCheckbox = document.getElementById('tgCheckbox');
const minDelayInput = document.getElementById('minDelay');
const maxDelayInput = document.getElementById('maxDelay');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const logsContainer = document.getElementById('logs');

let parsedNumbers = [];

function appendLog(text, type = 'muted') {
  const p = document.createElement('p');
  p.className = `log-item ${type}`;
  p.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  logsContainer.prepend(p);
}

function sanitizePhone(value) {
  if (!value) return '';
  const digits = String(value).replace(/\D/g, '');
  return digits;
}

async function parseExcelFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = await XLSX.read(arrayBuffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });

  const unique = new Set();
  for (let i = 0; i < rows.length; i += 1) {
    const phone = sanitizePhone(rows[i][0]);
    if (phone) unique.add(phone);
  }

  return [...unique];
}

function updateProgress(current, total) {
  progressBar.max = Math.max(total, 1);
  progressBar.value = current;
  progressText.textContent = `Current: ${current} / ${total}`;
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

    parsedNumbers = await parseExcelFile(selectedFile);
    if (!parsedNumbers.length) {
      appendLog('No valid phone numbers found in column A.', 'err');
      return;
    }

    await chrome.storage.local.set({ lastMessage: message });

    updateProgress(0, parsedNumbers.length);
    appendLog(`Loaded ${parsedNumbers.length} unique numbers.`, 'ok');

    await chrome.runtime.sendMessage({
      type: 'START_BULK',
      payload: {
        numbers: parsedNumbers,
        message,
        sendWhatsApp: waCheckbox.checked,
        sendTelegram: tgCheckbox.checked,
        minDelayMs: minDelaySec * 1000,
        maxDelayMs: maxDelaySec * 1000
      }
    });
  } catch (error) {
    appendLog(`Failed to start: ${error.message}`, 'err');
  }
});

stopBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'STOP_BULK' });
  appendLog('Stop requested by user.', 'skip');
});

(async () => {
  const { lastMessage } = await chrome.storage.local.get(['lastMessage']);
  if (lastMessage) messageInput.value = lastMessage;

  const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  if (state) {
    updateProgress(state.current || 0, state.total || 0);
  }
})();
