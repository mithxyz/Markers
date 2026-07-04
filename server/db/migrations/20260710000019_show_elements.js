/**
 * Phase 8 — DJ Show Builder: per-track show elements.
 * A separate lightweight table for DJ production elements (pyro, lasers, CO2,
 * etc.) that are placed on a timeline and shown as read-only reference lanes
 * in the main workspace. Isolated from the cue/department system by design.
 */
export async function up(knex) {
  await knex.schema.createTable('show_elements', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('track_id').notNullable().references('id').inTable('tracks').onDelete('CASCADE');
    t.string('type', 50).notNullable(); // pyro | laser | co2 | flames | confetti | lighting | haze | video | lyrics | spotlight | fx
    t.float('time').notNullable().defaultTo(0);
    t.float('end_time').nullable();
    t.float('beat').nullable();
    t.float('end_beat').nullable();
    t.string('name', 255).nullable();
    t.text('note').nullable();
    t.integer('intensity').nullable().checkBetween([0, 100]);
    t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['track_id', 'time']);
  });
}

export async function down(knex) {
  await knex.schema.dropTable('show_elements');
}
