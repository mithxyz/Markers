import { Router } from 'express';
import { knex } from '../db/knex.js';
import { asyncHandler, badRequest, notFound, conflict } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { loadMembership, requireCapability } from '../middleware/membership.js';
import { CAPABILITIES } from '../lib/capabilities.js';

// Mounted at /projects/:id/roles.
export const rolesRouter = Router({ mergeParams: true });
rolesRouter.use(requireAuth, loadMembership);

/** Validate + dedupe a capabilities array against the known vocabulary. */
function cleanCapabilities(input) {
  if (!Array.isArray(input)) throw badRequest('capabilities must be an array');
  const set = new Set();
  for (const c of input) {
    if (!CAPABILITIES.includes(c)) throw badRequest(`Unknown capability: ${c}`);
    set.add(c);
  }
  return [...set];
}

/** GET /projects/:id/roles — list this project's roles (any member). */
rolesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const roles = await knex('project_roles')
      .where({ project_id: req.project.id })
      .orderBy('sort_order')
      .select('id', 'name', 'capabilities', 'is_default', 'is_system', 'sort_order');
    // Attach each role's department restrictions (Phase 5d); [] = unrestricted.
    const rd = roles.length
      ? await knex('project_role_departments').whereIn('role_id', roles.map((r) => r.id))
      : [];
    const byRole = new Map();
    for (const r of rd) {
      if (!byRole.has(r.role_id)) byRole.set(r.role_id, []);
      byRole.get(r.role_id).push({ department_id: r.department_id, can_view: r.can_view, can_edit: r.can_edit });
    }
    for (const role of roles) role.departments = byRole.get(role.id) ?? [];
    res.json({ roles, vocabulary: CAPABILITIES });
  })
);

/** POST /projects/:id/roles { name, capabilities[] } (manage_roles) */
rolesRouter.post(
  '/',
  requireCapability('manage_roles'),
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 64);
    if (!name) throw badRequest('Role name required');
    const capabilities = cleanCapabilities(req.body.capabilities || []);

    const existing = await knex('project_roles').where({ project_id: req.project.id, name }).first();
    if (existing) throw conflict('A role with that name already exists');

    const maxOrder = await knex('project_roles').where({ project_id: req.project.id }).max('sort_order as m').first();
    const [role] = await knex('project_roles')
      .insert({
        project_id: req.project.id,
        name,
        capabilities: JSON.stringify(capabilities),
        is_default: false,
        is_system: false,
        sort_order: (maxOrder?.m ?? 0) + 1,
      })
      .returning(['id', 'name', 'capabilities', 'is_default', 'is_system', 'sort_order']);
    res.status(201).json({ role });
  })
);

/** PATCH /projects/:id/roles/:roleId { name?, capabilities?, is_default? } (manage_roles) */
rolesRouter.patch(
  '/:roleId',
  requireCapability('manage_roles'),
  asyncHandler(async (req, res) => {
    const role = await knex('project_roles')
      .where({ id: req.params.roleId, project_id: req.project.id })
      .first();
    if (!role) throw notFound('Role not found');

    const patch = {};
    if (req.body.name !== undefined) {
      if (role.is_system) throw badRequest('System roles cannot be renamed');
      const name = String(req.body.name).trim().slice(0, 64);
      if (!name) throw badRequest('Role name cannot be empty');
      const clash = await knex('project_roles')
        .where({ project_id: req.project.id, name })
        .whereNot({ id: role.id })
        .first();
      if (clash) throw conflict('A role with that name already exists');
      patch.name = name;
    }
    if (req.body.capabilities !== undefined) {
      patch.capabilities = JSON.stringify(cleanCapabilities(req.body.capabilities));
    }
    const hasDeptCaps = Array.isArray(req.body.department_caps);
    if (!Object.keys(patch).length && req.body.is_default === undefined && !hasDeptCaps) throw badRequest('Nothing to update');
    if (Object.keys(patch).length) patch.updated_at = knex.fn.now();

    await knex.transaction(async (trx) => {
      if (req.body.is_default === true) {
        // Exactly one default role per project.
        await trx('project_roles').where({ project_id: req.project.id }).update({ is_default: false });
        patch.is_default = true;
      } else if (req.body.is_default === false && role.is_default) {
        throw badRequest('Set another role as default instead of unsetting this one');
      }
      if (Object.keys(patch).length) {
        await trx('project_roles').where({ id: role.id }).update(patch);
      }
      // Phase 5d: replace department restrictions. [] ⇒ unrestricted (all removed).
      if (hasDeptCaps) {
        await trx('project_role_departments').where({ role_id: role.id }).del();
        const projDepts = new Set(await trx('departments').where({ project_id: req.project.id }).pluck('id'));
        const rows = req.body.department_caps
          .filter((d) => d && projDepts.has(d.department_id) && (d.can_view || d.can_edit))
          .map((d) => ({ role_id: role.id, department_id: d.department_id, can_view: d.can_view !== false, can_edit: !!d.can_edit }));
        if (rows.length) await trx('project_role_departments').insert(rows);
      }
    });

    const updated = await knex('project_roles')
      .where({ id: role.id })
      .select('id', 'name', 'capabilities', 'is_default', 'is_system', 'sort_order')
      .first();
    res.json({ role: updated });
  })
);

/** DELETE /projects/:id/roles/:roleId (manage_roles) */
rolesRouter.delete(
  '/:roleId',
  requireCapability('manage_roles'),
  asyncHandler(async (req, res) => {
    const role = await knex('project_roles')
      .where({ id: req.params.roleId, project_id: req.project.id })
      .first();
    if (!role) throw notFound('Role not found');
    if (role.is_system) throw badRequest('System roles cannot be deleted');
    if (role.is_default) throw badRequest('Set another role as default before deleting this one');

    const inUse = await knex('project_members').where({ role_id: role.id }).count('user_id as c').first();
    if (Number(inUse.c) > 0) throw conflict(`That role is assigned to ${inUse.c} member(s) — reassign them first`);

    await knex('project_roles').where({ id: role.id }).del();
    res.json({ ok: true });
  })
);

export default rolesRouter;
