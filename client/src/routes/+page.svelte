<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { auth } from '$lib/stores/auth.svelte';

  onMount(() => {
    goto(auth.user ? '/projects' : '/login', { replaceState: true });
  });
</script>

<div class="flex min-h-screen items-center justify-center text-sm text-neutral-500">Redirecting…</div>
