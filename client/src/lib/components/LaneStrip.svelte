<script lang="ts">
  import type { Cue, Formation, FormationPlacement } from '$lib/types';
  import type { Department } from '$lib/api';
  import { effectiveCueColor } from '$lib/cues';

  let {
    cues = [],
    departments = [],
    placements = [],       // Phase 8c: formation placements for this track
    formationDefs = [],    // Phase 8c: formation definitions for name lookup
    duration = 0,
    editable = false,
    sync = null,
    currentTime = 0,
    onSelect,
    onMove,
    onReassign,
    onResize,
    onSelectPlacement,
  }: {
    cues: Cue[];
    departments: Department[];
    placements?: FormationPlacement[];
    formationDefs?: Formation[];
    duration?: number;
    editable?: boolean;
    sync?: { scrollLeft: number; scrollWidth: number; clientWidth: number } | null;
    currentTime?: number;
    onSelect?: (cue: Cue) => void;
    onMove?: (cue: Cue, time: number) => void;
    onReassign?: (cue: Cue, laneId: string) => void;
    onResize?: (cue: Cue, endTime: number) => void;
    onSelectPlacement?: (p: FormationPlacement) => void;
  } = $props();

  const showFormations = $derived(placements.length > 0);
  const defById = $derived(new Map(formationDefs.map((f) => [f.id, f])));

  const laneToDept = $derived.by(() => {
    const m = new Map<string, string>();
    for (const d of departments) for (const l of d.lanes) m.set(l.id, d.id);
    return m;
  });
  const groups = $derived(
    departments
      .map((d) => ({ dept: d, cues: cues.filter((c) => laneToDept.get(c.lane_id) === d.id) }))
      .filter((g) => g.cues.length || departments.length <= 10)
  );

  let viewportEl: HTMLDivElement;
  let innerEl: HTMLDivElement;
  let viewportW = $state(0);
  // Match the waveform's pixel scale when synced; otherwise fit-to-viewport.
  const contentW = $derived(sync && sync.scrollWidth > 0 ? sync.scrollWidth : Math.max(1, viewportW));
  const t01 = (t: number) => (duration > 0 ? Math.min(1, Math.max(0, t / duration)) : 0);

  // Keep our scroll offset locked to the waveform (5c). overflow is hidden so the
  // user scrolls via the waveform, which drives this.
  $effect(() => {
    if (viewportEl && sync) viewportEl.scrollLeft = sync.scrollLeft;
  });

  let drag = $state<{ cue: Cue; mode: 'move' | 'resize'; time: number; endTime: number | null; deptId: string } | null>(null);

  // clientX → time via the inner element's on-screen rect (accounts for scroll).
  const timeAt = (clientX: number) => {
    const r = innerEl?.getBoundingClientRect();
    if (!r || r.width <= 0) return 0;
    return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration));
  };
  function rowAt(clientY: number): { deptId: string; laneId: string } | null {
    for (const el of [...(innerEl?.querySelectorAll('.lane-row') ?? [])] as HTMLElement[]) {
      const r = el.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return { deptId: el.dataset.deptid!, laneId: el.dataset.laneid! };
    }
    return null;
  }

  function startDrag(e: PointerEvent, cue: Cue, mode: 'move' | 'resize') {
    if (!editable) return;
    e.preventDefault();
    e.stopPropagation();
    drag = { cue, mode, time: cue.time, endTime: cue.end_time, deptId: laneToDept.get(cue.lane_id) ?? '' };
    window.addEventListener('pointermove', onMoveEvt);
    window.addEventListener('pointerup', onUp);
  }
  function onMoveEvt(e: PointerEvent) {
    if (!drag) return;
    if (drag.mode === 'resize') {
      drag.endTime = Math.max(drag.time + 0.05, timeAt(e.clientX));
    } else {
      const dt = timeAt(e.clientX);
      const span = drag.cue.end_time != null ? drag.cue.end_time - drag.cue.time : 0;
      drag.time = dt;
      drag.endTime = drag.cue.end_time != null ? dt + span : null;
      const row = rowAt(e.clientY);
      if (row) drag.deptId = row.deptId;
    }
  }
  function onUp(e: PointerEvent) {
    window.removeEventListener('pointermove', onMoveEvt);
    window.removeEventListener('pointerup', onUp);
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.mode === 'resize') {
      if (d.endTime != null && Math.abs(d.endTime - (d.cue.end_time ?? d.cue.time)) > 0.02) onResize?.(d.cue, d.endTime);
      return;
    }
    const targetRow = rowAt(e.clientY);
    const origDept = laneToDept.get(d.cue.lane_id);
    const moved = Math.abs(d.time - d.cue.time) > 0.02;
    const reassigned = targetRow && targetRow.deptId !== origDept;
    if (reassigned) onReassign?.(d.cue, targetRow!.laneId);
    if (moved) onMove?.(d.cue, d.time);
    if (!moved && !reassigned) onSelect?.(d.cue); // treat as a click
  }

  function geomOf(cue: Cue) {
    if (drag && drag.cue.id === cue.id) return { time: drag.time, endTime: drag.endTime, deptId: drag.deptId };
    return { time: cue.time, endTime: cue.end_time, deptId: laneToDept.get(cue.lane_id) ?? '' };
  }
