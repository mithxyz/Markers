<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { api, type Team, type TeamMember, type Project } from '$lib/api';
  import { auth } from '$lib/stores/auth.svelte';
  import { ui } from '$lib/stores/ui.svelte';

  const teamId = $derived(($page.params as Record<string, string>).id);
  let team = $state<Team | null>(null);
  let members = $state<TeamMember[]>([]);
  let projects = $state<Project[]>([]);
  let loading = $state(true);
  let newEmail = $state('');
  let renaming = $state(false);

  const isOwner = $derived(team?.role === 'owner');

  onMount(async () => {
    if (!auth.user) { goto('/login', { replaceState: true }); return; }
    await load();
  });
  async function load() {
    loading = true;
    try {
      const data = await api.get<{ team: Team; members: TeamMember[]; projects: Project[] }>(`/teams/${teamId}`);
      team = data.team;
      members = data.members;
      projects = data.projects;
    } catch (e) {
      ui.toast((e as Error).message, 'error');
      goto('/teams', { replaceState: true });
    } finally {
      loading = false;
    }
  }
  async function rename() {
    if (!team) return;
    const name = prompt('Team name', team.name)?.trim();
    if (!name || name === team.name) return;
    renaming = true;
    try { await api.patch(`/teams/${teamId}`, { name }); await load(); }
    catch (e) { ui.toast((e as Error).message, 'error'); } finally { renaming = false; }
  }
  async function deleteTeam() {
    if (!confirm(`Delete team "${team?.name}"? Its projects become personal (owned by their creators).`)) return;
    try { await api.del(`/teams/${teamId}`); goto('/teams', { replaceState: true }); }
    catch (e) { ui.toast((e as Error).message, 'error'); }
  }
  async function addMember(e: Event) {
    e.preventDefault();
    const email = newEmail.trim();
    if (!email) return;
    try { await api.post(`/teams/${teamId}/members`, { email }); newEmail = ''; await load(); }
    catch (e) { ui.toast((e as Error).message, 'error'); }
  }
  async function setRole(m: TeamMember, role: 'owner' | 'member') {
    try { await api.patch(`/teams/${teamId}/members/${m.id}`, { role }); await load(); }
    catch (e) { ui.toast((e as Error).message, 'error'); }
  }
  async function removeMember(m: TeamMember) {
    const self = m.id === auth.user?.id;
    if (!confirm(self ? 'Leave this team?' : `Remove ${m.display_name}?`)) return;
    try {
      await api.del(`/teams/${teamId}/members/${m.id}`);
      if (self) goto('/teams', { replaceState: true });
      else await load();
    } catch (e) { ui.toast((e as Error).message, 'error'); }
  }
</script>

{#if loading}
  <p class="px-6 py-10 text-sm text-neutral-500">Loading…</p>
{:else if team}
  <div class="mx-auto max-w-4xl px-6 py-10">
    <header class="flex items-center justify-between border-b border-neutral-800 pb-4">
      <div class="flex items-center gap-3">
        <a href="/teams" class="text-sm text-neutral-500 hover:text-white">← Teams</a>
        <h1 class="text-xl font-semibold text-white">{team.name}</h1>
        <span class="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400">{team.role}</span>
      </div>
      {#if isOwner}
        <div class="flex items-center gap-3 text-sm">
          <button onclick={rename} disabled={renaming} class="text-neutral-400 hover:text-white">Rename</button>
          <button onclick={deleteTeam} class="text-neutral-600 hover:text-red-400">Delete</button>
        </div>
      {/if}
    </header>

    <!-- Projects -->
    <section class="mt-8">
      <h2 class="text-xs font-semibold uppercase tracking-wide text-neutral-500">Projects</h2>
      {#if projects.length === 0}
        <p class="mt-3 text-sm text-neutral-500">No team projects yet. Create one from the projects page and choose this team as the owner.</p>
      {:else}
        <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {#each projects as p (p.id)}
            <button onclick={() => goto(`/projects/${p.id}`)} class="flex flex-col rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-left transition hover:border-indigo-500/60 hover:bg-neutral-900">
              <h3 class="truncate font-medium text-white">{p.name}</h3>
              <p class="mt-1 line-clamp-2 text-sm text-neutral-500">{p.description || 'No description'}</p>
              <span class="mt-3 text-[10px] uppercase tracking-wide text-neutral-600">{p.type}</span>
            </button>
          {/each}
        </div>
      {/if}
    </section>

    <!-- Members -->
    <section class="mt-8">
      <h2 class="text-xs font-semibold uppercase tracking-wide text-neutral-500">Members</h2>
      <div class="mt-3 overflow-hidden rounded-xl border border-neutral-800">
        {#each members as m (m.id)}
          <div class="flex items-center justify-between border-b border-neutral-800/60 px-4 py-2.5 last:border-0">
            <div>
              <p class="text-sm text-neutral-200">{m.display_name} {#if m.id === auth.user?.id}<span class="text-neutral-600">(you)</span>{/if}</p>
              <p class="text-xs text-neutral-600">{m.email}</p>
            </div>
            <div class="flex items-center gap-3 text-xs">
              {#if isOwner}
                <select value={m.role} onchange={(e) => setRole(m, e.currentTarget.value as 'owner' | 'member')} class="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-neutral-200">
                  <option value="member">member</option>
                  <option value="owner">owner</option>
                </select>
                <button onclick={() => removeMember(m)} class="text-neutral-600 hover:text-red-400">Remove</button>
              {:else}
                <span class="text-neutral-500">{m.role}</span>
                {#if m.id === auth.user?.id}<button onclick={() => removeMember(m)} class="text-neutral-600 hover:text-red-400">Leave</button>{/if}
              {/if}
            </div>
          </div>
        {/each}
      </div>
      {#if isOwner}
        <form onsubmit={addMember} class="mt-3 flex items-center gap-2">
          <input bind:value={newEmail} type="email" placeholder="Add member by email (they need an account)" class="flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500" />
          <button type="submit" class="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">Add</button>
        </form>
      {/if}
    </section>
  </div>
{/if}
