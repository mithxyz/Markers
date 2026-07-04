<script lang="ts">
  import { onDestroy } from 'svelte';
  import type WaveSurfer from 'wavesurfer.js';
  import { api } from '$lib/api';
  import { ui } from '$lib/stores/ui.svelte';

  let {
    projectId,
    trackId,
    videoId,
    audioWs,
    canEdit = false,
    initialOffset = 0,
  }: {
    projectId: string;
    trackId: string;
    videoId: string;
    audioWs: WaveSurfer | null;
    canEdit?: boolean;
    initialOffset?: number;
  } = $props();

  let video: HTMLVideoElement;
  let mediaUrl = $state('');
  let offset = $state(initialOffset);
  let raf = 0;

  // Sync constants (see plan §Video↔audio sync).
  const DEAD = 0.05; // ignore drift below this
  const HARD = 0.25; // hard reseek above this
  const K = 0.5; // playbackRate nudge gain

  $effect(() => {
    if (videoId) load();
  });

  async function load() {
    try {
      const r = await api.get<{ mediaUrl: string; offset_seconds: number }>(
        `/projects/${projectId}/tracks/${trackId}/video/${videoId}/media`
      );
      mediaUrl = r.mediaUrl;
      offset = r.offset_seconds;
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  // Audio (wavesurfer) is the clock master; video is slaved via rAF.
  function tick() {
    raf = requestAnimationFrame(tick);
    if (!audioWs || !video || video.readyState < 2) return;

    const target = audioWs.getCurrentTime() + offset;
    const playing = audioWs.isPlaying();

    if (playing && video.paused) video.play().catch(() => {});
    if (!playing && !video.paused) video.pause();

    const drift = target - video.currentTime;
    const ad = Math.abs(drift);
    if (ad >= HARD) {
      video.currentTime = Math.max(0, target);
      video.playbackRate = 1;
    } else if (ad > DEAD && playing) {
      // Glide back into sync without a visible jump.
      video.playbackRate = 1 + Math.max(-0.08, Math.min(0.08, drift * K));
    } else {
      video.playbackRate = 1;
    }
  }

  $effect(() => {
    if (mediaUrl && audioWs) {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    }
  });

  onDestroy(() => cancelAnimationFrame(raf));

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  function nudgeOffset(delta: number) {
    offset = Math.round((offset + delta) * 100) / 100;
    persistOffset();
  }
  function persistOffset() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await api.patch(`/projects/${projectId}/tracks/${trackId}/video/${videoId}`, { offset_seconds: offset });
      } catch (e) {
        ui.toast((e as Error).message, 'error');
      }
    }, 400);
  }
</script>

<div class="rounded-xl border border-neutral-800 bg-neutral-950 p-2">
  {#if mediaUrl}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={video} src={mediaUrl} muted playsinline class="max-h-64 w-full rounded-lg bg-black"></video>
    {#if canEdit}
      <div class="mt-2 flex items-center justify-between text-xs text-neutral-400">
        <span>Sync offset: <strong class="text-neutral-200">{offset.toFixed(2)}s</strong></span>
        <div class="flex items-center gap-1">
          <button onclick={() => nudgeOffset(-0.1)} class="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700">−0.1s</button>
          <button onclick={() => nudgeOffset(-0.01)} class="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700">−0.01</button>
          <button onclick={() => nudgeOffset(0.01)} class="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700">+0.01</button>
          <button onclick={() => nudgeOffset(0.1)} class="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700">+0.1s</button>
        </div>
      </div>
    {/if}
  {:else}
    <p class="px-2 py-4 text-center text-xs text-neutral-600">Loading video…</p>
  {/if}
</div>
