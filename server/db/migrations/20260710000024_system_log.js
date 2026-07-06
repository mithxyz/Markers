/**
 * H1-C: system_log — system-scoped event log for worker/mail/backup failures.
 *
 * Complements activity_log (project-scoped, user-driven actions) with a place
 * to record failures that have no project_id: job failures, SMTP errors, backup
 * failures, etc.
 *
 * Values for `level`: 'error' | 'warn' | 'info'
 * Values for `source`: free string, e.g. 'worker' | 'mail' | 'backup'
 *
 * Plain strings (not PG enums) so down() needs no DROP TYPE.
 */
export async function up(knex) {
  await knex.schema.createTable('system_log', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('source', 64).notNullable();
    t.string('level', 16).notNullable().defaultTo('info');
    t.text('message').notNullable();
    t.jsonb('meta').notNullable().defaultTo('{}');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.raw(
    'CREATE INDEX system_log_source_created_at ON system_log (source, created_at DESC)'
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('system_log');
}
