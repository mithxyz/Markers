/**
 * Per-track settings (snap config, SMPTE fps, default view, overlay defaults,
 * section-detection flag). 1:1 with a track, small, always read with the track —
 * a jsonb column mirrors the existing `project_settings` precedent.
 */
export async function up(knex) {
  await knex.schema.alterTable('tracks', (t) => {
    t.jsonb('settings').notNullable().defaultTo('{}');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('tracks', (t) => {
    t.dropColumn('settings');
  });
}
