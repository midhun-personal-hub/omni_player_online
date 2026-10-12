/**
 * Peer-to-peer file transfer engine for OmniPlay.
 * Streams original movie files from host to viewers over dedicated WebRTC DataConnection,
 * writes pieces to local storage, and enables local playback with millisecond sync.
 */

import { DataConnection } from 'peerjs';
import { movieStore, checkStorageAvailable, requestPersistentStorage } from './movieStore';
import { analyzeStorageCache } from './cacheManager';
import { meshP2PManager } from './meshP2PTransfer';
import {
  computeCanonicalFingerprint,
  validateManifest,
  isValidFingerprint,
  computeCombinedFullHash,
} from './fileIdentity';

export const TRANSFER_PIECE_SIZE = 1024 * 1024; // 1 MB piece
export const TRANSFER_CHUNK_SIZE = 16 * 1024; // 16 KB chunks
export const BUFFERED_AMOUNT_HIGH = 8 * 1024 * 1024; // 8 MB backpressure threshold
export const BUFFERED_AMOUNT_LOW = 1 * 1024 * 1024; // 1 MB resume threshold
export const DRIFT_IGNORE = 0.3; // seconds
export const DRIFT_RATE_ADJUST = 1.5; // seconds
export const RATE_SLOW = 0.95;
export const RATE_FAST = 1.05;
export const BUFFERING_WAIT_TIMEOUT_MS = 30000; // 30s max buffering pause

export interface MovieManifest {
  fingerprint: string;
  name: string;
  size: number;
  type: string;
  pieceSize: number;
  pieceCount: number;
  duration?: number;
  fullFileHash?: string;
}

export type FileTransferMsg =
  | { type: 'manifest'; manifest: MovieManifest }
  | { type: 'have'; fingerprint: string; pieces: number[] }
  | { type: 'have-all'; fingerprint: string }
  | { type: 'piece-start'; index: number; hash: string; size: number }
  | { type: 'chunk'; index: number; offset: number; data: ArrayBuffer }
  | { type: 'piece-end'; index: number }
  | { type: 'piece-ack'; index: number }
  | { type: 'resend'; index: number }
  | { type: 'priority'; fromPiece: number }
  | { type: 'done'; fingerprint: string }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'cancel' }
  | { type: 'sync-state'; playing: boolean; currentTime: number; rate: number; sentAt: number }
  | { type: 'guest-buffering'; name: string }
  | { type: 'guest-ready'; name: string };

export interface TransferProgress {
  fingerprint: string;
  name: string;
  totalPieces: number;
  piecesCompleted: number;
  bytesTransferred: number;
  totalBytes: number;
  percentage: number;
  speedBytesPerSec: number;
  etaSeconds: number;
  isPaused: boolean;
  status: 'idle' | 'transferring' | 'paused' | 'verifying' | 'completed' | 'error';
  errorMessage?: string;
}

export interface TransferDebugMetrics {
  transferSpeedMbps: number;
  piecesDone: number;
  totalPieces: number;
  retries: number;
  hashFailures: number;
  storageBackend: 'OPFS' | 'IndexedDB';
  playbackMode: 'live' | 'local-progressive' | 'local-complete';
  contiguousSecondsAhead: number;
  downloadSpeedVsAvgBitrate: string;
  pendingRangeRequests: number;
  swStatus: 'active' | 'inactive' | 'unsupported' | 'failed';
  fallbacksCount: number;
}

// Global debug metrics accessible by DebugOverlay
export const debugMetrics: TransferDebugMetrics = {
  transferSpeedMbps: 0,
  piecesDone: 0,
  totalPieces: 0,
  retries: 0,
  hashFailures: 0,
  storageBackend: 'OPFS',
  playbackMode: 'live',
  contiguousSecondsAhead: 0,
  downloadSpeedVsAvgBitrate: '0 / 0 Mbps',
  pendingRangeRequests: 0,
  swStatus: 'inactive',
  fallbacksCount: 0,
};

if (typeof window !== 'undefined') {
  (window as any).__omniplayTransferDebug = debugMetrics;
}

/**
 * Computes canonical movie fingerprint excluding filename.
 */
export async function computeFileFingerprint(file: File | Blob): Promise<string> {
  return computeCanonicalFingerprint(file);
}

