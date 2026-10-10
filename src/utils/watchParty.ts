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
      senderId?: string;
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
    }
  | {
      type: 'call-started';
      peerId?: string;
      name?: string;
    }
  | {
      type: 'call-ended';
      peerId?: string;
    }
  | {
      type: 'call-signal';
      senderId?: string;
      targetId?: string;
      signal:
        | { type: 'description'; description: RTCSessionDescriptionInit }
        | { type: 'candidate'; candidate: RTCIceCandidateInit };
    }
  | {
      type: 'stream-owner';
      streamId: string;
      peerId: string;
      name: string;
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

export function getIceServers(): RTCIceServer[] {
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

export type MovieQuality = 'auto' | '720p' | '1080p';

export const QUALITY_BITRATES: Record<'720p' | '1080p', number> = {
  '720p': 3_000_000,
  '1080p': 8_000_000,
};

export const DEFAULT_MOVIE_QUALITY: MovieQuality = '720p';

/**
 * Configure high-quality encoding parameters on a movie RTCRtpSender.
 * - Sets maxBitrate based on quality mode
 * - Sets scaleResolutionDownBy = 1 (never downscale)
 * - Sets degradationPreference ("maintain-resolution" or "balanced" in Auto mode)
 */
export async function configureMovieSenderParameters(
  sender: RTCRtpSender,
  quality: MovieQuality = DEFAULT_MOVIE_QUALITY
): Promise<boolean> {
  try {
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }

    const targetBitrate =
      quality === '1080p'
        ? QUALITY_BITRATES['1080p']
        : QUALITY_BITRATES['720p'];

    params.encodings[0].maxBitrate = targetBitrate;
    params.encodings[0].scaleResolutionDownBy = 1;

    // Use "balanced" for Auto mode so WebRTC can gracefully adapt framerate/resolution,
    // and "maintain-resolution" for fixed quality tiers.
    params.degradationPreference = quality === 'auto' ? 'balanced' : 'maintain-resolution';

    await sender.setParameters(params);
    return true;
  } catch (err) {
    console.debug('Failed to setParameters on sender:', err);
    return false;
  }
}

/**
 * Prioritizes VP9 first, then H264, then remaining codecs on a transceiver.
 */
export function applyCodecPreferences(transceiver: RTCRtpTransceiver): void {
  if (
    typeof RTCRtpReceiver === 'undefined' ||
    typeof RTCRtpReceiver.getCapabilities !== 'function' ||
    typeof transceiver.setCodecPreferences !== 'function'
  ) {
    return;
  }

  try {
    const capabilities = RTCRtpReceiver.getCapabilities('video');
    if (!capabilities || !capabilities.codecs) return;

    const codecs = capabilities.codecs;
    const vp9Codecs = codecs.filter((c) => c.mimeType.toLowerCase() === 'video/vp9');
    const h264Codecs = codecs.filter((c) => c.mimeType.toLowerCase() === 'video/h264');
    const otherCodecs = codecs.filter(
      (c) =>
        c.mimeType.toLowerCase() !== 'video/vp9' &&
        c.mimeType.toLowerCase() !== 'video/h264'
    );

    const preferredOrder = [...vp9Codecs, ...h264Codecs, ...otherCodecs];
    transceiver.setCodecPreferences(preferredOrder);
    console.debug('[OmniPlay WebRTC] Set video codec preferences: VP9 > H264 > others');
  } catch (err) {
    console.warn('[OmniPlay WebRTC] setCodecPreferences unsupported or failed:', err);
  }
}

/**
 * SDP transform fallback: injects b=AS:8000 into the video media section
 * to guarantee high bandwidth even if setParameters is ignored or unsupported.
 */
export function injectSdpBandwidthFallback(sdp: string, bitrateKbps: number = 8000): string {
  if (!sdp) return sdp;
  // If b=AS is already present in video section, return as is
  const lines = sdp.split('\r\n');
  const modified: string[] = [];
  let inVideoMline = false;
  let hasBandwidthLine = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('m=video')) {
      inVideoMline = true;
      hasBandwidthLine = false;
      modified.push(line);
      continue;
    }

    if (inVideoMline && line.startsWith('m=')) {
      // Transitioning to another m-line: if we didn't add b=AS yet, insert it before next m-line
      if (!hasBandwidthLine) {
        modified.push(`b=AS:${bitrateKbps}`);
      }
      inVideoMline = false;
    }

    if (inVideoMline && line.startsWith('b=AS:')) {
      hasBandwidthLine = true;
      modified.push(`b=AS:${bitrateKbps}`);
      continue;
    }

    if (inVideoMline && line.startsWith('b=TIAS:')) {
      hasBandwidthLine = true;
      modified.push(`b=TIAS:${bitrateKbps * 1000}`);
      continue;
    }

    // Insert b=AS after c= line in video section if present
    if (inVideoMline && line.startsWith('c=') && !hasBandwidthLine) {
      modified.push(line);
      modified.push(`b=AS:${bitrateKbps}`);
      hasBandwidthLine = true;
      continue;
    }

    modified.push(line);
  }

  // Handle case where video was the last media line and no b= line was added
  if (inVideoMline && !hasBandwidthLine) {
    modified.push(`b=AS:${bitrateKbps}`);
  }

  return modified.join('\r\n');
}

