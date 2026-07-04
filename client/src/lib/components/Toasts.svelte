<script lang="ts">
  import { ui } from '$lib/stores/ui.svelte';
</script>

<div class="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
  {#each ui.toasts as t (t.id)}
    <div
      class="pointer-events-auto rounded-lg border px-4 py-2 text-sm shadow-lg backdrop-blur
        {t.kind === 'error'
        ? 'border-red-500/40 bg-red-500/15 text-red-200'
        : t.kind === 'success'
          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
          : 'border-neutral-600 bg-neutral-800/90 text-neutral-200'}"
      role="status"
    >
      {t.message}
    </div>
  {/each}
</div>
