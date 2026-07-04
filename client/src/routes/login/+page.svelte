<script lang="ts">
  import { api, type User } from '$lib/api';
  import { auth } from '$lib/stores/auth.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';

  type Mode = 'login' | 'forgot';
  let mode = $state<Mode>('login');
  let email = $state('');
  let password = $state('');
  let loading = $state(false);
  let error = $state('');
  let notice = $state('');

  const redirectTo = () => $page.url.searchParams.get('redirectTo') || undefined;

  async function submit(e: Event) {
    e.preventDefault();
    loading = true;
    error = '';
    notice = '';
    try {
      if (mode === 'login') {
        const { user } = await api.post<{ user: User }>('/auth/login', {
          email: email.trim(),
          password,
        });
        auth.user = user;
        goto(redirectTo() || '/projects', { replaceState: true });
        return;
      }
      const { message } = await api.post<{ message: string }>('/auth/forgot', { email: email.trim() });
      notice = message;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  function switchMode(m: Mode) {
    mode = m;
    error = '';
    notice = '';
    password = '';
  }
</script>

<main class="flex min-h-screen items-center justify-center p-6">
  <div class="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900/60 p-8">
    <h1 class="text-2xl font-semibold tracking-tight text-white">cue</h1>
    <p class="mt-1 text-sm text-neutral-400">Collaborative cue-marker workspace</p>

    {#if notice}
      <div class="mt-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
        {notice}
      </div>
      <button class="mt-4 text-sm text-indigo-400 hover:underline" onclick={() => switchMode('login')}>
        Back to sign in
      </button>
    {:else}
      <form class="mt-6 flex flex-col gap-3" onsubmit={submit}>
        <label class="text-xs font-medium text-neutral-400" for="email">Email address</label>
        <input
          id="email"
          type="email"
          bind:value={email}
          required
          autocomplete="username"
          placeholder="you@example.com"
          class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
        />

        {#if mode === 'login'}
          <label class="text-xs font-medium text-neutral-400" for="password">Password</label>
          <input
            id="password"
            type="password"
            bind:value={password}
            required
            autocomplete="current-password"
            placeholder="••••••••"
            class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
          />
        {/if}

        {#if error}
          <p class="text-xs text-red-400">{error}</p>
        {/if}

        <button
          type="submit"
          disabled={loading}
          class="mt-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {#if loading}
            Working…
          {:else if mode === 'login'}
            Sign in
          {:else}
            Send reset link
          {/if}
        </button>
      </form>

      <div class="mt-4 flex flex-col gap-1 text-xs text-neutral-500">
        {#if mode === 'login'}
          <button class="text-left text-indigo-400 hover:underline" onclick={() => switchMode('forgot')}>
            Forgot password? (or first time — set one)
          </button>
        {:else}
          <button class="text-left text-indigo-400 hover:underline" onclick={() => switchMode('login')}>
            Back to sign in
          </button>
        {/if}
      </div>
    {/if}
  </div>
</main>
