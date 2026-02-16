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
