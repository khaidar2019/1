import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { authRequired } from '../../middleware/auth.js';
import { pool } from '../../db/pool.js';
import { env } from '../../config/env.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(authRequired);

function normalizePhone(phone) {
  return String(phone).replace(/[^\d+]/g, '').trim();
}

async function parseBuffer(buffer, mimetype) {
  if (mimetype.includes('csv') || mimetype.includes('text/plain')) {
    return buffer
      .toString('utf8')
      .split('\n')
      .map((line) => line.split(',')[0]?.trim())
      .filter(Boolean);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  const values = [];
  sheet.eachRow((row, rowNo) => {
    if (rowNo === 1) return;
    const firstCell = row.getCell(1).value;
    if (firstCell) values.push(String(firstCell));
  });
  return values;
}

router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    const body = z.object({ projectId: z.string().uuid() }).parse(req.body);
    if (!req.file) return res.status(400).json({ message: 'Missing file' });

    const projectResult = await pool.query('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [
      body.projectId,
      req.user.userId
    ]);
    if (!projectResult.rowCount) return res.status(404).json({ message: 'Project not found' });

    const rawPhones = await parseBuffer(req.file.buffer, req.file.mimetype);
    const uniquePhones = [...new Set(rawPhones.map(normalizePhone).filter((value) => value.length >= 8))];

    if (uniquePhones.length > env.maxContactsPerUpload) {
      return res.status(400).json({ message: `Max upload limit is ${env.maxContactsPerUpload}` });
    }

    const insertQuery = `
      INSERT INTO contacts (project_id, phone_number)
      SELECT $1, unnest($2::text[])
      ON CONFLICT (project_id, phone_number) DO NOTHING
      RETURNING id
    `;

    const inserted = await pool.query(insertQuery, [body.projectId, uniquePhones]);
    return res.status(201).json({ added: inserted.rowCount, totalParsed: uniquePhones.length });
  } catch (err) {
    return next(err);
  }
});

router.get('/:projectId', async (req, res, next) => {
  try {
    const params = z.object({ projectId: z.string().uuid() }).parse(req.params);
    const result = await pool.query(
      `SELECT id, phone_number, name, metadata, created_at
       FROM contacts
       WHERE project_id = $1
       ORDER BY created_at DESC
       LIMIT 500`,
      [params.projectId]
    );

    return res.json({ contacts: result.rows });
  } catch (err) {
    return next(err);
  }
});

export default router;
