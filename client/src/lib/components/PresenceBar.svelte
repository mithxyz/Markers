<script lang="ts">
  import type { OnlineUser } from '$lib/socket';
  let { online = [] }: { online: OnlineUser[] } = $props();

  function initials(name: string) {
    return name.slice(0, 2).toUpperCase();
  }
</script>

{#if online.length}
  <div class="flex items-center -space-x-2">
    {#each online as u (u.userId)}
      <div
        class="flex h-7 w-7 items-center justify-center rounded-full border-2 border-neutral-900 text-[10px] font-semibold text-white"
        style="background: {u.color}"
        title={u.displayName}
      >
        {initials(u.displayName)}
      </div>
    {/each}
  </div>
{/if}
