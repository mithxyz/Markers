<script lang="ts">
  import { api } from '$lib/api';
  import type { Track, TrackVersion } from '$lib/types';
  import { ui } from '$lib/stores/ui.svelte';
  import StatusPill from './StatusPill.svelte';

  let {
    projectId,
    track,
    canEdit = false,
    onChanged,
  }: {
    projectId: string;
    track: Track;
    canEdit?: boolean;
    onChanged?: () => void;
  } = $props();

  const base = $derived(`/projects/${projectId}/tracks/${track.id}`);
  const versions = $derived([...track.versions].sort((a, b) => b.version_number - a.version_number));

  let realignFor = $state<TrackVersion | null>(null);
  let strategy = $state<'keep' | 'scale' | 'offset'>('keep');
  let offset = $state(0);
  let busy = $state(false);
  let reprocessing = $state<string | null>(null); // versionId being reprocessed

  async function reprocess(v: TrackVersion) {
    const base = `/projects/${projectId}/tracks/${track.id}`;
    reprocessing = v.id;
    try {
      await api.post(`${base}/versions/${v.id}/reprocess`, {});
      ui.toast('Reprocessing — this view will refresh when ready', 'info');
      onChanged?.();
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    } finally {
      reprocessing = null;
    }
  }

  function fmt(s: number) {
    if (!s) return '—';
    const m = Math.floor(s / 60);
    return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  }

  async function startActivate(v: TrackVersion) {
    if (v.id === track.current_version_id) return;
    try {
      const meta = await api.get<{ needsRealign: boolean }>(`${base}/versions/${v.id}/meta`);
      if (meta.needsRealign) {
        realignFor = v;
        strategy = 'keep';
        offset = 0;
      } else {
        await activate(v, 'keep', 0);
      }
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  async function activate(v: TrackVersion, strat: string, off: number) {
    busy = true;
    try {
      await api.post(`${base}/versions/${v.id}/activate`, { strategy: strat, offset: off });
      ui.toast(`Activated v${v.version_number}`, 'success');
      realignFor = null;
      onChanged?.();
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    } finally {
      busy = false;
    }
  }

  async function rollback(v: TrackVersion, restoreCues: boolean) {
    busy = true;
    try {
      await api.post(`${base}/versions/${v.id}/rollback`, { restoreCues });
      ui.toast(`Rolled back to v${v.version_number}`, 'success');
      onChanged?.();
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    } finally {
      busy = false;
    }
  }
</script>

<div class="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
  <h3 class="text-xs font-semibold uppercase tracking-wide text-neutral-500">Versions</h3>
  <ul class="mt-2 flex flex-col gap-1">
    {#each versions as v (v.id)}
      <li class="flex items-center justify-between rounded-lg px-2 py-1.5 {v.id === track.current_version_id ? 'bg-indigo-500/10' : 'hover:bg-neutral-800/50'}">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm text-neutral-100">v{v.version_number}</span>
            {#if v.label}<span class="text-xs text-neutral-500">{v.label}</span>{/if}
            <span class="text-xs text-neutral-600">{fmt(v.media_duration)}</span>
            <StatusPill status={v.status} />
            {#if v.id === track.current_version_id}
              <span class="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-indigo-300">Active</span>
            {/if}
            {#if v.status === 'ready' && v.analysis_status === 'analyzer_unreachable'}
              <span class="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-400" title="The BeatNet analyzer sidecar was unreachable during processing — no BPM/beat data">No BPM — analyzer down</span>
            {:else if v.status === 'ready' && v.analysis_status === 'no_rhythm'}
              <span class="rounded-full bg-neutral-700/60 px-2 py-0.5 text-[10px] text-neutral-400" title="The analyzer ran but could not detect a usable beat grid">No beat grid</span>
            {/if}
            {#if v.status === 'failed' && v.error_message}
              <span class="truncate text-[11px] text-red-400" title={v.error_message}>{v.error_message}</span>
            {/if}
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          {#if canEdit && (v.status === 'failed' || (v.status === 'ready' && v.analysis_status === 'analyzer_unreachable'))}
            <button
              disabled={reprocessing === v.id}
              onclick={() => reprocess(v)}
              class="text-xs text-amber-500 hover:text-amber-300 disabled:opacity-50"
              title="Re-run waveform analysis"
            >{reprocessing === v.id ? 'Reprocessing…' : 'Retry'}</button>
          {/if}
          {#if canEdit && v.status === 'ready' && v.id !== track.current_version_id}
            <button disabled={busy} onclick={() => startActivate(v)} class="text-xs font-medium text-indigo-400 hover:text-indigo-300">Make active</button>
            <button disabled={busy} onclick={() => rollback(v, true)} class="text-xs text-neutral-500 hover:text-white" title="Restore this version's media and its cue snapshot">Rollback +cues</button>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
</div>

{#if realignFor}
  <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6" role="dialog">
    <div class="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
      <h3 class="font-medium text-white">Realign cues for v{realignFor.version_number}</h3>
      <p class="mt-1 text-sm text-neutral-400">
        This version's duration differs from the active one. Choose how existing cue times should map onto it.
      </p>
      <div class="mt-4 flex flex-col gap-2">
        <label class="flex items-start gap-2 text-sm text-neutral-200">
          <input type="radio" bind:group={strategy} value="keep" class="mt-1" />
          <span><strong>Keep times</strong> — markers stay at the same absolute seconds (best for trims / re-bounces).</span>
        </label>
        <label class="flex items-start gap-2 text-sm text-neutral-200">
          <input type="radio" bind:group={strategy} value="scale" class="mt-1" />
          <span><strong>Proportional scale</strong> — stretch/squash to the new length (best for tempo changes).</span>
        </label>
        <label class="flex items-start gap-2 text-sm text-neutral-200">
          <input type="radio" bind:group={strategy} value="offset" class="mt-1" />
          <span><strong>Shift by offset</strong> — move every marker by a fixed amount (best for an added intro).</span>
        </label>
        {#if strategy === 'offset'}
          <label class="ml-6 flex items-center gap-2 text-xs text-neutral-400">
            Offset (s)
            <input type="number" step="0.1" bind:value={offset} class="w-24 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-white" />
          </label>
        {/if}
      </div>
      <div class="mt-5 flex justify-end gap-2">
        <button onclick={() => (realignFor = null)} class="rounded-lg px-3 py-2 text-sm text-neutral-400 hover:text-white">Cancel</button>
        <button disabled={busy} onclick={() => activate(realignFor!, strategy, offset)} class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
          Activate
        </button>
      </div>
    </div>
  </div>
{/if}
