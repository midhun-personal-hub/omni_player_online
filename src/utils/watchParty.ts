import { Peer, DataConnection, MediaConnection } from 'peerjs';
import { ChatMessage } from '../types/chat';
import { meshP2PManager } from './meshP2PTransfer';

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
      sentAt?: number;
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
      timestamp?: number;
      sentAt?: number;
      isPlaying: boolean;
      currentTime: number;
      duration: number;
      playbackRate: number;
      mediaName: string;
      isAudio: boolean;
      allowGuestControl: boolean;
    }
  | {
      type: 'guest-buffering';
      name: string;
    }
  | {
      type: 'guest-ready';
      name: string;
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
      type: 'party-signal';
      kind?: 'movie' | 'call';
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

export interface MovieSenderConfig {
  maxBitrate: number;
  maxFramerate: number;
  scaleResolutionDownBy: number;
  degradationPreference: RTCDegradationPreference;
}

export type AdaptiveTier = 'high' | 'medium' | 'low';

export function computeMovieSenderConfig(
  quality: MovieQuality,
  sourceHeight?: number,
  inCall: boolean = false,
  adaptiveTier: AdaptiveTier = 'high'
): MovieSenderConfig {
  let targetBitrate: number;
  let targetHeight: number;

  if (quality === '1080p') {
    targetBitrate = QUALITY_BITRATES['1080p'];
    targetHeight = 1080;
  } else if (quality === '720p') {
    targetBitrate = QUALITY_BITRATES['720p'];
    targetHeight = 720;
  } else {
    // 'auto' mode adaptive tiers
    if (adaptiveTier === 'high') {
      targetBitrate = 4_500_000;
      targetHeight = 1080;
    } else if (adaptiveTier === 'medium') {
      targetBitrate = 2_500_000;
      targetHeight = 720;
    } else {
      // 'low'
      targetBitrate = 1_200_000;
      targetHeight = 540;
    }
  }

  // Preserve call ducking: decrease movie bitrate slightly to preserve voice/cam quality
  if (inCall) {
    targetBitrate = Math.max(500_000, targetBitrate - 400_000);
  }

  // Scale resolution down if source is higher resolution than target.
  // Avoid unnecessary downscaling for lower-resolution sources (e.g. 480p source stays 1.0).
  let scaleResolutionDownBy = 1.0;
  if (sourceHeight && sourceHeight > 0) {
    if (sourceHeight > targetHeight) {
      scaleResolutionDownBy = Math.round((sourceHeight / targetHeight) * 10) / 10;
    } else {
      scaleResolutionDownBy = 1.0;
    }
  }

  return {
    maxBitrate: targetBitrate,
    maxFramerate: 30, // Cap at 30 FPS to reduce encoder load and prevent frame drops
    scaleResolutionDownBy: Math.max(1.0, scaleResolutionDownBy),
    degradationPreference: 'maintain-framerate', // Browser drops resolution rather than framerate
  };
}

export async function applyMovieSenderParameters(
  sender: RTCRtpSender,
  config: MovieSenderConfig
): Promise<boolean> {
  try {
    const params = sender.getParameters();
    if (!params) return false;

    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }

    // Preserve existing encoding properties without overwriting unrelated fields
    const encoding = params.encodings[0];
    encoding.maxBitrate = config.maxBitrate;

    // Set maxFramerate cap where supported
    if (config.maxFramerate > 0) {
      encoding.maxFramerate = config.maxFramerate;
    }

    // Apply scaleResolutionDownBy based on source and target
    if (config.scaleResolutionDownBy >= 1.0) {
      encoding.scaleResolutionDownBy = config.scaleResolutionDownBy;
    }

    // Always prefer maintain-framerate so resolution steps down before frames drop
    params.degradationPreference = config.degradationPreference;

    await sender.setParameters(params);
    return true;
  } catch (err) {
    // Attempt fallback with basic parameters if advanced fields caused rejection
    try {
      const fallbackParams = sender.getParameters();
      if (fallbackParams.encodings && fallbackParams.encodings.length > 0) {
        fallbackParams.encodings[0].maxBitrate = config.maxBitrate;
        fallbackParams.degradationPreference = 'maintain-framerate';
        await sender.setParameters(fallbackParams);
        return true;
      }
    } catch {}
    console.debug('[OmniPlay WebRTC] setParameters failed on video sender:', err);
    return false;
  }
}

