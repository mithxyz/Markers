import type { TrackVersion } from '$lib/upload/presignedUpload';

export type { TrackVersion };

export interface Track {
  id: string;
  project_id: string;
  name: string;
  kind: 'audio' | 'video';
  current_version_id: string | null;
  sort_order: number;
  versions: TrackVersion[];
  // 10-meta: optional catalog ID and user notes
  id_number: string | null;
  notes: string | null;
}

export function currentVersion(track: Track): TrackVersion | null {
  return track.versions.find((v) => v.id === track.current_version_id) || track.versions.at(-1) || null;
}

// 10-playlists: named ordered setlists per project
export interface PlaylistTrack {
  id: string;
  playlist_id: string;
  track_id: string;
  sort_order: number;
}

export interface Playlist {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
  created_by: string | null;
  tracks: PlaylistTrack[];
}

export type CueVisibility = 'private' | 'public_ro' | 'public_edit';
export type CueStatus = 'not_started' | 'in_progress' | 'done' | 'blocked';
export type OscValueType = 'int' | 'float' | 'string' | 'bool';
export type Automation = 'none' | 'ramp_up' | 'ramp_down' | 'strobe' | 'pulse';
export type TriggerOn = 'none' | 'enter' | 'exit' | 'both';

// --- Phase 3c dance formations (Phase 8b: split into definition + placement) ---
export interface Dancer {
  id: string;
  project_id: string;
  name: string;
  color: string;
  label: string;
  sort_order: number;
  image_s3_key?: string | null; // Phase 8d: avatar — presigned display URL in imageUrl
  imageUrl?: string | null;
}

export interface FormationPosition {
  dancer_id: string;
  x: number; // 0..1 stage-left → right
  y: number; // 0..1 upstage → downstage
}

/** Phase 8b: project-scoped reusable formation definition. Carries positions but no
 *  timeline location — placed on a track via FormationPlacement. One definition can
 *  be referenced by many placements; editing the def updates every placement. */
export interface Formation {
  id: string;
  project_id: string;
  name: string;
  positions: FormationPosition[];
  created_by: string | null;
}

/** Phase 8b: track-scoped timeline placement of a formation definition. Carries the
 *  beat/time start and optional hold end (end_time/end_beat), mirroring the cues model. */
export interface FormationPlacement {
  id: string;
  track_id: string;
  formation_id: string;
  time: number;
  beat: number | null;
  end_time: number | null;
  end_beat: number | null;
  ease?: string | null; // 11g: transition easing curve out of this placement
  created_by: string | null;
}

export interface StageConfig {
  width: number;
  depth: number;
}

/** Phase DJ Builder: a production show element placed on a track timeline. */
export interface ShowElement {
  id: string;
  track_id: string;
  type: string; // pyro | laser | co2 | flames | confetti | lighting | haze | video | lyrics | spotlight | fx
  time: number;
  end_time: number | null;
  beat: number | null;
  end_beat: number | null;
  name: string | null;
  note: string | null;
  intensity: number | null; // 0–100
  created_by: string | null;
}

export interface Marker {
  id: string;
  track_id: string;
  time: number;
  beat: number | null;
  name: string;
  color: string;
  created_by: string | null;
}

export interface Cue {
  id: string;
  track_id: string;
  origin_version_id: string | null;
  cue_number: number | null;
  name: string;
  time: number;
  end_time: number | null;
  // Phase 2a: beat-positioned coordinates (beats from t=0). Nullable — present
  // once the track has a detected BPM; `time` stays the fallback.
  start_beat: number | null;
  end_beat: number | null;
  // Phase 2b: the lane (within a department) this cue belongs to.
  lane_id: string;
  // Phase 2c production fields.
  status: CueStatus;
  color_inherited: boolean;
  deleted_at?: string | null;
  // Phase 2d — Resolume OSC + automation (store-only).
  osc_address: string | null;
  osc_value: string | null;
  osc_value_type: OscValueType;
  automation: Automation;
  advanced_payload: number[] | null;
  // Phase 3a — live MIDI trigger.
  midi_note: number | null;
  midi_channel: number;
  midi_velocity: number;
  trigger_on: TriggerOn;
  description: string;
  fade: number;
  marker_color: string;
  sort_order: number;
  lock_version: number;
  owner_id: string | null;
  visibility: CueVisibility;
  anon_visible: boolean;
  created_by: string | null;
  updated_by: string | null;
}
