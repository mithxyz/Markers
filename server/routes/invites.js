import { Router } from 'express';
import crypto from 'node:crypto';
import { knex } from '../db/knex.js';
import { config } from '../config.js';
import { asyncHandler, badRequest, notFound, forbidden, conflict } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { loadMembership, requireCapability } from '../middleware/membership.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { issueAuthToken } from './auth.js';
import { sendSetPassword } from '../services/mail.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
const INVITE_SET_PW_TTL_MS = 72 * 60 * 60 * 1000;

// Invite creation lives under /projects/:id/invites (member-scoped).
export const projectInvitesRouter = Router({ mergeParams: true });
projectInvitesRouter.use(requireAuth, loadMembership);

/** POST /projects/:id/invites { role_id?, email?, expiresInHours? } (create_invites) */
projectInvitesRouter.post(
  '/',
  requireCapability('create_invites'),
  asyncHandler(async (req, res) => {
    // Resolve the role to grant: a project role by id, else the project's default role.
    let role = req.body.role_id
      ? await knex('project_roles').where({ id: req.body.role_id, project_id: req.project.id }).first()
      : null;
    if (!role) role = await knex('project_roles').where({ project_id: req.project.id, is_default: true }).first();
    if (!role) throw badRequest('No role available to grant');

    const email = req.body.email ? normalizeEmail(req.body.email) : null;
    const hours = Math.min(Math.max(parseInt(req.body.expiresInHours || '72', 10), 1), 720);

    const token = crypto.randomBytes(32).toString('hex');
    const [row] = await knex('invite_tokens')
      .insert({
        project_id: req.project.id,
        created_by: req.session.userId,
        token,
        email,
        role_id: role.id,
        expires_at: new Date(Date.now() + hours * 3600 * 1000),
      })
      .returning('*');

    res.status(201).json({
      invite: { token: row.token, role: role.name, role_id: role.id, email: row.email, expires_at: row.expires_at },
      url: `${config.baseUrl}/invite/${row.token}`,
    });
  })
);

/** GET /projects/:id/invites (create_invites) — list active invites */
projectInvitesRouter.get(
  '/',
  requireCapability('create_invites'),
  asyncHandler(async (req, res) => {
    const invites = await knex('invite_tokens as i')
      .leftJoin('project_roles as r', 'r.id', 'i.role_id')
      .where({ 'i.project_id': req.project.id })
      .whereNull('i.used_at')
      .where('i.expires_at', '>', new Date())
      .select('i.token', 'r.name as role', 'i.role_id', 'i.email', 'i.expires_at', 'i.created_at');
    res.json({ invites });
  })
);

// Public-ish invite lookup + accept lives under /invites/:token.
export const invitesRouter = Router();

/** GET /invites/:token — preview (no auth needed to see what it is). */
invitesRouter.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const invite = await knex('invite_tokens as i')
      .join('projects as p', 'p.id', 'i.project_id')
      .leftJoin('users as u', 'u.id', 'i.created_by')
      .leftJoin('project_roles as r', 'r.id', 'i.role_id')
      .where('i.token', req.params.token)
      .select('r.name as role', 'i.email', 'i.expires_at', 'i.used_at', 'p.name as project_name', 'u.display_name as inviter')
      .first();
    if (!invite) throw notFound('Invite not found');

    const valid = !invite.used_at && new Date(invite.expires_at) > new Date();
    res.json({
      invite: {
        project_name: invite.project_name,
        inviter: invite.inviter,
        role: invite.role,
        email: invite.email,
        valid,
      },
    });
  })
);

/**
 * POST /invites/:token/start { email? } — account bootstrap for a logged-out
 * invitee. Possession of a valid invite authorizes creating/activating the
 * account for its email. Returns the next action for the client:
 *   - 'login'       account already exists with a password -> sign in then accept
 *   - 'check_email' set-password link emailed (redirecting back to the invite)
 */
invitesRouter.post(
  '/:token/start',
  authLimiter,
  asyncHandler(async (req, res) => {
    const invite = await knex('invite_tokens').where({ token: req.params.token }).first();
    if (!invite) throw notFound('Invite not found');
    if (invite.used_at || new Date(invite.expires_at) <= new Date())
      throw forbidden('This invite has expired or already been used');

    const provided = normalizeEmail(req.body.email);
    if (invite.email && provided && provided !== invite.email)
      throw badRequest('This invite is for a different email address');
    const email = invite.email || provided;
    if (!EMAIL_RE.test(email)) throw badRequest('Valid email required');

    const redirectTo = `/invite/${invite.token}`;
    const user = await knex('users').where({ email }).first();
    if (user?.password_hash) {
      return res.json({ action: 'login', redirectTo });
    }
    if (!user) {
      await knex('users').insert({ email, display_name: email.split('@')[0] });
    }
    const url = await issueAuthToken({ email, purpose: 'set_password', redirectTo, ttlMs: INVITE_SET_PW_TTL_MS });
    await sendSetPassword(email, url);
    res.json({ action: 'check_email' });
  })
);

/** POST /invites/:token/accept (auth) — join the project. */
invitesRouter.post(
  '/:token/accept',
  requireAuth,
  asyncHandler(async (req, res) => {
    const invite = await knex('invite_tokens').where({ token: req.params.token }).first();
    if (!invite) throw notFound('Invite not found');
    if (invite.used_at || new Date(invite.expires_at) <= new Date())
      throw forbidden('This invite has expired or already been used');

    const user = await knex('users').where({ id: req.session.userId }).first();
    if (invite.email && invite.email !== user.email)
      throw forbidden('This invite is for a different email address');

    const existing = await knex('project_members')
      .where({ project_id: invite.project_id, user_id: user.id })
      .first();
    if (existing) {
      // Already a member — burn the token, return the project id.
      await knex('invite_tokens').where({ id: invite.id }).update({ used_by: user.id, used_at: knex.fn.now() });
      return res.json({ projectId: invite.project_id, alreadyMember: true });
    }

    await knex.transaction(async (trx) => {
      // Use the invite's role, falling back to the project's default role.
      let roleId = invite.role_id;
      if (!roleId) {
        const def = await trx('project_roles')
          .where({ project_id: invite.project_id, is_default: true })
          .first();
        roleId = def?.id;
      }
      await trx('project_members').insert({
        project_id: invite.project_id,
        user_id: user.id,
        role_id: roleId,
        accepted_at: trx.fn.now(),
      });
      await trx('invite_tokens').where({ id: invite.id }).update({ used_by: user.id, used_at: trx.fn.now() });
    });

    res.json({ projectId: invite.project_id });
  })
);

export default { projectInvitesRouter, invitesRouter };
