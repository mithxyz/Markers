import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { sessionMiddleware } from './middleware/session.js';
import { apiRouter } from './routes/index.js';
import { pingAnalyzer } from './services/rhythm.js';
import { makeRedisConnection } from './redis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientBuild = path.join(__dirname, '..', 'client', 'build');

export function createApp() {
  const app = express();

  // Behind nginx in production — required for secure cookies.
  app.set('trust proxy', 1);

  app.use(
    cors({
      origin: config.allowedOrigins,
      credentials: true,
    })
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(sessionMiddleware);

  // Health check (no auth) — Phase 11a: also pings the analyzer sidecar + Redis.
  app.get('/api/v1/health', async (req, res) => {
    const analyzer = await pingAnalyzer();
    let redis = 'down';
    const conn = makeRedisConnection();
    try {
      await conn.ping();
      redis = 'up';
    } catch {
      redis = 'down';
    } finally {
      conn.disconnect();
    }
    res.json({ ok: true, service: 'markers', env: config.env, time: new Date().toISOString(), analyzer, redis });
  });

  app.use('/api/v1', apiRouter);

  // Serve the built SvelteKit SPA with history fallback.
  app.use(express.static(clientBuild));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(clientBuild, 'index.html'), (err) => {
      if (err) res.status(404).json({ error: 'Not found' });
    });
  });

  // JSON error handler.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[error]', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.publicMessage || 'Internal server error' });
  });

  return app;
}

export default createApp;