</script>

<div class="flex overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
  <!-- frozen labels column -->
  <div class="w-28 shrink-0 border-r border-neutral-900">
    {#if showFormations}
      <div class="flex h-8 items-center gap-1.5 border-b border-neutral-900 px-2">
        <span class="h-2 w-2 shrink-0 rounded-full bg-violet-500"></span>
        <span class="truncate text-[11px] text-neutral-400">Formations</span>
      </div>
    {/if}
    {#each groups as g (g.dept.id)}
      <div class="flex h-8 items-center gap-1.5 border-b border-neutral-900 px-2 last:border-0">
        <span class="h-2 w-2 shrink-0 rounded-full" style="background: {g.dept.color}"></span>
        <span class="truncate text-[11px] text-neutral-400">{g.dept.name}</span>
      </div>
    {/each}
    {#if groups.length === 0 && !showFormations}<div class="px-2 py-2 text-[11px] text-neutral-600">—</div>{/if}
  </div>

  <!-- scroll-synced content -->
  <div bind:this={viewportEl} bind:clientWidth={viewportW} class="relative flex-1 overflow-x-hidden">
    <div bind:this={innerEl} class="relative" style="width: {contentW}px;">
      <!-- Phase 8c: formations row — one bar per placement, labelled with the def name -->
      {#if showFormations}
        <div class="relative h-8 border-b border-neutral-900">
          {#each placements as p (p.id)}
            {@const left = t01(p.time) * contentW}
            {@const w = p.end_time != null && p.end_time > p.time ? Math.max(3, (t01(p.end_time) - t01(p.time)) * contentW) : 4}
            {@const defName = defById.get(p.formation_id)?.name ?? ''}
            <button
              class="absolute top-1.5 bottom-1.5 cursor-pointer overflow-hidden rounded-sm border border-violet-700/60 bg-violet-600/30 px-1 text-left text-[10px] text-violet-200 hover:bg-violet-600/50 hover:ring-1 hover:ring-violet-400/60"
              style="left: {left}px; width: {w}px; min-width: 4px;"
              title="{defName} · {p.time.toFixed(2)}s{p.end_time != null ? ` – ${p.end_time.toFixed(2)}s` : ''}"
              onclick={() => onSelectPlacement?.(p)}
            >
              {#if w > 20}<span class="truncate">{defName}</span>{/if}
            </button>
          {/each}
        </div>
      {/if}

      {#each groups as g (g.dept.id)}
        <div class="lane-row relative h-8 border-b border-neutral-900 last:border-0" data-deptid={g.dept.id} data-laneid={g.dept.lanes[0]?.id ?? ''}>
          {#each cues as c (c.id)}
            {@const gm = geomOf(c)}
            {#if gm.deptId === g.dept.id}
              {@const left = t01(gm.time) * contentW}
              {@const w = gm.endTime != null && gm.endTime > gm.time ? Math.max(3, (t01(gm.endTime) - t01(gm.time)) * contentW) : 4}
              <div
                class="absolute top-1.5 bottom-1.5 rounded-sm border border-black/30 {editable ? 'cursor-grab' : 'cursor-pointer'} {drag?.cue.id === c.id ? 'ring-1 ring-white' : 'hover:ring-1 hover:ring-white/60'}"
                style="left: {left}px; width: {w}px; background: {effectiveCueColor(c, departments)};"
                role="button"
                tabindex="-1"
                title={c.name}
                onpointerdown={(e) => (editable ? startDrag(e, c, 'move') : onSelect?.(c))}
              >
                {#if editable && c.end_time != null}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <span class="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize bg-white/30" onpointerdown={(e) => startDrag(e, c, 'resize')}></span>
                {/if}
              </div>
            {/if}
          {/each}
        </div>
      {/each}
      {#if duration > 0}
        <div class="pointer-events-none absolute top-0 bottom-0 w-px bg-white/70" style="left: {t01(currentTime) * contentW}px;"></div>
      {/if}
    </div>
  </div>
</div>
{#if editable}
  <p class="mt-1 text-[11px] text-neutral-600">Drag blocks along time or into another department; drag a range cue's right edge to resize.</p>
{/if}
