import { Router } from 'express';
import crypto from 'node:crypto';
import { knex } from '../db/knex.js';
import { config } from '../config.js';
import { asyncHandler, badRequest } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { loadMembership, requireCapability } from '../middleware/membership.js';
import { systemRoleSeeds, ALL_CAPABILITIES } from '../lib/capabilities.js';
import { logActivity } from '../lib/activity.js';
import { listDepartments } from './departments.js';
import { buildExportModel, ADAPTERS } from '../services/export.js';
import { presignPut, presignGet, headObject } from '../services/s3.js';
import { keys, safeExt } from '../lib/keys.js';

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const PROJECT_TYPES = ['dj', 'dance', 'general'];

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

/** GET /projects — projects I belong to, with my role name. */
projectsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    // Projects I'm a member of, PLUS projects owned by teams I belong to (Phase 6).
    const teamIds = await knex('team_members').where({ user_id: req.session.userId }).pluck('team_id');
    const rows = await knex('projects as p')
      .leftJoin('project_members as m', function () {
        this.on('m.project_id', 'p.id').andOn('m.user_id', knex.raw('?', [req.session.userId]));
      })
      .leftJoin('project_roles as r', 'r.id', 'm.role_id')
      .where((b) => {
        b.whereNotNull('m.user_id');
        if (teamIds.length) b.orWhereIn('p.team_id', teamIds);
      })
      .select('p.*', 'r.name as role')
      .orderBy('p.updated_at', 'desc');
    res.json({ projects: rows });
  })
);

/** POST /projects { name, description } — seeds the project's system roles. */
projectsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 255);
    if (!name) throw badRequest('Project name required');
    const description = String(req.body.description || '').trim();
    const type = PROJECT_TYPES.includes(req.body.type) ? req.body.type : 'general';
    // Optional team ownership (Phase 6): the creator must belong to the team.
    const teamId = req.body.team_id || null;
    if (teamId) {
      const tm = await knex('team_members').where({ team_id: teamId, user_id: req.session.userId }).first();
      if (!tm) throw badRequest('You are not a member of that team');
    }

    const project = await knex.transaction(async (trx) => {
      const [p] = await trx('projects')
        .insert({ name, description, type, team_id: teamId, owner_id: req.session.userId })
        .returning('*');

      const roleId = {};
      for (const s of systemRoleSeeds()) {
        const [r] = await trx('project_roles')
          .insert({
            project_id: p.id,
            name: s.name,
            capabilities: JSON.stringify(s.capabilities),
            is_default: s.is_default,
            is_system: s.is_system,
            sort_order: s.sort_order,
          })
          .returning('id');
        roleId[s.name] = r.id;
      }

      await trx('project_members').insert({
        project_id: p.id,
        user_id: req.session.userId,
        role_id: roleId.owner,
        accepted_at: trx.fn.now(),
      });
      await trx('project_settings').insert({ project_id: p.id, settings: '{}' });

      // Seed a default department + lane so new cues always have a home (Phase 2b).
      const [dept] = await trx('departments')
        .insert({ project_id: p.id, name: 'Cues', color: '#6366f1', sort_order: 0 })
        .returning('id');
      await trx('cue_lanes').insert({ department_id: dept.id, name: 'Default', kind: 'cues', sort_order: 0 });
      return p;
    });

    await logActivity({
      projectId: project.id,
      userId: req.session.userId,
      entityType: 'project',
      entityId: project.id,
      action: 'create',
      next: { name },
    });

    res.status(201).json({ project: { ...project, role: 'owner', capabilities: ALL_CAPABILITIES } });
  })
);

