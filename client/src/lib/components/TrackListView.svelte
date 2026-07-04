<script lang="ts">
  import { goto } from '$app/navigation';
  import type { Track } from '$lib/types';
  import { currentVersion } from '$lib/types';
  import { fmtDuration } from '$lib/format';
  import { reorder } from '$lib/dnd';
  import { api } from '$lib/api';
  import { ui } from '$lib/stores/ui.svelte';
  import StatusPill from './StatusPill.svelte';

  let {
    tracks = [],
    projectId,
    canEdit = false,
    onReorder,
    onDelete,
  }: {
    tracks: Track[];
    projectId: string;
    canEdit?: boolean;
    onReorder?: (order: string[]) => void;
    onDelete?: (t: Track) => void;
  } = $props();

  // --- Inline editing ---
  let editingId = $state<string | null>(null);
  let editField = $state<'name' | 'id_number' | 'notes' | null>(null);
  let editValue = $state('');

  function startEdit(t: Track, field: 'name' | 'id_number' | 'notes', e: Event) {
    e.stopPropagation();
    editingId = t.id;
    editField = field;
    editValue = field === 'name' ? t.name : (t[field] ?? '');
  }

  async function commitEdit(t: Track) {
    if (!editField) return;
    const trimmed = editValue.trim();
    const payload: Record<string, string | null> = {};
    if (editField === 'name') payload.name = trimmed || t.name;
    else payload[editField] = trimmed || null;
    editingId = null;
    editField = null;
    try {
      await api.patch(`/projects/${projectId}/tracks/${t.id}`, payload);
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  function onInputKeydown(e: KeyboardEvent, t: Track) {
    if (e.key === 'Enter') (e.currentTarget as HTMLElement).blur();
    if (e.key === 'Escape') { editingId = null; editField = null; }
  }

  // --- Drag to reorder ---
  let dragFrom = $state<number | null>(null);
  let dragOver = $state<number | null>(null);
  let reordering = $state(false);

  function onDragStart(e: DragEvent, i: number) {
    dragFrom = i;
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', String(i));
  }

  function onDragOverRow(e: DragEvent, i: number) {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    dragOver = i;
  }

  async function onDrop(e: DragEvent, to: number) {
    e.preventDefault();
    const from = dragFrom;
    dragFrom = null;
    dragOver = null;
    if (from === null || from === to) return;
    const reordered = reorder(tracks, from, to);
    const order = reordered.map((t) => t.id);
    reordering = true;
    try {
      await api.post(`/projects/${projectId}/tracks/reorder`, { order });
      onReorder?.(order);
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    } finally {
      reordering = false;
    }
  }

  function onDragEnd() {
    dragFrom = null;
    dragOver = null;
  }

  function navigateTo(t: Track, e: Event) {
    // Don't navigate if clicking inside an inline edit
    if (editingId === t.id) return;
    goto(`/projects/${projectId}/track/${t.id}`);
  }
</script>

<div class="mt-4 overflow-hidden rounded-xl border border-neutral-800">
  <!-- Header row -->
  <div class="grid items-center border-b border-neutral-800 bg-neutral-950 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500"
    style="grid-template-columns: 1.5rem 5rem 1fr 5.5rem 4rem 3rem 4rem 1fr {canEdit ? '4rem' : ''}">
    <span></span><!-- drag handle col -->
    <span>ID</span>
    <span>Name</span>
    <span>Status</span>
    <span>Duration</span>
    <span>Ver.</span>
    <span>BPM</span>
    <span>Notes</span>
    {#if canEdit}<span></span>{/if}
  </div>

  {#each tracks as t, i (t.id)}
    {@const cv = currentVersion(t)}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      role="row"
      class="group grid cursor-pointer items-center border-b border-neutral-900 px-3 py-2 text-sm last:border-0
        {dragOver === i && dragFrom !== null && dragFrom !== i ? 'bg-indigo-950/30' : 'hover:bg-neutral-900/60'}
        {dragFrom === i ? 'opacity-40' : ''}"
      style="grid-template-columns: 1.5rem 5rem 1fr 5.5rem 4rem 3rem 4rem 1fr {canEdit ? '4rem' : ''}"
      onclick={(e) => navigateTo(t, e)}
    >
      <!-- Drag handle -->
      {#if canEdit}
        <div
          draggable={true}
          class="flex cursor-grab items-center justify-center text-neutral-600 hover:text-neutral-400 active:cursor-grabbing"
          ondragstart={(e) => onDragStart(e, i)}
          ondragover={(e) => onDragOverRow(e, i)}
          ondrop={(e) => onDrop(e, i)}
          ondragend={onDragEnd}
          onclick={(e) => e.stopPropagation()}
          role="button"
          tabindex="-1"
          aria-label="Drag to reorder"
        >≡</div>
      {:else}
        <span></span>
      {/if}

      <!-- ID number -->
      {#if canEdit && editingId === t.id && editField === 'id_number'}
        <input
          class="w-full rounded border border-indigo-500 bg-neutral-900 px-1.5 py-0.5 text-xs text-white outline-none"
          bind:value={editValue}
          onblur={() => commitEdit(t)}
          onkeydown={(e) => onInputKeydown(e, t)}
          onclick={(e) => e.stopPropagation()}
          autofocus
          maxlength="64"
        />
      {:else}
        <span
          class="truncate text-xs text-neutral-500 {canEdit ? 'cursor-text rounded px-1 hover:bg-neutral-800' : ''}"
          onclick={canEdit ? (e) => startEdit(t, 'id_number', e) : undefined}
          role={canEdit ? 'button' : undefined}
          tabindex={canEdit ? 0 : undefined}
          onkeydown={canEdit ? (e) => e.key === 'Enter' && startEdit(t, 'id_number', e) : undefined}
        >{t.id_number || (canEdit ? '+ ID' : '—')}</span>
      {/if}

      <!-- Name -->
      {#if canEdit && editingId === t.id && editField === 'name'}
        <input
          class="w-full rounded border border-indigo-500 bg-neutral-900 px-1.5 py-0.5 text-sm text-white outline-none"
          bind:value={editValue}
          onblur={() => commitEdit(t)}
          onkeydown={(e) => onInputKeydown(e, t)}
          onclick={(e) => e.stopPropagation()}
          autofocus
          maxlength="255"
        />
      {:else}
        <span
          class="truncate font-medium text-white {canEdit ? 'cursor-text rounded px-1 hover:bg-neutral-800' : ''}"
          onclick={canEdit ? (e) => startEdit(t, 'name', e) : undefined}
          role={canEdit ? 'button' : undefined}
          tabindex={canEdit ? 0 : undefined}
          onkeydown={canEdit ? (e) => e.key === 'Enter' && startEdit(t, 'name', e) : undefined}
        >{t.name}</span>
      {/if}

      <!-- Status -->
      <div class="flex items-center">
        {#if cv}<StatusPill status={cv.status} />{:else}<span class="text-xs text-neutral-600">—</span>{/if}
      </div>

      <!-- Duration -->
      <span class="text-xs text-neutral-400">{fmtDuration(cv?.media_duration ?? 0)}</span>

      <!-- Versions -->
      <span class="text-xs text-neutral-500">{t.versions.length}</span>

      <!-- BPM -->
      <span class="text-xs text-neutral-500">{cv?.bpm ? cv.bpm.toFixed(1) : '—'}</span>

      <!-- Notes -->
      {#if canEdit && editingId === t.id && editField === 'notes'}
        <input
          class="w-full rounded border border-indigo-500 bg-neutral-900 px-1.5 py-0.5 text-xs text-neutral-300 outline-none"
          bind:value={editValue}
          onblur={() => commitEdit(t)}
          onkeydown={(e) => onInputKeydown(e, t)}
          onclick={(e) => e.stopPropagation()}
          autofocus
          maxlength="10000"
        />
      {:else}
        <span
          class="truncate text-xs text-neutral-500 {canEdit ? 'cursor-text rounded px-1 hover:bg-neutral-800' : ''}"
          onclick={canEdit ? (e) => startEdit(t, 'notes', e) : undefined}
          role={canEdit ? 'button' : undefined}
          tabindex={canEdit ? 0 : undefined}
          onkeydown={canEdit ? (e) => e.key === 'Enter' && startEdit(t, 'notes', e) : undefined}
        >{t.notes || (canEdit ? '+ notes' : '—')}</span>
      {/if}

      <!-- Delete -->
      {#if canEdit}
        <button
          class="text-xs text-neutral-600 opacity-0 transition group-hover:opacity-100 hover:text-red-400"
          onclick={(e) => { e.stopPropagation(); onDelete?.(t); }}
        >Delete</button>
      {/if}
    </div>
    <!-- Drop zone overlay for inter-row drops -->
    {#if canEdit}
      <div
        class="h-0 overflow-hidden {dragFrom !== null && dragOver === i ? '' : ''}"
        ondragover={(e) => onDragOverRow(e, i)}
        ondrop={(e) => onDrop(e, i)}
      ></div>
    {/if}
  {/each}
</div>
