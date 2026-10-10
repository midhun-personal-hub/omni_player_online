import { getIceServers } from './watchParty';

export interface RemoteParticipant {
  peerId: string;
  name: string;
  stream: MediaStream;
  camOn: boolean;
  micOn: boolean;
  speaking: boolean;
}

export type CallQuality = 'low' | 'medium' | 'high';

export interface CallDevices {
  audioInputs: MediaDeviceInfo[];
  videoInputs: MediaDeviceInfo[];
}

export type CallSignal =
  | { type: 'description'; description: RTCSessionDescriptionInit }
  | { type: 'candidate'; candidate: RTCIceCandidateInit };

export interface CallManagerCallbacks {
  onRemoteStreamsChange: (streams: Map<string, RemoteParticipant>) => void;
  onLocalStreamChange: (stream: MediaStream | null) => void;
  onCallStateChange: (inCall: boolean) => void;
  onMediaStateChange: (camOn: boolean, micOn: boolean) => void;
  onSpeakingChange: (isAnyoneSpeaking: boolean, duckingMultiplier: number) => void;
  onStutterWarning: (show: boolean) => void;
  onDevicesChange: (devices: CallDevices) => void;
  onToast: (msg: string) => void;
  onError: (err: string | null) => void;
  onSendSignal: (targetPeerId: string, signal: CallSignal) => void;
}

const QUALITY_CONFIG: Record<CallQuality, { maxBitrate: number; scaleDown: number; maxFps: number }> = {
  low: { maxBitrate: 100_000, scaleDown: 2, maxFps: 15 },
  medium: { maxBitrate: 200_000, scaleDown: 1, maxFps: 15 },
  high: { maxBitrate: 500_000, scaleDown: 1, maxFps: 20 },
};

interface PeerConnectionEntry {
  pc: RTCPeerConnection;
  remoteStream: MediaStream;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  iceCandidateQueue: RTCIceCandidateInit[];
}

export class CallManager {
  private localStream: MediaStream | null = null;
  private myPeerId: string | null = null;
  private myName: string = 'User';
  private isPolite: boolean = false; // Host = impolite (false), Guest = polite (true)

  private inCall: boolean = false;
  private camEnabled: boolean = true;
  private micEnabled: boolean = true;
  private bandwidthSaver: boolean = false;
  private quality: CallQuality = 'medium';
  private duckingEnabled: boolean = true;

  // Active peer connections: peerId -> PeerConnectionEntry
  private peerConnections: Map<string, PeerConnectionEntry> = new Map();
  // Remote participants: peerId -> RemoteParticipant
  private remoteParticipants: Map<string, RemoteParticipant> = new Map();

  // Known roster: peerId -> name
  private roster: Map<string, string> = new Map();

  // Audio Context & Analysers for speaking detection
  private audioCtx: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private remoteAnalysers: Map<string, AnalyserNode> = new Map();
  private speakingAnimFrame: number | null = null;
  private isSpeakingLocally: boolean = false;
  private speechHoldTimers: Map<string, number> = new Map();

  // Selected devices
  private selectedAudioDeviceId: string | null = null;
  private selectedVideoDeviceId: string | null = null;
  private availableDevices: CallDevices = { audioInputs: [], videoInputs: [] };

  // Callbacks
  private callbacks: CallManagerCallbacks;

  // Stutter detection stats timer
  private stutterInterval: number | null = null;
  private consecutiveBadStats: number = 0;

  constructor(callbacks: CallManagerCallbacks) {
    this.callbacks = callbacks;
  }

  public setPeerInfo(myPeerId: string | null, myName: string, isPolite: boolean) {
    this.myPeerId = myPeerId;
    this.myName = myName;
    this.isPolite = isPolite;
  }

  public setRoster(peers: Array<{ id: string; name: string }>) {
    this.roster.clear();
    for (const p of peers) {
      this.roster.set(p.id, p.name);
      const existing = this.remoteParticipants.get(p.id);
      if (existing && existing.name !== p.name) {
        existing.name = p.name;
      }
    }
    this.notifyRemoteParticipants();

    // If we are currently in call, ensure peer connections exist and tracks are attached
    if (this.inCall && this.localStream && this.myPeerId) {
      for (const p of peers) {
        if (p.id === this.myPeerId) continue;
        const entry = this.getOrCreatePeerConnection(p.id);
        this.syncLocalTracksToConnection(entry.pc);
      }
    }
  }

