import { Router } from 'express';
import { knex } from '../db/knex.js';
import { asyncHandler, badRequest, notFound, conflict } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { loadMembership, requireCapability } from '../middleware/membership.js';
import { emitToProject } from '../lib/realtime.js';

export const playlistsRouter = Router({ mergeParams: true });
playlistsRouter.use(requireAuth, loadMembership);

/** Validate that a playlist belongs to the current project. */
async function getPlaylist(projectId, playlistId) {
  const pl = await knex('playlists').where({ id: playlistId, project_id: projectId }).first();
  if (!pl) throw notFound('Playlist not found');
  return pl;
}

/** GET /projects/:id/playlists — all playlists with their ordered track refs. */
playlistsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const playlists = await knex('playlists')
      .where({ project_id: req.project.id })
      .orderBy('sort_order')
      .select('*');

    // Attach ordered track refs for each playlist
    const allRows = playlists.length
      ? await knex('playlist_tracks')
          .whereIn('playlist_id', playlists.map((p) => p.id))
          .orderBy('sort_order')
          .select('*')
      : [];

    const rowsByPlaylist = new Map();
    for (const r of allRows) {
      if (!rowsByPlaylist.has(r.playlist_id)) rowsByPlaylist.set(r.playlist_id, []);
      rowsByPlaylist.get(r.playlist_id).push(r);
    }

    const result = playlists.map((pl) => ({
      ...pl,
      tracks: rowsByPlaylist.get(pl.id) ?? [],
    }));

    res.json({ playlists: result });
  })
);

/** POST /projects/:id/playlists — create a playlist. */
playlistsRouter.post(
  '/',
  requireCapability('manage_tracks'),
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || 'Setlist').trim().slice(0, 255) || 'Setlist';
    const [maxRow] = await knex('playlists').where({ project_id: req.project.id }).max('sort_order as m');
    const sort_order = (maxRow?.m ?? -1) + 1;

    const [playlist] = await knex('playlists')
      .insert({ project_id: req.project.id, name, sort_order, created_by: req.session?.userId })
      .returning('*');

    emitToProject(req, req.project.id, 'playlist:created', { playlist: { ...playlist, tracks: [] }, byUserId: req.session?.userId });
    res.status(201).json({ playlist: { ...playlist, tracks: [] } });
  })
);

/** PATCH /projects/:id/playlists/:playlistId — rename or reorder. */
playlistsRouter.patch(
  '/:playlistId',
  requireCapability('manage_tracks'),
  asyncHandler(async (req, res) => {
    const pl = await getPlaylist(req.project.id, req.params.playlistId);
    const patch = {};
    if (req.body.name !== undefined) patch.name = String(req.body.name).trim().slice(0, 255) || pl.name;
    if (req.body.sort_order !== undefined) patch.sort_order = parseInt(req.body.sort_order, 10) || 0;
    if (!Object.keys(patch).length) throw badRequest('Nothing to update');
    patch.updated_at = knex.fn.now();

    const [updated] = await knex('playlists').where({ id: pl.id }).update(patch).returning('*');
    emitToProject(req, req.project.id, 'playlist:updated', { playlist: updated, byUserId: req.session?.userId });
    res.json({ playlist: updated });
  })
);

/** DELETE /projects/:id/playlists/:playlistId */
playlistsRouter.delete(
  '/:playlistId',
  requireCapability('manage_tracks'),
  asyncHandler(async (req, res) => {
    const pl = await getPlaylist(req.project.id, req.params.playlistId);
    await knex('playlists').where({ id: pl.id }).delete();
    emitToProject(req, req.project.id, 'playlist:deleted', { playlistId: pl.id, byUserId: req.session?.userId });
    res.json({ ok: true });
  })
);

/** POST /projects/:id/playlists/:playlistId/tracks — add a track. */
playlistsRouter.post(
  '/:playlistId/tracks',
  requireCapability('manage_tracks'),
  asyncHandler(async (req, res) => {
    const pl = await getPlaylist(req.project.id, req.params.playlistId);
    const { track_id } = req.body;
    if (!track_id) throw badRequest('track_id required');

    // Validate the track belongs to this project
    const track = await knex('tracks').where({ id: track_id, project_id: req.project.id }).first();
    if (!track) throw notFound('Track not found');

    const [maxRow] = await knex('playlist_tracks').where({ playlist_id: pl.id }).max('sort_order as m');
    const sort_order = (maxRow?.m ?? -1) + 1;

    let row;
    try {
      [row] = await knex('playlist_tracks')
        .insert({ playlist_id: pl.id, track_id, sort_order })
        .returning('*');
    } catch (e) {
      if (e.code === '23505') throw conflict('Track already in playlist');
      throw e;
    }

    emitToProject(req, req.project.id, 'playlist:tracks:changed', { playlistId: pl.id, byUserId: req.session?.userId });
    res.status(201).json({ row });
  })
);

/** DELETE /projects/:id/playlists/:playlistId/tracks/:trackId */
playlistsRouter.delete(
  '/:playlistId/tracks/:trackId',
  requireCapability('manage_tracks'),
  asyncHandler(async (req, res) => {
    const pl = await getPlaylist(req.project.id, req.params.playlistId);
    const deleted = await knex('playlist_tracks')
      .where({ playlist_id: pl.id, track_id: req.params.trackId })
      .delete();
    if (!deleted) throw notFound('Track not in playlist');
    emitToProject(req, req.project.id, 'playlist:tracks:changed', { playlistId: pl.id, byUserId: req.session?.userId });
    res.json({ ok: true });
  })
);

/** POST /projects/:id/playlists/:playlistId/reorder — bulk reorder tracks within a playlist. */
playlistsRouter.post(
  '/:playlistId/reorder',
  requireCapability('manage_tracks'),
  asyncHandler(async (req, res) => {
    const pl = await getPlaylist(req.project.id, req.params.playlistId);
    const { order } = req.body; // array of track_ids
    if (!Array.isArray(order) || order.length === 0) throw badRequest('order must be a non-empty array of track ids');

    // Validate all track_ids exist in this playlist
    const existing = await knex('playlist_tracks')
      .where({ playlist_id: pl.id })
      .whereIn('track_id', order)
      .select('track_id');
    if (existing.length !== order.length) throw badRequest('One or more track ids not in this playlist');

    await knex.transaction(async (trx) => {
      for (let i = 0; i < order.length; i++) {
        await trx('playlist_tracks')
          .where({ playlist_id: pl.id, track_id: order[i] })
          .update({ sort_order: i, updated_at: knex.fn.now() });
      }
    });

    emitToProject(req, req.project.id, 'playlist:tracks:changed', { playlistId: pl.id, byUserId: req.session?.userId });
    res.json({ ok: true });
  })
);
