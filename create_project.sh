#!/usr/bin/env bash
set -euo pipefail
TARGET_DIR="${1:-bulk-messaging-saas}"
mkdir -p "$TARGET_DIR"

cat > "$TARGET_DIR/.gitkeep" <<'EOF'

EOF

cat > "$TARGET_DIR/README.md" <<'EOF'
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
EOF

mkdir -p "$TARGET_DIR/apps/backend"
cat > "$TARGET_DIR/apps/backend/Dockerfile" <<'EOF'
FROM node:20-bookworm
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 4000
CMD ["npm", "run", "start"]
EOF

mkdir -p "$TARGET_DIR/apps/backend"
cat > "$TARGET_DIR/apps/backend/package.json" <<'EOF'
{
  "name": "backend",
  "version": "1.0.0",
  "type": "module",
  "main": "src/server.js",
  "scripts": {
    "dev": "nodemon src/server.js",
    "start": "node src/server.js",
    "lint": "eslint .",
    "db:init": "node src/db/runInitSql.js"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "bullmq": "^5.12.12",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "exceljs": "^4.4.0",
    "express": "^4.19.2",
    "express-rate-limit": "^7.4.1",
    "helmet": "^7.1.0",
    "ioredis": "^5.4.1",
    "jsonwebtoken": "^9.0.2",
    "multer": "^1.4.5-lts.1",
    "pg": "^8.12.0",
    "pino": "^9.4.0",
    "pino-http": "^10.3.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "eslint": "^9.10.0",
    "nodemon": "^3.1.7"
  }
}
EOF

mkdir -p "$TARGET_DIR/apps/backend/sql"
cat > "$TARGET_DIR/apps/backend/sql/init.sql" <<'EOF'
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messaging_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'telegram')),
  label TEXT NOT NULL,
  session_path TEXT NOT NULL,
  daily_limit INT NOT NULL DEFAULT 500,
  sent_today INT NOT NULL DEFAULT 0,
  sent_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  name TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, phone_number)
);

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES messaging_accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'telegram')),
  template TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  phone_number TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'telegram')),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  provider_message_id TEXT,
  error_message TEXT,
  attempts INT NOT NULL DEFAULT 0,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_campaign ON messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_user ON campaigns(user_id);
EOF

mkdir -p "$TARGET_DIR/apps/backend/src/config"
cat > "$TARGET_DIR/apps/backend/src/config/env.js" <<'EOF'
import dotenv from 'dotenv';

dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@postgres:5432/bulk_saas',
  redisUrl: process.env.REDIS_URL || 'redis://redis:6379',
  jwtSecret: process.env.JWT_SECRET || 'change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
  maxContactsPerUpload: Number(process.env.MAX_CONTACTS_PER_UPLOAD || 5000),
  dailyLimitPerAccount: Number(process.env.DAILY_LIMIT_PER_ACCOUNT || 500),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173'
};
EOF

mkdir -p "$TARGET_DIR/apps/backend/src/config"
cat > "$TARGET_DIR/apps/backend/src/config/logger.js" <<'EOF'
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info'
});
EOF

mkdir -p "$TARGET_DIR/apps/backend/src/db"
cat > "$TARGET_DIR/apps/backend/src/db/pool.js" <<'EOF'
import pg from 'pg';
import { env } from '../config/env.js';

export const pool = new pg.Pool({ connectionString: env.databaseUrl });
EOF

mkdir -p "$TARGET_DIR/apps/backend/src/db"
cat > "$TARGET_DIR/apps/backend/src/db/runInitSql.js" <<'EOF'
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const sql = fs.readFileSync(path.join(__dirname, '../../sql/init.sql'), 'utf8');
  await pool.query(sql);
  await pool.end();
  console.log('Database initialized');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
EOF

mkdir -p "$TARGET_DIR/apps/backend/src/middleware"
cat > "$TARGET_DIR/apps/backend/src/middleware/auth.js" <<'EOF'
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export function authRequired(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'Unauthorized' });

  try {
    const payload = jwt.verify(token, env.jwtSecret);
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }
}
EOF

