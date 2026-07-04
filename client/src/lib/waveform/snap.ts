// Cue-time snapping engine. Frozen signatures (Gate 0); full logic filled in Tier 1.
//
// Given a raw time (seconds) plus a snap config and the loaded analysis context,
// return the snapped time. Pure + synchronous so it can run inline in
// TrackWorkspace.addCue / moveCue before the API write.

import type { SnapTarget } from './peaks';

export interface SnapConfig {
  target: SnapTarget;
  tolerance: number; // seconds
  gridSec?: number;
  zeroCross?: boolean;
  fps?: number; // for target === 'frame'
}

export interface SnapContext {
  duration: number;
  transients?: number[] | null;
  beatGrid?: number[] | null;
  bpm?: number | null;
  firstBeatSec?: number | null;
  existingCueTimes?: number[] | null; // exclude self when moving
  /** Optional nearest-zero-crossing resolver (from audioWs.getDecodedData()). */
  zeroCrossings?: ((t: number) => number) | null;
}

/**
 * Find the value in `values` closest to `target`. Returns `null` when the
 * array is empty/absent or when no candidate lands within `tolerance`.
 * Linear scan — arrays here are bounded (transients/beats/cues for one track).
 */
function nearestWithin(
  values: readonly number[] | null | undefined,
  target: number,
  tolerance: number,
): number | null {
  if (!values || values.length === 0) return null;
  let best: number | null = null;
  let bestDist = Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    const dist = Math.abs(v - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = v;
    }
  }
  if (best === null || bestDist > tolerance) return null;
  return best;
}

/**
 * Snap a raw cue time (seconds) to the nearest meaningful position per `cfg`,
 * using the loaded analysis data in `ctx`. Pure and synchronous so it can run
 * inline before an API write.
 *
 * Targets:
 * - `off`       — no primary snap (rawTime passes through).
 * - `frame`     — quantize to the `cfg.fps` grid (no-op if fps invalid).
 * - `grid`      — quantize to a fixed `cfg.gridSec` interval (no-op if <= 0).
 * - `beat`      — nearest beat from `ctx.beatGrid`, or derived analytically from
 *                 `ctx.bpm` + `ctx.firstBeatSec`; only applied within tolerance.
 * - `transient` — nearest detected transient within `cfg.tolerance`.
 * - `existing`  — nearest other cue time within `cfg.tolerance` (caller excludes self).
 *
 * Tolerance-gated targets (`beat`/`transient`/`existing`) return `rawTime`
 * unchanged when nothing qualifies. The result is always clamped to
 * `[0, ctx.duration]`.
 *
 * Zero-crossing post-step (orthogonal): when `cfg.zeroCross` is true and
 * `ctx.zeroCrossings` is provided, the primary result is nudged to the nearest
 * zero crossing for every target (including `off`); a non-finite resolver
 * result is ignored.
 */
export function snapTime(rawTime: number, cfg: SnapConfig, ctx: SnapContext): number {
  let snapped = rawTime;

  switch (cfg.target) {
    case 'off':
      // No primary snap.
      break;

    case 'frame': {
      const fps = cfg.fps;
      if (typeof fps === 'number' && Number.isFinite(fps) && fps > 0) {
        snapped = Math.round(rawTime * fps) / fps;
      }
      break;
    }

    case 'grid': {
      const gridSec = cfg.gridSec;
      if (typeof gridSec === 'number' && Number.isFinite(gridSec) && gridSec > 0) {
        snapped = Math.round(rawTime / gridSec) * gridSec;
      }
      break;
    }

    case 'beat': {
      // Prefer an explicit beat grid; fall back to analytic bpm derivation.
      const fromGrid = nearestWithin(ctx.beatGrid, rawTime, cfg.tolerance);
      if (fromGrid !== null) {
        snapped = fromGrid;
      } else if (
        !ctx.beatGrid?.length &&
        typeof ctx.bpm === 'number' &&
        Number.isFinite(ctx.bpm) &&
        ctx.bpm > 0 &&
        typeof ctx.firstBeatSec === 'number' &&
        Number.isFinite(ctx.firstBeatSec)
      ) {
        const period = 60 / ctx.bpm;
        const n = Math.round((rawTime - ctx.firstBeatSec) / period);
        const beat = ctx.firstBeatSec + n * period;
        if (Math.abs(beat - rawTime) <= cfg.tolerance) {
          snapped = beat;
        }
      }
      break;
    }

    case 'transient': {
      const hit = nearestWithin(ctx.transients, rawTime, cfg.tolerance);
      if (hit !== null) snapped = hit;
      break;
    }

    case 'existing': {
      const hit = nearestWithin(ctx.existingCueTimes, rawTime, cfg.tolerance);
      if (hit !== null) snapped = hit;
      break;
    }
  }

  // Orthogonal zero-crossing refinement, applied to every target.
  if (cfg.zeroCross && ctx.zeroCrossings) {
    const z = ctx.zeroCrossings(snapped);
    if (Number.isFinite(z)) snapped = z;
  }

  // Clamp into the track bounds.
  if (snapped < 0) snapped = 0;
  if (Number.isFinite(ctx.duration) && snapped > ctx.duration) snapped = ctx.duration;

  return snapped;
}
