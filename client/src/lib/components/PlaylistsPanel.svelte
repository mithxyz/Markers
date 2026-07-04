<script lang="ts">
  import { api } from '$lib/api';
  import type { Track, Playlist } from '$lib/types';
  import { currentVersion } from '$lib/types';
  import { ui } from '$lib/stores/ui.svelte';
  import { fmtDuration } from '$lib/format';
  import { reorder } from '$lib/dnd';
  import StatusPill from './StatusPill.svelte';

  let {
    projectId,
    playlists = [],
    tracks = [],
    canEdit = false,
    onRefresh,
  }: {
    projectId: string;
    playlists: Playlist[];
    tracks: Track[];
    canEdit?: boolean;
    onRefresh?: () => void;
  } = $props();

  let selectedId = $state<string | null>(null);
  const selected = $derived(playlists.find((p) => p.id === selectedId) ?? null);

  // Track lookup map
  const trackMap = $derived(new Map(tracks.map((t) => [t.id, t])));

  // Ordered track objects for the selected playlist
  const playlistTracks = $derived(
    selected
      ? selected.tracks
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((pt) => ({ pt, track: trackMap.get(pt.track_id) }))
          .filter((x): x is { pt: (typeof selected.tracks)[0]; track: Track } => !!x.track)
      : []
  );

  // Create a new playlist
  let newName = $state('');
  let creating = $state(false);

  async function createPlaylist() {
    const name = newName.trim() || 'Setlist';
    creating = true;
    try {
      const { playlist } = await api.post<{ playlist: Playlist }>(`/projects/${projectId}/playlists`, { name });
      newName = '';
      selectedId = playlist.id;
      onRefresh?.();
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    } finally {
      creating = false;
    }
  }

  // Rename a playlist (inline)
  let renamingId = $state<string | null>(null);
  let renameVal = $state('');

  function startRename(pl: Playlist, e: Event) {
    e.stopPropagation();
    renamingId = pl.id;
    renameVal = pl.name;
  }

  async function commitRename(pl: Playlist) {
    renamingId = null;
    const name = renameVal.trim() || pl.name;
    if (name === pl.name) return;
    try {
      await api.patch(`/projects/${projectId}/playlists/${pl.id}`, { name });
      onRefresh?.();
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  async function deletePlaylist(pl: Playlist, e: Event) {
    e.stopPropagation();
    if (!confirm(`Delete setlist "${pl.name}"?`)) return;
    try {
      await api.del(`/projects/${projectId}/playlists/${pl.id}`);
      if (selectedId === pl.id) selectedId = null;
      onRefresh?.();
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  // Add a track to the selected playlist
  let addTrackId = $state('');

  async function addTrack() {
    if (!selected || !addTrackId) return;
    try {
      await api.post(`/projects/${projectId}/playlists/${selected.id}/tracks`, { track_id: addTrackId });
      addTrackId = '';
      onRefresh?.();
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  // Remove a track from the selected playlist
  async function removeTrack(trackId: string) {
    if (!selected) return;
    try {
      await api.del(`/projects/${projectId}/playlists/${selected.id}/tracks/${trackId}`);
      onRefresh?.();
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  // Drag-to-reorder within playlist
  let dragFrom = $state<number | null>(null);
  let dragOver = $state<number | null>(null);

  function onDragStart(e: DragEvent, i: number) {
    dragFrom = i;
    e.dataTransfer!.effectAllowed = 'move';
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
    if (!selected || from === null || from === to) return;
    const reordered = reorder(playlistTracks, from, to);
    const order = reordered.map((x) => x.track.id);
    try {
      await api.post(`/projects/${projectId}/playlists/${selected.id}/reorder`, { order });
      onRefresh?.();
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  function onDragEnd() { dragFrom = null; dragOver = null; }

  // Tracks not already in the selected playlist
  const availableTracks = $derived(
    selected
      ? tracks.filter((t) => !selected.tracks.some((pt) => pt.track_id === t.id))
      : tracks
  );
</script>

<section class="mt-8">
  <h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">Setlists</h2>

  <div class="flex gap-4">
    <!-- Left: playlist list + create -->
    <div class="w-48 shrink-0">
      {#each playlists as pl (pl.id)}
        <button
          class="group flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition
            {selectedId === pl.id ? 'bg-indigo-900/40 text-white' : 'text-neutral-300 hover:bg-neutral-800'}"
          onclick={() => (selectedId = pl.id)}
        >
          {#if renamingId === pl.id}
            <input
              class="w-full rounded bg-neutral-900 px-1.5 text-sm text-white outline-none"
              bind:value={renameVal}
              onblur={() => commitRename(pl)}
              onkeydown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLElement).blur(); if (e.key === 'Escape') renamingId = null; }}
              onclick={(e) => e.stopPropagation()}
              autofocus
            />
          {:else}
            <span class="min-w-0 truncate">{pl.name}</span>
          {/if}
          {#if canEdit}
            <div class="ml-1 flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
              <button onclick={(e) => startRename(pl, e)} class="text-neutral-500 hover:text-white" title="Rename">✏</button>
              <button onclick={(e) => deletePlaylist(pl, e)} class="text-neutral-600 hover:text-red-400" title="Delete">✕</button>
            </div>
          {/if}
        </button>
      {/each}

      {#if canEdit}
        <div class="mt-2 flex gap-1">
          <input
            bind:value={newName}
            placeholder="New setlist…"
            onkeydown={(e) => e.key === 'Enter' && createPlaylist()}
            class="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-white outline-none focus:border-indigo-500"
          />
          <button
            onclick={createPlaylist}
            disabled={creating}
            class="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >+</button>
        </div>
      {/if}
    </div>

    <!-- Right: selected playlist tracks -->
    {#if selected}
      <div class="flex-1 min-w-0">
        <div class="overflow-hidden rounded-xl border border-neutral-800">
          {#if playlistTracks.length === 0}
            <p class="px-4 py-6 text-center text-sm text-neutral-600">No tracks yet. Add one below.</p>
          {:else}
            {#each playlistTracks as { pt, track }, i (pt.id)}
              {@const cv = currentVersion(track)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                role="row"
                class="flex items-center gap-3 border-b border-neutral-900 px-3 py-2 last:border-0
                  {dragOver === i && dragFrom !== null && dragFrom !== i ? 'bg-indigo-950/30' : 'hover:bg-neutral-900/40'}
                  {dragFrom === i ? 'opacity-40' : ''}"
                ondragover={(e) => onDragOverRow(e, i)}
                ondrop={(e) => onDrop(e, i)}
              >
                {#if canEdit}
                  <div
                    draggable={true}
                    class="cursor-grab text-neutral-600 hover:text-neutral-400"
                    ondragstart={(e) => onDragStart(e, i)}
                    ondragend={onDragEnd}
                    role="button"
                    tabindex="-1"
                    aria-label="Drag to reorder"
                  >≡</div>
                {/if}

                <span class="w-6 shrink-0 text-center text-xs text-neutral-600">{i + 1}</span>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm text-white">{track.name}</p>
                  <p class="text-[11px] text-neutral-600">{fmtDuration(cv?.media_duration ?? 0)}{cv?.bpm ? ` · ${cv.bpm.toFixed(0)} BPM` : ''}</p>
                </div>
                {#if cv}<StatusPill status={cv.status} />{/if}

                {#if canEdit}
                  <button
                    class="ml-2 text-xs text-neutral-600 hover:text-red-400"
                    onclick={() => removeTrack(track.id)}
                  >Remove</button>
                {/if}
              </div>
            {/each}
          {/if}
        </div>

        {#if canEdit && availableTracks.length > 0}
          <div class="mt-2 flex items-center gap-2">
            <select
              bind:value={addTrackId}
              class="flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200 outline-none focus:border-indigo-500"
            >
              <option value="">Add a track…</option>
              {#each availableTracks as t (t.id)}
                <option value={t.id}>{t.name}{t.id_number ? ` [${t.id_number}]` : ''}</option>
              {/each}
            </select>
            <button
              onclick={addTrack}
              disabled={!addTrackId}
              class="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >Add</button>
          </div>
        {/if}
      </div>
    {:else if playlists.length > 0}
      <p class="pt-2 text-sm text-neutral-600">Select a setlist to view its tracks.</p>
    {:else}
      <p class="pt-2 text-sm text-neutral-600">{canEdit ? 'Create a setlist to organise your tracks.' : 'No setlists yet.'}</p>
    {/if}
  </div>
</section>
