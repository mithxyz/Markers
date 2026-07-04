/**
 * Phase 3a — live MIDI trigger config on cues (HANDOVER v2 §7.2). The browser
 * fires WebMIDI Note On/Off as the show clock passes each cue (enter/exit). This
 * is the live counterpart to the stored OSC config (2d); OSC live-emit needs a
 * local UDP bridge and stays a follow-up.
 *
 * `trigger_on='none'` (default) = the cue doesn't fire. `midi_note` null = unset.
 */
export async function up(knex) {
  await knex.schema.alterTable('cues', (t) => {
    t.integer('midi_note').nullable(); // 0..127
    t.integer('midi_channel').notNullable().defaultTo(1); // 1..16
    t.integer('midi_velocity').notNullable().defaultTo(100); // 0..127
    t.enu('trigger_on', ['none', 'enter', 'exit', 'both']).notNullable().defaultTo('none');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('cues', (t) => {
    t.dropColumn('midi_note');
    t.dropColumn('midi_channel');
    t.dropColumn('midi_velocity');
    t.dropColumn('trigger_on');
  });
}
