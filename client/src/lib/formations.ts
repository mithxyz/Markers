import type { Formation, FormationPlacement, FormationPosition } from '$lib/types';

export const DEFAULT_STAGE = { width: 12, depth: 8 };

/**
 * Phase 8b: join each placement with its definition's positions to produce
 * a resolved list suitable for interpolation. Placements whose definition is
 * not found (e.g. still loading) are omitted.
 */
export function resolvePlacements(
  placements: FormationPlacement[],
  defs: Formation[],
): ResolvedPlacement[] {
  const defMap = new Map(defs.map((d) => [d.id, d]));
  const out: ResolvedPlacement[] = [];
  for (const p of placements) {
    const def = defMap.get(p.formation_id);
    if (def) out.push({ ...p, positions: def.positions, name: def.name });
  }
  return out;
}

/** A placement fully joined with its definition's positions + name. */
export interface ResolvedPlacement {
  id: string;
  track_id: string;
  formation_id: string;
  name: string;
  time: number;
  beat: number | null;
  end_time: number | null;
  end_beat: number | null;
  ease?: string | null; // 11g: easing curve applied when leaving this placement
  positions: FormationPosition[];
  created_by: string | null;
}

/**
 * Apply a CSS-style easing function to a linear 0..1 fraction (11g).
 * Quad approximations that match the four standard CSS ease keywords.
 */
function applyEase(t: number, ease: string | null | undefined): number {
  switch (ease) {
    case 'ease-in':     return t * t;
    case 'ease-out':    return t * (2 - t);
    case 'ease-in-out': return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    default:            return t; // 'linear' or undefined
  }
}

/**
 * Interpolate dancer stage positions at a given time (seconds) from a list of
 * resolved formation placements. Straight-line lerp between the two surrounding
 * placements — the proven default (Pyware/Choreographic/ArrangeUs); curved paths
 * are a deferred enhancement. Before the first / after the last placement, snap.
 *
 * Returns a Map dancer_id → {x, y}. A dancer present in only one of the bracketing
 * placements holds that position; absent from both → omitted.
 */
export function interpolatePositions(
  resolved: ResolvedPlacement[],
  time: number,
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (!resolved.length) return out;

  const sorted = [...resolved].sort((a, b) => a.time - b.time);
  const holdEnd = (p: ResolvedPlacement) =>
    p.end_time != null && p.end_time > p.time ? p.end_time : p.time;

  // A placement is FIXED during its hold window [time, holdEnd].
  for (const p of sorted) {
    if (time >= p.time && time <= holdEnd(p)) return posMap(p.positions);
  }

  // Find bracketing placements: prev = last whose start ≤ t, next = first whose start > t.
  let prev: ResolvedPlacement | null = null;
  let next: ResolvedPlacement | null = null;
  for (const p of sorted) {
    if (p.time <= time) prev = p;
    else { next = p; break; }
  }

  if (!prev) return posMap(sorted[0].positions); // before first → snap to first
  if (!next) return posMap(prev.positions);       // after last → snap to last

  const from = holdEnd(prev);
  const span = next.time - from;
  const rawFrac = span > 0 ? Math.min(1, Math.max(0, (time - from) / span)) : 0;
  // 11g: apply the prev placement's easing curve (ease-in/out/in-out/linear).
  const frac = applyEase(rawFrac, prev.ease);
  const prevMap = posMap(prev.positions);
  const nextMap = posMap(next.positions);
  const ids = new Set([...prevMap.keys(), ...nextMap.keys()]);
  for (const id of ids) {
    const a = prevMap.get(id);
    const b = nextMap.get(id);
    if (a && b) out.set(id, { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac });
    else if (a) out.set(id, a);
    else if (b) out.set(id, b);
  }
  return out;
}

function posMap(positions: FormationPosition[]): Map<string, { x: number; y: number }> {
  const m = new Map<string, { x: number; y: number }>();
  for (const p of positions || []) m.set(p.dancer_id, { x: p.x, y: p.y });
  return m;
}