export async function configureMovieSenderParameters(
  sender: RTCRtpSender,
  quality: MovieQuality = DEFAULT_MOVIE_QUALITY,
  sourceHeight?: number,
  inCall: boolean = false,
  adaptiveTier: AdaptiveTier = 'high'
): Promise<boolean> {
  const config = computeMovieSenderConfig(quality, sourceHeight, inCall, adaptiveTier);
  return applyMovieSenderParameters(sender, config);
}

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
    if (!capabilities || !capabilities.codecs || capabilities.codecs.length === 0) return;

    const codecs = capabilities.codecs;

    // Prefer H.264 when supported: hardware acceleration on almost all devices, lowest CPU load
    const h264Codecs = codecs.filter((c) => c.mimeType.toLowerCase() === 'video/h264');
    // Prefer packetization-mode=1 for optimal streaming throughput
    h264Codecs.sort((a, b) => {
      const aMode = a.sdpFmtpLine?.includes('packetization-mode=1') ? 1 : 0;
      const bMode = b.sdpFmtpLine?.includes('packetization-mode=1') ? 1 : 0;
      return bMode - aMode;
    });

    const vp8Codecs = codecs.filter((c) => c.mimeType.toLowerCase() === 'video/vp8');
    const vp9Codecs = codecs.filter((c) => c.mimeType.toLowerCase() === 'video/vp9');
    const av1Codecs = codecs.filter((c) => c.mimeType.toLowerCase() === 'video/av1');
    const otherCodecs = codecs.filter(
      (c) =>
        c.mimeType.toLowerCase() !== 'video/h264' &&
        c.mimeType.toLowerCase() !== 'video/vp8' &&
        c.mimeType.toLowerCase() !== 'video/vp9' &&
        c.mimeType.toLowerCase() !== 'video/av1'
    );

    // Retain compatible fallback codecs without forcing any unsupported codec
    const preferredOrder = [
      ...h264Codecs,
      ...vp8Codecs,
      ...vp9Codecs,
      ...av1Codecs,
      ...otherCodecs,
    ];

    if (preferredOrder.length > 0) {
      transceiver.setCodecPreferences(preferredOrder);
    }
  } catch (err) {
    console.warn('[OmniPlay WebRTC] setCodecPreferences unsupported or failed:', err);
  }
}

export function injectSdpBandwidthFallback(sdp: string, bitrateKbps: number = 8000): string {
  if (!sdp) return sdp;
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

    if (inVideoMline && line.startsWith('c=') && !hasBandwidthLine) {
      modified.push(line);
      modified.push(`b=AS:${bitrateKbps}`);
      hasBandwidthLine = true;
      continue;
    }

    modified.push(line);
  }

  if (inVideoMline && !hasBandwidthLine) {
    modified.push(`b=AS:${bitrateKbps}`);
  }

  return modified.join('\r\n');
}

export class WatchPartyService {
  private peer: Peer | null = null;
  private role: WatchPartyRole = null;
  private roomCode: string | null = null;
  private status: WatchPartyStatus = 'idle';
  private errorMessage: string | null = null;

  // Host state
  private dataConnections: Map<string, DataConnection> = new Map();
  private moviePeerConnections: Map<
    string,
    {
      pc: RTCPeerConnection;
      remoteStream: MediaStream;
      iceCandidateQueue: RTCIceCandidateInit[];
      isSettingRemoteAnswerPending: boolean;
      ignoreOffer: boolean;
      makingOffer: boolean;
    }
  > = new Map();
  private inCallActive: boolean = false;
  private currentStream: MediaStream | null = null;
  private guestCount = 0;
  private clientNames: Map<string, string> = new Map();
  private hostDisplayName: string = 'Host';
  private movieQuality: MovieQuality = DEFAULT_MOVIE_QUALITY;
  private qualityListeners: Set<(quality: MovieQuality) => void> = new Set();
  private statsIntervalId: ReturnType<typeof setInterval> | null = null;
  private bandwidthLimitationSeconds = 0;
  private cpuLimitationSeconds = 0;
  private stableSeconds = 0;
  private adaptiveTier: AdaptiveTier = 'high';
  private sourceWidth: number = 0;
  private sourceHeight: number = 0;
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
  private fileTransferConnListeners: Set<(conn: DataConnection) => void> = new Set();

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

  public getGuestPeerIds(): string[] {
    return Array.from(this.dataConnections.keys());
  }

