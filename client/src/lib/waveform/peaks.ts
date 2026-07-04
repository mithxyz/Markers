// Frozen shared contract for the v4 peaks JSON and per-track settings.
// Every analysis block is OPTIONAL/nullable — the client must tolerate any
// missing block (the worker populates more of these tier-by-tier).
//
// Alignment law: a bucket index i in `data`/`bands`/`rms` maps to
//   time(i) = i / length * duration   (seconds)
// `transients`, `silences`, `sections` are already in seconds.

export interface PeaksTempo {
  bpm: number;
  confidence: number; // 0..1
  firstBeatSec: number; // phase anchor
  beatGrid?: number[] | null; // seconds; omitted for long tracks (derive from bpm+anchor)
  // Phase 1B (BeatNet) — all optional/additive. `downbeats` are bar-start times
  // in seconds; `meter` is e.g. "4/4"; `firstDownbeatSec` is downbeats[0].
  downbeats?: number[] | null;
  meter?: string | null;
  firstDownbeatSec?: number | null;
}

/** One waveform bucket: [normalizedAmp 0..1, [r,g,b] each 0..255]. */
export type RgbBucket = [number, [number, number, number]];

/**
 * Fetch + decode the server-baked RGB waveform artifact (Phase 1A). The artifact
 * is `{ waveformRGBHDCompressed: <base64( zlib-deflate( JSON([[amp,[r,g,b]],…]) ) )> }`,
 * matching time-line.io's wire format. Uses the native `DecompressionStream`
 * (Chrome 80+/Safari 16.4+/Firefox 113+) — no pako dependency.
 */
export async function fetchWaveformRGB(url: string): Promise<RgbBucket[]> {
  const { waveformRGBHDCompressed } = await fetch(url).then((r) => r.json());
  const bin = Uint8Array.from(atob(waveformRGBHDCompressed), (c) => c.charCodeAt(0));
  const ds = new DecompressionStream('deflate');
  const buf = await new Response(new Blob([bin]).stream().pipeThrough(ds)).arrayBuffer();
  return JSON.parse(new TextDecoder().decode(buf));
}

export interface PeaksSilence {
  start: number; // seconds
  end: number;
}

export interface PeaksSection {
  time: number; // seconds
  strength: number; // 0..1 novelty peak strength
}

export interface PeaksV4 {
  version: number;
  channels: number;
  sample_rate: number;
  length: number; // == data.length
  duration: number; // seconds — needed for the bucket->time alignment law
  data: number[]; // overall peaks 0..1
  bands?: { low: number[]; mid: number[]; high: number[] } | null;
  rms?: number[] | null; // loudness envelope, same length/alignment as data
  transients?: number[] | null; // onset times, ascending (seconds)
  tempo?: PeaksTempo | null;
  silences?: PeaksSilence[] | null;
  sections?: PeaksSection[] | null;
  novelty?: number[] | null; // optional downsampled novelty curve
}

// --- Per-track settings (stored in tracks.settings jsonb) ---

export type SnapTarget = 'off' | 'transient' | 'beat' | 'grid' | 'frame' | 'existing';

export interface TrackSnapSettings {
  target: SnapTarget;
  tolerance: number; // seconds; snap only applies within this window
  gridSec?: number; // for target === 'grid'
  zeroCross?: boolean; // post-snap nudge to nearest zero crossing
}

export interface TrackOverlaySettings {
  beatGrid: boolean;
  transients: boolean;
  rms: boolean;
  silence: boolean;
}

export interface TrackSettings {
  snap: TrackSnapSettings;
  fps: number; // SMPTE frame rate (default 30, NTSC non-drop)
  defaultView: 'simple' | 'cdj' | 'spectrogram' | 'rgb';
  overlays: TrackOverlaySettings;
  sectionsEnabled: boolean; // gate the (low-confidence) section-detection feature
}

export const DEFAULT_TRACK_SETTINGS: TrackSettings = {
  snap: { target: 'off', tolerance: 0.05, gridSec: 0.5, zeroCross: false },
  fps: 30,
  defaultView: 'simple',
  overlays: { beatGrid: false, transients: false, rms: false, silence: false },
  sectionsEnabled: false,
};

/** Merge persisted (possibly partial) settings over defaults. */
export function withSettingsDefaults(s: Partial<TrackSettings> | null | undefined): TrackSettings {
  const d = DEFAULT_TRACK_SETTINGS;
  return {
    snap: { ...d.snap, ...(s?.snap ?? {}) },
    fps: s?.fps ?? d.fps,
    defaultView: s?.defaultView ?? d.defaultView,
    overlays: { ...d.overlays, ...(s?.overlays ?? {}) },
    sectionsEnabled: s?.sectionsEnabled ?? d.sectionsEnabled,
  };
}
