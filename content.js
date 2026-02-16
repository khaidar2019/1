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

function dispatchInput(element, value) {
  element.focus();
  element.textContent = '';

  const inputEvent = new InputEvent('input', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertText',
    data: value
  });

  document.execCommand('insertText', false, value);
  element.dispatchEvent(inputEvent);
}

async function sendWhatsAppMessage() {
  const errorBanner = document.querySelector('[data-testid="alert-phone"]');
  if (errorBanner) {
    throw new Error('user not found');
  }

  await waitForSelector(['#main', '[data-testid="conversation-panel-wrapper"]'], 25000);
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
    '.input-search-input'
  ], 25000);

  searchInput.focus();
  searchInput.value = '';
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  searchInput.value = `+${phone}`;
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  searchInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));

  await sleep(1500);

  const notFoundEl = document.querySelector('.ListItem.no-results, .no-results, [data-peer-id="search-empty"]');
  if (notFoundEl) {
    throw new Error('user not found');
  }

  const composer = await waitForSelector([
    'div[contenteditable="true"][role="textbox"]',
    'div.input-message-input[contenteditable="true"]',
    '.composer_rich_textarea'
  ], 10000);

  dispatchInput(composer, message);
  await sleep(400);

  const sendBtn = document.querySelector('button[aria-label="Send message"], button.send, .Button.send, [data-testid="btn-send"]');
  if (sendBtn) {
    sendBtn.click();
  } else {
    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    composer.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
  }

  await sleep(1200);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'EXECUTE_SEND') return;

  (async () => {
    try {
      if (message.platform === 'whatsapp') {
        await sendWhatsAppMessage();
      } else if (message.platform === 'telegram') {
        await sendTelegramMessage(message.payload.phone, message.payload.message);
      } else {
        throw new Error('Unknown platform');
      }

      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }
  })();

  return true;
});
