import { Router } from 'express';
import { knex } from '../db/knex.js';
import { asyncHandler, badRequest, notFound } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { loadMembership, requireCapability } from '../middleware/membership.js';
import { emitToProject } from '../lib/realtime.js';

/**
 * Phase 8b — Reusable formation definition library (project-scoped).
 * Definitions carry a name + positions jsonb ([{dancer_id,x,y}]); they have no
 * timeline position of their own. They are placed on the timeline via
 * formation_placements (see formationPlacements.js).
 *
 * CRUD gated by manage_tracks (same as dancers — it's project setup).
 * Broadcasts formation:def:* events for realtime collaborator sync.
 */
export const formationsRouter = Router({ mergeParams: true });
formationsRouter.use(requireAuth, loadMembership);

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n)));

/** Validate + coerce a positions array: [{dancer_id, x, y}] with x,y in [0,1]. */
function cleanPositions(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  for (const p of input) {
    if (!p || typeof p.dancer_id !== 'string') continue;
    const x = clamp01(p.x);
    const y = clamp01(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({ dancer_id: p.dancer_id, x, y });
  }
  return out;
}

/** GET /projects/:id/formations — ordered by creation time */
formationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const formations = await knex('formations')
      .where({ project_id: req.project.id })
      .orderBy('created_at');
    res.json({ formations });
  })
);

/** POST /projects/:id/formations (manage_tracks) */
formationsRouter.post(
  '/',
  requireCapability('manage_tracks'),
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || 'Formation').trim().slice(0, 255);
    const rawPos = req.body.positions;
    const positions = rawPos !== undefined ? (cleanPositions(rawPos) ?? []) : [];
    const [formation] = await knex('formations')
      .insert({
        project_id: req.project.id,
        name,
        positions: JSON.stringify(positions),
        created_by: req.session.userId,
      })
      .returning('*');
    emitToProject(req, req.project.id, 'formation:def:created', { formation, byUserId: req.session.userId });
    res.status(201).json({ formation });
  })
);

/** PATCH /projects/:id/formations/:formationId (manage_tracks) */
formationsRouter.patch(
  '/:formationId',
  requireCapability('manage_tracks'),
  asyncHandler(async (req, res) => {
    const formation = await knex('formations')
      .where({ id: req.params.formationId, project_id: req.project.id })
      .first();
    if (!formation) throw notFound('Formation not found');
    const patch = {};
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim().slice(0, 255);
      if (!name) throw badRequest('Name cannot be empty');
      patch.name = name;
    }
    if (req.body.positions !== undefined) {
      const p = cleanPositions(req.body.positions);
      if (p) patch.positions = JSON.stringify(p);
    }
    if (!Object.keys(patch).length) throw badRequest('Nothing to update');
    patch.updated_at = knex.fn.now();
    const [updated] = await knex('formations').where({ id: formation.id }).update(patch).returning('*');
    emitToProject(req, req.project.id, 'formation:def:updated', { formation: updated, byUserId: req.session.userId });
    res.json({ formation: updated });
  })
);

/** DELETE /projects/:id/formations/:formationId (manage_tracks) */
formationsRouter.delete(
  '/:formationId',
  requireCapability('manage_tracks'),
  asyncHandler(async (req, res) => {
    const formation = await knex('formations')
      .where({ id: req.params.formationId, project_id: req.project.id })
      .first();
    if (!formation) throw notFound('Formation not found');
    // Cascade: formation_placements.formation_id ON DELETE CASCADE removes placements.
    await knex('formations').where({ id: formation.id }).del();
    emitToProject(req, req.project.id, 'formation:def:deleted', { formationId: formation.id, byUserId: req.session.userId });
    res.json({ ok: true });
  })
);

export default formationsRouter;
