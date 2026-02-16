const state = {
  running: false,
  stopRequested: false,
  current: 0,
  total: 0
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sendPopupMessage(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup can be closed; ignore message delivery errors.
  });
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error('Tab load timeout'));
    }, timeoutMs);

    const onUpdated = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function executeContentAction(tabId, platform, payload) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js']
  });

  const response = await chrome.tabs.sendMessage(tabId, {
    type: 'EXECUTE_SEND',
    platform,
    payload
  });

  if (!response?.ok) {
    throw new Error(response?.error || 'Unknown content script error');
  }
}

async function sendViaWhatsApp(phone, message) {
  const encodedMessage = encodeURIComponent(message);
  const url = `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}&text=${encodedMessage}`;
  const tab = await chrome.tabs.create({ url, active: false });

  try {
    await waitForTabComplete(tab.id);
    await sleep(3500);
    await executeContentAction(tab.id, 'whatsapp', { phone, message });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function sendViaTelegram(phone, message) {
  const tab = await chrome.tabs.create({ url: 'https://web.telegram.org/k/', active: false });

  try {
    await waitForTabComplete(tab.id);
    await sleep(3000);
    await executeContentAction(tab.id, 'telegram', { phone, message });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function sendWithRetry(taskFn) {
  const first = await taskFn();
  if (first.ok) return first;
  await sleep(1500);
  return taskFn();
}

async function runBulk(payload) {
  const {
    numbers,
    message,
    sendWhatsApp,
    sendTelegram,
    minDelayMs,
    maxDelayMs
  } = payload;

  state.running = true;
  state.stopRequested = false;
  state.current = 0;
  state.total = numbers.length;
  sendPopupMessage({ type: 'BULK_PROGRESS', current: state.current, total: state.total });

  for (let index = 0; index < numbers.length; index += 1) {
    if (state.stopRequested) {
      sendPopupMessage({ type: 'BULK_LOG', level: 'skip', text: 'Stopped by user.' });
      break;
    }

    const phone = numbers[index];
    state.current = index + 1;
    sendPopupMessage({ type: 'BULK_PROGRESS', current: state.current, total: state.total });
    sendPopupMessage({ type: 'BULK_LOG', level: 'muted', text: `Processing ${phone} (${state.current}/${state.total})` });

    if (sendWhatsApp) {
      const waResult = await sendWithRetry(() => sendViaWhatsApp(phone, message));
      if (waResult.ok) {
        sendPopupMessage({ type: 'BULK_LOG', level: 'ok', text: `WhatsApp sent: ${phone}` });
      } else {
        sendPopupMessage({ type: 'BULK_LOG', level: 'err', text: `WhatsApp failed (${phone}): ${waResult.error}` });
      }
    }

    if (sendTelegram && !state.stopRequested) {
      const tgResult = await sendWithRetry(() => sendViaTelegram(phone, message));
      if (tgResult.ok) {
        sendPopupMessage({ type: 'BULK_LOG', level: 'ok', text: `Telegram sent: ${phone}` });
      } else {
        const errorText = /user not found/i.test(tgResult.error)
          ? 'user not found'
          : tgResult.error;
        sendPopupMessage({ type: 'BULK_LOG', level: 'err', text: `Telegram failed (${phone}): ${errorText}` });
      }
    }

    if (index < numbers.length - 1 && !state.stopRequested) {
      const delay = randomBetween(minDelayMs, maxDelayMs);
      sendPopupMessage({ type: 'BULK_LOG', level: 'muted', text: `Waiting ${Math.round(delay / 1000)}s before next number...` });
      await sleep(delay);
    }
  }

  state.running = false;
  state.stopRequested = false;
  sendPopupMessage({ type: 'BULK_DONE' });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'START_BULK') {
    if (state.running) {
      sendResponse({ ok: false, error: 'Process already running.' });
      return;
    }

    runBulk(message.payload).catch((error) => {
      state.running = false;
      sendPopupMessage({ type: 'BULK_LOG', level: 'err', text: `Fatal error: ${error.message}` });
      sendPopupMessage({ type: 'BULK_DONE' });
    });

    sendResponse({ ok: true });
    return;
  }

  if (message?.type === 'STOP_BULK') {
    state.stopRequested = true;
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === 'GET_STATE') {
    sendResponse({ ...state });
  }
});
