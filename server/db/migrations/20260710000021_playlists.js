/**
 * Named playlists (setlists) — each project can have multiple ordered lists of tracks.
 * A track may appear in several playlists (no unique constraint on track_id alone).
 * Cascade: deleting a project drops playlists + their rows; deleting a track removes
 * its playlist entries silently (gaps in sort_order are benign, renormalized on reorder).
 */
export async function up(knex) {
  await knex.schema.createTable('playlists', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.string('name', 255).notNullable().defaultTo('Setlist');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['project_id', 'sort_order']);
  });

  await knex.schema.createTable('playlist_tracks', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('playlist_id').notNullable().references('id').inTable('playlists').onDelete('CASCADE');
    t.uuid('track_id').notNullable().references('id').inTable('tracks').onDelete('CASCADE');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.unique(['playlist_id', 'track_id']);
    t.index(['playlist_id', 'sort_order']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('playlist_tracks');
  await knex.schema.dropTableIfExists('playlists');
}
