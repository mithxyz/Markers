/**
 * Socket.IO broadcast helpers for REST handlers (io is attached to the Express
 * app at startup). payload.byUserId lets clients skip echoes of their own actions.
 */
export function emitToProject(req, projectId, event, payload) {
  const io = req.app.get('io');
  if (io) io.to(`project:${projectId}`).emit(event, payload);
}

export function room(projectId) {
  return `project:${projectId}`;
}

/**
 * Cue broadcasts respect per-marker visibility so private cues never reach other
 * members. Private cues go only to the OWNER's personal room (`user:<id>`, joined
 * on connect); public cues (public_ro / public_edit) go to the project room.
 */
export function emitCueCreated(req, projectId, cue, byUserId) {
  const io = req.app.get('io');
  if (!io) return;
  const target = cue.visibility === 'private' ? `user:${cue.owner_id}` : `project:${projectId}`;
  io.to(target).emit('cue:created', { cue, byUserId });
}

export function emitCueDeleted(req, projectId, cue, byUserId) {
  const io = req.app.get('io');
  if (!io) return;
  const target = cue.visibility === 'private' ? `user:${cue.owner_id}` : `project:${projectId}`;
  io.to(target).emit('cue:deleted', { cueId: cue.id, trackId: cue.track_id, byUserId });
}

/**
 * Update broadcast handles visibility TRANSITIONS so non-owner members add/drop
 * the cue correctly. The owner's sessions always skip their own echo (byUserId),
 * so a project-room cue:deleted on a public→private flip removes it for everyone
 * EXCEPT the owner, who keeps it via the owner-room cue:updated.
 */
export function emitCueUpdated(req, projectId, oldCue, newCue, byUserId) {
  const io = req.app.get('io');
  if (!io) return;
  const proj = `project:${projectId}`;
  const ownerRoom = `user:${newCue.owner_id}`;
  const wasPublic = oldCue.visibility !== 'private';
  const isPublic = newCue.visibility !== 'private';

  if (wasPublic && isPublic) {
    io.to(proj).emit('cue:updated', { cue: newCue, byUserId });
  } else if (!wasPublic && !isPublic) {
    io.to(ownerRoom).emit('cue:updated', { cue: newCue, byUserId });
  } else if (!wasPublic && isPublic) {
    // became public: other members add it; owner reconciles via its own room
    io.to(proj).emit('cue:created', { cue: newCue, byUserId });
    io.to(ownerRoom).emit('cue:updated', { cue: newCue, byUserId });
  } else {
    // became private: other members drop it; owner keeps + updates it
    io.to(proj).emit('cue:deleted', { cueId: newCue.id, trackId: newCue.track_id, byUserId });
    io.to(ownerRoom).emit('cue:updated', { cue: newCue, byUserId });
  }
}
