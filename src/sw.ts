/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';

declare const self: any;

// Clean up outdated caches and precache PWA assets injected by VitePWA
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST || []);

self.skipWaiting();
self.clients.claim();

const PREFIX = '/__omniplay_movie/';
const DB_NAME = 'omniplay_movie_storage';
const DB_VERSION = 1;
const META_STORE = 'metadata';
const CHUNKS_STORE = 'chunks';

const pendingPieceResolvers = new Map<string, Array<() => void>>();

self.addEventListener('message', (event: any) => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'piece-stored') {
    const key = `${data.fingerprint}_${data.index}`;
    const resolvers = pendingPieceResolvers.get(key);
    if (resolvers) {
      resolvers.forEach((resolve) => resolve());
      pendingPieceResolvers.delete(key);
    }
  } else if (data.type === 'abort-playback') {
    // Release pending resolvers when playback or room closes
    pendingPieceResolvers.clear();
  }
});

function waitForPieceStored(fingerprint: string, index: number, timeoutMs = 30000): Promise<void> {
  const key = `${fingerprint}_${index}`;
  return new Promise((resolve, reject) => {
    let timer: any;
    const onStored = () => {
      clearTimeout(timer);
      resolve();
    };

    timer = setTimeout(() => {
      const arr = pendingPieceResolvers.get(key) || [];
      const idx = arr.indexOf(onStored);
      if (idx !== -1) arr.splice(idx, 1);
      if (arr.length === 0) pendingPieceResolvers.delete(key);
      reject(new Error(`Timed out waiting for piece ${index} of ${fingerprint}`));
    }, timeoutMs);

    const arr = pendingPieceResolvers.get(key) || [];
    arr.push(onStored);
    pendingPieceResolvers.set(key, arr);
  });
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB unavailable in ServiceWorker'));
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getMovieRecord(fingerprint: string): Promise<any | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
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

async function readPieceFromStore(record: any, index: number): Promise<ArrayBuffer | null> {
  const fingerprint = record.fingerprint;
  const pieceSize = record.pieceSize || 1024 * 1024;
  const offset = index * pieceSize;

  if (record.storageBackend === 'opfs' && navigator.storage && navigator.storage.getDirectory) {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('omniplay_movies', { create: false });
      const fileHandle = await dir.getFileHandle(`${fingerprint}.bin`, { create: false });
      const diskFile = await fileHandle.getFile();
      const endOffset = Math.min(record.size, offset + pieceSize);
      const slice = diskFile.slice(offset, endOffset);
      const buf = await slice.arrayBuffer();
      if (buf.byteLength > 0) {
        return buf;
      }
    } catch {
      // Fallback to IDB chunks if OPFS access fails
    }
  }

  // IDB fallback
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(CHUNKS_STORE, 'readonly');
      const store = tx.objectStore(CHUNKS_STORE);
      const req = store.get(`${fingerprint}_${index}`);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

function notifyPagePriorityNeeded(fingerprint: string, pieceIndex: number) {
  self.clients.matchAll({ type: 'window' }).then((clients: any[]) => {
    clients.forEach((client) => {
      client.postMessage({
        type: 'priority-piece-needed',
        fingerprint,
        pieceIndex,
      });
    });
  });
}

function isPieceStored(record: any, index: number): boolean {
  if (!record || !record.receivedPieces) return false;
  return record.receivedPieces.includes(index);
}

self.addEventListener('fetch', (event: any) => {
  const url = new URL(event.request.url);

  // Same-origin only, prefix /__omniplay_movie/<fingerprint>.<ext>
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(PREFIX)) return;
  if (event.request.method !== 'GET' && event.request.method !== 'HEAD') return;

  const rest = url.pathname.slice(PREFIX.length);
  const dotIndex = rest.lastIndexOf('.');
  const fingerprint = dotIndex !== -1 ? rest.slice(0, dotIndex) : rest;
  const ext = dotIndex !== -1 ? rest.slice(dotIndex + 1).toLowerCase() : '';

  // Validate fingerprint format (64 hex characters)
  if (!/^[0-9a-f]{64}$/i.test(fingerprint)) {
    event.respondWith(new Response('Invalid movie fingerprint', { status: 400 }));
    return;
  }

  event.respondWith(handleMovieRangeRequest(event.request, fingerprint, ext));
});

