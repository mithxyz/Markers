import pg from 'pg';
import { config } from '../config.js';

/**
 * connect-pg-simple requires a dedicated pg.Pool — it must NOT share the Knex
 * pool (a hard-won gotcha carried forward from cuemarkers-v2).
 */
export const sessionPool = new pg.Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  max: 4,
});

export default sessionPool;