/** GET /projects/:id — project + my capabilities + member list + roles. */
projectsRouter.get(
  '/:id',
  loadMembership,
  asyncHandler(async (req, res) => {
    const members = await knex('project_members as m')
      .join('users as u', 'u.id', 'm.user_id')
      .leftJoin('project_roles as r', 'r.id', 'm.role_id')
      .where('m.project_id', req.project.id)
      .select('u.id', 'u.email', 'u.display_name', 'm.role_id', 'r.name as role', 'm.accepted_at')
      .orderBy('r.sort_order');
    const roles = await knex('project_roles')
      .where({ project_id: req.project.id })
      .orderBy('sort_order')
      .select('id', 'name', 'capabilities', 'is_default', 'is_system', 'sort_order');
    const settings = await knex('project_settings').where({ project_id: req.project.id }).first();
    const departments = await listDepartments(req.project.id);
    const assignments = await knex('department_assignments')
      .where({ project_id: req.project.id })
      .select('user_id', 'department_id');
    const rawDancers = await knex('dancers').where({ project_id: req.project.id }).orderBy('sort_order').orderBy('created_at');
    // Phase 8d: presign per-dancer avatar URLs (short TTL, matching the project-cover pattern).
    const dancers = await Promise.all(
      rawDancers.map(async (d) => ({
        ...d,
        imageUrl: d.image_s3_key ? await presignGet(d.image_s3_key, 3600) : null,
      }))
    );
    const formations = await knex('formations').where({ project_id: req.project.id }).orderBy('created_at');
    const imageUrl = req.project.image_s3_key ? await presignGet(req.project.image_s3_key, 3600) : null;
    res.json({
      project: { ...req.project, role: req.memberRole, capabilities: [...req.capabilities] },
      members,
      roles,
      departments,
      assignments,
      dancers,
      formations,
      imageUrl,
      settings: settings?.settings || {},
    });
  })
);

/** PATCH /projects/:id (manage_project) */
projectsRouter.patch(
  '/:id',
  loadMembership,
  requireCapability('manage_project'),
  asyncHandler(async (req, res) => {
    const patch = {};
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim().slice(0, 255);
      if (!name) throw badRequest('Name cannot be empty');
      patch.name = name;
    }
    if (req.body.description !== undefined) patch.description = String(req.body.description).trim();
    if (req.body.type !== undefined) {
      if (!PROJECT_TYPES.includes(req.body.type)) throw badRequest('Invalid project type');
      patch.type = req.body.type;
    }
    if (!Object.keys(patch).length) throw badRequest('Nothing to update');
    patch.updated_at = knex.fn.now();

    const [project] = await knex('projects').where({ id: req.project.id }).update(patch).returning('*');
    res.json({ project: { ...project, role: req.memberRole, capabilities: [...req.capabilities] } });
  })
);

/** PATCH /projects/:id/settings (manage_project) — shallow-merge into the project
 *  settings jsonb (e.g. the dance `stage` config). */
projectsRouter.patch(
  '/:id/settings',
  loadMembership,
  requireCapability('manage_project'),
  asyncHandler(async (req, res) => {
    const patch = req.body && typeof req.body === 'object' ? req.body : {};
    const row = await knex('project_settings').where({ project_id: req.project.id }).first();
    const current = row?.settings || {};
    const next = { ...current, ...patch };
    if (row) {
      await knex('project_settings').where({ project_id: req.project.id }).update({ settings: JSON.stringify(next), updated_at: knex.fn.now() });
    } else {
      await knex('project_settings').insert({ project_id: req.project.id, settings: JSON.stringify(next) });
    }
    res.json({ settings: next });
  })
);

/** POST /projects/:id/image (manage_project) — presigned PUT for a cover image. */
projectsRouter.post(
  '/:id/image',
  loadMembership,
  requireCapability('manage_project'),
  asyncHandler(async (req, res) => {
    const mime = String(req.body.mime || '');
    if (!IMAGE_MIMES.includes(mime)) throw badRequest('Unsupported image type');
    const ext = safeExt(req.body.filename) || (mime === 'image/png' ? '.png' : '.jpg');
    const s3Key = keys.projectImage(req.project.id, ext);
    await knex('projects').where({ id: req.project.id }).update({ image_s3_key: s3Key, updated_at: knex.fn.now() });
    const uploadUrl = await presignPut(s3Key, mime, 3600);
    res.status(201).json({ uploadUrl, s3Key });
  })
);

