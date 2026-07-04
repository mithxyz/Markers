/**
 * Analysis artifacts for a track version. `spectrogram_s3_key` points at a PNG
 * (ffmpeg showspectrumpic) in S3, mirroring `waveform_s3_key`. `analysis` holds
 * loose denormalized metadata not worth a column each (e.g. cached bpm/confidence).
 */
export async function up(knex) {
  await knex.schema.alterTable('track_versions', (t) => {
    t.string('spectrogram_s3_key', 1000).nullable();
    t.jsonb('analysis').notNullable().defaultTo('{}');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('track_versions', (t) => {
    t.dropColumn('spectrogram_s3_key');
    t.dropColumn('analysis');
  });
}
