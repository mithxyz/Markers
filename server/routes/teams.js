import { Router } from 'express';
import { knex } from '../db/knex.js';
import { asyncHandler, badRequest, notFound, forbidden, conflict } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';

/**
 * Teams / organization layer (Phase 6). A team owns projects and has members;
 * team members can access the team's projects (see membership.js). Team owners
 * manage the team + its membership.
 */
export const teamsRouter = Router();
teamsRouter.use(requireAuth);

/** Load the team + the caller's team role onto req; 404 if not a member. */
const loadTeam = asyncHandler(async (req, res, next) => {
  const team = await knex('teams').where({ id: req.params.teamId }).first();
  if (!team) throw notFound('Team not found');
  const membership = await knex('team_members').where({ team_id: team.id, user_id: req.session.userId }).first('role');
  if (!membership) throw forbidden('You are not a member of this team');
  req.team = team;
  req.teamRole = membership.role;
  next();
});
const requireTeamOwner = (req, res, next) => (req.teamRole === 'owner' ? next() : next(forbidden('Only a team owner can do that')));

/** GET /teams — teams I belong to, with my role + project count. */
teamsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const teams = await knex('teams as t')
      .join('team_members as tm', 'tm.team_id', 't.id')
      .where('tm.user_id', req.session.userId)
      .select('t.id', 't.name', 'tm.role', 't.created_at')
      .orderBy('t.name');
    const counts = teams.length
      ? await knex('projects').whereIn('team_id', teams.map((t) => t.id)).groupBy('team_id').select('team_id').count('* as n')
      : [];
    const byTeam = new Map(counts.map((c) => [c.team_id, Number(c.n)]));
    res.json({ teams: teams.map((t) => ({ ...t, projectCount: byTeam.get(t.id) ?? 0 })) });
  })
);

/** POST /teams { name } — create a team, owner = creator. */
teamsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 255);
    if (!name) throw badRequest('Team name required');
    const team = await knex.transaction(async (trx) => {
      const [t] = await trx('teams').insert({ name, created_by: req.session.userId }).returning('*');
      await trx('team_members').insert({ team_id: t.id, user_id: req.session.userId, role: 'owner' });
      return t;
    });
    res.status(201).json({ team: { ...team, role: 'owner', projectCount: 0 } });
  })
);

/** GET /teams/:teamId — team + members + its projects. */
teamsRouter.get(
  '/:teamId',
  loadTeam,
  asyncHandler(async (req, res) => {
    const members = await knex('team_members as tm')
      .join('users as u', 'u.id', 'tm.user_id')
      .where('tm.team_id', req.team.id)
      .select('u.id', 'u.email', 'u.display_name', 'tm.role')
      .orderBy('tm.role')
      .orderBy('u.display_name');
    const projects = await knex('projects')
      .where({ team_id: req.team.id })
      .select('id', 'name', 'description', 'type', 'owner_id', 'updated_at')
      .orderBy('updated_at', 'desc');
    res.json({ team: { ...req.team, role: req.teamRole }, members, projects });
  })
);

/** PATCH /teams/:teamId { name } (owner). */
teamsRouter.patch(
  '/:teamId',
  loadTeam,
  requireTeamOwner,
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 255);
    if (!name) throw badRequest('Name cannot be empty');
    const [team] = await knex('teams').where({ id: req.team.id }).update({ name, updated_at: knex.fn.now() }).returning('*');
    res.json({ team });
  })
);

/** DELETE /teams/:teamId (owner) — projects fall back to personal (team_id NULL). */
teamsRouter.delete(
  '/:teamId',
  loadTeam,
  requireTeamOwner,
  asyncHandler(async (req, res) => {
    await knex('teams').where({ id: req.team.id }).del();
    res.json({ ok: true });
  })
);

/** POST /teams/:teamId/members { email, role? } (owner) — add an existing user. */
teamsRouter.post(
  '/:teamId/members',
  loadTeam,
  requireTeamOwner,
  asyncHandler(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) throw badRequest('Email required');
    const role = req.body.role === 'owner' ? 'owner' : 'member';
    const user = await knex('users').whereRaw('lower(email) = ?', [email]).first('id');
    if (!user) throw badRequest('No user with that email — they need an account first');
    const dup = await knex('team_members').where({ team_id: req.team.id, user_id: user.id }).first();
    if (dup) throw conflict('Already a team member');
    await knex('team_members').insert({ team_id: req.team.id, user_id: user.id, role });
    res.status(201).json({ ok: true });
  })
);

/** PATCH /teams/:teamId/members/:userId { role } (owner). */
teamsRouter.patch(
  '/:teamId/members/:userId',
  loadTeam,
  requireTeamOwner,
  asyncHandler(async (req, res) => {
    const role = req.body.role === 'owner' ? 'owner' : 'member';
    if (req.params.userId === req.session.userId && role !== 'owner') {
      const owners = await knex('team_members').where({ team_id: req.team.id, role: 'owner' }).count('* as n').first();
      if (Number(owners.n) <= 1) throw badRequest('A team must keep at least one owner');
    }
    await knex('team_members').where({ team_id: req.team.id, user_id: req.params.userId }).update({ role, updated_at: knex.fn.now() });
    res.json({ ok: true });
  })
);

/** DELETE /teams/:teamId/members/:userId (owner, or self leave). */
teamsRouter.delete(
  '/:teamId/members/:userId',
  loadTeam,
  asyncHandler(async (req, res) => {
    const isSelf = req.params.userId === req.session.userId;
    if (!isSelf && req.teamRole !== 'owner') throw forbidden('Only a team owner can remove members');
    const target = await knex('team_members').where({ team_id: req.team.id, user_id: req.params.userId }).first('role');
    if (!target) throw notFound('Not a team member');
    if (target.role === 'owner') {
      const owners = await knex('team_members').where({ team_id: req.team.id, role: 'owner' }).count('* as n').first();
      if (Number(owners.n) <= 1) throw badRequest('A team must keep at least one owner');
    }
    await knex('team_members').where({ team_id: req.team.id, user_id: req.params.userId }).del();
    res.json({ ok: true });
  })
);

export default teamsRouter;
