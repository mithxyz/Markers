/**
 * Phase 2b — departments → lanes (HANDOVER v2 §6.1, EdiTour model). A project has
 * departments (LD/VJ/FX/…), each a colored swim-lane group; cues belong to a lane
 * within a department. This is the structural layer; department-scoped permissions
 * (project_role_departments) are a deliberate follow-up — for now cue access still
 * uses the existing visibility/capability model.
 *
 * Backfill seeds one "Cues" department + "Default" lane per project and assigns
 * every existing cue to it, so `cues.lane_id` can become NOT NULL.
 *
 * `default_osc_address`/`default_osc_value` are placeholders consumed in Phase 2d
 * (Resolume OSC); harmless to add now.
 */
export async function up(knex) {
  await knex.schema.createTable('departments', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.string('name', 64).notNullable();
    t.string('color', 9).notNullable().defaultTo('#6366f1');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.text('default_osc_address').nullable();
    t.text('default_osc_value').nullable();
    t.timestamps(true, true);
    t.unique(['project_id', 'name']);
  });

  await knex.schema.createTable('cue_lanes', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('department_id').notNullable().references('id').inTable('departments').onDelete('CASCADE');
    t.string('name', 64).notNullable();
    t.enu('kind', ['cues', 'automation']).notNullable().defaultTo('cues');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.unique(['department_id', 'name']);
  });

  await knex.schema.alterTable('cues', (t) => {
    t.uuid('lane_id').nullable().references('id').inTable('cue_lanes').onDelete('CASCADE');
    t.index(['lane_id'], 'cues_lane_id_idx');
  });

  // Seed a default department + lane per project, then assign all existing cues.
  const projects = await knex('projects').select('id');
  for (const p of projects) {
    const [dept] = await knex('departments')
      .insert({ project_id: p.id, name: 'Cues', color: '#6366f1', sort_order: 0 })
      .returning('id');
    const [lane] = await knex('cue_lanes')
      .insert({ department_id: dept.id, name: 'Default', kind: 'cues', sort_order: 0 })
      .returning('id');
    await knex('cues')
      .whereIn('track_id', knex('tracks').where({ project_id: p.id }).select('id'))
      .update({ lane_id: lane.id });
  }

  // Every cue now has a lane → enforce it.
  await knex.schema.alterTable('cues', (t) => {
    t.uuid('lane_id').notNullable().alter();
  });
}

export async function down(knex) {
  await knex.schema.alterTable('cues', (t) => {
    t.dropIndex(['lane_id'], 'cues_lane_id_idx');
    t.dropColumn('lane_id');
  });
  await knex.schema.dropTableIfExists('cue_lanes');
  await knex.schema.dropTableIfExists('departments');
}
