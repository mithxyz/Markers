<script lang="ts">
  import type { Cue } from '$lib/types';
  import type { Department } from '$lib/api';
  import { effectiveCueColor, STATUS_DOT, STATUS_LABEL } from '$lib/cues';
  import { formatTime, formatSmpte } from '$lib/utils/timecode';

  let {
    cues = [],
    selectedCueId = null,
    departments = [],
    fps = 30,
    smpte = false,
    editable = () => false,
    deletable = () => false,
    onSelect,
    onEdit,
    onDelete,
  }: {
    cues: Cue[];
    selectedCueId?: string | null;
    departments?: Department[];
    fps?: number;
    smpte?: boolean;
    editable?: (cue: Cue) => boolean;
    deletable?: (cue: Cue) => boolean;
    onSelect?: (cue: Cue) => void;
    onEdit?: (cue: Cue) => void;
    onDelete?: (cue: Cue) => void;
  } = $props();

  // Glyph hints at sharing state: lock = private, eye = public read-only.
  const visGlyph = (c: Cue) => (c.visibility === 'private' ? '🔒' : c.visibility === 'public_ro' ? '👁' : '');

  // lane_id -> its department (for grouping + colour).
  const laneToDept = $derived.by(() => {
    const m = new Map<string, Department>();
    for (const d of departments) for (const l of d.lanes) m.set(l.id, d);
    return m;
  });

  // Group only when there's real structure (more than one department); otherwise
  // a flat time-sorted list keeps simple projects uncluttered.
  const grouped = $derived(departments.length > 1);

  const sorted = $derived([...cues].sort((a, b) => a.time - b.time));

  // Cues bucketed by department, departments in their own sort order, cues by time.
  const groups = $derived.by(() => {
    if (!grouped) return [];
    const byDept = new Map<string, { dept: Department; cues: Cue[] }>();
    for (const d of departments) byDept.set(d.id, { dept: d, cues: [] });
    const orphan: Cue[] = [];
    for (const c of sorted) {
      const d = laneToDept.get(c.lane_id);
      if (d && byDept.has(d.id)) byDept.get(d.id)!.cues.push(c);
      else orphan.push(c);
    }
    const out = [...byDept.values()].filter((g) => g.cues.length);
    if (orphan.length) {
      const dept: Department = { id: '_', project_id: '', name: 'Unassigned', color: '#52525b', sort_order: 999, default_osc_address: null, default_osc_value: null, lanes: [] };
      out.push({ dept, cues: orphan });
    }
    return out;
  });
</script>

{#snippet cueRow(cue: Cue)}
  <li>
    <div
      role="button"
      tabindex="0"
      onclick={() => onSelect?.(cue)}
      onkeydown={(e) => e.key === 'Enter' && onSelect?.(cue)}
      class="group flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition
        {selectedCueId === cue.id ? 'border-indigo-500/60 bg-indigo-500/10' : 'border-transparent hover:bg-neutral-800/60'}"
    >
      <span class="h-3 w-3 shrink-0 rounded-full" style="background: {effectiveCueColor(cue, departments)}"></span>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm text-neutral-100">
          {#if cue.status !== 'not_started'}<span class="mr-1 inline-block h-2 w-2 rounded-full align-middle" style="background: {STATUS_DOT[cue.status]}" title={STATUS_LABEL[cue.status]}></span>{/if}
          {cue.name}
          {#if visGlyph(cue)}<span class="ml-1 text-[10px]" title={cue.visibility}>{visGlyph(cue)}</span>{/if}
        </p>
        <p class="text-[11px] text-neutral-500">{smpte ? formatSmpte(cue.time, fps) : formatTime(cue.time)}{cue.fade ? ` · fade ${cue.fade}s` : ''}</p>
      </div>
      {#if editable(cue) || deletable(cue)}
        <div class="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
          {#if editable(cue)}
            <button onclick={(e) => { e.stopPropagation(); onEdit?.(cue); }} class="rounded px-1 text-xs text-neutral-400 hover:text-white">Edit</button>
          {/if}
          {#if deletable(cue)}
            <button onclick={(e) => { e.stopPropagation(); onDelete?.(cue); }} class="rounded px-1 text-xs text-neutral-500 hover:text-red-400">✕</button>
          {/if}
        </div>
      {/if}
    </div>
  </li>
{/snippet}

<div class="flex h-full flex-col">
  <div class="flex items-center justify-between px-1 pb-2">
    <h3 class="text-xs font-semibold uppercase tracking-wide text-neutral-500">Cues</h3>
    <span class="text-xs text-neutral-600">{cues.length}</span>
  </div>
  {#if sorted.length === 0}
    <p class="px-1 text-sm text-neutral-600">No cues yet.</p>
  {:else if grouped}
    <div class="flex flex-col gap-3 overflow-y-auto">
      {#each groups as g (g.dept.id)}
        <div>
          <div class="mb-1 flex items-center gap-1.5 px-1">
            <span class="h-2.5 w-2.5 rounded-full" style="background: {g.dept.color}"></span>
            <span class="text-[11px] font-medium uppercase tracking-wide text-neutral-400">{g.dept.name}</span>
            <span class="text-[10px] text-neutral-600">{g.cues.length}</span>
          </div>
          <ul class="flex flex-col gap-1">
            {#each g.cues as cue (cue.id)}{@render cueRow(cue)}{/each}
          </ul>
        </div>
      {/each}
    </div>
  {:else}
    <ul class="flex flex-col gap-1 overflow-y-auto">
      {#each sorted as cue (cue.id)}{@render cueRow(cue)}{/each}
    </ul>
  {/if}
</div>
