/**
 * In-memory presence tracking (single Node process). Maps projectId -> set of
 * online sockets, and socketId -> {projectId,userId,...} for cleanup.
 * If we ever run multiple web processes, swap to the Socket.IO Redis adapter.
 */
const projectSockets = new Map(); // projectId -> Map<socketId, presence>
const socketIndex = new Map(); // socketId -> projectId

export function joinRoom(projectId, socketId, presence) {
  if (!projectSockets.has(projectId)) projectSockets.set(projectId, new Map());
  projectSockets.get(projectId).set(socketId, presence);
  socketIndex.set(socketId, projectId);
}

export function leaveRoom(socketId) {
  const projectId = socketIndex.get(socketId);
  if (!projectId) return null;
  const map = projectSockets.get(projectId);
  const presence = map?.get(socketId) || null;
  map?.delete(socketId);
  if (map && map.size === 0) projectSockets.delete(projectId);
  socketIndex.delete(socketId);
  return { projectId, presence };
}

export function getSocketProject(socketId) {
  return socketIndex.get(socketId) || null;
}

/** Distinct online users in a project (deduped by userId). */
export function getOnlineUsers(projectId) {
  const map = projectSockets.get(projectId);
  if (!map) return [];
  const byUser = new Map();
  for (const p of map.values()) byUser.set(p.userId, { userId: p.userId, displayName: p.displayName, color: p.color });
  return [...byUser.values()];
}

/** Is this the user's last socket in the project? (for member:left) */
export function userStillPresent(projectId, userId) {
  const map = projectSockets.get(projectId);
  if (!map) return false;
  for (const p of map.values()) if (p.userId === userId) return true;
  return false;
}
