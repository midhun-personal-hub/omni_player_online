/**
 * Movie storage engine on Guest device.
 * Stores downloaded movie files in Origin Private File System (OPFS) with Web Worker sync handle,
 * and falls back to IndexedDB chunk storage if OPFS is unavailable.
 */

export interface MovieRecord {
  fingerprint: string;
  name: string;
  size: number;
  type: string;
  pieceSize: number;
  pieceCount: number;
  duration?: number;
  receivedPieces: number[];
  complete: boolean;
  lastUsed: number;
  storageBackend: 'opfs' | 'idb';
}

const DB_NAME = 'omniplay_movie_storage';
const DB_VERSION = 1;
const META_STORE = 'metadata';
const CHUNKS_STORE = 'chunks';

let dbPromise: Promise<IDBDatabase> | null = null;
let opfsWorker: Worker | null = null;
let opfsWorkerSupported: boolean | null = null;

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported'));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'fingerprint' });
      }
      if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
        db.createObjectStore(CHUNKS_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

// Check if OPFS and Worker sync handle are usable
async function checkOpfsWorkerSupport(): Promise<boolean> {
  if (opfsWorkerSupported !== null) return opfsWorkerSupported;

  try {
    if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.getDirectory) {
      opfsWorkerSupported = false;
      return false;
    }
    // Verify worker creation
    if (typeof Worker === 'undefined') {
      opfsWorkerSupported = false;
      return false;
    }
    opfsWorkerSupported = true;
    return true;
  } catch {
    opfsWorkerSupported = false;
    return false;
  }
}

function getOpfsWorker(): Worker | null {
  if (opfsWorker) return opfsWorker;
  try {
    opfsWorker = new Worker(new URL('../workers/movieStore.worker.ts', import.meta.url), {
      type: 'module',
    });
    return opfsWorker;
  } catch (err) {
    console.warn('[movieStore] Failed to initialize OPFS worker, fallback to IDB:', err);
    opfsWorkerSupported = false;
    return null;
  }
}

export async function checkStorageAvailable(requiredBytes: number): Promise<{
  ok: boolean;
  freeBytes: number;
  quota: number;
}> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      const quota = estimate.quota || 0;
      const usage = estimate.usage || 0;
      const freeBytes = Math.max(0, quota - usage);
      // Ensure headroom of 25 MB
      const ok = freeBytes >= requiredBytes + 25 * 1024 * 1024;
      return { ok, freeBytes, quota };
    }
  } catch {}
  return { ok: true, freeBytes: requiredBytes * 2, quota: requiredBytes * 2 };
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch {}
  return false;
}

export async function getStorageEstimate(): Promise<{ usage: number; quota: number }> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      return { usage: est.usage || 0, quota: est.quota || 0 };
    }
  } catch {}
  return { usage: 0, quota: 0 };
}

export class MovieStore {
  private static instance: MovieStore;

  public static getInstance(): MovieStore {
    if (!MovieStore.instance) {
      MovieStore.instance = new MovieStore();
    }
    return MovieStore.instance;
  }

