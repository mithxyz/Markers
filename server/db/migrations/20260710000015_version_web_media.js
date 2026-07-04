/**
 * Browser playback fails for source formats without native decode support
 * (e.g. AIFF — Chrome/Firefox/Edge have none). `media_web_s3_key` points at a
 * PCM WAV transcode of the original upload, made at process time purely for
 * in-browser playback; the original `media_s3_key` file is untouched and
 * stays the source of truth for export/download. WAV is chosen over a lossy
 * format (mp3/aac) because those introduce encoder priming/padding that
 * shifts sample-zero — which would throw off the peaks/BPM/downbeat timing
 * already computed against the original decode. Additive + nullable:
 * existing versions keep the direct-original playback path (`media_s3_key`)
 * until reprocessed.
 */
export async function up(knex) {
  await knex.schema.alterTable('track_versions', (t) => {
    t.string('media_web_s3_key', 1000).nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable('track_versions', (t) => {
    t.dropColumn('media_web_s3_key');
  });
}
