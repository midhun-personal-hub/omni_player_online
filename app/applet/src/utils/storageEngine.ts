// OPFS and IndexedDB storage engine for P2P video streaming & local caching

export interface MovieMetadata {
  fingerprint: string;
  name: string;
  size: number;
  type: string;
  duration: number;
  pieceSize: number;
  pieceCount: number;
  receivedPieces: boolean[];
  complete: boolean;
  lastUsed: number;
}

const DB_NAME = 'OmniPlayDB';
const STORE_NAME = 'movies';

export async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'fingerprint' });
      }
    };
  });
}

export async function getMovieMetadata(fingerprint: string): Promise<MovieMetadata | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(fingerprint);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('Failed to get movie metadata from IDB:', e);
    return null;
  }
}

export async function saveMovieMetadata(meta: MovieMetadata): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(meta);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('Failed to save movie metadata to IDB:', e);
  }
}

// Compute file fingerprint: SHA-256 of (size + first 1MB + last 1MB)
export async function computeFileFingerprint(file: File): Promise<string> {
  const size = file.size;
  const oneMB = 1024 * 1024;
  const firstChunkBlob = file.slice(0, Math.min(oneMB, size));
  const lastChunkBlob = file.slice(Math.max(0, size - oneMB), size);

  const buffer = await new Blob([
    new TextEncoder().encode(String(size)),
    await firstChunkBlob.arrayBuffer(),
    await lastChunkBlob.arrayBuffer(),
  ]).arrayBuffer();

  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// OPFS helpers
export async function getOpfsDirectory(fingerprint: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (!navigator.storage || !navigator.storage.getDirectory) return null;
    const root = await navigator.storage.getDirectory();
    const moviesDir = await root.getDirectoryHandle('movies', { create: true });
    return await moviesDir.getDirectoryHandle(fingerprint, { create: true });
  } catch (e) {
    console.warn('OPFS error:', e);
    return null;
  }
}

export async function savePieceToOpfs(fingerprint: string, pieceIndex: number, data: ArrayBuffer): Promise<boolean> {
  try {
    const dir = await getOpfsDirectory(fingerprint);
    if (!dir) return false;
    const fileHandle = await dir.getFileHandle(`piece_${pieceIndex}.bin`, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(data);
    await writable.close();
    return true;
  } catch (e) {
    console.warn('Failed to write piece to OPFS:', e);
    return false;
  }
}

export async function readPieceFromOpfs(fingerprint: string, pieceIndex: number): Promise<ArrayBuffer | null> {
  try {
    const dir = await getOpfsDirectory(fingerprint);
    if (!dir) return null;
    const fileHandle = await dir.getFileHandle(`piece_${pieceIndex}.bin`, { create: false });
    const file = await fileHandle.getFile();
    return await file.arrayBuffer();
  } catch (e) {
    console.warn('Failed to read piece from OPFS:', e);
    return null;
  }
}

// Assemble full movie blob or file stream from OPFS pieces
export async function assembleMovieBlob(meta: MovieMetadata): Promise<Blob | null> {
  try {
    const dir = await getOpfsDirectory(meta.fingerprint);
    if (!dir) return null;
    const chunks: ArrayBuffer[] = [];
    for (let i = 0; i < meta.pieceCount; i++) {
      const piece = await readPieceFromOpfs(meta.fingerprint, i);
      if (!piece) return null;
      chunks.push(piece);
    }
    return new Blob(chunks, { type: meta.type || 'video/mp4' });
  } catch (e) {
    console.warn('Failed to assemble movie blob:', e);
    return null;
  }
}

export async function computeSha256(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
