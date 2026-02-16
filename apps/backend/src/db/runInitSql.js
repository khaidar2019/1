import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const sql = fs.readFileSync(path.join(__dirname, '../../sql/init.sql'), 'utf8');
  await pool.query(sql);
  await pool.end();
  console.log('Database initialized');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
