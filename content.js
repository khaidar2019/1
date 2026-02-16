const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForSelector(selectors, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    await sleep(300);
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
  return Boolean(
    document.querySelector('.chat-list, .tabs-tab, .left-column') ||
    document.querySelector('input[placeholder*="Search"], input[placeholder*="Поиск"]')
  );
}

async function sendWhatsAppMessage() {
  await waitForSelector(['#main', '[data-testid="conversation-panel-wrapper"]'], 25000);

  const errorBanner = document.querySelector('[data-testid="alert-phone"]');
  if (errorBanner) throw new Error('user not found');

  const sendBtn = await waitForSelector([
    '[data-testid="compose-btn-send"]',
    'button[aria-label="Send"]',
    'span[data-icon="send"]'
  ], 12000);

  const clickable = sendBtn.closest('button') || sendBtn;
  clickable.click();
  await sleep(1200);
}

async function sendTelegramMessage(phone, message) {
  const searchInput = await waitForSelector([
    'input[type="text"][placeholder*="Search"]',
    'input[placeholder*="Search"]',
    'input[placeholder*="Поиск"]',
    '.input-search-input'
  ], 25000);

  searchInput.focus();
  searchInput.value = '';
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(200);

  // Telegram global search by phone normally requires plus prefix.
  searchInput.value = `+${phone}`;
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(1600);

  const firstResult = document.querySelector('[data-peer-id], .chatlist-chat, .ListItem')?.closest('[data-peer-id], .chatlist-chat, .ListItem')
    || document.querySelector('[data-peer-id], .chatlist-chat, .ListItem');

  const notFoundEl = document.querySelector('.no-results, [data-peer-id="search-empty"], .ListItem.no-results');
  if (notFoundEl || !firstResult) throw new Error('user not found');

  firstResult.click();
  await sleep(1200);

  const composer = await waitForSelector([
    'div[contenteditable="true"][role="textbox"]',
    'div.input-message-input[contenteditable="true"]',
    '.composer_rich_textarea'
  ], 12000);

  setContentEditableText(composer, message);
  await sleep(350);

  const sendBtn = document.querySelector('button[aria-label="Send message"], button.send, .Button.send, [data-testid="btn-send"]');
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

      throw new Error('Unknown action');
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }
  })();

  return true;
});
