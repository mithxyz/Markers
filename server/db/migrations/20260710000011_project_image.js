/**
 * Phase 4a — project cover image. Nullable S3 key, mirroring the media-version
 * upload pattern (presigned PUT → complete → presigned GET for display).
 */
export async function up(knex) {
  await knex.schema.alterTable('projects', (t) => {
    t.string('image_s3_key', 500).nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable('projects', (t) => {
    t.dropColumn('image_s3_key');
  });
}
