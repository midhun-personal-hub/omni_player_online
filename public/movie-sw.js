/**
 * OmniPlay Movie Service Worker
 * Serves partial movie files to HTML5 <video> elements via HTTP 206 Range requests
 * streaming byte-by-byte / piece-by-piece from OPFS (or IndexedDB).
 */

const PREFIX = '/__omniplay_movie/';
const DB_NAME = 'omniplay_movie_storage';
const DB_VERSION = 1;
const META_STORE = 'metadata';
const CHUNKS_STORE = 'chunks';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Broadcast / listener for piece-stored notification
const pendingPieceResolvers = new Map();

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'piece-stored') {
    const key = `${data.fingerprint}_${data.index}`;
    const resolvers = pendingPieceResolvers.get(key);
    if (resolvers) {
      resolvers.forEach((resolve) => resolve());
      pendingPieceResolvers.delete(key);
    }
  }
});

function waitForPieceStored(fingerprint, index, timeoutMs = 60000) {
  const key = `${fingerprint}_${index}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // Clean up resolver
      const arr = pendingPieceResolvers.get(key) || [];
      const idx = arr.indexOf(onStored);
      if (idx !== -1) arr.splice(idx, 1);
      if (arr.length === 0) pendingPieceResolvers.delete(key);
      reject(new Error(`Timed out waiting for piece ${index} of ${fingerprint}`));
    }, timeoutMs);

    const onStored = () => {
      clearTimeout(timer);
      resolve();
    };

    const arr = pendingPieceResolvers.get(key) || [];
    arr.push(onStored);
    pendingPieceResolvers.set(key, arr);
  });
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getMovieRecord(fingerprint) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(META_STORE, 'readonly');
      const store = tx.objectStore(META_STORE);
      const req = store.get(fingerprint);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    return null;
  }
}

async function readPieceFromStore(record, index) {
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
    } catch (e) {
      // Fallback to IDB chunks if file access error
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
  } catch (err) {
    return null;
  }
}

// Request priority piece from connected clients (pages)
function notifyPagePriorityNeeded(fingerprint, pieceIndex) {
  self.clients.matchAll({ type: 'window' }).then((clients) => {
    clients.forEach((client) => {
      client.postMessage({
        type: 'priority-piece-needed',
        fingerprint,
        pieceIndex,
      });
    });
  });
}

// Check if piece is in record.receivedPieces
function isPieceStored(record, index) {
  if (!record || !record.receivedPieces) return false;
  return record.receivedPieces.includes(index);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Same-origin only, prefix /__omniplay_movie/<fingerprint>.<ext>
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(PREFIX)) return;
  if (event.request.method !== 'GET') return;

  const rest = url.pathname.slice(PREFIX.length);
  const dotIndex = rest.lastIndexOf('.');
  const fingerprint = dotIndex !== -1 ? rest.slice(0, dotIndex) : rest;
  const ext = dotIndex !== -1 ? rest.slice(dotIndex + 1).toLowerCase() : '';

  event.respondWith(handleMovieRangeRequest(event.request, fingerprint, ext));
});

async function handleMovieRangeRequest(request, fingerprint, ext) {
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

  const rangeHeader = request.headers.get('range');

  let start = 0;
  let end = totalSize - 1;
  let isRange = false;

  if (rangeHeader) {
    const matches = /bytes=(\d+)-(\d+)?/.exec(rangeHeader);
    if (matches) {
      isRange = true;
      start = parseInt(matches[1], 10);
      if (matches[2]) {
        end = parseInt(matches[2], 10);
      }
    }
  }

  if (start >= totalSize || end >= totalSize || start > end) {
    return new Response(null, {
      status: 416,
      headers: {
        'Content-Range': `bytes */${totalSize}`,
      },
    });
  }

  const contentLength = end - start + 1;

  // Stream body piece by piece using ReadableStream
  const stream = new ReadableStream({
    async start(controller) {
      let currentOffset = start;

      try {
        while (currentOffset <= end) {
          const pieceIndex = Math.floor(currentOffset / pieceSize);
          const pieceByteStart = pieceIndex * pieceSize;

          // Check if piece is stored
          let freshRecord = await getMovieRecord(fingerprint);
          let stored = isPieceStored(freshRecord, pieceIndex);

          if (!stored) {
            // Notify active windows to request this piece from the host as priority
            notifyPagePriorityNeeded(fingerprint, pieceIndex);

            // Wait for piece to arrive (up to 60s, checking every 250ms and via event)
            const startTime = Date.now();
            while (!stored && Date.now() - startTime < 60000) {
              try {
                await Promise.race([
                  waitForPieceStored(fingerprint, pieceIndex, 500),
                  new Promise((r) => setTimeout(r, 250)),
                ]);
              } catch (e) {}

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

          // Piece is stored: read from disk/IDB
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

  const headers = {
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
