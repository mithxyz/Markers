/**
 * Close the tracks <-> track_versions circular reference by adding the FK now
 * that both tables exist.
 */
export async function up(knex) {
  await knex.schema.alterTable('tracks', (t) => {
    t.foreign('current_version_id').references('id').inTable('track_versions').onDelete('SET NULL');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('tracks', (t) => {
    t.dropForeign('current_version_id');
  });
}
