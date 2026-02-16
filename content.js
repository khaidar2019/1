const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForSelector(selectors, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    await sleep(250);
  }

  return null;
}

function setContentEditableText(element, text) {
  element.focus();

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.deleteContents();
  range.collapse(true);

  selection.removeAllRanges();
  selection.addRange(range);

  const textNode = document.createTextNode(text);
  range.insertNode(textNode);

  element.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertText',
    data: text
  }));
}

function isWhatsAppAuthorized() {
  if (document.querySelector('[data-testid="qrcode"]')) return false;
  if (document.body.innerText.includes('Use WhatsApp on your computer')) return false;
  return Boolean(document.querySelector('#app'));
}

function isTelegramAuthorized() {
  if (document.querySelector('input[name="phone_number"]')) return false;
  if (document.body.innerText.includes('Log in to Telegram')) return false;
  return true;
}

async function clickWhatsAppSendButtonWithPolling(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();

    const intervalId = setInterval(() => {
      const elapsed = Date.now() - started;

      const btn = document.querySelector('[data-testid="send"]')
        || document.querySelector('button[data-testid="compose-btn-send"]')
        || document.querySelector('button[aria-label="Send"]')
        || document.querySelector('button[aria-label*="Отправить"]');

      if (btn) {
        clearInterval(intervalId);
        (btn.closest('button') || btn).click();
        resolve(true);
        return;
      }

      const invalid = document.querySelector('[data-testid="alert-phone"], [data-testid="alert"]');
      if (invalid && /invalid|not on whatsapp|не.*whatsapp/i.test(invalid.textContent || '')) {
        clearInterval(intervalId);
        reject(new Error('invalid number'));
        return;
      }

      if (elapsed >= timeoutMs) {
        clearInterval(intervalId);
        reject(new Error('send button timeout'));
      }
    }, 350);
  });
}

async function sendWhatsAppMessage() {
  const mainReady = await waitForSelector(['#main', '[data-testid="conversation-panel-wrapper"]'], 15000);
  if (!mainReady) throw new Error('WhatsApp chat UI not loaded');

  try {
    await clickWhatsAppSendButtonWithPolling(15000);
  } catch (error) {
    if (error.message !== 'send button timeout') throw error;

    const inputBox = await waitForSelector([
      'div[contenteditable="true"][data-tab]',
      'footer [contenteditable="true"]'
    ], 4000);

    if (!inputBox) throw new Error('WhatsApp send failed: no input box');

    inputBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    inputBox.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
  }

  await sleep(1200);
}

async function navigateToTelegramWebFromTMe() {
  if (location.hostname.includes('web.telegram.org')) return;

  const openWebBtn = document.querySelector('a[href*="web.telegram.org"], a[href*="/k/#"], a[href*="tg://"]');
  if (openWebBtn) {
    openWebBtn.click();
    await sleep(2500);
  }

  if (!location.hostname.includes('web.telegram.org')) {
    location.href = 'https://web.telegram.org/k/';
    await sleep(3000);
  }
}

async function sendTelegramMessage(phone, message) {
  await navigateToTelegramWebFromTMe();

  const searchInput = await waitForSelector([
    'input.input-search-input',
    'input[placeholder*="Search"]',
    'input[placeholder*="Поиск"]'
  ], 12000);

  if (!searchInput) {
    throw new Error('Telegram user not found');
  }

  searchInput.focus();
  searchInput.value = '';
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(200);

  searchInput.value = `+${phone}`;
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(1800);

  const firstResult = document.querySelector(
    '.search-super-item[data-peer-id], .search-results [data-peer-id]:not([data-peer-id="search-empty"]), [data-peer-id]:not([data-peer-id="search-empty"])'
  );

  if (!firstResult) {
    throw new Error('Telegram user not found');
  }

  firstResult.click();
  await sleep(1200);

  const composer = await waitForSelector([
    'div[contenteditable="true"][role="textbox"]',
    'div.input-message-input[contenteditable="true"]',
    '.composer_rich_textarea'
  ], 7000);

  if (!composer) {
    throw new Error('Telegram user not found');
  }

  setContentEditableText(composer, message);
  await sleep(400);

  const sendBtn = document.querySelector(
    'button[aria-label="Send message"], button[aria-label*="Send"], button[aria-label*="Отправить"], button.send, .Button.send, [data-testid="btn-send"]'
  );

  if (sendBtn) {
    sendBtn.click();
  } else {
    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    composer.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
  }

  await sleep(1000);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'CONTENT_ACTION') return;

  (async () => {
    try {
      if (message.action === 'check-auth') {
        const platform = message.payload?.platform;
        if (platform === 'whatsapp') {
          sendResponse({ ok: true, authorized: isWhatsAppAuthorized() });
          return;
        }

        if (platform === 'telegram') {
          sendResponse({ ok: true, authorized: isTelegramAuthorized() });
          return;
        }
      }

      if (message.action === 'send-whatsapp') {
        await sendWhatsAppMessage();
        sendResponse({ ok: true });
        return;
      }

      if (message.action === 'send-telegram') {
        await sendTelegramMessage(message.payload.phone, message.payload.message);
        sendResponse({ ok: true });
        return;
      }

      throw new Error('Unknown action');
    } catch (error) {
      sendResponse({ ok: false, error: error.message || 'Content action failed' });
    }
  })();

  return true;
});
