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
