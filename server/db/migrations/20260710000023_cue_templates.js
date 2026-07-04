/**
 * Phase 11b: lane_type + cue_templates.
 *
 * - cue_lanes gains lane_type ('point'|'region', default 'point'). Stored as a
 *   plain string so down() needs no DROP TYPE.
 * - cue_templates: one template per lane (UNIQUE lane_id). Fields is a jsonb
 *   array of field descriptors: [{name, type, required, default}]. export_mapping
 *   is a jsonb object describing how lane fields serialise per export format.
 * - Backfill: every existing lane gets lane_type='point' and a default template
 *   exposing name/color/fade/note (the standard cue columns).
 */

const DEFAULT_FIELDS = JSON.stringify([
  { name: 'name',  type: 'string',  required: true,  default: 'Cue' },
  { name: 'color', type: 'color',   required: false, default: '#ff4444' },
  { name: 'fade',  type: 'number',  required: false, default: 0 },
  { name: 'note',  type: 'text',    required: false, default: '' },
]);

export async function up(knex) {
  await knex.schema.alterTable('cue_lanes', (t) => {
    t.string('lane_type', 16).notNullable().defaultTo('point');
  });

  await knex.schema.createTable('cue_templates', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('lane_id').notNullable().references('id').inTable('cue_lanes').onDelete('CASCADE').unique();
    t.jsonb('fields').notNullable().defaultTo('[]');
    t.jsonb('export_mapping').notNullable().defaultTo('{}');
    t.timestamps(true, true);
  });

  // Backfill: seed a default template for every existing lane.
  const lanes = await knex('cue_lanes').select('id');
  if (lanes.length) {
    await knex('cue_templates').insert(
      lanes.map((l) => ({ lane_id: l.id, fields: DEFAULT_FIELDS, export_mapping: '{}' }))
    );
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('cue_templates');
  await knex.schema.alterTable('cue_lanes', (t) => {
    t.dropColumn('lane_type');
  });
}
