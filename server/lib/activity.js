import { knex } from '../db/knex.js';

/**
 * Append an entry to activity_log. Best-effort: never throws into the caller's
 * critical path (logging only).
 */
export async function logActivity({ projectId, userId, entityType, entityId, action, previous, next }) {
  try {
    await knex('activity_log').insert({
      project_id: projectId,
      user_id: userId || null,
      entity_type: entityType,
      entity_id: entityId || null,
      action,
      previous_data: previous ? JSON.stringify(previous) : null,
      new_data: next ? JSON.stringify(next) : null,
    });
  } catch (err) {
    console.warn('[activity] failed to log:', err.message);
  }
}

export default { logActivity };
