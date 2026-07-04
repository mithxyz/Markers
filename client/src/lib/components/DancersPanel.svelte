<script lang="ts">
  import { api } from '$lib/api';
  import type { Dancer, StageConfig } from '$lib/types';
  import { DEFAULT_STAGE } from '$lib/formations';
  import { ui } from '$lib/stores/ui.svelte';
  import { uploadDancerImage } from '$lib/upload/presignedUpload';

  let {
    projectId,
    dancers = [],
    stage = DEFAULT_STAGE,
    canManage = false,
    onChanged,
  }: {
    projectId: string;
    dancers?: Dancer[];
    stage?: StageConfig;
    canManage?: boolean;
    onChanged?: () => void;
  } = $props();

  const PALETTE = ['#22d3ee', '#f97316', '#a855f7', '#22c55e', '#ec4899', '#eab308', '#6366f1', '#ef4444'];
  const base = `/projects/${projectId}/dancers`;

  let newName = $state('');
  let newColor = $state('#22d3ee');
  let busy = $state(false);
  let width = $state(stage?.width ?? DEFAULT_STAGE.width);
  let depth = $state(stage?.depth ?? DEFAULT_STAGE.depth);
  // Per-dancer upload progress (keyed by dancer id, value 0-100 or null when idle).
  let uploadProgress = $state<Map<string, number | null>>(new Map());

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

  function addDancer() {
    const name = newName.trim();
    if (!name) return;
    const label = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
    run(async () => {
      await api.post(base, { name, color: newColor, label });
      newName = '';
    });
  }
  const renameDancer = (d: Dancer, name: string) => name.trim() && name !== d.name && run(() => api.patch(`${base}/${d.id}`, { name: name.trim() }));
  const relabelDancer = (d: Dancer, label: string) => {
    const l = label.slice(0, 3);
    return l !== d.label && run(() => api.patch(`${base}/${d.id}`, { label: l }));
  };
  const recolorDancer = (d: Dancer, color: string) => run(() => api.patch(`${base}/${d.id}`, { color }));
  const deleteDancer = (d: Dancer) => confirm(`Remove dancer "${d.name}"?`) && run(() => api.del(`${base}/${d.id}`));

  // Phase 8d: avatar upload
  async function handleAvatarFile(d: Dancer, files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    uploadProgress = new Map(uploadProgress).set(d.id, 0);
    try {
      await uploadDancerImage(projectId, d.id, file, {
        onProgress: (p) => { uploadProgress = new Map(uploadProgress).set(d.id, p); },
      });
      onChanged?.();
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    } finally {
      uploadProgress = new Map(uploadProgress).set(d.id, null);
    }
  }
  async function removeAvatar(d: Dancer) {
    try {
      await api.del(`${base}/${d.id}/image`);
      onChanged?.();
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  function saveStage() {
    const w = Math.max(1, Number(width) || DEFAULT_STAGE.width);
    const d = Math.max(1, Number(depth) || DEFAULT_STAGE.depth);
    run(() => api.patch(`/projects/${projectId}/settings`, { stage: { width: w, depth: d } }));
  }
</script>

<section class="mt-8">
  <h2 class="text-xs font-semibold uppercase tracking-wide text-neutral-500">Cast &amp; stage</h2>
  <p class="mt-1 text-xs text-neutral-600">Your dancers and the stage they perform on — used by the formation editor.</p>

  <div class="mt-3 flex flex-wrap gap-2">
    {#each dancers as d (d.id)}
      <div class="inline-flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/40 px-2 py-1.5">
        <!-- Avatar circle: image when present, colour + label otherwise -->
        <div class="relative h-7 w-7 shrink-0">
          {#if d.imageUrl}
            <img src={d.imageUrl} alt={d.name} class="h-7 w-7 rounded-full object-cover" />
          {:else}
            <span class="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-neutral-950" style="background: {d.color}">{d.label || d.name[0]?.toUpperCase() || '?'}</span>
          {/if}
          {#if canManage}
            <!-- upload overlay -->
            <label class="absolute inset-0 flex cursor-pointer items-center justify-center rounded-full bg-black/40 opacity-0 transition hover:opacity-100" title="Upload avatar">
              <span class="text-[9px] text-white leading-none">📷</span>
              <input type="file" accept="image/*" class="sr-only" onchange={(e) => handleAvatarFile(d, e.currentTarget.files)} />
            </label>
          {/if}
        </div>
        {#if canManage}
          <input value={d.name} onblur={(e) => renameDancer(d, e.currentTarget.value)} onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()} class="w-24 bg-transparent text-sm text-neutral-200 outline-none" />
          <input value={d.label} onblur={(e) => relabelDancer(d, e.currentTarget.value)} maxlength="3" placeholder="ABC" class="w-8 rounded border border-neutral-800 bg-neutral-950 px-1 text-center text-[11px] text-neutral-300 outline-none" title="Token label (max 3 chars)" />
          <input type="color" value={d.color} onchange={(e) => recolorDancer(d, e.currentTarget.value)} class="h-5 w-6 cursor-pointer rounded bg-transparent" />
          {#if d.imageUrl}
            <button onclick={() => removeAvatar(d)} class="text-[11px] text-neutral-600 hover:text-amber-400" title="Remove avatar">✕img</button>
          {/if}
          {#if (uploadProgress.get(d.id) ?? null) !== null}
            <span class="text-[10px] text-indigo-400">{uploadProgress.get(d.id)}%</span>
          {/if}
          <button onclick={() => deleteDancer(d)} class="text-neutral-600 hover:text-red-400">✕</button>
        {:else}
          <span class="text-sm text-neutral-200">{d.name}</span>
        {/if}
      </div>
    {/each}
  </div>

  {#if canManage}
    <div class="mt-3 flex flex-wrap items-center gap-2">
      <input bind:value={newName} placeholder="Add dancer" onkeydown={(e) => e.key === 'Enter' && addDancer()} class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500" />
      <input type="color" bind:value={newColor} class="h-8 w-9 cursor-pointer rounded bg-transparent" />
      <button onclick={addDancer} disabled={busy} class="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">+ Dancer</button>
      <span class="ml-1 flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500">
        <span class="text-neutral-600">Stage</span>
        <input bind:value={width} type="number" min="1" step="0.5" class="w-16 rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-neutral-300 outline-none focus:border-indigo-500" /> w
        <span class="text-neutral-700">×</span>
        <input bind:value={depth} type="number" min="1" step="0.5" class="w-16 rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-neutral-300 outline-none focus:border-indigo-500" /> d
        <button onclick={saveStage} disabled={busy} class="rounded border border-neutral-700 px-2 py-1 hover:bg-neutral-800">Save stage</button>
      </span>
    </div>
    <p class="mt-1.5 text-[11px] text-neutral-600">Quick colours:
      {#each PALETTE as c}<button onclick={() => (newColor = c)} aria-label="colour {c}" class="ml-1 inline-block h-3.5 w-3.5 rounded-full align-middle {newColor === c ? 'ring-1 ring-white' : ''}" style="background: {c}"></button>{/each}
    </p>
    <p class="mt-1 text-[11px] text-neutral-600">Hover a dancer's dot and click 📷 to upload an avatar. Token label is shown on stage when no image is set (max 3 chars).</p>
  {/if}
</section>
