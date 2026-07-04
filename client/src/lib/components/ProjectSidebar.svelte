<script lang="ts">
  import { getContext } from 'svelte';
  import { ProjectStore, PROJECT_CTX } from '$lib/stores/project.svelte';
  import { currentVersion } from '$lib/types';
  import PresenceBar from '$lib/components/PresenceBar.svelte';

  let { activeTrackId }: { activeTrackId: string } = $props();
  const store = getContext<ProjectStore>(PROJECT_CTX);

  const statusColor = (s?: string) =>
    s === 'ready' ? '#22c55e' : s === 'failed' ? '#ef4444' : s ? '#eab308' : '#52525b';
</script>

<aside class="flex w-60 shrink-0 flex-col gap-3 border-r border-neutral-800 bg-neutral-950 p-3">
  <a href="/projects" class="text-xs text-neutral-500 hover:text-white">← All projects</a>
  <a href="/projects/{store.id}" class="truncate text-sm font-semibold text-white hover:text-indigo-300" title="Project overview">{store.project?.name}</a>
  <PresenceBar online={store.online} />

  <div class="mt-1 flex items-center justify-between px-1">
    <span class="text-[10px] font-semibold uppercase tracking-wide text-neutral-600">Tracks</span>
    <span class="text-[10px] text-neutral-700">{store.tracks.length}</span>
  </div>
  <nav class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
    {#each store.tracks as t (t.id)}
      {@const cv = currentVersion(t)}
      <a
        href="/projects/{store.id}/track/{t.id}"
        class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm {activeTrackId === t.id ? 'bg-indigo-500/15 text-white' : 'text-neutral-300 hover:bg-neutral-900'}"
      >
        <span class="h-2 w-2 shrink-0 rounded-full" style="background: {statusColor(cv?.status)}" title={cv?.status ?? 'no media'}></span>
        <span class="truncate">{t.name}</span>
      </a>
    {/each}
    {#if store.tracks.length === 0}
      <p class="px-2 py-1 text-xs text-neutral-600">No tracks yet.</p>
    {/if}
  </nav>

  <a href="/projects/{store.id}/settings" class="mt-auto rounded-lg border border-neutral-800 px-2 py-1.5 text-center text-xs text-neutral-300 hover:border-indigo-500 hover:text-white">Project settings</a>
  <a href="/help" class="text-center text-[11px] text-neutral-600 hover:text-neutral-400">Help & feature guide</a>
</aside>