  public handlePeerJoined(remotePeerId: string) {
    if (this.inCall && this.localStream) {
      const entry = this.getOrCreatePeerConnection(remotePeerId);
      this.syncLocalTracksToConnection(entry.pc);
    }
  }

  public handlePeerLeft(remotePeerId: string) {
    this.cleanupPeer(remotePeerId);
  }

  public updateParticipantMediaState(peerId: string, camOn: boolean, micOn: boolean) {
    const participant = this.remoteParticipants.get(peerId);
    if (participant) {
      participant.camOn = camOn;
      participant.micOn = micOn;
      this.notifyRemoteParticipants();
    }
  }

  public getInCall(): boolean {
    return this.inCall;
  }

  public getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  public getRemoteParticipants(): Map<string, RemoteParticipant> {
    return new Map(this.remoteParticipants);
  }

  public getQuality(): CallQuality {
    return this.quality;
  }

  public setQuality(q: CallQuality) {
    this.quality = q;
    this.applyBandwidthLimits();
  }

  public getDuckingEnabled(): boolean {
    return this.duckingEnabled;
  }

  public setDuckingEnabled(enabled: boolean) {
    this.duckingEnabled = enabled;
    if (!enabled) {
      this.callbacks.onSpeakingChange(false, 1.0);
    }
  }

  public getBandwidthSaver(): boolean {
    return this.bandwidthSaver;
  }

  public toggleBandwidthSaver(): void {
    this.bandwidthSaver = !this.bandwidthSaver;
    if (this.localStream) {
      const videoTracks = this.localStream.getVideoTracks();
      for (const track of videoTracks) {
        track.enabled = !this.bandwidthSaver && this.camEnabled;
      }
    }
    this.callbacks.onMediaStateChange(!this.bandwidthSaver && this.camEnabled, this.micEnabled);
    this.callbacks.onToast(
      this.bandwidthSaver
        ? 'Bandwidth saver active: Camera turned off'
        : 'Bandwidth saver disabled: Camera restored'
    );
  }

  public turnOffCamerasForBandwidth(): void {
    this.bandwidthSaver = true;
    if (this.localStream) {
      for (const track of this.localStream.getVideoTracks()) {
        track.enabled = false;
      }
    }
    this.callbacks.onMediaStateChange(false, this.micEnabled);
    this.callbacks.onStutterWarning(false);
    this.callbacks.onToast('Cameras turned off to protect movie playback.');
  }

