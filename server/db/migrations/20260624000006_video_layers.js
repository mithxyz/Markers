/**
 * Video reference synced to an audio track's timeline. offset_seconds maps
 * video t=0 to audio t=offset. Cueing always happens on the audio waveform.
 */
export async function up(knex) {
  await knex.schema.createTable('video_layers', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.uuid('track_id').notNullable().references('id').inTable('tracks').onDelete('CASCADE');
    t.string('label', 255).notNullable().defaultTo('');
    t.string('video_s3_key', 1000).nullable();
    t.string('video_filename', 500).nullable();
    t.string('media_mime', 255).nullable();
    t.bigInteger('media_size').notNullable().defaultTo(0);
    t.float('duration').notNullable().defaultTo(0);
    t.float('offset_seconds').notNullable().defaultTo(0);
    t.enu('status', ['pending_upload', 'uploaded', 'processing', 'ready', 'failed'], {
      useNative: true,
      enumName: 'video_status',
    }).notNullable().defaultTo('pending_upload');
    t.uuid('uploaded_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index('track_id');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('video_layers');
  await knex.raw('DROP TYPE IF EXISTS video_status');
}
