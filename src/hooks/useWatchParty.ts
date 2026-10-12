import { useState, useEffect, useRef, useCallback } from 'react';
import {
  watchPartyService,
  WatchPartyRole,
  WatchPartyStatus,
  WatchPartyCommand,
  MovieQuality,
} from '../utils/watchParty';
import { SubtitleTrack } from '../types/media';
import { ChatMessage } from '../types/chat';
import { playChatNotificationSound } from '../utils/chatSound';
import { audioEngine } from '../utils/audioEngine';
import {
  CallManager,
  RemoteParticipant,
  CallQuality,
  CallDevices,
} from '../utils/callManager';
import { fileTransferManager, TransferProgress } from '../utils/fileTransfer';
import { movieStore } from '../utils/movieStore';

export interface HostMediaState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  mediaName: string;
  isAudio: boolean;
  allowGuestControl: boolean;
  sentAt?: number;
}

function sanitizeChatText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const stripped = raw.replace(/[\x00-\x1F\x7F-\x9F\u200B-\u200D\uFEFF]/g, '');
  return stripped.trim().slice(0, 500);
}

function sanitizeChatName(raw: unknown, defaultName = 'Guest'): string {
  if (typeof raw !== 'string') return defaultName;
  const stripped = raw.replace(/[\x00-\x1F\x7F-\x9F\u200B-\u200D\uFEFF]/g, '');
  const trimmed = stripped.trim().slice(0, 20);
  return trimmed || defaultName;
}

