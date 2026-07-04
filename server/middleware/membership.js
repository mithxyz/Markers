import { knex } from '../db/knex.js';
import { asyncHandler, notFound, forbidden } from '../lib/http.js';
import { ALL_CAPABILITIES, toCapabilityArray } from '../lib/capabilities.js';

/**
 * Load the project + the requesting user's membership and capabilities. Attaches:
 *   req.project        — the project row
 *   req.memberRole     — the caller's role name (for backward-compatible responses)
 *   req.capabilities   — Set<string> of capability keys
 *   req.isOwnerOrAdmin — true for the project owner or a global admin (all caps)
 * Reads :projectId (or :id) from params.
 */
export const loadMembership = asyncHandler(async (req, res, next) => {
  const projectId = req.params.projectId || req.params.id;
  const project = await knex('projects').where({ id: projectId }).first();
  if (!project) throw notFound('Project not found');

  // Lockout-proof super-roles: the project owner and global admins always get
  // every capability, even without (or regardless of) a membership row.
  const user = await knex('users').where({ id: req.session.userId }).first();
  const isOwnerOrAdmin = project.owner_id === req.session.userId || !!user?.is_admin;

  const member = await knex('project_members as m')
    .leftJoin('project_roles as r', 'r.id', 'm.role_id')
    .where({ 'm.project_id': projectId, 'm.user_id': req.session.userId })
    .select('m.user_id', 'm.role_id', 'r.name as role_name', 'r.capabilities as role_capabilities')
    .first();

  // Phase 6 — team access (additive). A member of the project's team can access
  // it even without a project_members row; the team OWNER gets full access.
  let teamRole = null;
  if (project.team_id && !isOwnerOrAdmin) {
    const tm = await knex('team_members').where({ team_id: project.team_id, user_id: req.session.userId }).first('role');
    teamRole = tm?.role ?? null;
  }
  const isTeamOwner = teamRole === 'owner';

  if (!member && !isOwnerOrAdmin && !teamRole) throw forbidden('You are not a member of this project');

  req.project = project;
  req.isOwnerOrAdmin = isOwnerOrAdmin || isTeamOwner;

  // effectiveRoleId drives department-scoped restrictions (Phase 5d).
  let effectiveRoleId = null;
  if (req.isOwnerOrAdmin) {
    req.capabilities = new Set(ALL_CAPABILITIES);
    req.memberRole = member?.role_name || (isTeamOwner ? 'team owner' : 'owner');
  } else if (member) {
    req.capabilities = new Set(toCapabilityArray(member.role_capabilities));
    req.memberRole = member.role_name || 'viewer';
    effectiveRoleId = member.role_id;
  } else {
    // Team member with no explicit project role → the project's default role.
    const def = await knex('project_roles').where({ project_id: project.id, is_default: true }).first('id', 'name', 'capabilities');
    req.capabilities = new Set(toCapabilityArray(def?.capabilities));
    req.memberRole = def?.name || 'member';
    effectiveRoleId = def?.id ?? null;
  }

  // Department-scoped permissions (Phase 5d). null = unrestricted (owner/admin/
  // team-owner, or a role with no explicit department rows). Set = restricted.
  req.deptView = null;
  req.deptEdit = null;
  if (!req.isOwnerOrAdmin && effectiveRoleId) {
    const rows = await knex('project_role_departments').where({ role_id: effectiveRoleId });
    if (rows.length) {
      req.deptView = new Set(rows.filter((r) => r.can_view).map((r) => r.department_id));
      req.deptEdit = new Set(rows.filter((r) => r.can_edit).map((r) => r.department_id));
    }
  }
  next();
});

/** Require a specific capability (set by loadMembership). */
export function requireCapability(cap) {
  return (req, res, next) => {
    if (req.capabilities?.has(cap)) return next();
    return next(forbidden('You do not have permission to do that'));
  };
}
