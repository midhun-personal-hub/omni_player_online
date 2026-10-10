import { Peer, DataConnection, MediaConnection } from 'peerjs';
import { ChatMessage } from '../types/chat';

export type WatchPartyStatus =
  | 'idle'
  | 'creating'
  | 'waiting'
  | 'connected'
  | 'error'
  | 'closed';

export type WatchPartyRole = 'host' | 'guest' | null;

export type WatchPartyCommand =
  | {
      type: 'heartbeat';
      timestamp: number;
      isPlaying: boolean;
      currentTime: number;
      duration: number;
      playbackRate: number;
      mediaName: string;
      isAudio: boolean;
      allowGuestControl: boolean;
    }
  | {
      type: 'state';
      isPlaying: boolean;
      currentTime: number;
      duration: number;
      playbackRate: number;
      mediaName: string;
      isAudio: boolean;
      allowGuestControl: boolean;
    }
  | {
      type: 'control';
      action: 'play' | 'pause' | 'seek' | 'rate';
      time?: number;
      rate?: number;
    }
  | {
      type: 'request-state';
    }
  | {
      type: 'subtitles';
      track: {
        name: string;
        cues: Array<{ id: string; startTime: number; endTime: number; text: string }>;
        delaySeconds: number;
      } | null;
    }
  | {
      type: 'room-full';
    }
  | {
      type: 'host-closed';
    }
  | {
      type: 'guest-left';
    }
  | {
      type: 'chat';
      text: string;
    }
  | {
      type: 'chat-msg';
      msg: ChatMessage;
    }
  | {
      type: 'chat-history';
      messages: ChatMessage[];
    }
  | {
      type: 'chat-error';
      reason: string;
    }
  | {
      type: 'hello';
      name: string;
    }
  | {
      type: 'rename';
      name: string;
    }
  | {
      type: 'roster';
      peers: Array<{ id: string; name: string }>;
    }
  | {
      type: 'media-state';
      senderId?: string;
      camOn: boolean;
      micOn: boolean;
    }
  | {
      type: 'call-join';
      peerId?: string;
    }
  | {
      type: 'call-leave';
      peerId?: string;
    };

export interface WatchPartyStateBroadcast {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  mediaName: string;
  isAudio: boolean;
  allowGuestControl: boolean;
}

export function generateRoomCode(): string {
  // 6 chars alphanumeric without ambiguous characters (no 0, O, 1, I)
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function getIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ];

  const turnUrl = import.meta.env.VITE_TURN_URL;
  if (turnUrl) {
    const turnServer: RTCIceServer = { urls: turnUrl };
    const turnUser = import.meta.env.VITE_TURN_USER;
    const turnPass = import.meta.env.VITE_TURN_PASS;
    if (turnUser) turnServer.username = turnUser;
    if (turnPass) turnServer.credential = turnPass;
    servers.push(turnServer);
  }
  return servers;
}

async function limitBitrate(pc: RTCPeerConnection | undefined, maxBitrateBps: number = 3_500_000) {
  if (!pc) return;
  try {
    const senders = pc.getSenders();
    for (const sender of senders) {
      if (sender.track && sender.track.kind === 'video') {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        params.encodings[0].maxBitrate = maxBitrateBps;
        await sender.setParameters(params);
      }
    }
  } catch (err) {
    // Non-fatal if browser/connection doesn't support bitrate clamping
    console.debug('Bitrate clamping info:', err);
  }
}

export class WatchPartyService {
  private peer: Peer | null = null;
  private role: WatchPartyRole = null;
  private roomCode: string | null = null;
  private status: WatchPartyStatus = 'idle';
  private errorMessage: string | null = null;

  // Host state
  private dataConnections: Map<string, DataConnection> = new Map();
  private mediaCalls: Map<string, MediaConnection> = new Map();
  private currentStream: MediaStream | null = null;
  private guestCount = 0;
  private clientNames: Map<string, string> = new Map();
  private hostDisplayName: string = 'Host';

  // Guest state
  private guestDataConn: DataConnection | null = null;
  private guestIncomingStream: MediaStream | null = null;
  private pendingGuestCommands: WatchPartyCommand[] = [];