/**
 * Configures all video senders on an RTCPeerConnection for the movie stream.
 */
export async function applyMovieBitrate(
  pc: RTCPeerConnection | undefined,
  quality: MovieQuality = DEFAULT_MOVIE_QUALITY
): Promise<void> {
  if (!pc) return;
  try {
    const senders = pc.getSenders();
    for (const sender of senders) {
      if (sender.track && sender.track.kind === 'video') {
        const supported = await configureMovieSenderParameters(sender, quality);
        if (!supported) {
          console.debug('[OmniPlay WebRTC] Sender setParameters not supported, relying on SDP bandwidth');
        }
      }
    }
  } catch (err) {
    console.debug('[OmniPlay WebRTC] Bitrate application info:', err);
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
  private movieQuality: MovieQuality = DEFAULT_MOVIE_QUALITY;
  private qualityListeners: Set<(quality: MovieQuality) => void> = new Set();
  private statsIntervalId: ReturnType<typeof setInterval> | null = null;
  private bandwidthLimitationSeconds = 0;
  private previousBytesSentMap: Map<string, number> = new Map();

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

  public getMovieQuality(): MovieQuality {
    return this.movieQuality;
  }

  public onMovieQuality(cb: (quality: MovieQuality) => void): () => void {
    this.qualityListeners.add(cb);
    cb(this.movieQuality);
    return () => this.qualityListeners.delete(cb);
  }

  /**
   * Updates movie stream quality live on all active peer connections without renegotiating.
   */
  public async setMovieQuality(quality: MovieQuality): Promise<void> {
    this.movieQuality = quality;
    this.bandwidthLimitationSeconds = 0;
    this.qualityListeners.forEach((cb) => cb(quality));

    for (const [, call] of this.mediaCalls.entries()) {
      const pc = call.peerConnection;
      if (pc) {
        await applyMovieBitrate(pc, quality);
      }
    }
    console.info(`[OmniPlay Stream] Live movie quality updated to: ${quality}`);
  }

  /**
   * Automatically steps down the bitrate tier if bandwidth limitation persists.
   */
  private stepDownQuality(): void {
    if (this.movieQuality === '1080p') {
      console.warn('[OmniPlay Stream] Bandwidth limited for >10s. Stepping down to 720p.');
      this.setMovieQuality('720p');
    } else if (this.movieQuality === '720p') {
      console.warn('[OmniPlay Stream] Bandwidth limited for >10s. Stepping down to Auto mode (balanced).');
      this.setMovieQuality('auto');
    }
  }

  /**
   * Polls RTCPeerConnection stats every 3 seconds for outbound movie RTP streams
   * and logs frame dimensions, FPS, bitrate, and qualityLimitationReason.
   */
  private startStatsPolling(): void {
    if (this.statsIntervalId) return;

    this.statsIntervalId = setInterval(async () => {
      if (this.role !== 'host' || this.mediaCalls.size === 0) return;

      let isAnyPeerBandwidthLimited = false;

      for (const [peerId, call] of this.mediaCalls.entries()) {
        const pc = call.peerConnection;
        if (!pc || pc.connectionState === 'closed') continue;

        try {
          const stats = await pc.getStats();
          stats.forEach((report) => {
            if (report.type === 'outbound-rtp' && report.kind === 'video') {
              const frameWidth = report.frameWidth ?? 'unknown';
              const frameHeight = report.frameHeight ?? 'unknown';
              const framesPerSecond = report.framesPerSecond ?? 'unknown';
              const qualityLimitationReason = report.qualityLimitationReason ?? 'none';
              const bytesSent = report.bytesSent ?? 0;

              const prevBytes = this.previousBytesSentMap.get(peerId) ?? bytesSent;
              this.previousBytesSentMap.set(peerId, bytesSent);

              // 3 second interval => bps = ((bytesSent - prevBytes) * 8) / 3
              const deltaBytes = Math.max(0, bytesSent - prevBytes);
              const bitrateKbps = Math.round((deltaBytes * 8) / (3 * 1000));

              console.log(
                `[OmniPlay Stream Stats] Peer: ${peerId} | Resolution: ${frameWidth}x${frameHeight} | FPS: ${framesPerSecond} | Bitrate: ${bitrateKbps} kbps | Limit Reason: ${qualityLimitationReason} (Mode: ${this.movieQuality})`
              );

              if (qualityLimitationReason === 'bandwidth') {
                isAnyPeerBandwidthLimited = true;
              }
            }
          });
        } catch {
          // Ignore stats errors on transient disconnects
        }
      }

      if (isAnyPeerBandwidthLimited) {
        this.bandwidthLimitationSeconds += 3;
        if (this.bandwidthLimitationSeconds >= 10) {
          this.bandwidthLimitationSeconds = 0;
          this.stepDownQuality();
        }
      } else {
        this.bandwidthLimitationSeconds = Math.max(0, this.bandwidthLimitationSeconds - 3);
      }
    }, 3000);
  }

  private stopStatsPolling(): void {
    if (this.statsIntervalId) {
      clearInterval(this.statsIntervalId);
      this.statsIntervalId = null;
    }
    this.previousBytesSentMap.clear();
    this.bandwidthLimitationSeconds = 0;
  }

  /**
   * Sets up transceiver codec preferences, sender parameters, SDP transforms,
   * and connection state listeners on a movie stream call.
   */
  private configureMovieCall(call: MediaConnection): void {
    const pc = call.peerConnection;
    if (!pc) return;

    // 1. Call setCodecPreferences on video transceiver with VP9 first, then H264, before offer
    try {
      const transceivers = pc.getTransceivers ? pc.getTransceivers() : [];
      const videoTransceiver = transceivers.find((t) => t.sender.track?.kind === 'video');
      if (videoTransceiver) {
        applyCodecPreferences(videoTransceiver);
      }
    } catch (err) {
      console.warn('[OmniPlay WebRTC] Video transceiver lookup warning:', err);
    }

    // 2. Call sender.setParameters immediately after tracks added
    applyMovieBitrate(pc, this.movieQuality);

    // 3. Re-apply once connectionState reaches 'connected'
    const handleStateChange = () => {
      if (pc.connectionState === 'connected') {
        applyMovieBitrate(pc, this.movieQuality);
      }
    };
    pc.addEventListener('connectionstatechange', handleStateChange);

    // Also fallback with timer in case connectionState fires before listener or via iceConnectionState
    setTimeout(() => {
      applyMovieBitrate(pc, this.movieQuality);
    }, 800);

    // Start stats logging
    this.startStatsPolling();
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
            // SDP transform fallback: inject b=AS:8000 into the offer video section
            sdpTransform: (sdp: string) => injectSdpBandwidthFallback(sdp, 8000),
          });
          this.mediaCalls.set(conn.peer, call);
          call.on('close', () => {
            this.mediaCalls.delete(conn.peer);
            if (this.mediaCalls.size === 0) {
              this.stopStatsPolling();
            }
          });
          call.on('error', (e) => console.warn('Call error with peer:', conn.peer, e));

          this.configureMovieCall(call);
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
          .then(() => applyMovieBitrate(pc, this.movieQuality))
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
            const newCall = this.peer.call(peerId, newStream, {
              metadata: { kind: 'movie' },
              sdpTransform: (sdp: string) => injectSdpBandwidthFallback(sdp, 8000),
            });
            this.mediaCalls.set(peerId, newCall);
            newCall.on('close', () => {
              this.mediaCalls.delete(peerId);
              if (this.mediaCalls.size === 0) {
                this.stopStatsPolling();
              }
            });
            newCall.on('error', (e) => console.warn('Re-call error:', e));
            this.configureMovieCall(newCall);
          }
        } catch (err) {
          console.warn('Call renegotiation error:', err);
        }
      }
    }
  }

  public leave(): void {
    this.stopStatsPolling();
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
