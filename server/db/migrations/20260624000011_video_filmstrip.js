/**
 * Video-layer filmstrip sprite (ffmpeg fps+tile PNG). `filmstrip_s3_key` points
 * at the sprite in S3; `filmstrip_meta` carries indexing info { cols, fps,
 * frameW, frameH } so the client can map time -> sprite column.
 */
export async function up(knex) {
  await knex.schema.alterTable('video_layers', (t) => {
    t.string('filmstrip_s3_key', 1000).nullable();
    t.jsonb('filmstrip_meta').notNullable().defaultTo('{}');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('video_layers', (t) => {
    t.dropColumn('filmstrip_s3_key');
    t.dropColumn('filmstrip_meta');
  });
}
