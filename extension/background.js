const initialState = {
  isRunning: false,
  total: 0,
  sent: 0,
  failed: 0,
  status: 'Idle',
  report: [],
  startedAt: null,
  targetTabId: null
};

let state = { ...initialState };

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'GET_STATE') {
    sendResponse(state);
    return;
  }

  if (message?.type === 'START_BULK_SEND') {
    startBulkSend(message.payload)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Unknown error' }));
    return true;
  }

  if (message?.type === 'STOP_BULK_SEND') {
    state.isRunning = false;
    state.status = 'Stopped by user';
    pushUpdate();
    sendResponse({ ok: true });
    return;
  }
});

async function startBulkSend(payload) {
  if (state.isRunning) {
    return { ok: false, error: 'Sender is already running.' };
  }

  const { contacts, template, minDelayMs, maxDelayMs, targetTabId } = payload || {};
  if (!Array.isArray(contacts) || !contacts.length) {
    return { ok: false, error: 'No contacts to send.' };
  }

  const tab = await chrome.tabs.get(targetTabId).catch(() => null);
  if (!tab?.url?.startsWith('https://web.whatsapp.com/')) {
    return { ok: false, error: 'Please open and login to WhatsApp Web' };
  }

  state = {
    ...state,
    status: 'Checking WhatsApp Web session...'
  };
  pushUpdate();

  const readyResponse = await sendToTab(targetTabId, {
    type: 'WAIT_WHATSAPP_READY',
    payload: { timeoutMs: 30000 }
  }, 35000);
  if (!readyResponse?.ready) {
    return { ok: false, error: 'Please open and login to WhatsApp Web' };
  }

  state = {
    ...state,
    isRunning: true,
    total: contacts.length,
    sent: 0,
    failed: 0,
    status: 'Starting... ',
    report: [],
    startedAt: Date.now(),
    targetTabId
  };
  pushUpdate();

  runLoop({ contacts, template, minDelayMs, maxDelayMs, targetTabId }).catch((error) => {
    state.isRunning = false;
    state.status = `Failed: ${error?.message || 'Unknown error'}`;
    pushUpdate();
  });

  return { ok: true };
}

async function runLoop({ contacts, template, minDelayMs, maxDelayMs, targetTabId }) {
  for (let i = 0; i < contacts.length; i += 1) {
    if (!state.isRunning) break;

    const contact = contacts[i];
    const phone = normalizePhone(contact.phone);
    const name = (contact.name || '').trim();

    if (!isValidPhone(phone)) {
      state.failed += 1;
      state.report.push({ phone, name, status: 'failed', error: 'Invalid phone format' });
      state.status = `Skipping invalid number ${contact.phone}`;
      pushUpdate();
      continue;
    }

    const personalizedMessage = fillTemplate(template, { name, number: phone });
    state.status = `Sending to ${phone} (${i + 1}/${contacts.length})`;
    pushUpdate();

    let result = await sendToTab(targetTabId, {
      type: 'SEND_SINGLE_MESSAGE',
      payload: { phone, message: personalizedMessage }
    }, 60000);

    if (!result?.ok && state.isRunning) {
      state.status = `Retrying ${phone} once...`;
      pushUpdate();
      await interruptibleSleep(2000);
      if (!state.isRunning) break;

      result = await sendToTab(targetTabId, {
        type: 'SEND_SINGLE_MESSAGE',
        payload: { phone, message: personalizedMessage }
      }, 60000);
    }

    if (result?.ok) {
      state.sent += 1;
      state.report.push({ phone, name, status: 'sent', error: '' });
      state.status = `Sent to ${phone}`;
    } else {
      state.failed += 1;
      state.report.push({ phone, name, status: 'failed', error: result?.reason || 'Send failed' });
      state.status = `Failed ${phone}: ${result?.reason || 'Send failed'}`;
    }
    pushUpdate();

    if (!state.isRunning) break;

    const delay = randomInt(minDelayMs, maxDelayMs);
    state.status = `Waiting ${Math.round(delay / 100) / 10}s before next message...`;
    pushUpdate();
    await interruptibleSleep(delay);
  }

  if (state.isRunning) {
    state.status = `Completed. Sent: ${state.sent}, Failed: ${state.failed}`;
  }
  state.isRunning = false;
  pushUpdate();
}

function fillTemplate(template, vars) {
  return template
    .replaceAll('{{name}}', vars.name || 'there')
    .replaceAll('{{number}}', vars.number || '');
}

function normalizePhone(phoneRaw) {
  return String(phoneRaw || '').replace(/[^\d]/g, '');
}

function isValidPhone(phone) {
  return /^\d{6,15}$/.test(phone);
}

function randomInt(min, max) {
  const safeMin = Math.max(1000, Number(min) || 1000);
  const safeMax = Math.max(safeMin, Number(max) || safeMin);
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

async function interruptibleSleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!state.isRunning) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, end - Date.now())));
  }
}

function pushUpdate() {
  chrome.storage.local.set({ waLiveState: state });
  chrome.runtime.sendMessage({ type: 'PROGRESS_UPDATE', payload: state }).catch(() => {
    // Popup may not be open. Ignore.
  });
}

function sendToTab(tabId, message, timeoutMs = 25000) {
  return new Promise((resolve) => {
    let isDone = false;

    const timer = setTimeout(() => {
      if (isDone) return;
      isDone = true;
      resolve({ ok: false, reason: 'Operation timed out' });
    }, timeoutMs);

    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (isDone) return;
      clearTimeout(timer);
      isDone = true;

      if (chrome.runtime.lastError) {
        resolve({ ok: false, reason: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false, reason: 'No response from content script' });
    });
  });
}
