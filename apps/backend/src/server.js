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
