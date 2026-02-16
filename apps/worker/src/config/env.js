import dotenv from 'dotenv';

dotenv.config();

export const env = {
  redisUrl: process.env.REDIS_URL || 'redis://redis:6379',
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@postgres:5432/bulk_saas',
  minDelayMs: Number(process.env.MIN_DELAY_MS || 10000),
  maxDelayMs: Number(process.env.MAX_DELAY_MS || 30000),
  headless: process.env.HEADLESS !== 'false'
};