mkdir -p "$TARGET_DIR/apps/backend/src/middleware"
cat > "$TARGET_DIR/apps/backend/src/middleware/errorHandler.js" <<'EOF'
export function errorHandler(err, req, res, _next) {
  req.log.error({ err }, 'Unhandled error');
  return res.status(err.statusCode || 500).json({ message: err.message || 'Internal server error' });
}
EOF

mkdir -p "$TARGET_DIR/apps/backend/src/modules/accounts"
cat > "$TARGET_DIR/apps/backend/src/modules/accounts/routes.js" <<'EOF'
import { Router } from 'express';
import { z } from 'zod';
import { authRequired } from '../../middleware/auth.js';
import { pool } from '../../db/pool.js';
import { env } from '../../config/env.js';

const router = Router();
router.use(authRequired);

router.post('/', async (req, res, next) => {
  try {
    const body = z
      .object({
        channel: z.enum(['whatsapp', 'telegram']),
        label: z.string().min(2),
        sessionPath: z.string().min(3),
        dailyLimit: z.number().int().min(10).max(5000).optional()
      })
      .parse(req.body);

    const result = await pool.query(
      `INSERT INTO messaging_accounts (user_id, channel, label, session_path, daily_limit)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.user.userId, body.channel, body.label, body.sessionPath, body.dailyLimit ?? env.dailyLimitPerAccount]
    );

    return res.status(201).json({ account: result.rows[0] });
  } catch (err) {
    return next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM messaging_accounts WHERE user_id = $1 ORDER BY created_at DESC', [
      req.user.userId
    ]);
    return res.json({ accounts: result.rows });
  } catch (err) {
    return next(err);
  }
});

export default router;
EOF

mkdir -p "$TARGET_DIR/apps/backend/src/modules/auth"
cat > "$TARGET_DIR/apps/backend/src/modules/auth/routes.js" <<'EOF'
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { env } from '../../config/env.js';

const router = Router();

const authSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(2)
});

router.post('/register', async (req, res, next) => {
  try {
    const data = authSchema.parse(req.body);
    const hashed = await bcrypt.hash(data.password, 12);

    const result = await pool.query(
      'INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id, email, full_name, created_at',
      [data.email.toLowerCase(), hashed, data.fullName]
    );

    return res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'Email already exists' });
    return next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const body = z.object({ email: z.string().email(), password: z.string().min(8) }).parse(req.body);
    const result = await pool.query('SELECT id, email, full_name, password_hash FROM users WHERE email = $1', [
      body.email.toLowerCase()
    ]);

    const user = result.rows[0];
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    const ok = await bcrypt.compare(body.password, user.password_hash);
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });

    const token = jwt.sign({ userId: user.id, email: user.email }, env.jwtSecret, {
      expiresIn: env.jwtExpiresIn
    });

    return res.json({ token, user: { id: user.id, email: user.email, fullName: user.full_name } });
  } catch (err) {
    return next(err);
  }
});

export default router;
EOF

mkdir -p "$TARGET_DIR/apps/backend/src/modules/campaigns"
cat > "$TARGET_DIR/apps/backend/src/modules/campaigns/routes.js" <<'EOF'
import { Router } from 'express';
import { z } from 'zod';
import { authRequired } from '../../middleware/auth.js';
import { pool } from '../../db/pool.js';
import { campaignQueue } from '../../services/queue.js';
import { randomizeTemplate } from '../../utils/template.js';

const router = Router();
router.use(authRequired);

const startSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(2),
  channel: z.enum(['whatsapp', 'telegram']),
  template: z.string().min(3),
  accountId: z.string().uuid()
});

router.post('/start', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const body = startSchema.parse(req.body);
    await client.query('BEGIN');

    const project = await client.query('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [
      body.projectId,
      req.user.userId
    ]);
    if (!project.rowCount) return res.status(404).json({ message: 'Project not found' });

    const campaignResult = await client.query(
      `INSERT INTO campaigns (user_id, project_id, name, channel, template, status, account_id)
       VALUES ($1, $2, $3, $4, $5, 'queued', $6) RETURNING *`,
      [req.user.userId, body.projectId, body.name, body.channel, body.template, body.accountId]
    );

    const campaign = campaignResult.rows[0];

    const contactsResult = await client.query(
      'SELECT id, phone_number FROM contacts WHERE project_id = $1 ORDER BY created_at ASC',
      [body.projectId]
    );

    if (!contactsResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'No contacts in selected project' });
    }

    for (const contact of contactsResult.rows) {
      const messageResult = await client.query(
        `INSERT INTO messages
          (campaign_id, contact_id, phone_number, channel, content, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         RETURNING id, campaign_id, contact_id, phone_number, channel, content`,
        [
          campaign.id,
          contact.id,
          contact.phone_number,
          body.channel,
          randomizeTemplate(body.template).replace(/\{name\}/gi, contact.name || '')
        ]
      );

      await campaignQueue.add(
        'send-message',
        {
          userId: req.user.userId,
          campaignId: campaign.id,
          accountId: body.accountId,
          messageId: messageResult.rows[0].id
        },
        {
          jobId: `${campaign.id}:${messageResult.rows[0].id}`
        }
      );
    }

    await client.query('COMMIT');
    return res.status(201).json({ campaignId: campaign.id, queuedMessages: contactsResult.rowCount });
  } catch (err) {
    await client.query('ROLLBACK');
    return next(err);
  } finally {
    client.release();
  }
});

router.get('/status/:campaignId', async (req, res, next) => {
  try {
    const params = z.object({ campaignId: z.string().uuid() }).parse(req.params);

    const campaignResult = await pool.query('SELECT * FROM campaigns WHERE id = $1 AND user_id = $2', [
      params.campaignId,
      req.user.userId
    ]);
    if (!campaignResult.rowCount) return res.status(404).json({ message: 'Campaign not found' });

    const statResult = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending') AS pending,
         COUNT(*) FILTER (WHERE status = 'sent') AS sent,
         COUNT(*) FILTER (WHERE status = 'failed') AS failed
       FROM messages
       WHERE campaign_id = $1`,
      [params.campaignId]
    );

    const logs = await pool.query(
      `SELECT phone_number, status, error_message, sent_at, attempts
       FROM messages
       WHERE campaign_id = $1
       ORDER BY updated_at DESC
       LIMIT 100`,
      [params.campaignId]
    );

    return res.json({ campaign: campaignResult.rows[0], stats: statResult.rows[0], logs: logs.rows });
  } catch (err) {
    return next(err);
  }
});

export default router;
EOF

mkdir -p "$TARGET_DIR/apps/backend/src/modules/contacts"
cat > "$TARGET_DIR/apps/backend/src/modules/contacts/routes.js" <<'EOF'
import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { authRequired } from '../../middleware/auth.js';
import { pool } from '../../db/pool.js';
import { env } from '../../config/env.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(authRequired);

function normalizePhone(phone) {
  return String(phone).replace(/[^\d+]/g, '').trim();
}

async function parseBuffer(buffer, mimetype) {
  if (mimetype.includes('csv') || mimetype.includes('text/plain')) {
    return buffer
      .toString('utf8')
      .split('\n')
      .map((line) => line.split(',')[0]?.trim())
      .filter(Boolean);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  const values = [];
  sheet.eachRow((row, rowNo) => {
    if (rowNo === 1) return;
    const firstCell = row.getCell(1).value;
    if (firstCell) values.push(String(firstCell));
  });
  return values;
}

router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    const body = z.object({ projectId: z.string().uuid() }).parse(req.body);
    if (!req.file) return res.status(400).json({ message: 'Missing file' });

    const projectResult = await pool.query('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [
      body.projectId,
      req.user.userId
    ]);
    if (!projectResult.rowCount) return res.status(404).json({ message: 'Project not found' });

    const rawPhones = await parseBuffer(req.file.buffer, req.file.mimetype);
    const uniquePhones = [...new Set(rawPhones.map(normalizePhone).filter((value) => value.length >= 8))];

    if (uniquePhones.length > env.maxContactsPerUpload) {
      return res.status(400).json({ message: `Max upload limit is ${env.maxContactsPerUpload}` });
    }

    const insertQuery = `
      INSERT INTO contacts (project_id, phone_number)
      SELECT $1, unnest($2::text[])
      ON CONFLICT (project_id, phone_number) DO NOTHING
      RETURNING id
    `;

    const inserted = await pool.query(insertQuery, [body.projectId, uniquePhones]);
    return res.status(201).json({ added: inserted.rowCount, totalParsed: uniquePhones.length });
  } catch (err) {
    return next(err);
  }
});

