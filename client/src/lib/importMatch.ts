/**
 * Import duplicate / version-detection helpers.
 * Pure, dependency-free, client-side — exploits the already-loaded store.tracks.
 */
import type { Track } from '$lib/types';
import { currentVersion } from '$lib/types';

/** Strip extension, lowercase, normalize separators, remove common version/quality tokens. */
export function normalizeName(filename: string): string {
  // Strip extension
  let s = filename.replace(/\.[^.]+$/, '');
  // Lowercase and replace separators
  s = s.toLowerCase().replace(/[_\-]+/g, ' ');
  // Remove common qualifiers: version markers, quality tags, format notes
  s = s.replace(
    /\b(v\d+|version\s?\d+|\(\d+\)|final|master(ed)?|remaster(ed)?|radio(\s?edit)?|extended|club(\s?mix)?|edit|mix|demo|rough|wip|draft|clean|dirty|instrumental|acapella|acap|unplugged|\d{2,4}\s?bpm|explicit|radio|album|original|official)\b/gi,
    ''
  );
  // Collapse whitespace
  return s.replace(/\s+/g, ' ').trim();
}

/** Jaccard similarity on word token sets (0..1). */
function jaccard(a: string, b: string): number {
  const setA = new Set(a.split(' ').filter(Boolean));
  const setB = new Set(b.split(' ').filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  return intersection / (setA.size + setB.size - intersection);
}

/** Normalised Levenshtein ratio (0..1, 1=identical). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  if (la === 0 || lb === 0) return 0;
  const dp: number[] = Array.from({ length: lb + 1 }, (_, i) => i);
  for (let i = 1; i <= la; i++) {
    let prev = i;
    for (let j = 1; j <= lb; j++) {
      const val = a[i - 1] === b[j - 1] ? dp[j - 1] : 1 + Math.min(dp[j - 1], dp[j], prev);
      dp[j - 1] = prev;
      prev = val;
    }
    dp[lb] = prev;
  }
  return 1 - dp[lb] / Math.max(la, lb);
}

/** Combined similarity: max(jaccard on tokens, Levenshtein ratio). */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  return Math.max(jaccard(a, b), levenshtein(a, b));
}

export type MatchKind = 'new_track' | 'possible_version' | 'possible_duplicate';

export interface FileMatch {
  kind: MatchKind;
  /** Best-matching existing track (null for new_track) */
  track: Track | null;
  /** 0..1 similarity score */
  score: number;
  /** True when a version's media_size is within ±1% of the file size */
  sizeMatch: boolean;
}

/**
 * Classify a dropped file against the existing project tracks.
 * Uses loose thresholds; biased toward flagging so users see and decide.
 */
export function classifyFile(file: File, tracks: Track[]): FileMatch {
  const normFile = normalizeName(file.name);

  let bestScore = 0;
  let bestTrack: Track | null = null;
  let bestSizeMatch = false;

  for (const t of tracks) {
    const normName = normalizeName(t.name);
    let score = similarity(normFile, normName);

    // Also compare against every version's media_filename
    for (const v of t.versions) {
      if (v.media_filename) {
        const vScore = similarity(normFile, normalizeName(v.media_filename));
        if (vScore > score) score = vScore;
      }
    }

    // Size match: any version within ±1% of the dropped file's size
    const sizeMatch = t.versions.some((v) => {
      if (!v.media_size) return false;
      const ratio = file.size / v.media_size;
      return ratio >= 0.99 && ratio <= 1.01;
    });

    if (score > bestScore || (score === bestScore && sizeMatch && !bestSizeMatch)) {
      bestScore = score;
      bestTrack = t;
      bestSizeMatch = sizeMatch;
    }
  }

  // Loose, flag-biased classification
  if (bestScore >= 0.9 || (bestScore >= 0.6 && bestSizeMatch)) {
    return { kind: 'possible_duplicate', track: bestTrack, score: bestScore, sizeMatch: bestSizeMatch };
  }
  if (bestScore >= 0.55) {
    return { kind: 'possible_version', track: bestTrack, score: bestScore, sizeMatch: bestSizeMatch };
  }
  return { kind: 'new_track', track: null, score: bestScore, sizeMatch: false };
}

/** Derive a cleaned track name from an audio filename (strip ext + basic cleanup). */
export function cleanTrackName(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').replace(/[_\-]+/g, ' ').trim() || filename;
}
