import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { config } from '../config.js';
import { sessionPool } from '../db/session-pool.js';

const PgStore = connectPgSimple(session);

/**
 * Shared session middleware. Exported so it can be reused by Socket.IO via
 * io.engine.use(...) — this is how sockets become session-authenticated.
 */
export const sessionMiddleware = session({
  store: new PgStore({
    pool: sessionPool,
    tableName: 'session',
    createTableIfMissing: true,
  }),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
});

export default sessionMiddleware;
