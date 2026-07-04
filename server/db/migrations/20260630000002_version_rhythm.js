/**
 * Denormalized rhythm columns (Phase 1B). The full beat/downbeat arrays live in
 * the peaks JSON `tempo` block; these columns surface BPM/meter/first-downbeat in
 * the track header and listings without fetching the artifact. Populated by the
 * Python analyzer (BeatNet) via the worker; nullable so analysis stays best-effort.
 */
export async function up(knex) {
  await knex.schema.alterTable('track_versions', (t) => {
    t.float('bpm').nullable();
    t.string('meter', 16).nullable();
    t.float('first_downbeat_sec').nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable('track_versions', (t) => {
    t.dropColumn('bpm');
    t.dropColumn('meter');
    t.dropColumn('first_downbeat_sec');
  });
}
