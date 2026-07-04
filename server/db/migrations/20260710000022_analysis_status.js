/**
 * Phase 11a: add analysis_status to track_versions so the UI can distinguish
 * a BeatNet-unreachable "no BPM" from a fully-analysed ready version.
 *
 * Values: 'full' | 'no_rhythm' | 'analyzer_unreachable' | 'disabled'
 * Stored as a plain string (not pg enum) so down() needs no DROP TYPE.
 * Nullable so existing rows are unaffected without a backfill.
 */
export async function up(knex) {
  await knex.schema.alterTable('track_versions', (t) => {
    t.string('analysis_status', 24).nullable().defaultTo(null);
  });
}

export async function down(knex) {
  await knex.schema.alterTable('track_versions', (t) => {
    t.dropColumn('analysis_status');
  });
}
