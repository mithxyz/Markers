/**
 * Per-marker ownership + visibility.
 *
 * - owner_id: the ACCESS owner (distinct from the audit `created_by`). Backfilled
 *   to created_by, falling back to the project owner for any orphan cues.
 * - visibility: 'private' (owner only) | 'public_ro' (members see, owner edits) |
 *   'public_edit' (members see + edit). Backfill ALL existing cues -> 'public_edit'
 *   so today's shared, everyone-edits behavior is preserved.
 * - anon_visible: when true AND non-private, the cue is exposed on the project's
 *   anonymous public share link.
 *
 * Plain string columns (not native PG enum) to avoid the enum-alter pain seen
 * with the role migration.
 */
export async function up(knex) {
  await knex.schema.alterTable('cues', (t) => {
    t.uuid('owner_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.string('visibility', 16).notNullable().defaultTo('public_edit');
    t.boolean('anon_visible').notNullable().defaultTo(false);
    t.index(['track_id', 'visibility']);
    t.index('owner_id');
  });

  // Backfill owner_id = created_by, else the project owner (via track -> project).
  await knex.raw(`
    UPDATE cues c
       SET owner_id = COALESCE(c.created_by, p.owner_id)
      FROM tracks t
      JOIN projects p ON p.id = t.project_id
     WHERE t.id = c.track_id
       AND c.owner_id IS NULL
  `);
}

export async function down(knex) {
  await knex.schema.alterTable('cues', (t) => {
    t.dropColumn('owner_id');
    t.dropColumn('visibility');
    t.dropColumn('anon_visible');
  });
}