  // Event callbacks
  private commandListeners: Set<(cmd: WatchPartyCommand, senderPeerId: string) => void> = new Set();
  private streamListeners: Set<(stream: MediaStream) => void> = new Set();
  private statusListeners: Set<(status: WatchPartyStatus, errorMsg?: string) => void> = new Set();
  private viewerCountListeners: Set<(count: number) => void> = new Set();
  private friendJoinedListeners: Set<(peerId: string) => void> = new Set();
  private friendLeftListeners: Set<(peerId: string) => void> = new Set();
  private cameraCallListeners: Set<(call: MediaConnection) => void> = new Set();
  private rosterListeners: Set<(peers: Array<{ id: string; name: string }>) => void> = new Set();

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.leave();
      });
    }
  }

  public getRole(): WatchPartyRole {
    return this.role;
  }

  public getRoomCode(): string | null {
    return this.roomCode;
  }

  public getStatus(): WatchPartyStatus {
    return this.status;
  }

  public getErrorMessage(): string | null {
    return this.errorMessage;
  }

  public getViewerCount(): number {
    return this.guestCount;
  }

  public getIncomingStream(): MediaStream | null {
    return this.guestIncomingStream;
  }

  public getMyPeerId(): string | null {
    return this.peer?.id || (this.role === 'host' ? 'host' : null);
  }

  private setStatus(newStatus: WatchPartyStatus, errorMsg?: string) {
    this.status = newStatus;
    this.errorMessage = errorMsg || null;
    this.statusListeners.forEach((cb) => cb(newStatus, errorMsg));
  }

  private setViewerCount(count: number) {
    this.guestCount = count;
    this.viewerCountListeners.forEach((cb) => cb(count));
  }

  public onCommand(cb: (cmd: WatchPartyCommand, senderPeerId: string) => void): () => void {
    this.commandListeners.add(cb);
    return () => this.commandListeners.delete(cb);
  }

  public onStream(cb: (stream: MediaStream) => void): () => void {
    this.streamListeners.add(cb);
    if (this.guestIncomingStream) {
      cb(this.guestIncomingStream);
    }
    return () => this.streamListeners.delete(cb);
  }

  public onStatus(cb: (status: WatchPartyStatus, errorMsg?: string) => void): () => void {
    this.statusListeners.add(cb);
    cb(this.status, this.errorMessage || undefined);
    return () => this.statusListeners.delete(cb);
  }

  public onViewerCount(cb: (count: number) => void): () => void {
    this.viewerCountListeners.add(cb);
    cb(this.guestCount);
    return () => this.viewerCountListeners.delete(cb);
  }

  public onFriendJoined(cb: (peerId: string) => void): () => void {
    this.friendJoinedListeners.add(cb);
    return () => this.friendJoinedListeners.delete(cb);
  }

  public onFriendLeft(cb: (peerId: string) => void): () => void {
    this.friendLeftListeners.add(cb);
    return () => this.friendLeftListeners.delete(cb);
  }

  public getPeer(): Peer | null {
    return this.peer;
  }

  public onCameraCall(cb: (call: MediaConnection) => void): () => void {
    this.cameraCallListeners.add(cb);
    return () => this.cameraCallListeners.delete(cb);
  }

  public onRoster(cb: (peers: Array<{ id: string; name: string }>) => void): () => void {
    this.rosterListeners.add(cb);
    return () => this.rosterListeners.delete(cb);
  }

  public setHostDisplayName(name: string) {
    this.hostDisplayName = name;
    if (this.role === 'host') {
      this.broadcastRoster();
    }
  }

  public setClientName(peerId: string, name: string) {
    this.clientNames.set(peerId, name);
    if (this.role === 'host') {
      this.broadcastRoster();
    }
  }

  public broadcastRoster(): void {
    const peers: Array<{ id: string; name: string }> = [];
    if (this.peer && this.peer.id) {
      peers.push({ id: this.peer.id, name: this.hostDisplayName });
    }
    for (const [id, name] of this.clientNames.entries()) {
      peers.push({ id, name });
    }
    const cmd: WatchPartyCommand = { type: 'roster', peers };
    this.sendCommand(cmd);
    this.rosterListeners.forEach((cb) => cb(peers));
  }

  public setCurrentMediaStream(stream: MediaStream | null) {
    this.currentStream = stream;
    if (this.role === 'host' && stream) {
      this.replaceMediaStream(stream);
    }
  }

  public async createRoom(retryCount = 0): Promise<string> {
    this.leave();

    const code = generateRoomCode();
    const peerId = `omniplay-v1-${code}`;

    this.role = 'host';
    this.roomCode = code;
    this.setStatus('creating');

    return new Promise((resolve, reject) => {
      try {
        const iceServers = getIceServers();
        this.peer = new Peer(peerId, {
          config: { iceServers },
          debug: 1,
        });

        const setupTimeout = setTimeout(() => {
          if (this.status === 'creating') {
            const err = 'Peer connection timed out. Please check your internet connection.';
            this.setStatus('error', err);
            reject(new Error(err));
          }
        }, 15000);

        this.peer.on('open', () => {
          clearTimeout(setupTimeout);
          this.setStatus('waiting');
          resolve(code);
        });

        this.peer.on('connection', (conn: DataConnection) => {
          this.handleIncomingGuestConnection(conn);
        });

        this.peer.on('call', (call: MediaConnection) => {
          if (call.metadata?.kind === 'cam') {
            this.cameraCallListeners.forEach((cb) => cb(call));
          } else {
            call.close();
          }
        });

        this.peer.on('error', (err: { type?: string; message?: string }) => {
          clearTimeout(setupTimeout);
          console.warn('Host peer error:', err);

          // Handle ID collision by re-trying with new code
          if (err.type === 'unavailable-id' && retryCount < 3) {
            this.peer?.destroy();
            this.peer = null;
            this.createRoom(retryCount + 1).then(resolve).catch(reject);
            return;
          }

          let friendlyMsg = 'Failed to create room. Peer server error.';
          if (err.type === 'network' || err.type === 'server-error') {
            friendlyMsg = 'Peer server unreachable. Check your network.';
          } else if (err.message) {
            friendlyMsg = err.message;
          }

          this.setStatus('error', friendlyMsg);
          reject(new Error(friendlyMsg));
        });

        this.peer.on('close', () => {
          if (this.status !== 'closed') {
            this.setStatus('closed');
          }
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Unknown error creating room';
        this.setStatus('error', msg);
        reject(new Error(msg));
      }
    });
  }

  private handleIncomingGuestConnection(conn: DataConnection) {
    // Check max guest limit: max 3 guests
    if (this.dataConnections.size >= 3) {
      conn.on('open', () => {
        try {
          conn.send({ type: 'room-full' } satisfies WatchPartyCommand);
        } catch {
          // ignore
        }
        setTimeout(() => conn.close(), 500);
      });
      return;
    }

    conn.on('open', () => {
      this.dataConnections.set(conn.peer, conn);
      if (!this.clientNames.has(conn.peer)) {
        this.clientNames.set(conn.peer, 'Guest ' + (this.clientNames.size + 1));
      }
      this.setViewerCount(this.dataConnections.size);
      this.setStatus('connected');
      this.friendJoinedListeners.forEach((cb) => cb(conn.peer));
      this.broadcastRoster();

      // If host has an active stream, call the guest now
      if (this.peer && this.currentStream) {
        try {
          const call = this.peer.call(conn.peer, this.currentStream, {
            metadata: { kind: 'movie' },
          });
          this.mediaCalls.set(conn.peer, call);
          call.on('close', () => {
            this.mediaCalls.delete(conn.peer);
          });
          call.on('error', (e) => console.warn('Call error with peer:', conn.peer, e));

          setTimeout(() => {
            limitBitrate(call.peerConnection);
          }, 800);
        } catch (e) {
          console.warn('Failed to call guest:', e);
        }
      }
    });

    conn.on('data', (data) => {
      const cmd = data as WatchPartyCommand;
      this.commandListeners.forEach((cb) => cb(cmd, conn.peer));
    });

    conn.on('close', () => {
      const peerId = conn.peer;
      this.dataConnections.delete(peerId);
      this.clientNames.delete(peerId);
      this.broadcastRoster();
      const call = this.mediaCalls.get(peerId);
      if (call) {
        call.close();
        this.mediaCalls.delete(peerId);
      }
      this.setViewerCount(this.dataConnections.size);
      this.friendLeftListeners.forEach((cb) => cb(peerId));

      if (this.dataConnections.size === 0 && this.status === 'connected') {
        this.setStatus('waiting');
      }
    });

    conn.on('error', (err) => {
      console.warn('Guest connection error:', err);
      this.dataConnections.delete(conn.peer);
      this.setViewerCount(this.dataConnections.size);
    });
  }

  public async joinRoom(rawCode: string, initialName?: string): Promise<void> {
    this.leave();

    const code = rawCode.trim().toUpperCase();
    if (code.length !== 6) {
      throw new Error('Room code must be exactly 6 characters.');
    }

    const hostPeerId = `omniplay-v1-${code}`;
    this.role = 'guest';
    this.roomCode = code;
    this.setStatus('creating');

    return new Promise((resolve, reject) => {
      try {
        const iceServers = getIceServers();
        // Client connects with random peer ID
        this.peer = new Peer({
          config: { iceServers },
          debug: 1,
        });

        const connTimeout = setTimeout(() => {
          if (this.status !== 'connected') {
            const err = 'Connection timed out. Host may be offline or code is invalid.';
            this.setStatus('error', err);
            reject(new Error(err));
          }
        }, 12000);

        this.peer.on('open', () => {
          if (!this.peer) return;

          // Connect data channel to host
          const conn = this.peer.connect(hostPeerId, {
            reliable: true,
          });
          this.guestDataConn = conn;

          conn.on('open', () => {
            clearTimeout(connTimeout);
            this.setStatus('connected');
            this.setViewerCount(1);
            try {
              if (initialName) {
                conn.send({ type: 'hello', name: initialName } satisfies WatchPartyCommand);
              }
              conn.send({ type: 'request-state' } satisfies WatchPartyCommand);

              // Flush any commands buffered before connection was established
              while (this.pendingGuestCommands.length > 0) {
                const pending = this.pendingGuestCommands.shift();
                if (pending) {
                  conn.send(pending);
                }
              }
            } catch {
              // ignore
            }
            resolve();
          });

          conn.on('data', (data) => {
            const cmd = data as WatchPartyCommand;
            if (cmd.type === 'room-full') {
              this.setStatus('error', 'Room is full (maximum 3 viewers allowed).');
              return;
            }
            if (cmd.type === 'host-closed') {
              this.setStatus('closed', 'Host left the room.');
              return;
            }
            if (cmd.type === 'roster') {
              this.rosterListeners.forEach((cb) => cb(cmd.peers));
            }
            this.commandListeners.forEach((cb) => cb(cmd, 'host'));
          });

          conn.on('close', () => {
            if (this.status !== 'error') {
              this.setStatus('closed', 'Host left the room or disconnected.');
            }
          });

          conn.on('error', (err) => {
            clearTimeout(connTimeout);
            const msg = err.message || 'Error connecting to host.';
            this.setStatus('error', msg);
            reject(new Error(msg));
          });
        });

        // Listen for media stream call from host or camera call from peers
        this.peer.on('call', (mediaConn: MediaConnection) => {
          if (mediaConn.metadata?.kind === 'cam') {
            this.cameraCallListeners.forEach((cb) => cb(mediaConn));
          } else {
            mediaConn.answer();
            mediaConn.on('stream', (stream: MediaStream) => {
              this.guestIncomingStream = stream;
              this.streamListeners.forEach((cb) => cb(stream));
            });
            mediaConn.on('error', (e) => console.warn('Guest media call error:', e));
          }
        });

        this.peer.on('error', (err: { type?: string; message?: string }) => {
          clearTimeout(connTimeout);
          console.warn('Guest peer error:', err);

          let friendlyMsg = 'Failed to join room.';
          if (err.type === 'peer-unavailable') {
            friendlyMsg = 'Room not found. Check the code or host might be offline.';
          } else if (err.type === 'network' || err.type === 'server-error') {
            friendlyMsg = 'PeerJS network error. Please verify your connection.';
          } else if (err.message) {
            friendlyMsg = err.message;
          }

          this.setStatus('error', friendlyMsg);
          reject(new Error(friendlyMsg));
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Unknown join error';
        this.setStatus('error', msg);
        reject(new Error(msg));
      }
    });
  }

  public sendCommand(cmd: WatchPartyCommand): void {
    if (this.role === 'host') {
      // Broadcast to all connected guests
      this.dataConnections.forEach((conn) => {
        if (conn.open) {
          try {
            conn.send(cmd);
          } catch (e) {
            console.warn('Failed to send command to peer:', conn.peer, e);
          }
        }
      });
    } else if (this.role === 'guest') {
      // Send to host
      const isReady =
        this.guestDataConn &&
        (this.guestDataConn.open ||
          (this.guestDataConn as unknown as { dataChannel?: { readyState: string } })
            .dataChannel?.readyState === 'open');

      if (isReady && this.guestDataConn) {
        try {
          this.guestDataConn.send(cmd);
        } catch (e) {
          console.warn('Failed to send command to host:', e);
        }
      } else {
        // Buffer command to send once connection opens
        this.pendingGuestCommands.push(cmd);
      }
    }
  }

  public sendToPeer(peerId: string, cmd: WatchPartyCommand): void {
    const conn = this.dataConnections.get(peerId);
    if (
      conn &&
      (conn.open ||
        (conn as unknown as { dataChannel?: { readyState: string } }).dataChannel?.readyState ===
          'open')
    ) {
      try {
        conn.send(cmd);
      } catch (e) {
        console.warn('Failed to send command to peer:', peerId, e);
      }
    }
  }

  public replaceMediaStream(newStream: MediaStream): void {
    this.currentStream = newStream;
    if (this.role !== 'host') return;

    const newVideoTrack = newStream.getVideoTracks()[0] || null;
    const newAudioTrack = newStream.getAudioTracks()[0] || null;

    for (const [peerId, call] of this.mediaCalls.entries()) {
      const pc = call.peerConnection;
      if (!pc) continue;

      const senders = pc.getSenders();
      const videoSender = senders.find((s) => s.track?.kind === 'video');
      const audioSender = senders.find((s) => s.track?.kind === 'audio');

      let replacedVideo = false;
      let replacedAudio = false;

      if (videoSender && newVideoTrack) {
        videoSender
          .replaceTrack(newVideoTrack)
          .then(() => limitBitrate(pc))
          .catch((err) => console.warn('replaceTrack video error:', err));
        replacedVideo = true;
      }

      if (audioSender && newAudioTrack) {
        audioSender
          .replaceTrack(newAudioTrack)
          .catch((err) => console.warn('replaceTrack audio error:', err));
        replacedAudio = true;
      }

      // If kind transition happened (e.g. was audio-only without a video sender, but now has video track)
      if ((newVideoTrack && !videoSender) || (newAudioTrack && !audioSender)) {
        try {
          call.close();
          if (this.peer) {
            const newCall = this.peer.call(peerId, newStream);
            this.mediaCalls.set(peerId, newCall);
            newCall.on('error', (e) => console.warn('Re-call error:', e));
            setTimeout(() => limitBitrate(newCall.peerConnection), 800);
          }
        } catch (err) {
          console.warn('Call renegotiation error:', err);
        }
      }
    }
  }

  public leave(): void {
    if (this.role === 'host') {
      // Inform guests
      try {
        this.sendCommand({ type: 'host-closed' });
      } catch {
        // ignore
      }
    } else if (this.role === 'guest') {
      try {
        this.sendCommand({ type: 'guest-left' });
      } catch {
        // ignore
      }
    }

    // Close connections
    this.dataConnections.forEach((conn) => {
      try {
        conn.close();
      } catch {
        // ignore
      }
    });
    this.dataConnections.clear();

    this.mediaCalls.forEach((call) => {
      try {
        call.close();
      } catch {
        // ignore
      }
    });
    this.mediaCalls.clear();

    if (this.guestDataConn) {
      try {
        this.guestDataConn.close();
      } catch {
        // ignore
      }
      this.guestDataConn = null;
    }

    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        // ignore
      }
      this.peer = null;
    }

    this.guestIncomingStream = null;
    this.currentStream = null;
    this.pendingGuestCommands = [];
    this.role = null;
    this.roomCode = null;
    this.guestCount = 0;
    this.errorMessage = null;
    this.clientNames.clear();
    this.setStatus('idle');
    this.setViewerCount(0);
  }

  public closeRoom(): void {
    this.leave();
  }
}

export const watchPartyService = new WatchPartyService();
