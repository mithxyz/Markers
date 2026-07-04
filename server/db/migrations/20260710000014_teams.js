/**
 * Phase 6 — teams / organization layer. A team owns projects and has members;
 * team members can access the team's projects. ADDITIVE + opt-in: existing
 * projects keep `team_id` NULL ("personal", owner + project_members only, exactly
 * as today). Teams never remove access — being a team member only GRANTS it.
 */
export async function up(knex) {
  await knex.schema.createTable('teams', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.string('name', 255).notNullable();
    t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('team_members', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('team_id').notNullable().references('id').inTable('teams').onDelete('CASCADE');
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.enu('role', ['owner', 'member']).notNullable().defaultTo('member');
    t.timestamps(true, true);
    t.unique(['team_id', 'user_id']);
    t.index(['user_id'], 'team_members_user_idx');
  });

  await knex.schema.alterTable('projects', (t) => {
    t.uuid('team_id').nullable().references('id').inTable('teams').onDelete('SET NULL');
    t.index(['team_id'], 'projects_team_idx');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('projects', (t) => {
    t.dropIndex(['team_id'], 'projects_team_idx');
    t.dropColumn('team_id');
  });
  await knex.schema.dropTableIfExists('team_members');
  await knex.schema.dropTableIfExists('teams');
}