/** POST /projects/:id/image/complete (manage_project) — verify upload, return URL. */
projectsRouter.post(
  '/:id/image/complete',
  loadMembership,
  requireCapability('manage_project'),
  asyncHandler(async (req, res) => {
    if (!req.project.image_s3_key) throw badRequest('No pending image');
    try {
      await headObject(req.project.image_s3_key);
    } catch {
      throw badRequest('Upload not found in storage');
    }
    const imageUrl = await presignGet(req.project.image_s3_key, 3600);
    res.json({ imageUrl });
  })
);

/** DELETE /projects/:id/image (manage_project) — remove the cover image. */
projectsRouter.delete(
  '/:id/image',
  loadMembership,
  requireCapability('manage_project'),
  asyncHandler(async (req, res) => {
    await knex('projects').where({ id: req.project.id }).update({ image_s3_key: null, updated_at: knex.fn.now() });
    res.json({ ok: true });
  })
);

/** DELETE /projects/:id (delete_project) */
projectsRouter.delete(
  '/:id',
  loadMembership,
  requireCapability('delete_project'),
  asyncHandler(async (req, res) => {
    await knex('projects').where({ id: req.project.id }).del();
    res.json({ ok: true });
  })
);

/**
 * GET /projects/:id/export?format=…&trackId=… — download cues/markers as a file
 * (Phase 2g). Any member may export what they can see; respects cue visibility +
 * soft-delete via buildExportModel.
 */
projectsRouter.get(
  '/:id/export',
  loadMembership,
  asyncHandler(async (req, res) => {
    const format = String(req.query.format || 'csv');
    const adapter = ADAPTERS[format];
    if (!adapter) throw badRequest('Unknown export format');
    const canSeePrivate = req.isOwnerOrAdmin || req.capabilities.has('view_private_cues');
    const model = await buildExportModel({
      projectId: req.project.id,
      userId: req.session.userId,
      canSeePrivate,
      trackId: req.query.trackId ? String(req.query.trackId) : undefined,
    });
    const { filename, contentType, body } = adapter(model);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  })
);

const shareDto = (row) =>
  row && row.enabled && !row.revoked_at
    ? { token: row.token, url: `${config.baseUrl}/p/${row.token}`, enabled: true }
    : null;

/** GET /projects/:id/share (manage_project) — the current public link, if any. */
projectsRouter.get(
  '/:id/share',
  loadMembership,
  requireCapability('manage_project'),
  asyncHandler(async (req, res) => {
    const row = await knex('project_share_tokens').where({ project_id: req.project.id }).first();
    res.json({ share: shareDto(row) });
  })
);

/** POST /projects/:id/share (manage_project) — create or rotate the public link. */
projectsRouter.post(
  '/:id/share',
  loadMembership,
  requireCapability('manage_project'),
  asyncHandler(async (req, res) => {
    const token = crypto.randomBytes(24).toString('hex');
    const existing = await knex('project_share_tokens').where({ project_id: req.project.id }).first();
    if (existing) {
      await knex('project_share_tokens')
        .where({ id: existing.id })
        .update({ token, enabled: true, revoked_at: null, created_by: req.session.userId, created_at: knex.fn.now() });
    } else {
      await knex('project_share_tokens').insert({
        project_id: req.project.id,
        token,
        created_by: req.session.userId,
      });
    }
    res.json({ share: { token, url: `${config.baseUrl}/p/${token}`, enabled: true } });
  })
);

/** DELETE /projects/:id/share (manage_project) — disable the public link. */
projectsRouter.delete(
  '/:id/share',
  loadMembership,
  requireCapability('manage_project'),
  asyncHandler(async (req, res) => {
    await knex('project_share_tokens')
      .where({ project_id: req.project.id })
      .update({ enabled: false, revoked_at: knex.fn.now() });
    res.json({ ok: true });
  })
);

export default projectsRouter;