  public onFileTransferConnection(cb: (conn: DataConnection) => void): () => void {
    this.fileTransferConnListeners.add(cb);
    return () => this.fileTransferConnListeners.delete(cb);
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

  public getAdaptiveTier(): AdaptiveTier {
    return this.adaptiveTier;
  }

  public connectToMeshPeer(targetPeerId: string): void {
    if (!this.peer || this.role !== 'guest') return;
    if (meshP2PManager.getConnectedPeerCount() >= 3) return;
    try {
      const conn = this.peer.connect(targetPeerId, {
        label: 'movie-mesh-piece',
        reliable: true,
      });
      conn.on('open', () => {
        meshP2PManager.registerPeerConnection(targetPeerId, conn);
      });
    } catch (err) {
      console.warn('[MeshP2P] Failed to connect to peer:', err);
    }
  }

  public setSourceDimensions(width: number, height: number): void {
    if (width > 0 && height > 0) {
      const changed = this.sourceWidth !== width || this.sourceHeight !== height;
      this.sourceWidth = width;
      this.sourceHeight = height;
      if (changed && this.role === 'host') {
        this.reapplyAllSenders();
      }
    }
  }

  public onMovieQuality(cb: (quality: MovieQuality) => void): () => void {
    this.qualityListeners.add(cb);
    cb(this.movieQuality);
    return () => this.qualityListeners.delete(cb);
  }

  public notifyCallState(inCall: boolean) {
    this.inCallActive = inCall;
    this.reapplyAllSenders();
  }

  private reapplyAllSenders(): void {
    for (const entry of this.moviePeerConnections.values()) {
      this.applyMovieBitrateForEntry(entry, this.movieQuality, this.inCallActive);
    }
  }

  private async applyMovieBitrateForEntry(
    entry: { pc: RTCPeerConnection },
    quality: MovieQuality,
    inCall: boolean
  ) {
    const pc = entry.pc;
    try {
      const senders = pc.getSenders();
      for (const sender of senders) {
        if (sender.track && sender.track.kind === 'video') {
          const trackSettings = sender.track.getSettings ? sender.track.getSettings() : undefined;
          const srcHeight = this.sourceHeight || trackSettings?.height;
          const config = computeMovieSenderConfig(
            quality,
            srcHeight,
            inCall,
            this.adaptiveTier
          );
          await applyMovieSenderParameters(sender, config);
        }
      }
    } catch (err) {
      console.debug('Failed to setParameters on movie sender:', err);
    }
  }

  public async setMovieQuality(quality: MovieQuality): Promise<void> {
    this.movieQuality = quality;
    this.bandwidthLimitationSeconds = 0;
    this.cpuLimitationSeconds = 0;
    this.stableSeconds = 0;
    this.qualityListeners.forEach((cb) => cb(quality));
    this.reapplyAllSenders();
    console.info(`[OmniPlay Stream] Live movie quality updated to: ${quality}`);
  }

  private stepDownQuality(): void {
    if (this.movieQuality === '1080p') {
      this.setMovieQuality('720p');
    } else if (this.movieQuality === '720p') {
      this.setMovieQuality('auto');
    }
  }

  private startStatsPolling(): void {
    if (this.statsIntervalId) return;

    this.statsIntervalId = setInterval(async () => {
      if (this.role !== 'host' || this.moviePeerConnections.size === 0) return;

      let isAnyPeerBandwidthLimited = false;
      let isAnyPeerCpuLimited = false;
      let hasSevereFrameDrops = false;

      for (const [peerId, entry] of this.moviePeerConnections.entries()) {
        const pc = entry.pc;
        if (!pc || pc.connectionState === 'closed') continue;

        try {
          const stats = await pc.getStats();
          stats.forEach((report) => {
            if (report.type === 'outbound-rtp' && report.kind === 'video') {
              const bytesSent = report.bytesSent ?? 0;
              const prevBytes = this.previousBytesSentMap.get(peerId) ?? bytesSent;
              this.previousBytesSentMap.set(peerId, bytesSent);

              if (report.qualityLimitationReason === 'bandwidth') {
                isAnyPeerBandwidthLimited = true;
              } else if (report.qualityLimitationReason === 'cpu') {
                isAnyPeerCpuLimited = true;
              }

              // Detect severe outgoing frame drops while video is sending frames
              if (
                typeof report.framesPerSecond === 'number' &&
                report.framesPerSecond > 0 &&
                report.framesPerSecond < 18
              ) {
                hasSevereFrameDrops = true;
              }
            }

            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
              // High round trip time (> 450ms) indicates network congestion
              if (report.currentRoundTripTime && report.currentRoundTripTime > 0.45) {
                isAnyPeerBandwidthLimited = true;
              }
            }
          });
        } catch {}
      }

      const isConstrained = isAnyPeerBandwidthLimited || isAnyPeerCpuLimited || hasSevereFrameDrops;

      if (isConstrained) {
        this.stableSeconds = 0;
        if (isAnyPeerCpuLimited || hasSevereFrameDrops) {
          this.cpuLimitationSeconds += 3;
        }
        if (isAnyPeerBandwidthLimited) {
          this.bandwidthLimitationSeconds += 3;
        }

        // Hysteresis: require at least 6 seconds of sustained constraint before stepping down
        if (this.cpuLimitationSeconds >= 6 || this.bandwidthLimitationSeconds >= 6) {
          this.cpuLimitationSeconds = 0;
          this.bandwidthLimitationSeconds = 0;

          if (this.movieQuality === 'auto') {
            if (this.adaptiveTier === 'high') {
              this.adaptiveTier = 'medium';
              console.info('[OmniPlay Stream] Auto quality adapted: stepped down to medium');
              this.reapplyAllSenders();
            } else if (this.adaptiveTier === 'medium') {
              this.adaptiveTier = 'low';
              console.info('[OmniPlay Stream] Auto quality adapted: stepped down to low');
              this.reapplyAllSenders();
            }
          } else {
            // Manual quality preset: step down if severe constraint persists
            this.stepDownQuality();
          }
        }
      } else {
        // Recovery: decrease limitation counters and accumulate stable time
        this.cpuLimitationSeconds = Math.max(0, this.cpuLimitationSeconds - 3);
        this.bandwidthLimitationSeconds = Math.max(0, this.bandwidthLimitationSeconds - 3);
        this.stableSeconds += 3;

        // Require 18 seconds of continuous healthy stats before cautiously stepping up
        if (this.stableSeconds >= 18) {
          this.stableSeconds = 0;
          if (this.movieQuality === 'auto') {
            if (this.adaptiveTier === 'low') {
              this.adaptiveTier = 'medium';
              console.info('[OmniPlay Stream] Auto quality adapted: stepped up to medium');
              this.reapplyAllSenders();
            } else if (this.adaptiveTier === 'medium') {
              this.adaptiveTier = 'high';
              console.info('[OmniPlay Stream] Auto quality adapted: stepped up to high');
              this.reapplyAllSenders();
            }
          }
        }
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
    this.cpuLimitationSeconds = 0;
    this.stableSeconds = 0;
  }

  private setupMovieConnectionForGuest(peerId: string) {
    if (!this.peer || !this.currentStream) return;
    if (this.moviePeerConnections.has(peerId)) {
      const existing = this.moviePeerConnections.get(peerId);
      try {
        existing?.pc.close();
      } catch {}
      this.moviePeerConnections.delete(peerId);
    }

    const iceServers = getIceServers();
    const pc = new RTCPeerConnection({ iceServers });
    const remoteStream = new MediaStream();

    if (typeof window !== 'undefined') {
      (window as any).__moviePc = pc;
    }

    const entry = {
      pc,
      remoteStream,
      iceCandidateQueue: [],
      isSettingRemoteAnswerPending: false,
      ignoreOffer: false,
      makingOffer: false,
    };
    this.moviePeerConnections.set(peerId, entry);

    const isDebug = () => typeof window !== 'undefined' && window.location.search.includes('debug=1');

    pc.onsignalingstatechange = () => {
      if (isDebug()) console.log(`[movie] signalingState for ${peerId}: ${pc.signalingState}`);
    };
    pc.onconnectionstatechange = () => {
      if (isDebug()) console.log(`[movie] connectionState for ${peerId}: ${pc.connectionState}`);
      if (pc.connectionState === 'failed') {
        console.warn(`[movie] Connection failed with ${peerId}, attempting ICE restart.`);
        try { pc.restartIce(); } catch {}
      } else if (pc.connectionState === 'closed') {
        if (typeof window !== 'undefined' && (window as any).__moviePc === pc) {
          (window as any).__moviePc = null;
        }
        this.moviePeerConnections.delete(peerId);
        if (this.moviePeerConnections.size === 0) {
          this.stopStatsPolling();
        }
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (isDebug()) console.log(`[movie] iceConnectionState for ${peerId}: ${pc.iceConnectionState}`);
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.sendToPeer(peerId, {
          type: 'party-signal',
          kind: 'movie',
          signal: { type: 'candidate', candidate: candidate.toJSON() },
        });
      }
    };

    for (const track of this.currentStream.getTracks()) {
      pc.addTrack(track, this.currentStream);
    }

    pc.onnegotiationneeded = async () => {
      try {
        entry.makingOffer = true;
        // Apply codec preferences immediately before local description offer
        const transceivers = pc.getTransceivers ? pc.getTransceivers() : [];
        const videoTransceiver = transceivers.find((t) => t.sender.track?.kind === 'video');
        if (videoTransceiver) {
          applyCodecPreferences(videoTransceiver);
        }
        await pc.setLocalDescription();
        if (pc.localDescription) {
          this.sendToPeer(peerId, {
            type: 'party-signal',
            kind: 'movie',
            signal: {
              type: 'description',
              description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
            },
          });
        }
      } catch (err) {
        console.warn('[movie] negotiation error:', err);
      } finally {
        entry.makingOffer = false;
      }
    };

    try {
      const transceivers = pc.getTransceivers ? pc.getTransceivers() : [];
      const videoTransceiver = transceivers.find((t) => t.sender.track?.kind === 'video');
      if (videoTransceiver) {
        applyCodecPreferences(videoTransceiver);
      }
    } catch {}

    this.applyMovieBitrateForEntry(entry, this.movieQuality, this.inCallActive);
    this.startStatsPolling();
  }

  public async handleIncomingMovieSignal(
    senderPeerId: string,
    signal:
      | { type: 'description'; description: RTCSessionDescriptionInit }
      | { type: 'candidate'; candidate: RTCIceCandidateInit }
  ) {
    let entry = this.moviePeerConnections.get(senderPeerId);
    if (!entry) {
      const iceServers = getIceServers();
      const pc = new RTCPeerConnection({ iceServers });
      const remoteStream = new MediaStream();

      if (typeof window !== 'undefined') {
        (window as any).__moviePc = pc;
      }

      entry = {
        pc,
        remoteStream,
        iceCandidateQueue: [],
        isSettingRemoteAnswerPending: false,
        ignoreOffer: false,
        makingOffer: false,
      };
      this.moviePeerConnections.set(senderPeerId, entry);

      const isDebug = () => typeof window !== 'undefined' && window.location.search.includes('debug=1');

      pc.onsignalingstatechange = () => {
        if (isDebug()) console.log(`[movie] signalingState for ${senderPeerId}: ${pc.signalingState}`);
      };
      pc.onconnectionstatechange = () => {
        if (isDebug()) console.log(`[movie] connectionState for ${senderPeerId}: ${pc.connectionState}`);
        if (pc.connectionState === 'failed') {
          console.warn(`[movie] Connection failed with ${senderPeerId}, attempting ICE restart.`);
          try { pc.restartIce(); } catch {}
        } else if (pc.connectionState === 'closed') {
          if (typeof window !== 'undefined' && (window as any).__moviePc === pc) {
            (window as any).__moviePc = null;
          }
          this.moviePeerConnections.delete(senderPeerId);
        }
      };
      pc.oniceconnectionstatechange = () => {
        if (isDebug()) console.log(`[movie] iceConnectionState for ${senderPeerId}: ${pc.iceConnectionState}`);
      };
      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          this.sendCommand({
            type: 'party-signal',
            kind: 'movie',
            signal: { type: 'candidate', candidate: candidate.toJSON() },
          });
        }
      };
      pc.ontrack = (event) => {
        const targetStream = entry!.remoteStream;
        const existing = targetStream.getTracks().find((t) => t.id === event.track.id);
        if (!existing) {
          targetStream.addTrack(event.track);
        }
        this.guestIncomingStream = targetStream;
        this.streamListeners.forEach((cb) => cb(targetStream));
      };
    }

    const { pc } = entry;
    try {
      if (signal.type === 'description') {
        await pc.setRemoteDescription(signal.description);
        if (entry.iceCandidateQueue.length > 0) {
          while (entry.iceCandidateQueue.length > 0) {
            const cand = entry.iceCandidateQueue.shift();
            if (cand) {
              try { await pc.addIceCandidate(cand); } catch {}
            }
          }
        }
        if (signal.description.type === 'offer') {
          // Apply codec preferences on receiver side before creating answer if supported
          try {
            const transceivers = pc.getTransceivers ? pc.getTransceivers() : [];
            const videoTransceiver = transceivers.find((t) => t.receiver?.track?.kind === 'video');
            if (videoTransceiver) {
              applyCodecPreferences(videoTransceiver);
            }
          } catch {}

          await pc.setLocalDescription();
          if (pc.localDescription) {
            this.sendCommand({
              type: 'party-signal',
              kind: 'movie',
              signal: {
                type: 'description',
                description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
              },
            });
          }
        }
      } else if (signal.type === 'candidate') {
        if (!pc.remoteDescription || !pc.remoteDescription.type) {
          entry.iceCandidateQueue.push(signal.candidate);
        } else {
          try { await pc.addIceCandidate(signal.candidate); } catch {}
        }
      }
    } catch (err) {
      console.warn('[movie] signal handling error:', err);
    }
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
          if (conn.label === 'movie-file-transfer') {
            this.fileTransferConnListeners.forEach((cb) => cb(conn));
            return;
          }
          this.handleIncomingGuestConnection(conn);
        });

