import { knex } from '../db/knex.js';

/** Reject unauthenticated requests. */
export function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

/** Reject non-admin requests. Loads the user to check the is_admin flag. */
export async function requireAdmin(req, res, next) {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
    const user = await knex('users').where({ id: req.session.userId }).first();
    if (!user?.is_admin) return res.status(403).json({ error: 'Admin only' });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export default requireAuth;
