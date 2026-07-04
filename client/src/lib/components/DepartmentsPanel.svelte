<script lang="ts">
  import { api, type Department, type LaneType } from '$lib/api';
  import { ui } from '$lib/stores/ui.svelte';

  let {
    projectId,
    departments = [],
    canManage = false,
    onChanged,
  }: {
    projectId: string;
    departments?: Department[];
    canManage?: boolean;
    onChanged?: () => void;
  } = $props();

  const PALETTE = ['#6366f1', '#22c55e', '#f97316', '#ec4899', '#06b6d4', '#eab308', '#a855f7', '#ef4444'];

  let newDeptName = $state('');
  let newDeptColor = $state('#6366f1');
  let newLaneName = $state<Record<string, string>>({});
  let busy = $state(false);

  const base = `/projects/${projectId}/departments`;

  async function run(fn: () => Promise<unknown>) {
    busy = true;
    try {
      await fn();
      onChanged?.();
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    } finally {
      busy = false;
    }
  }

  function addDept() {
    const name = newDeptName.trim();
    if (!name) return;
    run(async () => {
      await api.post(base, { name, color: newDeptColor });
      newDeptName = '';
      newDeptColor = '#6366f1';
    });
  }

  const renameDept = (d: Department, name: string) =>
    name.trim() && name !== d.name && run(() => api.patch(`${base}/${d.id}`, { name: name.trim() }));
  const recolorDept = (d: Department, color: string) => run(() => api.patch(`${base}/${d.id}`, { color }));
  const setDeptOscAddr = (d: Department, v: string) =>
    (v || null) !== d.default_osc_address && run(() => api.patch(`${base}/${d.id}`, { default_osc_address: v.trim() || null }));
  const setDeptOscValue = (d: Department, v: string) =>
    (v || null) !== d.default_osc_value && run(() => api.patch(`${base}/${d.id}`, { default_osc_value: v.trim() || null }));
  const deleteDept = (d: Department) =>
    confirm(`Delete department "${d.name}"? (Only if it holds no cues.)`) && run(() => api.del(`${base}/${d.id}`));

  function addLane(d: Department) {
    const name = (newLaneName[d.id] || '').trim();
    if (!name) return;
    run(async () => {
      await api.post(`${base}/${d.id}/lanes`, { name });
      newLaneName[d.id] = '';
    });
  }
  const renameLane = (d: Department, laneId: string, name: string, prev: string) =>
    name.trim() && name !== prev && run(() => api.patch(`${base}/${d.id}/lanes/${laneId}`, { name: name.trim() }));
  const setLaneType = (d: Department, laneId: string, laneType: LaneType) =>
    run(() => api.patch(`${base}/${d.id}/lanes/${laneId}`, { lane_type: laneType }));
  const deleteLane = (d: Department, laneId: string, laneName: string) =>
    confirm(`Delete lane "${laneName}"? (Only if it holds no cues.)`) && run(() => api.del(`${base}/${d.id}/lanes/${laneId}`));
</script>

<section class="mt-8">
  <div class="flex items-center justify-between">
    <h2 class="text-xs font-semibold uppercase tracking-wide text-neutral-500">Departments &amp; lanes</h2>
    <span class="text-xs text-neutral-600">{departments.length} department{departments.length === 1 ? '' : 's'}</span>
  </div>

  <div class="mt-4 flex flex-col gap-3">
    {#each departments as d (d.id)}
      <div class="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
        <div class="flex items-center gap-2">
          <span class="h-3.5 w-3.5 shrink-0 rounded-full" style="background: {d.color}"></span>
          {#if canManage}
            <input
              value={d.name}
              onblur={(e) => renameDept(d, e.currentTarget.value)}
              onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              class="rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-white hover:border-neutral-700 focus:border-indigo-500 focus:outline-none"
            />
            <div class="flex items-center gap-1">
              {#each PALETTE as c}
                <button
                  onclick={() => recolorDept(d, c)}
                  aria-label="colour {c}"
                  class="h-4 w-4 rounded-full border {d.color === c ? 'border-white' : 'border-transparent'}"
                  style="background: {c}"
                ></button>
              {/each}
            </div>
            <button onclick={() => deleteDept(d)} disabled={busy} class="ml-auto text-xs text-neutral-600 hover:text-red-400">Delete</button>
          {:else}
            <span class="text-sm font-medium text-white">{d.name}</span>
          {/if}
        </div>

        <div class="mt-2 flex flex-wrap items-center gap-1.5 pl-5">
          {#each d.lanes as lane (lane.id)}
            <span class="inline-flex items-center gap-1 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-0.5 text-xs text-neutral-300">
              {#if canManage}
                <input
                  value={lane.name}
                  onblur={(e) => renameLane(d, lane.id, e.currentTarget.value, lane.name)}
                  onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  class="w-20 bg-transparent text-xs text-neutral-200 outline-none"
                />
                {#if lane.kind === 'automation'}<span class="text-[10px] text-amber-400">auto</span>{/if}
                <select
                  value={lane.lane_type ?? 'point'}
                  onchange={(e) => setLaneType(d, lane.id, e.currentTarget.value as LaneType)}
                  class="bg-transparent text-[10px] text-neutral-500 outline-none hover:text-neutral-300"
                  title="Lane type — point markers or region bars"
                >
                  <option value="point">pt</option>
                  <option value="region">rgn</option>
                </select>
                <button onclick={() => deleteLane(d, lane.id, lane.name)} class="text-neutral-600 hover:text-red-400">✕</button>
              {:else}
                {lane.name}{#if lane.kind === 'automation'}<span class="text-[10px] text-amber-400"> auto</span>{/if}{#if lane.lane_type === 'region'}<span class="text-[10px] text-sky-400"> rgn</span>{/if}
              {/if}
            </span>
          {/each}
          {#if canManage}
            <span class="inline-flex items-center gap-1">
              <input
                bind:value={newLaneName[d.id]}
                placeholder="+ lane"
                onkeydown={(e) => e.key === 'Enter' && addLane(d)}
                class="w-20 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-0.5 text-xs text-white outline-none focus:border-indigo-500"
              />
            </span>
          {/if}
        </div>

        {#if canManage}
          <div class="mt-2 flex flex-wrap items-center gap-2 pl-5 text-[11px] text-neutral-500">
            <span class="text-neutral-600">OSC defaults</span>
            <input
              value={d.default_osc_address ?? ''}
              onblur={(e) => setDeptOscAddr(d, e.currentTarget.value)}
              placeholder="/composition/layers/1/clips/1/"
              class="min-w-0 flex-1 rounded border border-neutral-800 bg-neutral-950 px-2 py-0.5 font-mono text-[11px] text-neutral-300 outline-none focus:border-indigo-500"
            />
            <input
              value={d.default_osc_value ?? ''}
              onblur={(e) => setDeptOscValue(d, e.currentTarget.value)}
              placeholder="value"
              class="w-16 rounded border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-[11px] text-neutral-300 outline-none focus:border-indigo-500"
            />
          </div>
        {/if}
      </div>
    {/each}
  </div>

  {#if canManage}
    <div class="mt-3 flex items-center gap-2">
      <input
        bind:value={newDeptName}
        placeholder="New department (e.g. Lighting, Visuals, Lasers)"
        onkeydown={(e) => e.key === 'Enter' && addDept()}
        class="flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500"
      />
      <input type="color" bind:value={newDeptColor} class="h-8 w-9 cursor-pointer rounded bg-transparent" />
      <button onclick={addDept} disabled={busy} class="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">+ Department</button>
    </div>
  {/if}
</section>
