// Drops everything in the public schema. Used by `npm run db:reset` (then migrate + seed). Development only.
import './useDirectConnection.js';
import { databaseHost, isLocalDatabase } from '../src/config.js';
import { sequelize } from '../src/db.js';

if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset a production database');
if (!isLocalDatabase && process.env.ALLOW_REMOTE_RESET !== 'true') {
  throw new Error(`Refusing to DROP the schema of a remote database (${databaseHost}). Set ALLOW_REMOTE_RESET=true if you really mean it.`);
}
await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
console.log('schema reset');
await sequelize.close();
