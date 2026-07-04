/**
 * Server-baked RGB waveform artifact (Phase 1A). `waveform_rgb_s3_key` points at
 * a JSON object `{ waveformRGBHDCompressed: <base64-zlib-of-[[amp,[r,g,b]],…]> }`
 * in S3, mirroring `waveform_s3_key`. Per-bucket colour is baked server-side from
 * the existing peak/RMS energy so the client just decodes + fillRect's.
 *
 * Additive + nullable: existing versions stay null until reprocessed, and the
 * client falls back to the simple/cdj/spectrogram views.
 */
export async function up(knex) {
  await knex.schema.alterTable('track_versions', (t) => {
    t.string('waveform_rgb_s3_key', 1000).nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable('track_versions', (t) => {
    t.dropColumn('waveform_rgb_s3_key');
  });
}
