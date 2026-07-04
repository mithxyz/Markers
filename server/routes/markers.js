import { Router } from 'express';
import { knex } from '../db/knex.js';
import { asyncHandler, badRequest, notFound, forbidden } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { loadMembership, requireCapability } from '../middleware/membership.js';
import { emitToProject } from '../lib/realtime.js';
import { currentVersionBpm, timeToBeat, beatToTime } from '../lib/beats.js';

/**
 * Markers (Phase 2c) — point-in-time, project-visible labels attributed to their
 * creator, separate from cues. No visibility model (always project-shared); beat
 * positioned like cues. Create needs `create_cues`; edit/delete need authorship
 * or the matching others-cue capability (markers ride the cue permission set).
 */
export const markersRouter = Router({ mergeParams: true });
markersRouter.use(requireAuth, loadMembership);

async function trackInProject(trackId, projectId) {
  return knex('tracks').where({ id: trackId, project_id: projectId }).first();
}

const isAuthorOf = (req, m) => req.isOwnerOrAdmin || m.created_by === req.session.userId;

function pickMarkerFields(body) {
  const out = {};
  if (body.name !== undefined) out.name = String(body.name).slice(0, 255);
  if (body.color !== undefined) out.color = String(body.color).slice(0, 9);
  if (body.time !== undefined) out.time = Number(body.time) || 0;
  if (body.beat !== undefined && body.beat !== null) out.beat = Number(body.beat);
  return out;
}

/** Keep beat/time in sync from the track BPM (mirrors cue reconcile, single coord). */
function reconcile(fields, bpm) {
  if (fields.beat != null) {
    const t = beatToTime(fields.beat, bpm);
    if (t != null) fields.time = t;
  } else if (fields.time !== undefined) {
    fields.beat = timeToBeat(fields.time, bpm);
  }
}

/** GET /…/markers */
markersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const track = await trackInProject(req.params.trackId, req.project.id);
    if (!track) throw notFound('Track not found');
    const markers = await knex('markers').where({ track_id: track.id }).orderBy('time');
    res.json({ markers });
  })
);

/** POST /…/markers (create_cues) */
markersRouter.post(
  '/',
  requireCapability('create_cues'),
  asyncHandler(async (req, res) => {
    const track = await trackInProject(req.params.trackId, req.project.id);
    if (!track) throw notFound('Track not found');

    const fields = pickMarkerFields(req.body);
    if (fields.time === undefined && fields.beat == null) throw badRequest('time or beat is required');
    reconcile(fields, await currentVersionBpm(track));
    if (fields.time === undefined) fields.time = 0;

    const [marker] = await knex('markers')
      .insert({ track_id: track.id, name: fields.name ?? 'Marker', ...fields, created_by: req.session.userId })
      .returning('*');
    emitToProject(req, req.project.id, 'marker:created', { marker, byUserId: req.session.userId });
    res.status(201).json({ marker });
  })
);

/** PATCH /…/markers/:markerId */
markersRouter.patch(
  '/:markerId',
  asyncHandler(async (req, res) => {
    if (!(await trackInProject(req.params.trackId, req.project.id))) throw notFound('Track not found');
    const marker = await knex('markers').where({ id: req.params.markerId, track_id: req.params.trackId }).first();
    if (!marker) throw notFound('Marker not found');
    if (!isAuthorOf(req, marker) && !req.capabilities.has('edit_others_cues')) throw forbidden('You cannot edit this marker');

    const fields = pickMarkerFields(req.body);
    if (!Object.keys(fields).length) throw badRequest('Nothing to update');
    if (fields.time !== undefined || fields.beat !== undefined) reconcile(fields, await currentVersionBpm(req.params.trackId));

    const [updated] = await knex('markers')
      .where({ id: marker.id })
      .update({ ...fields, updated_at: knex.fn.now() })
      .returning('*');
    emitToProject(req, req.project.id, 'marker:updated', { marker: updated, byUserId: req.session.userId });
    res.json({ marker: updated });
  })
);

/** DELETE /…/markers/:markerId */
markersRouter.delete(
  '/:markerId',
  asyncHandler(async (req, res) => {
    if (!(await trackInProject(req.params.trackId, req.project.id))) throw notFound('Track not found');
    const marker = await knex('markers').where({ id: req.params.markerId, track_id: req.params.trackId }).first();
    if (!marker) throw notFound('Marker not found');
    if (!isAuthorOf(req, marker) && !req.capabilities.has('delete_others_cues')) throw forbidden('You cannot delete this marker');

    await knex('markers').where({ id: marker.id }).del();
    emitToProject(req, req.project.id, 'marker:deleted', { markerId: marker.id, trackId: marker.track_id, byUserId: req.session.userId });
    res.json({ ok: true });
  })
);

export default markersRouter;