function getOrCreateClientId(): string {
  try {
    const existing = sessionStorage.getItem('omniplay-client-id');
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem('omniplay-client-id', fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
}

export function useWatchParty(options?: {
  mediaElement?: HTMLMediaElement | null;
  currentMediaUrl?: string;
  mediaTitle?: string;
  isAudio?: boolean;
  activeSubtitleTrack?: SubtitleTrack | null;
  onToast?: (msg: string) => void;
}) {
  const myClientIdRef = useRef<string>('');
  if (!myClientIdRef.current) {
    myClientIdRef.current = getOrCreateClientId();
  }

  const {
    mediaElement,
    currentMediaUrl,
    mediaTitle = 'Media',
    isAudio = false,
    activeSubtitleTrack = null,
    onToast,
  } = options || {};

  const [role, setRole] = useState<WatchPartyRole>(watchPartyService.getRole());
  const [roomCode, setRoomCode] = useState<string | null>(watchPartyService.getRoomCode());
  const [status, setStatus] = useState<WatchPartyStatus>(watchPartyService.getStatus());
  const [errorMessage, setErrorMessage] = useState<string | null>(watchPartyService.getErrorMessage());
  const [viewerCount, setViewerCount] = useState<number>(watchPartyService.getViewerCount());
  const [allowGuestControl, setAllowGuestControl] = useState<boolean>(true);

  // Keep references to prevent stale closures
  const roleRef = useRef<WatchPartyRole>(role);
  roleRef.current = role;

  const allowGuestControlRef = useRef<boolean>(allowGuestControl);
  allowGuestControlRef.current = allowGuestControl;

  const mediaElementRef = useRef<HTMLMediaElement | null>(mediaElement || null);
  useEffect(() => {
    if (mediaElement) {
      mediaElementRef.current = mediaElement;
    }
  }, [mediaElement]);

  const getMediaElement = useCallback((): HTMLMediaElement | null => {
    if (mediaElementRef.current) return mediaElementRef.current;
    if (mediaElement) return mediaElement;
    if (typeof document !== 'undefined') {
      return document.querySelector('video, audio') as HTMLMediaElement | null;
    }
    return null;
  }, [mediaElement]);

  // Guest-specific state
  const [incomingStream, setIncomingStream] = useState<MediaStream | null>(watchPartyService.getIncomingStream());
  const [isReconnecting, setIsReconnecting] = useState<boolean>(false);
  const [guestSubtitleTrack, setGuestSubtitleTrack] = useState<SubtitleTrack | null>(null);
  const [hostState, setHostState] = useState<HostMediaState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    playbackRate: 1,
    mediaName: '',
    isAudio: false,
    allowGuestControl: true,
  });

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isChatOpen, setIsChatOpen] = useState<boolean>(false);
  const isChatOpenRef = useRef<boolean>(false);
  isChatOpenRef.current = isChatOpen;

  const [chatError, setChatError] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('omniplay-chat-sound') === 'true';
    } catch {
      return false;
    }
  });
  const soundEnabledRef = useRef<boolean>(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  const [movieQuality, setMovieQualityState] = useState<MovieQuality>(() =>
    watchPartyService.getMovieQuality()
  );

  useEffect(() => {
    return watchPartyService.onMovieQuality((q) => {
      setMovieQualityState(q);
    });
  }, []);

  const setMovieQuality = useCallback((q: MovieQuality) => {
    watchPartyService.setMovieQuality(q);
  }, []);

  // Video Call State
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, RemoteParticipant>>(new Map());
  const [inCall, setInCall] = useState<boolean>(false);
  const [camEnabled, setCamEnabled] = useState<boolean>(true);
  const [micEnabled, setMicEnabled] = useState<boolean>(true);
  const [callDevices, setCallDevices] = useState<CallDevices>({ audioInputs: [], videoInputs: [] });
  const [callQuality, setCallQualityState] = useState<CallQuality>('medium');
  const [isDuckingEnabled, setIsDuckingEnabledState] = useState<boolean>(true);
  const [bandwidthSaver, setBandwidthSaver] = useState<boolean>(false);
  const [hostStutterWarning, setHostStutterWarning] = useState<boolean>(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [volumeDuckingMultiplier, setVolumeDuckingMultiplier] = useState<number>(1.0);
  const [incomingCall, setIncomingCall] = useState<{
    active: boolean;
    peerId: string;
    name: string;
  } | null>(null);

  // File Transfer State
  const [transferProgress, setTransferProgress] = useState<TransferProgress | null>(null);
  const [isLocalPlayback, setIsLocalPlayback] = useState<boolean>(false);
  const [localVideoUrl, setLocalVideoUrl] = useState<string | null>(null);
  const bufferingTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    fileTransferManager.setToastListener((msg) => onToast?.(msg));
    const unsubProgress = fileTransferManager.onProgress((p) => {
      setTransferProgress(p ? { ...p } : null);
    });
    const unsubLocal = fileTransferManager.onLocalMode((isLocal, objectUrl) => {
      setIsLocalPlayback(isLocal);
      setLocalVideoUrl(objectUrl || null);
    });
    const unsubConn = watchPartyService.onFileTransferConnection((conn) => {
      fileTransferManager.handleIncomingConnection(
        conn,
        roleRef.current === 'host' || watchPartyService.getRole() === 'host'
      );
    });

    return () => {
      unsubProgress();
      unsubLocal();
      unsubConn();
    };
  }, [onToast]);

  const callManagerRef = useRef<CallManager | null>(null);
  const inCallRef = useRef<boolean>(false);

  // Host-side participant registry & rate limiting
  const participantsRef = useRef<Map<string, string>>(new Map()); // peerId -> displayName
  const guestSeqRef = useRef<number>(1);
  const rateLimitMapRef = useRef<Map<string, { lastTime: number; timestamps: number[] }>>(new Map());

  const getSavedDisplayName = useCallback((): string => {
    try {
      return localStorage.getItem('omniplay-chat-name') || '';
    } catch {
      return '';
    }
  }, []);

  const getHostPeerId = useCallback((): string => {
    const code = roomCode || watchPartyService.getRoomCode();
    return code ? `omniplay-v1-${code}` : 'host';
  }, [roomCode]);

  const lastHeartbeatRef = useRef<number>(Date.now());
  const isRemoteExecutingRef = useRef<boolean>(false);

  // Initialize CallManager once
  if (!callManagerRef.current) {
    callManagerRef.current = new CallManager({
      onRemoteStreamsChange: (streams) => setRemoteStreams(streams),
      onLocalStreamChange: (stream) => setLocalStream(stream),
      onCallStateChange: (active) => {
        inCallRef.current = active;
        setInCall(active);
        if (active) setIncomingCall(null);
        watchPartyService.notifyCallState(active);
      },
      onMediaStateChange: (cam, mic) => {
        setCamEnabled(cam);
        setMicEnabled(mic);
        watchPartyService.sendCommand({
          type: 'media-state',
          camOn: cam,
          micOn: mic,
        });
      },
      onSpeakingChange: (_anyoneSpeaking, multiplier) => {
        setVolumeDuckingMultiplier(multiplier);
      },
      onStutterWarning: (show) => setHostStutterWarning(show),
      onDevicesChange: (devs) => setCallDevices(devs),
      onToast: (msg) => onToast?.(msg),
      onError: (err) => setCallError(err),
      onSendSignal: (targetPeerId, signal) => {
        const isHost = roleRef.current === 'host' || watchPartyService.getRole() === 'host';
        const hostPeerId = getHostPeerId();
        const myPeerId = watchPartyService.getMyPeerId() || (isHost ? hostPeerId : undefined);
        const resolvedTargetId = targetPeerId === 'host' ? hostPeerId : targetPeerId;
        const msg = {
          type: 'party-signal' as const,
          kind: 'call' as const,
          senderId: myPeerId || hostPeerId,
          targetId: resolvedTargetId,
          signal,
        };
        if (isHost) {
          watchPartyService.sendToPeer(resolvedTargetId, msg);
        } else {
          watchPartyService.sendCommand(msg);
        }
      },
    });
  }

  // Update CallManager peer identity on room / role changes
  useEffect(() => {
    if (callManagerRef.current) {
      const isHost = role === 'host';
      const hostPeerId = getHostPeerId();
      const myPeerId = watchPartyService.getMyPeerId() || (isHost ? hostPeerId : null);
      const myDisplayName = getSavedDisplayName() || (isHost ? 'Host' : 'Guest');
      callManagerRef.current.setPeerInfo(
        myPeerId,
        myDisplayName,
        !isHost,
        hostPeerId,
        isHost ? myDisplayName : 'Host'
      );
    }
  }, [role, status, getSavedDisplayName, getHostPeerId]);

  // Hook into roster events from watchPartyService
  useEffect(() => {
    const unsubRoster = watchPartyService.onRoster((peers) => {
      callManagerRef.current?.setRoster(peers);

      // Phase 3C: Mesh P2P piece sharing between guests (only when 2+ guests)
      const myPeerId = watchPartyService.getMyPeerId();
      const currentRole = watchPartyService.getRole();
      if (currentRole === 'guest' && myPeerId) {
        // Find other guests (excluding host and self)
        const otherGuests = peers.filter(
          (p) => p.id !== 'host' && p.id !== myPeerId && !p.id.startsWith('OMNI-')
        );
        // Only when there are 2+ guests total (self + at least one other guest)
        if (otherGuests.length >= 1) {
          otherGuests.forEach((g) => {
            // Deterministic initiator to avoid duplicate symmetric connections
            if (myPeerId < g.id) {
              watchPartyService.connectToMeshPeer(g.id);
            }
          });
        }
      }
    });
    return () => {
      unsubRoster();
    };
  }, []);

  // Host rate limiter (max 1 msg per 500ms, max 20 msgs per 30s)
  const checkRateLimit = useCallback((senderPeerId: string): boolean => {
    const now = Date.now();
    let record = rateLimitMapRef.current.get(senderPeerId);
    if (!record) {
      record = { lastTime: 0, timestamps: [] };
      rateLimitMapRef.current.set(senderPeerId, record);
    }
    if (now - record.lastTime < 500) {
      return false;
    }
    record.timestamps = record.timestamps.filter((t) => now - t < 30000);
    if (record.timestamps.length >= 20) {
      return false;
    }
    record.lastTime = now;
    record.timestamps.push(now);
    return true;
  }, []);

  // Host: broadcast current state helper
  const broadcastCurrentState = useCallback(() => {
    const isHost = roleRef.current === 'host' || watchPartyService.getRole() === 'host';
    if (!isHost) return;
    const el = getMediaElement();
    const currentState: HostMediaState = {
      isPlaying: el ? !el.paused : false,
      currentTime: el ? el.currentTime : 0,
      duration: el ? (Number.isFinite(el.duration) ? el.duration : 0) : 0,
      playbackRate: el ? el.playbackRate : 1,
      mediaName: mediaTitle,
      isAudio: !!isAudio,
      allowGuestControl: allowGuestControlRef.current,
      sentAt: Date.now(),
    };
    watchPartyService.sendCommand({
      type: 'state',
      ...currentState,
    });
  }, [getMediaElement, mediaTitle, isAudio]);

  // Broadcast a chat message to all participants (host-side)
  const hostBroadcastChatMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => {
      const next = [...prev, msg].slice(-200);
      messagesRef.current = next;
      return next;
    });

    watchPartyService.sendCommand({
      type: 'chat-msg',
      msg,
    });

    const isOwn = Boolean(msg.senderId) && msg.senderId === myClientIdRef.current;
    if (!isOwn && !isChatOpenRef.current && msg.kind !== 'system') {
      setUnreadCount((c) => c + 1);
      if (!document.fullscreenElement) {
        onToast?.(`${msg.from}: ${msg.text}`);
      }
      if (soundEnabledRef.current) {
        playChatNotificationSound();
      }
    }
  }, [onToast]);

  // Sync service state with local react state
  useEffect(() => {
    const unsubStatus = watchPartyService.onStatus((newStatus, errorMsg) => {
      setStatus(newStatus);
      setRole(watchPartyService.getRole());
      setRoomCode(watchPartyService.getRoomCode());
      setErrorMessage(errorMsg || null);
    });

    const unsubCount = watchPartyService.onViewerCount((count) => {
      setViewerCount(count);
    });

    const unsubStream = watchPartyService.onStream((stream) => {
      setIncomingStream(stream);
    });

    const unsubFriendLeft = watchPartyService.onFriendLeft((peerId) => {
      const guestName = participantsRef.current.get(peerId);
      if (guestName && roleRef.current === 'host') {
        const sysMsg: ChatMessage = {
          id: crypto.randomUUID(),
          from: 'System',
          fromId: 'system',
          text: `${guestName} left`,
          ts: Date.now(),
          kind: 'system',
        };
        hostBroadcastChatMessage(sysMsg);
        participantsRef.current.delete(peerId);
      }
    });

    return () => {
      unsubStatus();
      unsubCount();
      unsubStream();
      unsubFriendLeft();
    };
  }, [hostBroadcastChatMessage]);

  // Host: update captured media stream
  const updateCapturedStream = useCallback(() => {
    const isHost = roleRef.current === 'host' || watchPartyService.getRole() === 'host';
    if (!isHost) return;

    const el = getMediaElement();
    if (!el) return;

    try {
      // Check 1: Host player must only use src (the blob/object URL).
      // captureStream() is read from it, NEVER assigned back to host element's srcObject.
      const mediaEl = el as unknown as {
        captureStream?: () => MediaStream;
        mozCaptureStream?: () => MediaStream;
        srcObject?: MediaStream | null;
      };

      if (mediaEl.srcObject) {
        console.warn('[OmniPlay Host] Clearing unexpected srcObject on host media element');
        mediaEl.srcObject = null;
      }

      let captured: MediaStream | null = null;
      try {
        if (typeof (mediaEl as any).captureStream === 'function') {
          captured = (mediaEl as any).captureStream(30);
        } else if (typeof (mediaEl as any).mozCaptureStream === 'function') {
          captured = (mediaEl as any).mozCaptureStream(30);
        }
      } catch (err) {
        console.warn('[OmniPlay Host] captureStream(30) fallback:', err);
        try {
          if (typeof (mediaEl as any).captureStream === 'function') {
            captured = (mediaEl as any).captureStream();
          }
        } catch {}
      }

      // Propagate source video resolution to watchPartyService for scaleResolutionDownBy calculation
      const videoEl = el as HTMLVideoElement;
      if (videoEl.videoWidth && videoEl.videoHeight) {
        watchPartyService.setSourceDimensions(videoEl.videoWidth, videoEl.videoHeight);
      }

      const audioTrack = audioEngine.getCaptureAudioTrack();
      const combined = new MediaStream();

      if (!isAudio && captured) {
        captured.getVideoTracks().forEach((vt) => {
          try {
            // Optimizes WebRTC encoder for smooth framerate and fine motion (movies)
            vt.contentHint = 'motion';
          } catch {
            // Ignore if contentHint unsupported in legacy environments
          }
          combined.addTrack(vt);
        });
      }

      if (audioTrack) {
        combined.addTrack(audioTrack);
      } else if (captured && captured.getAudioTracks().length > 0) {
        captured.getAudioTracks().forEach((at) => combined.addTrack(at));
      }

      // Pass captured stream exclusively to watchPartyService for peer streaming
      watchPartyService.setCurrentMediaStream(combined);
    } catch (err) {
      console.warn('Failed to capture stream for WatchParty:', err);
    }
  }, [getMediaElement, isAudio]);

  useEffect(() => {
    updateCapturedStream();

    const el = getMediaElement();
    if (!el || role !== 'host') return;

    const handleMeta = () => {
      const v = el as HTMLVideoElement;
      if (v.videoWidth && v.videoHeight) {
        watchPartyService.setSourceDimensions(v.videoWidth, v.videoHeight);
      }
    };

    el.addEventListener('loadedmetadata', handleMeta);
    el.addEventListener('resize', handleMeta);
    return () => {
      el.removeEventListener('loadedmetadata', handleMeta);
      el.removeEventListener('resize', handleMeta);
    };
  }, [updateCapturedStream, currentMediaUrl, getMediaElement, role]);

  // Host: Heartbeat interval (every 2 seconds)
  useEffect(() => {
    if (role !== 'host') return;

    const timer = setInterval(() => {
      if (roleRef.current === 'host' || watchPartyService.getRole() === 'host') {
        const el = getMediaElement();
        watchPartyService.sendCommand({
          type: 'heartbeat',
          timestamp: Date.now(),
          sentAt: Date.now(),
          isPlaying: el ? !el.paused : false,
          currentTime: el ? el.currentTime : 0,
          duration: el ? (Number.isFinite(el.duration) ? el.duration : 0) : 0,
          playbackRate: el ? el.playbackRate : 1,
          mediaName: mediaTitle,
          isAudio: !!isAudio,
          allowGuestControl: allowGuestControlRef.current,
        });
      }
    }, 2000);

    return () => clearInterval(timer);
  }, [role, getMediaElement, mediaTitle, isAudio]);

  // Host: Broadcast subtitles when changed
  useEffect(() => {
    if (role !== 'host') return;
    watchPartyService.sendCommand({
      type: 'subtitles',
      track: activeSubtitleTrack
        ? {
            name: activeSubtitleTrack.name,
            cues: activeSubtitleTrack.cues,
            delaySeconds: activeSubtitleTrack.delaySeconds,
          }
        : null,
    });
  }, [role, activeSubtitleTrack]);

  // Command handlers
  useEffect(() => {
    const unsubCmd = watchPartyService.onCommand((cmd: WatchPartyCommand, senderPeerId: string) => {
      if (cmd.type === 'heartbeat' || cmd.type === 'state') {
        lastHeartbeatRef.current = Date.now();
        setIsReconnecting(false);
        setHostState({
          isPlaying: cmd.isPlaying,
          currentTime: cmd.currentTime,
          duration: cmd.duration,
          playbackRate: cmd.playbackRate,
          mediaName: cmd.mediaName,
          isAudio: cmd.isAudio,
          allowGuestControl: cmd.allowGuestControl,
          sentAt: cmd.sentAt || cmd.timestamp || Date.now(),
        });
      } else if (cmd.type === 'guest-buffering') {
        if (roleRef.current === 'host' || watchPartyService.getRole() === 'host') {
          const el = getMediaElement();
          if (el && !el.paused) {
            el.pause();
            broadcastCurrentState();
            onToast?.(`Waiting for ${cmd.name}...`);
            if (bufferingTimeoutRef.current) clearTimeout(bufferingTimeoutRef.current);
            bufferingTimeoutRef.current = window.setTimeout(() => {
              const mediaEl = getMediaElement();
              if (mediaEl && mediaEl.paused) {
                mediaEl.play().catch(console.warn);
                broadcastCurrentState();
              }
            }, 30000);
          }
        }
      } else if (cmd.type === 'guest-ready') {
        if (roleRef.current === 'host' || watchPartyService.getRole() === 'host') {
          if (bufferingTimeoutRef.current) clearTimeout(bufferingTimeoutRef.current);
          const el = getMediaElement();
          if (el && el.paused) {
            el.play().catch(console.warn);
            broadcastCurrentState();
          }
        }
      } else if (cmd.type === 'request-state') {
        if (roleRef.current === 'host' || watchPartyService.getRole() === 'host') {
          broadcastCurrentState();
        }
      } else if (cmd.type === 'subtitles') {
        if (cmd.track) {
          setGuestSubtitleTrack({
            id: 'synced-subtitles',
            name: cmd.track.name,
            cues: cmd.track.cues,
            delaySeconds: cmd.track.delaySeconds,
          });
        } else {
          setGuestSubtitleTrack(null);
        }
      } else if (cmd.type === 'control') {
        // Host applies guest control
        const el = getMediaElement();
        const isHost = roleRef.current === 'host' || watchPartyService.getRole() === 'host';
        if (isHost && allowGuestControlRef.current && el) {
          isRemoteExecutingRef.current = true;
          try {
            if (cmd.action === 'play') {
              audioEngine.resume();
              el.play()
                .then(() => {
                  broadcastCurrentState();
                })
                .catch((err) => {
                  console.warn('Host play error:', err);
                  broadcastCurrentState();
                });
            } else if (cmd.action === 'pause') {
              el.pause();
              broadcastCurrentState();
            } else if (cmd.action === 'seek' && typeof cmd.time === 'number') {
              el.currentTime = cmd.time;
              broadcastCurrentState();
            } else if (cmd.action === 'rate' && typeof cmd.rate === 'number') {
              el.playbackRate = cmd.rate;
              broadcastCurrentState();
            }
          } finally {
            setTimeout(() => {
              isRemoteExecutingRef.current = false;
              broadcastCurrentState();
            }, 100);
          }
        }
      } else if (cmd.type === 'hello') {
        // Host greets new guest, registers sanitized display name, sends chat history, broadcasts system msg
        if (roleRef.current === 'host' || watchPartyService.getRole() === 'host') {
          const desired = sanitizeChatName(cmd.name, `Guest ${guestSeqRef.current++}`);
          const existing = new Set(
            Array.from(participantsRef.current.values()).map((n) => n.toLowerCase())
          );
          existing.add((getSavedDisplayName() || 'Host').toLowerCase());
          let unique = desired;
          let counter = 2;
          while (existing.has(unique.toLowerCase())) {
            unique = `${desired} (${counter++})`;
          }
          participantsRef.current.set(senderPeerId, unique);
          watchPartyService.setClientName(senderPeerId, unique);

          // Send last 50 chat history messages to new participant
          watchPartyService.sendToPeer(senderPeerId, {
            type: 'chat-history',
            messages: messagesRef.current.slice(-50),
          });

          // Broadcast system message to all
          const sysMsg: ChatMessage = {
            id: crypto.randomUUID(),
            from: 'System',
            fromId: 'system',
            text: `${unique} joined`,
            ts: Date.now(),
            kind: 'system',
          };
          hostBroadcastChatMessage(sysMsg);
        }
      } else if (cmd.type === 'rename') {
        if (roleRef.current === 'host' || watchPartyService.getRole() === 'host') {
          const oldName = participantsRef.current.get(senderPeerId) || 'Guest';
          const desired = sanitizeChatName(cmd.name, oldName);
          const existing = new Set(
            Array.from(participantsRef.current.values()).map((n) => n.toLowerCase())
          );
          existing.add((getSavedDisplayName() || 'Host').toLowerCase());
          existing.delete(oldName.toLowerCase());
          let unique = desired;
          let counter = 2;
          while (existing.has(unique.toLowerCase())) {
            unique = `${desired} (${counter++})`;
          }
          participantsRef.current.set(senderPeerId, unique);
          watchPartyService.setClientName(senderPeerId, unique);

          const sysMsg: ChatMessage = {
            id: crypto.randomUUID(),
            from: 'System',
            fromId: 'system',
            text: `${oldName} is now ${unique}`,
            ts: Date.now(),
            kind: 'system',
          };
          hostBroadcastChatMessage(sysMsg);
        }
      } else if (cmd.type === 'chat') {
        // Host validates guest message, rate-limits, and broadcasts to everyone
        if (roleRef.current === 'host' || watchPartyService.getRole() === 'host') {
          if (typeof cmd.text !== 'string') return;
          const clean = sanitizeChatText(cmd.text);
          if (!clean) return;

          if (!checkRateLimit(senderPeerId)) {
            watchPartyService.sendToPeer(senderPeerId, {
              type: 'chat-error',
              reason: 'Slow down',
            });
            return;
          }

          const fromName = participantsRef.current.get(senderPeerId) || 'Guest';
          const userMsg: ChatMessage = {
            id: crypto.randomUUID(),
            from: fromName,
            fromId: senderPeerId,
            senderId: cmd.senderId || senderPeerId,
            text: clean,
            ts: Date.now(),
            kind: 'user',
          };
          hostBroadcastChatMessage(userMsg);
        }
      } else if (cmd.type === 'chat-msg') {
        // Guest receives broadcast message
        if (roleRef.current === 'guest' || watchPartyService.getRole() === 'guest') {
          setMessages((prev) => {
            const next = [...prev, cmd.msg].slice(-200);
            messagesRef.current = next;
            return next;
          });

          const isOwn = Boolean(cmd.msg.senderId) && cmd.msg.senderId === myClientIdRef.current;
          if (!isOwn && !isChatOpenRef.current && cmd.msg.kind !== 'system') {
            setUnreadCount((c) => c + 1);
            if (!document.fullscreenElement) {
              onToast?.(`${cmd.msg.from}: ${cmd.msg.text}`);
            }
            if (soundEnabledRef.current) {
              playChatNotificationSound();
            }
          }
        }
      } else if (cmd.type === 'chat-history') {
        if (roleRef.current === 'guest' || watchPartyService.getRole() === 'guest') {
          const list = Array.isArray(cmd.messages) ? cmd.messages.slice(-200) : [];
          setMessages(list);
          messagesRef.current = list;
        }
      } else if (cmd.type === 'chat-error') {
        setChatError(cmd.reason || 'Slow down');
        setTimeout(() => {
          setChatError((prev) => (prev === cmd.reason ? null : prev));
        }, 2500);
      } else if (cmd.type === 'media-state') {
        const rawSenderId = cmd.senderId || senderPeerId;
        const normalizedId = rawSenderId === 'host' || !rawSenderId ? getHostPeerId() : rawSenderId;
        if (roleRef.current === 'host' || watchPartyService.getRole() === 'host') {
          watchPartyService.sendCommand({
            type: 'media-state',
            senderId: normalizedId,
            camOn: cmd.camOn,
            micOn: cmd.micOn,
          });
        }
        callManagerRef.current?.updateParticipantMediaState(normalizedId, cmd.camOn, cmd.micOn);
      } else if (cmd.type === 'call-join' || cmd.type === 'call-started') {
        const hostPeerId = getHostPeerId();
        const rawPeerId = cmd.peerId || senderPeerId;
        const peerId = rawPeerId === 'host' || !rawPeerId ? hostPeerId : rawPeerId;
        const name =
          (cmd as { name?: string }).name ||
          participantsRef.current.get(peerId) ||
          (peerId === hostPeerId ? 'Host' : 'Guest');

        if (roleRef.current === 'host' || watchPartyService.getRole() === 'host') {
          watchPartyService.sendCommand({
            type: cmd.type,
            peerId,
            name,
          });
        }
        callManagerRef.current?.handlePeerJoined(peerId, name);

        if (!inCallRef.current) {
          setIncomingCall({ active: true, peerId, name });
          onToast?.(`${name} started a video call!`);
        }
      } else if (cmd.type === 'call-leave' || cmd.type === 'call-ended') {
        const hostPeerId = getHostPeerId();
        const rawPeerId = cmd.peerId || senderPeerId;
        const peerId = rawPeerId === 'host' || !rawPeerId ? hostPeerId : rawPeerId;
        if (roleRef.current === 'host' || watchPartyService.getRole() === 'host') {
          watchPartyService.sendCommand({
            type: cmd.type,
            peerId,
          });
        }
        callManagerRef.current?.handlePeerLeft(peerId);
        setIncomingCall((prev) => (prev?.peerId === peerId ? null : prev));
      } else if (cmd.type === 'stream-owner') {
        const hostPeerId = getHostPeerId();
        const peerId = cmd.peerId === 'host' ? hostPeerId : cmd.peerId;
        callManagerRef.current?.handleStreamOwner(cmd.streamId, peerId, cmd.name);
      } else if (cmd.type === 'call-signal' || cmd.type === 'party-signal') {
        const hostPeerId = getHostPeerId();
        const rawSenderId = cmd.senderId || senderPeerId;
        const senderId = rawSenderId === 'host' || !rawSenderId ? hostPeerId : rawSenderId;
        const kind = (cmd as any).kind || 'movie';
        if (kind === 'call') {
          if (roleRef.current === 'host' || watchPartyService.getRole() === 'host') {
            if (cmd.targetId && cmd.targetId !== watchPartyService.getMyPeerId()) {
              watchPartyService.sendToPeer(cmd.targetId, cmd);
            } else {
              callManagerRef.current?.handleIncomingSignal(senderId, cmd.signal);
            }
          } else {
            callManagerRef.current?.handleIncomingSignal(senderId, cmd.signal);
          }
        } else {
          if (roleRef.current === 'host' || watchPartyService.getRole() === 'host') {
            if (cmd.targetId && cmd.targetId !== watchPartyService.getMyPeerId()) {
              watchPartyService.sendToPeer(cmd.targetId, cmd);
            } else {
              watchPartyService.handleIncomingMovieSignal(senderId, cmd.signal);
            }
          } else {
            watchPartyService.handleIncomingMovieSignal(senderId, cmd.signal);
          }
        }
      }
    });

    return () => unsubCmd();
  }, [
    getMediaElement,
    broadcastCurrentState,
    checkRateLimit,
    getSavedDisplayName,
    hostBroadcastChatMessage,
    onToast,
  ]);

  // Guest: 8s heartbeat watchdog
  useEffect(() => {
    if (role !== 'guest' || status !== 'connected') {
      setIsReconnecting(false);
      return;
    }

    lastHeartbeatRef.current = Date.now();

    const watchdog = setInterval(() => {
      const elapsed = Date.now() - lastHeartbeatRef.current;
      if (elapsed > 8000) {
        setIsReconnecting(true);
      } else {
        setIsReconnecting(false);
      }
    }, 1000);

    return () => clearInterval(watchdog);
  }, [role, status]);

  // Actions
  const createRoom = async (): Promise<string> => {
    audioEngine.resume();
    const code = await watchPartyService.createRoom();
    setRole('host');
    roleRef.current = 'host';
    setRoomCode(code);
    setStatus('waiting');
    setMessages([]);
    messagesRef.current = [];
    setUnreadCount(0);
    participantsRef.current.clear();
    const myName = getSavedDisplayName() || 'Host';
    watchPartyService.setHostDisplayName(myName);
    callManagerRef.current?.setPeerInfo(watchPartyService.getMyPeerId(), myName, false);
    onToast?.('Room created');

    // Check 6: Diagnostic logs for video state when room starts
    const el = getMediaElement() as HTMLVideoElement | null;
    if (el) {
      console.log('[OmniPlay Host Room Start Diagnostics]', {
        src: el.src,
        srcObject: el.srcObject,
        readyState: el.readyState,
        videoWidth: el.videoWidth,
        muted: el.muted,
        paused: el.paused,
      });
    }

    setTimeout(() => {
      updateCapturedStream();
    }, 300);
    return code;
  };

  const joinRoom = async (code: string, displayName?: string): Promise<void> => {
    const chosenName = sanitizeChatName(displayName || getSavedDisplayName(), 'Guest');
    await watchPartyService.joinRoom(code, chosenName);
    setRole('guest');
    roleRef.current = 'guest';
    setRoomCode(code.toUpperCase());
    setStatus('connected');
    setMessages([]);
    messagesRef.current = [];
    setUnreadCount(0);
    callManagerRef.current?.setPeerInfo(watchPartyService.getMyPeerId(), chosenName, true);
    try {
      sessionStorage.setItem('omniplay-rejoin-room', code.toUpperCase());
      sessionStorage.setItem('omniplay-rejoin-name', chosenName);
    } catch {}
  };

  const leaveRoom = () => {
    callManagerRef.current?.cleanup();
    inCallRef.current = false;
    setInCall(false);
    setIncomingCall(null);
    setLocalStream(null);
    setRemoteStreams(new Map());
    setHostStutterWarning(false);
    setVolumeDuckingMultiplier(1.0);

    try {
      sessionStorage.removeItem('omniplay-rejoin-room');
      sessionStorage.removeItem('omniplay-rejoin-name');
      if (localStorage.getItem('omniplay-delete-on-leave') === 'true') {
        movieStore.clearAllMovies();
      }
    } catch {}

    fileTransferManager.cleanup();
    setIsLocalPlayback(false);
    setLocalVideoUrl(null);
    setTransferProgress(null);

    watchPartyService.leave();
    setRole(null);
    roleRef.current = null;
    setRoomCode(null);
    setIncomingStream(null);
    setStatus('idle');
    setErrorMessage(null);
    setViewerCount(0);
    setIsReconnecting(false);
    setMessages([]);
    messagesRef.current = [];
    setUnreadCount(0);
    setIsChatOpen(false);
    setChatError(null);
    participantsRef.current.clear();
  };

  const sendGuestControl = (action: 'play' | 'pause' | 'seek' | 'rate', time?: number, rate?: number) => {
    // Send command over data channel to host
    watchPartyService.sendCommand({
      type: 'control',
      action,
      time,
      rate,
    });

    // Optimistically update guest hostState for immediate feedback
    setHostState((prev) => {
      if (action === 'play') return { ...prev, isPlaying: true };
      if (action === 'pause') return { ...prev, isPlaying: false };
      if (action === 'seek' && typeof time === 'number') return { ...prev, currentTime: time };
      if (action === 'rate' && typeof rate === 'number') return { ...prev, playbackRate: rate };
      return prev;
    });
  };

  // Send chat message
  const sendChat = useCallback(
    (text: string) => {
      const clean = sanitizeChatText(text);
      if (!clean) return;

      const isHost = roleRef.current === 'host' || watchPartyService.getRole() === 'host';
      if (isHost) {
        if (!checkRateLimit('host')) {
          setChatError('Slow down');
          setTimeout(() => setChatError((prev) => (prev === 'Slow down' ? null : prev)), 2500);
          return;
        }

        const hostName = sanitizeChatName(getSavedDisplayName(), 'Host');
        const userMsg: ChatMessage = {
          id: crypto.randomUUID(),
          from: hostName,
          fromId: 'host',
          senderId: myClientIdRef.current,
          text: clean,
          ts: Date.now(),
          kind: 'user',
        };
        hostBroadcastChatMessage(userMsg);
      } else {
        watchPartyService.sendCommand({
          type: 'chat',
          text: clean,
          senderId: myClientIdRef.current,
        });
      }
    },
    [checkRateLimit, getSavedDisplayName, hostBroadcastChatMessage]
  );

  const setChatOpen = useCallback((open: boolean) => {
    setIsChatOpen(open);
    if (open) {
      setUnreadCount(0);
    }
  }, []);

  const clearUnread = useCallback(() => {
    setUnreadCount(0);
  }, []);

  const handleToggleSound = useCallback((enabled: boolean) => {
    setSoundEnabled(enabled);
    try {
      localStorage.setItem('omniplay-chat-sound', String(enabled));
    } catch {}
  }, []);

  const rename = useCallback(
    (newName: string) => {
      const sanitized = sanitizeChatName(newName);
      try {
        localStorage.setItem('omniplay-chat-name', sanitized);
      } catch {}

      const isHost = roleRef.current === 'host' || watchPartyService.getRole() === 'host';
      if (isHost) {
        const oldName = sanitizeChatName(getSavedDisplayName(), 'Host');
        if (oldName !== sanitized) {
          watchPartyService.setHostDisplayName(sanitized);
          const sysMsg: ChatMessage = {
            id: crypto.randomUUID(),
            from: 'System',
            fromId: 'system',
            text: `${oldName} is now ${sanitized}`,
            ts: Date.now(),
            kind: 'system',
          };
          hostBroadcastChatMessage(sysMsg);
        }
      } else {
        watchPartyService.sendCommand({
          type: 'rename',
          name: sanitized,
        });
      }
    },
    [getSavedDisplayName, hostBroadcastChatMessage]
  );

  // Video Call Controls
  const startCall = useCallback(async () => {
    if (!callManagerRef.current) return;
    const isHost = roleRef.current === 'host' || watchPartyService.getRole() === 'host';
    const hostPeerId = getHostPeerId();
    const myName = getSavedDisplayName() || (isHost ? 'Host' : 'Guest');
    const myPeerId = watchPartyService.getMyPeerId() || (isHost ? hostPeerId : null);

    callManagerRef.current.setPeerInfo(
      myPeerId,
      myName,
      !isHost,
      hostPeerId,
      isHost ? myName : 'Host'
    );
    await callManagerRef.current.startCall();
    setIncomingCall(null);
    watchPartyService.sendCommand({
      type: 'call-started',
      peerId: myPeerId || undefined,
      name: myName,
    });
    const local = callManagerRef.current.getLocalStream();
    if (local && myPeerId) {
      watchPartyService.sendCommand({
        type: 'stream-owner',
        streamId: local.id,
        peerId: myPeerId,
        name: myName,
      });
    }
  }, [getSavedDisplayName, getHostPeerId]);

  const endCall = useCallback(() => {
    if (!callManagerRef.current) return;
    watchPartyService.sendCommand({
      type: 'call-ended',
      peerId: watchPartyService.getMyPeerId() || undefined,
    });
    watchPartyService.sendCommand({ type: 'call-leave' });
    callManagerRef.current.endCall();
    setIncomingCall(null);
  }, []);

  const toggleCam = useCallback(() => {
    callManagerRef.current?.toggleCam();
  }, []);

  const toggleMic = useCallback(() => {
    callManagerRef.current?.toggleMic();
  }, []);

  const selectDevice = useCallback(async (kind: 'audioinput' | 'videoinput', id: string) => {
    await callManagerRef.current?.selectDevice(kind, id);
  }, []);

  const setCallQuality = useCallback((q: CallQuality) => {
    setCallQualityState(q);
    callManagerRef.current?.setQuality(q);
  }, []);

  const setDuckingEnabled = useCallback((enabled: boolean) => {
    setIsDuckingEnabledState(enabled);
    callManagerRef.current?.setDuckingEnabled(enabled);
  }, []);

  const toggleBandwidthSaver = useCallback(() => {
    callManagerRef.current?.toggleBandwidthSaver();
    setBandwidthSaver(callManagerRef.current?.getBandwidthSaver() ?? false);
  }, []);

  const turnOffCamerasForBandwidth = useCallback(() => {
    callManagerRef.current?.turnOffCamerasForBandwidth();
    setBandwidthSaver(true);
    setHostStutterWarning(false);
  }, []);

  const dismissStutterWarning = useCallback(() => {
    setHostStutterWarning(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      callManagerRef.current?.cleanup();
    };
  }, []);

  const [pausePlaybackWhileSendingState, setPausePlaybackWhileSendingState] = useState<boolean>(() => {
    return fileTransferManager.getPausePlaybackWhileSending();
  });
  const [isPreparingTransfer, setIsPreparingTransfer] = useState<boolean>(false);
  const [hashingProgress, setHashingProgress] = useState<{ current: number; total: number } | null>(null);

  const setPausePlaybackWhileSending = useCallback((val: boolean) => {
    fileTransferManager.setPausePlaybackWhileSending(val);
    setPausePlaybackWhileSendingState(val);
  }, []);

  const startFileTransfer = useCallback(
    async (file: File) => {
      const guestIds = watchPartyService.getGuestPeerIds();
      const peer = watchPartyService.getPeer();
      const el = getMediaElement();
      if (fileTransferManager.getPausePlaybackWhileSending() && el && !el.paused) {
        el.pause();
        broadcastCurrentState();
      }
      setIsPreparingTransfer(true);
      setHashingProgress({ current: 0, total: Math.ceil(file.size / 1048576) });
      try {
        await fileTransferManager.startHostFileTransfer(
          file,
          guestIds,
          peer,
          el?.duration,
          (prog) => setHashingProgress(prog)
        );
      } catch (err) {
        console.error('[WatchParty] Failed to start file transfer:', err);
        throw err;
      } finally {
        setIsPreparingTransfer(false);
        setHashingProgress(null);
      }
    },
    [getMediaElement, broadcastCurrentState]
  );

  const pauseFileTransfer = useCallback((peerId?: string) => {
    fileTransferManager.pauseHostTransfer(peerId);
  }, []);

  const resumeFileTransfer = useCallback((peerId?: string) => {
    fileTransferManager.resumeHostTransfer(peerId);
  }, []);

  const cancelFileTransfer = useCallback((peerId?: string) => {
    fileTransferManager.cancelHostTransfer(peerId);
  }, []);

  const cancelGuestDownload = useCallback(() => {
    fileTransferManager.cancelGuestDownload();
  }, []);

  const revertToLiveStream = useCallback(() => {
    fileTransferManager.revertToLiveStream();
    setIsLocalPlayback(false);
    setLocalVideoUrl(null);
  }, []);

  const activateProgressivePlayback = useCallback((streamUrl: string) => {
    fileTransferManager.activateProgressiveMode(streamUrl);
    setIsLocalPlayback(true);
    setLocalVideoUrl(streamUrl);
  }, []);

  const sendBuffering = useCallback(
    (isBuffering: boolean) => {
      const myName = getSavedDisplayName() || 'Guest';
      watchPartyService.sendCommand({
        type: isBuffering ? 'guest-buffering' : 'guest-ready',
        name: myName,
      });
    },
    [getSavedDisplayName]
  );

  return {
    role,
    roomCode,
    status,
    errorMessage,
    viewerCount,
    incomingStream,
    isReconnecting,
    hostState,
    guestSubtitleTrack,
    allowGuestControl,
    setAllowGuestControl,
    createRoom,
    joinRoom,
    leaveRoom,
    sendGuestControl,
    broadcastCurrentState,
    updateCapturedStream,
    // Chat additions
    messages,
    sendChat,
    unreadCount,
    isChatOpen,
    setChatOpen,
    clearUnread,
    chatError,
    soundEnabled,
    setSoundEnabled: handleToggleSound,
    rename,
    myId: myClientIdRef.current,
    myClientId: myClientIdRef.current,
    myDisplayName: getSavedDisplayName() || (role === 'host' ? 'Host' : 'Guest'),
    // Video Call additions
    localStream,
    remoteStreams,
    camEnabled,
    micEnabled,
    toggleCam,
    toggleMic,
    startCall,
    endCall,
    inCall,
    devices: callDevices,
    selectDevice,
    callError,
    callQuality,
    setCallQuality,
    isDuckingEnabled,
    setDuckingEnabled,
    bandwidthSaver,
    toggleBandwidthSaver,
    hostStutterWarning,
    dismissStutterWarning,
    turnOffCamerasForBandwidth,
    volumeDuckingMultiplier,
    incomingCall,
    dismissIncomingCall: () => setIncomingCall(null),
    // Movie Stream Quality additions
    movieQuality,
    setMovieQuality,
    // File Transfer additions
    transferProgress,
    isLocalPlayback,
    localVideoUrl,
    startFileTransfer,
    pauseFileTransfer,
    resumeFileTransfer,
    cancelFileTransfer,
    cancelGuestDownload,
    revertToLiveStream,
    activateProgressivePlayback,
    sendBuffering,
    pausePlaybackWhileSending: pausePlaybackWhileSendingState,
    setPausePlaybackWhileSending,
    isPreparingTransfer,
    hashingProgress,
  };
}
