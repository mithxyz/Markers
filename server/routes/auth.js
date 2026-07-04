import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { knex } from '../db/knex.js';
import { config } from '../config.js';
import { asyncHandler, badRequest, unauthorized } from '../lib/http.js';
import { sendResetPassword } from '../services/mail.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';

export const authRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD = 8;
const RESET_TTL_MS = 60 * 60 * 1000; // 1h — forgot-password window

const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex');
const publicUser = (u) => ({ id: u.id, email: u.email, display_name: u.display_name, is_admin: u.is_admin });

/**
 * Mint a single-use auth token (set_password | reset_password) and return the
 * URL to email. Only the sha256 hash is stored.
 */
export async function issueAuthToken({ email, purpose, redirectTo = null, ttlMs }) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  await knex('auth_tokens').insert({
    email,
    purpose,
    token_hash: hashToken(rawToken),
    redirect_to: redirectTo,
    expires_at: new Date(Date.now() + ttlMs),
  });
  const path = purpose === 'reset_password' ? 'reset' : 'set-password';
  return `${config.baseUrl}/auth/${path}?token=${rawToken}`;
}

/** POST /auth/login { email, password } — password sign-in. */
authRouter.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    if (!email || !password) throw badRequest('Email and password required');

    const user = await knex('users').where({ email }).first();
    // Generic failure regardless of whether the account exists / has a password.
    const ok = user?.password_hash ? await bcrypt.compare(password, user.password_hash) : false;
    if (!ok) throw unauthorized('Incorrect email or password');

    req.session.userId = user.id;
    res.json({ user: publicUser(user) });
  })
);

/** POST /auth/forgot { email } — always generic; emails a reset link if the account exists.
 *  This also serves legacy passwordless users (it issues a reset regardless of prior password),
 *  which is why the old magic-link "set password" bridge is no longer needed. */
authRouter.post(
  '/forgot',
  authLimiter,
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body.email);
    if (!EMAIL_RE.test(email)) throw badRequest('Valid email required');

    const user = await knex('users').where({ email }).first();
    if (user) {
      const url = await issueAuthToken({ email, purpose: 'reset_password', ttlMs: RESET_TTL_MS });
      await sendResetPassword(email, url);
    }
    res.json({ ok: true, message: 'If that email has an account, we’ve sent a reset link.' });
  })
);

/** Consume a token of `purpose`, set the user's password, and start a session. */
async function applyPassword(req, res, purpose) {
  const raw = String(req.body.token || '');
  const password = String(req.body.password || '');
  if (!raw) throw badRequest('Token required');
  if (password.length < MIN_PASSWORD) throw badRequest(`Password must be at least ${MIN_PASSWORD} characters`);

  const row = await knex('auth_tokens')
    .where({ token_hash: hashToken(raw), purpose })
    .whereNull('consumed_at')
    .where('expires_at', '>', new Date())
    .first();
  if (!row) throw unauthorized('This link is invalid or has expired');

  const user = await knex('users').where({ email: row.email }).first();
  if (!user) throw unauthorized('Account not found');

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await knex.transaction(async (trx) => {
    await trx('users').where({ id: user.id }).update({ password_hash: hash, password_set_at: trx.fn.now(), updated_at: trx.fn.now() });
    await trx('auth_tokens').where({ id: row.id }).update({ consumed_at: trx.fn.now() });
  });

  req.session.userId = user.id;
  res.json({ user: publicUser(user), redirectTo: row.redirect_to || null });
}

/** POST /auth/set-password { token, password } */
authRouter.post('/set-password', authLimiter, asyncHandler((req, res) => applyPassword(req, res, 'set_password')));

/** POST /auth/reset { token, password } */
authRouter.post('/reset', authLimiter, asyncHandler((req, res) => applyPassword(req, res, 'reset_password')));

/** GET /auth/me */
authRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    if (!req.session?.userId) throw unauthorized();
    const user = await knex('users').where({ id: req.session.userId }).first();
    if (!user) {
      req.session.destroy(() => {});
      throw unauthorized();
    }
    res.json({ user: publicUser(user) });
  })
);

/** PATCH /auth/me { display_name } */
authRouter.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const name = String(req.body.display_name || '').trim().slice(0, 255);
    if (!name) throw badRequest('Display name required');
    const [user] = await knex('users')
      .where({ id: req.session.userId })
      .update({ display_name: name, updated_at: knex.fn.now() })
      .returning('*');
    res.json({ user: publicUser(user) });
  })
);

/** POST /auth/logout */
authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

export default authRouter;
