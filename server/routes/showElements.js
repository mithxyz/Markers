import { Router } from 'express';
import { knex } from '../db/knex.js';
import { asyncHandler, badRequest, notFound, forbidden } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { loadMembership, requireCapability } from '../middleware/membership.js';
import { emitToProject } from '../lib/realtime.js';
import { currentVersionBpm, timeToBeat, beatToTime } from '../lib/beats.js';

const VALID_TYPES = new Set([
  'pyro', 'laser', 'co2', 'flames', 'confetti',
  'lighting', 'haze', 'video', 'lyrics', 'spotlight', 'fx',
]);

export const showElementsRouter = Router({ mergeParams: true });
showElementsRouter.use(requireAuth, loadMembership);

async function trackInProject(trackId, projectId) {
  return knex('tracks').where({ id: trackId, project_id: projectId }).first();
}

const isAuthorOf = (req, el) => req.isOwnerOrAdmin || el.created_by === req.session.userId;

function pick(body) {
  const out = {};
  if (body.type !== undefined) {
    if (!VALID_TYPES.has(body.type)) throw badRequest('Invalid element type');
    out.type = body.type;
  }
  if (body.time !== undefined) out.time = Number(body.time) || 0;
  if (body.end_time !== undefined) out.end_time = body.end_time != null ? Number(body.end_time) : null;
  if (body.beat !== undefined) out.beat = body.beat != null ? Number(body.beat) : null;
  if (body.end_beat !== undefined) out.end_beat = body.end_beat != null ? Number(body.end_beat) : null;
  if (body.name !== undefined) out.name = body.name != null ? String(body.name).slice(0, 255) : null;
  if (body.note !== undefined) out.note = body.note != null ? String(body.note) : null;
  if (body.intensity !== undefined) {
    out.intensity = body.intensity != null ? Math.min(100, Math.max(0, Math.round(Number(body.intensity)))) : null;
  }
  return out;
}

async function reconcile(fields, trackId) {
  const bpm = await currentVersionBpm(trackId);
  if (fields.beat != null) {
    const t = beatToTime(fields.beat, bpm);
    if (t != null) fields.time = t;
  } else if (fields.time !== undefined) {
    fields.beat = timeToBeat(fields.time, bpm);
  }
  if (fields.end_beat != null) {
    const t = beatToTime(fields.end_beat, bpm);
    if (t != null) fields.end_time = t;
  } else if (fields.end_time !== undefined && fields.end_time != null) {
    fields.end_beat = timeToBeat(fields.end_time, bpm);
  }
}

/** GET /…/show-elements */
showElementsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const track = await trackInProject(req.params.trackId, req.project.id);
    if (!track) throw notFound('Track not found');
    const elements = await knex('show_elements').where({ track_id: track.id }).orderBy('time');
    res.json({ elements });
  })
);

/** POST /…/show-elements (create_cues) */
showElementsRouter.post(
  '/',
  requireCapability('create_cues'),
  asyncHandler(async (req, res) => {
    const track = await trackInProject(req.params.trackId, req.project.id);
    if (!track) throw notFound('Track not found');

    const fields = pick(req.body);
    if (!fields.type) throw badRequest('type is required');
    if (fields.time === undefined && fields.beat == null) throw badRequest('time or beat is required');
    await reconcile(fields, track.id);
    if (fields.time === undefined) fields.time = 0;

    const [element] = await knex('show_elements')
      .insert({ track_id: track.id, ...fields, created_by: req.session.userId })
      .returning('*');
    emitToProject(req, req.project.id, 'show_element:created', { element, byUserId: req.session.userId });
    res.status(201).json({ element });
  })
);

/** PATCH /…/show-elements/:elementId */
showElementsRouter.patch(
  '/:elementId',
  asyncHandler(async (req, res) => {
    if (!(await trackInProject(req.params.trackId, req.project.id))) throw notFound('Track not found');
    const element = await knex('show_elements').where({ id: req.params.elementId, track_id: req.params.trackId }).first();
    if (!element) throw notFound('Element not found');
    if (!isAuthorOf(req, element) && !req.capabilities.has('edit_others_cues')) throw forbidden('You cannot edit this element');

    const fields = pick(req.body);
    if (!Object.keys(fields).length) throw badRequest('Nothing to update');
    if (fields.time !== undefined || fields.beat !== undefined || fields.end_time !== undefined || fields.end_beat !== undefined) {
      await reconcile(fields, req.params.trackId);
    }

    const [updated] = await knex('show_elements')
      .where({ id: element.id })
      .update({ ...fields, updated_at: knex.fn.now() })
      .returning('*');
    emitToProject(req, req.project.id, 'show_element:updated', { element: updated, byUserId: req.session.userId });
    res.json({ element: updated });
  })
);

/** DELETE /…/show-elements/:elementId */
showElementsRouter.delete(
  '/:elementId',
  asyncHandler(async (req, res) => {
    if (!(await trackInProject(req.params.trackId, req.project.id))) throw notFound('Track not found');
    const element = await knex('show_elements').where({ id: req.params.elementId, track_id: req.params.trackId }).first();
    if (!element) throw notFound('Element not found');
    if (!isAuthorOf(req, element) && !req.capabilities.has('delete_others_cues')) throw forbidden('You cannot delete this element');

    await knex('show_elements').where({ id: element.id }).del();
    emitToProject(req, req.project.id, 'show_element:deleted', { elementId: element.id, trackId: element.track_id, byUserId: req.session.userId });
    res.json({ ok: true });
  })
);

export default showElementsRouter;
