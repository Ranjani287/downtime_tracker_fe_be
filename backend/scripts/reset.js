// Drops everything in the public schema. Used by `npm run db:reset` (then migrate + seed). Development only.
import { sequelize } from '../src/db.js';

if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset a production database');
await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
console.log('schema reset');
await sequelize.close();
