import { Peer, MediaConnection } from 'peerjs';

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
}

const QUALITY_CONFIG: Record<CallQuality, { maxBitrate: number; scaleDown: number; maxFps: number }> = {
  low: { maxBitrate: 100_000, scaleDown: 2, maxFps: 15 },
  medium: { maxBitrate: 200_000, scaleDown: 1, maxFps: 15 },
  high: { maxBitrate: 500_000, scaleDown: 1, maxFps: 20 },
};

export class CallManager {
  private localStream: MediaStream | null = null;
  private peer: Peer | null = null;
  private myPeerId: string | null = null;
  private myName: string = 'User';

  private inCall: boolean = false;
  private camEnabled: boolean = true;
  private micEnabled: boolean = true;
  private bandwidthSaver: boolean = false;
  private quality: CallQuality = 'medium';
  private duckingEnabled: boolean = true;

  // Active call connections: peerId -> MediaConnection
  private connections: Map<string, MediaConnection> = new Map();
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

  public setPeer(peer: Peer | null, myPeerId: string | null, myName: string) {
    this.peer = peer;
    this.myPeerId = myPeerId;
    this.myName = myName;
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

    // If we are currently in a call, connect to any peer in the roster we haven't connected to yet
    if (this.inCall && this.localStream && this.peer && this.myPeerId) {
      for (const p of peers) {
        if (p.id === this.myPeerId) continue;
        // Lexicographical tie-breaker: the smaller peer ID initiates
        if (this.myPeerId < p.id && !this.connections.has(p.id)) {
          this.initiateCall(p.id);
        }
      }
    }
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

          // Replace track in active calls
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

          // Replace track in active calls
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
    for (const conn of this.connections.values()) {
      try {
        const senders = conn.peerConnection.getSenders();
        const sender = senders.find((s) => s.track && s.track.kind === track.kind);
        if (sender) {
          sender.replaceTrack(track).catch((err) => console.warn('replaceTrack error:', err));
        }
      } catch (err) {
        console.warn('Sender replaceTrack error:', err);
      }
    }
  }