router.get('/:projectId', async (req, res, next) => {
  try {
    const params = z.object({ projectId: z.string().uuid() }).parse(req.params);
    const result = await pool.query(
      `SELECT id, phone_number, name, metadata, created_at
       FROM contacts
       WHERE project_id = $1
       ORDER BY created_at DESC
       LIMIT 500`,
      [params.projectId]
    );

    return res.json({ contacts: result.rows });
  } catch (err) {
    return next(err);
  }
});

export default router;
EOF

mkdir -p "$TARGET_DIR/apps/backend/src/modules/health"
cat > "$TARGET_DIR/apps/backend/src/modules/health/routes.js" <<'EOF'
import { Router } from 'express';

const router = Router();

router.get('/', (_req, res) => {
  res.json({ status: 'ok' });
});

export default router;
EOF

mkdir -p "$TARGET_DIR/apps/backend/src/modules/projects"
cat > "$TARGET_DIR/apps/backend/src/modules/projects/routes.js" <<'EOF'
import { Router } from 'express';
import { z } from 'zod';
import { authRequired } from '../../middleware/auth.js';
import { pool } from '../../db/pool.js';

const router = Router();
router.use(authRequired);

router.post('/', async (req, res, next) => {
  try {
    const body = z.object({ name: z.string().min(2), description: z.string().optional() }).parse(req.body);
    const result = await pool.query(
      'INSERT INTO projects (user_id, name, description) VALUES ($1, $2, $3) RETURNING *',
      [req.user.userId, body.name, body.description || null]
    );

    return res.status(201).json({ project: result.rows[0] });
  } catch (err) {
    return next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM projects WHERE user_id = $1 ORDER BY created_at DESC', [req.user.userId]);
    return res.json({ projects: result.rows });
  } catch (err) {
    return next(err);
  }
});

