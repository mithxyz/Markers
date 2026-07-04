<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type ProjectRole, type Department } from '$lib/api';
  import { ui } from '$lib/stores/ui.svelte';

  let { projectId, departments = [], onChanged }: { projectId: string; departments?: Department[]; onChanged: () => void } = $props();

  let roles = $state<ProjectRole[]>([]);
  let vocabulary = $state<string[]>([]);
  let loaded = $state(false);
  let busy = $state<string | null>(null);
  let newName = $state('');
  let newCaps = $state<Set<string>>(new Set());
  // Per-role working copy of capabilities so edits can be saved explicitly.
  let draft = $state<Record<string, Set<string>>>({});
  // Phase 5d: per-role department access draft — roleId -> deptId -> {view, edit}.
  let deptDraft = $state<Record<string, Record<string, { view: boolean; edit: boolean }>>>({});

  function seedDeptDraft(rs: ProjectRole[]) {
    const out: Record<string, Record<string, { view: boolean; edit: boolean }>> = {};
    for (const r of rs) {
      const byDept = new Map((r.departments ?? []).map((d) => [d.department_id, d]));
      out[r.id] = Object.fromEntries(
        departments.map((d) => {
          const row = byDept.get(d.id);
          return [d.id, { view: row ? row.can_view : false, edit: row ? row.can_edit : false }];
        })
      );
    }
    return out;
  }
  const roleRestricted = (r: ProjectRole) => (r.departments?.length ?? 0) > 0;
  const draftRestricted = (roleId: string) => Object.values(deptDraft[roleId] ?? {}).some((v) => v.view || v.edit);

  const LABELS: Record<string, string> = {
    manage_project: 'Manage project',
    delete_project: 'Delete project',
    manage_members: 'Manage members',
    manage_roles: 'Manage roles',
    manage_tracks: 'Manage tracks',
    upload_media: 'Upload media',
    manage_versions: 'Manage versions',
    create_cues: 'Create cues (own)',
    edit_others_cues: "Edit others' cues",
    delete_others_cues: "Delete others' cues",
    view_private_cues: 'View private cues',
    create_invites: 'Create invites',
  };
  const label = (c: string) => LABELS[c] || c;

  async function load() {
    const data = await api.get<{ roles: ProjectRole[]; vocabulary: string[] }>(`/projects/${projectId}/roles`);
    roles = data.roles;
    vocabulary = data.vocabulary;
    draft = Object.fromEntries(roles.map((r) => [r.id, new Set(r.capabilities)]));
    deptDraft = seedDeptDraft(roles);
    loaded = true;
  }
  onMount(load);

  function toggle(set: Set<string>, cap: string) {
    const next = new Set(set);
    next.has(cap) ? next.delete(cap) : next.add(cap);
    return next;
  }

  async function saveRole(r: ProjectRole) {
    busy = r.id;
    try {
      const department_caps = departments.map((d) => ({
        department_id: d.id,
        can_view: deptDraft[r.id]?.[d.id]?.view ?? false,
        can_edit: deptDraft[r.id]?.[d.id]?.edit ?? false,
      }));
      await api.patch(`/projects/${projectId}/roles/${r.id}`, { capabilities: [...draft[r.id]], department_caps });
      ui.toast(`Saved “${r.name}”`, 'success');
      await load();
      onChanged();
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    } finally {
      busy = null;
    }
  }

  function setDept(roleId: string, deptId: string, key: 'view' | 'edit', on: boolean) {
    const cur = deptDraft[roleId]?.[deptId] ?? { view: false, edit: false };
    const next = { ...cur, [key]: on };
    if (key === 'edit' && on) next.view = true; // edit implies view
    if (key === 'view' && !on) next.edit = false;
    deptDraft[roleId] = { ...deptDraft[roleId], [deptId]: next };
  }
  const deptDirty = (r: ProjectRole) => {
    const dd = deptDraft[r.id];
    if (!dd) return false;
    const byDept = new Map((r.departments ?? []).map((d) => [d.department_id, d]));
    return departments.some((d) => {
      const row = byDept.get(d.id);
      const cur = dd[d.id] ?? { view: false, edit: false };
      return cur.view !== (row ? row.can_view : false) || cur.edit !== (row ? row.can_edit : false);
    });
  };

  async function setDefault(r: ProjectRole) {
    busy = r.id;
    try {
      await api.patch(`/projects/${projectId}/roles/${r.id}`, { is_default: true });
      await load();
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    } finally {
      busy = null;
    }
  }

  async function removeRole(r: ProjectRole) {
    if (!confirm(`Delete role “${r.name}”?`)) return;
    busy = r.id;
    try {
      await api.del(`/projects/${projectId}/roles/${r.id}`);
      await load();
      onChanged();
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    } finally {
      busy = null;
    }
  }

  async function createRole() {
    const name = newName.trim();
    if (!name) return;
    busy = 'new';
    try {
      await api.post(`/projects/${projectId}/roles`, { name, capabilities: [...newCaps] });
      newName = '';
      newCaps = new Set();
      await load();
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    } finally {
      busy = null;
    }
  }

  const capsDirty = (r: ProjectRole) => {
    const d = draft[r.id];
    if (!d) return false;
    return d.size !== r.capabilities.length || r.capabilities.some((c) => !d.has(c));
  };
  const dirty = (r: ProjectRole) => capsDirty(r) || deptDirty(r);