  public async startCall(): Promise<void> {
    if (this.inCall) return;

    this.callbacks.onError(null);

    // Request camera and microphone
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
        // Try audio-only if camera was denied or not found
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
          // Try video-only
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

    // Attach track ended listeners
    for (const track of userStream.getTracks()) {
      this.listenToTrackEnd(track, track.kind === 'video' ? 'Camera' : 'Microphone');
    }

    this.camEnabled = cameraAllowed && userStream.getVideoTracks().length > 0;
    this.micEnabled = micAllowed && userStream.getAudioTracks().length > 0;

    this.callbacks.onLocalStreamChange(this.localStream);
    this.callbacks.onCallStateChange(true);
    this.callbacks.onMediaStateChange(this.camEnabled, this.micEnabled);

    // Refresh devices list
    this.enumerateDevices().catch(() => {});

    // Set up audio analysis for speech & ducking
    this.initAudioContext();
    this.setupLocalAudioAnalyser();
    this.startSpeakingDetectionLoop();

    // Call all participants in roster where myPeerId < remotePeerId
    if (this.peer && this.myPeerId) {
      for (const [peerId] of this.roster.entries()) {
        if (peerId === this.myPeerId) continue;
        if (this.myPeerId < peerId && !this.connections.has(peerId)) {
          this.initiateCall(peerId);
        }
      }
    }

    // Start movie stream stutter detection
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

  public handleIncomingCall(call: MediaConnection): boolean {
    if (call.metadata?.kind !== 'cam') {
      return false; // Not a camera call; let movie handler take it
    }

    const remotePeerId = call.peer;

    // If we're not in a call, we can answer with a blank or silent stream or answer once user joins
    // If we are in a call, answer with our local stream
    if (this.inCall && this.localStream) {
      call.answer(this.localStream);
      this.registerCall(call, remotePeerId);
    } else {
      // User is not in call yet; answer with dummy/empty stream or decline
      // In PeerJS, if receiver doesn't answer, connection hangs.
      // We answer with empty audio track or close if not in call.
      call.close();
    }
    return true;
  }

  public onPeerJoinedCall(remotePeerId: string) {
    // If we are in call and myPeerId < remotePeerId, initiate call
    if (this.inCall && this.localStream && this.peer && this.myPeerId) {
      if (this.myPeerId < remotePeerId && !this.connections.has(remotePeerId)) {
        this.initiateCall(remotePeerId);
      }
    }
  }

  private initiateCall(remotePeerId: string) {
    if (!this.peer || !this.localStream) return;

    try {
      const call = this.peer.call(remotePeerId, this.localStream, {
        metadata: { kind: 'cam', name: this.myName },
      });
      this.registerCall(call, remotePeerId);
    } catch (e) {
      console.warn('Failed to initiate camera call to', remotePeerId, e);
    }
  }

  private registerCall(call: MediaConnection, remotePeerId: string) {
    this.connections.set(remotePeerId, call);

    call.on('stream', (remoteStream: MediaStream) => {
      const name = this.roster.get(remotePeerId) || call.metadata?.name || 'Friend';
      const participant: RemoteParticipant = {
        peerId: remotePeerId,
        name,
        stream: remoteStream,
        camOn: remoteStream.getVideoTracks().some((t) => t.enabled),
        micOn: remoteStream.getAudioTracks().some((t) => t.enabled),
        speaking: false,
      };

      this.remoteParticipants.set(remotePeerId, participant);
      this.notifyRemoteParticipants();

      // Setup audio analyser for this remote stream
      this.setupRemoteAudioAnalyser(remotePeerId, remoteStream);

      // Apply bitrate capping
      setTimeout(() => {
        this.applyBandwidthLimitsToConnection(call);
      }, 500);
    });

    call.on('close', () => {
      this.cleanupPeer(remotePeerId);
    });

    call.on('error', (err) => {
      console.warn('Call error with peer:', remotePeerId, err);
      this.cleanupPeer(remotePeerId);
    });
  }

  private cleanupPeer(peerId: string) {
    const conn = this.connections.get(peerId);
    if (conn) {
      try {
        conn.close();
      } catch {}
      this.connections.delete(peerId);
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
    for (const conn of this.connections.values()) {
      this.applyBandwidthLimitsToConnection(conn);
    }
  }

  private applyBandwidthLimitsToConnection(conn: MediaConnection) {
    if (!conn.peerConnection) return;
    const cfg = QUALITY_CONFIG[this.quality];

    try {
      const senders = conn.peerConnection.getSenders();
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
          params.encodings[0].maxBitrate = 32_000; // 32 kbps opus
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
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
    const RMS_THRESHOLD = 0.04; // Sensitivity threshold for speech

    let lastAnySpeaking = false;

    const checkSpeaking = () => {
      if (!this.inCall) return;

      const now = Date.now();
      let someoneElseSpeaking = false;

      // Check remote speakers
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

      // Check local speaker
      if (this.localAnalyser && this.micEnabled) {
        this.localAnalyser.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const val = (dataArray[i] - 128) / 128;
          sum += val * val;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const wasSpeakingLocally = this.isSpeakingLocally;
        this.isSpeakingLocally = rms > RMS_THRESHOLD;
        if (this.isSpeakingLocally !== wasSpeakingLocally) {
          // Self speaking updated
        }
      }

      // Ducking multiplier: 30% when someone else is speaking
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

  // --- STUTTER MONITOR (for movie upload) ---
  private startStutterMonitor() {
    if (this.stutterInterval) return;

    this.consecutiveBadStats = 0;
    this.stutterInterval = window.setInterval(async () => {
      if (!this.inCall || this.connections.size === 0) return;

      // Sample first connection to see packet loss
      for (const conn of this.connections.values()) {
        if (!conn.peerConnection) continue;
        try {
          const stats = await conn.peerConnection.getStats();
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
        } catch {
          // ignore stats errors
        }
        break;
      }
    }, 3000);
  }

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

    // Close all connections
    for (const conn of this.connections.values()) {
      try {
        conn.close();
      } catch {}
    }
    this.connections.clear();
    this.remoteParticipants.clear();
    this.remoteAnalysers.clear();
    this.speechHoldTimers.clear();

    if (this.audioCtx) {
      try {
        this.audioCtx.close().catch(() => {});
      } catch {}
      this.audioCtx = null;
    }
    this.localAnalyser = null;

    this.callbacks.onLocalStreamChange(null);
    this.callbacks.onRemoteStreamsChange(new Map());
    this.callbacks.onCallStateChange(false);
    this.callbacks.onSpeakingChange(false, 1.0);
    this.callbacks.onStutterWarning(false);
  }

  public cleanup(): void {
    this.endCall();
    this.roster.clear();
  }
}
