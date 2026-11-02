// Applies the plain SQL files in db/migrations in order, each inside a transaction, and records them in
// schema_migrations. The models never create or alter tables: the schema is owned by these files.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sequelize } from '../src/db.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');

await sequelize.query(
  'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
);
const [applied] = await sequelize.query('SELECT name FROM schema_migrations');
const done = new Set(applied.map((r) => r.name));

for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  if (done.has(file)) continue;
  await sequelize.transaction(async (transaction) => {
    await sequelize.query(readFileSync(path.join(dir, file), 'utf8'), { transaction });
    await sequelize.query('INSERT INTO schema_migrations (name) VALUES (:name)', { replacements: { name: file }, transaction });
  });
  console.log('applied', file);
}
await sequelize.close();