  public async enumerateDevices(): Promise<CallDevices> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return { audioInputs: [], videoInputs: [] };
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((d) => d.kind === 'audioinput');
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');
      this.availableDevices = { audioInputs, videoInputs };
      this.callbacks.onDevicesChange(this.availableDevices);
      return this.availableDevices;
    } catch {
      return { audioInputs: [], videoInputs: [] };
    }
  }

  public async selectDevice(kind: 'audioinput' | 'videoinput', deviceId: string): Promise<void> {
    if (kind === 'audioinput') {
      this.selectedAudioDeviceId = deviceId;
    } else {
      this.selectedVideoDeviceId = deviceId;
    }

    if (!this.inCall || !this.localStream) return;

    try {
      if (kind === 'audioinput') {
        const newStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: deviceId },
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        const newAudioTrack = newStream.getAudioTracks()[0];
        if (newAudioTrack) {
          newAudioTrack.enabled = this.micEnabled;
          const oldTrack = this.localStream.getAudioTracks()[0];
          if (oldTrack) {
            oldTrack.stop();
            this.localStream.removeTrack(oldTrack);
          }
          this.localStream.addTrack(newAudioTrack);
          this.listenToTrackEnd(newAudioTrack, 'Microphone');

          this.replaceTrackInCalls(newAudioTrack);
          this.setupLocalAudioAnalyser();
        }
      } else {
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: deviceId },
            width: { ideal: 320 },
            height: { ideal: 240 },
            frameRate: { ideal: 15, max: 15 },
          },
        });
        const newVideoTrack = newStream.getVideoTracks()[0];
        if (newVideoTrack) {
          newVideoTrack.enabled = !this.bandwidthSaver && this.camEnabled;
          const oldTrack = this.localStream.getVideoTracks()[0];
          if (oldTrack) {
            oldTrack.stop();
            this.localStream.removeTrack(oldTrack);
          }
          this.localStream.addTrack(newVideoTrack);
          this.listenToTrackEnd(newVideoTrack, 'Camera');

          this.replaceTrackInCalls(newVideoTrack);
          this.applyBandwidthLimits();
        }
      }
      this.callbacks.onLocalStreamChange(this.localStream);
    } catch (e) {
      console.warn('Failed to switch device:', e);
      this.callbacks.onToast('Could not switch to selected device.');
    }
  }

  private replaceTrackInCalls(track: MediaStreamTrack) {
    for (const entry of this.peerConnections.values()) {
      try {
        const senders = entry.pc.getSenders();
        const sender = senders.find((s) => s.track && s.track.kind === track.kind);
        if (sender) {
          sender.replaceTrack(track).catch((err) => console.warn('replaceTrack error:', err));
        }
      } catch (err) {
        console.warn('Sender replaceTrack error:', err);
      }
    }
  }

  // --- START CALL (late-joiner or first initiator) ---
  public async startCall(): Promise<void> {
    if (this.inCall) return;

    this.callbacks.onError(null);

    let userStream: MediaStream | null = null;
    let cameraAllowed = true;
    let micAllowed = true;

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: 320 },
          height: { ideal: 240 },
          frameRate: { ideal: 15, max: 15 },
          facingMode: 'user',
          ...(this.selectedVideoDeviceId ? { deviceId: { exact: this.selectedVideoDeviceId } } : {}),
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(this.selectedAudioDeviceId ? { deviceId: { exact: this.selectedAudioDeviceId } } : {}),
        },
      };

      try {
        userStream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (firstErr) {
        console.warn('Full media request failed, attempting partial access:', firstErr);
        try {
          userStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          cameraAllowed = false;
          this.camEnabled = false;
          this.callbacks.onToast('Camera unavailable. Joined with microphone only.');
        } catch {
          micAllowed = false;
          try {
            userStream = await navigator.mediaDevices.getUserMedia({
              video: {
                width: { ideal: 320 },
                height: { ideal: 240 },
                frameRate: { ideal: 15, max: 15 },
                facingMode: 'user',
              },
            });
            this.micEnabled = false;
            this.callbacks.onToast('Microphone unavailable. Joined with camera only.');
          } catch (bothErr) {
            console.error('All media devices denied:', bothErr);
            this.callbacks.onError('Camera and microphone permission denied.');
            this.callbacks.onToast('Camera and microphone permission denied.');
            return;
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to access camera/mic.';
      this.callbacks.onError(msg);
      return;
    }

    if (!userStream) {
      this.callbacks.onError('No media stream available.');
      return;
    }

    this.localStream = userStream;
    this.inCall = true;

    for (const track of userStream.getTracks()) {
      this.listenToTrackEnd(track, track.kind === 'video' ? 'Camera' : 'Microphone');
    }

    this.camEnabled = cameraAllowed && userStream.getVideoTracks().length > 0;
    this.micEnabled = micAllowed && userStream.getAudioTracks().length > 0;

    this.callbacks.onLocalStreamChange(this.localStream);
    this.callbacks.onCallStateChange(true);
    this.callbacks.onMediaStateChange(this.camEnabled, this.micEnabled);

    this.enumerateDevices().catch(() => {});

    this.initAudioContext();
    this.setupLocalAudioAnalyser();
    this.startSpeakingDetectionLoop();

    // Attach local tracks to all existing peer connections or create connections for roster peers
    if (this.myPeerId) {
      for (const [peerId] of this.roster.entries()) {
        if (peerId === this.myPeerId) continue;
        const entry = this.getOrCreatePeerConnection(peerId);
        this.syncLocalTracksToConnection(entry.pc);
      }
    }

    // If there are peer connections already established (e.g. from incoming signals), sync tracks to them
    for (const [peerId, entry] of this.peerConnections.entries()) {
      if (peerId === this.myPeerId) continue;
      this.syncLocalTracksToConnection(entry.pc);
    }

    this.startStutterMonitor();
  }

  private listenToTrackEnd(track: MediaStreamTrack, label: string) {
    track.onended = () => {
      this.callbacks.onToast(`${label} was disconnected.`);
      if (track.kind === 'video') {
        this.camEnabled = false;
        this.callbacks.onMediaStateChange(false, this.micEnabled);
      } else {
        this.micEnabled = false;
        this.callbacks.onMediaStateChange(this.camEnabled, false);
      }
      this.enumerateDevices().catch(() => {});
    };
  }

  // --- PERFECT NEGOTIATION CONNECTION CREATION ---
  public getOrCreatePeerConnection(remotePeerId: string): PeerConnectionEntry {
    let entry = this.peerConnections.get(remotePeerId);
    if (entry) {
      return entry;
    }

    const iceServers = getIceServers();
    const pc = new RTCPeerConnection({ iceServers });
    const remoteStream = new MediaStream();

    entry = {
      pc,
      remoteStream,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      iceCandidateQueue: [],
    };
    this.peerConnections.set(remotePeerId, entry);

    // 1. onnegotiationneeded (Standard Perfect Negotiation)
    pc.onnegotiationneeded = async () => {
      const currentEntry = this.peerConnections.get(remotePeerId);
      if (!currentEntry) return;

      try {
        currentEntry.makingOffer = true;
        console.log(
          `[WebRTC Call] onnegotiationneeded (peer=${remotePeerId}, polite=${this.isPolite}): creating offer, signalingState=${pc.signalingState}`
        );
        await pc.setLocalDescription();
        console.log(
          `[WebRTC Call] Local description set (offer) for ${remotePeerId}, signalingState=${pc.signalingState}`
        );
        if (pc.localDescription) {
          this.callbacks.onSendSignal(remotePeerId, {
            type: 'description',
            description: {
              type: pc.localDescription.type,
              sdp: pc.localDescription.sdp,
            },
          });
        }
      } catch (err) {
        console.error(`[WebRTC Call] Error in onnegotiationneeded with ${remotePeerId}:`, err);
      } finally {
        currentEntry.makingOffer = false;
      }
    };

    // 2. onicecandidate
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.callbacks.onSendSignal(remotePeerId, {
          type: 'candidate',
          candidate: candidate.toJSON(),
        });
      }
    };

    // 3. onsignalingstatechange (Required for verification)
    pc.onsignalingstatechange = () => {
      console.log(`[WebRTC Call] signalingState for peer ${remotePeerId}: ${pc.signalingState}`);
    };

    // 4. onconnectionstatechange (Required for verification)
    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC Call] connectionState for peer ${remotePeerId}: ${pc.connectionState}`);
      if (pc.connectionState === 'failed') {
        console.warn(`[WebRTC Call] Connection failed with ${remotePeerId}, attempting ICE restart.`);
        try {
          pc.restartIce();
        } catch {}
      }
    };

    // 5. oniceconnectionstatechange
    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC Call] iceConnectionState for peer ${remotePeerId}: ${pc.iceConnectionState}`);
    };

    // 6. ontrack (Required for verification & handles late-arriving tracks)
    pc.ontrack = (event) => {
      console.log(
        `[WebRTC Call] ontrack event from ${remotePeerId}: kind=${event.track.kind}, id=${event.track.id}, streamCount=${event.streams.length}`
      );

      const targetStream = entry!.remoteStream;
      const existing = targetStream.getTracks().find((t) => t.id === event.track.id);
      if (!existing) {
        targetStream.addTrack(event.track);
      }

      event.track.onmute = () => {
        console.log(`[WebRTC Call] onmute track ${event.track.kind} from ${remotePeerId}`);
        this.syncRemoteParticipant(remotePeerId);
      };
      event.track.onunmute = () => {
        console.log(`[WebRTC Call] onunmute track ${event.track.kind} from ${remotePeerId}`);
        this.syncRemoteParticipant(remotePeerId);
      };
      event.track.onended = () => {
        console.log(`[WebRTC Call] onended track ${event.track.kind} from ${remotePeerId}`);
        this.syncRemoteParticipant(remotePeerId);
      };

      this.syncRemoteParticipant(remotePeerId);
      this.setupRemoteAudioAnalyser(remotePeerId, targetStream);
    };

    // Sync any existing local tracks if we are already in call
    if (this.inCall && this.localStream) {
      this.syncLocalTracksToConnection(pc);
    }

    return entry;
  }

  private syncLocalTracksToConnection(pc: RTCPeerConnection) {
    if (!this.localStream) return;

    const existingSenders = pc.getSenders();
    for (const track of this.localStream.getTracks()) {
      const matchingSender = existingSenders.find(
        (s) => s.track?.id === track.id || (s.track && s.track.kind === track.kind)
      );

      if (!matchingSender) {
        console.log(`[WebRTC Call] Adding local track ${track.kind} (${track.id}) to RTCPeerConnection`);
        pc.addTrack(track, this.localStream);
      } else if (matchingSender.track !== track) {
        console.log(`[WebRTC Call] Replacing local track ${track.kind} on existing sender`);
        matchingSender.replaceTrack(track).catch((err) => console.warn('replaceTrack error:', err));
      }
    }

    setTimeout(() => {
      this.applyBandwidthLimitsToPC(pc);
    }, 400);
  }

  private syncRemoteParticipant(remotePeerId: string) {
    const entry = this.peerConnections.get(remotePeerId);
    if (!entry) return;

    const name = this.roster.get(remotePeerId) || 'Friend';
    const videoTracks = entry.remoteStream.getVideoTracks();
    const audioTracks = entry.remoteStream.getAudioTracks();

    const camOn = videoTracks.length > 0 && videoTracks.some((t) => t.enabled && !t.muted);
    const micOn = audioTracks.length > 0 && audioTracks.some((t) => t.enabled && !t.muted);

    const participant: RemoteParticipant = {
      peerId: remotePeerId,
      name,
      stream: entry.remoteStream,
      camOn,
      micOn,
      speaking: false,
    };

    this.remoteParticipants.set(remotePeerId, participant);
    this.notifyRemoteParticipants();
  }

  // --- SIGNALING INGESTION (Offer / Answer / Glare Rollback / ICE Queue) ---
  public async handleIncomingSignal(peerId: string, signal: CallSignal) {
    const entry = this.getOrCreatePeerConnection(peerId);
    const { pc } = entry;

    try {
      if (signal.type === 'description') {
        const description = signal.description;
        const readyForOffer =
          !entry.makingOffer &&
          (pc.signalingState === 'stable' || entry.isSettingRemoteAnswerPending);
        const offerCollision = description.type === 'offer' && !readyForOffer;

        entry.ignoreOffer = !this.isPolite && offerCollision;
        if (entry.ignoreOffer) {
          console.log(
            `[WebRTC Call] Impolite peer ignoring offer collision from ${peerId}, signalingState=${pc.signalingState}`
          );
          return;
        }

        if (offerCollision && this.isPolite) {
          console.log(
            `[WebRTC Call] Polite peer rolling back on offer collision from ${peerId}, signalingState=${pc.signalingState}`
          );
          await Promise.all([
            pc.setLocalDescription({ type: 'rollback' }),
            pc.setRemoteDescription(description),
          ]);
        } else {
          entry.isSettingRemoteAnswerPending = description.type === 'answer';
          await pc.setRemoteDescription(description);
          entry.isSettingRemoteAnswerPending = false;
        }

        console.log(
          `[WebRTC Call] setRemoteDescription success (${description.type}) from ${peerId}, signalingState=${pc.signalingState}`
        );

        // Process queued ICE candidates that arrived before remoteDescription was set
        if (entry.iceCandidateQueue.length > 0) {
          console.log(
            `[WebRTC Call] Draining ${entry.iceCandidateQueue.length} queued ICE candidate(s) for ${peerId}`
          );
          while (entry.iceCandidateQueue.length > 0) {
            const cand = entry.iceCandidateQueue.shift();
            if (cand) {
              try {
                await pc.addIceCandidate(cand);
              } catch (e) {
                console.warn('[WebRTC Call] Error adding queued ICE candidate:', e);
              }
            }
          }
        }

        if (description.type === 'offer') {
          await pc.setLocalDescription();
          console.log(
            `[WebRTC Call] Answer created & local description set for ${peerId}, signalingState=${pc.signalingState}`
          );
          if (pc.localDescription) {
            this.callbacks.onSendSignal(peerId, {
              type: 'description',
              description: {
                type: pc.localDescription.type,
                sdp: pc.localDescription.sdp,
              },
            });
          }
        }
      } else if (signal.type === 'candidate') {
        const candidate = signal.candidate;
        if (!pc.remoteDescription || !pc.remoteDescription.type) {
          console.log(`[WebRTC Call] Queueing ICE candidate for ${peerId} before remoteDescription is set`);
          entry.iceCandidateQueue.push(candidate);
        } else {
          try {
            await pc.addIceCandidate(candidate);
          } catch (err) {
            if (!entry.ignoreOffer) {
              console.warn('[WebRTC Call] Error adding ICE candidate:', err);
            }
          }
        }
      }
    } catch (err) {
      console.error(`[WebRTC Call] Error handling signal from ${peerId}:`, err);
    }
  }

  private cleanupPeer(peerId: string) {
    const entry = this.peerConnections.get(peerId);
    if (entry) {
      try {
        entry.pc.close();
      } catch {}
      this.peerConnections.delete(peerId);
    }
    this.remoteParticipants.delete(peerId);
    const analyser = this.remoteAnalysers.get(peerId);
    if (analyser) {
      this.remoteAnalysers.delete(peerId);
    }
    this.speechHoldTimers.delete(peerId);
    this.notifyRemoteParticipants();
  }

  private notifyRemoteParticipants() {
    this.callbacks.onRemoteStreamsChange(new Map(this.remoteParticipants));
  }

  public toggleCam(): void {
    if (!this.localStream) return;
    const videoTracks = this.localStream.getVideoTracks();
    if (videoTracks.length === 0) {
      this.callbacks.onToast('No camera found on this device.');
      return;
    }

    this.camEnabled = !this.camEnabled;
    for (const track of videoTracks) {
      track.enabled = this.camEnabled && !this.bandwidthSaver;
    }

    this.callbacks.onMediaStateChange(this.camEnabled && !this.bandwidthSaver, this.micEnabled);
  }

  public toggleMic(): void {
    if (!this.localStream) return;
    const audioTracks = this.localStream.getAudioTracks();
    if (audioTracks.length === 0) {
      this.callbacks.onToast('No microphone found on this device.');
      return;
    }

    this.micEnabled = !this.micEnabled;
    for (const track of audioTracks) {
      track.enabled = this.micEnabled;
    }

    this.callbacks.onMediaStateChange(this.camEnabled && !this.bandwidthSaver, this.micEnabled);
  }

  private applyBandwidthLimits() {
    for (const entry of this.peerConnections.values()) {
      this.applyBandwidthLimitsToPC(entry.pc);
    }
  }

  private applyBandwidthLimitsToPC(pc: RTCPeerConnection) {
    const cfg = QUALITY_CONFIG[this.quality];

    try {
      const senders = pc.getSenders();
      for (const sender of senders) {
        if (sender.track?.kind === 'video') {
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          params.encodings[0].maxBitrate = cfg.maxBitrate;
          params.encodings[0].maxFramerate = cfg.maxFps;
          params.encodings[0].scaleResolutionDownBy = cfg.scaleDown;
          sender.setParameters(params).catch(() => {});
        } else if (sender.track?.kind === 'audio') {
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          params.encodings[0].maxBitrate = 32_000;
          sender.setParameters(params).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('Bitrate limiting error:', e);
    }
  }

  // --- AUDIO ANALYSIS & DUCKING ---
  private initAudioContext() {
    if (!this.audioCtx) {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtxClass) {
        this.audioCtx = new AudioCtxClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  private setupLocalAudioAnalyser() {
    if (!this.audioCtx || !this.localStream) return;
    const audioTracks = this.localStream.getAudioTracks();
    if (audioTracks.length === 0) return;

    try {
      const source = this.audioCtx.createMediaStreamSource(this.localStream);
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
      this.localAnalyser = analyser;
    } catch (e) {
      console.warn('Local analyser setup failed:', e);
    }
  }

  private setupRemoteAudioAnalyser(peerId: string, stream: MediaStream) {
    if (!this.audioCtx) return;
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return;

    try {
      const source = this.audioCtx.createMediaStreamSource(stream);
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
      this.remoteAnalysers.set(peerId, analyser);
    } catch (e) {
      console.warn('Remote analyser setup failed:', e);
    }
  }

  private startSpeakingDetectionLoop() {
    if (this.speakingAnimFrame) return;

    const dataArray = new Uint8Array(128);
    const RMS_THRESHOLD = 0.04;

    let lastAnySpeaking = false;

    const checkSpeaking = () => {
      if (!this.inCall) return;

      const now = Date.now();
      let someoneElseSpeaking = false;

      let changedRemote = false;
      for (const [peerId, analyser] of this.remoteAnalysers.entries()) {
        analyser.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const val = (dataArray[i] - 128) / 128;
          sum += val * val;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const participant = this.remoteParticipants.get(peerId);

        if (rms > RMS_THRESHOLD) {
          this.speechHoldTimers.set(peerId, now + 600);
          if (participant && !participant.speaking) {
            participant.speaking = true;
            changedRemote = true;
          }
          someoneElseSpeaking = true;
        } else {
          const holdUntil = this.speechHoldTimers.get(peerId) || 0;
          if (now < holdUntil) {
            someoneElseSpeaking = true;
          } else if (participant && participant.speaking) {
            participant.speaking = false;
            changedRemote = true;
          }
        }
      }

      if (changedRemote) {
        this.notifyRemoteParticipants();
      }

      if (this.localAnalyser && this.micEnabled) {
        this.localAnalyser.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const val = (dataArray[i] - 128) / 128;
          sum += val * val;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        this.isSpeakingLocally = rms > RMS_THRESHOLD;
      }

      const shouldDuck = this.duckingEnabled && someoneElseSpeaking;
      if (shouldDuck !== lastAnySpeaking) {
        lastAnySpeaking = shouldDuck;
        const multiplier = shouldDuck ? 0.3 : 1.0;
        this.callbacks.onSpeakingChange(shouldDuck, multiplier);
      }

      this.speakingAnimFrame = requestAnimationFrame(checkSpeaking);
    };

    this.speakingAnimFrame = requestAnimationFrame(checkSpeaking);
  }

  private startStutterMonitor() {
    if (this.stutterInterval) return;

    this.consecutiveBadStats = 0;
    this.stutterInterval = window.setInterval(async () => {
      if (!this.inCall || this.peerConnections.size === 0) return;

      for (const entry of this.peerConnections.values()) {
        try {
          const stats = await entry.pc.getStats();
          let packetsLost = 0;
          let packetsSent = 0;

          stats.forEach((report) => {
            if (report.type === 'outbound-rtp' && report.kind === 'video') {
              packetsSent += report.packetsSent || 0;
            }
            if (report.type === 'remote-inbound-rtp' && report.kind === 'video') {
              packetsLost += report.packetsLost || 0;
            }
          });

          if (packetsSent > 100) {
            const lossRate = packetsLost / (packetsLost + packetsSent);
            if (lossRate > 0.05) {
              this.consecutiveBadStats++;
              if (this.consecutiveBadStats >= 2 && !this.bandwidthSaver) {
                this.callbacks.onStutterWarning(true);
              }
            } else {
              this.consecutiveBadStats = Math.max(0, this.consecutiveBadStats - 1);
            }
          }
        } catch {}
        break;
      }
    }, 3000);
  }

  // --- END CALL (Stops camera/mic tracks, removes senders) ---
  public endCall(): void {
    if (!this.inCall) return;

    this.inCall = false;

    if (this.speakingAnimFrame) {
      cancelAnimationFrame(this.speakingAnimFrame);
      this.speakingAnimFrame = null;
    }

    if (this.stutterInterval) {
      clearInterval(this.stutterInterval);
      this.stutterInterval = null;
    }

    // Stop local tracks
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        try {
          track.stop();
        } catch {}
      }
      this.localStream = null;
    }

    // Remove local tracks from all active peer connections
    for (const entry of this.peerConnections.values()) {
      try {
        const senders = entry.pc.getSenders();
        for (const sender of senders) {
          try {
            entry.pc.removeTrack(sender);
          } catch {}
        }
      } catch {}
    }

    if (this.audioCtx) {
      try {
        this.audioCtx.close().catch(() => {});
      } catch {}
      this.audioCtx = null;
    }
    this.localAnalyser = null;
    this.remoteAnalysers.clear();
    this.speechHoldTimers.clear();

    this.callbacks.onLocalStreamChange(null);
    this.callbacks.onCallStateChange(false);
    this.callbacks.onSpeakingChange(false, 1.0);
    this.callbacks.onStutterWarning(false);
  }

  public cleanup(): void {
    this.endCall();
    for (const entry of this.peerConnections.values()) {
      try {
        entry.pc.close();
      } catch {}
    }
    this.peerConnections.clear();
    this.remoteParticipants.clear();
    this.roster.clear();
    this.callbacks.onRemoteStreamsChange(new Map());
  }
}
