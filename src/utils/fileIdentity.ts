/**
 * Canonical File Identity & Verification Module (OmniPlay Phase 1).
 * Provides the single canonical fingerprint algorithm across the application,
 * independent of filename, with robust validation and legacy detection.
 */

export interface CanonicalFingerprintResult {
  fingerprint: string;
  size: number;
}

/**
 * Computes the canonical SHA-256 fingerprint for a movie file.
 * Deterministic encoding:
 * - File size formatted as `${size}:` in UTF-8
 * - First 1 MiB (head)
 * - Last 1 MiB (tail, only if size > 1 MiB to avoid duplicating head bytes)
 * Filename is excluded so byte-identical renamed files produce identical fingerprints.
 */
export async function computeCanonicalFingerprint(file: File | Blob): Promise<string> {
  const size = file.size;

  if (size === 0) {
    // Empty file deterministic hash
    const header = new TextEncoder().encode('0:');
    const hashBuf = await crypto.subtle.digest('SHA-256', header);
    return Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  const oneMb = 1024 * 1024;
  const headSize = Math.min(size, oneMb);
  const headSlice = await file.slice(0, headSize).arrayBuffer();

  const tailSlice =
    size > oneMb
      ? await file.slice(size - oneMb, size).arrayBuffer()
      : new ArrayBuffer(0);

  const header = new TextEncoder().encode(`${size}:`);
  const combined = new Uint8Array(header.byteLength + headSlice.byteLength + tailSlice.byteLength);
  combined.set(header, 0);
  combined.set(new Uint8Array(headSlice), header.byteLength);
  combined.set(new Uint8Array(tailSlice), header.byteLength + headSlice.byteLength);

  const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Validates that a string is a 64-character lowercase hex SHA-256 digest.
 */
export function isValidFingerprint(fp: unknown): fp is string {
  return typeof fp === 'string' && /^[0-9a-f]{64}$/i.test(fp.trim());
}

/**
 * Validates a received movie manifest for structure, piece sizing, and fingerprint format.
 */
export function validateManifest(manifest: unknown): { valid: boolean; error?: string } {
  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, error: 'Manifest must be an object' };
  }

  const m = manifest as Record<string, any>;

  if (!isValidFingerprint(m.fingerprint)) {
    return { valid: false, error: 'Invalid manifest fingerprint format (must be 64-character hex)' };
  }

  if (m.fullFileHash && !isValidFingerprint(m.fullFileHash)) {
    return { valid: false, error: 'Invalid fullFileHash format (must be 64-character hex)' };
  }

  if (typeof m.size !== 'number' || !Number.isFinite(m.size) || m.size < 0) {
    return { valid: false, error: 'Invalid manifest file size' };
  }

  if (typeof m.pieceSize !== 'number' || m.pieceSize !== 1024 * 1024) {
    return { valid: false, error: 'Invalid piece size (must be 1 MiB = 1048576 bytes)' };
  }

  const expectedPieces = m.size === 0 ? 0 : Math.ceil(m.size / m.pieceSize);
  if (typeof m.pieceCount !== 'number' || m.pieceCount !== expectedPieces) {
    return {
      valid: false,
      error: `Piece count mismatch: expected ${expectedPieces} for ${m.size} bytes, got ${m.pieceCount}`,
    };
  }

  if (typeof m.name !== 'string' || !m.name.trim()) {
    return { valid: false, error: 'Manifest must have a non-empty name' };
  }

  return { valid: true };
}

/**
 * Computes combined full-file hash incrementally from piece hashes.
 */
export async function computeCombinedFullHash(
  pieceHashes: Record<number, string>,
  pieceCount: number
): Promise<string> {
  const enc = new TextEncoder();
  let totalLen = 0;
  const buffers: Uint8Array[] = [];
  for (let i = 0; i < pieceCount; i++) {
    const h = pieceHashes[i];
    if (!h) throw new Error(`Missing piece hash for piece ${i}`);
    const b = enc.encode(h);
    buffers.push(b);
    totalLen += b.byteLength;
  }
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const b of buffers) {
    combined.set(b, offset);
    offset += b.byteLength;
  }
  const digest = await crypto.subtle.digest('SHA-256', combined);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}


/**
 * Verifies if a guest's local file matches the host's movie manifest.
 * Rejects size mismatches AND fingerprint mismatches.
 * Never accepts a file merely because its size matches.
 */
export async function verifyGuestLocalFileMatch(
  file: File,
  manifestSize: number,
  manifestFingerprint: string
): Promise<{ matches: boolean; reason?: string }> {
  if (!isValidFingerprint(manifestFingerprint)) {
    return { matches: false, reason: 'Host manifest fingerprint is invalid or corrupted.' };
  }

  if (file.size !== manifestSize) {
    return {
      matches: false,
      reason: `File size differs (${file.size} bytes vs expected ${manifestSize} bytes).`,
    };
  }

  const computed = await computeCanonicalFingerprint(file);
  if (computed.toLowerCase() !== manifestFingerprint.toLowerCase()) {
    return {
      matches: false,
      reason: 'Content fingerprint does not match the movie shared by host.',
    };
  }

  return { matches: true };
}

/**
 * Checks if a stored fingerprint is from an old legacy format (e.g. filename included).
 */
export async function isLegacyFilenameDependentFingerprint(
  storedFingerprint: string,
  file: File
): Promise<boolean> {
  try {
    const headSize = Math.min(file.size, 1024 * 1024);
    const headSlice = await file.slice(0, headSize).arrayBuffer();
    const tailStart = Math.max(0, file.size - 1024 * 1024);
    const tailSlice = await file.slice(tailStart, file.size).arrayBuffer();

    const fullTextHeader = new TextEncoder().encode(`${file.size}:${file.name}:`);
    const fullCombined = new Uint8Array(
      fullTextHeader.byteLength + headSlice.byteLength + tailSlice.byteLength
    );
    fullCombined.set(fullTextHeader, 0);
    fullCombined.set(new Uint8Array(headSlice), fullTextHeader.byteLength);
    fullCombined.set(new Uint8Array(tailSlice), fullTextHeader.byteLength + headSlice.byteLength);

    const fullHashBuffer = await crypto.subtle.digest('SHA-256', fullCombined);
    const legacyHash = Array.from(new Uint8Array(fullHashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return legacyHash.toLowerCase() === storedFingerprint.toLowerCase();
  } catch {
    return false;
  }
}

const RESUME_STORAGE_PREFIX = 'omniplay-resume-pos:';

export function saveLastPlaybackPosition(fingerprint: string, positionSec: number) {
  if (!isValidFingerprint(fingerprint) || positionSec <= 10) return;
  try {
    localStorage.setItem(`${RESUME_STORAGE_PREFIX}${fingerprint}`, String(Math.floor(positionSec)));
  } catch {}
}

export function getLastPlaybackPosition(fingerprint: string): number | null {
  if (!isValidFingerprint(fingerprint)) return null;
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
