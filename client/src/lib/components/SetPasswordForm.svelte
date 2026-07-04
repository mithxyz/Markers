<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { api, type User } from '$lib/api';
  import { auth } from '$lib/stores/auth.svelte';

  let { endpoint, title, cta }: { endpoint: string; title: string; cta: string } = $props();

  let token = $state('');
  let password = $state('');
  let confirm = $state('');
  let loading = $state(false);
  let error = $state('');

  onMount(() => {
    token = $page.url.searchParams.get('token') || '';
    if (!token) error = 'Missing or invalid link.';
  });

  async function submit(e: Event) {
    e.preventDefault();
    error = '';
    if (password.length < 8) {
      error = 'Password must be at least 8 characters.';
      return;
    }
    if (password !== confirm) {
      error = 'Passwords do not match.';
      return;
    }
    loading = true;
    try {
      const { user, redirectTo } = await api.post<{ user: User; redirectTo: string | null }>(endpoint, {
        token,
        password,
      });
      auth.user = user;
      goto(redirectTo || '/projects', { replaceState: true });
    } catch (err) {
      error = (err as Error).message;
      loading = false;
    }
  }
</script>

<main class="flex min-h-screen items-center justify-center p-6">
  <div class="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900/60 p-8">
    <h1 class="text-2xl font-semibold tracking-tight text-white">cue</h1>
    <p class="mt-1 text-sm text-neutral-400">{title}</p>

    <form class="mt-6 flex flex-col gap-3" onsubmit={submit}>
      <label class="text-xs font-medium text-neutral-400" for="password">New password</label>
      <input
        id="password"
        type="password"
        bind:value={password}
        required
        autocomplete="new-password"
        placeholder="At least 8 characters"
        class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
      />
      <label class="text-xs font-medium text-neutral-400" for="confirm">Confirm password</label>
      <input
        id="confirm"
        type="password"
        bind:value={confirm}
        required
        autocomplete="new-password"
        placeholder="Re-enter password"
        class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
      />

      {#if error}
        <p class="text-xs text-red-400">{error}</p>
      {/if}

      <button
        type="submit"
        disabled={loading || !token}
        class="mt-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
      >
        {loading ? 'Saving…' : cta}
      </button>
    </form>

    <a href="/login" class="mt-4 inline-block text-xs text-indigo-400 hover:underline">Back to sign in</a>
  </div>
</main>
