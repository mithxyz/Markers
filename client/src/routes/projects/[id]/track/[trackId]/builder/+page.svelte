<script lang="ts">
  import { getContext, onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { ProjectStore, PROJECT_CTX } from '$lib/stores/project.svelte';
  import { currentVersion } from '$lib/types';
  import type { ShowElement } from '$lib/types';
  import { SHOW_ELEMENT_TYPES, getElementType } from '$lib/showElementTypes';
  import { api } from '$lib/api';
  import { ui } from '$lib/stores/ui.svelte';
  import WaveformTrack from '$lib/components/WaveformTrack.svelte';
  import ShowBuilderTimeline from '$lib/components/ShowBuilderTimeline.svelte';
  import type WaveSurfer from 'wavesurfer.js';

  const store = getContext<ProjectStore>(PROJECT_CTX);
  const trackId = $derived(($page.params as Record<string, string>).trackId);
  const track = $derived(store.trackById(trackId));
  const cv = $derived(track ? currentVersion(track) : null);
  const base = $derived(`/projects/${store.id}/tracks/${trackId}`);

  // Waveform/audio state
  let wave = $state<WaveformTrack>();
  let audioWs = $state<WaveSurfer | null>(null);
  let mediaUrl = $state('');
  let waveformUrl = $state('');
  let analysis = $state<any>(null);
  let isPlaying = $state(false);
  let currentTime = $state(0);
  let waveScroll = $state<{ scrollLeft: number; scrollWidth: number; clientWidth: number } | null>(null);

  const bpm = $derived<number | null>(analysis?.tempo?.bpm ?? null);
  const firstBeatSec = $derived<number>(analysis?.tempo?.firstBeatSec ?? 0);
  const duration = $derived<number>(analysis?.duration ?? cv?.media_duration ?? 0);

  // Show elements state
  let elements = $state<ShowElement[]>([]);
  let selectedElement = $state<ShowElement | null>(null);
  let beatSnap = $state(true);
  let nameEdit = $state('');
  let noteEdit = $state('');
  let intensityEdit = $state(100);
  let savingProp = $state(false);

  // Derived: selected element type def
  const selType = $derived(selectedElement ? getElementType(selectedElement.type) : null);

  $effect(() => {
    if (selectedElement) {
      nameEdit = selectedElement.name ?? '';
      noteEdit = selectedElement.note ?? '';
      intensityEdit = selectedElement.intensity ?? 100;
    }
  });

  function formatTime(t: number): string {
    const m = Math.floor(t / 60);
    const s = (t % 60).toFixed(1).padStart(4, '0');
    return `${m}:${s}`;
  }

  // Load media URLs
  async function loadMedia() {
    if (!cv || !track) return;
    const m = await api.get<{ mediaUrl: string; waveformUrl: string | null }>(
      `/projects/${store.id}/tracks/${track.id}/versions/${cv.id}/media`
    );
    mediaUrl = m.mediaUrl;
    waveformUrl = m.waveformUrl || '';
  }

  // Load show elements
  async function loadElements() {
    if (!track) return;
    const { elements: els } = await api.get<{ elements: ShowElement[] }>(`${base}/show-elements`);
    elements = els;
  }

  // Socket subscriptions
  function setupSocket() {
    const socket = (store as any).socket;
    if (!socket) return;
    socket.on('show_element:created', ({ element }: { element: ShowElement }) => {
      if (!elements.find((e) => e.id === element.id)) elements = [...elements, element].sort((a, b) => a.time - b.time);
    });
    socket.on('show_element:updated', ({ element }: { element: ShowElement }) => {
      elements = elements.map((e) => (e.id === element.id ? element : e));
      if (selectedElement?.id === element.id) selectedElement = element;
    });
    socket.on('show_element:deleted', ({ elementId }: { elementId: string }) => {
      elements = elements.filter((e) => e.id !== elementId);
      if (selectedElement?.id === elementId) selectedElement = null;
    });
  }

  onMount(async () => {
    await Promise.all([loadMedia(), loadElements()]);
    setupSocket();
  });

  // --- Element CRUD ---

  async function createElement(type: string, time: number, endTime: number | null) {
    try {
      const { element } = await api.post<{ element: ShowElement }>(`${base}/show-elements`, {
        type, time, end_time: endTime,
        name: getElementType(type).shortLabel,
      });
      elements = [...elements, element].sort((a, b) => a.time - b.time);
      selectedElement = element;
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  async function updateElement(id: string, time: number, endTime: number | null) {
    try {
      const { element } = await api.patch<{ element: ShowElement }>(`${base}/show-elements/${id}`, {
        time, end_time: endTime,
      });
      elements = elements.map((e) => (e.id === id ? element : e));
      if (selectedElement?.id === id) selectedElement = element;
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  async function saveProperties() {
    if (!selectedElement) return;
    savingProp = true;
    try {
      const { element } = await api.patch<{ element: ShowElement }>(`${base}/show-elements/${selectedElement.id}`, {
        name: nameEdit.trim() || null,
        note: noteEdit.trim() || null,
        intensity: intensityEdit,
      });
      elements = elements.map((e) => (e.id === element.id ? element : e));
      selectedElement = element;
      ui.toast('Saved', 'success');
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    } finally {
      savingProp = false;
    }
  }

  async function deleteElement(id: string) {
    try {
      await api.del(`${base}/show-elements/${id}`);
      elements = elements.filter((e) => e.id !== id);
      if (selectedElement?.id === id) selectedElement = null;
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  // --- Transport ---
  function togglePlay() {
    if (!audioWs) return;
    audioWs.isPlaying() ? audioWs.pause() : audioWs.play();
  }

  function seekToStart() {
    audioWs?.seekTo(0);
  }

  // Keyboard shortcuts
  function onKeyDown(e: KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    if (e.code === 'Backspace' || e.code === 'Delete') {
      if (selectedElement) { e.preventDefault(); deleteElement(selectedElement.id); }
    }
    if (e.code === 'Escape') selectedElement = null;
  }
</script>

<svelte:window onkeydown={onKeyDown} />

{#if !track}
  <p class="px-8 py-10 text-sm text-neutral-500">Track not found.</p>
{:else}
  <div class="flex h-screen flex-col overflow-hidden bg-[#0a0a0b] text-white">

    <!-- ── Top bar ─────────────────────────────────────────────────────────── -->
    <header class="flex h-12 shrink-0 items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-4">
      <button
        onclick={() => goto(`/projects/${store.id}/track/${trackId}`)}
        class="flex items-center gap-1.5 rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-white"
      >← Back</button>

      <div class="h-4 w-px bg-neutral-800"></div>

      <span class="text-sm font-semibold text-white">{track.name}</span>
      {#if bpm}<span class="text-xs text-neutral-500">{bpm.toFixed(1)} BPM</span>{/if}

      <div class="flex-1"></div>

      <!-- Transport -->
      <button onclick={seekToStart} class="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white" title="Go to start">⏮</button>
      <button
        onclick={togglePlay}
        class="rounded-lg px-4 py-1.5 text-sm font-semibold transition {isPlaying ? 'bg-neutral-700 text-white' : 'bg-amber-500 text-black hover:bg-amber-400'}"
      >{isPlaying ? '⏸ Pause' : '▶ Play'}</button>
      <span class="w-20 text-right font-mono text-sm text-neutral-300">{formatTime(currentTime)}</span>

      <div class="h-4 w-px bg-neutral-800"></div>

      <!-- 9c: Zoom controls — parity with main track workspace -->
      <span class="text-xs text-neutral-600">Zoom</span>
      <button onclick={() => wave?.fitZoom()} class="rounded border border-neutral-800 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-white" title="Fit to window">Fit</button>
      <button onclick={() => wave?.zoomBy(0.5)} class="rounded border border-neutral-800 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-white" title="Zoom out">−</button>
      <button onclick={() => wave?.zoomBy(2)} class="rounded border border-neutral-800 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-white" title="Zoom in">+</button>

      <div class="h-4 w-px bg-neutral-800"></div>

      <!-- Beat snap toggle -->
      <label class="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-400">
        <input type="checkbox" bind:checked={beatSnap} class="accent-amber-500" />
        Beat snap
      </label>
    </header>

    <!-- ── Main area ────────────────────────────────────────────────────────── -->
    <div class="flex min-h-0 flex-1 overflow-hidden">

      <!-- Labels column (fixed) -->
      <div class="flex w-44 shrink-0 flex-col border-r border-neutral-800 bg-neutral-950">
        <!-- Waveform header row (matches waveform height below) -->
        <div class="flex h-28 shrink-0 items-end border-b border-neutral-800 px-3 pb-2">
          <span class="text-[11px] uppercase tracking-wide text-neutral-600">Waveform</span>
        </div>
        <!-- Time ruler spacer -->
        <div class="h-5 shrink-0 border-b border-neutral-800 bg-neutral-950/80"></div>
        <!-- Element type labels (one per row) -->
        {#each SHOW_ELEMENT_TYPES as et (et.type)}
          {@const count = elements.filter((e) => e.type === et.type).length}
          <div
            class="flex h-10 shrink-0 cursor-pointer items-center gap-2 border-b border-neutral-900 px-3 transition-colors hover:bg-neutral-900/40"
            onclick={() => { if (selectedElement?.type !== et.type) selectedElement = null; }}
            role="button"
            tabindex="-1"
            title="{et.label}: click any empty space on this lane to place an element, or drag right to create a region"
          >
            <span class="text-base leading-none" aria-hidden="true">{et.emoji}</span>
            <div class="min-w-0 flex-1">
              <div class="truncate text-xs font-medium text-neutral-200">{et.shortLabel}</div>
            </div>
            {#if count > 0}
              <span
                class="rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none"
                style="background: {et.color}33; color: {et.color};"
              >{count}</span>
            {/if}
          </div>
        {/each}
      </div>

      <!-- Scrollable timeline area -->
      <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
        <!-- Waveform (h-28 matches label column header) -->
        <!-- 9b: flush=true removes WaveformTrack's 1px border so the waveform
             canvas fills exactly the same width as the ShowBuilderTimeline below. -->
        <div class="h-28 shrink-0 border-b border-neutral-800">
          {#if mediaUrl}
            <WaveformTrack
              bind:this={wave}
              cues={[]}
              departments={[]}
              markers={[]}
              {mediaUrl}
              {waveformUrl}
              canEdit={false}
              view="simple"
              showBeatGrid={true}
              showRms={false}
              showTransients={false}
              showSilence={false}
              flush={true}
              onScroll={(s) => (waveScroll = s)}
              onReady={(ws) => (audioWs = ws)}
              onAnalysis={(a) => (analysis = a)}
              onPlayState={(pl) => (isPlaying = pl)}
              onTime={(t) => (currentTime = t)}
            />
          {:else}
            <div class="flex h-full items-center justify-center text-sm text-neutral-600">
              No audio loaded — upload a version to this track first.
            </div>
          {/if}
        </div>

        <!-- Interactive element lanes -->
        <!-- 9b: scrollbar-gutter:stable reserves scrollbar space permanently so a
             vertical scrollbar never shrinks the horizontal width of the timeline,
             keeping it aligned with the waveform above at all element counts. -->
        <div class="flex min-h-0 flex-1 overflow-y-auto" style="scrollbar-gutter: stable">
          <ShowBuilderTimeline
            {elements}
            {duration}
            sync={waveScroll}
            {currentTime}
            {beatSnap}
            {bpm}
            {firstBeatSec}
            selectedId={selectedElement?.id ?? null}
            onCreate={createElement}
            onUpdate={updateElement}
            onSelect={(el) => (selectedElement = el)}
          />
        </div>
      </div>
    </div>

    <!-- ── Properties panel ─────────────────────────────────────────────────── -->
    {#if selectedElement}
      {@const et = getElementType(selectedElement.type)}
      <div class="flex shrink-0 flex-wrap items-center gap-3 border-t border-neutral-800 bg-neutral-950 px-4 py-3">
        <!-- Type badge -->
        <div class="flex items-center gap-2 rounded-lg px-3 py-1.5" style="background: {et.color}22; border: 1px solid {et.color}55;">
          <span class="text-base" aria-hidden="true">{et.emoji}</span>
          <span class="text-sm font-semibold" style="color: {et.color}">{et.label}</span>
          <span class="text-xs text-neutral-500">
            {formatTime(selectedElement.time)}{selectedElement.end_time != null ? ` → ${formatTime(selectedElement.end_time)}` : ''}
          </span>
        </div>

        <!-- Name -->
        <input
          bind:value={nameEdit}
          placeholder="Label…"
          maxlength="255"
          onblur={saveProperties}
          onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          class="w-36 rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-sm text-white outline-none focus:border-amber-500"
        />

        <!-- Note -->
        <input
          bind:value={noteEdit}
          placeholder="Note / cue…"
          maxlength="500"
          onblur={saveProperties}
          onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          class="w-48 rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-300 outline-none focus:border-amber-500"
        />

        <!-- Intensity -->
        <label class="flex items-center gap-2 text-xs text-neutral-500">
          Intensity
          <input
            type="range" min="0" max="100" step="5"
            bind:value={intensityEdit}
            onchange={saveProperties}
            class="w-24 accent-amber-500"
          />
          <span class="w-8 text-right text-neutral-300">{intensityEdit}%</span>
        </label>

        <div class="flex-1"></div>

        <!-- Delete -->
        <button
          onclick={() => deleteElement(selectedElement!.id)}
          class="rounded-lg border border-red-800 px-3 py-1.5 text-sm text-red-400 hover:border-red-600 hover:bg-red-950 hover:text-red-300"
        >Delete</button>
      </div>
    {:else}
      <!-- Hint bar when nothing selected -->
      <div class="flex h-10 shrink-0 items-center border-t border-neutral-800 bg-neutral-950/60 px-4 text-[11px] text-neutral-600">
        Click a lane to place a point · Click and drag right to create a region · Click an element to select · Space = play/pause · Delete = remove selected
      </div>
    {/if}

  </div>
{/if}
