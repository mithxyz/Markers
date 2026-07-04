/**
 * Cues are TRACK-scoped (persist across version swaps). origin_version_id
 * records which version a cue was authored against. lock_version powers
 * optimistic-concurrency conflict handling for collaborative edits.
 *
 * cue_snapshots freezes the full cue list at each version swap so rollback
 * is non-destructive.
 */
export async function up(knex) {
  await knex.schema.createTable('cues', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('track_id').notNullable().references('id').inTable('tracks').onDelete('CASCADE');
    t.uuid('origin_version_id').nullable().references('id').inTable('track_versions').onDelete('SET NULL');
    t.integer('cue_number').nullable();
    t.string('name', 255).notNullable().defaultTo('Cue');
    t.float('time').notNullable().defaultTo(0);
    t.float('end_time').nullable();
    t.text('description').notNullable().defaultTo('');
    t.float('fade').notNullable().defaultTo(0);
    t.string('marker_color', 9).notNullable().defaultTo('#ff4444');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.integer('lock_version').notNullable().defaultTo(0);
    t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.uuid('updated_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['track_id', 'time']);
    t.index(['track_id', 'sort_order']);
  });

  await knex.schema.createTable('cue_snapshots', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('track_id').notNullable().references('id').inTable('tracks').onDelete('CASCADE');
    t.uuid('version_id').nullable().references('id').inTable('track_versions').onDelete('CASCADE');
    t.jsonb('cues').notNullable().defaultTo('[]');
    t.enu('reason', ['version_swap', 'rollback', 'manual'], {
      useNative: true,
      enumName: 'snapshot_reason',
    }).notNullable().defaultTo('version_swap');
    t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['track_id', 'version_id']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('cue_snapshots');
  await knex.schema.dropTableIfExists('cues');
  await knex.raw('DROP TYPE IF EXISTS snapshot_reason');
}
