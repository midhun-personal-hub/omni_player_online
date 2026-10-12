import { computeSha256 } from './storageEngine';

export interface FileManifest {
  fingerprint: string;
  name: string;
  size: number;
  type: string;
  duration: number;
  pieceSize: number;
  pieceCount: number;
  pieceHashes: string[];
}

export const PIECE_SIZE = 1024 * 1024; // 1 MiB pieces
export const CHUNK_SIZE = 16 * 1024; // 16 KB chunks inside 1 MiB pieces
export const BACKPRESSURE_HIGH_WATERMARK = 8 * 1024 * 1024; // 8 MB
export const BACKPRESSURE_LOW_WATERMARK = 1024 * 1024; // 1 MB

export async function generateManifest(file: File, fingerprint: string, duration: number): Promise<FileManifest> {
  const pieceSize = PIECE_SIZE;
  const pieceCount = Math.ceil(file.size / pieceSize);
  const pieceHashes: string[] = [];

  for (let i = 0; i < pieceCount; i++) {
    const start = i * pieceSize;
    const end = Math.min(start + pieceSize, file.size);
    const slice = file.slice(start, end);
    const buffer = await slice.arrayBuffer();
    const hash = await computeSha256(buffer);
    pieceHashes.push(hash);
  }

  return {
    fingerprint,
    name: file.name,
    size: file.size,
    type: file.type || 'video/mp4',
    duration,
    pieceSize,
    pieceCount,
    pieceHashes,
  };
}

// Priority sorting for piece indices (header/tail first, then start, then requested priority)
export function getInitialPieceQueue(pieceCount: number, priorityIndices: number[] = []): number[] {
  const queue: number[] = [];
  const prioritySet = new Set(priorityIndices);

  // Add user priority indices first
  for (const idx of priorityIndices) {
    if (idx >= 0 && idx < pieceCount) queue.push(idx);
  }

  // Header (first 5 pieces) and tail (last 2 pieces) for MP4 moov / MKV cues
  const vitalIndices = new Set<number>();
  for (let i = 0; i < Math.min(5, pieceCount); i++) vitalIndices.add(i);
  for (let i = Math.max(0, pieceCount - 2); i < pieceCount; i++) vitalIndices.add(i);

  for (const idx of vitalIndices) {
    if (!queue.includes(idx)) queue.push(idx);
  }

  // Rest of the pieces sequentially
  for (let i = 0; i < pieceCount; i++) {
    if (!queue.includes(i) && !prioritySet.has(i)) {
      queue.push(i);
    }
  }

  return queue;
}