  public async getMovie(fingerprint: string): Promise<MovieRecord | null> {
    try {
      const db = await getDB();
      return new Promise<MovieRecord | null>((resolve) => {
        const tx = db.transaction(META_STORE, 'readonly');
        const store = tx.objectStore(META_STORE);
        const req = store.get(fingerprint);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  public async saveMovieRecord(record: MovieRecord): Promise<void> {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readwrite');
      const store = tx.objectStore(META_STORE);
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  public async listMovies(): Promise<MovieRecord[]> {
    try {
      const db = await getDB();
      return new Promise<MovieRecord[]>((resolve) => {
        const tx = db.transaction(META_STORE, 'readonly');
        const store = tx.objectStore(META_STORE);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  }

  public async initMovieTransfer(
    fingerprint: string,
    name: string,
    size: number,
    type: string,
    pieceSize: number,
    pieceCount: number,
    duration?: number
  ): Promise<MovieRecord> {
    const existing = await this.getMovie(fingerprint);
    if (existing) {
      existing.lastUsed = Date.now();
      await this.saveMovieRecord(existing);
      return existing;
    }

    const supportsOpfs = await checkOpfsWorkerSupport();
    const backend: 'opfs' | 'idb' = supportsOpfs ? 'opfs' : 'idb';

    const record: MovieRecord = {
      fingerprint,
      name,
      size,
      type: type || 'video/mp4',
      pieceSize,
      pieceCount,
      duration,
      receivedPieces: [],
      complete: false,
      lastUsed: Date.now(),
      storageBackend: backend,
    };

    if (backend === 'opfs') {
      const worker = getOpfsWorker();
      if (worker) {
        worker.postMessage({ action: 'open', fingerprint });
      }
    }

    await this.saveMovieRecord(record);
    return record;
  }

  public async writePiece(
    fingerprint: string,
    pieceIndex: number,
    pieceBuffer: ArrayBuffer
  ): Promise<boolean> {
    const record = await this.getMovie(fingerprint);
    if (!record) return false;

    if (record.storageBackend === 'opfs') {
      const worker = getOpfsWorker();
      if (worker) {
        const written = await new Promise<boolean>((resolve) => {
          const timeout = setTimeout(() => resolve(false), 8000);
          const handler = (e: MessageEvent) => {
            if (
              e.data &&
              e.data.action === 'pieceWritten' &&
              e.data.fingerprint === fingerprint &&
              e.data.index === pieceIndex
            ) {
              clearTimeout(timeout);
              worker.removeEventListener('message', handler);
              resolve(e.data.success);
            }
          };
          worker.addEventListener('message', handler);
          worker.postMessage(
            {
              action: 'writePiece',
              fingerprint,
              index: pieceIndex,
              pieceSize: record.pieceSize,
              buffer: pieceBuffer,
            },
            [pieceBuffer]
          );
        });

        if (written) {
          const set = new Set(record.receivedPieces);
          set.add(pieceIndex);
          record.receivedPieces = Array.from(set).sort((a, b) => a - b);
          await this.saveMovieRecord(record);
          return true;
        }
      }
      // If OPFS worker failed, downgrade to IDB
      record.storageBackend = 'idb';
    }

    // Fallback: IndexedDB chunk storage
    try {
      const db = await getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(CHUNKS_STORE, 'readwrite');
        const store = tx.objectStore(CHUNKS_STORE);
        const chunkKey = `${fingerprint}_${pieceIndex}`;
        const req = store.put(pieceBuffer, chunkKey);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });

      const set = new Set(record.receivedPieces);
      set.add(pieceIndex);
      record.receivedPieces = Array.from(set).sort((a, b) => a - b);
      await this.saveMovieRecord(record);
      return true;
    } catch (err) {
      console.error('[movieStore] Error writing chunk to IDB:', err);
      return false;
    }
  }

  public async markComplete(fingerprint: string): Promise<void> {
    const record = await this.getMovie(fingerprint);
    if (!record) return;

    record.complete = true;
    record.lastUsed = Date.now();
    await this.saveMovieRecord(record);

    if (record.storageBackend === 'opfs') {
      const worker = getOpfsWorker();
      if (worker) {
        worker.postMessage({ action: 'close', fingerprint });
      }
    }
  }

  public async updateLastUsed(fingerprint: string): Promise<void> {
    const record = await this.getMovie(fingerprint);
    if (!record) return;
    record.lastUsed = Date.now();
    await this.saveMovieRecord(record);
  }

  public async getMovieFile(fingerprint: string): Promise<File | null> {
    const record = await this.getMovie(fingerprint);
    if (!record || !record.complete) return null;

    if (record.storageBackend === 'opfs') {
      try {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle('omniplay_movies', { create: false });
        const fileHandle = await dir.getFileHandle(`${fingerprint}.bin`, { create: false });
        const diskFile = await fileHandle.getFile();
        return new File([diskFile], record.name, {
          type: record.type || 'video/mp4',
          lastModified: record.lastUsed,
        });
      } catch (err) {
        console.warn('[movieStore] Failed to read OPFS file directly, falling back:', err);
      }
    }

    // IDB Assembly fallback
    try {
      const db = await getDB();
      const chunks: ArrayBuffer[] = [];
      for (let i = 0; i < record.pieceCount; i++) {
        const chunk = await new Promise<ArrayBuffer | null>((resolve) => {
          const tx = db.transaction(CHUNKS_STORE, 'readonly');
          const store = tx.objectStore(CHUNKS_STORE);
          const req = store.get(`${fingerprint}_${i}`);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        });
        if (chunk) {
          chunks.push(chunk);
        } else {
          return null; // Missing piece
        }
      }
      return new File(chunks, record.name, {
        type: record.type || 'video/mp4',
        lastModified: record.lastUsed,
      });
    } catch (err) {
      console.error('[movieStore] Failed to assemble movie from IDB:', err);
      return null;
    }
  }

  public async deleteMovie(fingerprint: string): Promise<void> {
    const record = await this.getMovie(fingerprint);

    if (record?.storageBackend === 'opfs') {
      const worker = getOpfsWorker();
      if (worker) {
        worker.postMessage({ action: 'delete', fingerprint });
      }
      try {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle('omniplay_movies', { create: false });
        await dir.removeEntry(`${fingerprint}.bin`);
      } catch {}
    }

    try {
      const db = await getDB();
      const tx = db.transaction([META_STORE, CHUNKS_STORE], 'readwrite');
      tx.objectStore(META_STORE).delete(fingerprint);

      // Clean IDB chunks
      const chunkStore = tx.objectStore(CHUNKS_STORE);
      if (record) {
        for (let i = 0; i < record.pieceCount; i++) {
          chunkStore.delete(`${fingerprint}_${i}`);
        }
      }
    } catch (err) {
      console.warn('[movieStore] Error deleting movie:', err);
    }
  }

  public async clearAllMovies(): Promise<void> {
    try {
      const movies = await this.listMovies();
      for (const m of movies) {
        await this.deleteMovie(m.fingerprint);
      }
    } catch {}
  }
}

export const movieStore = MovieStore.getInstance();
