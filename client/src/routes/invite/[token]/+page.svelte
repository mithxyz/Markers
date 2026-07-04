<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { api } from '$lib/api';
  import { auth } from '$lib/stores/auth.svelte';
  import { ui } from '$lib/stores/ui.svelte';

  interface InvitePreview {
    project_name: string;
    inviter: string | null;
    role: string;
    email: string | null;
    valid: boolean;
  }

  let invite = $state<InvitePreview | null>(null);
  let error = $state('');
  let accepting = $state(false);
  let starting = $state(false);
  let email = $state('');
  let sent = $state(false);
  const token = $page.params.token;

  onMount(async () => {
    try {
      const { invite: inv } = await api.get<{ invite: InvitePreview }>(`/invites/${token}`);
      invite = inv;
      if (inv.email) email = inv.email;
    } catch (e) {
      error = (e as Error).message;
    }
  });

  // Logged-in: accept directly.
  async function accept() {
    accepting = true;
    try {
      const { projectId } = await api.post<{ projectId: string }>(`/invites/${token}/accept`);
      ui.toast('Joined project', 'success');
      goto(`/projects/${projectId}`);
    } catch (e) {
      ui.toast((e as Error).message, 'error');
      accepting = false;
    }
  }

  // Logged-out: bootstrap an account (or get sent to sign in).
  async function start(e: Event) {
    e.preventDefault();
    starting = true;
    error = '';
    try {
      const { action, redirectTo } = await api.post<{ action: string; redirectTo: string }>(
        `/invites/${token}/start`,
        { email: email.trim() }
      );
      if (action === 'login') {
        goto(`/login?redirectTo=${encodeURIComponent(redirectTo)}`);
      } else {
        sent = true;
      }
    } catch (e) {
      error = (e as Error).message;
      starting = false;
    }
  }
</script>

<main class="flex min-h-screen items-center justify-center p-6">
  <div class="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900/60 p-8 text-center">
    {#if error}
      <p class="text-sm text-red-400">{error}</p>
      <a href="/projects" class="mt-3 inline-block text-sm text-indigo-400 hover:underline">Go to projects</a>
    {:else if invite}
      {#if !invite.valid}
        <p class="text-sm text-neutral-400">This invite has expired or already been used.</p>
        <a href="/projects" class="mt-3 inline-block text-sm text-indigo-400 hover:underline">Go to projects</a>
      {:else if sent}
        <div class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
          Check your email — we sent a link to set your password and join
          <strong>{invite.project_name}</strong>.
        </div>
      {:else}
        <h1 class="text-lg font-semibold text-white">You're invited</h1>
        <p class="mt-2 text-sm text-neutral-400">
          {invite.inviter || 'Someone'} invited you to <strong class="text-white">{invite.project_name}</strong>
          as <strong class="text-white">{invite.role}</strong>.
        </p>

        {#if auth.user}
          <button
            onclick={accept}
            disabled={accepting}
            class="mt-6 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {accepting ? 'Joining…' : 'Accept invite'}
          </button>
        {:else}
          <form class="mt-6 flex flex-col gap-3 text-left" onsubmit={start}>
            <label class="text-xs font-medium text-neutral-400" for="email">Your email</label>
            <input
              id="email"
              type="email"
              bind:value={email}
              required
              readonly={!!invite.email}
              placeholder="you@example.com"
              class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500 read-only:opacity-70"
            />
            <button
              type="submit"
              disabled={starting}
              class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {starting ? 'Working…' : 'Continue'}
            </button>
            <a href={`/login?redirectTo=${encodeURIComponent(`/invite/${token}`)}`} class="text-center text-xs text-indigo-400 hover:underline">
              Already have an account? Sign in
            </a>
          </form>
        {/if}
      {/if}
    {:else}
      <p class="text-sm text-neutral-500">Loading invite…</p>
    {/if}
  </div>
</main>
