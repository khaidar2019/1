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