async function handleMovieRangeRequest(request: Request, fingerprint: string, ext: string): Promise<Response> {
  const record = await getMovieRecord(fingerprint);
  if (!record) {
    return new Response('Movie not found in local store', { status: 404 });
  }

  const totalSize = record.size;
  const pieceSize = record.pieceSize || 1024 * 1024;

  let mimeType = record.type || 'video/mp4';
  if (!mimeType || mimeType === 'application/octet-stream') {
    if (ext === 'mkv') mimeType = 'video/x-matroska';
    else if (ext === 'webm') mimeType = 'video/webm';
    else mimeType = 'video/mp4';
  }

  // Handle empty files (0 bytes)
  if (totalSize === 0) {
    return new Response(new Uint8Array(0), {
      status: 200,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Type': mimeType,
        'Content-Length': '0',
      },
    });
  }

  const rangeHeader = request.headers.get('range');
  let start = 0;
  let end = totalSize - 1;
  let isRange = false;

  if (rangeHeader) {
    // Parse range: bytes=start-end, bytes=start-, bytes=-suffix
    const matches = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    if (matches) {
      isRange = true;
      const startStr = matches[1];
      const endStr = matches[2];

      if (startStr && endStr) {
        start = parseInt(startStr, 10);
        end = parseInt(endStr, 10);
      } else if (startStr) {
        start = parseInt(startStr, 10);
        end = totalSize - 1;
      } else if (endStr) {
        const suffixLength = parseInt(endStr, 10);
        start = Math.max(0, totalSize - suffixLength);
        end = totalSize - 1;
      }
    }
  }

  // Check 416 Range Not Satisfiable
  if (start >= totalSize || end >= totalSize || start > end || start < 0) {
    return new Response(null, {
      status: 416,
      statusText: 'Range Not Satisfiable',
      headers: {
        'Content-Range': `bytes */${totalSize}`,
        'Accept-Ranges': 'bytes',
      },
    });
  }

  const contentLength = end - start + 1;

  // HEAD request returns headers only
  if (request.method === 'HEAD') {
    const headers: Record<string, string> = {
      'Accept-Ranges': 'bytes',
      'Content-Type': mimeType,
      'Content-Length': String(contentLength),
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    };
    if (isRange) {
      headers['Content-Range'] = `bytes ${start}-${end}/${totalSize}`;
    }
    return new Response(null, {
      status: isRange ? 206 : 200,
      headers,
    });
  }

  // Stream body piece by piece using ReadableStream
  const stream = new ReadableStream({
    async start(controller) {
      let currentOffset = start;

      try {
        while (currentOffset <= end) {
          const pieceIndex = Math.floor(currentOffset / pieceSize);
          const pieceByteStart = pieceIndex * pieceSize;

          let freshRecord = await getMovieRecord(fingerprint);
          let stored = isPieceStored(freshRecord, pieceIndex);

          if (!stored) {
            // Request missing piece with bounded wait
            notifyPagePriorityNeeded(fingerprint, pieceIndex);

            const startTime = Date.now();
            while (!stored && Date.now() - startTime < 30000) {
              try {
                await Promise.race([
                  waitForPieceStored(fingerprint, pieceIndex, 500),
                  new Promise((r) => setTimeout(r, 250)),
                ]);
              } catch {}

              freshRecord = await getMovieRecord(fingerprint);
              stored = isPieceStored(freshRecord, pieceIndex);
            }

            if (!stored) {
              controller.error(
                new Error(`Timeout waiting for piece ${pieceIndex} in progressive playback`)
              );
              return;
            }
          }

          const pieceBuf = await readPieceFromStore(freshRecord || record, pieceIndex);
          if (!pieceBuf) {
            controller.error(new Error(`Failed to read piece ${pieceIndex} from store`));
            return;
          }

          const inPieceOffset = currentOffset - pieceByteStart;
          const pieceBytesRemaining = pieceBuf.byteLength - inPieceOffset;
          const rangeBytesRemaining = end - currentOffset + 1;
          const sliceLength = Math.min(pieceBytesRemaining, rangeBytesRemaining);

          if (sliceLength <= 0) {
            break;
          }

          const sliceView = new Uint8Array(pieceBuf, inPieceOffset, sliceLength);
          controller.enqueue(sliceView);

          currentOffset += sliceLength;
        }

        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  const headers: Record<string, string> = {
    'Accept-Ranges': 'bytes',
    'Content-Type': mimeType,
    'Content-Length': String(contentLength),
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  };

  if (isRange) {
    headers['Content-Range'] = `bytes ${start}-${end}/${totalSize}`;
    return new Response(stream, {
      status: 206,
      statusText: 'Partial Content',
      headers,
    });
  } else {
    return new Response(stream, {
      status: 200,
      headers,
    });
  }
}
