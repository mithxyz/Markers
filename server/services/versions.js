import { knex } from '../db/knex.js';
import { timeToBeat } from '../lib/beats.js';

export const REALIGN_THRESHOLD = 0.25; // seconds

/** Decide whether a version swap needs a realign decision from the user. */
export function needsRealign(oldDuration, newDuration) {
  if (!oldDuration || !newDuration) return false;
  return Math.abs(newDuration - oldDuration) > REALIGN_THRESHOLD;
}

/** Transform a cue's time per the chosen realign strategy. */
function realignTime(time, { strategy, oldDuration, newDuration, offset }) {
  switch (strategy) {
    case 'scale':
      return oldDuration > 0 ? (time * newDuration) / oldDuration : time;
    case 'offset':
      return Math.max(0, time + (offset ?? 0));
    case 'keep':
    default:
      return time;
  }
}

/**
 * Activate a version as a track's current media. Snapshots the current cue
 * list (for rollback), then realigns cues per strategy. All in one transaction.
 * Returns { cues } (the realigned set).
 */
export async function activateVersion({ track, version, strategy, offset, userId }) {
  const oldVersion = track.current_version_id
    ? await knex('track_versions').where({ id: track.current_version_id }).first()
    : null;
  const oldDuration = oldVersion?.media_duration || 0;
  const newDuration = version.media_duration || 0;

  return knex.transaction(async (trx) => {
    const cues = await trx('cues').where({ track_id: track.id }).whereNull('deleted_at');

    // Snapshot the cue list as it stood under the outgoing version.
    await trx('cue_snapshots').insert({
      track_id: track.id,
      version_id: oldVersion?.id || null,
      cues: JSON.stringify(cues),
      reason: 'version_swap',
      created_by: userId,
    });

    // Realign cue times if a strategy other than keep was chosen. Beats follow
    // the audio: after the time shift, re-derive start_beat/end_beat from the new
    // time and the incoming version's BPM (Phase 2a) so they stay consistent.
    if (strategy && strategy !== 'keep') {
      const newBpm = version.bpm && version.bpm > 0 ? Number(version.bpm) : null;
      for (const cue of cues) {
        const newTime = realignTime(cue.time, { strategy, oldDuration, newDuration, offset });
        const newEnd = cue.end_time != null ? realignTime(cue.end_time, { strategy, oldDuration, newDuration, offset }) : null;
        await trx('cues')
          .where({ id: cue.id })
          .update({
            time: newTime,
            end_time: newEnd,
            start_beat: timeToBeat(newTime, newBpm),
            end_beat: newEnd != null ? timeToBeat(newEnd, newBpm) : null,
            lock_version: trx.raw('lock_version + 1'),
            updated_at: trx.fn.now(),
          });
      }
    }

    await trx('tracks').where({ id: track.id }).update({ current_version_id: version.id, updated_at: trx.fn.now() });

    const updated = await trx('cues').where({ track_id: track.id }).whereNull('deleted_at').orderBy('time');
    return { cues: updated, oldDuration, newDuration };
  });
}

/**
 * Roll back to a previous version. Optionally restore the cue snapshot taken
 * when that version was active.
 */
export async function rollbackVersion({ track, version, restoreCues, userId }) {
  return knex.transaction(async (trx) => {
    // Snapshot current cues first (so rollback is itself reversible).
    const current = await trx('cues').where({ track_id: track.id }).whereNull('deleted_at');
    await trx('cue_snapshots').insert({
      track_id: track.id,
      version_id: track.current_version_id,
      cues: JSON.stringify(current),
      reason: 'rollback',
      created_by: userId,
    });

    let cues = current;
    if (restoreCues) {
      // Find the most recent snapshot captured for the target version.
      const snap = await trx('cue_snapshots')
        .where({ track_id: track.id, version_id: version.id })
        .orderBy('created_at', 'desc')
        .first();
      if (snap) {
        const restored = typeof snap.cues === 'string' ? JSON.parse(snap.cues) : snap.cues;

        // Fallback lane for snapshots captured before lane_id was added (Phase 2b).
        // Resolves once per rollback — the first cue_lane belonging to this track's project.
        let defaultLaneId = null;
        if (restored.some((c) => !c.lane_id)) {
          const firstLane = await trx('cue_lanes')
            .join('departments', 'cue_lanes.department_id', 'departments.id')
            .join('tracks', 'tracks.project_id', 'departments.project_id')
            .where('tracks.id', track.id)
            .orderBy('departments.sort_order')
            .orderBy('cue_lanes.sort_order')
            .first('cue_lanes.id as id');
          defaultLaneId = firstLane?.id ?? null;
        }

        await trx('cues').where({ track_id: track.id }).del();
        if (restored.length) {
          // Spread the full snapshot row so every column (including any added after
          // this code was written) is preserved — never hand-list fields here.
          // Only override the handful of managed fields.
          await trx('cues').insert(
            restored.map((c) => {
              const { created_at, updated_at, deleted_at, ...rest } = c;
              return {
                ...rest,
                track_id: track.id,
                lane_id: c.lane_id ?? defaultLaneId,
                lock_version: (c.lock_version || 0) + 1,
                updated_by: userId,
                // Timestamp columns are set by the DB default; do not pass stale values.
              };
            })
          );
        }
        cues = await trx('cues').where({ track_id: track.id }).whereNull('deleted_at').orderBy('time');
      }
    }

    await trx('tracks').where({ id: track.id }).update({ current_version_id: version.id, updated_at: trx.fn.now() });
    return { cues };
  });
}
