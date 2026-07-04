/**
 * Users + passwordless magic-link auth.
 * password_hash is NULLABLE — magic-link users may never set a password.
 */
export async function up(knex) {
  await knex.schema.createTable('users', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.string('email', 255).notNullable().unique();
    t.string('display_name', 255).notNullable();
    t.string('password_hash', 255).nullable();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('magic_link_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.string('email', 255).notNullable();
    t.string('token_hash', 255).notNullable();
    t.string('redirect_to', 1000).nullable(); // e.g. a pending invite path
    t.timestamp('expires_at').notNullable();
    t.timestamp('consumed_at').nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index('email');
    t.index('token_hash');
    t.index('expires_at');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('magic_link_tokens');
  await knex.schema.dropTableIfExists('users');
}