        this.peer.on('error', (err: { type?: string; message?: string }) => {
          clearTimeout(setupTimeout);
          console.warn('Host peer error:', err);

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
    if (this.dataConnections.size >= 3) {
      conn.on('open', () => {
        try {
          conn.send({ type: 'room-full' } satisfies WatchPartyCommand);
        } catch {}
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

      if (this.peer && this.currentStream) {
        try {
          this.setupMovieConnectionForGuest(conn.peer);
        } catch (e) {
          console.warn('Failed to setup movie connection for guest:', e);
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
      const entry = this.moviePeerConnections.get(peerId);
      if (entry) {
        try { entry.pc.close(); } catch {}
        this.moviePeerConnections.delete(peerId);
      }
      if (this.moviePeerConnections.size === 0) {
        this.stopStatsPolling();
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

        this.peer.on('connection', (conn: DataConnection) => {
          if (conn.label === 'movie-file-transfer') {
            this.fileTransferConnListeners.forEach((cb) => cb(conn));
          } else if (conn.label === 'movie-mesh-piece') {
            meshP2PManager.registerPeerConnection(conn.peer, conn);
          }
        });

        this.peer.on('open', () => {
          if (!this.peer) return;

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

              while (this.pendingGuestCommands.length > 0) {
                const pending = this.pendingGuestCommands.shift();
                if (pending) {
                  conn.send(pending);
                }
              }
            } catch {}
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

    for (const [peerId, entry] of this.moviePeerConnections.entries()) {
      const pc = entry.pc;
      if (!pc) continue;

      const senders = pc.getSenders();
      const videoSender = senders.find((s) => s.track?.kind === 'video');
      const audioSender = senders.find((s) => s.track?.kind === 'audio');

      if (videoSender && newVideoTrack) {
        videoSender
          .replaceTrack(newVideoTrack)
          .then(() => {
            this.applyMovieBitrateForEntry(entry, this.movieQuality, this.inCallActive);
          })
          .catch(() => {});
      }
      if (audioSender && newAudioTrack) {
        audioSender.replaceTrack(newAudioTrack).catch(() => {});
      }

      if ((newVideoTrack && !videoSender) || (newAudioTrack && !audioSender)) {
        this.setupMovieConnectionForGuest(peerId);
      }
    }
  }

  public leave(): void {
    this.stopStatsPolling();
    if (typeof window !== 'undefined') {
      (window as any).__moviePc = null;
    }
    if (this.role === 'host') {
      try {
        this.sendCommand({ type: 'host-closed' });
      } catch {}
    } else if (this.role === 'guest') {
      try {
        this.sendCommand({ type: 'guest-left' });
      } catch {}
    }

    this.dataConnections.forEach((conn) => {
      try { conn.close(); } catch {}
    });
    this.dataConnections.clear();

    this.moviePeerConnections.forEach((entry) => {
      try { entry.pc.close(); } catch {}
    });
    this.moviePeerConnections.clear();

    if (this.guestDataConn) {
      try { this.guestDataConn.close(); } catch {}
      this.guestDataConn = null;
    }

    if (this.peer) {
      try { this.peer.destroy(); } catch {}
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
