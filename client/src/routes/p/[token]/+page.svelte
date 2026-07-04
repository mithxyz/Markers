<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api } from '$lib/api';
  import { formatTime } from '$lib/utils/timecode';

  interface PublicCue {
    id: string;
    cue_number: number | null;
    name: string;
    time: number;
    fade: number;
    marker_color: string;
    description: string;
  }
  interface PublicTrack {
    id: string;
    name: string;
    kind: string;
    duration: number;
    cues: PublicCue[];
  }

  let projectName = $state('');
  let tracks = $state<PublicTrack[]>([]);
  let error = $state('');
  let loading = $state(true);
  const token = $page.params.token;

  onMount(async () => {
    try {
      const data = await api.get<{ project: { name: string }; tracks: PublicTrack[] }>(`/public/${token}`);
      projectName = data.project.name;
      tracks = data.tracks;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  });
</script>

<main class="mx-auto min-h-screen w-full max-w-3xl px-6 py-10">
  {#if loading}
    <p class="text-sm text-neutral-500">Loading…</p>
  {:else if error}
    <div class="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6 text-center">
      <p class="text-sm text-red-400">{error}</p>
      <p class="mt-2 text-xs text-neutral-600">This public link may have been disabled.</p>
    </div>
  {:else}
    <header class="border-b border-neutral-800 pb-4">
      <p class="text-xs uppercase tracking-wide text-neutral-500">Shared cue sheet</p>
      <h1 class="mt-1 text-2xl font-semibold text-white">{projectName}</h1>
      <p class="mt-1 text-xs text-neutral-600">Read-only · cue.mith.studio</p>
    </header>

    {#if tracks.length === 0}
      <p class="mt-8 text-sm text-neutral-500">No public markers to show.</p>
    {:else}
      <div class="mt-6 flex flex-col gap-6">
        {#each tracks as t (t.id)}
          <section>
            <h2 class="text-sm font-medium text-white">{t.name} <span class="text-[10px] uppercase text-neutral-500">{t.kind}</span></h2>
            {#if t.cues.length === 0}
              <p class="mt-2 text-xs text-neutral-600">No public markers on this track.</p>
            {:else}
              <ul class="mt-2 divide-y divide-neutral-800 rounded-xl border border-neutral-800">
                {#each t.cues as c (c.id)}
                  <li class="flex items-center gap-3 px-4 py-2.5">
                    <span class="h-3 w-3 shrink-0 rounded-full" style="background: {c.marker_color}"></span>
                    <span class="font-mono text-xs tabular-nums text-indigo-300">{formatTime(c.time)}</span>
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-sm text-neutral-100">{c.cue_number != null ? `${c.cue_number}. ` : ''}{c.name}</p>
                      {#if c.description}<p class="truncate text-[11px] text-neutral-500">{c.description}</p>{/if}
                    </div>
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        {/each}
      </div>
    {/if}
  {/if}
</main>
