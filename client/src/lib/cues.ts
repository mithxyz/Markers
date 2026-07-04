import type { Cue, CueStatus } from '$lib/types';
import type { Department } from '$lib/api';

// Client-side mirror of the server's per-cue authorization (server/routes/cues.js).
// `privileged` = project owner or global admin (full access incl. others' private).

export function isCueOwner(cue: Cue, userId: string | undefined): boolean {
  return !!cue.owner_id && cue.owner_id === userId;
}

// Visibility is the primary gate: only the owner (or a privileged owner/admin)
// can touch private / public-read-only cues. Capabilities apply to public_edit only.
export function canEditCue(cue: Cue, userId: string | undefined, caps: Set<string>, privileged = false): boolean {
  if (privileged) return true;
  if (isCueOwner(cue, userId)) return true;
  if (cue.visibility === 'public_edit' && (caps.has('create_cues') || caps.has('edit_others_cues'))) return true;
  return false;
}

export function canDeleteCue(cue: Cue, userId: string | undefined, caps: Set<string>, privileged = false): boolean {
  if (privileged) return true;
  if (isCueOwner(cue, userId)) return true;
  if (cue.visibility === 'public_edit' && caps.has('delete_others_cues')) return true;
  return false;
}

/** Owner (or privileged) may change a cue's visibility / public-link exposure. */
export function canSetVisibility(cue: Cue, userId: string | undefined, privileged = false): boolean {
  return privileged || isCueOwner(cue, userId);
}

export const VISIBILITY_LABEL: Record<string, string> = {
  private: 'Private',
  public_ro: 'Public (read-only)',
  public_edit: 'Public (shared)',
};

// Phase 2c production status (matches server CUE_STATUSES).
export const STATUS_LABEL: Record<CueStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
  blocked: 'Blocked',
};
export const STATUS_DOT: Record<CueStatus, string> = {
  not_started: '#71717a', // zinc
  in_progress: '#eab308', // amber
  done: '#22c55e', // green
  blocked: '#ef4444', // red
};

/**
 * The colour a cue actually renders with (Phase 2c). When `color_inherited`, use
 * the cue's lane → department colour; otherwise its explicit `marker_color`.
 */
export function effectiveCueColor(cue: Cue, departments: Department[] = []): string {
  if (cue.color_inherited) {
    for (const d of departments) {
      if (d.lanes.some((l) => l.id === cue.lane_id)) return d.color;
    }
  }
  return cue.marker_color;
}
