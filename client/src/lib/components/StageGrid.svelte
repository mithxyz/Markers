<script lang="ts">
  import type { Dancer, StageConfig } from '$lib/types';

  let {
    stage,
    dancers = [],
    positions,
    editable = false,
    onMove,
  }: {
    stage: StageConfig;
    dancers: Dancer[];
    positions: Map<string, { x: number; y: number }>;
    editable?: boolean;
    onMove?: (dancerId: string, x: number, y: number) => void;
  } = $props();

  const W = 1000;
  const R = 22; // dot radius
  const aspect = $derived(stage?.depth > 0 && stage?.width > 0 ? stage.depth / stage.width : 0.62);
  const H = $derived(Math.round(W * aspect));
  const dancerById = $derived(new Map(dancers.map((d) => [d.id, d])));
  // Phase 8d: ≤3-char token — prefer explicit label, else derive initials up to 3 chars.
  const tokenOf = (d: Dancer) => (d.label || d.name.split(/\s+/).map((w) => w[0]).join('')).slice(0, 3).toUpperCase();

  let svgEl: SVGSVGElement;
  let dragId = $state<string | null>(null);

  function toNorm(e: PointerEvent) {
    const r = svgEl.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }
  function onDown(e: PointerEvent, id: string) {
    if (!editable) return;
    e.preventDefault();
    dragId = id;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onUp);
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragId) return;
    const n = toNorm(e);
    onMove?.(dragId, n.x, n.y);
  }
  function onUp() {
    dragId = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onUp);
  }
</script>

<div class="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
  <svg bind:this={svgEl} viewBox="0 0 {W} {H}" class="block w-full select-none" style="touch-action: none;">
    <!-- defs: one clipPath per dancer with an image avatar -->
    <defs>
      {#each dancers as d (d.id)}
        {#if d.imageUrl}
          <clipPath id="dancer-clip-{d.id}">
            <circle cx="0" cy="0" r={R} />
          </clipPath>
        {/if}
      {/each}
    </defs>

    <!-- stage floor -->
    <rect x="0" y="0" width={W} height={H} fill="#0a0a0b" />
    <rect x="2" y="2" width={W - 4} height={H - 4} fill="none" stroke="#27272a" stroke-width="2" />
    <!-- centre + thirds guides -->
    <line x1={W / 2} y1="0" x2={W / 2} y2={H} stroke="#1c1c1f" stroke-width="1" />
    <line x1={W / 3} y1="0" x2={W / 3} y2={H} stroke="#161618" stroke-width="1" />
    <line x1={(2 * W) / 3} y1="0" x2={(2 * W) / 3} y2={H} stroke="#161618" stroke-width="1" />
    <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="#1c1c1f" stroke-width="1" />
    <text x={W / 2} y={H - 8} fill="#3f3f46" font-size="16" text-anchor="middle">DOWNSTAGE · audience</text>

    {#each [...positions] as [id, p] (id)}
      {@const d = dancerById.get(id)}
      {#if d}
        <g
          transform="translate({p.x * W},{p.y * H})"
          style="cursor: {editable ? (dragId === id ? 'grabbing' : 'grab') : 'default'};"
          onpointerdown={(e) => onDown(e, id)}
          role="button"
          tabindex="-1"
          aria-label={d.name}
        >
          {#if d.imageUrl}
            <!-- Phase 8d: avatar image clipped into the circle -->
            <circle r={R} fill={d.color} stroke="#0a0a0b" stroke-width="2" />
            <image
              href={d.imageUrl}
              x={-R} y={-R}
              width={R * 2} height={R * 2}
              clip-path="url(#dancer-clip-{d.id})"
              preserveAspectRatio="xMidYMid slice"
            />
          {:else}
            <circle r={R} fill={d.color} stroke="#0a0a0b" stroke-width="2" />
            <text y="5" fill="#0a0a0b" font-size="18" font-weight="700" text-anchor="middle">{tokenOf(d)}</text>
          {/if}
        </g>
      {/if}
    {/each}
  </svg>
</div>
{#if editable}
  <p class="mt-1 text-[11px] text-neutral-600">Drag dancers to set this formation.</p>
{/if}
