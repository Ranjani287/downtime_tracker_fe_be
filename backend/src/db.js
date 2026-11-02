import { Sequelize } from 'sequelize';
import { config } from './config.js';

// One shared Sequelize instance. The schema is owned by the SQL migrations in db/migrations:
// the models only MAP onto existing tables, and `sequelize.sync()` is never called.
export const sequelize = new Sequelize(config.databaseUrl, {
  dialect: 'postgres',
  logging: process.env.DB_LOG ? (sql) => console.log(sql) : false, // DB_LOG=1 prints every SQL statement
  define: {
    freezeTableName: true, // model names are singular, tables are explicit
    timestamps: false,     // we map created_at ourselves and have no updated_at column
  },
});
