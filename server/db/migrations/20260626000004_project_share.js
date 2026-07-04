/**
 * Anonymous public share links. One token per project (rotatable); when enabled,
 * an unauthenticated reader can see the project's non-private, anon-visible cues
 * read-only via /api/v1/public/:token.
 */
export async function up(knex) {
  await knex.schema.createTable('project_share_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('project_id').notNullable().unique().references('id').inTable('projects').onDelete('CASCADE');
    t.string('token', 64).notNullable().unique();
    t.boolean('enabled').notNullable().defaultTo(true);
    t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('revoked_at').nullable();
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('project_share_tokens');
}
