/**
 * Adds id_number (free-text catalog/ID field) and notes (user notes)
 * to the tracks table. Both nullable — existing rows unaffected.
 * GET serializer spreads ...t so both columns appear automatically.
 */
export async function up(knex) {
  await knex.schema.alterTable('tracks', (t) => {
    t.string('id_number', 64).nullable();
    t.text('notes').nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable('tracks', (t) => {
    t.dropColumn('id_number');
    t.dropColumn('notes');
  });
}
