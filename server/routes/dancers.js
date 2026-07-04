import { Router } from 'express';
import { knex } from '../db/knex.js';
import { asyncHandler, badRequest, notFound } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { loadMembership, requireCapability } from '../middleware/membership.js';
import { presignPut, presignGet, headObject } from '../services/s3.js';
import { keys, safeExt } from '../lib/keys.js';

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Dancer roster (Phase 3c) — the project's cast. CRUD gated by `manage_tracks`
 * (project setup); reads open to any member. Mirrors the departments router.
 */
export const dancersRouter = Router({ mergeParams: true });
dancersRouter.use(requireAuth, loadMembership);

/** GET /projects/:id/dancers */
dancersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const dancers = await knex('dancers').where({ project_id: req.project.id }).orderBy('sort_order').orderBy('created_at');
    res.json({ dancers });
  })
);

/** POST /projects/:id/dancers (manage_tracks) */
dancersRouter.post(
  '/',
  requireCapability('manage_tracks'),
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 120);
    if (!name) throw badRequest('Dancer name required');
    const color = String(req.body.color || '#22d3ee').slice(0, 9);
    const label = String(req.body.label || '').slice(0, 3);
    const max = await knex('dancers').where({ project_id: req.project.id }).max('sort_order as m').first();
    const [dancer] = await knex('dancers')
      .insert({ project_id: req.project.id, name, color, label, sort_order: (max?.m ?? -1) + 1 })
      .returning('*');
    res.status(201).json({ dancer });
  })
);

/** PATCH /projects/:id/dancers/:dancerId (manage_tracks) */
dancersRouter.patch(
  '/:dancerId',
  requireCapability('manage_tracks'),
  asyncHandler(async (req, res) => {
    const dancer = await knex('dancers').where({ id: req.params.dancerId, project_id: req.project.id }).first();
    if (!dancer) throw notFound('Dancer not found');
    const patch = {};
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim().slice(0, 120);
      if (!name) throw badRequest('Name cannot be empty');
      patch.name = name;
    }
    if (req.body.color !== undefined) patch.color = String(req.body.color).slice(0, 9);
    if (req.body.label !== undefined) patch.label = String(req.body.label).slice(0, 3); // Phase 8d: max 3-char token
    if (req.body.sort_order !== undefined) patch.sort_order = Number(req.body.sort_order) || 0;
    if (!Object.keys(patch).length) throw badRequest('Nothing to update');
    patch.updated_at = knex.fn.now();
    const [updated] = await knex('dancers').where({ id: dancer.id }).update(patch).returning('*');
    res.json({ dancer: updated });
  })
);

/** POST /projects/:id/dancers/:dancerId/image — presign a PUT for an avatar upload.
 *  Returns { uploadUrl, key } for the client to PUT the file directly to S3. */
dancersRouter.post(
  '/:dancerId/image',
  requireCapability('manage_tracks'),
  asyncHandler(async (req, res) => {
    const dancer = await knex('dancers').where({ id: req.params.dancerId, project_id: req.project.id }).first();
    if (!dancer) throw notFound('Dancer not found');
    const contentType = String(req.body.contentType || '');
    if (!IMAGE_MIMES.has(contentType)) throw badRequest('Unsupported image type');
    const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }[contentType];
    const key = keys.dancerImage(req.project.id, dancer.id, ext);
    const uploadUrl = await presignPut(key, contentType, IMAGE_MAX_BYTES);
    res.json({ uploadUrl, key });
  })
);

/** POST /projects/:id/dancers/:dancerId/image/complete — verify the upload and persist the key. */
dancersRouter.post(
  '/:dancerId/image/complete',
  requireCapability('manage_tracks'),
  asyncHandler(async (req, res) => {
    const dancer = await knex('dancers').where({ id: req.params.dancerId, project_id: req.project.id }).first();
    if (!dancer) throw notFound('Dancer not found');
    const key = String(req.body.key || '');
    if (!key.startsWith(`projects/${req.project.id}/dancers/${dancer.id}/image/`))
      throw badRequest('Invalid key');
    await headObject(key); // throws if not found in S3
    const [updated] = await knex('dancers').where({ id: dancer.id }).update({ image_s3_key: key, updated_at: knex.fn.now() }).returning('*');
    const imageUrl = await presignGet(key);
    res.json({ dancer: updated, imageUrl });
  })
);

/** DELETE /projects/:id/dancers/:dancerId/image — remove the avatar. */
dancersRouter.delete(
  '/:dancerId/image',
  requireCapability('manage_tracks'),
  asyncHandler(async (req, res) => {
    const dancer = await knex('dancers').where({ id: req.params.dancerId, project_id: req.project.id }).first();
    if (!dancer) throw notFound('Dancer not found');
    await knex('dancers').where({ id: dancer.id }).update({ image_s3_key: null, updated_at: knex.fn.now() });
    res.json({ ok: true });
  })
);

/** DELETE /projects/:id/dancers/:dancerId (manage_tracks). */
dancersRouter.delete(
  '/:dancerId',
  requireCapability('manage_tracks'),
  asyncHandler(async (req, res) => {
    const dancer = await knex('dancers').where({ id: req.params.dancerId, project_id: req.project.id }).first();
    if (!dancer) throw notFound('Dancer not found');
    await knex('dancers').where({ id: dancer.id }).del();
    // Formations keep their positions array as-is; a removed dancer's entries are
    // simply ignored client-side (filtered against the live roster).
    res.json({ ok: true });
  })
);

export default dancersRouter;
