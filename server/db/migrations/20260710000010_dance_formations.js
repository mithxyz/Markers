/**
 * Phase 3c — dance formation keyframes (HANDOVER Phase 3c). A formation is a
 * snapshot of every dancer's stage position at a beat on a track. Playback lerps
 * positions between consecutive keyframes (straight-line, the proven default).
 *
 * `positions` jsonb = [{ dancer_id, x, y }] with x,y normalized 0..1 (x =
 * stage-left→right, y = upstage→downstage). Beat-positioned like markers/cues:
 * `beat` is canonical, `time` derived via server/lib/beats.js.
 */
export async function up(knex) {
  await knex.schema.createTable('dance_formations', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('track_id').notNullable().references('id').inTable('tracks').onDelete('CASCADE');
    t.float('time').notNullable().defaultTo(0);
    t.float('beat').nullable();
    t.string('name', 255).notNullable().defaultTo('Formation');
    t.jsonb('positions').notNullable().defaultTo('[]');
    t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['track_id', 'time'], 'dance_formations_track_time_idx');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('dance_formations');
}
