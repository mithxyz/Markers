<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api, type Project, type ProjectType, type Team } from '$lib/api';
  import { auth } from '$lib/stores/auth.svelte';
  import { ui } from '$lib/stores/ui.svelte';

  let projects = $state<Project[]>([]);
  let teams = $state<Team[]>([]);
  let loading = $state(true);
  let name = $state('');
  let description = $state('');
  let type = $state<ProjectType>('general');
  let createTeamId = $state(''); // '' = personal
  let creating = $state(false);

  const teamName = $derived(new Map(teams.map((t) => [t.id, t.name])));
  // Group projects: personal first, then one group per team the user can see.
  const groups = $derived([
    { id: '', label: 'Personal', projects: projects.filter((p) => !p.team_id) },
    ...teams.map((t) => ({ id: t.id, label: t.name, projects: projects.filter((p) => p.team_id === t.id) })),
  ].filter((g) => g.projects.length));

  onMount(async () => {
    if (!auth.user) {
      goto('/login', { replaceState: true });
      return;
    }
    await refresh();
  });

  async function refresh() {
    loading = true;
    try {
      const [{ projects: p }, { teams: t }] = await Promise.all([
        api.get<{ projects: Project[] }>('/projects'),
        api.get<{ teams: Team[] }>('/teams'),
      ]);
      projects = p;
      teams = t;
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    } finally {
      loading = false;
    }
  }

  async function create(e: Event) {
    e.preventDefault();
    if (!name.trim()) return;
    creating = true;
    try {
      const { project } = await api.post<{ project: Project }>('/projects', {
        name: name.trim(),
        description: description.trim(),
        type,
        team_id: createTeamId || undefined,
      });
      name = '';
      description = '';
      type = 'general';
      ui.toast('Project created', 'success');
      goto(`/projects/${project.id}`);
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    } finally {
      creating = false;
    }
  }

  async function remove(p: Project, e: Event) {
    e.stopPropagation();
    if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    try {
      await api.del(`/projects/${p.id}`);
      projects = projects.filter((x) => x.id !== p.id);
      ui.toast('Project deleted', 'success');
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  async function logout() {
    await auth.logout();
    goto('/login', { replaceState: true });
  }
</script>

<div class="mx-auto max-w-5xl px-6 py-10">
  <header class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight text-white">Projects</h1>
      <p class="text-sm text-neutral-500">Signed in as {auth.user?.display_name} · {auth.user?.email}</p>
    </div>
    <div class="flex items-center gap-4">
      <a href="/help" class="text-sm text-neutral-500 hover:text-neutral-300">Help</a>
      <a href="/teams" class="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:border-indigo-500">Teams</a>
      {#if auth.user?.is_admin}
        <a href="/admin" class="rounded-lg border border-amber-500/40 px-3 py-1.5 text-sm text-amber-300 hover:border-amber-400">Admin</a>
      {/if}
      <button onclick={logout} class="text-sm text-neutral-400 hover:text-white">Sign out</button>
    </div>
  </header>

  <form onsubmit={create} class="mt-8 flex flex-wrap items-end gap-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
    <div class="flex flex-1 flex-col gap-1">
      <label class="text-xs text-neutral-400" for="pname">New project</label>
      <input
        id="pname"
        bind:value={name}
        placeholder="Project name"
        class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
      />
    </div>
    <div class="flex flex-[2] flex-col gap-1">
      <label class="text-xs text-neutral-400" for="pdesc">Description</label>
      <input
        id="pdesc"
        bind:value={description}
        placeholder="Optional"
        class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
      />
    </div>
    <div class="flex flex-col gap-1">
      <label class="text-xs text-neutral-400" for="ptype">Type</label>
      <select
        id="ptype"
        bind:value={type}
        title="DJ → departments, OSC, rekordbox · Dance → choreo notation · General → neutral"
        class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
      >
        <option value="general">General</option>
        <option value="dj">DJ / festival</option>
        <option value="dance">Dance / choreo</option>
      </select>
    </div>
    {#if teams.length}
      <div class="flex flex-col gap-1">
        <label class="text-xs text-neutral-400" for="pteam">Owner</label>
        <select id="pteam" bind:value={createTeamId} class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500">
          <option value="">Personal</option>
          {#each teams as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
        </select>
      </div>
    {/if}
    <button
      type="submit"
      disabled={creating}
      class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
    >
      Create
    </button>
  </form>

  {#if loading}
    <p class="mt-8 text-sm text-neutral-500">Loading…</p>
  {:else if projects.length === 0}
    <p class="mt-8 text-sm text-neutral-500">No projects yet. Create your first one above.</p>
  {:else}
    {#each groups as g (g.id)}
      <section class="mt-8">
        <div class="flex items-center gap-2">
          <h2 class="text-xs font-semibold uppercase tracking-wide text-neutral-500">{g.label}</h2>
          {#if g.id}<a href="/teams/{g.id}" class="text-[11px] text-neutral-600 hover:text-indigo-400">manage team →</a>{/if}
        </div>
        <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {#each g.projects as p (p.id)}
            <button
              onclick={() => goto(`/projects/${p.id}`)}
              class="group flex flex-col rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-left transition hover:border-indigo-500/60 hover:bg-neutral-900"
            >
              <div class="flex items-start justify-between gap-2">
                <h2 class="font-medium text-white">{p.name}</h2>
                <span class="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400">{p.role || 'team'}</span>
              </div>
              <p class="mt-1 line-clamp-2 text-sm text-neutral-500">{p.description || 'No description'}</p>
              <div class="mt-4 flex items-center justify-between">
                <span class="text-xs text-neutral-600">Updated {new Date(p.updated_at).toLocaleDateString()}</span>
                {#if p.role === 'owner'}
                  <span role="button" tabindex="0" onclick={(e) => remove(p, e)} onkeydown={(e) => e.key === 'Enter' && remove(p, e)} class="text-xs text-neutral-600 opacity-0 transition group-hover:opacity-100 hover:text-red-400">Delete</span>
                {/if}
              </div>
            </button>
          {/each}
        </div>
      </section>
    {/each}
  {/if}
</div>
