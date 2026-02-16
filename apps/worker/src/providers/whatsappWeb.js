import { chromium } from 'playwright';

export async function sendWhatsAppMessage({ sessionPath, phoneNumber, content, headless }) {
  const browser = await chromium.launchPersistentContext(sessionPath, {
    headless,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  try {
    const page = browser.pages()[0] || (await browser.newPage());
    const encoded = encodeURIComponent(content);
    await page.goto(`https://web.whatsapp.com/send?phone=${phoneNumber}&text=${encoded}`, {
      waitUntil: 'domcontentloaded',
      timeout: 120000
    });

    await page.waitForSelector('div[contenteditable="true"][data-tab="10"],button[data-testid="compose-btn-send"]', {
      timeout: 120000
    });

    const sendButton = page.locator('button[data-testid="compose-btn-send"]');
    if (await sendButton.count()) {
      await sendButton.first().click();
    } else {
      await page.keyboard.press('Enter');
    }

    return { success: true, providerMessageId: `wa-${Date.now()}` };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    await browser.close();
  }
}
