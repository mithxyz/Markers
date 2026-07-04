<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api, type Team } from '$lib/api';
  import { auth } from '$lib/stores/auth.svelte';
  import { ui } from '$lib/stores/ui.svelte';

  let teams = $state<Team[]>([]);
  let loading = $state(true);
  let newName = $state('');
  let creating = $state(false);

  onMount(async () => {
    if (!auth.user) { goto('/login', { replaceState: true }); return; }
    await refresh();
  });
  async function refresh() {
    loading = true;
    try { teams = (await api.get<{ teams: Team[] }>('/teams')).teams; }
    catch (e) { ui.toast((e as Error).message, 'error'); }
    finally { loading = false; }
  }
  async function create(e: Event) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    creating = true;
    try {
      const { team } = await api.post<{ team: Team }>('/teams', { name });
      newName = '';
      goto(`/teams/${team.id}`);
    } catch (e) { ui.toast((e as Error).message, 'error'); }
    finally { creating = false; }
  }
</script>

<div class="mx-auto max-w-4xl px-6 py-10">
  <header class="flex items-center justify-between">
    <div class="flex items-center gap-3">
      <a href="/projects" class="text-sm text-neutral-500 hover:text-white">← Projects</a>
      <h1 class="text-2xl font-semibold tracking-tight text-white">Teams</h1>
    </div>
  </header>
  <p class="mt-1 text-sm text-neutral-500">A team owns projects and shares them with its members.</p>

  <form onsubmit={create} class="mt-6 flex items-end gap-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
    <div class="flex flex-1 flex-col gap-1">
      <label class="text-xs text-neutral-400" for="tname">New team</label>
      <input id="tname" bind:value={newName} placeholder="Team name" class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500" />
    </div>
    <button type="submit" disabled={creating} class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">Create team</button>
  </form>

  {#if loading}
    <p class="mt-8 text-sm text-neutral-500">Loading…</p>
  {:else if teams.length === 0}
    <p class="mt-8 text-sm text-neutral-500">No teams yet. Create one to group projects and share them.</p>
  {:else}
    <div class="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each teams as t (t.id)}
        <button onclick={() => goto(`/teams/${t.id}`)} class="flex flex-col rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-left transition hover:border-indigo-500/60 hover:bg-neutral-900">
          <div class="flex items-start justify-between gap-2">
            <h2 class="font-medium text-white">{t.name}</h2>
            <span class="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400">{t.role}</span>
          </div>
          <p class="mt-3 text-xs text-neutral-600">{t.projectCount ?? 0} project{(t.projectCount ?? 0) === 1 ? '' : 's'}</p>
        </button>
      {/each}
    </div>
  {/if}
</div>
