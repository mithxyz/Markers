<script lang="ts">
  import type { ShowElement } from '$lib/types';
  import { SHOW_ELEMENT_TYPES, getElementType } from '$lib/showElementTypes';

  let {
    elements = [],
    duration = 0,
    sync = null,
    currentTime = 0,
    beatSnap = true,
    bpm = null,
    firstBeatSec = 0,
    selectedId = null,
    onCreate,
    onUpdate,
    onSelect,
  }: {
    elements?: ShowElement[];
    duration?: number;
    sync?: { scrollLeft: number; scrollWidth: number; clientWidth: number } | null;
    currentTime?: number;
    beatSnap?: boolean;
    bpm?: number | null;
    firstBeatSec?: number;
    selectedId?: string | null;
    onCreate?: (type: string, time: number, endTime: number | null) => void;
    onUpdate?: (id: string, time: number, endTime: number | null) => void;
    onSelect?: (el: ShowElement | null) => void;
  } = $props();

  let viewportEl: HTMLDivElement;
  let innerEl: HTMLDivElement;
  let viewportW = $state(0);

  const contentW = $derived(sync && sync.scrollWidth > 0 ? sync.scrollWidth : Math.max(1, viewportW));
  const t01 = (t: number) => (duration > 0 ? Math.min(1, Math.max(0, t / duration)) : 0);

  $effect(() => {
    if (viewportEl && sync) viewportEl.scrollLeft = sync.scrollLeft;
  });

  function timeAt(clientX: number): number {
    const r = innerEl?.getBoundingClientRect();
    if (!r || r.width <= 0) return 0;
    return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration));
  }

  function snap(t: number): number {
    if (!beatSnap || !bpm || bpm <= 0) return t;
    const beatSec = 60 / bpm;
    const rel = (t - firstBeatSec) / beatSec;
    return Math.round(rel) * beatSec + firstBeatSec;
  }

  // --- Drag state ---
  type CreateDrag = { mode: 'create'; elementType: string; startTime: number; curTime: number; startX: number };
  type MoveDrag   = { mode: 'move';   id: string; origTime: number; origEndTime: number | null; startX: number };
  type ResizeDrag = { mode: 'resize'; id: string; origEnd: number; curEnd: number };

  let drag = $state<CreateDrag | MoveDrag | ResizeDrag | null>(null);

  // Effective position for a given element (applies pending move/resize).
  function eff(el: ShowElement): { time: number; endTime: number | null } {
    if (drag?.mode === 'move' && drag.id === el.id) {
      const dPx = (drag as MoveDrag & { curX?: number }).curX ?? 0;
      const dT = contentW > 0 ? (dPx / contentW) * duration : 0;
      const t = Math.max(0, snap(el.time + dT));
      const et = el.end_time != null ? Math.max(t + 0.05, snap(el.end_time + dT)) : null;
      return { time: t, endTime: et };
    }
    if (drag?.mode === 'resize' && drag.id === el.id) {
      return { time: el.time, endTime: (drag as ResizeDrag).curEnd };
    }
    return { time: el.time, endTime: el.end_time };
  }

  // Elements grouped by type for rendering.
  const byType = $derived.by(() => {
    const m = new Map<string, ShowElement[]>(SHOW_ELEMENT_TYPES.map((e) => [e.type, []]));
    for (const el of elements) m.get(el.type)?.push(el);
    return m;
  });

  // --- Event handlers ---

  function rowDown(e: PointerEvent, type: string) {
    if ((e.target as HTMLElement).closest('[data-eid]')) return;
    e.preventDefault();
    onSelect?.(null);
    const t = snap(timeAt(e.clientX));
    drag = { mode: 'create', elementType: type, startTime: t, curTime: t, startX: e.clientX };
    window.addEventListener('pointermove', globalMove);
    window.addEventListener('pointerup', globalUp);
  }

  function elDown(e: PointerEvent, el: ShowElement) {
    e.preventDefault();
    e.stopPropagation();
    onSelect?.(el);
    drag = { mode: 'move', id: el.id, origTime: el.time, origEndTime: el.end_time, startX: e.clientX, curX: 0 } as any;
    window.addEventListener('pointermove', globalMove);
    window.addEventListener('pointerup', globalUp);
  }

  function resizeDown(e: PointerEvent, el: ShowElement) {
    e.preventDefault();
    e.stopPropagation();
    drag = { mode: 'resize', id: el.id, origEnd: el.end_time ?? el.time + 1, curEnd: el.end_time ?? el.time + 1 };
    window.addEventListener('pointermove', globalMove);
    window.addEventListener('pointerup', globalUp);
  }

  function globalMove(e: PointerEvent) {
    if (!drag) return;
    if (drag.mode === 'create') {
      drag.curTime = snap(timeAt(e.clientX));
    } else if (drag.mode === 'move') {
      (drag as any).curX = e.clientX - drag.startX;
    } else if (drag.mode === 'resize') {
      const t = snap(timeAt(e.clientX));
      const rd = drag as ResizeDrag;
      const el = elements.find((x) => x.id === rd.id);
      drag.curEnd = Math.max((el?.time ?? 0) + 0.05, t);
    }
  }

  function globalUp(_e: PointerEvent) {
    window.removeEventListener('pointermove', globalMove);
    window.removeEventListener('pointerup', globalUp);
    const d = drag;
    drag = null;
    if (!d) return;

    if (d.mode === 'create') {
      const t1 = Math.min(d.startTime, d.curTime);
      const t2 = Math.max(d.startTime, d.curTime);
      onCreate?.(d.elementType, t1, t2 - t1 > 0.15 ? t2 : null);
    } else if (d.mode === 'move') {
      const el = elements.find((x) => x.id === d.id);
      if (!el) return;
      const dPx = (d as any).curX ?? 0;
      const dT = contentW > 0 ? (dPx / contentW) * duration : 0;
      if (Math.abs(dT) < 0.02) return;
      const t = Math.max(0, snap(el.time + dT));
      const et = el.end_time != null ? Math.max(t + 0.05, snap(el.end_time + dT)) : null;
      onUpdate?.(d.id, t, et);
    } else if (d.mode === 'resize') {
      const el = elements.find((x) => x.id === d.id);
      if (!el) return;
      onUpdate?.(d.id, el.time, d.curEnd);
    }
  }

  // Ghost element during create drag
  const ghost = $derived.by(() => {
    if (!drag || drag.mode !== 'create') return null;
    const t1 = Math.min(drag.startTime, drag.curTime);
    const t2 = Math.max(drag.startTime, drag.curTime);
    const left = t01(t1) * contentW;
    const w = Math.max(4, (t01(t2) - t01(t1)) * contentW);
    return { type: drag.elementType, left, w };
  });

  const ROW_H = 40; // px per element type row
