/** Pure drag-and-drop helpers. Dependency-free; reused by TrackListView and PlaylistsPanel. */

/**
 * Move an item in an array from `from` index to `to` index (immutably).
 * Suitable for applying to $state arrays after a successful drag-and-drop.
 */
export function reorder<T>(list: T[], from: number, to: number): T[] {
  if (from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