</script>

<section class="mt-10">
  <h2 class="text-xs font-semibold uppercase tracking-wide text-neutral-500">Roles &amp; permissions</h2>
  {#if !loaded}
    <p class="mt-3 text-sm text-neutral-500">Loading roles…</p>
  {:else}
    <div class="mt-3 flex flex-col gap-3">
      {#each roles as r (r.id)}
        <div class="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="font-medium text-white">{r.name}</span>
              {#if r.is_system}<span class="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] uppercase text-neutral-400">system</span>{/if}
              {#if r.is_default}<span class="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] uppercase text-indigo-300">default</span>{/if}
            </div>
            <div class="flex items-center gap-2 text-xs">
              {#if !r.is_default}
                <button onclick={() => setDefault(r)} disabled={busy === r.id} class="text-neutral-400 hover:text-white disabled:opacity-50">Set default</button>
              {/if}
              {#if !r.is_system}
                <button onclick={() => removeRole(r)} disabled={busy === r.id} class="text-neutral-600 hover:text-red-400 disabled:opacity-50">Delete</button>
              {/if}
            </div>
          </div>
          <div class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
            {#each vocabulary as cap (cap)}
              <label class="flex items-center gap-2 text-xs text-neutral-300">
                <input
                  type="checkbox"
                  checked={draft[r.id]?.has(cap)}
                  onchange={() => (draft[r.id] = toggle(draft[r.id], cap))}
                  class="accent-indigo-500"
                />
                {label(cap)}
              </label>
            {/each}
          </div>
          {#if departments.length}
            <div class="mt-3 border-t border-neutral-800 pt-3">
              <p class="text-[11px] font-medium text-neutral-400">Department access
                <span class="ml-1 text-neutral-600">{draftRestricted(r.id) ? '· restricted' : '· all departments (unrestricted)'}</span>
              </p>
              <div class="mt-1.5 flex flex-col gap-1">
                {#each departments as d (d.id)}
                  <div class="flex items-center gap-3 text-xs">
                    <span class="inline-flex w-28 items-center gap-1.5 text-neutral-300"><span class="h-2 w-2 rounded-full" style="background: {d.color}"></span><span class="truncate">{d.name}</span></span>
                    <label class="inline-flex cursor-pointer items-center gap-1 text-neutral-400"><input type="checkbox" class="accent-indigo-500" checked={deptDraft[r.id]?.[d.id]?.view} onchange={(e) => setDept(r.id, d.id, 'view', e.currentTarget.checked)} /> view</label>
                    <label class="inline-flex cursor-pointer items-center gap-1 text-neutral-400"><input type="checkbox" class="accent-indigo-500" checked={deptDraft[r.id]?.[d.id]?.edit} onchange={(e) => setDept(r.id, d.id, 'edit', e.currentTarget.checked)} /> edit</label>
                  </div>
                {/each}
              </div>
              <p class="mt-1 text-[10px] text-neutral-600">Leave every box unchecked for full access to all departments.</p>
            </div>
          {/if}
          {#if dirty(r)}
            <button onclick={() => saveRole(r)} disabled={busy === r.id} class="mt-3 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
              Save changes
            </button>
          {/if}
        </div>
      {/each}

      <!-- Create a new role -->
      <div class="rounded-xl border border-dashed border-neutral-800 p-4">
        <div class="flex items-center gap-2">
          <input
            bind:value={newName}
            placeholder="New role name"
            class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500"
          />
          <button onclick={createRole} disabled={busy === 'new' || !newName.trim()} class="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
            + Role
          </button>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          {#each vocabulary as cap (cap)}
            <label class="flex items-center gap-2 text-xs text-neutral-300">
              <input type="checkbox" checked={newCaps.has(cap)} onchange={() => (newCaps = toggle(newCaps, cap))} class="accent-indigo-500" />
              {label(cap)}
            </label>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</section>
