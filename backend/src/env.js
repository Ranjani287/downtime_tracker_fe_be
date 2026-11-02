// Loads environment files before anything reads process.env. dotenv never overwrites a variable that is already
// set, so the FIRST source wins: real environment (hosting platform) > repo-root .env.local > backend/.env.
//
// .env.local is written by `neon env pull` / `neon deploy` at the repository root (DATABASE_URL = pooled,
// DATABASE_URL_UNPOOLED = direct). When it exists it takes precedence over backend/.env, so the app talks to Neon.
// Delete or rename .env.local to go back to the local database in backend/.env.
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(backendDir, '..', '.env.local'), quiet: true });
dotenv.config({ path: path.join(backendDir, '.env'), quiet: true });
