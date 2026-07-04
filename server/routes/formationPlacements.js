import { Router } from 'express';
import { knex } from '../db/knex.js';
import { asyncHandler, badRequest, notFound, forbidden } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { loadMembership, requireCapability } from '../middleware/membership.js';
import { emitToProject } from '../lib/realtime.js';
import { currentVersionBpm, timeToBeat, beatToTime } from '../lib/beats.js';

/**
 * Phase 8b — Formation placements (track-scoped). Each placement anchors a
 * reusable formation definition onto a track timeline, carrying its own start time
 * (beat/time) and optional hold range (end_time/end_beat).
 *
 * Auth mirrors markers.js: create = create_cues; edit/delete = author OR
 * edit_others_cues / delete_others_cues. Beat↔time reconciled on write.
 * Broadcasts formation:placement:* events.
 */
export const formationPlacementsRouter = Router({ mergeParams: true });
formationPlacementsRouter.use(requireAuth, loadMembership);

async function trackInProject(trackId, projectId) {
  return knex('tracks').where({ id: trackId, project_id: projectId }).first();
}

const isAuthorOf = (req, p) => req.isOwnerOrAdmin || p.created_by === req.session.userId;

function reconcile(fields, bpm) {
  if (fields.beat != null) {
    const t = beatToTime(fields.beat, bpm);
    if (t != null) fields.time = t;
  } else if (fields.time !== undefined) {
    fields.beat = timeToBeat(fields.time, bpm);
  }
  if (fields.end_beat === null || fields.end_time === null) {
    fields.end_beat = null;
    fields.end_time = null;
  } else if (fields.end_beat != null) {
    const t = beatToTime(fields.end_beat, bpm);
    if (t != null) fields.end_time = t;
  } else if (fields.end_time !== undefined) {
    fields.end_beat = timeToBeat(fields.end_time, bpm);
  }
}

/** GET /…/formation-placements */
formationPlacementsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const track = await trackInProject(req.params.trackId, req.project.id);
    if (!track) throw notFound('Track not found');
    const placements = await knex('formation_placements')
      .where({ track_id: track.id })
      .orderBy('time');
    res.json({ placements });
  })
);

/** POST /…/formation-placements (create_cues) */
formationPlacementsRouter.post(
  '/',
  requireCapability('create_cues'),
  asyncHandler(async (req, res) => {
    const track = await trackInProject(req.params.trackId, req.project.id);
    if (!track) throw notFound('Track not found');

    const formationId = String(req.body.formation_id || '').trim();
    if (!formationId) throw badRequest('formation_id is required');
    const def = await knex('formations').where({ id: formationId, project_id: req.project.id }).first();
    if (!def) throw notFound('Formation definition not found in this project');

    const fields = {};
    if (req.body.time !== undefined) fields.time = Number(req.body.time) || 0;
    if (req.body.beat != null) fields.beat = Number(req.body.beat);
    if (req.body.end_time !== undefined) fields.end_time = req.body.end_time === null ? null : Number(req.body.end_time);
    if (req.body.end_beat !== undefined) fields.end_beat = req.body.end_beat === null ? null : Number(req.body.end_beat);

    if (fields.time === undefined && fields.beat == null) throw badRequest('time or beat is required');
    reconcile(fields, await currentVersionBpm(track));
    if (fields.time === undefined) fields.time = 0;

    const [placement] = await knex('formation_placements')
      .insert({ track_id: track.id, formation_id: formationId, ...fields, created_by: req.session.userId })
      .returning('*');
    emitToProject(req, req.project.id, 'formation:placement:created', { placement, trackId: track.id, byUserId: req.session.userId });
    res.status(201).json({ placement });
  })
);

/** PATCH /…/formation-placements/:placementId */
formationPlacementsRouter.patch(
  '/:placementId',
  asyncHandler(async (req, res) => {
    const placement = await knex('formation_placements')
      .where({ id: req.params.placementId, track_id: req.params.trackId })
      .first();
    if (!placement) throw notFound('Placement not found');
    if (!isAuthorOf(req, placement) && !req.capabilities.has('edit_others_cues')) {
      throw forbidden('You cannot edit this placement');
    }

    const fields = {};
    if (req.body.time !== undefined) fields.time = Number(req.body.time) || 0;
    if (req.body.beat != null) fields.beat = Number(req.body.beat);
    if (req.body.end_time !== undefined) fields.end_time = req.body.end_time === null ? null : Number(req.body.end_time);
    if (req.body.end_beat !== undefined) fields.end_beat = req.body.end_beat === null ? null : Number(req.body.end_beat);
    if (!Object.keys(fields).length) throw badRequest('Nothing to update');

    const track = await trackInProject(req.params.trackId, req.project.id);
    reconcile(fields, await currentVersionBpm(track));

    const [updated] = await knex('formation_placements')
      .where({ id: placement.id })
      .update({ ...fields, updated_at: knex.fn.now() })
      .returning('*');
    emitToProject(req, req.project.id, 'formation:placement:updated', { placement: updated, trackId: placement.track_id, byUserId: req.session.userId });
    res.json({ placement: updated });
  })
);

/** DELETE /…/formation-placements/:placementId */
formationPlacementsRouter.delete(
  '/:placementId',
  asyncHandler(async (req, res) => {
    const placement = await knex('formation_placements')
      .where({ id: req.params.placementId, track_id: req.params.trackId })
      .first();
    if (!placement) throw notFound('Placement not found');
    if (!isAuthorOf(req, placement) && !req.capabilities.has('delete_others_cues')) {
      throw forbidden('You cannot delete this placement');
    }
    await knex('formation_placements').where({ id: placement.id }).del();
    emitToProject(req, req.project.id, 'formation:placement:deleted', {
      placementId: placement.id,
      trackId: placement.track_id,
      byUserId: req.session.userId,
    });
    res.json({ ok: true });
  })
);

export default formationPlacementsRouter;
