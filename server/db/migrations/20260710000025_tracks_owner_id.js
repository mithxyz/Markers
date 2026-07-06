/**
 * 11e: add tracks.owner_id (lightweight choreographer ownership).
 * Backfills from tracks.created_by so existing rows get an owner immediately.
 * Nullable FK → users ON DELETE SET NULL so deleting a user doesn't lose tracks.
 */
export async function up(knex) {
  await knex.schema.alterTable('tracks', (t) => {
    t.uuid('owner_id').nullable().references('id').inTable('users').onDelete('SET NULL');
  });
  // Backfill from created_by (already present on the table).
  await knex.raw('UPDATE tracks SET owner_id = created_by WHERE owner_id IS NULL AND created_by IS NOT NULL');
  await knex.schema.raw('CREATE INDEX tracks_owner_id ON tracks (owner_id) WHERE owner_id IS NOT NULL');
}

export async function down(knex) {
  await knex.schema.alterTable('tracks', (t) => {
    t.dropColumn('owner_id');
  });
}
