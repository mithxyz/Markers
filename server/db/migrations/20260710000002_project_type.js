/**
 * Phase 2b — project mode (HANDOVER v2 §6.1). `projects.type` is a UI lens only
 * (dj → departments/OSC/rekordbox tools; dance → notation fields; general →
 * neutral). It NEVER affects the permission model. Non-native enum (varchar +
 * check) so the value set stays easy to extend. Existing rows default to 'general'.
 */
export async function up(knex) {
  await knex.schema.alterTable('projects', (t) => {
    t.enu('type', ['dj', 'dance', 'general']).notNullable().defaultTo('general');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('projects', (t) => {
    t.dropColumn('type');
  });
}
