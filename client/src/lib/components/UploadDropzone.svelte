<script lang="ts">
  import { uploadTrackVersion } from '$lib/upload/presignedUpload';
  import { estimateInstantBpm } from '$lib/waveform/instantBpm';
  import { api } from '$lib/api';
  import { ui } from '$lib/stores/ui.svelte';

  let {
    projectId,
    trackId,
    label = 'Drop an audio or video file, or click to browse',
    onUploaded,
  }: {
    projectId: string;
    trackId: string;
    label?: string;
    onUploaded?: () => void;
  } = $props();

  let dragging = $state(false);
  let uploading = $state(false);
  let progress = $state(0);
  let input: HTMLInputElement;

  async function handle(file: File) {
    if (!file) return;
    if (!/^(audio|video)\//.test(file.type)) {
      ui.toast('Only audio or video files are supported', 'error');
      return;
    }
    uploading = true;
    progress = 0;
    try {
      const version = await uploadTrackVersion(projectId, trackId, file, { onProgress: (p) => (progress = p) });
      ui.toast('Uploaded — processing waveform', 'success');
      onUploaded?.();
      // Phase 5e: instant provisional BPM (audio only, best-effort; BeatNet overwrites).
      estimateInstantBpm(file)
        .then((bpm) => bpm && api.patch(`/projects/${projectId}/tracks/${trackId}/versions/${version.id}/bpm`, { bpm }).catch(() => {}))
        .catch(() => {});
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    } finally {
      uploading = false;
      progress = 0;
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) handle(file);
  }
</script>

<div
  role="button"
  tabindex="0"
  class="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition
    {dragging ? 'border-indigo-500 bg-indigo-500/5' : 'border-neutral-700 hover:border-neutral-500'}"
  ondragover={(e) => { e.preventDefault(); dragging = true; }}
  ondragleave={() => (dragging = false)}
  ondrop={onDrop}
  onclick={() => input.click()}
  onkeydown={(e) => e.key === 'Enter' && input.click()}
>
  {#if uploading}
    <p class="text-sm text-neutral-300">Uploading… {Math.round(progress * 100)}%</p>
    <div class="mt-3 h-1.5 w-48 overflow-hidden rounded-full bg-neutral-800">
      <div class="h-full bg-indigo-500 transition-all" style="width: {progress * 100}%"></div>
    </div>
  {:else}
    <svg class="mb-2 h-6 w-6 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 16V4m0 0L8 8m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
    </svg>
    <p class="text-sm text-neutral-400">{label}</p>
  {/if}
  <input
    bind:this={input}
    type="file"
    accept="audio/*,video/*"
    class="hidden"
    onchange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) handle(f); input.value = ''; }}
  />
</div>
