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

  throw new Error(`Element not found: ${selectors.join(', ')}`);
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

  const endRange = document.createRange();
  endRange.setStartAfter(textNode);
  endRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(endRange);

  element.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertText',
    data: text
  }));
}

function isWhatsAppAuthorized() {
  if (document.querySelector('[data-testid="qrcode"]')) return false;
  if (document.querySelector('canvas[aria-label*="Scan"]')) return false;
  if (document.body.innerText.includes('Use WhatsApp on your computer')) return false;
  return Boolean(document.querySelector('#app') || document.querySelector('#pane-side') || document.querySelector('#main'));
}

function isTelegramAuthorized() {
  if (document.querySelector('input[name="phone_number"]')) return false;
  if (document.body.innerText.includes('Log in to Telegram by QR Code')) return false;
  if (document.body.innerText.includes('Log in to Telegram')) return false;
  return Boolean(
    document.querySelector('.chat-list, .tabs-tab, .left-column') ||
    document.querySelector('input[placeholder*="Search"], input[placeholder*="Поиск"]')
  );
}

async function sendWhatsAppMessage() {
  await waitForSelector(['#main', '[data-testid="conversation-panel-wrapper"]'], 30000);

  const notFound = document.querySelector('[data-testid="alert-phone"], [data-testid="alert"]');
  if (notFound && /phone number shared via url is invalid|not on whatsapp|номер.*не/i.test(notFound.textContent || '')) {
    throw new Error('user not found');
  }

  const sendBtn = await waitForSelector([
    'button[data-testid="compose-btn-send"]',
    'button[aria-label="Send"]',
    'button span[data-icon="send"]',
    'button[aria-label*="Отправить"]'
  ], 15000);

  const clickable = sendBtn.closest('button') || sendBtn;
  clickable.click();
  await sleep(1500);
}

async function findTelegramChatByPhone(phone) {
  const searchInput = await waitForSelector([
    'input.input-search-input',
    'input[type="text"][placeholder*="Search"]',
    'input[placeholder*="Search"]',
    'input[placeholder*="Поиск"]'
  ], 30000);

  searchInput.focus();
  searchInput.value = '';
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(250);

  const query = `+${phone}`;
  searchInput.value = query;
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(1800);

  const notFound = document.querySelector(
    '.no-results, .search-empty, [data-peer-id="search-empty"], .ListItem.no-results'
  );
  if (notFound) return false;

  const resultSelectors = [
    '.search-super-item[data-peer-id]',
    '.search-results [data-peer-id]:not([data-peer-id="search-empty"])',
    '.chatlist .ListItem[data-peer-id]',
    '[data-peer-id]:not([data-peer-id="search-empty"])'
  ];

  for (const selector of resultSelectors) {
    const el = document.querySelector(selector);
    if (el) {
      el.click();
      await sleep(1200);
      return true;
    }
  }

  // Sometimes Enter opens the first search result.
  searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  searchInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
  await sleep(1200);

  const composerExists = document.querySelector('div[contenteditable="true"][role="textbox"], div.input-message-input[contenteditable="true"], .composer_rich_textarea');
  return Boolean(composerExists);
}

async function sendTelegramMessage(phone, message) {
  const found = await findTelegramChatByPhone(phone);
  if (!found) throw new Error('user not found');

  const composer = await waitForSelector([
    'div[contenteditable="true"][role="textbox"]',
    'div.input-message-input[contenteditable="true"]',
    '.composer_rich_textarea'
  ], 15000);

  setContentEditableText(composer, message);
  await sleep(450);

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


async function sendTelegramViaLink(phone, message) {
  // On t.me page: try open in web telegram.
  const openWebBtn = document.querySelector('a[href*="web.telegram.org"], a[href*="/k/#"], a[href*="tg://resolve"]');
  if (openWebBtn) {
    openWebBtn.click();
    await sleep(2500);
  }

  // If still on t.me or redirected, enforce web app with phone hash and then reuse normal flow.
  if (!location.hostname.includes('web.telegram.org')) {
    location.href = 'https://web.telegram.org/k/';
    await sleep(3000);
  }

  await sendTelegramMessage(phone, message);
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

        throw new Error('Unknown auth platform');
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

      if (message.action === 'send-telegram-via-link') {
        await sendTelegramViaLink(message.payload.phone, message.payload.message);
        sendResponse({ ok: true });
        return;
      }

      throw new Error('Unknown action');
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }
  })();

  return true;
});
