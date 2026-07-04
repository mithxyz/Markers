/**
 * Phase 2c — per-cue production fields (HANDOVER v2 §6.2).
 *
 * - `status`: production workflow state (EdiTour's not_started → done).
 * - `deleted_at`: SOFT delete. All cue reads now filter `deleted_at IS NULL`; the
 *   DELETE route stamps this instead of removing the row, so cues are recoverable.
 * - `color_inherited`: when true, the UI renders the cue with its lane's department
 *   colour instead of `marker_color`. Column defaults to FALSE so existing cues keep
 *   their explicit colours; the create route opts NEW cues into inheritance.
 */
export async function up(knex) {
  await knex.schema.alterTable('cues', (t) => {
    t.enu('status', ['not_started', 'in_progress', 'done', 'blocked']).notNullable().defaultTo('not_started');
    t.timestamp('deleted_at', { useTz: true }).nullable();
    t.boolean('color_inherited').notNullable().defaultTo(false);
    t.index(['track_id', 'deleted_at'], 'cues_track_deleted_idx');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('cues', (t) => {
    t.dropIndex(['track_id', 'deleted_at'], 'cues_track_deleted_idx');
    t.dropColumn('status');
    t.dropColumn('deleted_at');
    t.dropColumn('color_inherited');
  });
}
