<script lang="ts">
  import { onDestroy } from 'svelte';
  import WaveSurfer from 'wavesurfer.js';
  import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.js';
  import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.js';
  import MinimapPlugin from 'wavesurfer.js/dist/plugins/minimap.js';
  import ZoomPlugin from 'wavesurfer.js/dist/plugins/zoom.js';
  import HoverPlugin from 'wavesurfer.js/dist/plugins/hover.js';
  import type { Cue, Marker } from '$lib/types';
  import type { Department } from '$lib/api';
  import { effectiveCueColor } from '$lib/cues';
  import { fetchWaveformRGB, type RgbBucket } from '$lib/waveform/peaks';

  let {
    cues = [],
    departments = [],
    markers = [],
    mediaUrl = '',
    waveformUrl = '',
    canEdit = false,
    editable = () => false,
    selectedCueId = null,
    onMarkerSelect,
    view = 'simple',
    spectrogramUrl = null,
    waveformRgbUrl = null,
    showRms = false,
    showTransients = false,
    showBeatGrid = false,
    showSilence = false,
    beatAnchorOffset = 0,
    loopStart = null,
    loopEnd = null,
    follow = false,
    flush = false,
    onScroll,
    onCueAdd,
    onCueMove,
    onCueSelect,
    onReady,
    onTime,
    onAnalysis,
    onPlayState,
  }: {
    cues: Cue[];
    departments?: Department[];
    markers?: Marker[];
    mediaUrl: string;
    waveformUrl: string;
    canEdit: boolean;
    editable?: (cue: Cue) => boolean;
    selectedCueId?: string | null;
    onMarkerSelect?: (marker: Marker) => void;
    view?: 'simple' | 'cdj' | 'spectrogram' | 'rgb';
    spectrogramUrl?: string | null;
    waveformRgbUrl?: string | null;
    showRms?: boolean;
    showTransients?: boolean;
    showBeatGrid?: boolean;
    showSilence?: boolean;
    beatAnchorOffset?: number;
    loopStart?: number | null;
    loopEnd?: number | null;
    follow?: boolean;
    onScroll?: (s: { scrollLeft: number; scrollWidth: number; clientWidth: number }) => void;
    onCueAdd?: (time: number) => void;
    onCueMove?: (cueId: string, time: number) => void;
    onCueSelect?: (cueId: string) => void;
    onReady?: (ws: WaveSurfer) => void;
    onTime?: (t: number) => void;
    onPlayState?: (playing: boolean) => void;
    onAnalysis?: (a: {
      rms: number[] | null;
      transients: number[] | null;
      duration: number;
      tempo: any;
      bands: any;
      silences: { start: number; end: number }[] | null;
      sections: { time: number; strength: number }[] | null;
    }) => void;
    /** 9b: When true, removes the outer border/rounding so the waveform can be
     *  embedded flush into a containing layout (e.g. the DJ builder) without the
     *  1-2 px border inset causing misalignment with adjacent lane strips. */
    flush?: boolean;
  } = $props();

  let container: HTMLDivElement;
  let ws: WaveSurfer | null = null;
  let regions: RegionsPlugin | null = null;
  let regionMap = new Map<string, Region>();
  let ready = $state(false);
  let lastUrl = '';
  let lastView = '';

  // Parsed peaks JSON: { data:number[], bands?:{low,mid,high} }. Cached by url.
  let peaksData: number[] | null = null;
  let bands: { low: number[]; mid: number[]; high: number[] } | null = null;
  // Per-band peak, so colour reflects spectral balance not raw loudness.
  let bandMax = { low: 1, mid: 1, high: 1 };
  let fetchedFor = '';

  // Server-baked RGB waveform (Phase 1A): [[amp,[r,g,b]], …], decoded from the
  // zlib+base64 artifact. Cached by url; null until fetched / on older uploads.
  let rgbData: RgbBucket[] | null = null;
  let rgbFetchedFor = '';

  // Tier 1 analysis blocks (all nullable — worker may omit any).
  let rmsData: number[] | null = null;
  let transients: number[] | null = null;
  let peaksDuration = 0;
  // Tier 2 tempo block (nullable — worker may omit). beatGrid is explicit beat
  // times in seconds; if absent we derive from bpm + firstBeatSec.
  let tempoData: {
    bpm: number;
    confidence: number;
    firstBeatSec: number;
    beatGrid?: number[] | null;
    downbeats?: number[] | null;
    meter?: string | null;
    firstDownbeatSec?: number | null;
  } | null = null;
  // Tier 3 blocks (nullable — worker may omit). silences are muted spans;
  // sections are structural-change markers.
  let silencesData: { start: number; end: number }[] | null = null;
  let sectionsData: { time: number; strength: number }[] | null = null;

  // Current zoom level in px/sec, tracked for relative zoomBy(). Default matches
  // the simple-view minPxPerSec set in init().
  let currentPxPerSec = 60;

  // Latest loop bounds, mirrored into plain module refs so the ws 'timeupdate'
  // callback (bound once in create()) always reads current values.
  let loopStartRef: number | null = null;
  let loopEndRef: number | null = null;

  // 7b: The loop span is drawn as a RegionsPlugin region with a reserved id so
  // syncRegions()'s cue-diff loop never removes it. Kept separate from regionMap.
  let loopRegionRef: Region | null = null;

  // 7a: Preserved zoom level, captured before a view-switch so the new wavesurfer
  // instance restores it instead of snapping to fit.
  let preservedPxPerSec: number | null = null;

  // 7a: true = the user is at the fit-to-container scale (initial load or after
  // pressing Fit). The ResizeObserver re-fits only when atFit is true; zoomBy()
  // and wheel-zoom set it to false.
  let atFit = true;

  // 7a: ResizeObserver that re-applies the fit when the container resizes while
  // atFit is true. Disconnected in teardown().
  let resizeObserver: ResizeObserver | null = null;

  // Absolutely-positioned overlay canvas, mounted inside the wavesurfer wrapper so
  // it scrolls/zooms with the waveform. Drawn over (RMS envelope + transient ticks).
  let overlayCanvas: HTMLCanvasElement | null = null;

  // Spectrogram background image, mounted as the first child of the wavesurfer
  // wrapper (behind the waveform + overlay canvas) so cues/cursor stay usable.
  // Lifecycle mirrors overlayCanvas: built on ready, resized on redraw/zoom,
  // removed in teardown. Only present in spectrogram view.
  let spectrogramImg: HTMLImageElement | null = null;

  // 9a: Maximum overlay canvas width — belt-and-suspenders safety cap. The
  // viewport-windowed approach means the canvas is always ≤ clientWidth, which
  // is orders of magnitude below browser canvas dimension limits (~16384px Chrome /
  // ~32767px Firefox). The cap is only needed in pathological layouts.
  const OVERLAY_CAP_PX = 8000;

  function arrMax(a: number[]): number {
    let m = 0;
    for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i];
    return m || 1; // avoid divide-by-zero
  }

  // CDJ tri-band colours — Rekordbox-style additive RGB: lows→blue, mids→green,
  // highs→red/white. Each band is normalized to its own track-wide peak first;
  // without that, bass amplitude swamps every slice and the whole track renders
  // a muddy uniform grey/blue.
  function cdjRender(_channels: unknown, ctx: CanvasRenderingContext2D) {
    const { width, height } = ctx.canvas;
    const midY = height / 2;
    const overall = peaksData || [];
    const B = overall.length || (bands?.low.length ?? 0);
    if (!B) return;
    ctx.clearRect(0, 0, width, height);
    // 8a: Chunk-aware rendering. Wavesurfer v7 splits a zoomed waveform into
    // multiple viewport-sized canvases and calls renderFunction once per canvas.
    // Each canvas has an offsetLeft (CSS px) within the scroll wrapper; we use
    // that to map each device-pixel column to its correct global track fraction.
    // Falls back to the old full-stretch behaviour when the wrapper is not yet
    // available (first render, single canvas at fit).
    const dpr = window.devicePixelRatio || 1;
    const wrapper = getWrapper();
    const scrollCssW = wrapper?.scrollWidth ?? 0;
    const offL = (ctx.canvas as HTMLCanvasElement).offsetLeft; // CSS px
    for (let x = 0; x < width; x++) {
      const idx = scrollCssW > 0
        ? Math.min(B - 1, Math.floor(Math.min(1, (offL + x / dpr) / scrollCssW) * B))
        : Math.min(B - 1, Math.floor((x / width) * B));
      const loRaw = bands?.low[idx] ?? 0;
      const mdRaw = bands?.mid[idx] ?? 0;
      const hiRaw = bands?.high[idx] ?? 0;
      const amp = overall[idx] ?? Math.max(loRaw, mdRaw, hiRaw);
      let r: number, g: number, b: number;
      if (bands) {
        const lo = loRaw / bandMax.low;
        const md = mdRaw / bandMax.mid;
        const hi = hiRaw / bandMax.high;
        r = 255 * Math.min(1, hi * 1.1);
        g = 255 * Math.min(1, md);
        b = 255 * Math.min(1, lo * 1.1);
      } else {
        // No band data (older upload) — single CDJ-blue. Hit "Regenerate
        // detailed waveform" to produce 3-band colour for this version.
        r = 80; g = 150; b = 245;
      }
      const h = Math.max(1, amp * height * 0.95);
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(x, midY - h / 2, 1, h);
    }
  }

  // Server-baked RGB render (Phase 1A): the colour is already decided per bucket
  // (energy → time-line.io-style colormap), so this is a flat fillRect loop — no
  // band math. Falls back to nothing if rgbData is absent (init() then picks the
  // simple bars renderer instead).
  function rgbRender(_channels: unknown, ctx: CanvasRenderingContext2D) {
    const { width, height } = ctx.canvas;
    const midY = height / 2;
    const buckets = rgbData;
    const B = buckets?.length ?? 0;
    if (!buckets || !B) return;
    ctx.clearRect(0, 0, width, height);
    // 8a: Chunk-aware rendering (same offset logic as cdjRender above).
    const dpr = window.devicePixelRatio || 1;
    const wrapper = getWrapper();
    const scrollCssW = wrapper?.scrollWidth ?? 0;
    const offL = (ctx.canvas as HTMLCanvasElement).offsetLeft;
    for (let x = 0; x < width; x++) {
      const idx = scrollCssW > 0
        ? Math.min(B - 1, Math.floor(Math.min(1, (offL + x / dpr) / scrollCssW) * B))
        : Math.min(B - 1, Math.floor((x / width) * B));
      const [amp, [r, g, b]] = buckets[idx];
      const h = Math.max(1, amp * height * 0.95);
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(x, midY - h / 2, 1, h);
    }
  }

  // --- Tier 1 overlay ----------------------------------------------------
  // wavesurfer v7 exposes the scrolling wrapper element via ws.getWrapper(); it
  // contains the waveform canvases and carries the full scroll width. Mounting the
  // overlay as a child of it means it scrolls/zooms with the waveform for free.
  function getWrapper(): HTMLElement | null {
    try {
      return (ws as any)?.getWrapper?.() ?? null;
    } catch {
      return null;
    }
  }

  function viewHeight(): number {
    if (view === 'spectrogram') return 160;
    return view === 'cdj' || view === 'rgb' ? 140 : 120;
  }

  // (Re)build the overlay canvas sized to the VISIBLE VIEWPORT (clientWidth), not
  // the full scrollable width. Positioned at wrapper.scrollLeft so it always covers
  // the visible area. This prevents the canvas from ever exceeding browser canvas
  // dimension limits (~16384px Chrome, ~32767px Firefox), which was the root cause
  // of the "waveform goes white when zooming" bug across all four views:
  //   at maxZoom=600 on a 4-min track → scrollWidth=144000px → backing store
  //   144000×dpr px → browser silently blanks the canvas → white over waveform.
  // The companion drawOverlay() uses a windowed time→x mapping to match.
  function ensureOverlay() {
    const wrapper = getWrapper();
    if (!wrapper) return;
    if (!overlayCanvas) {
      overlayCanvas = document.createElement('canvas');
      overlayCanvas.style.position = 'absolute';
      overlayCanvas.style.top = '0';
      overlayCanvas.style.left = '0';
      overlayCanvas.style.pointerEvents = 'none';
      overlayCanvas.style.zIndex = '5';
      wrapper.appendChild(overlayCanvas);
    } else if (overlayCanvas.parentElement !== wrapper) {
      wrapper.appendChild(overlayCanvas);
    }
    const dpr = window.devicePixelRatio || 1;
    // 9a: viewport-sized canvas — safe at any zoom level.
    const cssW = Math.min(wrapper.clientWidth || 0, OVERLAY_CAP_PX);
    const cssH = viewHeight();
    overlayCanvas.width = Math.max(1, Math.round(cssW * dpr));
    overlayCanvas.height = Math.max(1, Math.round(cssH * dpr));
    overlayCanvas.style.width = `${cssW}px`;
    overlayCanvas.style.height = `${cssH}px`;
    overlayCanvas.style.left = `${wrapper.scrollLeft}px`; // 9a: slide with scroll
  }

  // (Re)build the spectrogram background image, sized to the wrapper's current
  // scroll width × view height. Mounted as the FIRST child of the wrapper so it
  // renders behind the (near-invisible) waveform and the overlay canvas; both
  // sit on top so cues/cursor/regions stay usable. Only in spectrogram view with
  // a non-null spectrogramUrl (otherwise we fall back to the simple bars render).
  function ensureSpectrogram() {
    if (view !== 'spectrogram' || !spectrogramUrl) {
      removeSpectrogram();
      return;
    }
    const wrapper = getWrapper();
    if (!wrapper) return;
    if (!spectrogramImg) {
      spectrogramImg = document.createElement('img');
      spectrogramImg.style.position = 'absolute';
      spectrogramImg.style.top = '0';
      spectrogramImg.style.left = '0';
      spectrogramImg.style.objectFit = 'fill';
      spectrogramImg.style.pointerEvents = 'none';
      spectrogramImg.style.zIndex = '0';
      spectrogramImg.alt = '';
    }
    if (spectrogramImg.getAttribute('src') !== spectrogramUrl) {
      spectrogramImg.src = spectrogramUrl;
    }
    // Always keep it as the first child (the waveform canvas is appended later).
    if (spectrogramImg.parentElement !== wrapper || wrapper.firstChild !== spectrogramImg) {
      wrapper.insertBefore(spectrogramImg, wrapper.firstChild);
    }
    const cssW = wrapper.scrollWidth || wrapper.clientWidth || 0;
    const cssH = viewHeight();
    spectrogramImg.style.width = `${cssW}px`;
    spectrogramImg.style.height = `${cssH}px`;
  }

  function removeSpectrogram() {
    if (spectrogramImg) {
      spectrogramImg.remove();
      spectrogramImg = null;
    }
  }

  function drawOverlay() {
    if (!overlayCanvas) return;
    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return;
    const w = overlayCanvas.width;   // device px — viewport-sized (9a)
    const h = overlayCanvas.height;
    ctx.clearRect(0, 0, w, h);
    if (peaksDuration <= 0) return;

    // 9a: Windowed coordinate mapping. The canvas covers only the visible viewport,
    // positioned at wrapper.scrollLeft (set in ensureOverlay / repositionOverlay).
    // For a feature at time t (seconds):
    //   xCss = t * pxPerSec − scrollLeft   (position within the canvas, in CSS px)
    //   xDev = xCss * dpr                  (device pixels; what canvas coords use)
    // Features whose xCss falls outside [0, cssW) are skipped or clipped.
    const dpr = window.devicePixelRatio || 1;
    const wrapper = getWrapper();
    const cssW = w / dpr; // canvas width in CSS px
    const pxPerSec = wrapper && wrapper.scrollWidth > 0
      ? wrapper.scrollWidth / peaksDuration
      : currentPxPerSec;
    const scrollLeft = wrapper?.scrollLeft ?? 0;

    // Silence spans — translucent muted rectangles over silent regions. Drawn
    // first so other layers (RMS/transients/beats) sit on top. Works in every
    // view since it paints on the shared overlay canvas.
    if (showSilence && silencesData && silencesData.length) {
      ctx.fillStyle = 'rgba(244,63,94,0.12)';
      for (let i = 0; i < silencesData.length; i++) {
        const s = silencesData[i];
        const x0Css = s.start * pxPerSec - scrollLeft;
        const x1Css = s.end * pxPerSec - scrollLeft;
        if (x1Css < 0 || x0Css >= cssW) continue; // fully outside window
        const x0Dev = Math.max(0, x0Css) * dpr;
        const x1Dev = Math.min(cssW, x1Css) * dpr;
        ctx.fillRect(x0Dev, 0, Math.max(1, x1Dev - x0Dev), h);
      }
    }

    // RMS loudness envelope — faint translucent fill centred vertically.
    if (showRms && rmsData && rmsData.length) {
      const n = rmsData.length;
      let max = 0;
      for (let i = 0; i < n; i++) if (rmsData[i] > max) max = rmsData[i];
      const norm = max || 1;
      const midY = h / 2;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      for (let i = 0; i < n; i++) {
        // bucket i covers time [(i/n)*dur, ((i+1)/n)*dur]
        const xCss = (i / n) * peaksDuration * pxPerSec - scrollLeft;
        const xNextCss = ((i + 1) / n) * peaksDuration * pxPerSec - scrollLeft;
        if (xNextCss < 0 || xCss >= cssW) continue;
        const bw = Math.max(1, (xNextCss - xCss) * dpr);
        const bh = (rmsData[i] / norm) * h * 0.95;
        ctx.fillRect(xCss * dpr, midY - bh / 2, bw, bh);
      }
    }

    // Transient onsets — thin amber ticks from baseline up ~20% height.
    if (showTransients && transients && transients.length) {
      const baseY = h;
      const tickH = h * 0.2;
      ctx.fillStyle = 'rgba(251,191,36,0.8)';
      for (let i = 0; i < transients.length; i++) {
        const t = transients[i];
        if (t < 0 || t > peaksDuration) continue;
        const xCss = t * pxPerSec - scrollLeft;
        if (xCss < 0 || xCss >= cssW) continue;
        ctx.fillRect(xCss * dpr, baseY - tickH, Math.max(1, dpr), tickH);
      }
    }

    // Beat grid — thin vertical lines. Uses explicit beatGrid times if present
    // (offset by beatAnchorOffset), else derives from firstBeatSec + n*(60/bpm).
    // Downbeats are emphasised: prefer BeatNet's explicit `downbeats` array
    // (Phase 1B) drawn as a strong second pass; otherwise fall back to every-4th.
    if (showBeatGrid && tempoData) {
      const downbeats = Array.isArray(tempoData.downbeats) ? tempoData.downbeats : null;
      const hasDownbeats = !!(downbeats && downbeats.length);
      const beats: number[] = [];
      const grid = tempoData.beatGrid;
      if (Array.isArray(grid) && grid.length) {
        for (let i = 0; i < grid.length; i++) beats.push(grid[i] + beatAnchorOffset);
      } else if (tempoData.bpm > 0) {
        const step = 60 / tempoData.bpm;
        const start = tempoData.firstBeatSec + beatAnchorOffset;
        for (let t = start, n = 0; t <= peaksDuration; t = start + ++n * step) {
          beats.push(t);
        }
      }
      // Beat ticks. With explicit downbeats, render every beat faint (the strong
      // downbeat pass below sits on top); otherwise emphasise every 4th here.
      for (let i = 0; i < beats.length; i++) {
        const t = beats[i];
        if (t < 0 || t > peaksDuration) continue;
        const xCss = t * pxPerSec - scrollLeft;
        if (xCss < 0 || xCss >= cssW) continue;
        const isDownbeat = !hasDownbeats && i % 4 === 0;
        ctx.fillStyle = isDownbeat ? 'rgba(129,140,248,0.8)' : 'rgba(129,140,248,0.35)';
        const lw = isDownbeat ? Math.max(2, 2 * dpr) : Math.max(1, dpr);
        ctx.fillRect(xCss * dpr, 0, lw, h);
      }
      // Strong downbeat pass from the explicit array (offset by beatAnchorOffset).
      if (hasDownbeats) {
        ctx.fillStyle = 'rgba(129,140,248,0.85)';
        const lw = Math.max(2, 2 * dpr);
        for (let i = 0; i < downbeats!.length; i++) {
          const t = downbeats![i] + beatAnchorOffset;
          if (t < 0 || t > peaksDuration) continue;
          const xCss = t * pxPerSec - scrollLeft;
          if (xCss < 0 || xCss >= cssW) continue;
          ctx.fillRect(xCss * dpr, 0, lw, h);
        }
      }
    }

    // Markers (Phase 2c) — point labels: a hairline with a small triangle cap at
    // the top. Visual only here; seek/rename happen in the markers list.
    if (markers && markers.length) {
      for (const mk of markers) {
        if (mk.time < 0 || mk.time > peaksDuration) continue;
        const xCss = mk.time * pxPerSec - scrollLeft;
        if (xCss < 0 || xCss >= cssW) continue;
        const xDev = xCss * dpr;
        ctx.fillStyle = mk.color || '#f8fafc';
        ctx.fillRect(xDev, 0, Math.max(1, dpr), h);
        const s = 5 * dpr;
        ctx.beginPath();
        ctx.moveTo(xDev - s, 0);
        ctx.lineTo(xDev + s, 0);
        ctx.lineTo(xDev, s * 1.6);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // Rebuild + repaint (used on ready/redraw/zoom — wrapper.scrollWidth changes).
  // The spectrogram img is rebuilt/resized on the same triggers so it stays
  // aligned with the waveform under zoom.
  function refreshOverlay() {
    ensureSpectrogram();
    ensureOverlay();
    drawOverlay();
  }

  // Report the scroll/zoom geometry so a sibling (the swim-lane strip) can align
  // to the waveform's pixel scale + scroll position (Phase 5c).
  let scrollWrapper: HTMLElement | null = null;
  function reportScroll() {
    const w = getWrapper();
    if (w) onScroll?.({ scrollLeft: w.scrollLeft, scrollWidth: w.scrollWidth, clientWidth: w.clientWidth });
  }

  function removeOverlay() {
    if (overlayCanvas) {
      overlayCanvas.remove();
      overlayCanvas = null;
    }
  }

  // 9a: Slide the viewport-windowed overlay canvas to match the current scroll
  // position without resizing. Called on every scroll event — cheap CSS update.
  function repositionOverlay() {
    const wrapper = getWrapper();
    if (!wrapper || !overlayCanvas) return;
    overlayCanvas.style.left = `${wrapper.scrollLeft}px`;
  }

  // 9a: Combined scroll handler. Repositions and redraws the windowed overlay
  // so its content tracks the visible area, then notifies lane-strip consumers.
  function onWrapperScroll() {
    repositionOverlay();
    drawOverlay();
    reportScroll();
  }

  $effect(() => {
    // Read both reactive deps up-front so this effect always tracks them. If we
    // only read them inside the `||` below, the first run short-circuits on the
    // url check and never registers `view` as a dependency — so toggling
    // Simple↔CDJ afterwards wouldn't re-render the waveform.
    const v = view;
    const url = mediaUrl;
    if (url && container && (url !== lastUrl || v !== lastView)) {
      // 7a: preserve zoom so the new ws instance restores it instead of snapping
      // to fit when the user switches views (Simple↔CDJ↔RGB↔Spectrogram).
      preservedPxPerSec = currentPxPerSec;
      reload();
    }
  });

  async function reload() {
    teardown();
    // Fetch + cache peaks JSON (overall + optional bands + Tier 1/2 analysis).
    // All blocks are cached in module vars so a view switch (cache hit, fetch
    // skipped) still surfaces them — onAnalysis must pass the module vars, not
    // locals, or tempo/analysis would null out when toggling Simple↔CDJ.
    if (waveformUrl && fetchedFor !== waveformUrl) {
      try {
        const j = await fetch(waveformUrl).then((r) => r.json());
        peaksData = j?.data ?? null;
        bands = j?.bands ?? null;
        bandMax = bands
          ? { low: arrMax(bands.low), mid: arrMax(bands.mid), high: arrMax(bands.high) }
          : { low: 1, mid: 1, high: 1 };
        rmsData = j?.rms ?? null;
        transients = j?.transients ?? null;
        peaksDuration = j?.duration ?? 0;
        tempoData = j?.tempo ?? null;
        silencesData = j?.silences ?? null;
        sectionsData = j?.sections ?? null;
        fetchedFor = waveformUrl;
      } catch {
        peaksData = null;
        bands = null;
        bandMax = { low: 1, mid: 1, high: 1 };
        rmsData = null;
        transients = null;
        peaksDuration = 0;
        tempoData = null;
        silencesData = null;
        sectionsData = null;
      }
    }
    // RGB artifact (Phase 1A) — decoded lazily and cached by url. Independent of
    // the peaks fetch: best-effort, and only the 'rgb' view consumes it.
    if (waveformRgbUrl && rgbFetchedFor !== waveformRgbUrl) {
      try {
        rgbData = await fetchWaveformRGB(waveformRgbUrl);
        rgbFetchedFor = waveformRgbUrl;
      } catch {
        rgbData = null;
      }
    } else if (!waveformRgbUrl) {
      rgbData = null;
      rgbFetchedFor = '';
    }
    onAnalysis?.({
      rms: rmsData,
      transients,
      duration: peaksDuration,
      tempo: tempoData,
      bands,
      silences: silencesData,
      sections: sectionsData,
    });
    init();
  }

  function teardown() {
    removeOverlay();
    removeSpectrogram();
    scrollWrapper?.removeEventListener('scroll', onWrapperScroll); // 9a
    scrollWrapper = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
    loopRegionRef = null; // 7b: cleared on rebuild; the region lives inside ws
    if (ws) ws.destroy();
    ws = null;
    regions = null;
    regionMap = new Map();
    ready = false;
  }

  function init() {
    lastUrl = mediaUrl;
    lastView = view;
    regions = RegionsPlugin.create();
    const timeline = TimelinePlugin.create({
      timeInterval: 5,
      primaryLabelInterval: 10,
      style: { fontSize: '10px', color: '#71717a' },
    });

    const isCdj = view === 'cdj';
    const isRgb = view === 'rgb' && !!rgbData;
    const isSpectrogram = view === 'spectrogram';
    const plugins: any[] = [regions, timeline];

    // Tier 2 plugins — each wrapped so an option-shape mismatch in one plugin
    // can't take down init(). Only push the ones that construct cleanly.
    try {
      plugins.push(
        MinimapPlugin.create({ height: 24, waveColor: '#3f3f46', progressColor: '#6366f1' }),
      );
    } catch (e) {
      console.warn('[WaveformTrack] minimap plugin failed', e);
    }
    try {
      plugins.push(ZoomPlugin.create({ scale: 0.5, maxZoom: 600 }));
    } catch (e) {
      console.warn('[WaveformTrack] zoom plugin failed', e);
    }
    try {
      plugins.push(
        HoverPlugin.create({
          lineColor: '#e4e4ef',
          labelBackground: '#18181b',
          labelColor: '#e4e4ef',
        }),
      );
    } catch (e) {
      console.warn('[WaveformTrack] hover plugin failed', e);
    }

    // Compute a fit-to-width baseline used by ALL four views. All views open at a
    // consistent fit-to-container scale; fillParent:true (see opts below) floors
    // zoom-out at the container width without preventing zoom-in.
    const fitPx = peaksDuration > 0 && container?.clientWidth
      ? container.clientWidth / peaksDuration
      : 60;
    // 7a: Restore a zoom the user had before a view-switch; fall back to fit.
    const hadPreserved = preservedPxPerSec != null && isFinite(preservedPxPerSec);
    const initPx = hadPreserved ? (preservedPxPerSec as number) : fitPx;
    preservedPxPerSec = null;
    currentPxPerSec = initPx;
    atFit = !hadPreserved; // true on fresh load; false when restoring user zoom

    const opts: any = {
      container,
      height: viewHeight(),
      cursorColor: '#e4e4ef',
      cursorWidth: 1,
      normalize: true,
      // 8a: Restore fillParent:true. With fillParent:true, zoom-IN still works
      // (a scrollable waveform ignores fillParent), while zoom-OUT is naturally
      // floored at fit-to-container (no white gap). The Phase-7a assumption that
      // fillParent:true makes ws.zoom() a no-op was incorrect — it only prevents
      // the waveform from shrinking narrower than the container, which is desired.
      fillParent: true,
      autoScroll: true,
      autoCenter: follow, // "Follow" toggle: keep the playhead centred while playing
      plugins,
      url: mediaUrl,
      minPxPerSec: initPx,
    };

    if (isCdj || isRgb) {
      // CDJ / energy-RGB views: custom render function maps full canvas width →
      // buckets, so they draw correctly at any zoom level.
      opts.renderFunction = isRgb ? rgbRender : cdjRender;
    } else if (isSpectrogram && spectrogramUrl) {
      // Spectrogram view: render the waveform nearly invisible so the
      // spectrogram image (mounted behind it in ensureSpectrogram) shows
      // through, while regions/cursor/timeline/playback still work for cueing.
      opts.waveColor = 'rgba(255,255,255,0.06)';
      opts.progressColor = 'rgba(129,140,248,0.25)';
      opts.barWidth = 1;
      opts.barGap = 0;
      opts.barRadius = 0;
    } else {
      // Fine indigo bars, zoomable/scrollable. Also the spectrogram-view
      // fallback when spectrogramUrl is null.
      opts.waveColor = '#4f46e5';
      opts.progressColor = '#818cf8';
      opts.barWidth = 1;
      opts.barGap = 0;
      opts.barRadius = 0;
    }
    if (peaksData) opts.peaks = [peaksData];

    create(opts);
  }

  function create(opts: any) {
    ws = WaveSurfer.create(opts);
    ws.on('ready', () => {
      ready = true;
      onReady?.(ws!);
      syncRegions();
      syncLoopRegion(); // 7b: draw the loop span if bounds are already set
      refreshOverlay();
      // Attach a native scroll listener so the windowed overlay tracks manual
      // scrolling (9a: onWrapperScroll reposition + redraws + notifies consumers).
      scrollWrapper = getWrapper();
      scrollWrapper?.addEventListener('scroll', onWrapperScroll, { passive: true }); // 9a
      reportScroll();
      // 7a: Re-apply fit when the container resizes (e.g. window resize, Lanes
      // strip toggled). Only re-fits when atFit is true — if the user has zoomed
      // in, we leave their zoom and just rebuild the overlays.
      resizeObserver = new ResizeObserver(() => {
        if (!ready || peaksDuration <= 0 || !container) return;
        const fit = container.clientWidth / peaksDuration;
        if (!(fit > 0) || !isFinite(fit)) return;
        if (atFit) {
          try { ws?.zoom(fit); currentPxPerSec = fit; } catch { /* ignore */ }
        }
        refreshOverlay();
        reportScroll();
      });
      resizeObserver.observe(container);
    });
    // wrapper.scrollWidth changes on zoom/redraw — rebuild the overlay to match.
    ws.on('redraw', () => { refreshOverlay(); reportScroll(); });
    ws.on('zoom', (minPxPerSec: number) => {
      currentPxPerSec = minPxPerSec;
      atFit = false; // 7a: user/wheel-zoomed; ResizeObserver should not re-fit
      refreshOverlay();
      reportScroll();
    });
    ws.on('timeupdate', (t: number) => {
      onTime?.(t);
      // Loop playback: when both bounds are set and valid, wrap to loopStart.
      if (
        loopStartRef != null &&
        loopEndRef != null &&
        loopEndRef > loopStartRef &&
        t >= loopEndRef
      ) {
        ws?.setTime(loopStartRef);
      }
    });
    ws.on('play', () => onPlayState?.(true));
    ws.on('pause', () => onPlayState?.(false));
    ws.on('finish', () => onPlayState?.(false));
    ws.on('dblclick', () => {
      if (canEdit && onCueAdd && ws) onCueAdd(ws.getCurrentTime());
    });
    regions!.on('region-updated', (r: Region) => {
      const cue = cues.find((c) => c.id === r.id);
      if (cue && editable(cue) && onCueMove) onCueMove(r.id, r.start);
    });
    regions!.on('region-clicked', (r: Region, e: MouseEvent) => {
      e.stopPropagation();
      onCueSelect?.(r.id);
      ws?.setTime(r.start);
    });
  }

  // 7b: Draw (or update/remove) the loop span region. Uses a reserved id
  // '__loop__' so the cue-diff loop in syncRegions() never touches it.
  function syncLoopRegion() {
    if (!regions || !ready) return;
    if (loopStartRef != null && loopEndRef != null && loopEndRef > loopStartRef) {
      if (loopRegionRef) {
        loopRegionRef.setOptions({ start: loopStartRef, end: loopEndRef });
      } else {
        loopRegionRef = regions.addRegion({
          id: '__loop__',
          start: loopStartRef,
          end: loopEndRef,
          color: 'rgba(99,102,241,0.15)',
          drag: false,
          resize: false,
        });
      }
    } else {
      if (loopRegionRef) {
        loopRegionRef.remove();
        loopRegionRef = null;
      }
    }
  }

  function syncRegions() {
    if (!regions || !ready) return;
    for (const [id, region] of regionMap) {
      if (!cues.find((c) => c.id === id)) {
        region.remove();
        regionMap.delete(id);
      }
    }
    for (const cue of cues) {
      const existing = regionMap.get(cue.id);
      const cueColor = effectiveCueColor(cue, departments);
      if (existing) {
        if (Math.abs(existing.start - cue.time) > 0.01) existing.setOptions({ start: cue.time });
        existing.setOptions({ content: cue.name, color: `${cueColor}66`, drag: editable(cue) });
      } else {
        const region = regions.addRegion({
          id: cue.id,
          start: cue.time,
          color: `${cueColor}66`,
          drag: editable(cue),
          resize: false,
          content: cue.name,
        });
        regionMap.set(cue.id, region);
      }
    }
  }

  $effect(() => {
    void cues;
    void departments; // re-colour regions when department colours change
    if (ready) syncRegions();
  });

  // Repaint overlay layers when toggles (or markers) change (no rebuild needed).
  $effect(() => {
    void showRms;
    void showTransients;
    void showBeatGrid;
    void showSilence;
    void beatAnchorOffset;
    void markers;
    if (ready && overlayCanvas) drawOverlay();
  });

  // Re-mount/resize the spectrogram image if its URL changes mid-view (a view
  // switch already goes through reload()/refreshOverlay()).
  $effect(() => {
    void spectrogramUrl;
    if (ready) ensureSpectrogram();
  });

  // Mirror loop bounds into plain refs read by the ws 'timeupdate' callback,
  // and redraw the visible loop region (7b) whenever either bound changes.
  $effect(() => {
    loopStartRef = loopStart;
    loopEndRef = loopEnd;
    if (ready) syncLoopRegion();
  });

  // Follow toggle → recentre the playhead while playing (wavesurfer autoCenter).
  $effect(() => {
    const f = follow;
    try {
      (ws as any)?.setOptions?.({ autoScroll: true, autoCenter: f });
    } catch (e) {
      console.warn('[WaveformTrack] setOptions(follow) failed', e);
    }
  });

  export function playPause() {
    ws?.playPause();
  }
  export function play() {
    ws?.play();
  }
  export function pause() {
    ws?.pause();
  }
  export function stop() {
    ws?.pause();
    ws?.setTime(0);
  }
  export function seekTo(time: number) {
    ws?.setTime(time);
  }
  // Seek by a relative number of seconds, clamped to the track bounds.
  export function seekBy(delta: number) {
    if (!ws) return;
    const dur = ws.getDuration?.() || peaksDuration || 0;
    const t = Math.max(0, Math.min(dur, ws.getCurrentTime() + delta));
    ws.setTime(t);
  }
  export function isPlaying(): boolean {
    return !!ws?.isPlaying?.();
  }

  // Fit the entire track into the visible container width.
  export function fitZoom() {
    if (!ws || !ready || !container) return;
    if (peaksDuration <= 0) return;
    const px = container.clientWidth / peaksDuration;
    if (!(px > 0) || !isFinite(px)) return;
    try {
      ws.zoom(px);
      currentPxPerSec = px;
      atFit = true; // 7a: mark as fit so ResizeObserver re-fits on next resize
    } catch (e) {
      console.warn('[WaveformTrack] fitZoom failed', e);
    }
  }

  // Relative zoom by a multiplicative factor, clamped to a sane px/sec range.
  export function zoomBy(factor: number) {
    if (!ws || !ready || !(factor > 0)) return;
    // 8a: Clamp minimum to fit floor so currentPxPerSec never drifts below what
    // wavesurfer actually renders (fillParent:true clamps zoom-out at fit anyway;
    // this keeps our tracked state consistent and mirrors the ZoomPlugin wheel clamp).
    const fitFloor = peaksDuration > 0 && container ? container.clientWidth / peaksDuration : 5;
    const px = Math.max(fitFloor, Math.min(600, currentPxPerSec * factor));
    try {
      ws.zoom(px);
      currentPxPerSec = px;
      atFit = false; // 7a: user zoomed; ResizeObserver should not re-fit
    } catch (e) {
      console.warn('[WaveformTrack] zoomBy failed', e);
    }
  }

  // Zoom so [start,end] fills the container, scrolled so start is at the left.
  export function zoomToSelection(start: number, end: number) {
    if (!ws || !ready || !container) return;
    const span = end - start;
    if (!(span > 0)) return;
    const px = container.clientWidth / span;
    if (!(px > 0) || !isFinite(px)) return;
    try {
      ws.zoom(px);
      currentPxPerSec = px;
      const anyWs = ws as any;
      if (typeof anyWs.setScrollTime === 'function') {
        anyWs.setScrollTime(start);
      } else {
        // Fallback: scroll the wrapper so start lands at the left edge.
        const wrapper = getWrapper();
        if (wrapper) wrapper.scrollLeft = start * px;
      }
    } catch (e) {
      console.warn('[WaveformTrack] zoomToSelection failed', e);
    }
  }

  onDestroy(teardown);
</script>

<!-- 9b: flush=true removes the border/rounding so the wavesurfer canvas fills its
     container exactly — used by the DJ builder where alignment precision matters. -->
<div class={flush ? 'overflow-hidden bg-neutral-950' : 'overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950'}>
  <div bind:this={container} class="w-full"></div>
  {#if !ready}
    <p class="px-3 py-2 text-xs text-neutral-600">Loading waveform…</p>
  {/if}
</div>
{#if canEdit}
  <p class="mt-1 text-[11px] text-neutral-600">Double-click the waveform to drop a cue · drag a marker to move it · Space to play/pause</p>
{/if}
