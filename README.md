# Bulk Messaging SaaS Platform (WhatsApp Web + Telegram Web)

Production-style multi-service SaaS template for bulk messaging automation:

- **Backend API**: Node.js + Express + PostgreSQL + JWT + Rate Limit
- **Queue**: Redis + BullMQ
- **Worker**: Playwright-based automation for WhatsApp Web and Telegram Web
- **Frontend**: React (Vite) dashboard
- **Infra**: Docker Compose + Nginx reverse proxy

## Folder Structure

```text
.
├── apps
│   ├── backend
│   │   ├── sql/init.sql
│   │   └── src
│   │       ├── config
│   │       ├── db
│   │       ├── middleware
│   │       ├── modules
│   │       │   ├── auth
│   │       │   ├── projects
│   │       │   ├── contacts
│   │       │   ├── campaigns
│   │       │   └── accounts
│   │       ├── services
│   │       └── utils
│   ├── worker
│   │   └── src
│   │       ├── providers
│   │       ├── queue
│   │       ├── services
│   │       └── utils
│   └── frontend
│       └── src
├── infra/nginx/default.conf
└── docker-compose.yml
```

## Core Features

1. Register/login users with JWT.
2. Create projects and upload contacts from CSV/XLSX.
3. Create messaging accounts (WhatsApp/Telegram) with session paths.
4. Start campaign by template + channel + account.
5. Backend enqueues one message job per contact.
6. Worker consumes jobs, applies anti-ban delay/randomization, and logs sent/failed states.
7. Campaign status endpoint returns pending/sent/failed aggregates + latest logs.

## Anti-Ban Logic Implemented

- Random delay per message (`MIN_DELAY_MS` to `MAX_DELAY_MS`, default 10–30 seconds).
- Per-account daily send cap (`messaging_accounts.daily_limit`).
- Template randomization via `{Hi|Hello|Good day}` syntax.
- Queue retries (4 attempts, exponential backoff).

## Database Schema

Tables in `apps/backend/sql/init.sql`:

- `users`
- `messaging_accounts`
- `projects`
- `contacts`
- `campaigns`
- `messages`

## API Endpoints

### Auth
- `POST /auth/register`
- `POST /auth/login`

### Projects
- `POST /projects`
- `GET /projects`

### Contacts
- `POST /contacts/upload`
- `GET /contacts/:projectId`

### Accounts
- `POST /accounts`
- `GET /accounts`

### Campaigns
- `POST /campaign/start`
- `GET /campaign/status/:campaignId`

## Run with Docker

```bash
docker compose up --build
```

Services:
- Nginx: `http://localhost`
- Backend: `http://localhost:4000`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

## Local Development

```bash
npm install
npm run dev
```

Backend expects `.env` values:

```bash
PORT=4000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/bulk_saas
REDIS_URL=redis://localhost:6379
JWT_SECRET=change-me
FRONTEND_URL=http://localhost:5173
DAILY_LIMIT_PER_ACCOUNT=500
```

Worker expects:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/bulk_saas
REDIS_URL=redis://localhost:6379
MIN_DELAY_MS=10000
MAX_DELAY_MS=30000
HEADLESS=true
```

## WhatsApp/Telegram Session Management

Each messaging account stores `session_path`, e.g.:

- `/sessions/user-1-whatsapp`
- `/sessions/user-1-telegram`

The worker launches persistent browser contexts at that path, preserving login state between runs.

## Notes for Production Hardening

- Add CSRF/refresh tokens, email verification, and 2FA.
- Add encrypted session-path mapping and secret manager integration.
- Replace web UI selectors with resilient, versioned automation adapters.
- Add account warmup scheduler and adaptive rate limits per provider.
- Use OpenTelemetry + centralized logging (ELK/Loki).
- Add horizontal queue sharding and tenant usage quotas.
