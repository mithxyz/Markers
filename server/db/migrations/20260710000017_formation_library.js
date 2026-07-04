/**
 * Phase 8b — Formation re-architecture: decouple reusable named definitions
 * (project-scoped) from track-scoped placements that reference them. One definition
 * can be placed multiple times on a track (or on different tracks in the same project).
 *
 * Up:
 *   1. Create `formations` — project-scoped definition library (positions + name)
 *   2. Create `formation_placements` — track-scoped timeline entries + hold range,
 *      each referencing a `formations` row via FK
 *   3. Migrate existing `dance_formations` rows — each becomes one def + one placement
 *   4. Drop `dance_formations`
 *
 * Down:
 *   Reconstructs `dance_formations` from placements joined with their defs, then drops
 *   the two new tables. A def placed N times becomes N rows on rollback (same shape as
 *   the old table, so the rollback is lossless in structure).
 */

export async function up(knex) {
  // 1. Project-scoped formation definitions
  await knex.schema.createTable('formations', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.string('name', 255).notNullable().defaultTo('Formation');
    t.jsonb('positions').notNullable().defaultTo('[]');
    t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['project_id'], 'formations_project_idx');
  });

  // 2. Track-scoped placements
  await knex.schema.createTable('formation_placements', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('track_id').notNullable().references('id').inTable('tracks').onDelete('CASCADE');
    t.uuid('formation_id').notNullable().references('id').inTable('formations').onDelete('CASCADE');
    t.float('time').notNullable().defaultTo(0);
    t.float('beat').nullable();
    t.float('end_time').nullable();
    t.float('end_beat').nullable();
    t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['track_id', 'time'], 'formation_placements_track_time_idx');
  });

  // 3. Migrate existing dance_formations → definitions + placements
  const oldRows = await knex('dance_formations')
    .join('tracks', 'tracks.id', 'dance_formations.track_id')
    .select(
      'dance_formations.track_id',
      'tracks.project_id',
      'dance_formations.time',
      'dance_formations.beat',
      knex.raw('dance_formations.end_time'),
      knex.raw('dance_formations.end_beat'),
      'dance_formations.name',
      'dance_formations.positions',
      'dance_formations.created_by',
      'dance_formations.created_at',
      'dance_formations.updated_at',
    );

  for (const row of oldRows) {
    // positions is returned by knex as a parsed JS array (jsonb); pg expects either
    // a JS object/array or a JSON string — stringify to be safe.
    const posStr = typeof row.positions === 'string' ? row.positions : JSON.stringify(row.positions ?? []);
    const [def] = await knex('formations')
      .insert({
        project_id: row.project_id,
        name: row.name,
        positions: posStr,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })
      .returning('id');
    await knex('formation_placements').insert({
      track_id: row.track_id,
      formation_id: def.id,
      time: row.time,
      beat: row.beat,
      end_time: row.end_time ?? null,
      end_beat: row.end_beat ?? null,
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  }

  // 4. Drop old table
  await knex.schema.dropTableIfExists('dance_formations');
}

export async function down(knex) {
  // Recreate the original dance_formations schema (same shape as migrations 10 + 12)
  await knex.schema.createTable('dance_formations', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('track_id').notNullable().references('id').inTable('tracks').onDelete('CASCADE');
    t.float('time').notNullable().defaultTo(0);
    t.float('beat').nullable();
    t.string('name', 255).notNullable().defaultTo('Formation');
    t.jsonb('positions').notNullable().defaultTo('[]');
    t.float('end_time').nullable();
    t.float('end_beat').nullable();
    t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['track_id', 'time'], 'dance_formations_track_time_idx');
  });

  // Reconstruct rows from placements + their defs
  const rows = await knex('formation_placements as fp')
    .join('formations as f', 'f.id', 'fp.formation_id')
    .select(
      'fp.track_id',
      'fp.time',
      'fp.beat',
      'fp.end_time',
      'fp.end_beat',
      'fp.created_by',
      'fp.created_at',
      'fp.updated_at',
      'f.name',
      'f.positions',
    );

  for (const r of rows) {
    await knex('dance_formations').insert({
      track_id: r.track_id,
      time: r.time,
      beat: r.beat,
      end_time: r.end_time,
      end_beat: r.end_beat,
      name: r.name,
      positions: typeof r.positions === 'string' ? r.positions : JSON.stringify(r.positions ?? []),
      created_by: r.created_by,
      created_at: r.created_at,
      updated_at: r.updated_at,
    });
  }

  await knex.schema.dropTableIfExists('formation_placements');
  await knex.schema.dropTableIfExists('formations');
}
