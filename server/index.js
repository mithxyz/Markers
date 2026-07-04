import http from 'node:http';
import { config } from './config.js';
import { createApp } from './app.js';
import { initSocket } from './socket/index.js';
import { knex } from './db/knex.js';

const app = createApp();
const server = http.createServer(app);
const io = initSocket(server);

// Make io available to route handlers for broadcasting.
app.set('io', io);

server.listen(config.port, '127.0.0.1', () => {
  console.log(`[markers] listening on http://127.0.0.1:${config.port} (${config.env})`);
});

async function shutdown(signal) {
  console.log(`[markers] ${signal} received, shutting down`);
  io.close();
  server.close();
  await knex.destroy().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
