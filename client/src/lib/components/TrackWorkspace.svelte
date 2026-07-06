<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type WaveSurfer from 'wavesurfer.js';
  import { api, type Department, type ProjectType } from '$lib/api';
  import type { Track, Cue, Marker, Dancer, Formation, FormationPlacement, StageConfig, FormationPosition } from '$lib/types';
  import StageGrid from './StageGrid.svelte';
  import LaneStrip from './LaneStrip.svelte';
  import { interpolatePositions, resolvePlacements, DEFAULT_STAGE } from '$lib/formations';
  import { printFormationSheet } from '$lib/formationSheet';
  import { currentVersion } from '$lib/types';
  import { ui } from '$lib/stores/ui.svelte';
  import { getSocket, sendCursor } from '$lib/socket';
  import { auth } from '$lib/stores/auth.svelte';
  import { uploadVideoLayer } from '$lib/upload/presignedUpload';
  import WaveformTrack from './WaveformTrack.svelte';
  import CueList from './CueList.svelte';
  import CueEditor from './CueEditor.svelte';
  import VersionBar from './VersionBar.svelte';
  import VideoPanel from './VideoPanel.svelte';
  import Filmstrip from './Filmstrip.svelte';
  import { withSettingsDefaults } from '$lib/waveform/peaks';
  import { midi } from '$lib/midi.svelte';
  import { snapTime, type SnapContext } from '$lib/waveform/snap';
  import { formatTime, formatSmpte } from '$lib/utils/timecode';
  import { canEditCue, canDeleteCue, canSetVisibility as canSetCueVisibility } from '$lib/cues';
  import type { ShowElement } from '$lib/types';
  import { SHOW_ELEMENT_TYPES, getElementType } from '$lib/showElementTypes';
  import ShowElementLanes from './ShowElementLanes.svelte';

  let {
    projectId,
    track,
    canEdit = false,
    capabilities = [],
    privileged = false,
    departments = [],
    myDepartmentIds = [],
    dancers = [],
    formations = [],
    stage = DEFAULT_STAGE,
    projectType = 'general',
    onTrackChanged,
  }: {
    projectId: string;
    track: Track;
    canEdit?: boolean;
    capabilities?: string[];
    privileged?: boolean;
    departments?: Department[];
    myDepartmentIds?: string[];
    dancers?: Dancer[];
    formations?: Formation[]; // Phase 8b: project-scoped definition library (from store)
    stage?: StageConfig;
    projectType?: ProjectType;
    onTrackChanged?: () => void;
  } = $props();

  const danceMode = $derived(projectType === 'dance');

  // "My cues" focus filter (Phase 3b): show only cues in departments I'm assigned
  // to. Display-only — the trigger engine + loop/seek still see every cue.
  let myCuesOnly = $state(false);

  // Per-cue authorization (mirrors server/routes/cues.js).
  const caps = $derived(new Set(capabilities));
  const uid = $derived(auth.user?.id);
  const cueEditable = (c: Cue) => canEditCue(c, uid, caps, privileged);
  const cueDeletable = (c: Cue) => canDeleteCue(c, uid, caps, privileged);

  let mediaUrl = $state('');
  let waveformUrl = $state('');
  let cues = $state<Cue[]>([]);
  let markers = $state<Marker[]>([]);
  // Phase 8b: formation placements (track-scoped, loaded in dance mode).
  // Formation definitions come from the `formations` prop (project store).
  let placements = $state<FormationPlacement[]>([]);
  let selectedPlacementId = $state<string | null>(null);
  const selectedPlacement = $derived(placements.find((p) => p.id === selectedPlacementId) ?? null);
  // The definition referenced by the selected placement; patching positions goes to the def.
  const selectedDef = $derived(
    selectedPlacement ? (formations.find((f) => f.id === selectedPlacement.formation_id) ?? null) : null
  );
  const stageEditable = $derived(canEdit && !!selectedDef);
  // Optimistic overlay for drag-while-editing (keyed by def id → new positions).
  let pendingDefPositions = $state<Map<string, FormationPosition[]>>(new Map());
  // Effective defs with pending drag overrides applied.
  const effectiveDefs = $derived(
    formations.map((f) => {
      const pending = pendingDefPositions.get(f.id);
      return pending ? { ...f, positions: pending } : f;
    })
  );

  // lane_id -> department_id, for the "My cues" filter (declared after `cues`).
  const laneToDept = $derived.by(() => {
    const m = new Map<string, string>();
    for (const d of departments) for (const l of d.lanes) m.set(l.id, d.id);
    return m;
  });
  const visibleCues = $derived(
    myCuesOnly && myDepartmentIds.length
      ? cues.filter((c) => myDepartmentIds.includes(laneToDept.get(c.lane_id) ?? ''))
      : cues
  );
  let selectedCueId = $state<string | null>(null);
  let editingCue = $state<Cue | null>(null);
  let loading = $state(true);
  let wave = $state<WaveformTrack>();
  let audioWs = $state<WaveSurfer | null>(null);
  let videos = $state<Array<{ id: string; status: string; offset_seconds: number }>>([]);
  let uploadingVideo = $state(false);
  let videoProgress = $state(0);
  let waveView = $state<'simple' | 'cdj' | 'spectrogram' | 'rgb'>('simple');
  let spectrogramUrl = $state<string | null>(null);
  let waveformRgbUrl = $state<string | null>(null);
  let regenerating = $state(false);

  // Per-track settings (snap config, overlay toggles, fps). Seeded from the
  // track row, persisted via a debounced PATCH (the offset_seconds precedent),
  // and kept in sync across collaborators via `track:settings:updated`.
  let settings = $state(withSettingsDefaults((track as { settings?: unknown }).settings as any));
  // Latest analysis surfaced by WaveformTrack after it parses the peaks JSON —
  // feeds the snap engine (transients/beat-grid) and overlay state.
  let analysis = $state<{
    rms: number[] | null;
    transients: number[] | null;
    duration: number;
    tempo: any;
    bands: any;
    silences: { start: number; end: number }[] | null;
    sections: { time: number; strength: number }[] | null;
  } | null>(null);

  // Tier 2 ephemeral UI state (not persisted): SMPTE display, beat-anchor nudge,
  // loop toggle, playhead time, and the loaded filmstrip for the synced video.
  let smpteMode = $state(false);
  let beatAnchorOffset = $state(0);
  let loopOn = $state(false);
  let follow = $state(false); // 4b: keep the playhead centred while playing
  let showLanes = $state(false); // 4d: department swim-lane strip
  let showElements = $state(false); // DJ Show Builder reference lanes
  let showElementsData = $state<ShowElement[]>([]);
  let waveScroll = $state<{ scrollLeft: number; scrollWidth: number; clientWidth: number } | null>(null); // 5c: lane sync
  let loopIn = $state<number | null>(null); // 4b: manual IN/OUT loop points
  let loopOut = $state<number | null>(null);
  let currentTime = $state(0);
  let isPlaying = $state(false);
  let filmstrip = $state<{ url: string | null; meta: any } | null>(null);

  // Phase 8b: resolve placements (join with defs) then interpolate at the playhead.
  const resolvedPlacements = $derived(resolvePlacements(placements, effectiveDefs));
  const livePositions = $derived(interpolatePositions(resolvedPlacements, currentTime));
  const stagePositions = $derived(
    selectedDef
      ? new Map(
          (pendingDefPositions.get(selectedDef.id) ?? selectedDef.positions).map((p) => [
            p.dancer_id,
            { x: p.x, y: p.y },
          ])
        )
      : livePositions
  );

  // Phase 3a — live MIDI Show mode. The playhead crossing each cue fires its MIDI
  // trigger out the selected device. `prevTime` tracks playback to detect crossings.
  let showMode = $state(false);
  let midiOutId = $state('');
  let prevTime = 0;

  async function enableMidi() {
    const ok = await midi.enable();
    if (ok) midiOutId ||= midi.outputs[0]?.id ?? '';
    else if (midi.error) ui.toast(midi.error, 'error');
  }

  // Fire MIDI for any cue whose trigger point falls in (a, b]. enter/exit = a
  // momentary pulse; both = sustained Note On at enter, Note Off at exit.
  function fireCrossings(a: number, b: number) {
    if (!midiOutId) return;
    for (const c of cues) {
      if (c.trigger_on === 'none' || c.midi_note == null) continue;
      const enter = c.time;
      const exit = c.end_time;
      const crossedEnter = a < enter && enter <= b;
      if (c.trigger_on === 'enter' && crossedEnter) {
        midi.pulse(midiOutId, c.midi_channel, c.midi_note, c.midi_velocity);
      } else if (c.trigger_on === 'exit') {
        const pt = exit ?? enter;
        if (a < pt && pt <= b) midi.pulse(midiOutId, c.midi_channel, c.midi_note, c.midi_velocity);
      } else if (c.trigger_on === 'both') {
        if (exit != null) {
          if (crossedEnter) midi.noteOn(midiOutId, c.midi_channel, c.midi_note, c.midi_velocity);
          if (a < exit && exit <= b) midi.noteOff(midiOutId, c.midi_channel, c.midi_note);
        } else if (crossedEnter) {
          midi.pulse(midiOutId, c.midi_channel, c.midi_note, c.midi_velocity);
        }
      }
    }
  }

  // Clock readout honours the SMPTE toggle.
  function fmtClock(t: number): string {
    return smpteMode ? formatSmpte(t, settings.fps) : formatTime(t);
  }
  // Jump the playhead to the previous/next cue relative to the current time.
  function seekCue(dir: number) {
    const sorted = [...cues].sort((a, b) => a.time - b.time);
    const eps = 0.06;
    const target =
      dir > 0
        ? sorted.find((c) => c.time > currentTime + eps)
        : [...sorted].reverse().find((c) => c.time < currentTime - eps);
    if (target) {
      wave?.seekTo(target.time);
      currentTime = target.time;
      selectedCueId = target.id;
    }
  }

  const base = $derived(`/projects/${projectId}/tracks/${track.id}`);
  // 7c: up to 3 simultaneous synced videos; first ready layer stays the filmstrip source.
  const readyVideos = $derived(videos.filter((v) => v.status === 'ready').slice(0, 3));
  const readyVideo = $derived(readyVideos[0] ?? null); // kept for filmstrip compat

  // Loop region = selected cue → next cue (or +8s if it's the last cue).
  const loopRegion = $derived.by(() => {
    const none = { start: null as number | null, end: null as number | null };
    if (!loopOn || !selectedCueId) return none;
    const sorted = [...cues].sort((a, b) => a.time - b.time);
    const i = sorted.findIndex((c) => c.id === selectedCueId);
    if (i < 0) return none;
    const start = sorted[i].time;
    const dur = analysis?.duration ?? 0;
    const end = i + 1 < sorted.length ? sorted[i + 1].time : start + Math.min(8, Math.max(1, dur - start));
    return { start, end };
  });

  // Effective loop (4b): a manual IN/OUT range wins; otherwise the cue-based loop.
  const effectiveLoop = $derived.by(() => {
    if (loopIn != null && loopOut != null && loopOut > loopIn) return { start: loopIn, end: loopOut };
    return loopRegion;
  });

  // bar.beat readout (4b) from the detected grid: beat = (t - firstBeat)·bpm/60.
  const barBeat = $derived.by(() => {
    const tp = analysis?.tempo;
    if (!tp?.bpm) return null;
    const bpb = parseInt(String(tp.meter || '4/4').split('/')[0], 10) || 4;
    const beat = (currentTime - (tp.firstBeatSec ?? 0)) * tp.bpm / 60;
    if (beat < 0) return null;
    return `${Math.floor(beat / bpb) + 1}.${Math.floor(beat % bpb) + 1}`;
  });

  // Pull the filmstrip sprite URL for the ready video layer (video media route).
  $effect(() => {
    const rv = readyVideo;
    if (!rv) {
      filmstrip = null;
      return;
    }
    api
      .get<{ filmstripUrl: string | null; filmstripMeta: any }>(`${base}/video/${rv.id}/media`)
      .then((m) => (filmstrip = { url: m.filmstripUrl, meta: m.filmstripMeta }))
      .catch(() => (filmstrip = null));
  });

  onMount(async () => {
    try {
      await loadMedia();
      const { cues: c } = await api.get<{ cues: Cue[] }>(`${base}/cues`);
      cues = c;
      const { markers: mk } = await api.get<{ markers: Marker[] }>(`${base}/markers`);
      markers = mk;
      if (danceMode) {
        const { placements: pl } = await api.get<{ placements: FormationPlacement[] }>(`${base}/formation-placements`);
        placements = pl;
      }
      await loadVideos();
      // Lazy-load show elements when the toggle is first turned on (see $effect below).
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    } finally {
      loading = false;
    }
  });

  // Fetch a fresh presigned media + waveform URL. Each call returns a new
  // signed URL, so updating these props makes WaveformTrack reload + re-fetch
  // peaks (used on mount and after a regenerate finishes).
  async function loadMedia() {
    const cv = currentVersion(track);
    if (!cv) return;
    const m = await api.get<{ mediaUrl: string; waveformUrl: string | null; waveformRgbUrl: string | null; spectrogramUrl: string | null }>(`${base}/versions/${cv.id}/media`);
    mediaUrl = m.mediaUrl;
    waveformUrl = m.waveformUrl || '';
    waveformRgbUrl = m.waveformRgbUrl || null;
    spectrogramUrl = m.spectrogramUrl || null;
  }

  async function loadVideos() {
    const { videos: v } = await api.get<{ videos: typeof videos }>(`${base}/video`);
    videos = v;
  }

  // Read a video file's duration client-side before uploading.
  function readDuration(file: File): Promise<number> {
    return new Promise((resolve) => {
      const el = document.createElement('video');
      el.preload = 'metadata';
      el.onloadedmetadata = () => {
        URL.revokeObjectURL(el.src);
        resolve(el.duration || 0);
      };
      el.onerror = () => resolve(0);
      el.src = URL.createObjectURL(file);
    });
  }

  async function addVideo(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      ui.toast('Please choose a video file', 'error');
      return;
    }
    uploadingVideo = true;
    videoProgress = 0;
    try {
      const duration = await readDuration(file);
      await uploadVideoLayer(projectId, track.id, file, { duration, onProgress: (p) => (videoProgress = p) });
      ui.toast('Video synced', 'success');
      await loadVideos();
    } catch (err) {
      ui.toast((err as Error).message, 'error');
    } finally {
      uploadingVideo = false;
      (e.target as HTMLInputElement).value = '';
    }
  }

  async function regenerate() {
    const cv = currentVersion(track);
    if (!cv) return;
    regenerating = true;
    try {
      await api.post(`${base}/versions/${cv.id}/reprocess`, {});
      ui.toast('Regenerating waveform — this view will refresh when it’s ready', 'info');
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    } finally {
      regenerating = false;
    }
  }

  async function removeVideo(id: string) {
    try {
      await api.del(`${base}/video/${id}`);
      await loadVideos();
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  // Live cue sync — apply events from OTHER users (skip our own echoes).
  const socket = getSocket();
  const myId = () => auth.user?.id;

  function onCueCreated({ cue, byUserId }: { cue: Cue; byUserId: string }) {
    if (cue.track_id !== track.id || byUserId === myId()) return;
    if (!cues.find((c) => c.id === cue.id)) cues = [...cues, cue];
  }
  function onCueUpdated({ cue, byUserId }: { cue: Cue; byUserId: string }) {
    if (cue.track_id !== track.id || byUserId === myId()) return;
    // Upsert: a visibility transition (private→public) arrives as an update for a
    // cue this client may not have seen yet.
    cues = cues.some((c) => c.id === cue.id) ? cues.map((c) => (c.id === cue.id ? cue : c)) : [...cues, cue];
  }
  function onCueDeleted({ cueId, trackId, byUserId }: { cueId: string; trackId: string; byUserId: string }) {
    if (trackId !== track.id || byUserId === myId()) return;
    cues = cues.filter((c) => c.id !== cueId);
    if (selectedCueId === cueId) selectedCueId = null;
  }

  function onMarkerCreated({ marker, byUserId }: { marker: Marker; byUserId: string }) {
    if (marker.track_id !== track.id || byUserId === myId()) return;
    if (!markers.find((m) => m.id === marker.id)) markers = [...markers, marker];
  }
  function onMarkerUpdated({ marker, byUserId }: { marker: Marker; byUserId: string }) {
    if (marker.track_id !== track.id || byUserId === myId()) return;
    markers = markers.map((m) => (m.id === marker.id ? marker : m));
  }
  function onMarkerDeleted({ markerId, trackId, byUserId }: { markerId: string; trackId: string; byUserId: string }) {
    if (trackId !== track.id || byUserId === myId()) return;
    markers = markers.filter((m) => m.id !== markerId);
  }

  function onVideoUpdated({ trackId }: { trackId: string }) {
    if (trackId === track.id) loadVideos();
  }

  // Show element socket handlers (only applied when showElements is on).
  function onShowElementCreated({ element }: { element: ShowElement }) {
    if (element.track_id !== track.id) return;
    if (!showElementsData.find((e) => e.id === element.id))
      showElementsData = [...showElementsData, element].sort((a, b) => a.time - b.time);
  }
  function onShowElementUpdated({ element }: { element: ShowElement }) {
    if (element.track_id !== track.id) return;
    showElementsData = showElementsData.map((e) => (e.id === element.id ? element : e));
  }
  function onShowElementDeleted({ elementId, trackId }: { elementId: string; trackId: string }) {
    if (trackId !== track.id) return;
    showElementsData = showElementsData.filter((e) => e.id !== elementId);
  }
  // A version finished (re)processing — pull fresh media+peaks so the waveform
  // redraws with the new analysis (e.g. after "Regenerate detailed waveform").
  function onVersionReady({ trackId }: { trackId: string }) {
    if (trackId === track.id) loadMedia().catch(() => {});
  }
  function onSettingsUpdated({ trackId, settings: s, byUserId }: { trackId: string; settings: any; byUserId: string }) {
    if (trackId !== track.id || byUserId === myId()) return;
    settings = withSettingsDefaults(s);
  }

  socket.on('cue:created', onCueCreated);
  socket.on('cue:updated', onCueUpdated);
  socket.on('cue:deleted', onCueDeleted);
  socket.on('marker:created', onMarkerCreated);
  socket.on('marker:updated', onMarkerUpdated);
  socket.on('marker:deleted', onMarkerDeleted);
  socket.on('formation:placement:created', onPlacementCreated);
  socket.on('formation:placement:updated', onPlacementUpdated);
  socket.on('formation:placement:deleted', onPlacementDeleted);
  socket.on('video:layer:updated', onVideoUpdated);
  socket.on('track:version:ready', onVersionReady);
  socket.on('track:settings:updated', onSettingsUpdated);
  socket.on('show_element:created', onShowElementCreated);
  socket.on('show_element:updated', onShowElementUpdated);
  socket.on('show_element:deleted', onShowElementDeleted);

  // Lazy-load show elements when the toggle is first enabled.
  $effect(() => {
    if (showElements && showElementsData.length === 0) {
      api.get<{ elements: ShowElement[] }>(`${base}/show-elements`)
        .then(({ elements: els }) => { showElementsData = els; })
        .catch(() => {});
    }
  });

  onDestroy(() => {
    socket.off('cue:created', onCueCreated);
    socket.off('cue:updated', onCueUpdated);
    socket.off('cue:deleted', onCueDeleted);
    socket.off('marker:created', onMarkerCreated);
    socket.off('marker:updated', onMarkerUpdated);
    socket.off('marker:deleted', onMarkerDeleted);
    socket.off('formation:placement:created', onPlacementCreated);
    socket.off('formation:placement:updated', onPlacementUpdated);
    socket.off('formation:placement:deleted', onPlacementDeleted);
    socket.off('video:layer:updated', onVideoUpdated);
    socket.off('track:version:ready', onVersionReady);
    socket.off('track:settings:updated', onSettingsUpdated);
    socket.off('show_element:created', onShowElementCreated);
    socket.off('show_element:updated', onShowElementUpdated);
    socket.off('show_element:deleted', onShowElementDeleted);
  });

  // --- Settings persistence (debounced PATCH) ---------------------------
  let settingsTimer: ReturnType<typeof setTimeout> | undefined;
  function patchSettings(partial: any) {
    // Optimistic local merge (deep on snap/overlays), then debounce the write.
    settings = {
      ...settings,
      ...partial,
      snap: { ...settings.snap, ...(partial.snap || {}) },
      overlays: { ...settings.overlays, ...(partial.overlays || {}) },
    };
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => {
      api.patch(`${base}/settings`, partial).catch((e) => ui.toast((e as Error).message, 'error'));
    }, 400);
  }

  // --- Cue snapping ------------------------------------------------------
  // Build a nearest-zero-crossing resolver from the decoded audio buffer.
  function makeZeroCross(buf: AudioBuffer): (t: number) => number {
    const sr = buf.sampleRate;
    const data = buf.getChannelData(0);
    const win = Math.floor(sr * 0.01); // search ±10ms
    return (t: number) => {
      const c = Math.round(t * sr);
      if (c < 1 || c >= data.length) return t;
      for (let d = 0; d <= win; d++) {
        for (const i of [c - d, c + d]) {
          if (i > 0 && i < data.length && data[i - 1] < 0 !== data[i] < 0) return i / sr;
        }
      }
      return t;
    };
  }
  function snapCfg() {
    return { ...settings.snap, fps: settings.fps };
  }
  function buildSnapCtx(excludeCueId?: string): SnapContext {
    const dec = (audioWs as any)?.getDecodedData?.() ?? null;
    return {
      duration: analysis?.duration || currentVersion(track)?.media_duration || 0,
      transients: analysis?.transients ?? null,
      beatGrid: analysis?.tempo?.beatGrid ?? null,
      bpm: analysis?.tempo?.bpm ?? null,
      firstBeatSec: analysis?.tempo?.firstBeatSec ?? null,
      existingCueTimes: cues.filter((c) => c.id !== excludeCueId).map((c) => c.time),
      zeroCrossings: settings.snap.zeroCross && dec ? makeZeroCross(dec) : null,
    };
  }

  async function addCue(rawTime: number) {
    if (!canEdit) return;
    const time = snapTime(rawTime, snapCfg(), buildSnapCtx());
    try {
      const { cue } = await api.post<{ cue: Cue }>(`${base}/cues`, {
        time,
        name: `Cue ${cues.length + 1}`,
      });
      cues = [...cues, cue];
      selectedCueId = cue.id;
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  async function moveCue(cueId: string, rawTime: number) {
    const cue = cues.find((c) => c.id === cueId);
    if (!cue) return;
    const time = snapTime(rawTime, snapCfg(), buildSnapCtx(cueId));
    // optimistic
    cues = cues.map((c) => (c.id === cueId ? { ...c, time } : c));
    try {
      const { cue: updated } = await api.patch<{ cue: Cue }>(`${base}/cues/${cueId}`, {
        time,
        lock_version: cue.lock_version,
      });
      cues = cues.map((c) => (c.id === cueId ? updated : c));
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  // Phase 5b: lane-strip drag → move a cue to another department's lane.
  async function reassignCueLane(cue: Cue, laneId: string) {
    if (cue.lane_id === laneId) return;
    cues = cues.map((c) => (c.id === cue.id ? { ...c, lane_id: laneId } : c));
    try {
      const { cue: updated } = await api.patch<{ cue: Cue }>(`${base}/cues/${cue.id}`, { lane_id: laneId, lock_version: cue.lock_version });
      cues = cues.map((c) => (c.id === updated.id ? updated : c));
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }
  // Phase 5b: lane-strip resize → set a cue's range end.
  async function resizeCue(cue: Cue, endTime: number) {
    cues = cues.map((c) => (c.id === cue.id ? { ...c, end_time: endTime } : c));
    try {
      const { cue: updated } = await api.patch<{ cue: Cue }>(`${base}/cues/${cue.id}`, { end_time: endTime, lock_version: cue.lock_version });
      cues = cues.map((c) => (c.id === updated.id ? updated : c));
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  async function saveCue(patch: Partial<Cue>) {
    if (!editingCue) return;
    const id = editingCue.id;
    try {
      const { cue } = await api.patch<{ cue: Cue }>(`${base}/cues/${id}`, {
        ...patch,
        lock_version: editingCue.lock_version,
      });
      cues = cues.map((c) => (c.id === id ? cue : c));
      editingCue = null;
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  async function deleteCue(cue: Cue) {
    try {
      await api.del(`${base}/cues/${cue.id}`);
      cues = cues.filter((c) => c.id !== cue.id);
      if (selectedCueId === cue.id) selectedCueId = null;
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  function selectCue(cue: Cue) {
    selectedCueId = cue.id;
    wave?.seekTo(cue.time);
  }

  // --- Markers (Phase 2c) -------------------------------------------------
  async function addMarker() {
    if (!canEdit) return;
    try {
      const { marker } = await api.post<{ marker: Marker }>(`${base}/markers`, {
        time: currentTime,
        name: `Marker ${markers.length + 1}`,
      });
      markers = [...markers, marker];
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }
  async function renameMarker(m: Marker, name: string) {
    if (!name.trim() || name === m.name) return;
    try {
      const { marker } = await api.patch<{ marker: Marker }>(`${base}/markers/${m.id}`, { name: name.trim() });
      markers = markers.map((x) => (x.id === marker.id ? marker : x));
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }
  async function deleteMarker(m: Marker) {
    try {
      await api.del(`${base}/markers/${m.id}`);
      markers = markers.filter((x) => x.id !== m.id);
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  // --- Dance formations (Phase 8b: reusable defs + placements) ---------------
  // Snapshot the current stage into a NEW formation definition and immediately place
  // it at the playhead. Preserves the one-click "+" UX of the old keyframe model.
  async function addFormation() {
    if (!canEdit) return;
    const positions: FormationPosition[] = dancers.map((d, i) => {
      const p = livePositions.get(d.id);
      const spreadX = dancers.length > 1 ? 0.15 + (0.7 * i) / (dancers.length - 1) : 0.5;
      return { dancer_id: d.id, x: p?.x ?? spreadX, y: p?.y ?? 0.5 };
    });
    try {
      // 1. Create the definition (project-scoped); store picks it up via socket event.
      const { formation: def } = await api.post<{ formation: Formation }>(
        `/projects/${projectId}/formations`,
        { name: `Formation ${placements.length + 1}`, positions }
      );
      // 2. Place it on this track at the playhead.
      const { placement } = await api.post<{ placement: FormationPlacement }>(
        `${base}/formation-placements`,
        { formation_id: def.id, time: currentTime }
      );
      placements = [...placements, placement];
      selectedPlacementId = placement.id;
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  // Place an EXISTING formation definition at the playhead.
  async function placeFormation(defId: string) {
    if (!canEdit) return;
    try {
      const { placement } = await api.post<{ placement: FormationPlacement }>(
        `${base}/formation-placements`,
        { formation_id: defId, time: currentTime }
      );
      placements = [...placements, placement];
      selectedPlacementId = placement.id;
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  function selectPlacement(p: FormationPlacement) {
    selectedPlacementId = selectedPlacementId === p.id ? null : p.id;
    if (selectedPlacementId) { wave?.seekTo(p.time); currentTime = p.time; }
  }

  // Rename the formation DEFINITION (shared across all placements of this def).
  async function renameDef(defId: string, name: string) {
    const def = formations.find((f) => f.id === defId);
    if (!name.trim() || name === def?.name) return;
    try {
      await api.patch(`/projects/${projectId}/formations/${defId}`, { name: name.trim() });
      // store picks up the update via formation:def:updated socket event
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  // Remove this PLACEMENT (the def remains in the library for reuse).
  async function deletePlacement(p: FormationPlacement) {
    try {
      await api.del(`${base}/formation-placements/${p.id}`);
      placements = placements.filter((x) => x.id !== p.id);
      if (selectedPlacementId === p.id) selectedPlacementId = null;
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  // Set / clear the hold end on a PLACEMENT (controls transition timing on this track).
  async function setPlacementHold(p: FormationPlacement, endTime: number | null) {
    if (endTime != null && endTime <= p.time) {
      ui.toast('Move the playhead past the placement start first', 'error');
      return;
    }
    try {
      const { placement } = await api.patch<{ placement: FormationPlacement }>(
        `${base}/formation-placements/${p.id}`, { end_time: endTime }
      );
      placements = placements.map((x) => (x.id === placement.id ? placement : x));
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  // 11g: move a PLACEMENT bar in time (drag from LaneStrip).
  async function movePlacement(p: FormationPlacement, time: number) {
    try {
      const { placement } = await api.patch<{ placement: FormationPlacement }>(
        `${base}/formation-placements/${p.id}`,
        { time, ...(p.end_time != null ? { end_time: time + (p.end_time - p.time) } : {}) }
      );
      placements = placements.map((x) => (x.id === placement.id ? placement : x));
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  // 11g: resize a PLACEMENT bar (drag right edge in LaneStrip).
  async function resizePlacement(p: FormationPlacement, endTime: number) {
    try {
      const { placement } = await api.patch<{ placement: FormationPlacement }>(
        `${base}/formation-placements/${p.id}`, { end_time: endTime }
      );
      placements = placements.map((x) => (x.id === placement.id ? placement : x));
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  // 11g: set transition easing for a PLACEMENT.
  async function setPlacementEase(p: FormationPlacement, ease: string) {
    try {
      const { placement } = await api.patch<{ placement: FormationPlacement }>(
        `${base}/formation-placements/${p.id}`, { ease }
      );
      placements = placements.map((x) => (x.id === placement.id ? placement : x));
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  // Drag a token within the selected def: optimistic overlay + debounced PATCH to the def.
  // Patching the definition updates all placements of this formation everywhere.
  let formationSaveTimer: ReturnType<typeof setTimeout> | undefined;
  function onDancerMove(dancerId: string, x: number, y: number) {
    if (!selectedDef) return;
    const defId = selectedDef.id;
    const cur = pendingDefPositions.get(defId) ?? selectedDef.positions;
    const positions: FormationPosition[] = [...cur.filter((p) => p.dancer_id !== dancerId), { dancer_id: dancerId, x, y }];
    pendingDefPositions = new Map(pendingDefPositions).set(defId, positions);
    clearTimeout(formationSaveTimer);
    formationSaveTimer = setTimeout(() => {
      const latest = pendingDefPositions.get(defId);
      if (latest) {
        api.patch(`/projects/${projectId}/formations/${defId}`, { positions: latest })
          .then(() => {
            // Clear the overlay once the store has the real update (via socket event).
            // We remove it a beat after the PATCH so the socket update has time to arrive.
            setTimeout(() => {
              pendingDefPositions = new Map(
                [...pendingDefPositions.entries()].filter(([k]) => k !== defId)
              );
            }, 500);
          })
          .catch((e: Error) => ui.toast(e.message, 'error'));
      }
    }, 350);
  }

  // Socket handlers for placements on THIS track.
  function onPlacementCreated({ placement, trackId, byUserId }: { placement: FormationPlacement; trackId: string; byUserId: string }) {
    if (trackId !== track.id || byUserId === myId()) return;
    if (!placements.find((p) => p.id === placement.id)) placements = [...placements, placement];
  }
  function onPlacementUpdated({ placement, trackId, byUserId }: { placement: FormationPlacement; trackId: string; byUserId: string }) {
    if (trackId !== track.id || byUserId === myId()) return;
    placements = placements.map((p) => (p.id === placement.id ? placement : p));
  }
  function onPlacementDeleted({ placementId, trackId, byUserId }: { placementId: string; trackId: string; byUserId: string }) {
    if (trackId !== track.id || byUserId === myId()) return;
    placements = placements.filter((p) => p.id !== placementId);
    if (selectedPlacementId === placementId) selectedPlacementId = null;
  }

  let lastCursorSent = 0;
  function onTime(t: number) {
    currentTime = t;
    // Live MIDI: fire cues crossed since the last tick. Guard on a small forward
    // step so a manual seek (big jump) doesn't machine-gun every cue in between.
    if (showMode && isPlaying && t > prevTime && t - prevTime < 1) fireCrossings(prevTime, t);
    prevTime = t;
    const now = Date.now();
    if (now - lastCursorSent > 120) {
      lastCursorSent = now;
      sendCursor(track.id, t);
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.code === 'Space') {
      e.preventDefault();
      wave?.playPause();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedCueId) {
      const cue = cues.find((c) => c.id === selectedCueId);
      if (cue && cueDeletable(cue)) deleteCue(cue);
    }
  }
</script>

<svelte:window on:keydown={onKey} />

{#if loading}
  <p class="text-sm text-neutral-500">Loading track…</p>
{:else if !mediaUrl}
  <p class="text-sm text-neutral-500">This track has no ready media yet.</p>
{:else}
  <div class="grid w-full grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
    <div class="min-w-0">
      {#if readyVideos.length > 0}
        <!-- 7c: up to 3 synced video panels; each has its own rAF sync loop -->
        <div class="mb-3 {readyVideos.length > 1 ? 'grid gap-3 sm:grid-cols-2' : ''}">
          {#each readyVideos as v (v.id)}
            <div>
              <VideoPanel
                {projectId}
                trackId={track.id}
                videoId={v.id}
                {audioWs}
                {canEdit}
                initialOffset={v.offset_seconds}
              />
              {#if canEdit}
                <button onclick={() => removeVideo(v.id)} class="mt-1 text-[11px] text-neutral-600 hover:text-red-400">Remove video</button>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
      {#if canEdit && videos.length < 3}
        <div class="mb-3">
          <label class="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:border-indigo-500">
            {uploadingVideo ? `Uploading video… ${Math.round(videoProgress * 100)}%` : '+ Sync a video to this track'}
            <input type="file" accept="video/*" class="hidden" onchange={addVideo} disabled={uploadingVideo} />
          </label>
        </div>
      {/if}
      <div class="mb-2 flex items-center justify-between">
        <div class="inline-flex overflow-hidden rounded-lg border border-neutral-700 text-xs">
          <button
            onclick={() => (waveView = 'simple')}
            class="px-3 py-1.5 {waveView === 'simple' ? 'bg-indigo-600 text-white' : 'text-neutral-300 hover:bg-neutral-800'}"
          >Simple</button>
          <button
            onclick={() => (waveView = 'cdj')}
            class="border-l border-neutral-700 px-3 py-1.5 {waveView === 'cdj' ? 'bg-indigo-600 text-white' : 'text-neutral-300 hover:bg-neutral-800'}"
          >CDJ / Rekordbox</button>
          <button
            onclick={() => (waveView = 'rgb')}
            disabled={!waveformRgbUrl}
            title={waveformRgbUrl ? 'Energy-coloured waveform' : 'No colour waveform yet — Regenerate detailed waveform'}
            class="border-l border-neutral-700 px-3 py-1.5 disabled:opacity-40 {waveView === 'rgb' ? 'bg-indigo-600 text-white' : 'text-neutral-300 hover:bg-neutral-800'}"
          >Colour</button>
          <button
            onclick={() => (waveView = 'spectrogram')}
            class="border-l border-neutral-700 px-3 py-1.5 {waveView === 'spectrogram' ? 'bg-indigo-600 text-white' : 'text-neutral-300 hover:bg-neutral-800'}"
          >Spectrogram</button>
        </div>
        {#if canEdit}
          <button onclick={regenerate} disabled={regenerating} class="text-[11px] text-neutral-500 hover:text-white disabled:opacity-50">
            {regenerating ? 'Regenerating…' : 'Regenerate detailed waveform'}
          </button>
        {/if}
      </div>
      {#if canEdit}
        <div class="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-neutral-400">
          <label class="inline-flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={settings.overlays.rms} onchange={(e) => patchSettings({ overlays: { rms: e.currentTarget.checked } })} />
            RMS
          </label>
          <label class="inline-flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={settings.overlays.transients} onchange={(e) => patchSettings({ overlays: { transients: e.currentTarget.checked } })} />
            Transients
          </label>
          <span class="ml-1 text-neutral-600">Snap</span>
          <select
            value={settings.snap.target}
            onchange={(e) => patchSettings({ snap: { target: e.currentTarget.value } })}
            class="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-neutral-200"
          >
            <option value="off">Off</option>
            <option value="transient">Transient</option>
            <option value="beat">Beat</option>
            <option value="grid">Grid</option>
            <option value="frame">Frame</option>
            <option value="existing">Cue</option>
          </select>
          <label class="inline-flex items-center gap-1">
            ±
            <input
              type="number"
              step="0.005"
              min="0"
              max="1"
              value={settings.snap.tolerance}
              onchange={(e) => patchSettings({ snap: { tolerance: Number(e.currentTarget.value) } })}
              class="w-16 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-neutral-200"
            />s
          </label>
          <label class="inline-flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={settings.snap.zeroCross ?? false} onchange={(e) => patchSettings({ snap: { zeroCross: e.currentTarget.checked } })} />
            Zero-cross
          </label>
          <label class="inline-flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={settings.overlays.beatGrid} onchange={(e) => patchSettings({ overlays: { beatGrid: e.currentTarget.checked } })} />
            Beat grid
          </label>
          <label class="inline-flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={settings.overlays.silence} onchange={(e) => patchSettings({ overlays: { silence: e.currentTarget.checked } })} />
            Silence
          </label>
          <label class="inline-flex cursor-pointer items-center gap-1.5" title="Suggest structural section boundaries (experimental)">
            <input type="checkbox" checked={settings.sectionsEnabled} onchange={(e) => patchSettings({ sectionsEnabled: e.currentTarget.checked })} />
            Sections
          </label>
          {#if analysis?.tempo}
            <span class="text-neutral-500">{analysis.tempo.bpm?.toFixed(1)} BPM{#if analysis.tempo.meter}<span class="ml-1 text-neutral-600">· {analysis.tempo.meter}</span>{/if}</span>
            <span class="inline-flex items-center gap-1">
              <button onclick={() => (beatAnchorOffset -= 0.01)} class="rounded border border-neutral-700 px-1 leading-none hover:bg-neutral-800">−</button>
              <span class="text-neutral-600">anchor</span>
              <button onclick={() => (beatAnchorOffset += 0.01)} class="rounded border border-neutral-700 px-1 leading-none hover:bg-neutral-800">+</button>
            </span>
          {/if}
        </div>
      {/if}
      <div class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-neutral-400">
        <button
          onclick={() => (smpteMode = !smpteMode)}
          class="rounded border border-neutral-700 px-2 py-0.5 {smpteMode ? 'bg-indigo-600 text-white' : 'hover:bg-neutral-800'}"
        >SMPTE</button>
        <select
          value={settings.fps}
          onchange={(e) => patchSettings({ fps: Number(e.currentTarget.value) })}
          disabled={!canEdit}
          class="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-neutral-200 disabled:opacity-50"
        >
          {#each [23.976, 24, 25, 29.97, 30, 50, 60] as f}
            <option value={f}>{f} fps</option>
          {/each}
        </select>
        <button
          onclick={() => (follow = !follow)}
          title="Follow — keep the playhead centred while playing"
          class="rounded border border-neutral-700 px-2 py-0.5 {follow ? 'bg-indigo-600 text-white' : 'hover:bg-neutral-800'}"
        >Follow</button>
        <span class="ml-1 text-neutral-600">Loop</span>
        <button
          onclick={() => (loopOn = !loopOn)}
          class="rounded border border-neutral-700 px-2 py-0.5 {loopOn ? 'bg-indigo-600 text-white' : 'hover:bg-neutral-800'}"
          title="Loop the selected cue → next cue"
        >Cue{loopOn && loopRegion.start != null ? ' ✓' : ''}</button>
        <button onclick={() => (loopIn = currentTime)} title="Set loop in point at the playhead" class="rounded border border-neutral-700 px-1.5 py-0.5 {loopIn != null ? 'text-indigo-300' : 'hover:bg-neutral-800'}">IN</button>
        <button onclick={() => (loopOut = currentTime)} title="Set loop out point at the playhead" class="rounded border border-neutral-700 px-1.5 py-0.5 {loopOut != null ? 'text-indigo-300' : 'hover:bg-neutral-800'}">OUT</button>
        <button onclick={() => { loopIn = null; loopOut = null; }} title="Clear the manual loop" class="rounded border border-neutral-700 px-1.5 py-0.5 hover:bg-neutral-800">CLR</button>
        <span class="ml-1 text-neutral-600">Zoom</span>
        <button onclick={() => wave?.fitZoom()} class="rounded border border-neutral-700 px-1.5 py-0.5 hover:bg-neutral-800">Fit</button>
        <button onclick={() => wave?.zoomBy(0.5)} class="rounded border border-neutral-700 px-1.5 py-0.5 hover:bg-neutral-800">−</button>
        <button onclick={() => wave?.zoomBy(2)} class="rounded border border-neutral-700 px-1.5 py-0.5 hover:bg-neutral-800">+</button>
        <span class="ml-1 text-neutral-700">·</span>
        {#if departments.length}
          <button
            onclick={() => (showLanes = !showLanes)}
            title="Show department swim-lanes below the waveform"
            class="rounded border border-neutral-700 px-2 py-0.5 {showLanes ? 'bg-indigo-600 text-white' : 'hover:bg-neutral-800'}"
          >Lanes</button>
        {/if}
        <button
          onclick={() => (showElements = !showElements)}
          title="Show DJ show elements reference lanes"
          class="rounded border border-neutral-700 px-2 py-0.5 {showElements ? 'bg-amber-600 text-white' : 'hover:bg-neutral-800'}"
        >Show</button>
        <a
          href="/projects/{projectId}/track/{track.id}/builder"
          class="rounded border border-amber-800 px-2 py-0.5 text-amber-400 hover:bg-amber-950 hover:text-amber-300"
          title="Open the DJ Show Builder"
        >Builder ↗</a>
        {#if myDepartmentIds.length}
          <button
            onclick={() => (myCuesOnly = !myCuesOnly)}
            title="Show only cues in the departments you're assigned to"
            class="rounded border border-neutral-700 px-2 py-0.5 {myCuesOnly ? 'bg-indigo-600 text-white' : 'hover:bg-neutral-800'}"
          >My cues</button>
        {/if}
        <button
          onclick={() => (showMode = !showMode)}
          title="Show mode — fire cue MIDI triggers live as the playhead passes"
          class="rounded border border-neutral-700 px-2 py-0.5 {showMode ? 'bg-emerald-600 text-white' : 'hover:bg-neutral-800'}"
        >● Show</button>
        {#if showMode}
          {#if !midi.supported}
            <span class="text-amber-500">MIDI needs Chrome/Edge</span>
          {:else if !midi.enabled}
            <button onclick={enableMidi} class="rounded border border-neutral-700 px-1.5 py-0.5 hover:bg-neutral-800">Enable MIDI</button>
          {:else}
            <select bind:value={midiOutId} class="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-neutral-200">
              {#if !midi.outputs.length}<option value="">No MIDI outputs</option>{/if}
              {#each midi.outputs as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
            </select>
          {/if}
        {/if}
      </div>
      <!-- 9b: Indent the waveform by w-28 (112px) to match LaneStrip's internal
           label column. This aligns the wavesurfer drawable area's left origin
           with the lane content area, fixing the ~112px cue-position offset. -->
      <div class="flex items-stretch">
        <div class="w-28 shrink-0"></div>
        <div class="min-w-0 flex-1">
          <WaveformTrack
            bind:this={wave}
            cues={visibleCues}
            {departments}
            {markers}
            {mediaUrl}
            {waveformUrl}
            {canEdit}
            editable={cueEditable}
            {selectedCueId}
            view={waveView}
            {spectrogramUrl}
            {waveformRgbUrl}
            showRms={settings.overlays.rms}
            showTransients={settings.overlays.transients}
            showBeatGrid={settings.overlays.beatGrid}
            showSilence={settings.overlays.silence}
            {beatAnchorOffset}
            loopStart={effectiveLoop.start}
            loopEnd={effectiveLoop.end}
            {follow}
            onCueAdd={addCue}
            onCueMove={moveCue}
            onCueSelect={(id) => (selectedCueId = id)}
            onReady={(ws) => (audioWs = ws)}
            onAnalysis={(a) => (analysis = a)}
            onPlayState={(pl) => (isPlaying = pl)}
            onScroll={(s) => (waveScroll = s)}
            {onTime}
          />
        </div>
      </div>
      <div class="mt-2 flex items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-1.5">
        <div class="flex items-center gap-1">
          <button onclick={() => { wave?.seekTo(0); currentTime = 0; }} title="To start" class="rounded px-1.5 py-1 text-neutral-300 hover:bg-neutral-800">⏮</button>
          <button onclick={() => seekCue(-1)} title="Previous cue" class="rounded px-1.5 py-1 text-neutral-300 hover:bg-neutral-800">⏪</button>
          <button onclick={() => wave?.seekBy(-5)} title="Back 5s" class="rounded px-2 py-1 text-[11px] text-neutral-400 hover:bg-neutral-800">−5s</button>
          <button
            onclick={() => wave?.playPause()}
            title="Play / pause (Space)"
            class="rounded-md bg-indigo-600 px-3 py-1 text-sm text-white hover:bg-indigo-500"
          >{isPlaying ? '⏸' : '▶'}</button>
          <button onclick={() => wave?.seekBy(5)} title="Forward 5s" class="rounded px-2 py-1 text-[11px] text-neutral-400 hover:bg-neutral-800">+5s</button>
          <button onclick={() => seekCue(1)} title="Next cue" class="rounded px-1.5 py-1 text-neutral-300 hover:bg-neutral-800">⏩</button>
          <button onclick={() => { wave?.stop(); currentTime = 0; }} title="Stop" class="rounded px-1.5 py-1 text-neutral-300 hover:bg-neutral-800">⏹</button>
        </div>
        <div class="font-mono text-sm tabular-nums text-neutral-200">
          {#if barBeat}<span class="mr-2 text-emerald-300" title="bar.beat">{barBeat}</span>{/if}
          <span class="text-indigo-300">{fmtClock(currentTime)}</span>
          <span class="text-neutral-600"> / {fmtClock(analysis?.duration ?? 0)}</span>
        </div>
      </div>

      {#if showLanes && departments.length}
        <div class="mt-2">
          <LaneStrip
            cues={visibleCues}
            {departments}
            placements={danceMode ? placements : []}
            formationDefs={danceMode ? formations : []}
            duration={analysis?.duration ?? 0}
            editable={canEdit}
            sync={waveScroll}
            {currentTime}
            onSelect={(c) => { selectedCueId = c.id; wave?.seekTo(c.time); currentTime = c.time; if (canEdit && cueEditable(c)) editingCue = c; }}
            onMove={(c, t) => moveCue(c.id, t)}
            onReassign={reassignCueLane}
            onResize={resizeCue}
            onSelectPlacement={(p) => { selectedPlacementId = p.id; wave?.seekTo(p.time); currentTime = p.time; }}
            onMovePlacement={movePlacement}
            onResizePlacement={resizePlacement}
          />
        </div>
      {/if}

      {#if showElements && showElementsData.length > 0}
        <!-- 10-showfix: replaced the pct(t)%-based inline block with ShowElementLanes, which
             consumes sync={waveScroll} and positions elements in px against contentW = sync.scrollWidth,
             mirroring LaneStrip/ShowBuilderTimeline. Now scales and scrolls with the waveform. -->
        <div class="mt-2 overflow-hidden rounded-lg border border-amber-900/40 bg-neutral-950">
          <div class="flex items-center gap-2 border-b border-neutral-900 px-3 py-1.5">
            <span class="text-[10px] font-semibold uppercase tracking-wide text-amber-500">DJ Show Elements</span>
            <a href="/projects/{projectId}/track/{track.id}/builder" class="ml-auto text-[11px] text-amber-600 hover:text-amber-400">Edit in Builder ↗</a>
          </div>
          <ShowElementLanes
            elements={showElementsData}
            duration={analysis?.duration ?? 0}
            {currentTime}
            sync={waveScroll}
            onSeek={(t) => { wave?.seekTo(t); currentTime = t; }}
          />
        </div>
      {:else if showElements && showElementsData.length === 0}
        <div class="mt-2 rounded-lg border border-amber-900/30 bg-neutral-950 px-4 py-3 text-sm text-neutral-600">
          No show elements yet. <a href="/projects/{projectId}/track/{track.id}/builder" class="text-amber-500 hover:text-amber-400">Open the Show Builder</a> to add pyro, lasers, CO2, and more.
        </div>
      {/if}

      {#if filmstrip?.url}
        <div class="mt-2">
          <Filmstrip filmstripUrl={filmstrip.url} meta={filmstrip.meta} duration={analysis?.duration ?? 0} {currentTime} />
        </div>
      {/if}

      {#if danceMode}
        <div class="mt-3">
          <div class="mb-2 flex items-center justify-between">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-neutral-500">Stage formation</h3>
            <div class="flex items-center gap-2 text-[11px] text-neutral-400">
              {#if selectedDef && selectedPlacement}
                <span class="text-indigo-300">Editing "{selectedDef.name}" — drag dancers</span>
                {#if selectedPlacement.end_time != null}
                  <span class="text-neutral-500" title="Hold range">hold → {fmtClock(selectedPlacement.end_time)}</span>
                  <button onclick={() => selectedPlacement && setPlacementHold(selectedPlacement, null)} class="rounded border border-neutral-700 px-1.5 py-0.5 hover:bg-neutral-800">Clear hold</button>
                {:else}
                  <button onclick={() => selectedPlacement && setPlacementHold(selectedPlacement, currentTime)} title="Hold this placement until the playhead, then transition" class="rounded border border-neutral-700 px-1.5 py-0.5 hover:bg-neutral-800">Hold to playhead</button>
                {/if}
                <!-- 11g: transition easing picker -->
                {#if canEdit}
                  <span class="text-neutral-600">ease:</span>
                  <select
                    value={selectedPlacement.ease ?? 'linear'}
                    onchange={(e) => selectedPlacement && setPlacementEase(selectedPlacement, e.currentTarget.value)}
                    class="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-[11px] text-neutral-200"
                    title="Transition easing curve"
                  >
                    <option value="linear">linear</option>
                    <option value="ease-in">ease-in</option>
                    <option value="ease-out">ease-out</option>
                    <option value="ease-in-out">ease-in-out</option>
                  </select>
                {/if}
                <button onclick={() => (selectedPlacementId = null)} class="rounded border border-neutral-700 px-2 py-0.5 hover:bg-neutral-800">Done</button>
              {:else}
                <span class="text-neutral-600">{placements.length ? 'Press play to animate · select a placement to edit' : 'No formations placed yet'}</span>
              {/if}
              {#if resolvedPlacements.length}
                <button onclick={() => printFormationSheet({ projectName: track.name, trackName: track.name, placements: resolvedPlacements, dancers, stage })} class="rounded border border-neutral-700 px-2 py-0.5 hover:bg-neutral-800">Print sheet</button>
              {/if}
              {#if canEdit}
                <button onclick={addFormation} disabled={dancers.length === 0} class="rounded bg-indigo-600 px-2 py-0.5 text-white hover:bg-indigo-500 disabled:opacity-40">+ Formation at playhead</button>
              {/if}
            </div>
          </div>
          {#if dancers.length === 0}
            <p class="rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-6 text-center text-sm text-neutral-600">Add dancers in "Cast &amp; stage" on the project page to start plotting formations.</p>
          {:else}
            <StageGrid {stage} {dancers} positions={stagePositions} editable={stageEditable} onMove={onDancerMove} />
          {/if}
        </div>
      {/if}
      {#if canEdit && settings.sectionsEnabled && analysis?.sections?.length}
        <div class="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-2.5 text-[11px]">
          <div class="mb-1.5 text-neutral-500">Suggested sections <span class="text-neutral-600">(experimental — click to add a cue)</span></div>
          <div class="flex flex-wrap gap-1.5">
            {#each analysis.sections as s}
              <button
                onclick={() => addCue(s.time)}
                class="rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:border-indigo-500 hover:text-white"
                title={`strength ${s.strength.toFixed(2)}`}
              >+ {Math.floor(s.time / 60)}:{String(Math.floor(s.time % 60)).padStart(2, '0')}</button>
            {/each}
          </div>
        </div>
      {/if}
    </div>
    <div class="flex flex-col gap-4">
      <div class="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
        {#if canEdit}
          <!-- 11f: CSV cue import -->
          <div class="mb-2 flex justify-end px-1">
            <label class="cursor-pointer text-[11px] text-neutral-500 hover:text-indigo-400" title="Import cues from CSV (exported by the Download button)">
              ↑ Import CSV
              <input
                type="file"
                accept=".csv,text/csv"
                class="sr-only"
                onchange={async (e) => {
                  const file = e.currentTarget.files?.[0];
                  if (!file) return;
                  try {
                    const text = await file.text();
                    const res = await fetch(`/api/v1${base}/cues/import`, {
                      method: 'POST',
                      credentials: 'include',
                      headers: { 'Content-Type': 'text/plain' },
                      body: text,
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data?.error || res.statusText);
                    const result = data as { imported: number; errors: { row: number; message: string }[] };
                    const errTxt = result.errors.length ? ` (${result.errors.length} skipped)` : '';
                    ui.toast(`Imported ${result.imported} cue${result.imported === 1 ? '' : 's'}${errTxt}`, result.errors.length ? 'info' : 'success');
                    // Cues arrive via socket refresh; also trigger a local reload.
                    cues = (await api.get<{ cues: typeof cues }>(`${base}/cues`)).cues;
                  } catch (err) {
                    ui.toast((err as Error).message, 'error');
                  }
                  e.currentTarget.value = '';
                }}
              />
            </label>
          </div>
        {/if}
        <CueList
          cues={visibleCues}
          {selectedCueId}
          {departments}
          editable={cueEditable}
          deletable={cueDeletable}
          fps={settings.fps}
          smpte={smpteMode}
          onSelect={selectCue}
          onEdit={(cue) => (editingCue = cue)}
          onDelete={deleteCue}
        />
      </div>
      {#if markers.length || canEdit}
        <div class="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
          <div class="flex items-center justify-between px-1 pb-2">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-neutral-500">Markers</h3>
            {#if canEdit}
              <button onclick={addMarker} class="text-[11px] text-indigo-400 hover:text-indigo-300">+ at playhead</button>
            {/if}
          </div>
          {#if markers.length === 0}
            <p class="px-1 text-sm text-neutral-600">No markers.</p>
          {:else}
            <ul class="flex flex-col gap-1">
              {#each [...markers].sort((a, b) => a.time - b.time) as m (m.id)}
                <li class="group flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-neutral-800/60">
                  <span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background: {m.color}"></span>
                  <div class="min-w-0 flex-1">
                    {#if canEdit}
                      <input
                        value={m.name}
                        onblur={(e) => renameMarker(m, e.currentTarget.value)}
                        onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                        class="w-full truncate bg-transparent text-sm text-neutral-100 outline-none"
                      />
                    {:else}
                      <p class="truncate text-sm text-neutral-100">{m.name}</p>
                    {/if}
                    <button onclick={() => { wave?.seekTo(m.time); currentTime = m.time; }} class="text-[11px] text-neutral-500 hover:text-indigo-400">{fmtClock(m.time)}</button>
                  </div>
                  {#if canEdit}
                    <button onclick={() => deleteMarker(m)} class="shrink-0 text-xs text-neutral-600 opacity-0 transition group-hover:opacity-100 hover:text-red-400">✕</button>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
      {#if danceMode && (placements.length || canEdit)}
        <!-- Phase 8b: track placements (timeline positions) -->
        <div class="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
          <div class="flex items-center justify-between px-1 pb-2">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-neutral-500">Placements on track</h3>
            <span class="text-xs text-neutral-600">{placements.length}</span>
          </div>
          {#if placements.length === 0}
            <p class="px-1 text-sm text-neutral-600">No formations placed. Use "+ Formation at playhead".</p>
          {:else}
            <ul class="flex flex-col gap-1">
              {#each [...placements].sort((a, b) => a.time - b.time) as p, i (p.id)}
                {@const def = formations.find((f) => f.id === p.formation_id)}
                <li class="group flex items-center gap-2 rounded-lg border px-2 py-1 {selectedPlacementId === p.id ? 'border-indigo-500/60 bg-indigo-500/10' : 'border-transparent hover:bg-neutral-800/60'}">
                  <button onclick={() => selectPlacement(p)} class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-[10px] text-neutral-300" title="Select / edit">{i + 1}</button>
                  <div class="min-w-0 flex-1">
                    {#if canEdit && def}
                      <input value={def.name} onblur={(e) => renameDef(def.id, e.currentTarget.value)} onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()} class="w-full truncate bg-transparent text-sm text-neutral-100 outline-none" />
                    {:else}
                      <p class="truncate text-sm text-neutral-100">{def?.name ?? '—'}</p>
                    {/if}
                    <button onclick={() => { wave?.seekTo(p.time); currentTime = p.time; }} class="text-[11px] text-neutral-500 hover:text-indigo-400">{fmtClock(p.time)}{#if p.end_time != null} – {fmtClock(p.end_time)}{/if}</button>
                  </div>
                  {#if canEdit}
                    <button onclick={() => deletePlacement(p)} class="shrink-0 text-xs text-neutral-600 opacity-0 transition group-hover:opacity-100 hover:text-red-400" title="Remove from track">✕</button>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
        <!-- Phase 8b: formation definition library — reuse a def by placing it at the playhead -->
        {#if formations.length > 1}
          <div class="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
            <div class="px-1 pb-2">
              <h3 class="text-xs font-semibold uppercase tracking-wide text-neutral-500">Formation library</h3>
              <p class="mt-0.5 text-[11px] text-neutral-600">Place an existing formation at the current playhead position.</p>
            </div>
            <ul class="flex flex-col gap-1">
              {#each formations as f (f.id)}
                <li class="group flex items-center gap-2 rounded-lg border border-transparent px-2 py-1 hover:bg-neutral-800/60">
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm text-neutral-200">{f.name}</p>
                    <p class="text-[11px] text-neutral-600">{f.positions.length} dancers · used {placements.filter((p) => p.formation_id === f.id).length}×</p>
                  </div>
                  {#if canEdit}
                    <button onclick={() => placeFormation(f.id)} class="shrink-0 rounded border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-300 hover:border-indigo-500 hover:text-white">Place</button>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      {/if}
      <VersionBar {projectId} {track} {canEdit} onChanged={onTrackChanged} />
    </div>
  </div>
{/if}

{#if editingCue}
  <CueEditor
    cue={editingCue}
    fps={settings.fps}
    smpte={smpteMode}
    bpm={analysis?.tempo?.bpm ?? null}
    {departments}
    {projectType}
    canSetVisibility={canSetCueVisibility(editingCue, uid, privileged)}
    onSave={saveCue}
    onClose={() => (editingCue = null)}
  />
{/if}