export default router;
EOF

mkdir -p "$TARGET_DIR/apps/backend/src"
cat > "$TARGET_DIR/apps/backend/src/server.js" <<'EOF'
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler } from './middleware/errorHandler.js';

import healthRoutes from './modules/health/routes.js';
import authRoutes from './modules/auth/routes.js';
import projectsRoutes from './modules/projects/routes.js';
import contactsRoutes from './modules/contacts/routes.js';
import campaignsRoutes from './modules/campaigns/routes.js';
import accountsRoutes from './modules/accounts/routes.js';

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.frontendUrl,
    credentials: true
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(pinoHttp({ logger }));
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 100
  })
);

app.use('/health', healthRoutes);
app.use('/auth', authRoutes);
app.use('/projects', projectsRoutes);
app.use('/contacts', contactsRoutes);
app.use('/campaign', campaignsRoutes);
app.use('/accounts', accountsRoutes);

app.use(errorHandler);

app.listen(env.port, () => {
  logger.info(`Backend listening on port ${env.port}`);
});
EOF

mkdir -p "$TARGET_DIR/apps/backend/src/services"
cat > "$TARGET_DIR/apps/backend/src/services/queue.js" <<'EOF'
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env.js';

const connection = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });

export const campaignQueue = new Queue('campaign-message-send', {
  connection,
  defaultJobOptions: {
    attempts: 4,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 2000,
    removeOnFail: 1000
  }
});
EOF

mkdir -p "$TARGET_DIR/apps/backend/src/utils"
cat > "$TARGET_DIR/apps/backend/src/utils/template.js" <<'EOF'
export function randomizeTemplate(template) {
  return template.replace(/\{([^}]+)\}/g, (_, variants) => {
    const options = variants.split('|').map((option) => option.trim());
    return options[Math.floor(Math.random() * options.length)] || '';
  });
}
EOF

mkdir -p "$TARGET_DIR/apps/frontend"
cat > "$TARGET_DIR/apps/frontend/Dockerfile" <<'EOF'
FROM node:20-bookworm AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
EOF

mkdir -p "$TARGET_DIR/apps/frontend"
cat > "$TARGET_DIR/apps/frontend/index.html" <<'EOF'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Bulk Messaging SaaS</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
EOF

