/**
 * Activity / audit log. Unlike v2 (where this table was dead code) it is
 * actively written for version uploads, rollbacks, realigns, and CRUD.
 */
export async function up(knex) {
  await knex.schema.createTable('activity_log', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.uuid('user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.string('entity_type', 50).notNullable(); // cue | track | track_version | video_layer | member
    t.uuid('entity_id').nullable();
    t.enu('action', ['create', 'update', 'delete', 'version_upload', 'rollback', 'realign'], {
      useNative: true,
      enumName: 'activity_action',
    }).notNullable();
    t.jsonb('previous_data').nullable();
    t.jsonb('new_data').nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['project_id', 'created_at']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('activity_log');
  await knex.raw('DROP TYPE IF EXISTS activity_action');
}
