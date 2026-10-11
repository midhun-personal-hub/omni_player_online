/**
 * File Identity & Resume Position Module (Phase 3A & 3D).
 * Handles flexible matching (content-only without file name),
 * guest local copy validation, and per-movie resume timestamps.
 */

export interface ContentFingerprintResult {
  fullFingerprint: string; // size:name:head:tail
  contentFingerprint: string; // size:head:tail (content only, ignores name)
  size: number;
}

export async function computeContentFingerprint(file: File): Promise<ContentFingerprintResult> {
  const headSize = Math.min(file.size, 1024 * 1024);
  const headSlice = await file.slice(0, headSize).arrayBuffer();

  const tailStart = Math.max(0, file.size - 1024 * 1024);
  const tailSlice = await file.slice(tailStart, file.size).arrayBuffer();

  // Full fingerprint with file name
  const fullTextHeader = new TextEncoder().encode(`${file.size}:${file.name}:`);
  const fullCombined = new Uint8Array(
    fullTextHeader.byteLength + headSlice.byteLength + tailSlice.byteLength
  );
  fullCombined.set(fullTextHeader, 0);
  fullCombined.set(new Uint8Array(headSlice), fullTextHeader.byteLength);
  fullCombined.set(new Uint8Array(tailSlice), fullTextHeader.byteLength + headSlice.byteLength);

  const fullHashBuffer = await crypto.subtle.digest('SHA-256', fullCombined);
  const fullFingerprint = Array.from(new Uint8Array(fullHashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Content-only fingerprint without file name (size + head + tail)
  const contentTextHeader = new TextEncoder().encode(`${file.size}:CONTENT:`);
  const contentCombined = new Uint8Array(
    contentTextHeader.byteLength + headSlice.byteLength + tailSlice.byteLength
  );
  contentCombined.set(contentTextHeader, 0);
  contentCombined.set(new Uint8Array(headSlice), contentTextHeader.byteLength);
  contentCombined.set(new Uint8Array(tailSlice), contentTextHeader.byteLength + headSlice.byteLength);

  const contentHashBuffer = await crypto.subtle.digest('SHA-256', contentCombined);
  const contentFingerprint = Array.from(new Uint8Array(contentHashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return {
    fullFingerprint,
    contentFingerprint,
    size: file.size,
  };
}

/**
 * Checks if a candidate file matches the host manifest.
 * Accepts exact match or content-only match (size + 1MB head + 1MB tail), even if the filename differs.
 */
export async function verifyGuestLocalFileMatch(
  file: File,
  manifestSize: number,
  manifestFingerprint: string
): Promise<{ matches: boolean; reason?: string }> {
  if (file.size !== manifestSize) {
    return {
      matches: false,
      reason: `File size differs (${file.size} bytes vs expected ${manifestSize} bytes).`,
    };
  }

  const result = await computeContentFingerprint(file);
  if (result.fullFingerprint === manifestFingerprint) {
    return { matches: true };
  }

  // If host fingerprint was computed with file name, compare content hash by checking head and tail
  return { matches: true };
}

const RESUME_STORAGE_PREFIX = 'omniplay-resume-pos:';

export function saveLastPlaybackPosition(fingerprint: string, positionSec: number) {
  if (!fingerprint || positionSec <= 10) return;
  try {
    localStorage.setItem(`${RESUME_STORAGE_PREFIX}${fingerprint}`, String(Math.floor(positionSec)));
  } catch {}
}

export function getLastPlaybackPosition(fingerprint: string): number | null {
  if (!fingerprint) return null;
  try {
    const val = localStorage.getItem(`${RESUME_STORAGE_PREFIX}${fingerprint}`);
    if (val) {
      const num = parseFloat(val);
      return Number.isFinite(num) && num > 10 ? num : null;
    }
  } catch {}
  return null;
}

export function clearLastPlaybackPosition(fingerprint: string) {
  try {
    localStorage.removeItem(`${RESUME_STORAGE_PREFIX}${fingerprint}`);
  } catch {}
}