</script>

<div
  bind:this={viewportEl}
  bind:clientWidth={viewportW}
  class="relative flex-1 overflow-x-hidden select-none"
>
  <div bind:this={innerEl} class="relative" style="width: {contentW}px;">
    <!-- Time ruler -->
    <div class="sticky top-0 z-10 h-5 border-b border-neutral-800 bg-neutral-950/95">
      {#if duration > 0}
        {#each Array.from({ length: Math.ceil(duration / 10) + 1 }, (_, i) => i * 10) as t}
          {@const left = t01(t) * contentW}
          {#if left < contentW}
            <div class="pointer-events-none absolute top-0 flex h-full flex-col justify-end" style="left: {left}px;">
              <div class="h-2 w-px bg-neutral-700"></div>
              <span class="absolute top-0.5 left-1 text-[9px] leading-none text-neutral-600">{Math.floor(t / 60)}:{String(t % 60).padStart(2, '0')}</span>
            </div>
          {/if}
        {/each}
      {/if}
    </div>

    <!-- Element type rows -->
    {#each SHOW_ELEMENT_TYPES as et (et.type)}
      {@const rowEls = byType.get(et.type) ?? []}
      {@const isCreateTarget = drag?.mode === 'create' && drag.elementType === et.type}
      <div
        class="relative border-b border-neutral-900 transition-colors"
        style="height: {ROW_H}px; background: {isCreateTarget ? et.color + '10' : 'transparent'}; cursor: crosshair;"
        role="button"
        tabindex="-1"
        onpointerdown={(e) => rowDown(e, et.type)}
      >
        <!-- Existing elements -->
        {#each rowEls as el (el.id)}
          {@const pos = eff(el)}
          {@const left = t01(pos.time) * contentW}
          {@const isRegion = pos.endTime != null && pos.endTime > pos.time}
          {@const w = isRegion ? Math.max(6, (t01(pos.endTime!) - t01(pos.time)) * contentW) : 6}
          {@const isSelected = selectedId === el.id}
          <div
            data-eid={el.id}
            class="absolute top-1.5 bottom-1.5 rounded cursor-grab active:cursor-grabbing"
            style="
              left: {left}px;
              width: {w}px;
              background: {et.color}{isSelected ? '' : '99'};
              border: 1.5px solid {et.color};
              outline: {isSelected ? `2px solid ${et.color}; outline-offset: 1px` : 'none'};
            "
            title="{el.name || et.label}{el.note ? '\n' + el.note : ''}"
            onpointerdown={(e) => elDown(e, el)}
          >
            {#if isRegion && w > 24}
              <span
                class="pointer-events-none absolute left-1 top-1/2 -translate-y-1/2 truncate text-[10px] font-semibold leading-none"
                style="color: {et.textColor}; max-width: {w - 20}px;"
              >{el.name || et.shortLabel}</span>
            {/if}
            <!-- Resize handle (right edge) — only for regions -->
            {#if isRegion}
              <div
                class="absolute right-0 top-0 h-full w-2.5 cursor-ew-resize opacity-60 hover:opacity-100"
                style="background: linear-gradient(to left, {et.color}, transparent);"
                role="separator"
                onpointerdown={(e) => resizeDown(e, el)}
              ></div>
            {/if}
          </div>
        {/each}

        <!-- Ghost element during create -->
        {#if ghost && ghost.type === et.type}
          <div
            class="pointer-events-none absolute top-1.5 bottom-1.5 rounded opacity-60"
            style="left: {ghost.left}px; width: {ghost.w}px; background: {et.color}; border: 2px dashed {et.color};"
          ></div>
        {/if}
      </div>
    {/each}

    <!-- Playhead -->
    {#if duration > 0}
      <div
        class="pointer-events-none absolute top-0 bottom-0 w-px bg-white/80"
        style="left: {t01(currentTime) * contentW}px;"
      ></div>
    {/if}
  </div>
</div>
