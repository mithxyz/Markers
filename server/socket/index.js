import { Server } from 'socket.io';
import { config } from '../config.js';
import { knex } from '../db/knex.js';
import { sessionMiddleware } from '../middleware/session.js';
import { makeRedisConnection } from '../redis.js';
import { ALL_CAPABILITIES, toCapabilityArray } from '../lib/capabilities.js';
import * as rooms from './rooms.js';

// Deterministic per-user colour for presence/cursors.
const COLORS = ['#6366f1', '#22d3ee', '#22c55e', '#f59e0b', '#ec4899', '#a855f7', '#ef4444', '#14b8a6'];
function colorFor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: config.allowedOrigins, credentials: true },
  });

  io.engine.use(sessionMiddleware);

  io.use(async (socket, next) => {
    const session = socket.request.session;
    if (!session?.userId) return next(new Error('unauthorized'));
    const user = await knex('users').where({ id: session.userId }).first();
    if (!user) return next(new Error('unauthorized'));
    socket.userId = user.id;
    socket.displayName = user.display_name;
    socket.color = colorFor(user.id);
    next();
  });

  io.on('connection', (socket) => {
    // Personal room so visibility-filtered events can target a single user's
    // sockets directly (used by per-marker private cue broadcasting).
    socket.join(`user:${socket.userId}`);

    socket.on('join-project', async ({ projectId } = {}) => {
      if (!projectId) return;
      const project = await knex('projects').where({ id: projectId }).first();
      if (!project) return socket.emit('error', { message: 'Project not found' });

      const user = await knex('users').where({ id: socket.userId }).first();
      const isOwnerOrAdmin = project.owner_id === socket.userId || !!user?.is_admin;

      const member = await knex('project_members as m')
        .leftJoin('project_roles as r', 'r.id', 'm.role_id')
        .where({ 'm.project_id': projectId, 'm.user_id': socket.userId })
        .select('m.user_id', 'r.capabilities as role_capabilities')
        .first();
      if (!member && !isOwnerOrAdmin) return socket.emit('error', { message: 'Not a member' });

      // Snapshot capabilities at join (used by broadcast filtering in M4).
      socket.capabilities = isOwnerOrAdmin
        ? new Set(ALL_CAPABILITIES)
        : new Set(toCapabilityArray(member.role_capabilities));

      // Leave any previous project room.
      for (const r of [...socket.rooms].filter((r) => r.startsWith('project:'))) socket.leave(r);

      socket.join(`project:${projectId}`);
      rooms.joinRoom(projectId, socket.id, {
        userId: socket.userId,
        displayName: socket.displayName,
        color: socket.color,
      });

      socket.emit('presence:state', { online: rooms.getOnlineUsers(projectId) });
      socket.to(`project:${projectId}`).emit('member:joined', {
        userId: socket.userId,
        displayName: socket.displayName,
        color: socket.color,
        online: rooms.getOnlineUsers(projectId),
      });
    });

    socket.on('cursor:position', ({ trackId, time } = {}) => {
      const projectId = rooms.getSocketProject(socket.id);
      if (!projectId) return;
      socket.to(`project:${projectId}`).emit('cursor:update', {
        userId: socket.userId,
        displayName: socket.displayName,
        color: socket.color,
        trackId,
        time,
      });
    });

    function handleLeave() {
      const left = rooms.leaveRoom(socket.id);
      if (!left) return;
      const { projectId, presence } = left;
      if (presence && !rooms.userStillPresent(projectId, presence.userId)) {
        socket.to(`project:${projectId}`).emit('member:left', {
          userId: presence.userId,
          online: rooms.getOnlineUsers(projectId),
        });
      }
    }

    socket.on('leave-project', handleLeave);
    socket.on('disconnect', handleLeave);
  });

  subscribeVersionEvents(io);
  return io;
}

/** Worker publishes 'version-events' on Redis; relay to the project room. */
function subscribeVersionEvents(io) {
  const sub = makeRedisConnection();
  sub.subscribe('version-events', (err) => {
    if (err) console.error('[socket] version-events subscribe failed:', err.message);
  });
  sub.on('message', (channel, message) => {
    if (channel !== 'version-events') return;
    try {
      const { projectId, ...rest } = JSON.parse(message);
      io.to(`project:${projectId}`).emit('track:version:ready', rest);
    } catch (err) {
      console.warn('[socket] bad version-event:', err.message);
    }
  });
}

export default initSocket;