mkdir -p "$TARGET_DIR/apps/frontend"
cat > "$TARGET_DIR/apps/frontend/package.json" <<'EOF'
{
  "name": "frontend",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0 --port 5173",
    "build": "vite build",
    "preview": "vite preview --host 0.0.0.0 --port 5173",
    "lint": "eslint ."
  },
  "dependencies": {
    "axios": "^1.7.7",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.2",
    "eslint": "^9.10.0",
    "vite": "^5.4.2"
  }
}
EOF

mkdir -p "$TARGET_DIR/apps/frontend/src/api"
cat > "$TARGET_DIR/apps/frontend/src/api/client.js" <<'EOF'
import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000'
});

export function setAuthToken(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
}
EOF

mkdir -p "$TARGET_DIR/apps/frontend/src/components"
cat > "$TARGET_DIR/apps/frontend/src/components/AuthForm.jsx" <<'EOF'
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export function AuthForm() {
  const { login, register } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', fullName: '' });

  const submit = async (event) => {
    event.preventDefault();
    if (isRegister) {
      await register(form);
      alert('Registered. Please login.');
      setIsRegister(false);
      return;
    }
    await login(form.email, form.password);
  };

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 8, maxWidth: 360, margin: '40px auto' }}>
      <h2>{isRegister ? 'Register' : 'Login'}</h2>
      {isRegister && (
        <input
          placeholder="Full name"
          value={form.fullName}
          onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          required
        />
      )}
      <input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
      <input
        placeholder="Password"
        type="password"
        value={form.password}
        onChange={(e) => setForm({ ...form, password: e.target.value })}
        required
      />
      <button type="submit">{isRegister ? 'Create account' : 'Login'}</button>
      <button type="button" onClick={() => setIsRegister((prev) => !prev)}>
        {isRegister ? 'Have an account? Login' : 'No account? Register'}
      </button>
    </form>
  );
}
EOF

