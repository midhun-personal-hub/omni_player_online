/**
 * OPFS Worker for synchronous piece writing using createSyncAccessHandle
 */

interface OpenMsg {
  action: 'open';
  fingerprint: string;
}

interface WritePieceMsg {
  action: 'writePiece';
  fingerprint: string;
  index: number;
  pieceSize: number;
  buffer: ArrayBuffer;
}

interface CloseMsg {
  action: 'close';
  fingerprint: string;
}

interface DeleteMsg {
  action: 'delete';
  fingerprint: string;
}

type WorkerMsg = OpenMsg | WritePieceMsg | CloseMsg | DeleteMsg;

interface SyncHandleEntry {
  handle: any;
  fileHandle: any;
}

const syncHandles = new Map<string, SyncHandleEntry>();

async function getMoviesDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return await root.getDirectoryHandle('omniplay_movies', { create: true });
}

self.onmessage = async (e: MessageEvent<WorkerMsg>) => {
  const data = e.data;
  if (!data || !data.action) return;

  try {
    switch (data.action) {
      case 'open': {
        const dir = await getMoviesDir();
        const fileHandle = await dir.getFileHandle(`${data.fingerprint}.bin`, { create: true });
        if (typeof (fileHandle as any).createSyncAccessHandle === 'function') {
          const syncHandle = await (fileHandle as any).createSyncAccessHandle();
          syncHandles.set(data.fingerprint, { handle: syncHandle, fileHandle });
          self.postMessage({ action: 'opened', fingerprint: data.fingerprint, success: true });
        } else {
          self.postMessage({
            action: 'opened',
            fingerprint: data.fingerprint,
            success: false,
            error: 'createSyncAccessHandle not supported',
          });
        }
        break;
      }

      case 'writePiece': {
        let entry = syncHandles.get(data.fingerprint);
        if (!entry) {
          const dir = await getMoviesDir();
          const fileHandle = await dir.getFileHandle(`${data.fingerprint}.bin`, { create: true });
          if (typeof (fileHandle as any).createSyncAccessHandle === 'function') {
            const syncHandle = await (fileHandle as any).createSyncAccessHandle();
            entry = { handle: syncHandle, fileHandle };
            syncHandles.set(data.fingerprint, entry);
          }
        }

        if (entry && entry.handle) {
          const offset = data.index * data.pieceSize;
          const u8 = new Uint8Array(data.buffer);
          entry.handle.write(u8, { at: offset });
          if (typeof entry.handle.flush === 'function') {
            entry.handle.flush();
          }
          self.postMessage({
            action: 'pieceWritten',
            fingerprint: data.fingerprint,
            index: data.index,
            success: true,
          });
        } else {
          self.postMessage({
            action: 'pieceWritten',
            fingerprint: data.fingerprint,
            index: data.index,
            success: false,
            error: 'No sync handle available',
          });
        }
        break;
      }

      case 'close': {
        const entry = syncHandles.get(data.fingerprint);
        if (entry) {
          try {
            if (typeof entry.handle.flush === 'function') entry.handle.flush();
            if (typeof entry.handle.close === 'function') entry.handle.close();
          } catch {}
          syncHandles.delete(data.fingerprint);
        }
        self.postMessage({ action: 'closed', fingerprint: data.fingerprint, success: true });
        break;
      }

      case 'delete': {
        const entry = syncHandles.get(data.fingerprint);
        if (entry) {
          try {
            if (typeof entry.handle.close === 'function') entry.handle.close();
          } catch {}
          syncHandles.delete(data.fingerprint);
        }
        try {
          const dir = await getMoviesDir();
          await dir.removeEntry(`${data.fingerprint}.bin`);
        } catch {}
        self.postMessage({ action: 'deleted', fingerprint: data.fingerprint, success: true });
        break;
      }
    }
  } catch (err: any) {
    self.postMessage({
      action: 'error',
      fingerprint: (data as any).fingerprint,
      error: err?.message || String(err),
    });
  }
};
