<script lang="ts">
  import type { TrackVersion } from '$lib/types';
  let { status }: { status: TrackVersion['status'] } = $props();

  const map: Record<TrackVersion['status'], { label: string; cls: string }> = {
    pending_upload: { label: 'Uploading', cls: 'border-sky-500/40 bg-sky-500/10 text-sky-300' },
    uploaded: { label: 'Queued', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
    processing: { label: 'Processing', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
    ready: { label: 'Ready', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' },
    failed: { label: 'Failed', cls: 'border-red-500/40 bg-red-500/10 text-red-300' },
  };
  const s = $derived(map[status] || map.processing);
</script>

<span class="rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide {s.cls}">{s.label}</span>