mkdir -p "$TARGET_DIR/apps/frontend/src/context"
cat > "$TARGET_DIR/apps/frontend/src/context/AuthContext.jsx" <<'EOF'
import { createContext, useContext, useEffect, useState } from 'react';
import { api, setAuthToken } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem('token'));

  useEffect(() => {
    setAuthToken(token);
    if (token) localStorage.setItem('token', token);
    else localStorage.removeItem('token');
  }, [token]);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    setToken(data.token);
  };

  const register = async (payload) => {
    await api.post('/auth/register', payload);
  };

  const logout = () => setToken(null);

  return <AuthContext.Provider value={{ token, login, register, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
EOF

mkdir -p "$TARGET_DIR/apps/frontend/src"
cat > "$TARGET_DIR/apps/frontend/src/main.jsx" <<'EOF'
import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthForm } from './components/AuthForm';
import { Dashboard } from './pages/Dashboard';

function App() {
  const { token } = useAuth();
  return token ? <Dashboard /> : <AuthForm />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
EOF

mkdir -p "$TARGET_DIR/apps/frontend/src/pages"
cat > "$TARGET_DIR/apps/frontend/src/pages/Dashboard.jsx" <<'EOF'
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

export function Dashboard() {
  const { logout } = useAuth();
  const [projects, setProjects] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [selectedCampaign, setSelectedCampaign] = useState('');
  const [status, setStatus] = useState(null);
  const [projectName, setProjectName] = useState('');

  const [accountForm, setAccountForm] = useState({ channel: 'whatsapp', label: '', sessionPath: '/sessions/account-1' });
  const [campaignForm, setCampaignForm] = useState({ projectId: '', accountId: '', channel: 'whatsapp', name: '', template: '' });

  async function loadBase() {
    const [p, a] = await Promise.all([api.get('/projects'), api.get('/accounts')]);
    setProjects(p.data.projects);
    setAccounts(a.data.accounts);
  }

  useEffect(() => {
    loadBase().catch(console.error);
  }, []);

  const createProject = async () => {
    await api.post('/projects', { name: projectName });
    setProjectName('');
    await loadBase();
  };

  const createAccount = async () => {
    await api.post('/accounts', accountForm);
    await loadBase();
  };

  const uploadContacts = async (projectId, file) => {
    const formData = new FormData();
    formData.append('projectId', projectId);
    formData.append('file', file);
    await api.post('/contacts/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
    alert('Contacts uploaded');
  };

  const startCampaign = async () => {
    const { data } = await api.post('/campaign/start', campaignForm);
    setSelectedCampaign(data.campaignId);
    alert('Campaign queued');
  };

  const fetchStatus = async () => {
    const { data } = await api.get(`/campaign/status/${selectedCampaign}`);
    setStatus(data);
  };

  return (
    <div style={{ padding: 20, fontFamily: 'Arial, sans-serif', display: 'grid', gap: 16 }}>
      <h1>Bulk Messaging Dashboard</h1>
      <button onClick={logout}>Logout</button>

      <section>
        <h3>Create Project</h3>
        <input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Project name" />
        <button onClick={createProject}>Create</button>
      </section>

      <section>
        <h3>Create Messaging Account</h3>
        <select value={accountForm.channel} onChange={(e) => setAccountForm({ ...accountForm, channel: e.target.value })}>
          <option value="whatsapp">WhatsApp</option>
          <option value="telegram">Telegram</option>
        </select>
        <input placeholder="Label" value={accountForm.label} onChange={(e) => setAccountForm({ ...accountForm, label: e.target.value })} />
        <input
          placeholder="Session path"
          value={accountForm.sessionPath}
          onChange={(e) => setAccountForm({ ...accountForm, sessionPath: e.target.value })}
        />
        <button onClick={createAccount}>Save account</button>
      </section>

      <section>
        <h3>Projects</h3>
        <ul>
          {projects.map((project) => (
            <li key={project.id}>
              {project.name}
              <input type="file" accept=".csv,.xlsx" onChange={(e) => uploadContacts(project.id, e.target.files[0])} />
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Start Campaign</h3>
        <select value={campaignForm.projectId} onChange={(e) => setCampaignForm({ ...campaignForm, projectId: e.target.value })}>
          <option value="">Select project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <select value={campaignForm.accountId} onChange={(e) => setCampaignForm({ ...campaignForm, accountId: e.target.value })}>
          <option value="">Select account</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.label} ({account.channel})
            </option>
          ))}
        </select>
        <input placeholder="Campaign name" value={campaignForm.name} onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })} />
        <textarea
          placeholder="Template e.g. {Hi|Hello} {name}, your order is ready"
          value={campaignForm.template}
          onChange={(e) => setCampaignForm({ ...campaignForm, template: e.target.value })}
        />
        <button onClick={startCampaign}>Start Campaign</button>
      </section>

      <section>
        <h3>Campaign Status</h3>
        <input value={selectedCampaign} onChange={(e) => setSelectedCampaign(e.target.value)} placeholder="Campaign ID" />
        <button onClick={fetchStatus}>Refresh Status</button>
        {status && (
          <div>
            <pre>{JSON.stringify(status.stats, null, 2)}</pre>
            <pre>{JSON.stringify(status.logs.slice(0, 5), null, 2)}</pre>
          </div>
        )}
      </section>
    </div>
  );
}
EOF

mkdir -p "$TARGET_DIR/apps/frontend"
cat > "$TARGET_DIR/apps/frontend/vite.config.js" <<'EOF'
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()]
});
EOF

mkdir -p "$TARGET_DIR/apps/worker"
cat > "$TARGET_DIR/apps/worker/Dockerfile" <<'EOF'
FROM mcr.microsoft.com/playwright:v1.49.1-jammy
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["npm", "run", "start"]
EOF

mkdir -p "$TARGET_DIR/apps/worker"
cat > "$TARGET_DIR/apps/worker/package.json" <<'EOF'
{
  "name": "worker",
  "version": "1.0.0",
  "type": "module",
  "main": "src/index.js",
  "scripts": {
    "dev": "nodemon src/index.js",
    "start": "node src/index.js",
    "lint": "eslint ."
  },
  "dependencies": {
    "bullmq": "^5.12.12",
    "dotenv": "^16.4.5",
    "ioredis": "^5.4.1",
    "pg": "^8.12.0",
    "playwright": "^1.49.1",
    "pino": "^9.4.0"
  },
  "devDependencies": {
    "eslint": "^9.10.0",
    "nodemon": "^3.1.7"
  }
}
EOF

mkdir -p "$TARGET_DIR/apps/worker/src/config"
cat > "$TARGET_DIR/apps/worker/src/config/env.js" <<'EOF'
import dotenv from 'dotenv';

