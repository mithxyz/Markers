import { Router } from 'express';
import { knex } from '../db/knex.js';
import { asyncHandler, badRequest, notFound, conflict } from '../lib/http.js';
import { requireAdmin } from '../middleware/auth.js';
import { issueAuthToken } from './auth.js';
import { sendSetPassword } from '../services/mail.js';
import { getMediaQueue } from '../redis.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SET_PW_TTL_MS = 72 * 60 * 60 * 1000;

/** POST /admin/users { email, display_name?, is_admin? } — create an account + email a set-password link. */
adminRouter.post(
  '/users',
  asyncHandler(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw badRequest('Valid email required');
    const display_name = String(req.body.display_name || '').trim().slice(0, 255) || email.split('@')[0];
    const is_admin = req.body.is_admin === true;

    const existing = await knex('users').where({ email }).first();
    if (existing) throw conflict('A user with that email already exists');

    const [user] = await knex('users')
      .insert({ email, display_name, is_admin })
      .returning(['id', 'email', 'display_name', 'is_admin', 'created_at']);

    const url = await issueAuthToken({ email, purpose: 'set_password', ttlMs: SET_PW_TTL_MS });
    await sendSetPassword(email, url);

    res.status(201).json({ user, inviteSent: true });
  })
);

/** GET /admin/users — all users with their project count. */
adminRouter.get(
  '/users',
  asyncHandler(async (req, res) => {
    const users = await knex('users as u')
      .leftJoin('project_members as m', 'm.user_id', 'u.id')
      .groupBy('u.id')
      .select('u.id', 'u.email', 'u.display_name', 'u.is_admin', 'u.created_at')
      .count('m.id as project_count')
      .orderBy('u.created_at', 'desc');
    res.json({ users });
  })
);

/** GET /admin/projects — all projects with owner + member count. */
adminRouter.get(
  '/projects',
  asyncHandler(async (req, res) => {
    const projects = await knex('projects as p')
      .leftJoin('users as o', 'o.id', 'p.owner_id')
      .leftJoin('project_members as m', 'm.project_id', 'p.id')
      .groupBy('p.id', 'o.email', 'o.display_name')
      .select('p.id', 'p.name', 'p.description', 'p.created_at', 'p.updated_at', 'o.email as owner_email', 'o.display_name as owner_name')
      .count('m.id as member_count')
      .orderBy('p.updated_at', 'desc');
    res.json({ projects });
  })
);

/** PATCH /admin/users/:id { is_admin } — grant/revoke admin. */
adminRouter.patch(
  '/users/:id',
  asyncHandler(async (req, res) => {
    if (typeof req.body.is_admin !== 'boolean') throw badRequest('is_admin (boolean) required');
    // Don't let the last admin demote themselves into lockout.
    if (req.params.id === req.session.userId && req.body.is_admin === false) {
      const admins = await knex('users').where({ is_admin: true }).count('id as c').first();
      if (Number(admins.c) <= 1) throw conflict('You are the only admin — promote someone else first');
    }
    const [user] = await knex('users')
      .where({ id: req.params.id })
      .update({ is_admin: req.body.is_admin, updated_at: knex.fn.now() })
      .returning(['id', 'email', 'display_name', 'is_admin']);
    if (!user) throw notFound('User not found');
    res.json({ user });
  })
);

/** DELETE /admin/projects/:id — delete any project. */
adminRouter.delete(
  '/projects/:id',
  asyncHandler(async (req, res) => {
    const deleted = await knex('projects').where({ id: req.params.id }).del();
    if (!deleted) throw notFound('Project not found');
    res.json({ ok: true });
  })
);

/** DELETE /admin/users/:id — delete a user (blocked if they own projects). */
adminRouter.delete(
  '/users/:id',
  asyncHandler(async (req, res) => {
    if (req.params.id === req.session.userId) throw badRequest("You can't delete your own account here");
    const owned = await knex('projects').where({ owner_id: req.params.id }).count('id as c').first();
    if (Number(owned.c) > 0)
      throw conflict(`User owns ${owned.c} project(s) — delete or reassign those first`);
    const deleted = await knex('users').where({ id: req.params.id }).del();
    if (!deleted) throw notFound('User not found');
    res.json({ ok: true });
  })
);

/** GET /admin/system-log?source=&level=&limit= — recent system_log entries (H1-C). */
adminRouter.get(
  '/system-log',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const q = knex('system_log').orderBy('created_at', 'desc').limit(limit);
    if (req.query.source) q.where({ source: String(req.query.source) });
    if (req.query.level) q.where({ level: String(req.query.level) });
    const rows = await q;
    res.json({ entries: rows });
  })
);

/** GET /admin/system/status — queue depth + recent failure counts (H1-C). */
adminRouter.get(
  '/system/status',
  asyncHandler(async (req, res) => {
    const [queueCounts, recentErrors] = await Promise.all([
      getMediaQueue().getJobCounts('waiting', 'active', 'failed', 'completed'),
      knex('system_log')
        .where({ level: 'error' })
        .where('created_at', '>', knex.raw("now() - interval '24 hours'"))
        .count('id as c')
        .first(),
    ]);
    res.json({ queue: queueCounts, errors_last_24h: Number(recentErrors?.c ?? 0) });
  })
);

export default adminRouter;
