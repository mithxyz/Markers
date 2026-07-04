/**
 * Projects, membership (roles), per-project settings, and share-invite tokens.
 */
export async function up(knex) {
  await knex.schema.createTable('projects', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.string('name', 255).notNullable();
    t.text('description').notNullable().defaultTo('');
    t.uuid('owner_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.timestamps(true, true);
    t.index('owner_id');
  });

  await knex.schema.createTable('project_members', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.enu('role', ['owner', 'editor', 'viewer'], {
      useNative: true,
      enumName: 'member_role',
    }).notNullable().defaultTo('viewer');
    t.timestamp('invited_at').defaultTo(knex.fn.now());
    t.timestamp('accepted_at').nullable();
    t.timestamps(true, true);
    t.unique(['project_id', 'user_id']);
    t.index('user_id'); // "list my projects"
  });

  await knex.schema.createTable('project_settings', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('project_id').notNullable().unique().references('id').inTable('projects').onDelete('CASCADE');
    t.jsonb('settings').notNullable().defaultTo('{}');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('invite_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.string('token', 64).notNullable().unique();
    t.string('email', 255).nullable(); // optional: bind invite to a specific address
    t.enu('role', ['editor', 'viewer'], {
      useNative: true,
      enumName: 'invite_role',
    }).notNullable().defaultTo('viewer');
    t.timestamp('expires_at').notNullable();
    t.uuid('used_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('used_at').nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index('token');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('invite_tokens');
  await knex.schema.dropTableIfExists('project_settings');
  await knex.schema.dropTableIfExists('project_members');
  await knex.schema.dropTableIfExists('projects');
  await knex.raw('DROP TYPE IF EXISTS member_role');
  await knex.raw('DROP TYPE IF EXISTS invite_role');
}
