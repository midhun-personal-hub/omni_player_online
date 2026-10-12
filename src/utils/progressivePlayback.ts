/**
 * Progressive Playback Engine for Phase 2.
 * Calculates readiness thresholds, registers the service worker,
 * manages decodability testing, priority seeks, and downloaded ranges.
 */

import { MovieManifest, debugMetrics } from './fileTransfer';
import { movieStore } from './movieStore';

export const HEAD_START_SECONDS = 600; // 10 minutes threshold
export const PRIORITY_BURST_PIECES = 60; // ~60 MB burst for seeks

export interface ProgressiveStatus {
  canStart: boolean;
  contiguousSeconds: number;
  readyInMinutes: number;
  avgBitrateMbps: number;
  measuredSpeedMbps: number;
  willFinishBeforeCatchup: boolean;
  hasHeadAndTail: boolean;
  downloadedRanges: Array<{ startPercent: number; endPercent: number }>;
}

let swRegistration: ServiceWorkerRegistration | null = null;
let swReadyPromise: Promise<boolean> | null = null;

export async function initMovieServiceWorker(): Promise<boolean> {
  if (swReadyPromise) return swReadyPromise;

  swReadyPromise = (async () => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      debugMetrics.swStatus = 'unsupported';
      return false;
    }

    try {
      // Check browser prerequisites: OPFS, ReadableStream
      if (typeof ReadableStream === 'undefined') {
        debugMetrics.swStatus = 'unsupported';
        return false;
      }

      swRegistration = await navigator.serviceWorker.register('/movie-sw.js', {
        scope: '/',
        updateViaCache: 'none',
      });

      await navigator.serviceWorker.ready;

      // Ensure controller is active
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => {
          const onControllerChange = () => {
            navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
            resolve();
          };
          navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
          // Safety timeout
          setTimeout(resolve, 1500);
        });
      }

      const isReady = !!navigator.serviceWorker.controller;
      debugMetrics.swStatus = isReady ? 'active' : 'inactive';
      return isReady;
    } catch (err) {
      console.warn('[Progressive] Service worker registration failed:', err);
      debugMetrics.swStatus = 'failed';
      return false;
    }
  })();

  return swReadyPromise;
}

export function notifyServiceWorkerPieceStored(fingerprint: string, index: number) {
  if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'piece-stored',
      fingerprint,
      index,
    });
  }
}

/**
 * Computes progressive playback readiness and downloaded segment ranges.
 */
export function evaluateProgressiveReadiness(
  manifest: MovieManifest,
  receivedPieces: Set<number>,
  measuredSpeedBytesPerSec: number,
  speedHistory: number[],
  currentPositionSec = 0
): ProgressiveStatus {
  const duration = manifest.duration || 3600; // default 1 hour if unknown
  const size = manifest.size;
  const pieceSize = manifest.pieceSize || 1024 * 1024;
  const totalPieces = manifest.pieceCount;

  const avgBitrateBps = (size * 8) / duration;
  const avgBitrateMbps = Number((avgBitrateBps / (1024 * 1024)).toFixed(2));

  // Compute 20s rolling average speed
  const avgSpeed =
    speedHistory.length > 0
      ? speedHistory.reduce((a, b) => a + b, 0) / speedHistory.length
      : measuredSpeedBytesPerSec;
  const measuredSpeedMbps = Number(((avgSpeed * 8) / (1024 * 1024)).toFixed(2));

  // Condition (a): Contiguous bytes from start
  let contiguousPieces = 0;
  while (receivedPieces.has(contiguousPieces) && contiguousPieces < totalPieces) {
    contiguousPieces++;
  }

  const contiguousBytes = contiguousPieces * pieceSize;
  const requiredHeadBytes = size * Math.min(1, HEAD_START_SECONDS / duration);
  const hasHeadAndTail = receivedPieces.has(0) && (totalPieces <= 1 || receivedPieces.has(totalPieces - 1));
  const passesContiguous = contiguousBytes >= requiredHeadBytes && hasHeadAndTail;

  const contiguousSeconds = Math.round((contiguousBytes / size) * duration);

  // Condition (b): Will finish before playback catches up
  const downloadedBytes = receivedPieces.size * pieceSize;
  const remainingBytes = Math.max(0, size - downloadedBytes);
  const timeToFinishDownload = avgSpeed > 0 ? remainingBytes / avgSpeed : Infinity;
  const remainingPlaybackTime = Math.max(0, duration - currentPositionSec);

  const willFinishBeforeCatchup = timeToFinishDownload <= remainingPlaybackTime;

  const canStart = passesContiguous && willFinishBeforeCatchup;

  // Calculate ETA to readiness in minutes
  const neededBytes = Math.max(0, requiredHeadBytes - contiguousBytes);
  const readyInSeconds = avgSpeed > 0 ? Math.ceil(neededBytes / avgSpeed) : 0;
  const readyInMinutes = Math.max(1, Math.ceil(readyInSeconds / 60));

  // Calculate downloaded ranges (for subtle seek bar overlay)
  const ranges: Array<{ startPercent: number; endPercent: number }> = [];
  if (totalPieces > 0) {
    let rStart: number | null = null;
    for (let i = 0; i < totalPieces; i++) {
      if (receivedPieces.has(i)) {
        if (rStart === null) rStart = i;
      } else {
        if (rStart !== null) {
          ranges.push({
            startPercent: (rStart / totalPieces) * 100,
            endPercent: (i / totalPieces) * 100,
          });
          rStart = null;
        }
      }
    }
    if (rStart !== null) {
      ranges.push({
        startPercent: (rStart / totalPieces) * 100,
        endPercent: 100,
      });
    }
  }

  return {
    canStart,
    contiguousSeconds,
    readyInMinutes,
    avgBitrateMbps,
    measuredSpeedMbps,
    willFinishBeforeCatchup,
    hasHeadAndTail,
    downloadedRanges: ranges,
  };
}

export function getMovieStreamUrl(fingerprint: string, mimeType?: string, fileName?: string): string {
  let ext = 'mp4';
  if (fileName) {
    const parts = fileName.split('.');
    if (parts.length > 1) ext = parts.pop()!.toLowerCase();
  } else if (mimeType) {
    if (mimeType.includes('matroska') || mimeType.includes('mkv')) ext = 'mkv';
    else if (mimeType.includes('webm')) ext = 'webm';
  }
  return `/__omniplay_movie/${fingerprint}.${ext}`;
}

/**
 * Tests decodability of the progressive stream via a hidden video element
 */
export async function testProgressiveDecodability(streamUrl: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    (video as any).playsInline = true;

    let finished = false;
    const cleanup = (success: boolean) => {
      if (finished) return;
      finished = true;
      video.pause();
      video.removeAttribute('src');
      video.load();
      resolve(success);
    };

    const timeout = setTimeout(() => cleanup(false), 8000);

    video.onloadedmetadata = () => {
      clearTimeout(timeout);
      cleanup(true);
    };

    video.oncanplay = () => {
      clearTimeout(timeout);
      cleanup(true);
    };

    video.onerror = () => {
      clearTimeout(timeout);
      cleanup(false);
    };

    video.src = streamUrl;
  });
}
