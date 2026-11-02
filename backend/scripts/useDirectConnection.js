// Import this FIRST in any maintenance script (migrate, seed, reset).
// Neon guidance: schema changes and other admin work use the DIRECT (non-pooled) connection, while the running
// API uses the pooled one. Neon provides both: DATABASE_URL (pooled) and DATABASE_URL_UNPOOLED (direct).
// With a plain local database there is no UNPOOLED variable and this does nothing.
import '../src/env.js';

if (process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;
