<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { auth } from '$lib/stores/auth.svelte';
  import { ui } from '$lib/stores/ui.svelte';

  interface AdminUser {
    id: string;
    email: string;
    display_name: string;
    is_admin: boolean;
    project_count: string;
    created_at: string;
  }
  interface AdminProject {
    id: string;
    name: string;
    description: string;
    owner_email: string | null;
    owner_name: string | null;
    member_count: string;
    updated_at: string;
  }

  interface SystemLogEntry {
    id: string;
    source: string;
    level: 'error' | 'warn' | 'info';
    message: string;
    meta: Record<string, unknown>;
    created_at: string;
  }
  interface SystemStatus {
    queue: Record<string, number>;
    errors_last_24h: number;
  }

  let users = $state<AdminUser[]>([]);
  let projects = $state<AdminProject[]>([]);
  let systemLog = $state<SystemLogEntry[]>([]);
  let systemStatus = $state<SystemStatus | null>(null);
  let loading = $state(true);
  let tab = $state<'projects' | 'users' | 'system'>('projects');

  onMount(async () => {
    if (!auth.user) return goto('/login', { replaceState: true });
    if (!auth.user.is_admin) {
      ui.toast('Admins only', 'error');
      return goto('/projects', { replaceState: true });
    }
    await refresh();
  });

  async function refresh() {
    loading = true;
    try {
      const [u, p, sl, ss] = await Promise.all([
        api.get<{ users: AdminUser[] }>('/admin/users'),
        api.get<{ projects: AdminProject[] }>('/admin/projects'),
        api.get<{ entries: SystemLogEntry[] }>('/admin/system-log?limit=50'),
        api.get<SystemStatus>('/admin/system/status'),
      ]);
      users = u.users;
      projects = p.projects;
      systemLog = sl.entries;
      systemStatus = ss;
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    } finally {
      loading = false;
    }
  }

  async function toggleAdmin(u: AdminUser) {
    try {
      await api.patch(`/admin/users/${u.id}`, { is_admin: !u.is_admin });
      u.is_admin = !u.is_admin;
      users = [...users];
      ui.toast(`${u.email} ${u.is_admin ? 'is now an admin' : 'is no longer an admin'}`, 'success');
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  async function deleteUser(u: AdminUser) {
    if (!confirm(`Delete user ${u.email}? This cannot be undone.`)) return;
    try {
      await api.del(`/admin/users/${u.id}`);
      users = users.filter((x) => x.id !== u.id);
      ui.toast('User deleted', 'success');
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  async function deleteProject(p: AdminProject) {
    if (!confirm(`Delete project "${p.name}"? This cannot be undone.`)) return;
    try {
      await api.del(`/admin/projects/${p.id}`);
      projects = projects.filter((x) => x.id !== p.id);
      ui.toast('Project deleted', 'success');
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }
</script>

<div class="mx-auto max-w-5xl px-6 py-10">
  <header class="flex items-center justify-between">
    <div class="flex items-center gap-3">
      <a href="/projects" class="text-sm text-neutral-500 hover:text-white">← Projects</a>
      <h1 class="text-2xl font-semibold tracking-tight text-white">Admin</h1>
      <span class="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">Superuser</span>
    </div>
  </header>

  <div class="mt-6 flex gap-2 border-b border-neutral-800">
    <button onclick={() => (tab = 'projects')} class="px-3 py-2 text-sm {tab === 'projects' ? 'border-b-2 border-indigo-500 text-white' : 'text-neutral-400'}">
      All projects ({projects.length})
    </button>
    <button onclick={() => (tab = 'users')} class="px-3 py-2 text-sm {tab === 'users' ? 'border-b-2 border-indigo-500 text-white' : 'text-neutral-400'}">
      Users ({users.length})
    </button>
    <button onclick={() => (tab = 'system')} class="px-3 py-2 text-sm {tab === 'system' ? 'border-b-2 border-indigo-500 text-white' : 'text-neutral-400'}">
      System {#if (systemStatus?.errors_last_24h ?? 0) > 0}<span class="ml-1 rounded-full bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-400">{systemStatus?.errors_last_24h}</span>{/if}
    </button>
  </div>

  {#if loading}
    <p class="mt-6 text-sm text-neutral-500">Loading…</p>
  {:else if tab === 'projects'}
    <ul class="mt-6 divide-y divide-neutral-800 rounded-xl border border-neutral-800">
      {#each projects as p (p.id)}
        <li class="flex items-center justify-between px-4 py-3">
          <div class="min-w-0">
            <p class="truncate text-sm text-white">{p.name}</p>
            <p class="text-xs text-neutral-500">owner {p.owner_email || '—'} · {p.member_count} member(s) · updated {new Date(p.updated_at).toLocaleDateString()}</p>
          </div>
          <div class="flex shrink-0 items-center gap-3">
            <a href={`/projects/${p.id}`} class="text-xs font-medium text-indigo-400 hover:text-indigo-300">Open</a>
            <button onclick={() => deleteProject(p)} class="text-xs text-neutral-500 hover:text-red-400">Delete</button>
          </div>
        </li>
      {/each}
    </ul>
  {:else if tab === 'users'}
    <ul class="mt-6 divide-y divide-neutral-800 rounded-xl border border-neutral-800">
      {#each users as u (u.id)}
        <li class="flex items-center justify-between px-4 py-3">
          <div class="min-w-0">
            <p class="truncate text-sm text-white">
              {u.display_name}
              {#if u.is_admin}<span class="ml-1 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] uppercase text-amber-300">admin</span>{/if}
            </p>
            <p class="text-xs text-neutral-500">{u.email} · {u.project_count} project(s)</p>
          </div>
          <div class="flex shrink-0 items-center gap-3">
            <button onclick={() => toggleAdmin(u)} class="text-xs text-neutral-400 hover:text-white">
              {u.is_admin ? 'Revoke admin' : 'Make admin'}
            </button>
            <button onclick={() => deleteUser(u)} class="text-xs text-neutral-500 hover:text-red-400">Delete</button>
          </div>
        </li>
      {/each}
    </ul>
  {:else if tab === 'system'}
    {#if systemStatus}
      <div class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {#each Object.entries(systemStatus.queue) as [state, count] (state)}
          <div class="rounded-xl border border-neutral-800 px-4 py-3">
            <p class="text-xs uppercase tracking-wide text-neutral-500">{state}</p>
            <p class="mt-1 text-xl font-semibold tabular-nums {state === 'failed' && count > 0 ? 'text-red-400' : 'text-white'}">{count}</p>
          </div>
        {/each}
        <div class="rounded-xl border border-neutral-800 px-4 py-3 col-span-2 sm:col-span-1">
          <p class="text-xs uppercase tracking-wide text-neutral-500">errors 24 h</p>
          <p class="mt-1 text-xl font-semibold tabular-nums {systemStatus.errors_last_24h > 0 ? 'text-red-400' : 'text-emerald-400'}">{systemStatus.errors_last_24h}</p>
        </div>
      </div>
    {/if}
    <ul class="mt-6 divide-y divide-neutral-800 rounded-xl border border-neutral-800">
      {#if systemLog.length === 0}
        <li class="px-4 py-6 text-sm text-neutral-500">No system log entries.</li>
      {:else}
        {#each systemLog as e (e.id)}
          <li class="px-4 py-3">
            <div class="flex items-center gap-2">
              <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide font-medium
                {e.level === 'error' ? 'bg-red-500/20 text-red-400' : e.level === 'warn' ? 'bg-amber-500/20 text-amber-300' : 'bg-neutral-700 text-neutral-400'}">
                {e.level}
              </span>
              <span class="shrink-0 text-xs text-neutral-500">{e.source}</span>
              <span class="min-w-0 truncate text-sm text-white">{e.message}</span>
              <span class="ml-auto shrink-0 text-xs text-neutral-600">{new Date(e.created_at).toLocaleString()}</span>
            </div>
          </li>
        {/each}
      {/if}
    </ul>
  {/if}
</div>
