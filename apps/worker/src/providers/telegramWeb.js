import { chromium } from 'playwright';

export async function sendTelegramMessage({ sessionPath, phoneNumber, content, headless }) {
  const browser = await chromium.launchPersistentContext(sessionPath, {
    headless,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  try {
    const page = browser.pages()[0] || (await browser.newPage());
    await page.goto('https://web.telegram.org/k/', { waitUntil: 'domcontentloaded', timeout: 120000 });

    await page.waitForSelector('input.input-search-input', { timeout: 120000 });
    await page.fill('input.input-search-input', phoneNumber);
    await page.keyboard.press('Enter');

    await page.waitForSelector('div.input-message-container div[contenteditable="true"]', { timeout: 60000 });
    await page.fill('div.input-message-container div[contenteditable="true"]', content);
    await page.keyboard.press('Enter');

    return { success: true, providerMessageId: `tg-${Date.now()}` };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    await browser.close();
  }
}
