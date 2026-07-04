<script lang="ts">
  import type { ShowElement } from '$lib/types';
  import { SHOW_ELEMENT_TYPES } from '$lib/showElementTypes';

  let {
    elements = [],
    duration = 0,
    currentTime = 0,
    sync = null,
    onSeek,
  }: {
    elements?: ShowElement[];
    duration?: number;
    currentTime?: number;
    sync?: { scrollLeft: number; scrollWidth: number; clientWidth: number } | null;
    onSeek?: (t: number) => void;
  } = $props();

  // One scroll viewport for all rows — single mirror effect, guaranteed alignment.
  let viewportEl: HTMLDivElement;
  let viewportW = $state(0);

  // Adopt the waveform's full zoomed pixel width when synced; fall back to viewport.
  const contentW = $derived(sync && sync.scrollWidth > 0 ? sync.scrollWidth : Math.max(1, viewportW));
  const t01 = (t: number) => (duration > 0 ? Math.min(1, Math.max(0, t / duration)) : 0);

  // Mirror the waveform scroll offset so these lanes track zoom + pan exactly.
  $effect(() => {
    if (viewportEl && sync) viewportEl.scrollLeft = sync.scrollLeft;
  });

  // Only render types that have at least one element.
  const visibleTypes = $derived(
    SHOW_ELEMENT_TYPES.filter((et) => elements.some((e) => e.type === et.type))
  );
</script>

<!-- Single scroll viewport wrapping all rows (overflow-x-hidden; scrollLeft driven by sync effect) -->
<div
  bind:this={viewportEl}
  bind:clientWidth={viewportW}
  class="overflow-x-hidden"
>
  <!-- Inner div sized to the full (zoomed) content width -->
  <div style="width: {contentW}px; position: relative;">
    {#each visibleTypes as et (et.type)}
      {@const rowEls = elements.filter((e) => e.type === et.type)}
      <div class="relative flex border-b border-neutral-900 last:border-0" style="height: 28px;">
        <!-- Label gutter: fixed w-28 matching LaneStrip and the Phase 9 waveform indent -->
        <div class="flex w-28 shrink-0 items-center gap-1.5 border-r border-neutral-900 bg-neutral-950 px-2">
          <span class="text-xs" aria-hidden="true">{et.emoji}</span>
          <span class="truncate text-[11px] text-neutral-400">{et.shortLabel}</span>
        </div>
        <!-- Content pane — positions in px against contentW, NOT % -->
        <div class="relative flex-1">
          {#each rowEls as el (el.id)}
            {@const left = t01(el.time) * contentW}
            {@const isRegion = el.end_time != null && el.end_time > el.time}
            {@const w = isRegion ? Math.max(4, (t01(el.end_time!) - t01(el.time)) * contentW) : 4}
            <button
              class="absolute top-1 bottom-1 cursor-pointer rounded"
              style="left: {left}px; width: {w}px; background: {et.color}99; border: 1px solid {et.color};"
              title="{el.name || et.label}{el.note ? '\n' + el.note : ''} · {el.time.toFixed(2)}s"
              onclick={() => onSeek?.(el.time)}
            ></button>
          {/each}
          <!-- Playhead line -->
          {#if duration > 0}
            <div
              class="pointer-events-none absolute top-0 bottom-0 w-px bg-white/50"
              style="left: {t01(currentTime) * contentW}px;"
            ></div>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>
