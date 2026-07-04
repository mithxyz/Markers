<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { api, type Project, type ProjectType } from '$lib/api';
  import type { Track } from '$lib/types';
  import { currentVersion } from '$lib/types';
  import { ui } from '$lib/stores/ui.svelte';
  import { ProjectStore, PROJECT_CTX } from '$lib/stores/project.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';
  import PresenceBar from '$lib/components/PresenceBar.svelte';
  import ProjectImage from '$lib/components/ProjectImage.svelte';
  import TrackListView from '$lib/components/TrackListView.svelte';
  import BatchImportModal from '$lib/components/BatchImportModal.svelte';
  import PlaylistsPanel from '$lib/components/PlaylistsPanel.svelte';
  import { fmtDuration } from '$lib/format';

  const store = getContext<ProjectStore>(PROJECT_CTX);
  const TYPE_LABEL: Record<ProjectType, string> = { dj: 'DJ / festival', dance: 'Dance / choreo', general: 'General' };

  // 10-views: grid ⇄ list toggle, persisted to localStorage
  let view = $state<'grid' | 'list'>('grid');
  let showBatchImport = $state(false);

  onMount(() => {
    if (browser) {
      const saved = localStorage.getItem('cue.trackView');
      if (saved === 'list' || saved === 'grid') view = saved;
    }
  });

  $effect(() => {
    if (browser) localStorage.setItem('cue.trackView', view);
  });

  let newTrackName = $state('');
  let importing = $state(false);
  let rbPlaylists = $state<{ path: string; trackCount: number }[] | null>(null);
  let rbTotalTracks = $state(0);
  let rbPendingText = $state('');
  let rbSelectedPlaylist = $state('');
  let showShare = $state(false);
  let inviteRoleId = $state('');
  let inviteUrl = $state('');
  let shareLink = $state<{ token: string; url: string } | null>(null);
  let shareLoading = $state(false);
  let exportOpen = $state(false);

  const EXPORT_OPTIONS = $derived([
    { format: 'csv', label: 'Cue list (CSV)' },
    { format: 'reaper', label: 'Reaper project (.rpp)' },
    { format: 'markers-csv', label: 'Video markers (CSV)' },
    { format: 'fcpxml', label: 'Final Cut markers (FCPXML)' },
    { format: 'console-csv', label: 'Lighting / laser cue list (CSV)' },
    ...(store.project?.type === 'dance'
      ? [{ format: 'formations-csv', label: 'Formations (CSV)' }, { format: 'formations-json', label: 'Formations (JSON)' }]
      : []),
  ]);
  const exportHref = (format: string) => `/api/v1/projects/${store.id}/export?format=${format}`;

  async function changeType(type: ProjectType) {
    if (!store.project || type === store.project.type) return;
    try {
      const { project } = await api.patch<{ project: Project }>(`/projects/${store.id}`, { type });
      store.project = project;
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  async function addTrack() {
    const name = newTrackName.trim() || 'Untitled track';
    try {
      const { track } = await api.post<{ track: Track }>(`/projects/${store.id}/tracks`, { name, kind: 'audio' });
      newTrackName = '';
      await store.loadTracks();
      goto(`/projects/${store.id}/track/${track.id}`);
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  async function deleteTrack(t: Track, e: Event) {
    e.stopPropagation();
    if (!confirm(`Delete track "${t.name}"?`)) return;
    try {
      await api.del(`/projects/${store.id}/tracks/${t.id}`);
      await store.loadTracks();
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }

  async function importRekordbox(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';
    importing = true;
    try {
      const text = await file.text();
      const res = await fetch(`/api/v1/projects/${store.id}/imports/rekordbox?listPlaylists=1`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/xml' }, body: text,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      if (data.playlists?.length) {
        // Let the user choose a single playlist instead of importing the whole collection.
        rbPendingText = text;
        rbPlaylists = data.playlists;
        rbTotalTracks = data.totalTracks;
        rbSelectedPlaylist = '';
      } else {
        await runRekordboxImport(text, null);
      }
    } catch (err) {
      ui.toast((err as Error).message, 'error');
    } finally {
      importing = false;
    }
  }

  async function runRekordboxImport(text: string, playlist: string | null) {
    importing = true;
    try {
      const qs = playlist ? `?playlist=${encodeURIComponent(playlist)}` : '';
      const res = await fetch(`/api/v1/projects/${store.id}/imports/rekordbox${qs}`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/xml' }, body: text,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      const extra = data.totalInFile > data.imported ? ` (first ${data.imported} of ${data.totalInFile})` : '';
      const parts = [`${data.tracksCreated} new`];
      if (data.tracksUpdated) parts.push(`${data.tracksUpdated} updated`);
      ui.toast(`Imported: ${parts.join(', ')} tracks, ${data.cuesCreated} cues${extra}.`, 'success');
      await store.loadProject();
      await store.loadTracks();
    } catch (err) {
      ui.toast((err as Error).message, 'error');
    } finally {
      importing = false;
      rbPlaylists = null;
      rbPendingText = '';
    }
  }

  function confirmRekordboxImport() {
    runRekordboxImport(rbPendingText, rbSelectedPlaylist || null);
  }

  function cancelRekordboxImport() {
    rbPlaylists = null;
    rbPendingText = '';
  }

  async function openShare() {
    showShare = true;
    inviteRoleId ||= store.roles.find((r) => r.is_default)?.id || store.roles[0]?.id || '';
    if (store.can('manage_project')) {
      try {
        const { share } = await api.get<{ share: { token: string; url: string } | null }>(`/projects/${store.id}/share`);
        shareLink = share;
      } catch { shareLink = null; }
    }
  }
  async function createPublicLink() {
    shareLoading = true;
    try { shareLink = (await api.post<{ share: { token: string; url: string } }>(`/projects/${store.id}/share`, {})).share; }
    catch (e) { ui.toast((e as Error).message, 'error'); } finally { shareLoading = false; }
  }
  async function disablePublicLink() {
    shareLoading = true;
    try { await api.del(`/projects/${store.id}/share`); shareLink = null; }
    catch (e) { ui.toast((e as Error).message, 'error'); } finally { shareLoading = false; }
  }
  async function createInvite() {
    try { inviteUrl = (await api.post<{ url: string }>(`/projects/${store.id}/invites`, { role_id: inviteRoleId })).url; }
    catch (e) { ui.toast((e as Error).message, 'error'); }
  }
  const copy = (s: string) => { navigator.clipboard.writeText(s); ui.toast('Copied', 'success'); };
</script>

{#if store.project}
  {@const p = store.project}
  <div class="mx-auto w-full max-w-5xl px-6 py-8">
    <header class="flex items-center justify-between border-b border-neutral-800 pb-4">
      <div class="flex items-center gap-3">
        <a href="/projects" class="text-sm text-neutral-500 hover:text-white">← Projects</a>
        <h1 class="text-xl font-semibold text-white">{p.name}</h1>
        <span class="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400">{p.role}</span>
        <span class="rounded-full border border-neutral-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">{TYPE_LABEL[p.type]}</span>
      </div>
      <div class="flex items-center gap-3">
        <PresenceBar online={store.online} />
        <div class="relative">
          <button onclick={() => (exportOpen = !exportOpen)} class="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:border-indigo-500">Export ▾</button>
          {#if exportOpen}
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <div class="fixed inset-0 z-30" onclick={() => (exportOpen = false)}></div>
            <div class="absolute right-0 z-40 mt-1 w-60 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl">
              {#each EXPORT_OPTIONS as o (o.format)}
                <a href={exportHref(o.format)} download onclick={() => (exportOpen = false)} class="block px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800">{o.label}</a>
              {/each}
            </div>
          {/if}
        </div>
        {#if store.can('create_invites') || store.can('manage_members') || store.can('manage_project')}
          <button onclick={openShare} class="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:border-indigo-500">Share</button>
        {/if}
        <a href="/projects/{store.id}/settings" class="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:border-indigo-500">Settings</a>
      </div>
    </header>

    <!-- Details + image -->
    <div class="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-[2fr_3fr]">
      <ProjectImage editable={store.can('manage_project')} />
      <div>
        {#if store.can('manage_project')}
          <label class="text-[11px] text-neutral-500">Type
            <select value={p.type} onchange={(e) => changeType(e.currentTarget.value as ProjectType)} class="ml-2 rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-xs text-neutral-200 outline-none focus:border-indigo-500">
              <option value="general">General</option><option value="dj">DJ / festival</option><option value="dance">Dance / choreo</option>
            </select>
          </label>
        {/if}
        <p class="mt-2 whitespace-pre-wrap text-sm text-neutral-400">{p.description || 'No description.'}</p>
        <p class="mt-3 text-xs text-neutral-600">{store.tracks.length} track{store.tracks.length === 1 ? '' : 's'} · {store.members.length} member{store.members.length === 1 ? '' : 's'}</p>
      </div>
    </div>

    <!-- Tracks -->
    <section class="mt-8">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-3">
          <h2 class="text-xs font-semibold uppercase tracking-wide text-neutral-500">Tracks</h2>
          <!-- 10-views: grid ⇄ list toggle -->
          <div class="flex overflow-hidden rounded border border-neutral-700">
            <button
              onclick={() => (view = 'grid')}
              class="px-2 py-0.5 text-xs transition {view === 'grid' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'}"
              title="Grid view">⊞</button>
            <button
              onclick={() => (view = 'list')}
              class="px-2 py-0.5 text-xs transition {view === 'list' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'}"
              title="List view">☰</button>
          </div>
        </div>
        {#if store.can('manage_tracks')}
          <div class="flex items-center gap-2">
            {#if p.type !== 'dance'}
              <label class="cursor-pointer rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-indigo-500" title="Import a rekordbox collection.xml">
                {importing ? 'Importing…' : 'Import Rekordbox'}
                <input type="file" accept=".xml,application/xml,text/xml" class="hidden" onchange={importRekordbox} disabled={importing} />
              </label>
              <!-- 10-import: batch upload -->
              <button onclick={() => (showBatchImport = true)} class="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-indigo-500">Import tracks</button>
            {/if}
            <input bind:value={newTrackName} placeholder="New track name" onkeydown={(e) => e.key === 'Enter' && addTrack()} class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500" />
            <button onclick={addTrack} class="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">+ Track</button>
          </div>
        {/if}
      </div>

      {#if rbPlaylists}
        <div class="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900 p-3 text-sm">
          <span class="text-neutral-300">Import from Rekordbox XML:</span>
          <select bind:value={rbSelectedPlaylist} class="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-200 outline-none focus:border-indigo-500">
            <option value="">Entire collection ({rbTotalTracks} tracks)</option>
            {#each rbPlaylists as pl (pl.path)}
              <option value={pl.path}>{pl.path} ({pl.trackCount} tracks)</option>
            {/each}
          </select>
          <button onclick={confirmRekordboxImport} disabled={importing} class="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
            {importing ? 'Importing…' : 'Import'}
          </button>
          <button onclick={cancelRekordboxImport} disabled={importing} class="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-500">
            Cancel
          </button>
        </div>
      {/if}

      {#if store.tracks.length === 0}
        <p class="mt-4 text-sm text-neutral-500">No tracks yet. {store.can('manage_tracks') ? 'Add one to upload audio.' : ''}</p>
      {:else if view === 'list'}
        <!-- 10-views: track list view with inline editing + drag reorder -->
        <TrackListView
          tracks={store.tracks}
          projectId={store.id}
          canEdit={store.can('manage_tracks')}
          onReorder={() => store.loadTracks()}
          onDelete={(t) => deleteTrack(t, new MouseEvent('click'))}
        />
      {:else}
        <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {#each store.tracks as t (t.id)}
            {@const cv = currentVersion(t)}
            <button onclick={() => goto(`/projects/${store.id}/track/${t.id}`)} class="group flex flex-col rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-left transition hover:border-indigo-500/60 hover:bg-neutral-900">
              <div class="flex items-center justify-between gap-2">
                <span class="truncate font-medium text-white">{t.name}</span>
                {#if cv}<StatusPill status={cv.status} />{/if}
              </div>
              <p class="mt-1 truncate text-xs text-neutral-600">{cv?.media_filename || 'No file yet'}</p>
              <div class="mt-3 flex items-center justify-between text-xs text-neutral-500">
                <span>{t.versions.length} version{t.versions.length === 1 ? '' : 's'} · {fmtDuration(cv?.media_duration ?? 0)}</span>
                {#if store.can('manage_tracks')}
                  <span role="button" tabindex="0" onclick={(e) => deleteTrack(t, e)} onkeydown={(e) => e.key === 'Enter' && deleteTrack(t, e)} class="text-neutral-600 opacity-0 transition group-hover:opacity-100 hover:text-red-400">Delete</span>
                {/if}
              </div>
            </button>
          {/each}
        </div>
      {/if}
    </section>

    <!-- 10-playlists: setlists panel -->
    <PlaylistsPanel
      projectId={store.id}
      playlists={store.playlists}
      tracks={store.tracks}
      canEdit={store.can('manage_tracks')}
      onRefresh={() => store.loadPlaylists()}
    />

    <!-- 10-import: batch import modal -->
    {#if showBatchImport}
      <BatchImportModal
        projectId={store.id}
        existingTracks={store.tracks}
        canUpload={store.can('upload_media')}
        onClose={() => (showBatchImport = false)}
        onComplete={() => { showBatchImport = false; store.loadTracks(); }}
      />
    {/if}
  </div>

  {#if showShare}
    <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6" role="dialog">
      <div class="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
        <div class="flex items-center justify-between">
          <h3 class="font-medium text-white">Share project</h3>
          <button onclick={() => { showShare = false; inviteUrl = ''; }} class="text-neutral-500 hover:text-white">✕</button>
        </div>
        {#if store.can('create_invites') || store.can('manage_members')}
          <p class="mt-1 text-sm text-neutral-500">Invite collaborators with an account.</p>
          <div class="mt-3 flex items-center gap-2">
            <select bind:value={inviteRoleId} class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white">
              {#each store.roles as r (r.id)}<option value={r.id}>{r.name}</option>{/each}
            </select>
            <button onclick={createInvite} class="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500">Create invite</button>
          </div>
          {#if inviteUrl}
            <div class="mt-3 flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-950 p-2">
              <input readonly value={inviteUrl} class="flex-1 bg-transparent text-xs text-neutral-300 outline-none" />
              <button onclick={() => copy(inviteUrl)} class="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700">Copy</button>
            </div>
          {/if}
        {/if}
        {#if store.can('manage_project')}
          <div class="mt-5 border-t border-neutral-800 pt-4">
            <h4 class="text-sm font-medium text-white">Public link</h4>
            <p class="mt-1 text-xs text-neutral-500">Anyone with this link can view markers flagged for the public link — no login, read-only.</p>
            {#if shareLink}
              <div class="mt-3 flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-950 p-2">
                <input readonly value={shareLink.url} class="flex-1 bg-transparent text-xs text-neutral-300 outline-none" />
                <button onclick={() => shareLink && copy(shareLink.url)} class="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700">Copy</button>
              </div>
              <div class="mt-2 flex gap-2">
                <button onclick={createPublicLink} disabled={shareLoading} class="text-xs text-neutral-400 hover:text-white disabled:opacity-50">Rotate</button>
                <button onclick={disablePublicLink} disabled={shareLoading} class="text-xs text-neutral-500 hover:text-red-400 disabled:opacity-50">Disable</button>
              </div>
            {:else}
              <button onclick={createPublicLink} disabled={shareLoading} class="mt-3 rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:border-indigo-500 disabled:opacity-50">{shareLoading ? 'Working…' : 'Create public link'}</button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}
{/if}
