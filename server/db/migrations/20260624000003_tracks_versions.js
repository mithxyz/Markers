/**
 * Tracks (stable named slots) and track_versions (immutable uploaded media).
 * tracks.current_version_id FK is added in a later migration to break the
 * tracks <-> track_versions circular dependency.
 */
export async function up(knex) {
  await knex.schema.createTable('tracks', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.string('name', 255).notNullable();
    t.enu('kind', ['audio', 'video'], {
      useNative: true,
      enumName: 'track_kind',
    }).notNullable().defaultTo('audio');
    t.uuid('current_version_id').nullable(); // FK added in migration 0004
    t.integer('sort_order').notNullable().defaultTo(0);
    t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['project_id', 'sort_order']);
  });

  await knex.schema.createTable('track_versions', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('track_id').notNullable().references('id').inTable('tracks').onDelete('CASCADE');
    t.integer('version_number').notNullable();
    t.string('label', 255).notNullable().defaultTo('');
    t.string('media_filename', 500).nullable();
    t.string('media_s3_key', 1000).nullable();
    t.string('media_mime', 255).nullable();
    t.bigInteger('media_size').notNullable().defaultTo(0);
    t.float('media_duration').notNullable().defaultTo(0);
    t.string('waveform_s3_key', 1000).nullable();
    t.enu('status', ['pending_upload', 'uploaded', 'processing', 'ready', 'failed'], {
      useNative: true,
      enumName: 'version_status',
    }).notNullable().defaultTo('pending_upload');
    t.text('error_message').nullable();
    t.uuid('uploaded_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
    t.unique(['track_id', 'version_number']);
    t.index(['track_id', 'version_number']);
    t.index('status');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('track_versions');
  await knex.schema.dropTableIfExists('tracks');
  await knex.raw('DROP TYPE IF EXISTS track_kind');
  await knex.raw('DROP TYPE IF EXISTS version_status');
}
