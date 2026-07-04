<script lang="ts">
  import { api, type Member, type Department, type DepartmentAssignment } from '$lib/api';
  import { ui } from '$lib/stores/ui.svelte';

  let {
    projectId,
    members = [],
    departments = [],
    assignments = [],
    canManage = false,
    onChanged,
  }: {
    projectId: string;
    members?: Member[];
    departments?: Department[];
    assignments?: DepartmentAssignment[];
    canManage?: boolean;
    onChanged?: () => void;
  } = $props();

  const key = (userId: string, deptId: string) => `${userId}:${deptId}`;
  const assigned = $derived(new Set(assignments.map((a) => key(a.user_id, a.department_id))));
  let busy = $state(false);

  async function toggle(userId: string, deptId: string, on: boolean) {
    busy = true;
    try {
      if (on) await api.post(`/projects/${projectId}/departments/${deptId}/assignments`, { user_id: userId });
      else await api.del(`/projects/${projectId}/departments/${deptId}/assignments/${userId}`);
      onChanged?.();
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    } finally {
      busy = false;
    }
  }
</script>

<section class="mt-8">
  <h2 class="text-xs font-semibold uppercase tracking-wide text-neutral-500">Crew assignments</h2>
  <p class="mt-1 text-xs text-neutral-600">Map people to departments. Drives the “My cues” focus filter — it doesn’t change permissions.</p>

  {#if !departments.length}
    <p class="mt-3 text-sm text-neutral-500">Add a department first.</p>
  {:else}
    <div class="mt-3 overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900/40">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-neutral-800 text-left text-[11px] uppercase tracking-wide text-neutral-500">
            <th class="px-3 py-2 font-medium">Member</th>
            {#each departments as d (d.id)}
              <th class="px-3 py-2 text-center font-medium">
                <span class="inline-flex items-center gap-1">
                  <span class="h-2.5 w-2.5 rounded-full" style="background: {d.color}"></span>{d.name}
                </span>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each members as m (m.id)}
            <tr class="border-b border-neutral-800/60 last:border-0">
              <td class="px-3 py-2 text-neutral-200">{m.display_name}<span class="ml-1 text-[11px] text-neutral-600">{m.role}</span></td>
              {#each departments as d (d.id)}
                <td class="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    class="accent-indigo-500"
                    checked={assigned.has(key(m.id, d.id))}
                    disabled={!canManage || busy}
                    onchange={(e) => toggle(m.id, d.id, e.currentTarget.checked)}
                  />
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
