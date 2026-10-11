/**
 * Mesh P2P Piece Sharing Between Guests (Phase 3C).
 * Enables guests to exchange pieces directly over WebRTC DataConnections
 * when 2 or more guests are present in the room, reducing host upload.
 * Capped at 3 peer-to-peer connections per guest, with 5s host fallback.
 */

import { DataConnection } from 'peerjs';
import { computeBufferHash } from './fileTransfer';
import { movieStore } from './movieStore';

export interface MeshPieceMessage {
  type: 'mesh-have' | 'mesh-request' | 'mesh-piece' | 'mesh-piece-ack';
  fingerprint: string;
  pieces?: number[];
  index?: number;
  data?: ArrayBuffer;
  hash?: string;
}

export interface PeerMeshNode {
  peerId: string;
  conn: DataConnection;
  havePieces: Set<number>;
  latencyMs: number;
}

export class MeshP2PTransferManager {
  private static instance: MeshP2PTransferManager;

  private peerNodes: Map<string, PeerMeshNode> = new Map();
  private pendingRequests: Map<number, { peerId: string; timestamp: number; timeoutTimer: any }> = new Map();
  private localReceivedPieces: Set<number> = new Set();
  private activeFingerprint: string | null = null;
  private onPieceReceivedCallback?: (index: number, buffer: ArrayBuffer) => void;

  public static getInstance(): MeshP2PTransferManager {
    if (!MeshP2PTransferManager.instance) {
      MeshP2PTransferManager.instance = new MeshP2PTransferManager();
    }
    return MeshP2PTransferManager.instance;
  }

  public setPieceReceivedCallback(cb: (index: number, buffer: ArrayBuffer) => void) {
    this.onPieceReceivedCallback = cb;
  }

  public setActiveFingerprint(fingerprint: string) {
    this.activeFingerprint = fingerprint;
  }

  public updateLocalPieces(pieces: Set<number>) {
    this.localReceivedPieces = new Set(pieces);
    this.broadcastHaveBitmap();
  }

  /**
   * Connect to another guest peer (max 3 connections)
   */
  public registerPeerConnection(peerId: string, conn: DataConnection) {
    if (this.peerNodes.size >= 3 || this.peerNodes.has(peerId)) {
      return;
    }

    const node: PeerMeshNode = {
      peerId,
      conn,
      havePieces: new Set(),
      latencyMs: 100,
    };

    this.peerNodes.set(peerId, node);

    conn.on('data', async (raw: any) => {
      const msg = raw as MeshPieceMessage;
      if (!msg || !msg.type || msg.fingerprint !== this.activeFingerprint) return;

      switch (msg.type) {
        case 'mesh-have': {
          if (Array.isArray(msg.pieces)) {
            node.havePieces = new Set(msg.pieces);
          }
          break;
        }

        case 'mesh-request': {
          // Send piece from local store if we have it
          if (typeof msg.index === 'number' && this.localReceivedPieces.has(msg.index)) {
            this.sendPieceToPeer(node, msg.index);
          }
          break;
        }

        case 'mesh-piece': {
          if (typeof msg.index === 'number' && msg.data && msg.hash) {
            await this.handleIncomingMeshPiece(msg.index, msg.data, msg.hash, node);
          }
          break;
        }
      }
    });

    conn.on('close', () => {
      this.peerNodes.delete(peerId);
    });

    // Send initial bitmap
    this.sendBitmapToPeer(node);
  }

  private broadcastHaveBitmap() {
    if (!this.activeFingerprint) return;
    const piecesArr = Array.from(this.localReceivedPieces);
    this.peerNodes.forEach((node) => {
      try {
        node.conn.send({
          type: 'mesh-have',
          fingerprint: this.activeFingerprint!,
          pieces: piecesArr,
        } satisfies MeshPieceMessage);
      } catch {}
    });
  }

  private sendBitmapToPeer(node: PeerMeshNode) {
    if (!this.activeFingerprint) return;
    try {
      node.conn.send({
        type: 'mesh-have',
        fingerprint: this.activeFingerprint,
        pieces: Array.from(this.localReceivedPieces),
      } satisfies MeshPieceMessage);
    } catch {}
  }

  private async sendPieceToPeer(node: PeerMeshNode, index: number) {
    if (!this.activeFingerprint) return;
    try {
      const record = await movieStore.getMovie(this.activeFingerprint);
      if (!record) return;

      const diskPiece = await movieStore.getMovieFile(this.activeFingerprint);
      if (diskPiece) {
        const pieceStart = index * (record.pieceSize || 1024 * 1024);
        const pieceEnd = Math.min(diskPiece.size, pieceStart + (record.pieceSize || 1024 * 1024));
        const buf = await diskPiece.slice(pieceStart, pieceEnd).arrayBuffer();
        const hash = await computeBufferHash(buf);

        node.conn.send({
          type: 'mesh-piece',
          fingerprint: this.activeFingerprint,
          index,
          data: buf,
          hash,
        } satisfies MeshPieceMessage);
      }
    } catch (e) {
      console.warn('[MeshP2P] Failed to send piece to peer:', e);
    }
  }

  /**
   * Request piece from the fastest available peer having it
   */
  public requestPieceFromMesh(
    index: number,
    onFallbackToHost: () => void
  ): boolean {
    if (this.peerNodes.size === 0 || this.pendingRequests.has(index)) {
      return false;
    }

    // Find peer with the piece and lowest latency
    let bestPeer: PeerMeshNode | null = null;
    this.peerNodes.forEach((node) => {
      if (node.havePieces.has(index)) {
        if (!bestPeer || node.latencyMs < bestPeer.latencyMs) {
          bestPeer = node;
        }
      }
    });

    if (!bestPeer) return false;

    // Timeout: 5 seconds before falling back to host
    const timer = setTimeout(() => {
      this.pendingRequests.delete(index);
      onFallbackToHost();
    }, 5000);

    this.pendingRequests.set(index, {
      peerId: (bestPeer as PeerMeshNode).peerId,
      timestamp: Date.now(),
      timeoutTimer: timer,
    });

    try {
      (bestPeer as PeerMeshNode).conn.send({
        type: 'mesh-request',
        fingerprint: this.activeFingerprint || '',
        index,
      } satisfies MeshPieceMessage);
      return true;
    } catch {
      clearTimeout(timer);
      this.pendingRequests.delete(index);
      return false;
    }
  }

  private async handleIncomingMeshPiece(
    index: number,
    data: ArrayBuffer,
    expectedHash: string,
    node: PeerMeshNode
  ) {
    const pending = this.pendingRequests.get(index);
    if (pending) {
      clearTimeout(pending.timeoutTimer);
      this.pendingRequests.delete(index);
    }

    // Measure latency
    if (pending) {
      node.latencyMs = Date.now() - pending.timestamp;
    }

    // Hash check
    const actualHash = await computeBufferHash(data);
    if (actualHash !== expectedHash) {
      console.warn(`[MeshP2P] Hash check failed for piece ${index} from peer ${node.peerId}`);
      return;
    }

    // Successfully verified piece from mesh
    this.onPieceReceivedCallback?.(index, data);
  }

  public getConnectedPeerCount(): number {
    return this.peerNodes.size;
  }

  public cleanup() {
    this.pendingRequests.forEach((req) => clearTimeout(req.timeoutTimer));
    this.pendingRequests.clear();
    this.peerNodes.clear();
  }
}

export const meshP2PManager = MeshP2PTransferManager.getInstance();
