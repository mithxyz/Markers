/**
 * Phase 2c — markers (HANDOVER v2 §6.2, EdiTour pattern). Point-in-time labels,
 * attributed to their creator, kept separate from cues (cues are the triggers;
 * markers are lightweight annotations on the ruler). Beat-positioned like cues
 * (Phase 2a): `beat` derived from `time × bpm/60`, `time` the physical anchor.
 */
export async function up(knex) {
  await knex.schema.createTable('markers', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('track_id').notNullable().references('id').inTable('tracks').onDelete('CASCADE');
    t.float('time').notNullable().defaultTo(0);
    t.float('beat').nullable();
    t.string('name', 255).notNullable().defaultTo('Marker');
    t.string('color', 9).notNullable().defaultTo('#f8fafc');
    t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['track_id'], 'markers_track_idx');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('markers');
}
