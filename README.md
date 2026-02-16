# Bulk Messenger Chrome Extension (MV3)

Production-oriented Chrome Extension for **bulk messaging** from an Excel file (`.xlsx`) to:

- WhatsApp Web
- Telegram Web

All controls are managed from a single popup UI.

> Важно: перед рассылкой выполните авторизацию в WhatsApp Web и Telegram Web через кнопки в popup.

---

## Features

- Import phone numbers from Excel (`.xlsx`, column A)
- Remove empty rows and duplicates automatically
- Write one message and send to all numbers
- Send via WhatsApp, Telegram, or both
- Configurable anti-spam random delay (`min/max` seconds)
- Stop sending at any moment
- Retry failed send once (1 retry max)
- Real-time progress + logs in popup
- Persists last message (`chrome.storage.local`)

---

## Project Structure

```text
.
├── manifest.json
├── popup.html
├── popup.js
├── background.js
├── content.js
├── xlsx.full.min.js
└── README.md
```

---

## Requirements

- Google Chrome (latest stable)
- Logged in sessions (или открыть из popup кнопками Login):
  - https://web.whatsapp.com/
  - https://web.telegram.org/

> ⚠️ If you are not authenticated in WhatsApp Web / Telegram Web, sending will fail.

---

## Installation (Developer Mode)

1. Download/clone repository.
2. Open Chrome: `chrome://extensions/`
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select repository folder.

---

## Usage

1. Click extension icon to open popup.
2. Нажмите **Open WhatsApp Login** и/или **Open Telegram Login**, выполните вход в новых вкладках.
3. Вернитесь в popup и убедитесь, что статус авторизации отображает `WA ✅` / `TG ✅`.
4. Select `.xlsx` file with phone numbers in **column A**.
5. Enter message text.
6. Select channels:
   - `Send via WhatsApp`
   - `Send via Telegram`
7. Set `min delay` and `max delay`.
8. Click **Start**.
9. Watch progress and logs.
10. Click **Stop** any time to halt.

---

## Excel Format

- **Column A**: international phone number (digits only preferred)
  - Example: `992XXXXXXXXX`
- Empty rows ignored.
- Duplicate numbers removed.

---

## Permissions

Declared in `manifest.json`:

- `tabs`
- `scripting`
- `activeTab`
- `storage`

Host permissions:

- `https://web.whatsapp.com/*`
- `https://web.telegram.org/*`
- `https://t.me/*`

---

## Architecture

- **popup.js**
  - Input validation
  - Excel parsing
  - Start/stop command dispatch
  - Progress/log rendering

- **background.js** (service worker)
  - Main queue orchestration
  - Tab lifecycle control
  - Delay/retry logic
  - Stop flag management

- **content.js**
  - DOM automation on WhatsApp/Telegram pages
  - Message insertion and send click/Enter fallback

---

## Notes on Stability

Web clients (WhatsApp/Telegram) can change DOM structure over time. The extension uses selector fallbacks and waits, but periodic maintenance may be required.

To improve reliability further in production:

- Keep selectors up to date
- Add per-platform health checks
- Add failed-number export/reporting
- Add optional resume-from-index persistence

---

## Security & Compliance

Use responsibly and comply with:

- WhatsApp / Telegram terms of service
- Local anti-spam and privacy regulations
- Consent requirements for recipients

This project is provided for educational/operational automation use under your own responsibility.

---

## GitHub Repository Checklist

- [x] MV3 extension source included
- [x] README with setup and usage
- [x] Clear folder structure
- [x] No build step required

You can now push this folder as a GitHub repository directly.
