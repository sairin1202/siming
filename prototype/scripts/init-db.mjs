import { readFile } from 'node:fs/promises';
import { openDatabase } from '../lib/database.mjs';

const connection = await openDatabase();
try {
  const schema = await readFile(
    new URL('../database/schema.sql', import.meta.url),
    'utf8',
  );
  for (const statement of schema
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)) {
    await connection.query(statement);
  }
  console.log('Database tables are ready.');
} finally {
  await connection.end();
}
