/**
 * Phase 4c — formation hold range. A formation is now fixed during [time, end_time]
 * and interpolates in the gaps between formations. `end_time`/`end_beat` are
 * nullable: a null end ⇒ a point (zero-hold) formation = the pre-4c behavior, so
 * existing rows are unchanged.
 */
export async function up(knex) {
  await knex.schema.alterTable('dance_formations', (t) => {
    t.float('end_time').nullable();
    t.float('end_beat').nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable('dance_formations', (t) => {
    t.dropColumn('end_time');
    t.dropColumn('end_beat');
  });
}
