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

function logStep(text, level = 'muted') {
  const label = `[BulkExt][${level.toUpperCase()}] ${text}`;
  console.log(label);
  chrome.runtime.sendMessage({ type: 'BULK_LOG', level, text }).catch(() => {
    // Popup may be closed.
  });
}

function pushProgress() {
  chrome.runtime.sendMessage({ type: 'BULK_PROGRESS', current: state.current, total: state.total }).catch(() => {});
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

async function sleepInterruptible(totalMs) {
  const step = 300;
  let spent = 0;

  while (spent < totalMs) {
    if (state.stopRequested) return false;
    const chunk = Math.min(step, totalMs - spent);
    await sleep(chunk);
    spent += chunk;
  }

  return true;
}

async function runContentAction(tabId, action, payload = {}) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js']
  });

  const response = await chrome.tabs.sendMessage(tabId, {
    type: 'CONTENT_ACTION',
    action,
    payload
  });

  if (!response?.ok) {
    throw new Error(response?.error || 'Content action failed');
  }

  return response;
}

async function openLoginTab(platform) {
  const url = platform === 'whatsapp' ? 'https://web.whatsapp.com/' : 'https://web.telegram.org/k/';
  await chrome.tabs.create({ url, active: true });
  logStep(`Opened login tab: ${url}`, 'muted');
}

async function checkAuthPlatform(platform) {
  const url = platform === 'whatsapp' ? 'https://web.whatsapp.com/' : 'https://web.telegram.org/k/';
  const tab = await chrome.tabs.create({ url, active: false });
  logStep(`Checking auth for ${platform}...`, 'muted');

  try {
    await waitForTabComplete(tab.id, 40000);
    await sleep(2500);
    const result = await runContentAction(tab.id, 'check-auth', { platform });
    logStep(`${platform} auth: ${result.authorized ? 'OK' : 'NOT AUTHORIZED'}`, result.authorized ? 'ok' : 'err');
    return Boolean(result.authorized);
  } catch (error) {
    logStep(`${platform} auth check failed: ${error.message}`, 'err');
    return false;
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function checkAuthStatus() {
  const whatsapp = await checkAuthPlatform('whatsapp');
  const telegram = await checkAuthPlatform('telegram');
  return { whatsapp, telegram };
}

async function sendViaWhatsApp(phone, message) {
  const url = `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(message)}`;
  const tab = await chrome.tabs.create({ url, active: false });
  logStep(`WhatsApp tab opened for ${phone}`, 'muted');

  try {
    await waitForTabComplete(tab.id, 35000);
    await sleep(2000);
    await runContentAction(tab.id, 'send-whatsapp', { phone, message });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message || 'WhatsApp send failed' };
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function sendViaTelegram(phone, message) {
  const url = `https://t.me/+${encodeURIComponent(phone)}`;
  const tab = await chrome.tabs.create({ url, active: false });
  logStep(`Telegram tab opened for ${phone}`, 'muted');

  try {
    await waitForTabComplete(tab.id, 35000);
    await sleep(2000);
    await runContentAction(tab.id, 'send-telegram', { phone, message });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message || 'Telegram send failed' };
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function sendWithRetry(taskFn) {
  const first = await taskFn();
  if (first.ok) return first;

  logStep(`Retrying after error: ${first.error}`, 'skip');
  await sleep(1500);
  return taskFn();
}

async function runBulk(payload) {
  const { numbers, message, sendWhatsApp, sendTelegram, minDelayMs, maxDelayMs } = payload;

  state.running = true;
  state.stopRequested = false;
  state.current = 0;
  state.total = numbers.length;

  logStep(`Bulk started. Numbers=${numbers.length}, WA=${sendWhatsApp}, TG=${sendTelegram}`, 'ok');
  pushProgress();

  const auth = await checkAuthStatus();
  if ((sendWhatsApp && !auth.whatsapp) || (sendTelegram && !auth.telegram)) {
    logStep('Authorization missing. Please login to selected messengers.', 'err');
    state.running = false;
    chrome.runtime.sendMessage({ type: 'BULK_DONE' }).catch(() => {});
    return;
  }

  for (let index = 0; index < numbers.length; index += 1) {
    if (state.stopRequested) {
      logStep('Stopped by user.', 'skip');
      break;
    }

    const phone = numbers[index];
    state.current = index + 1;
    pushProgress();
    logStep(`Processing ${phone} (${state.current}/${state.total})`, 'muted');

    if (sendWhatsApp) {
      const wa = await sendWithRetry(() => sendViaWhatsApp(phone, message));
      if (wa.ok) {
        logStep(`WhatsApp sent: ${phone}`, 'ok');
      } else {
        logStep(`WhatsApp send failed (${phone}): ${wa.error}`, 'err');
      }
    }

    if (sendTelegram && !state.stopRequested) {
      const tg = await sendWithRetry(() => sendViaTelegram(phone, message));
      if (tg.ok) {
        logStep(`Telegram sent: ${phone}`, 'ok');
      } else if (/user not found/i.test(tg.error)) {
        logStep(`Telegram user not found: ${phone}`, 'skip');
      } else {
        logStep(`Telegram send failed (${phone}): ${tg.error}`, 'err');
      }
    }

    if (index < numbers.length - 1 && !state.stopRequested) {
      const delay = randomBetween(minDelayMs, maxDelayMs);
      logStep(`Delay before next number: ${Math.round(delay / 1000)}s`, 'muted');
      const completed = await sleepInterruptible(delay);
      if (!completed) {
        logStep('Stopped during delay by user.', 'skip');
        break;
      }
    }
  }

  state.running = false;
  state.stopRequested = false;
  chrome.runtime.sendMessage({ type: 'BULK_DONE' }).catch(() => {});
  logStep('Bulk finished.', 'ok');
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'START_BULK') {
    if (state.running) {
      sendResponse({ ok: false, error: 'Process already running.' });
      return;
    }

    runBulk(message.payload).catch((error) => {
      state.running = false;
      logStep(`Fatal error: ${error.message}`, 'err');
      chrome.runtime.sendMessage({ type: 'BULK_DONE' }).catch(() => {});
    });

    sendResponse({ ok: true });
    return;
  }

  if (message?.type === 'STOP_BULK') {
    state.stopRequested = true;
    logStep('Stop flag enabled.', 'skip');
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === 'GET_STATE') {
    sendResponse({ ...state });
    return;
  }

  if (message?.type === 'OPEN_LOGIN_TAB') {
    openLoginTab(message.platform || 'whatsapp')
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'CHECK_AUTH_STATUS') {
    checkAuthStatus()
      .then(sendResponse)
      .catch(() => sendResponse({ whatsapp: false, telegram: false }));
    return true;
  }
});
