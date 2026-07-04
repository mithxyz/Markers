<script lang="ts">
  import type { Track } from '$lib/types';
  import { api } from '$lib/api';
  import { ui } from '$lib/stores/ui.svelte';
  import { uploadTrackVersion } from '$lib/upload/presignedUpload';
  import { classifyFile, cleanTrackName, type FileMatch, type MatchKind } from '$lib/importMatch';

  let {
    projectId,
    existingTracks = [],
    canUpload = false,
    onClose,
    onComplete,
  }: {
    projectId: string;
    existingTracks?: Track[];
    canUpload?: boolean;
    onClose?: () => void;
    onComplete?: () => void;
  } = $props();

  const MAX_IMPORT = 100;

  // --- Step 1: file picking ---
  type Action = 'new_track' | 'new_version' | 'skip';

  interface RowState {
    file: File;
    match: FileMatch;
    action: Action;
    targetTrackId: string | null; // for new_version
    // commit state
    status: 'pending' | 'uploading' | 'done' | 'failed';
    progress: number; // 0..1
    error: string | null;
  }

  let rows = $state<RowState[]>([]);
  let committing = $state(false);
  let committed = $state(false);
  let summary = $state('');

  function defaultAction(kind: MatchKind): Action {
    if (kind === 'possible_duplicate') return 'skip';
    if (kind === 'possible_version') return 'new_version';
    return 'new_track';
  }

  function buildRows(files: File[]): RowState[] {
    return files.map((file) => {
      const match = classifyFile(file, existingTracks);
      return {
        file,
        match,
        action: defaultAction(match.kind),
        targetTrackId: match.track?.id ?? null,
        status: 'pending',
        progress: 0,
        error: null,
      };
    });
  }

  function onFileInput(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files) return;
    addFiles(Array.from(input.files));
    input.value = '';
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
    if (!e.dataTransfer?.files) return;
    addFiles(Array.from(e.dataTransfer.files));
  }

  function addFiles(files: File[]) {
    const media = files.filter((f) => /^(audio|video)\//.test(f.type));
    const rejected = files.length - media.length;
    if (rejected > 0) ui.toast(`${rejected} non-audio/video file(s) skipped`, 'error');

    const total = rows.length + media.length;
    if (total > MAX_IMPORT) {
      ui.toast(`Max ${MAX_IMPORT} files per batch. ${total - MAX_IMPORT} file(s) dropped.`, 'error');
      rows = [...rows, ...buildRows(media.slice(0, MAX_IMPORT - rows.length))];
    } else {
      rows = [...rows, ...buildRows(media)];
    }
  }

  let isDragging = $state(false);

  // --- Commit ---

  async function commit() {
    committing = true;
    let imported = 0, versioned = 0, skipped = 0, failed = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.action === 'skip') { skipped++; continue; }

      rows[i] = { ...rows[i], status: 'uploading', progress: 0 };

      try {
        if (row.action === 'new_track') {
          const name = cleanTrackName(row.file.name);
          const kind = row.file.type.startsWith('video/') ? 'video' : 'audio';
          const { track } = await api.post<{ track: Track }>(`/projects/${projectId}/tracks`, { name, kind });
          await uploadTrackVersion(projectId, track.id, row.file, {
            onProgress: (p) => { rows[i] = { ...rows[i], progress: p }; },
          });
          imported++;
        } else {
          // new_version
          const targetId = row.targetTrackId ?? row.match.track?.id;
          if (!targetId) throw new Error('No target track selected');
          await uploadTrackVersion(projectId, targetId, row.file, {
            onProgress: (p) => { rows[i] = { ...rows[i], progress: p }; },
          });
          versioned++;
        }
        rows[i] = { ...rows[i], status: 'done', progress: 1 };
      } catch (e) {
        rows[i] = { ...rows[i], status: 'failed', error: (e as Error).message };
        failed++;
      }
    }

    committing = false;
    committed = true;
    summary = [
      imported > 0 && `${imported} track${imported === 1 ? '' : 's'} imported`,
      versioned > 0 && `${versioned} version${versioned === 1 ? '' : 's'} added`,
      skipped > 0 && `${skipped} skipped`,
      failed > 0 && `${failed} failed`,
    ].filter(Boolean).join(', ');

    if (failed === 0) {
      onComplete?.();
    }
  }

  async function retryFailed() {
    committed = false;
    committing = true;
    let fixed = 0, stillFailed = 0;

    for (let i = 0; i < rows.length; i++) {
      if (rows[i].status !== 'failed') continue;
      const row = rows[i];
      rows[i] = { ...rows[i], status: 'uploading', progress: 0, error: null };
      try {
        if (row.action === 'new_track') {
          const name = cleanTrackName(row.file.name);
          const kind = row.file.type.startsWith('video/') ? 'video' : 'audio';
          const { track } = await api.post<{ track: Track }>(`/projects/${projectId}/tracks`, { name, kind });
          await uploadTrackVersion(projectId, track.id, row.file, {
            onProgress: (p) => { rows[i] = { ...rows[i], progress: p }; },
          });
        } else {
          const targetId = row.targetTrackId ?? row.match.track?.id;
          if (!targetId) throw new Error('No target track selected');
          await uploadTrackVersion(projectId, targetId, row.file, {
            onProgress: (p) => { rows[i] = { ...rows[i], progress: p }; },
          });
        }
        rows[i] = { ...rows[i], status: 'done', progress: 1 };
        fixed++;
      } catch (e) {
        rows[i] = { ...rows[i], status: 'failed', error: (e as Error).message };
        stillFailed++;
      }
    }

    committing = false;
    committed = true;
    summary = stillFailed === 0 ? `${fixed} retry${fixed === 1 ? '' : 's'} succeeded` : `${fixed} fixed, ${stillFailed} still failed`;
    if (stillFailed === 0) onComplete?.();
  }

  const pendingCount = $derived(rows.filter((r) => r.action !== 'skip').length);
  const failedCount = $derived(rows.filter((r) => r.status === 'failed').length);
  const allDone = $derived(rows.length > 0 && rows.every((r) => r.status === 'done' || r.action === 'skip' || r.status === 'failed'));

  const KIND_LABEL: Record<MatchKind, string> = {
    new_track: 'New track',
    possible_version: 'Possible new version',
    possible_duplicate: 'Possible duplicate',
  };
  const KIND_COLOR: Record<MatchKind, string> = {
    new_track: 'text-sky-400 bg-sky-950/40 border-sky-800/40',
    possible_version: 'text-amber-400 bg-amber-950/40 border-amber-800/40',
    possible_duplicate: 'text-red-400 bg-red-950/40 border-red-800/40',
  };

  function fmtSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
