/**
 * 11g: add formation_placements.ease to enable fade/easing curves between
 * positions. Stored as a plain string; the client validates against the
 * known set (linear|ease-in|ease-out|ease-in-out). Nullable defaults to
 * 'linear' at the application layer so the schema stays reversible with
 * a simple DROP COLUMN.
 */
export async function up(knex) {
  await knex.schema.alterTable('formation_placements', (t) => {
    t.string('ease', 24).notNullable().defaultTo('linear');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('formation_placements', (t) => {
    t.dropColumn('ease');
  });
}
