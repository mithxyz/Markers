import { Router } from 'express';
import { knex } from '../db/knex.js';
import { asyncHandler, badRequest, notFound, forbidden } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { loadMembership, requireCapability } from '../middleware/membership.js';

// mergeParams so :id (projectId) from the parent mount is visible.
export const membersRouter = Router({ mergeParams: true });
membersRouter.use(requireAuth, loadMembership);

/** GET /projects/:id/members */
membersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const members = await knex('project_members as m')
      .join('users as u', 'u.id', 'm.user_id')
      .leftJoin('project_roles as r', 'r.id', 'm.role_id')
      .where('m.project_id', req.project.id)
      .select('u.id', 'u.email', 'u.display_name', 'm.role_id', 'r.name as role', 'm.accepted_at');
    res.json({ members });
  })
);

/** PATCH /projects/:id/members/:userId { role_id } (manage_members) */
membersRouter.patch(
  '/:userId',
  requireCapability('manage_members'),
  asyncHandler(async (req, res) => {
    const roleId = req.body.role_id;
    if (!roleId) throw badRequest('role_id required');
    if (req.params.userId === req.project.owner_id) throw badRequest("Can't change the owner's role");

    const role = await knex('project_roles').where({ id: roleId, project_id: req.project.id }).first();
    if (!role) throw badRequest('That role does not belong to this project');

    const updated = await knex('project_members')
      .where({ project_id: req.project.id, user_id: req.params.userId })
      .update({ role_id: roleId, updated_at: knex.fn.now() });
    if (!updated) throw notFound('Member not found');
    res.json({ ok: true });
  })
);

/** DELETE /projects/:id/members/:userId (manage_members, or self-leave) */
membersRouter.delete(
  '/:userId',
  asyncHandler(async (req, res) => {
    const isSelf = req.params.userId === req.session.userId;
    if (!isSelf && !req.capabilities.has('manage_members')) throw forbidden('You cannot remove members');
    if (req.params.userId === req.project.owner_id) throw badRequest("Can't remove the project owner");

    await knex('project_members')
      .where({ project_id: req.project.id, user_id: req.params.userId })
      .del();
    res.json({ ok: true });
  })
);

export default membersRouter;
