/** Shared formatting utilities. */

/** Format seconds as m:ss (e.g. 3:07). Returns '—' if zero/falsy. */
export function fmtDuration(s: number): string {
  if (!s) return '—';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}