</script>

<!-- Modal backdrop -->
<div
  class="fixed inset-0 z-40 flex items-start justify-center bg-black/70 p-4 pt-16 overflow-y-auto"
  role="dialog"
  aria-modal="true"
>
  <div class="w-full max-w-3xl rounded-2xl border border-neutral-800 bg-neutral-900 shadow-2xl">

    <!-- Header -->
    <div class="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
      <h2 class="text-base font-semibold text-white">Import tracks</h2>
      <button onclick={onClose} class="text-neutral-400 hover:text-white text-lg leading-none">✕</button>
    </div>

    <!-- Drop zone (shown until rows exist) -->
    {#if rows.length === 0}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="m-6 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-16 transition
          {isDragging ? 'border-indigo-500 bg-indigo-950/20' : 'border-neutral-700 bg-neutral-950/40 hover:border-neutral-600'}"
        ondragover={(e) => { e.preventDefault(); isDragging = true; }}
        ondragleave={() => (isDragging = false)}
        ondrop={onDrop}
      >
        <span class="text-4xl">🎵</span>
        <p class="text-sm text-neutral-400">Drop audio or video files here, or</p>
        <label class="cursor-pointer rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
          Choose files
          <input type="file" multiple accept="audio/*,video/*" class="hidden" onchange={onFileInput} />
        </label>
        <p class="text-xs text-neutral-600">Up to {MAX_IMPORT} files at once</p>
      </div>
    {:else}
      <!-- File review table -->
      <div class="px-6 pb-2 pt-4">
        <div class="mb-2 flex items-center justify-between">
          <p class="text-sm text-neutral-400">{rows.length} file{rows.length === 1 ? '' : 's'} ready to review</p>
          {#if !committing && !committed}
            <label class="cursor-pointer text-xs text-indigo-400 hover:text-indigo-300">
              + Add more
              <input type="file" multiple accept="audio/*,video/*" class="hidden" onchange={onFileInput} />
            </label>
          {/if}
        </div>

        <div class="overflow-hidden rounded-xl border border-neutral-800 text-sm">
          <!-- Table header -->
          <div class="grid items-center border-b border-neutral-800 bg-neutral-950 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500"
            style="grid-template-columns: 1fr 5rem 10rem 10rem {committing || committed ? '5rem' : ''}">
            <span>File</span>
            <span>Size</span>
            <span>Classification</span>
            <span>Action</span>
            {#if committing || committed}<span>Status</span>{/if}
          </div>

          <div class="max-h-96 overflow-y-auto">
            {#each rows as row, i (row.file.name + i)}
              <div class="grid items-center border-b border-neutral-900 px-3 py-2 last:border-0
                {row.status === 'failed' ? 'bg-red-950/10' : row.status === 'done' ? 'bg-emerald-950/10' : ''}"
                style="grid-template-columns: 1fr 5rem 10rem 10rem {committing || committed ? '5rem' : ''}">

                <!-- Filename -->
                <div class="min-w-0">
                  <p class="truncate text-sm text-white">{row.file.name}</p>
                  {#if row.match.track && row.action !== 'new_track'}
                    <p class="truncate text-[11px] text-neutral-500">→ {row.match.track.name}</p>
                  {/if}
                </div>

                <!-- Size -->
                <span class="text-xs text-neutral-500">{fmtSize(row.file.size)}</span>

                <!-- Classification badge -->
                <span class="rounded border px-1.5 py-0.5 text-[10px] font-medium {KIND_COLOR[row.match.kind]}">
                  {KIND_LABEL[row.match.kind]}
                  {#if row.match.sizeMatch} · size match{/if}
                </span>

                <!-- Action dropdown -->
                {#if !committing && !committed}
                  <select
                    class="rounded border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 text-xs text-neutral-200 outline-none focus:border-indigo-500"
                    bind:value={rows[i].action}
                  >
                    <option value="new_track">New track</option>
                    {#if existingTracks.length > 0}
                      <option value="new_version">New version of…</option>
                    {/if}
                    <option value="skip">Skip</option>
                  </select>

                  <!-- Target track picker for new_version -->
                  {#if rows[i].action === 'new_version'}
                    <select
                      class="col-span-1 mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 text-xs text-neutral-200 outline-none focus:border-indigo-500"
                      bind:value={rows[i].targetTrackId}
                      style="grid-column: 4 / span 1"
                    >
                      {#each existingTracks as t (t.id)}
                        <option value={t.id}>{t.name}</option>
                      {/each}
                    </select>
                  {/if}
                {:else}
                  <!-- committed / committing: show action as text -->
                  <span class="text-xs text-neutral-500">
                    {rows[i].action === 'skip' ? 'Skipped' : rows[i].action === 'new_track' ? 'New track' : 'New version'}
                  </span>
                {/if}

                <!-- Status column (only when committing/committed) -->
                {#if committing || committed}
                  <div class="flex items-center gap-1.5 text-xs">
                    {#if row.status === 'pending'}
                      <span class="text-neutral-600">—</span>
                    {:else if row.status === 'uploading'}
                      <div class="h-1 w-12 overflow-hidden rounded-full bg-neutral-700">
                        <div class="h-full bg-indigo-500 transition-all" style="width: {row.progress * 100}%"></div>
                      </div>
                    {:else if row.status === 'done'}
                      <span class="text-emerald-400">✓</span>
                    {:else if row.status === 'failed'}
                      <span class="text-red-400" title={row.error ?? ''}>✗ {row.error?.slice(0, 30)}</span>
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-between border-t border-neutral-800 px-6 py-4">
        <div class="text-sm text-neutral-400">
          {#if committed}
            <span class={failedCount > 0 ? 'text-amber-400' : 'text-emerald-400'}>{summary}</span>
          {:else}
            {pendingCount} file{pendingCount === 1 ? '' : 's'} to import
          {/if}
        </div>
        <div class="flex items-center gap-3">
          <button onclick={onClose} class="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-500">
            {committed && failedCount === 0 ? 'Close' : 'Cancel'}
          </button>
          {#if committed && failedCount > 0}
            <button
              onclick={retryFailed}
              disabled={committing}
              class="rounded-lg border border-amber-700 px-3 py-1.5 text-sm text-amber-300 hover:border-amber-500 disabled:opacity-50"
            >Retry {failedCount} failed</button>
          {/if}
          {#if !committed}
            <button
              onclick={commit}
              disabled={committing || pendingCount === 0 || !canUpload}
              class="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >{committing ? 'Importing…' : `Import ${pendingCount} file${pendingCount === 1 ? '' : 's'}`}</button>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>
