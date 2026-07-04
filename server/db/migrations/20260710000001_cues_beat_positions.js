/**
 * Phase 2a — beats as a source of truth (HANDOVER v2 §6.0). Adds beat-positioned
 * coordinates to cues so musical snap, Rekordbox import, and Reaper export all
 * compose cleanly. `start_beat`/`end_beat` are beats from t=0 (`beat = time × bpm/60`),
 * the inverse of `time = beat × 60/bpm`.
 *
 * Nullable + additive: `time`/`end_time` stay the physical anchor and remain the
 * fallback for tracks without a detected BPM, so nothing regresses. We backfill
 * from each track's CURRENT version BPM (populated by the Phase 1B analyzer).
 *
 * No CHECK (start_beat OR time present) is needed — `cues.time` is already
 * NOT NULL (default 0), so the "at least one coordinate" invariant always holds.
 */
export async function up(knex) {
  await knex.schema.alterTable('cues', (t) => {
    t.float('start_beat').nullable();
    t.float('end_beat').nullable();
    t.index(['track_id', 'start_beat'], 'cues_track_start_beat_idx');
  });

  // Backfill from the track's current version BPM where one exists. Cues on
  // BPM-less tracks keep start_beat NULL and fall back to `time`.
  await knex.raw(`
    UPDATE cues c
    SET start_beat = c.time * (tv.bpm / 60.0),
        end_beat   = CASE WHEN c.end_time IS NOT NULL THEN c.end_time * (tv.bpm / 60.0) ELSE NULL END
    FROM tracks t
    JOIN track_versions tv ON tv.id = t.current_version_id
    WHERE c.track_id = t.id
      AND tv.bpm IS NOT NULL
      AND tv.bpm > 0
  `);
}

export async function down(knex) {
  await knex.schema.alterTable('cues', (t) => {
    t.dropIndex(['track_id', 'start_beat'], 'cues_track_start_beat_idx');
    t.dropColumn('start_beat');
    t.dropColumn('end_beat');
  });
}
