/**
 * Phase 8d — per-dancer avatar image.
 * Adds `image_s3_key` (nullable) to `dancers`. The presigned display URL is
 * built at request time in the project GET; the column is never exposed raw.
 */
export async function up(knex) {
  await knex.schema.table('dancers', (t) => {
    t.string('image_s3_key', 500).nullable().defaultTo(null);
  });
}

export async function down(knex) {
  await knex.schema.table('dancers', (t) => {
    t.dropColumn('image_s3_key');
  });
}
