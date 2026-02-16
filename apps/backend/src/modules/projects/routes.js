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
