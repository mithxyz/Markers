/**
 * Phase 5d — department-scoped permissions. A role can be restricted to specific
 * departments (view/edit). ADDITIVE + backward-compatible: a role with NO rows
 * here is UNRESTRICTED (sees/edits every department, exactly like today). Only
 * roles that get explicit rows become scoped. Owner/admin are always unrestricted.
 */
export async function up(knex) {
  await knex.schema.createTable('project_role_departments', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('role_id').notNullable().references('id').inTable('project_roles').onDelete('CASCADE');
    t.uuid('department_id').notNullable().references('id').inTable('departments').onDelete('CASCADE');
    t.boolean('can_view').notNullable().defaultTo(true);
    t.boolean('can_edit').notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.unique(['role_id', 'department_id']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('project_role_departments');
}