export async function computeBufferHash(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function calculatePieceSendOrder(pieceCount: number, guestHas: Set<number>): number[] {
  if (pieceCount <= 0) return [];
  const order: number[] = [];

  // Header piece 0 first
  if (!guestHas.has(0)) {
    order.push(0);
  }

  // Tail piece last second (indexes MP4/MKV)
  if (pieceCount > 1 && !guestHas.has(pieceCount - 1)) {
    order.push(pieceCount - 1);
  }

  // Then remaining in sequential order
  for (let i = 1; i < pieceCount - 1; i++) {
    if (!guestHas.has(i)) {
      order.push(i);
    }
  }

  return order;
}

async function waitForBufferDrain(dc: RTCDataChannel): Promise<void> {
  if (!dc || dc.readyState !== 'open') return;
  if (dc.bufferedAmount <= BUFFERED_AMOUNT_LOW) return;

  return new Promise<void>((resolve) => {
    let resolved = false;
    let poll: any;
    let timeout: any;

    const finish = () => {
      if (!resolved) {
        resolved = true;
        try {
          dc.removeEventListener('bufferedamountlow', onLow);
          dc.removeEventListener('close', finish);
          dc.removeEventListener('error', finish);
        } catch {}
        clearInterval(poll);
        clearTimeout(timeout);
        resolve();
      }
    };

    const onLow = () => {
      if (dc.bufferedAmount <= BUFFERED_AMOUNT_LOW) finish();
    };

    try {
      dc.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW;
    } catch {}

    try {
      dc.addEventListener('bufferedamountlow', onLow);
      dc.addEventListener('close', finish);
      dc.addEventListener('error', finish);
    } catch {}

    poll = setInterval(() => {
      if (dc.readyState !== 'open' || dc.bufferedAmount <= BUFFERED_AMOUNT_LOW) {
        finish();
      }
    }, 50);

    // Bounded safety timeout so sender is never permanently blocked
    timeout = setTimeout(finish, 15000);
  });
}

// Check whether browser can decode the media
export async function verifyDecodability(file: Blob, mimeType: string): Promise<boolean> {
  if (typeof document === 'undefined') return true;

  const testVideo = document.createElement('video');
  const canPlay = testVideo.canPlayType(mimeType || 'video/mp4');
  if (!canPlay) {
    return false;
  }

  const testUrl = URL.createObjectURL(file);
  return new Promise<boolean>((resolve) => {
    let resolved = false;
    const finish = (result: boolean) => {
      if (!resolved) {
        resolved = true;
        testVideo.src = '';
        URL.revokeObjectURL(testUrl);
        resolve(result);
      }
    };

    testVideo.onloadedmetadata = () => finish(true);
    testVideo.onerror = () => finish(false);
    testVideo.src = testUrl;
    setTimeout(() => finish(false), 4000);
  });
}

/**
 * Host Transfer Session for a specific guest
 */
export class HostGuestTransfer {
  public peerId: string;
  public conn: DataConnection;
  public file: File;
  public manifest: MovieManifest;
  public sendQueue: number[] = [];
  public isPaused = false;
  public isCancelled = false;
  public completedPieces = new Set<number>();
  public currentPieceIndex: number | null = null;
  public bytesSent = 0;
  public startTime = Date.now();
  public lastSpeedTime = Date.now();
  public lastBytesSent = 0;
  public currentSpeed = 0;

  private onProgressCallback?: (progress: TransferProgress) => void;

  constructor(
    peerId: string,
    conn: DataConnection,
    file: File,
    manifest: MovieManifest,
    onProgress?: (progress: TransferProgress) => void
  ) {
    this.peerId = peerId;
    this.conn = conn;
    this.file = file;
    this.manifest = manifest;
    this.onProgressCallback = onProgress;
  }

  public getProgress(): TransferProgress {
    const totalBytes = this.manifest.size;
    const piecesDone = this.completedPieces.size;
    const bytesTransferred = Math.min(totalBytes, piecesDone * this.manifest.pieceSize);
    const percentage = totalBytes > 0 ? Math.min(100, (bytesTransferred / totalBytes) * 100) : 0;
    const remainingBytes = Math.max(0, totalBytes - bytesTransferred);
    const etaSeconds = this.currentSpeed > 0 ? Math.round(remainingBytes / this.currentSpeed) : 0;

    return {
      fingerprint: this.manifest.fingerprint,
      name: this.manifest.name,
      totalPieces: this.manifest.pieceCount,
      piecesCompleted: piecesDone,
      bytesTransferred,
      totalBytes,
      percentage: Number(percentage.toFixed(1)),
      speedBytesPerSec: this.currentSpeed,
      etaSeconds,
      isPaused: this.isPaused,
      status:
        piecesDone >= this.manifest.pieceCount
          ? 'completed'
          : this.isPaused
          ? 'paused'
          : this.isCancelled
          ? 'error'
          : 'transferring',
    };
  }

  public emitProgress() {
    this.onProgressCallback?.(this.getProgress());
  }

  public async startSending(guestHasPieces: Set<number>) {
    this.completedPieces = new Set(guestHasPieces);
    this.sendQueue = calculatePieceSendOrder(this.manifest.pieceCount, guestHasPieces);

    if (this.sendQueue.length === 0) {
      this.conn.send({ type: 'done', fingerprint: this.manifest.fingerprint } satisfies FileTransferMsg);
      this.emitProgress();
      return;
    }

    this.runQueue();
  }

  public pause() {
    this.isPaused = true;
    try {
      this.conn.send({ type: 'pause' } satisfies FileTransferMsg);
    } catch {}
    this.emitProgress();
  }

  public resume() {
    if (!this.isPaused) return;
    this.isPaused = false;
    try {
      this.conn.send({ type: 'resume' } satisfies FileTransferMsg);
    } catch {}
    this.emitProgress();
    this.runQueue();
  }

  public cancel() {
    this.isCancelled = true;
    try {
      this.conn.send({ type: 'cancel' } satisfies FileTransferMsg);
    } catch {}
    this.emitProgress();
  }

  public requestResend(index: number) {
    if (!this.completedPieces.has(index) && !this.sendQueue.includes(index)) {
      this.sendQueue.unshift(index);
      debugMetrics.retries++;
      if (!this.isPaused) {
        this.runQueue();
      }
    }
  }

  public requestPriorityPieces(fromPiece: number, count = 60) {
    const priorityIndices: number[] = [];
    const maxPiece = this.manifest.pieceCount;
    for (let i = fromPiece; i < Math.min(maxPiece, fromPiece + count); i++) {
      if (!this.completedPieces.has(i)) {
        priorityIndices.push(i);
      }
    }

    if (priorityIndices.length === 0) return;

    // Filter out these indices from existing sendQueue and prepend them
    const remaining = this.sendQueue.filter((idx) => !priorityIndices.includes(idx));
    this.sendQueue = [...priorityIndices, ...remaining];

    if (!this.isPaused) {
      this.runQueue();
    }
  }

  private isRunning = false;

  private async runQueue() {
    if (this.isRunning || this.isPaused || this.isCancelled) return;
    this.isRunning = true;

    try {
      while (this.sendQueue.length > 0 && !this.isPaused && !this.isCancelled) {
        const pieceIndex = this.sendQueue.shift()!;
        this.currentPieceIndex = pieceIndex;

        const pieceStart = pieceIndex * this.manifest.pieceSize;
        const pieceEnd = Math.min(this.file.size, pieceStart + this.manifest.pieceSize);
        const pieceSlice = this.file.slice(pieceStart, pieceEnd);
        const pieceBuffer = await pieceSlice.arrayBuffer();

        const pieceHash = await computeBufferHash(pieceBuffer);

        // Send piece-start
        this.conn.send({
          type: 'piece-start',
          index: pieceIndex,
          hash: pieceHash,
          size: pieceBuffer.byteLength,
        } satisfies FileTransferMsg);

        // Split into chunks of 16 KB
        let offset = 0;
        const dc = this.conn.dataChannel;

        while (offset < pieceBuffer.byteLength && !this.isCancelled && !this.isPaused) {
          const chunkEnd = Math.min(pieceBuffer.byteLength, offset + TRANSFER_CHUNK_SIZE);
          const chunkData = pieceBuffer.slice(offset, chunkEnd);

          this.conn.send({
            type: 'chunk',
            index: pieceIndex,
            offset,
            data: chunkData,
          } satisfies FileTransferMsg);

          this.bytesSent += chunkData.byteLength;
          offset = chunkEnd;

          // Measure speed every 500 ms
          const now = Date.now();
          if (now - this.lastSpeedTime >= 500) {
            const timeDiff = (now - this.lastSpeedTime) / 1000;
            const bytesDiff = this.bytesSent - this.lastBytesSent;
            this.currentSpeed = Math.round(bytesDiff / timeDiff);
            this.lastSpeedTime = now;
            this.lastBytesSent = this.bytesSent;
            debugMetrics.transferSpeedMbps = Number(
              ((this.currentSpeed * 8) / (1024 * 1024)).toFixed(2)
            );
            this.emitProgress();
          }

          // Backpressure handling
          if (dc && dc.bufferedAmount > BUFFERED_AMOUNT_HIGH) {
            await waitForBufferDrain(dc);
          }
        }

        if (this.isCancelled || this.isPaused) break;

        // Send piece-end
        this.conn.send({
          type: 'piece-end',
          index: pieceIndex,
        } satisfies FileTransferMsg);

        this.completedPieces.add(pieceIndex);
        debugMetrics.piecesDone = this.completedPieces.size;
        debugMetrics.totalPieces = this.manifest.pieceCount;
        this.emitProgress();
      }

      if (this.completedPieces.size >= this.manifest.pieceCount && !this.isCancelled) {
        this.conn.send({
          type: 'done',
          fingerprint: this.manifest.fingerprint,
        } satisfies FileTransferMsg);
        this.emitProgress();
      }
    } catch (err) {
      console.warn('[Host Transfer] Error streaming piece:', err);
    } finally {
      this.isRunning = false;
    }
  }
}

/**
 * Guest Transfer Receiver
 */
export class GuestTransferReceiver {
  public conn: DataConnection;
  public manifest: MovieManifest | null = null;
  public totalPieces = 0;
  public receivedPieces = new Set<number>();
  public currentPieceBuffer: Uint8Array | null = null;
  public currentPieceIndex: number | null = null;
  public currentPieceHash: string | null = null;
  public bytesReceived = 0;
  public totalBytes = 0;
  public isPaused = false;
  public isCancelled = false;
  public startTime = Date.now();
  public lastSpeedTime = Date.now();
  public lastBytes = 0;
  public currentSpeed = 0;
  public speedHistory: number[] = [];
  public lastPriorityPiece: number | null = null;
  public lastPriorityTime = 0;
  private periodicBitmapInterval: any = null;

  private onProgressCallback?: (progress: TransferProgress) => void;
  private onReadyForLocalPlayback?: (file: File, objectUrl: string) => void;
  private onReadyForProgressivePlayback?: (streamUrl: string) => void;
  private onToast?: (msg: string) => void;

  constructor(
    conn: DataConnection,
    options?: {
      onProgress?: (progress: TransferProgress) => void;
      onReadyForLocalPlayback?: (file: File, objectUrl: string) => void;
      onReadyForProgressivePlayback?: (streamUrl: string) => void;
      onToast?: (msg: string) => void;
    }
  ) {
    this.conn = conn;
    this.onProgressCallback = options?.onProgress;
    this.onReadyForLocalPlayback = options?.onReadyForLocalPlayback;
    this.onReadyForProgressivePlayback = options?.onReadyForProgressivePlayback;
    this.onToast = options?.onToast;

    this.setupConnection();
  }

  public getProgress(): TransferProgress {
    const totalBytes = this.totalBytes || 1;
    const piecesDone = this.receivedPieces.size;
    const bytesTransferred = Math.min(totalBytes, piecesDone * TRANSFER_PIECE_SIZE);
    const percentage = Number(Math.min(100, (bytesTransferred / totalBytes) * 100).toFixed(1));
    const remainingBytes = Math.max(0, totalBytes - bytesTransferred);
    const etaSeconds = this.currentSpeed > 0 ? Math.round(remainingBytes / this.currentSpeed) : 0;

    return {
      fingerprint: this.manifest?.fingerprint || '',
      name: this.manifest?.name || 'Movie',
      totalPieces: this.totalPieces,
      piecesCompleted: piecesDone,
      bytesTransferred,
      totalBytes,
      percentage,
      speedBytesPerSec: this.currentSpeed,
      etaSeconds,
      isPaused: this.isPaused,
      status:
        piecesDone >= this.totalPieces && this.totalPieces > 0
          ? 'completed'
          : this.isPaused
          ? 'paused'
          : this.isCancelled
          ? 'error'
          : 'transferring',
    };
  }

  public emitProgress() {
    this.onProgressCallback?.(this.getProgress());
  }

  private setupConnection() {
    // Phase 3C: Register mesh piece receiver
    meshP2PManager.setPieceReceivedCallback(async (index: number, buffer: ArrayBuffer) => {
      if (!this.manifest || this.receivedPieces.has(index) || this.isCancelled) return;
      const written = await movieStore.writePiece(this.manifest.fingerprint, index, buffer);
      if (written) {
        this.receivedPieces.add(index);
        debugMetrics.piecesDone = this.receivedPieces.size;
        if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: 'piece-stored',
            fingerprint: this.manifest.fingerprint,
            index,
          });
        }
        this.emitProgress();
        meshP2PManager.updateLocalPieces(this.receivedPieces);
        if (this.receivedPieces.size >= this.totalPieces) {
          await this.handleDone(this.manifest.fingerprint);
        }
      }
    });

    // Phase 3C: Periodically update bitmap to host and mesh peers every 3 seconds
    this.periodicBitmapInterval = setInterval(() => {
      if (
        this.manifest &&
        (this.conn as any).open !== false &&
        !this.isCancelled &&
        !this.isPaused &&
        this.receivedPieces.size < this.totalPieces
      ) {
        try {
          this.conn.send({
            type: 'have',
            fingerprint: this.manifest.fingerprint,
            pieces: Array.from(this.receivedPieces),
          } satisfies FileTransferMsg);
        } catch {}
        meshP2PManager.updateLocalPieces(this.receivedPieces);
        this.scheduleMeshPieceFetch();
      }
    }, 3000);

    this.conn.on('data', async (data: any) => {
      const msg = data as FileTransferMsg;
      if (!msg || !msg.type) return;

      switch (msg.type) {
        case 'manifest': {
          const val = validateManifest(msg.manifest);
          if (!val.valid) {
            console.error('[Guest Transfer] Invalid manifest received:', val.error);
            this.cancel();
            this.onToast?.(`Invalid manifest: ${val.error}`);
            return;
          }
          await this.handleManifest(msg.manifest);
          break;
        }

        case 'piece-start': {
          if (!this.manifest) return;
          const { index, hash, size } = msg;
          if (
            typeof index !== 'number' ||
            index < 0 ||
            index >= this.totalPieces ||
            !isValidFingerprint(hash) ||
            typeof size !== 'number' ||
            size <= 0 ||
            size > this.manifest.pieceSize
          ) {
            console.error('[Guest Transfer] Malformed piece-start received');
            this.cancel();
            return;
          }
          this.currentPieceIndex = index;
          this.currentPieceHash = hash;
          this.currentPieceBuffer = new Uint8Array(size);
          break;
        }

        case 'chunk': {
          if (
            this.currentPieceBuffer &&
            this.currentPieceIndex === msg.index &&
            msg.data instanceof ArrayBuffer &&
            typeof msg.offset === 'number' &&
            msg.offset >= 0 &&
            msg.offset + msg.data.byteLength <= this.currentPieceBuffer.byteLength
          ) {
            const chunkView = new Uint8Array(msg.data);
            this.currentPieceBuffer.set(chunkView, msg.offset);
            this.bytesReceived += chunkView.byteLength;

            const now = Date.now();
            if (now - this.lastSpeedTime >= 500) {
              const timeDiff = (now - this.lastSpeedTime) / 1000;
              const bytesDiff = this.bytesReceived - this.lastBytes;
              this.currentSpeed = Math.round(bytesDiff / timeDiff);
              this.lastSpeedTime = now;
              this.lastBytes = this.bytesReceived;

              // Keep last 20 seconds of speed measurements (~40 entries at 500ms intervals)
              this.speedHistory.push(this.currentSpeed);
              if (this.speedHistory.length > 40) {
                this.speedHistory.shift();
              }

              debugMetrics.transferSpeedMbps = Number(
                ((this.currentSpeed * 8) / (1024 * 1024)).toFixed(2)
              );
              this.emitProgress();
            }
          }
          break;
        }

        case 'piece-end': {
          await this.handlePieceEnd(msg.index);
          break;
        }

        case 'done': {
          await this.handleDone(msg.fingerprint);
          break;
        }

        case 'pause': {
          this.isPaused = true;
          this.emitProgress();
          break;
        }

        case 'resume': {
          this.isPaused = false;
          this.emitProgress();
          break;
        }

        case 'cancel': {
          this.isCancelled = true;
          this.emitProgress();
          break;
        }
      }
    });

    this.conn.on('close', () => {
      console.log('[Guest Transfer] Connection closed');
      if (this.periodicBitmapInterval) {
        clearInterval(this.periodicBitmapInterval);
        this.periodicBitmapInterval = null;
      }
    });
  }

  private async handleManifest(manifest: MovieManifest) {
    this.manifest = manifest;
    this.totalPieces = manifest.pieceCount;
    this.totalBytes = manifest.size;

    // Check storage quota and configured storage cap
    const quota = await checkStorageAvailable(manifest.size);
    const cacheAnalysis = await analyzeStorageCache([manifest.fingerprint]);

    if (!quota.ok || cacheAnalysis.usedBytes + manifest.size > cacheAnalysis.configuredLimitBytes) {
      if (cacheAnalysis.candidatesForDeletion.length > 0) {
        this.onToast?.(
          'Storage limit reached. Clean up older movies in settings to free space.'
        );
      } else {
        this.onToast?.(
          'Not enough browser storage for this movie. Staying in live streaming mode.'
        );
      }
      this.cancel();
      return;
    }

    await requestPersistentStorage();

    // Setup Mesh P2P active fingerprint
    meshP2PManager.setActiveFingerprint(manifest.fingerprint);

    // Check if we already have this movie completely
    const stored = await movieStore.getMovie(manifest.fingerprint);
    if (stored && stored.complete) {
      this.receivedPieces = new Set(stored.receivedPieces);
      debugMetrics.storageBackend = stored.storageBackend === 'opfs' ? 'OPFS' : 'IndexedDB';
      await movieStore.updateLastUsed(manifest.fingerprint);

      // Reply have-all
      this.conn.send({
        type: 'have-all',
        fingerprint: manifest.fingerprint,
      } satisfies FileTransferMsg);

      this.emitProgress();

      // Initiate local playback directly
      await this.activateLocalPlayback(manifest.fingerprint, manifest.type);
      return;
    }

    // Initialize or resume record
    const record = await movieStore.initMovieTransfer(
      manifest.fingerprint,
      manifest.name,
      manifest.size,
      manifest.type,
      manifest.pieceSize,
      manifest.pieceCount,
      manifest.duration
    );

    this.receivedPieces = new Set(record.receivedPieces);
    debugMetrics.storageBackend = record.storageBackend === 'opfs' ? 'OPFS' : 'IndexedDB';
    debugMetrics.piecesDone = this.receivedPieces.size;
    debugMetrics.totalPieces = this.totalPieces;

    // Reply with have bitmap
    this.conn.send({
      type: 'have',
      fingerprint: manifest.fingerprint,
      pieces: record.receivedPieces,
    } satisfies FileTransferMsg);

    this.emitProgress();
  }

  private async handlePieceEnd(index: number) {
    if (!this.currentPieceBuffer || this.currentPieceIndex !== index || !this.manifest) {
      return;
    }

    const actualBuffer = this.currentPieceBuffer.slice().buffer as ArrayBuffer;
    const computedHash = await computeBufferHash(actualBuffer);

    if (computedHash !== this.currentPieceHash) {
      console.warn(`[Guest Transfer] Piece ${index} hash mismatch! Requesting resend.`);
      debugMetrics.hashFailures++;
      this.conn.send({ type: 'resend', index } satisfies FileTransferMsg);
      this.currentPieceBuffer = null;
      this.currentPieceIndex = null;
      return;
    }

    // Hash verified: write to store with hash
    const written = await movieStore.writePiece(this.manifest.fingerprint, index, actualBuffer, computedHash);
    if (written) {
      this.receivedPieces.add(index);
      debugMetrics.piecesDone = this.receivedPieces.size;

      // Notify service worker that piece is stored
      if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'piece-stored',
          fingerprint: this.manifest.fingerprint,
          index,
        });
      }

      this.emitProgress();

      // Broadcast updated piece bitmap to mesh peers
      meshP2PManager.updateLocalPieces(this.receivedPieces);

      if (this.receivedPieces.size >= this.totalPieces) {
        const record = await movieStore.getMovie(this.manifest.fingerprint);
        if (record && !record.complete) {
          const hashes = record.pieceHashes || {};
          let allValid = true;
          for (let i = 0; i < this.totalPieces; i++) {
            if (!hashes[i]) {
              allValid = false;
              break;
            }
          }
          if (allValid) {
            if (this.manifest.fullFileHash) {
              const computedFullHash = await computeCombinedFullHash(hashes, this.totalPieces);
              if (computedFullHash.toLowerCase() !== this.manifest.fullFileHash.toLowerCase()) {
                console.error('[Guest Transfer] Full-file hash verification failed!');
                this.onToast?.('Full file integrity verification failed. Transfer corrupted.');
                this.cancel();
                return;
              }
            }
            await this.handleDone(this.manifest.fingerprint);
          }
        }
      }
    } else {
      this.conn.send({ type: 'resend', index } satisfies FileTransferMsg);
    }

    this.currentPieceBuffer = null;
    this.currentPieceIndex = null;
  }

  public sendPriorityRequest(fromPiece: number) {
    const now = Date.now();
    // Debounce to 300 ms
    if (this.lastPriorityPiece === fromPiece && now - this.lastPriorityTime < 300) {
      return;
    }
    this.lastPriorityPiece = fromPiece;
    this.lastPriorityTime = now;

    try {
      this.conn.send({
        type: 'priority',
        fromPiece,
      } satisfies FileTransferMsg);
    } catch (e) {
      console.warn('[Guest Transfer] Error sending priority request:', e);
    }
  }

  private async handleDone(fingerprint: string) {
    if (!this.manifest) return;
    await movieStore.markComplete(fingerprint);
    this.onToast?.(`Downloaded "${this.manifest.name}" successfully!`);
    await this.activateLocalPlayback(fingerprint, this.manifest.type);
  }

  private async activateLocalPlayback(fingerprint: string, mimeType: string) {
    try {
      const file = await movieStore.getMovieFile(fingerprint);
      if (!file) {
        this.onToast?.('Could not load downloaded file, staying on live stream.');
        return;
      }

      // Check decodability
      const decodable = await verifyDecodability(file, mimeType);
      if (!decodable) {
        this.onToast?.(
          "This device can't play the downloaded file, staying on live stream"
        );
        return;
      }

      const objectUrl = URL.createObjectURL(file);
      debugMetrics.playbackMode = 'local-complete';
      this.onReadyForLocalPlayback?.(file, objectUrl);
    } catch (err) {
      console.warn('[Guest Transfer] Error activating local playback:', err);
      this.onToast?.('Failed to switch to local playback, staying on live stream.');
    }
  }

  public cancel() {
    this.isCancelled = true;
    if (this.periodicBitmapInterval) {
      clearInterval(this.periodicBitmapInterval);
      this.periodicBitmapInterval = null;
    }
    try {
      this.conn.send({ type: 'cancel' } satisfies FileTransferMsg);
    } catch {}
    this.emitProgress();
  }

  private scheduleMeshPieceFetch() {
    if (
      !this.manifest ||
      this.isPaused ||
      this.isCancelled ||
      this.receivedPieces.size >= this.totalPieces
    ) {
      return;
    }
    if (meshP2PManager.getConnectedPeerCount() === 0) return;

    // Scan for missing pieces to fetch from mesh peers
    for (let i = 0; i < this.totalPieces; i++) {
      if (!this.receivedPieces.has(i)) {
        const scheduled = meshP2PManager.requestPieceFromMesh(i, () => {
          // On failure or 5s timeout, fall back to host as source of truth
          if (!this.receivedPieces.has(i) && !this.isCancelled) {
            try {
              this.conn.send({ type: 'resend', index: i } satisfies FileTransferMsg);
            } catch {}
          }
        });
        if (scheduled) {
          break; // Request one at a time to keep throughput steady
        }
      }
    }
  }
}

