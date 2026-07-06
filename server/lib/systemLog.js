import { knex } from '../db/knex.js';

/**
 * Append an entry to system_log. Best-effort: never throws into the caller's
 * critical path (modelled on logActivity from lib/activity.js).
 *
 * @param {{ source: string, level?: 'error'|'warn'|'info', message: string, meta?: object }} opts
 */
export async function logSystem({ source, level = 'info', message, meta = {} }) {
  try {
    await knex('system_log').insert({ source, level, message, meta: JSON.stringify(meta) });
  } catch (err) {
    console.warn('[system_log] failed to write:', err.message);
  }
}

export default { logSystem };
