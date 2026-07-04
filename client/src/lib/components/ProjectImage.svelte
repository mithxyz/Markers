<script lang="ts">
  import { getContext } from 'svelte';
  import { ProjectStore, PROJECT_CTX } from '$lib/stores/project.svelte';
  import { uploadProjectImage } from '$lib/upload/presignedUpload';
  import { api } from '$lib/api';
  import { ui } from '$lib/stores/ui.svelte';

  let { editable = false, class: cls = 'aspect-[16/9] w-full' }: { editable?: boolean; class?: string } = $props();
  const store = getContext<ProjectStore>(PROJECT_CTX);
  let busy = $state(false);

  async function onFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    busy = true;
    try {
      store.imageUrl = await uploadProjectImage(store.id, file);
      ui.toast('Project image updated', 'success');
    } catch (err) {
      ui.toast((err as Error).message, 'error');
    } finally {
      busy = false;
      input.value = '';
    }
  }
  async function remove() {
    busy = true;
    try {
      await api.del(`/projects/${store.id}/image`);
      store.imageUrl = null;
    } catch (err) {
      ui.toast((err as Error).message, 'error');
    } finally {
      busy = false;
    }
  }
</script>

<div class="group relative overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/40 {cls}">
  {#if store.imageUrl}
    <img src={store.imageUrl} alt={store.project?.name ?? 'project'} class="h-full w-full object-cover" />
  {:else}
    <div class="flex h-full w-full items-center justify-center text-neutral-700">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>
    </div>
  {/if}
  {#if editable}
    <div class="absolute bottom-2 right-2 flex gap-1.5 opacity-0 transition group-hover:opacity-100">
      <label class="cursor-pointer rounded-md bg-black/70 px-2 py-1 text-xs text-white hover:bg-black">
        {busy ? '…' : store.imageUrl ? 'Replace' : 'Add image'}
        <input type="file" accept="image/*" class="hidden" onchange={onFile} disabled={busy} />
      </label>
      {#if store.imageUrl}
        <button onclick={remove} disabled={busy} class="rounded-md bg-black/70 px-2 py-1 text-xs text-white hover:bg-black">Remove</button>
      {/if}
    </div>
  {/if}
</div>
