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
