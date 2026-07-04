/**
 * Phase 3b — crew assignments (HANDOVER v2 §7.4). Maps members to departments so
 * the UI can offer a "my cues" focus filter (and, later, @-mentions). Cheap now
 * that departments exist. Does NOT gate access — it's a focus/filter aid, not a
 * permission (department-scoped permissions remain a separate follow-up).
 */
export async function up(knex) {
  await knex.schema.createTable('department_assignments', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('department_id').notNullable().references('id').inTable('departments').onDelete('CASCADE');
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.unique(['project_id', 'user_id', 'department_id']);
    t.index(['project_id'], 'dept_assign_project_idx');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('department_assignments');
}
