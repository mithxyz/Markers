<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { auth } from '$lib/stores/auth.svelte';
  import Toasts from '$lib/components/Toasts.svelte';

  let { children } = $props();

  onMount(() => {
    auth.load();
  });
</script>

{#if auth.loaded}
  {@render children()}
{:else}
  <div class="flex min-h-screen items-center justify-center text-sm text-neutral-500">Loading…</div>
{/if}

<Toasts />
