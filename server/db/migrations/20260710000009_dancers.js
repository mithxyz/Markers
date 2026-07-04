/**
 * Phase 3c — dancer roster (HANDOVER Phase 3c). The project's cast; each dancer is
 * a named, colored token placed on the stage in formations. Project-scoped and
 * reusable across the project's tracks. `label` is a short token caption (e.g. "A").
 */
export async function up(knex) {
  await knex.schema.createTable('dancers', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.string('name', 120).notNullable();
    t.string('color', 9).notNullable().defaultTo('#22d3ee');
    t.string('label', 8).notNullable().defaultTo('');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.index(['project_id'], 'dancers_project_idx');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('dancers');
}
