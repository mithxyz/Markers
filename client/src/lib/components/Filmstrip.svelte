<script lang="ts">
  // Presentational filmstrip strip shown under the waveform. The sprite is a
  // single horizontal row of `cols` frames spanning the whole track duration, so
  // stretching the image to 100% width maps time→x linearly (object-fit: fill).
  let {
    filmstripUrl = null,
    meta = null,
    duration,
    currentTime,
  }: {
    filmstripUrl: string | null;
    meta: { cols: number; fps: number; frameW: number; frameH: number } | null;
    duration: number;
    currentTime?: number;
  } = $props();

  let height = $derived(meta?.frameH && meta.frameH > 0 ? meta.frameH : 64);

  // Playhead position as a 0–100% left offset (only when both are usable).
  let playheadPct = $derived(
    currentTime != null && duration > 0
      ? Math.max(0, Math.min(100, (currentTime / duration) * 100))
      : null,
  );
</script>

{#if filmstripUrl}
  <div
    class="relative w-full overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950"
    style="height: {height}px"
  >
    <img
      src={filmstripUrl}
      alt="Filmstrip"
      class="block h-full w-full select-none"
      style="object-fit: fill"
      draggable="false"
    />
    {#if playheadPct != null}
      <div
        class="pointer-events-none absolute top-0 bottom-0 w-px bg-neutral-100/80"
        style="left: {playheadPct}%"
      ></div>
    {/if}
  </div>
{/if}