dotenv.config();

export const env = {
  redisUrl: process.env.REDIS_URL || 'redis://redis:6379',
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@postgres:5432/bulk_saas',
  minDelayMs: Number(process.env.MIN_DELAY_MS || 10000),
  maxDelayMs: Number(process.env.MAX_DELAY_MS || 30000),
  headless: process.env.HEADLESS !== 'false'
};
EOF

mkdir -p "$TARGET_DIR/apps/worker/src"
cat > "$TARGET_DIR/apps/worker/src/index.js" <<'EOF'
import { worker } from './queue/processor.js';
import { logger } from './services/logger.js';

worker.on('ready', () => logger.info('Worker ready'));
worker.on('completed', (job) => logger.info({ jobId: job.id }, 'Job completed'));
worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'Job failed'));
EOF

mkdir -p "$TARGET_DIR/apps/worker/src/providers"
cat > "$TARGET_DIR/apps/worker/src/providers/telegramWeb.js" <<'EOF'
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
EOF

mkdir -p "$TARGET_DIR/apps/worker/src/providers"
cat > "$TARGET_DIR/apps/worker/src/providers/whatsappWeb.js" <<'EOF'
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
EOF

mkdir -p "$TARGET_DIR/apps/worker/src/queue"
cat > "$TARGET_DIR/apps/worker/src/queue/processor.js" <<'EOF'
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env.js';
import { pool } from '../services/db.js';
import { logger } from '../services/logger.js';
import { sendWhatsAppMessage } from '../providers/whatsappWeb.js';
import { sendTelegramMessage } from '../providers/telegramWeb.js';
import { randomInt, wait } from '../utils/random.js';

const connection = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });

async function resetDailyCounterIfNeeded(accountId, client) {
  await client.query(
    `UPDATE messaging_accounts
     SET sent_today = 0, sent_date = CURRENT_DATE
     WHERE id = $1 AND (sent_date IS NULL OR sent_date < CURRENT_DATE)`,
    [accountId]
  );
}

async function getMessageData(client, messageId, accountId) {
  const result = await client.query(
    `SELECT m.id, m.phone_number, m.content, m.channel, m.campaign_id,
            a.session_path, a.daily_limit, a.sent_today, a.is_active
     FROM messages m
     JOIN messaging_accounts a ON a.id = $2
     WHERE m.id = $1`,
    [messageId, accountId]
  );

  return result.rows[0];
}

export const worker = new Worker(
  'campaign-message-send',
  async (job) => {
    const client = await pool.connect();
    const { messageId, accountId, campaignId } = job.data;

    try {
      await client.query('BEGIN');

      await resetDailyCounterIfNeeded(accountId, client);
      const data = await getMessageData(client, messageId, accountId);
      if (!data) throw new Error('Message not found');
      if (!data.is_active) throw new Error('Messaging account is inactive');
      if (data.sent_today >= data.daily_limit) throw new Error('Daily limit reached');

      await client.query(`UPDATE campaigns SET status = 'processing', updated_at = NOW() WHERE id = $1`, [campaignId]);

      await client.query('COMMIT');

      await wait(randomInt(env.minDelayMs, env.maxDelayMs));

      const sender =
        data.channel === 'whatsapp'
          ? sendWhatsAppMessage
          : sendTelegramMessage;

      const result = await sender({
        sessionPath: data.session_path,
        phoneNumber: data.phone_number,
        content: data.content,
        headless: env.headless
      });

      if (!result.success) throw new Error(result.error || 'Unknown provider error');

      await client.query('BEGIN');
      await client.query(
        `UPDATE messages
         SET status = 'sent', sent_at = NOW(), provider_message_id = $2, attempts = attempts + 1, updated_at = NOW()
         WHERE id = $1`,
        [messageId, result.providerMessageId]
      );
      await client.query(
        `UPDATE messaging_accounts
         SET sent_today = sent_today + 1, sent_date = CURRENT_DATE
         WHERE id = $1`,
        [accountId]
      );

      const pending = await client.query(`SELECT COUNT(*)::int AS count FROM messages WHERE campaign_id = $1 AND status = 'pending'`, [
        campaignId
      ]);
      if (pending.rows[0].count === 0) {
        await client.query(`UPDATE campaigns SET status = 'completed', updated_at = NOW() WHERE id = $1`, [campaignId]);
      }

      await client.query('COMMIT');
      logger.info({ messageId }, 'Message sent');
    } catch (error) {
      await client.query('ROLLBACK');

      await client.query(
        `UPDATE messages
         SET status = 'failed', error_message = $2, attempts = attempts + 1, updated_at = NOW()
         WHERE id = $1`,
        [messageId, error.message]
      );

      const failedAndPending = await client.query(
        `SELECT
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
         FROM messages WHERE campaign_id = $1`,
        [campaignId]
      );
      if (failedAndPending.rows[0].pending === 0 && failedAndPending.rows[0].failed > 0) {
        await client.query(`UPDATE campaigns SET status = 'failed', updated_at = NOW() WHERE id = $1`, [campaignId]);
      }

      logger.error({ err: error, messageId }, 'Failed to send message');
      throw error;
    } finally {
      client.release();
    }
  },
  {
    connection,
    concurrency: 4
  }
);
EOF

