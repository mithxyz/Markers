/**
 * Shift from magic-link login to invite/admin-only password auth.
 *
 * - Generalize `magic_link_tokens` -> `auth_tokens` with a `purpose`
 *   ('set_password' | 'reset_password'). The magic-link login meaning is dropped;
 *   tokens now only ever let a user SET a password (and get a session in the process).
 * - Add `users.password_set_at` so we can track who has adopted a password
 *   (used by the backfill emailer and the eventual magic-link sunset).
 *
 * Existing magic-link rows are short-lived and now meaningless (the /auth/verify
 * login path is removed), so they're purged.
 */
export async function up(knex) {
  await knex.schema.renameTable('magic_link_tokens', 'auth_tokens');

  await knex.schema.alterTable('auth_tokens', (t) => {
    // App-validated string rather than a native PG enum — keeps future additions
    // (e.g. extra purposes) painless.
    t.string('purpose', 32).notNullable().defaultTo('set_password');
  });

  await knex.schema.alterTable('users', (t) => {
    t.timestamp('password_set_at').nullable();
  });

  // Stale magic-link tokens no longer have a consumer.
  await knex('auth_tokens').del();
}

export async function down(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('password_set_at');
  });
  await knex.schema.alterTable('auth_tokens', (t) => {
    t.dropColumn('purpose');
  });
  await knex.schema.renameTable('auth_tokens', 'magic_link_tokens');
}