/**
 * Global FileTransferManager coordinating Host and Guest
 */
export class FileTransferManager {
  private static instance: FileTransferManager;

  // Host state
  private hostFile: File | null = null;
  private hostManifest: MovieManifest | null = null;
  private activeHostTransfers: Map<string, HostGuestTransfer> = new Map();
  private hostTransferQueue: Array<{ peerId: string; conn: DataConnection }> = [];
  private pausePlaybackWhileSending = true;
  private wakeLockSentinel: any = null;

  // Guest state
  private guestReceiver: GuestTransferReceiver | null = null;
  private guestLocalFile: File | null = null;
  private guestLocalObjectUrl: string | null = null;
  private guestPlaybackMode: 'live' | 'local' = 'live';

  // Listeners
  private progressListeners: Set<(progress: TransferProgress | null) => void> = new Set();
  private localModeListeners: Set<(isLocal: boolean, objectUrl?: string) => void> = new Set();
  private toastListener?: (msg: string) => void;

  public static getInstance(): FileTransferManager {
    if (!FileTransferManager.instance) {
      FileTransferManager.instance = new FileTransferManager();
    }
    return FileTransferManager.instance;
  }

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (
          document.visibilityState === 'hidden' &&
          (this.isHostTransferring() || this.isGuestTransferring())
        ) {
          this.toastListener?.('Keep this tab open and visible for fast movie transfer');
        }
      });
    }

    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        const data = event.data;
        if (data && data.type === 'priority-piece-needed' && typeof data.pieceIndex === 'number') {
          debugMetrics.pendingRangeRequests++;
          if (this.guestReceiver) {
            this.guestReceiver.sendPriorityRequest(data.pieceIndex);
          }
        }
      });
    }
  }

  public setToastListener(cb: (msg: string) => void) {
    this.toastListener = cb;
  }

  public onProgress(cb: (progress: TransferProgress | null) => void): () => void {
    this.progressListeners.add(cb);
    return () => this.progressListeners.delete(cb);
  }

  public onLocalMode(cb: (isLocal: boolean, objectUrl?: string) => void): () => void {
    this.localModeListeners.add(cb);
    return () => this.localModeListeners.delete(cb);
  }

  public getPlaybackMode(): 'live' | 'local' {
    return this.guestPlaybackMode;
  }

  public getGuestLocalObjectUrl(): string | null {
    return this.guestLocalObjectUrl;
  }

  public isHostTransferring(): boolean {
    return this.activeHostTransfers.size > 0;
  }

  public isGuestTransferring(): boolean {
    if (!this.guestReceiver) return false;
    const p = this.guestReceiver.getProgress();
    return p.status === 'transferring';
  }

  public getHostTransfers(): HostGuestTransfer[] {
    return Array.from(this.activeHostTransfers.values());
  }

  public getPausePlaybackWhileSending(): boolean {
    return this.pausePlaybackWhileSending;
  }

  public setPausePlaybackWhileSending(val: boolean) {
    this.pausePlaybackWhileSending = val;
  }

  // Handle incoming dedicated movie-file-transfer connection
  public handleIncomingConnection(conn: DataConnection, isHost: boolean) {
    if (isHost) {
      // Guest connected to host for file transfer
      if (this.hostFile && this.hostManifest) {
        this.enqueueHostTransfer(conn.peer, conn);
      }
    } else {
      // Host connected to guest for file transfer
      this.guestReceiver = new GuestTransferReceiver(conn, {
        onProgress: (progress) => {
          this.progressListeners.forEach((cb) => cb(progress));
        },
        onReadyForLocalPlayback: (_file, objectUrl) => {
          this.guestLocalFile = _file;
          this.guestLocalObjectUrl = objectUrl;
          this.guestPlaybackMode = 'local';
          debugMetrics.playbackMode = 'local-complete';
          this.localModeListeners.forEach((cb) => cb(true, objectUrl));
        },
        onReadyForProgressivePlayback: (streamUrl) => {
          this.guestLocalObjectUrl = streamUrl;
          this.guestPlaybackMode = 'local';
          debugMetrics.playbackMode = 'local-progressive';
          this.localModeListeners.forEach((cb) => cb(true, streamUrl));
        },
        onToast: (msg) => this.toastListener?.(msg),
      });
    }
  }

  public getGuestReceiver(): GuestTransferReceiver | null {
    return this.guestReceiver;
  }

  public activateProgressiveMode(streamUrl: string) {
    this.guestLocalObjectUrl = streamUrl;
    this.guestPlaybackMode = 'local';
    debugMetrics.playbackMode = 'local-progressive';
    this.localModeListeners.forEach((cb) => cb(true, streamUrl));
  }

  // Host starts transfer of file to all viewers
  public async startHostFileTransfer(
    file: File,
    guestPeerIds: string[],
    peer: any,
    mediaDuration?: number
  ) {
    this.hostFile = file;

    // Compute fingerprint and full-file hash
    const fingerprint = await computeFileFingerprint(file);
    const pieceCount = Math.ceil(file.size / TRANSFER_PIECE_SIZE);

    const pieceHashes: Record<number, string> = {};
    for (let i = 0; i < pieceCount; i++) {
      const start = i * TRANSFER_PIECE_SIZE;
      const end = Math.min(file.size, start + TRANSFER_PIECE_SIZE);
      const slice = await file.slice(start, end).arrayBuffer();
      pieceHashes[i] = await computeBufferHash(slice);
    }
    const fullFileHash = await computeCombinedFullHash(pieceHashes, pieceCount);

    this.hostManifest = {
      fingerprint,
      name: file.name,
      size: file.size,
      type: file.type || 'video/mp4',
      pieceSize: TRANSFER_PIECE_SIZE,
      pieceCount,
      duration: mediaDuration,
      fullFileHash,
    };

    // Request wake lock
    this.acquireWakeLock();

    // Connect to each guest
    for (const guestId of guestPeerIds) {
      if (!this.activeHostTransfers.has(guestId)) {
        try {
          const conn = peer.connect(guestId, {
            label: 'movie-file-transfer',
            reliable: true,
          });

          conn.on('open', () => {
            this.enqueueHostTransfer(guestId, conn);
          });
        } catch (err) {
          console.warn('[Host Transfer] Failed to connect to guest:', guestId, err);
        }
      }
    }
  }

  private enqueueHostTransfer(guestId: string, conn: DataConnection) {
    if (!this.hostFile || !this.hostManifest) return;

    if (this.activeHostTransfers.size >= 2) {
      this.hostTransferQueue.push({ peerId: guestId, conn });
      return;
    }

    this.startGuestSession(guestId, conn);
  }

  private startGuestSession(guestId: string, conn: DataConnection) {
    if (!this.hostFile || !this.hostManifest) return;

    const session = new HostGuestTransfer(
      guestId,
      conn,
      this.hostFile,
      this.hostManifest,
      (progress) => {
        this.progressListeners.forEach((cb) => cb(progress));
      }
    );

    this.activeHostTransfers.set(guestId, session);

    // Listen for guest responses
    conn.on('data', (data: any) => {
      const msg = data as FileTransferMsg;
      if (!msg) return;

      if (msg.type === 'have-all') {
        session.completedPieces = new Set(
          Array.from({ length: this.hostManifest!.pieceCount }, (_, i) => i)
        );
        session.emitProgress();
        this.finishHostTransfer(guestId);
      } else if (msg.type === 'have') {
        session.startSending(new Set(msg.pieces));
      } else if (msg.type === 'resend') {
        session.requestResend(msg.index);
      } else if (msg.type === 'priority') {
        session.requestPriorityPieces(msg.fromPiece);
      } else if (msg.type === 'cancel') {
        this.finishHostTransfer(guestId);
      }
    });

    conn.on('close', () => {
      this.finishHostTransfer(guestId);
    });

    // Send manifest
    conn.send({
      type: 'manifest',
      manifest: this.hostManifest,
    } satisfies FileTransferMsg);
  }

  private finishHostTransfer(guestId: string) {
    this.activeHostTransfers.delete(guestId);

    // Pick next from queue
    if (this.hostTransferQueue.length > 0) {
      const next = this.hostTransferQueue.shift();
      if (next) {
        this.startGuestSession(next.peerId, next.conn);
      }
    }

    if (this.activeHostTransfers.size === 0) {
      this.releaseWakeLock();
    }
  }

  public pauseHostTransfer(guestId?: string) {
    if (guestId) {
      this.activeHostTransfers.get(guestId)?.pause();
    } else {
      this.activeHostTransfers.forEach((s) => s.pause());
    }
  }

  public resumeHostTransfer(guestId?: string) {
    if (guestId) {
      this.activeHostTransfers.get(guestId)?.resume();
    } else {
      this.activeHostTransfers.forEach((s) => s.resume());
    }
  }

  public cancelHostTransfer(guestId?: string) {
    if (guestId) {
      const session = this.activeHostTransfers.get(guestId);
      session?.cancel();
      this.finishHostTransfer(guestId);
    } else {
      this.activeHostTransfers.forEach((s) => s.cancel());
      this.activeHostTransfers.clear();
      this.hostTransferQueue = [];
      this.releaseWakeLock();
      this.progressListeners.forEach((cb) => cb(null));
    }
  }

  public cancelGuestDownload() {
    if (this.guestReceiver) {
      this.guestReceiver.cancel();
      this.guestReceiver = null;
      this.progressListeners.forEach((cb) => cb(null));
    }
  }

  public revertToLiveStream() {
    if (this.guestLocalObjectUrl) {
      try {
        URL.revokeObjectURL(this.guestLocalObjectUrl);
      } catch {}
      this.guestLocalObjectUrl = null;
    }
    this.guestLocalFile = null;
    this.guestPlaybackMode = 'live';
    debugMetrics.playbackMode = 'live';
    this.localModeListeners.forEach((cb) => cb(false));
  }

  public cleanup() {
    this.cancelHostTransfer();
    this.cancelGuestDownload();
    this.revertToLiveStream();
    this.releaseWakeLock();
  }

  private async acquireWakeLock() {
    try {
      if ('wakeLock' in navigator && !this.wakeLockSentinel) {
        this.wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
      }
    } catch {}
  }

  private releaseWakeLock() {
    if (this.wakeLockSentinel) {
      try {
        this.wakeLockSentinel.release();
      } catch {}
      this.wakeLockSentinel = null;
    }
  }
}

export const fileTransferManager = FileTransferManager.getInstance();