mkdir -p "$TARGET_DIR/apps/worker/src/services"
cat > "$TARGET_DIR/apps/worker/src/services/db.js" <<'EOF'
import pg from 'pg';
import { env } from '../config/env.js';

export const pool = new pg.Pool({ connectionString: env.databaseUrl });
EOF

mkdir -p "$TARGET_DIR/apps/worker/src/services"
cat > "$TARGET_DIR/apps/worker/src/services/logger.js" <<'EOF'
import pino from 'pino';

export const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
EOF

mkdir -p "$TARGET_DIR/apps/worker/src/utils"
cat > "$TARGET_DIR/apps/worker/src/utils/random.js" <<'EOF'
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
EOF

cat > "$TARGET_DIR/docker-compose.yml" <<'EOF'
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: bulk_saas
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./apps/backend/sql/init.sql:/docker-entrypoint-initdb.d/init.sql:ro

  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'

  backend:
    build: ./apps/backend
    environment:
      PORT: 4000
      DATABASE_URL: postgres://postgres:postgres@postgres:5432/bulk_saas
      REDIS_URL: redis://redis:6379
      JWT_SECRET: super-secret
      FRONTEND_URL: http://localhost
    depends_on:
      - postgres
      - redis
    volumes:
      - ./sessions:/sessions
    ports:
      - '4000:4000'

  worker:
    build: ./apps/worker
    environment:
      DATABASE_URL: postgres://postgres:postgres@postgres:5432/bulk_saas
      REDIS_URL: redis://redis:6379
      MIN_DELAY_MS: 10000
      MAX_DELAY_MS: 30000
      HEADLESS: 'true'
    depends_on:
      - postgres
      - redis
    volumes:
      - ./sessions:/sessions

  frontend:
    build: ./apps/frontend
    environment:
      VITE_API_URL: http://localhost/api
    depends_on:
      - backend

  nginx:
    image: nginx:1.27-alpine
    depends_on:
      - frontend
      - backend
    ports:
      - '80:80'
    volumes:
      - ./infra/nginx/default.conf:/etc/nginx/conf.d/default.conf:ro

volumes:
  postgres_data:
EOF

mkdir -p "$TARGET_DIR/infra/nginx"
cat > "$TARGET_DIR/infra/nginx/default.conf" <<'EOF'
server {
  listen 80;
  server_name _;

  location /api/ {
    proxy_pass http://backend:4000/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  location / {
    proxy_pass http://frontend:80/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
  }
}
EOF

cat > "$TARGET_DIR/package.json" <<'EOF'
{
  "name": "bulk-messaging-saas",
  "private": true,
  "workspaces": [
    "apps/backend",
    "apps/worker",
    "apps/frontend"
  ],
  "scripts": {
    "dev": "concurrently \"npm run dev -w apps/backend\" \"npm run dev -w apps/worker\" \"npm run dev -w apps/frontend\"",
    "build": "npm run build -w apps/backend && npm run build -w apps/worker && npm run build -w apps/frontend",
    "lint": "npm run lint -w apps/backend && npm run lint -w apps/worker && npm run lint -w apps/frontend"
  },
  "devDependencies": {
    "concurrently": "^9.1.2"
  }
}
EOF

echo "Project files generated in $TARGET_DIR"
