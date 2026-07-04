<script lang="ts">
  import { onDestroy, setContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { auth } from '$lib/stores/auth.svelte';
  import { ProjectStore, PROJECT_CTX } from '$lib/stores/project.svelte';

  let { children } = $props();

  // One store for the whole /projects/[id] subtree — shared with overview / track /
  // settings pages via context, so navigating between them never refetches.
  const store = new ProjectStore();
  setContext(PROJECT_CTX, store);

  // Root layout only renders once auth is loaded, so auth.user is final here.
  $effect(() => {
    const id = $page.params.id;
    if (!auth.user) {
      goto(`/login?redirectTo=${encodeURIComponent($page.url.pathname)}`, { replaceState: true });
      return;
    }
    if (id) store.init(id);
  });

  onDestroy(() => store.teardown());
</script>

{#if store.loading}
  <p class="px-6 py-10 text-sm text-neutral-500">Loading…</p>
{:else if store.error}
  <div class="px-6 py-10">
    <p class="text-sm text-red-400">{store.error}</p>
    <a href="/projects" class="mt-2 inline-block text-sm text-neutral-400 hover:text-white">← Back to projects</a>
  </div>
{:else}
  {@render children()}
{/if}
