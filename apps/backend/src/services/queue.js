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
