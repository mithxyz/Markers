<script lang="ts">
  import { api, type Member, type ProjectRole } from '$lib/api';
  import { ui } from '$lib/stores/ui.svelte';

  let {
    projectId,
    members,
    roles,
    ownerId,
    canManage,
    onChanged,
  }: {
    projectId: string;
    members: Member[];
    roles: ProjectRole[];
    ownerId: string;
    canManage: boolean;
    onChanged: () => void;
  } = $props();

  let busy = $state<string | null>(null);

  async function changeRole(m: Member, roleId: string) {
    if (roleId === m.role_id) return;
    busy = m.id;
    try {
      await api.patch(`/projects/${projectId}/members/${m.id}`, { role_id: roleId });
      ui.toast(`Updated ${m.display_name}'s role`, 'success');
      onChanged();
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    } finally {
      busy = null;
    }
  }

  async function remove(m: Member) {
    if (!confirm(`Remove ${m.display_name} from this project?`)) return;
    busy = m.id;
    try {
      await api.del(`/projects/${projectId}/members/${m.id}`);
      onChanged();
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    } finally {
      busy = null;
    }
  }
</script>

<section class="mt-10">
  <h2 class="text-xs font-semibold uppercase tracking-wide text-neutral-500">Members</h2>
  <ul class="mt-3 divide-y divide-neutral-800 rounded-xl border border-neutral-800">
    {#each members as m (m.id)}
      {@const isOwner = m.id === ownerId}
      <li class="flex items-center justify-between px-4 py-3">
        <div>
          <p class="text-sm text-white">{m.display_name}</p>
          <p class="text-xs text-neutral-500">{m.email}</p>
        </div>
        <div class="flex items-center gap-2">
          {#if canManage && !isOwner}
            <select
              value={m.role_id}
              disabled={busy === m.id}
              onchange={(e) => changeRole(m, (e.target as HTMLSelectElement).value)}
              class="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-white outline-none focus:border-indigo-500"
            >
              {#each roles as r (r.id)}
                <option value={r.id}>{r.name}</option>
              {/each}
            </select>
            <button
              onclick={() => remove(m)}
              disabled={busy === m.id}
              class="rounded px-2 py-1 text-xs text-neutral-600 hover:text-red-400 disabled:opacity-50"
            >
              Remove
            </button>
          {:else}
            <span class="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400">
              {m.role}{isOwner ? ' · owner' : ''}
            </span>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
</section>
