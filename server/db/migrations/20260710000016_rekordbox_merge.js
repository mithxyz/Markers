/**
 * Deeper rekordbox integration (import lane, extra metadata, merge-on-reimport).
 *
 * `tracks.rekordbox_track_id` carries the XML `<TRACK TrackID="...">` so a
 * re-import can find the track it already created instead of duplicating it
 * (indexed per-project, not a hard unique — legacy/duplicate collections
 * shouldn't be able to break an import).
 *
 * `track_versions.musical_key` carries `Tonality` alongside the existing
 * bpm/meter/first_downbeat_sec rhythm fields.
 *
 * `cues.source`/`source_ref` distinguish rekordbox-imported cues from
 * manually-created ones, so a re-import can replace only the cues it owns
 * (`source='rekordbox'`) and never touch anything the user added by hand.
 * Existing cues default to `'manual'` — they predate any import concept.
 */
export async function up(knex) {
  await knex.schema.alterTable('tracks', (t) => {
    t.string('rekordbox_track_id', 64).nullable();
    t.index(['project_id', 'rekordbox_track_id'], 'tracks_rekordbox_track_id_idx');
  });

  await knex.schema.alterTable('track_versions', (t) => {
    t.string('musical_key', 16).nullable();
  });

  await knex.schema.alterTable('cues', (t) => {
    t.string('source', 16).notNullable().defaultTo('manual');
    t.string('source_ref', 64).nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable('cues', (t) => {
    t.dropColumn('source');
    t.dropColumn('source_ref');
  });

  await knex.schema.alterTable('track_versions', (t) => {
    t.dropColumn('musical_key');
  });

  await knex.schema.alterTable('tracks', (t) => {
    t.dropIndex(['project_id', 'rekordbox_track_id'], 'tracks_rekordbox_track_id_idx');
    t.dropColumn('rekordbox_track_id');
  });
}
