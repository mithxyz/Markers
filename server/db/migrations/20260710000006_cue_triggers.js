/**
 * Phase 2d — Resolume-targeted OSC + automation envelopes (HANDOVER v2 §6.3).
 * STORE-ONLY: these fields describe what a cue would fire; the live OSC/MIDI
 * emitter is Phase 3. EdiTour defaults the address to `/composition/layers/1/clips/1/`
 * (Resolume Arena's schema) — applied client-side, not as a column default.
 *
 * `osc_value`/`osc_address` fall back to the cue's department defaults
 * (`departments.default_osc_*`, added in Phase 2b) when null. `advanced_payload`
 * holds Resolume's `[value, duration, fade]` array when advanced mode is on.
 */
export async function up(knex) {
  await knex.schema.alterTable('cues', (t) => {
    t.text('osc_address').nullable();
    t.text('osc_value').nullable();
    t.enu('osc_value_type', ['int', 'float', 'string', 'bool']).notNullable().defaultTo('float');
    t.enu('automation', ['none', 'ramp_up', 'ramp_down', 'strobe', 'pulse']).notNullable().defaultTo('none');
    t.jsonb('advanced_payload').nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable('cues', (t) => {
    t.dropColumn('osc_address');
    t.dropColumn('osc_value');
    t.dropColumn('osc_value_type');
    t.dropColumn('automation');
    t.dropColumn('advanced_payload');
  });
}
