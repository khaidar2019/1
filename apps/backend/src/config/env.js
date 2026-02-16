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
