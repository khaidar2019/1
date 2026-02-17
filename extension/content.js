const CHAT_LOAD_TIMEOUT_MS = 25000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'CHECK_WHATSAPP_READY') {
    checkWhatsAppReady().then((ready) => sendResponse({ ready })).catch(() => sendResponse({ ready: false }));
    return true;
  }

  if (message?.type === 'WAIT_WHATSAPP_READY') {
    waitForWhatsAppReady(message?.payload?.timeoutMs)
      .then((ready) => sendResponse({ ready }))
      .catch(() => sendResponse({ ready: false }));
    return true;
  }

  if (message?.type === 'SEND_SINGLE_MESSAGE') {
    sendSingleMessage(message.payload)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, reason: error?.message || 'Unknown error' }));
    return true;
  }

  return false;
});

async function sendSingleMessage({ phone, message }) {
  if (!(await checkWhatsAppReady())) {
    return { ok: false, reason: 'Please open and login to WhatsApp Web' };
  }

  const sendUrl = `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(message)}`;
  if (location.href !== sendUrl) {
    location.href = sendUrl;
  }

  const box = await waitForComposerOrError(CHAT_LOAD_TIMEOUT_MS);
  if (!box?.ok) {
    return { ok: false, reason: box?.reason || 'Chat failed to load' };
  }

  const sendButton = await waitForElement('button[aria-label="Send"], button[data-testid="compose-btn-send"]', 12000);
  if (!sendButton) {
    return { ok: false, reason: 'Send button not found' };
  }

  sendButton.click();

  const confirmed = await waitForOutgoingMessage(12000);
  if (!confirmed) {
    return { ok: false, reason: 'Message send not confirmed' };
  }

  return { ok: true };
}

async function checkWhatsAppReady() {
  if (!location.hostname.includes('web.whatsapp.com')) return false;

  const hasQr = !!document.querySelector('[data-testid="qrcode"], canvas[aria-label*="QR"], div[data-ref] canvas');
  const hasAuthenticatedShell = !!document.querySelector('#app div[role="application"], #pane-side, [data-testid="chat-list-search"]');
  const hasSendComposer = !!document.querySelector('footer div[contenteditable="true"][role="textbox"]');
  const hasLoadingProgress = !!document.querySelector('progress, [role="progressbar"]');

  if (hasQr) return false;
  if (hasSendComposer || hasAuthenticatedShell) return true;
  if (hasLoadingProgress) return false;

  return false;
}

async function waitForWhatsAppReady(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkWhatsAppReady()) return true;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return false;
}

function waitForComposerOrError(timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();

    const check = () => {
      const invalidBanner = document.querySelector('[data-testid="alert-phone"]');
      const notFoundText = [...document.querySelectorAll('div, span')].find((el) =>
        /phone number shared via url is invalid|couldn.?t find/i.test(el.textContent || '')
      );
      if (invalidBanner || notFoundText) {
        resolve({ ok: false, reason: 'Invalid or unavailable phone number' });
        return;
      }

      const composer = document.querySelector('footer div[contenteditable="true"][role="textbox"]');
      const sendBtn = document.querySelector('button[aria-label="Send"], button[data-testid="compose-btn-send"]');
      if (composer || sendBtn) {
        resolve({ ok: true });
        return;
      }

      if (Date.now() - start >= timeoutMs) {
        resolve({ ok: false, reason: 'Timed out loading chat' });
        return;
      }

      setTimeout(check, 350);
    };

    check();
  });
}

function waitForElement(selector, timeoutMs) {
  return new Promise((resolve) => {
    const end = Date.now() + timeoutMs;
    const poll = () => {
      const el = document.querySelector(selector);
      if (el) {
        resolve(el);
        return;
      }
      if (Date.now() > end) {
        resolve(null);
        return;
      }
      setTimeout(poll, 300);
    };
    poll();
  });
}

function waitForOutgoingMessage(timeoutMs) {
  return new Promise((resolve) => {
    const end = Date.now() + timeoutMs;

    const hasOutgoing = () => document.querySelectorAll('[data-testid="msg-time"], [data-testid="msg-check"], [data-testid="msg-dblcheck"]').length > 0;

    if (hasOutgoing()) {
      resolve(true);
      return;
    }

    const observer = new MutationObserver(() => {
      if (hasOutgoing()) {
        observer.disconnect();
        resolve(true);
      }
    });

    observer.observe(document.body, { subtree: true, childList: true, attributes: false });

    const timer = setInterval(() => {
      if (Date.now() > end) {
        clearInterval(timer);
        observer.disconnect();
        resolve(false);
      }
    }, 300);
  });
}
