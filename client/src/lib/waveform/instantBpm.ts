/**
 * Instant provisional BPM on upload (Phase 5e). Decodes an audio File to a mono,
 * downsampled Float32Array and runs the dependency-free estimator in a Web Worker.
 * Best-effort: any failure (video file, decode error, no Web Audio) resolves null.
 * The server's BeatNet analysis is authoritative and overwrites this.
 */
export async function estimateInstantBpm(file: File): Promise<number | null> {
  if (!file.type.startsWith('audio/')) return null;
  try {
    const buf = await file.arrayBuffer();
    const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    if (!AC) return null;
    const ctx = new AC();
    const audio = await ctx.decodeAudioData(buf);
    ctx.close();

    // Mono mix, downsample to ~11025 Hz (plenty for beat tracking) and cap length.
    const targetSr = 11025;
    const step = Math.max(1, Math.floor(audio.sampleRate / targetSr));
    const src = audio.getChannelData(0);
    const maxSamples = targetSr * 90; // analyse at most 90s
    const out = new Float32Array(Math.min(maxSamples, Math.floor(src.length / step)));
    for (let i = 0, j = 0; j < out.length; i += step, j++) out[j] = src[i];

    return await runWorker(out, targetSr);
  } catch {
    return null;
  }
}

function runWorker(samples: Float32Array, sampleRate: number): Promise<number | null> {
  return new Promise((resolve) => {
    let done = false;
    const worker = new Worker(new URL('./bpmEstimator.worker.ts', import.meta.url), { type: 'module' });
    const finish = (bpm: number | null) => {
      if (done) return;
      done = true;
      worker.terminate();
      resolve(bpm);
    };
    worker.onmessage = (e: MessageEvent<{ bpm: number | null }>) => finish(e.data?.bpm ?? null);
    worker.onerror = () => finish(null);
    setTimeout(() => finish(null), 8000); // safety timeout
    worker.postMessage({ samples, sampleRate }, [samples.buffer]);
  });
}
