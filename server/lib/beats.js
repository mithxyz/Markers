import { knex } from '../db/knex.js';

/**
 * Beat <-> time conversion (Phase 2a). Beats are counted from t=0 at the track's
 * BPM: `beat = time × bpm/60`, `time = beat × 60/bpm`. This matches the footer
 * math observed in EdiTour (310.4s @ 150 BPM → 776 beats) and keeps the mapping
 * trivially reversible. The phase anchor (first-downbeat offset) is intentionally
 * NOT folded in here — musical alignment is handled separately by the snap engine.
 */
export function timeToBeat(time, bpm) {
  if (!(bpm > 0) || time == null || !Number.isFinite(Number(time))) return null;
  return Number(time) * (bpm / 60);
}

export function beatToTime(beat, bpm) {
  if (!(bpm > 0) || beat == null || !Number.isFinite(Number(beat))) return null;
  return Number(beat) * (60 / bpm);
}

/** The BPM of a track's current version (null if none / not analyzed yet). */
export async function currentVersionBpm(trackOrId) {
  const track =
    typeof trackOrId === 'string'
      ? await knex('tracks').where({ id: trackOrId }).first('current_version_id')
      : trackOrId;
  if (!track?.current_version_id) return null;
  const v = await knex('track_versions').where({ id: track.current_version_id }).first('bpm');
  const bpm = v?.bpm;
  return bpm && bpm > 0 ? Number(bpm) : null;
}

/**
 * Reconcile a cue write's beat/time coordinates given the track BPM, mutating and
 * returning `fields`. Beats are canonical when present: if the caller supplied
 * `start_beat`, derive `time` from it; otherwise if it supplied `time`, derive
 * `start_beat`. Same for `end_beat`/`end_time`. With no BPM, beats can't be
 * computed and `time` stands alone (start_beat left untouched / null).
 *
 * `existing` (the current row on PATCH) lets a time-only edit refresh start_beat
 * and vice-versa even when the counterpart field isn't in the patch.
 */
export function reconcileBeatTime(fields, bpm, existing = null) {
  const has = (k) => Object.prototype.hasOwnProperty.call(fields, k);

  // --- start position ---
  if (has('start_beat') && fields.start_beat != null) {
    const t = beatToTime(fields.start_beat, bpm);
    if (t != null) fields.time = t;
  } else if (has('time')) {
    const b = timeToBeat(fields.time, bpm);
    fields.start_beat = b; // null when no bpm — acceptable, time is the anchor
  }

  // --- end position --- (null end clears end_beat)
  if (has('end_beat') && fields.end_beat != null) {
    const t = beatToTime(fields.end_beat, bpm);
    if (t != null) fields.end_time = t;
  } else if (has('end_time')) {
    fields.end_beat = fields.end_time == null ? null : timeToBeat(fields.end_time, bpm);
  }

  return fields;
}

export default { timeToBeat, beatToTime, currentVersionBpm, reconcileBeatTime };
