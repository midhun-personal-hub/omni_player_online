/**
 * Cache Management & Storage Limits Module (Phase 3B).
 * Manages quota estimates, custom storage caps (default 10 GB or 50% free space),
 * LRU movie cleanup calculation, auto-cleaning unwatched movies, and stale partial downloads.
 */

import { movieStore, MovieRecord } from './movieStore';

export const DEFAULT_STORAGE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB
const PREF_LIMIT_KEY = 'omniplay-storage-limit-bytes';
const PREF_AUTO_CLEAN_KEY = 'omniplay-auto-clean-days'; // 0 (off), 7, 30

export interface CacheAnalysis {
  configuredLimitBytes: number;
  totalQuotaBytes: number;
  usedBytes: number;
  freeBytes: number;
  moviesTotalBytes: number;
  movies: MovieRecord[];
  exceedsLimit: boolean;
  excessBytes: number;
  candidatesForDeletion: MovieRecord[];
}

export function getConfiguredStorageLimit(): number {
  try {
    const saved = localStorage.getItem(PREF_LIMIT_KEY);
    if (saved) {
      const val = parseInt(saved, 10);
      if (Number.isFinite(val) && val > 0) return val;
    }
  } catch {}
  return DEFAULT_STORAGE_LIMIT_BYTES;
}

export function setConfiguredStorageLimit(bytes: number) {
  try {
    localStorage.setItem(PREF_LIMIT_KEY, String(bytes));
  } catch {}
}

export function getAutoCleanDays(): number {
  try {
    const saved = localStorage.getItem(PREF_AUTO_CLEAN_KEY);
    if (saved) {
      const val = parseInt(saved, 10);
      if (val === 7 || val === 30) return val;
    }
  } catch {}
  return 0; // Off by default
}

export function setAutoCleanDays(days: number) {
  try {
    localStorage.setItem(PREF_AUTO_CLEAN_KEY, String(days));
  } catch {}
}

/**
 * Analyzes current storage usage, quota, and movies to recommend LRU deletions.
 * Guarantees that currently active or downloading movies are never targeted.
 */
export async function analyzeStorageCache(
  excludeFingerprints: string[] = []
): Promise<CacheAnalysis> {
  let totalQuotaBytes = 0;
  let usedBytes = 0;

  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      totalQuotaBytes = est.quota || 0;
      usedBytes = est.usage || 0;
    } catch {}
  }

  // 50% of available space or configured limit (whichever is smaller)
  const maxCap = totalQuotaBytes > 0 ? Math.floor(totalQuotaBytes * 0.5) : DEFAULT_STORAGE_LIMIT_BYTES;
  const configuredLimit = Math.min(getConfiguredStorageLimit(), maxCap > 0 ? maxCap : DEFAULT_STORAGE_LIMIT_BYTES);

  const movies = await movieStore.listMovies();
  const moviesTotalBytes = movies.reduce((acc, m) => acc + (m.size || 0), 0);
  const freeBytes = Math.max(0, totalQuotaBytes - usedBytes);

  const exceedsLimit = usedBytes > configuredLimit || moviesTotalBytes > configuredLimit;
  const excessBytes = Math.max(0, Math.max(usedBytes, moviesTotalBytes) - configuredLimit);

  // Filter complete movies not in active use, ordered from oldest lastUsed to newest (LRU)
  const candidates = movies
    .filter((m) => m.complete && !excludeFingerprints.includes(m.fingerprint))
    .sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0));

  return {
    configuredLimitBytes: configuredLimit,
    totalQuotaBytes,
    usedBytes,
    freeBytes,
    moviesTotalBytes,
    movies,
    exceedsLimit,
    excessBytes,
    candidatesForDeletion: candidates,
  };
}

/**
 * Executes startup sweep for:
 * 1. Partial downloads older than 3 days with no active room.
 * 2. Unwatched movies older than N days (if autoCleanDays is set).
 */
export async function performStartupCacheMaintenance(): Promise<{
  deletedStalePartials: number;
  deletedUnwatched: number;
}> {
  let deletedStalePartials = 0;
  let deletedUnwatched = 0;

  try {
    const movies = await movieStore.listMovies();
    const now = Date.now();
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    const autoDays = getAutoCleanDays();
    const autoCleanMs = autoDays > 0 ? autoDays * 24 * 60 * 60 * 1000 : 0;

    for (const m of movies) {
      const age = now - (m.lastUsed || now);

      // Rule 1: Stale partial download older than 3 days
      if (!m.complete && age > threeDaysMs) {
        await movieStore.deleteMovie(m.fingerprint);
        deletedStalePartials++;
        continue;
      }

      // Rule 2: Unwatched for N days (if option enabled)
      if (m.complete && autoCleanMs > 0 && age > autoCleanMs) {
        await movieStore.deleteMovie(m.fingerprint);
        deletedUnwatched++;
      }
    }
  } catch (err) {
    console.warn('[CacheManager] Error performing cache maintenance:', err);
  }

  return { deletedStalePartials, deletedUnwatched };
}
