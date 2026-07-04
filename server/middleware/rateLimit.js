import rateLimit from 'express-rate-limit';

// `trust proxy` is set to 1 in app.js, so req.ip is the real client behind nginx.
const FIFTEEN_MIN = 15 * 60 * 1000;

/**
 * Strict limiter for credential / token endpoints (login, forgot, set/reset
 * password, invite bootstrap). Per-IP. Generic JSON error so it doesn't leak
 * which path tripped it.
 */
export const authLimiter = rateLimit({
  windowMs: FIFTEEN_MIN,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
});

/** Looser limiter for unauthenticated public read endpoints (anon share links). */
export const publicReadLimiter = rateLimit({
  windowMs: FIFTEEN_MIN,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});
