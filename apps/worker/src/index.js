import { worker } from './queue/processor.js';
import { logger } from './services/logger.js';

worker.on('ready', () => logger.info('Worker ready'));
worker.on('completed', (job) => logger.info({ jobId: job.id }, 'Job completed'));
worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'Job failed'));
