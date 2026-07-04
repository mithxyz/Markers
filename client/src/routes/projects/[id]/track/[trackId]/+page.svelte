<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/stores';
  import { ProjectStore, PROJECT_CTX } from '$lib/stores/project.svelte';
  import { currentVersion } from '$lib/types';
  import ProjectSidebar from '$lib/components/ProjectSidebar.svelte';
  import TrackWorkspace from '$lib/components/TrackWorkspace.svelte';
  import UploadDropzone from '$lib/components/UploadDropzone.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';
  import VersionBar from '$lib/components/VersionBar.svelte';

  const store = getContext<ProjectStore>(PROJECT_CTX);
  const trackId = $derived(($page.params as Record<string, string>).trackId);
  const track = $derived(store.trackById(trackId));
  const cv = $derived(track ? currentVersion(track) : null);
  let uploading = $state(false);
</script>

<div class="flex min-h-screen">
  <ProjectSidebar activeTrackId={trackId} />

  <main class="min-w-0 flex-1 overflow-y-auto p-6">
    {#if !track}
      <p class="text-sm text-neutral-500">Track not found. <a href="/projects/{store.id}" class="text-indigo-400 hover:text-indigo-300">Back to overview</a></p>
    {:else}
      <header class="mb-4 flex items-center justify-between border-b border-neutral-800 pb-3">
        <div class="flex items-center gap-3">
          <h1 class="text-lg font-semibold text-white">{track.name}</h1>
          {#if cv}<StatusPill status={cv.status} />{/if}
          <span class="text-xs text-neutral-600">{track.versions.length} version{track.versions.length === 1 ? '' : 's'}</span>
        </div>
        {#if store.can('upload_media') && cv}
          <button onclick={() => (uploading = !uploading)} class="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-indigo-500">{uploading ? 'Cancel' : 'New version'}</button>
        {/if}
      </header>

      {#if store.can('upload_media') && (uploading || !cv)}
        <div class="mb-4">
          <UploadDropzone
            projectId={store.id}
            trackId={track.id}
            label={cv ? 'Upload a new version of this track' : 'Drop an audio/video file, or click to browse'}
            onUploaded={async () => { uploading = false; await store.loadTracks(); }}
          />
        </div>
      {/if}

      {#if cv?.status === 'ready'}
        {#key cv.id}
          <TrackWorkspace
            projectId={store.id}
            {track}
            canEdit={store.can('create_cues')}
            capabilities={store.project?.capabilities ?? []}
            privileged={store.privileged}
            departments={store.departments}
            myDepartmentIds={store.myDepartmentIds}
            dancers={store.dancers}
            formations={store.formations}
            stage={store.stage}
            projectType={store.project?.type ?? 'general'}
            onTrackChanged={() => store.loadTracks()}
          />
        {/key}
      {:else if cv}
        <p class="text-sm text-neutral-500">This version is {cv.status}. The workspace opens when processing finishes.</p>
        {#if track.versions.length > 1}
          <div class="mt-4">
            <VersionBar
              projectId={store.id}
              {track}
              canEdit={store.can('manage_versions')}
              onChanged={() => store.loadTracks()}
            />
          </div>
        {/if}
      {/if}
    {/if}
  </main>
</div>
