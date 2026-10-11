import React, { useState, useEffect, useRef } from 'react';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  PhoneOff,
  Users,
  Maximize2,
  Minimize2,
  Settings,
  Headphones,
  Sliders,
  AlertTriangle,
  MonitorUp,
  X,
  Volume2,
} from 'lucide-react';
import { RemoteParticipant, CallQuality, CallDevices } from '../utils/callManager';

export interface CallStripProps {
  localStream: MediaStream | null;
  remoteStreams: Map<string, RemoteParticipant>;
  camEnabled: boolean;
  micEnabled: boolean;
  onToggleCam: () => void;
  onToggleMic: () => void;
  onEndCall: () => void;
  myName?: string;
  devices: CallDevices;
  onSelectDevice: (kind: 'audioinput' | 'videoinput', id: string) => Promise<void>;
  quality: CallQuality;
  onSetQuality: (q: CallQuality) => void;
  isDuckingEnabled: boolean;
  onSetDuckingEnabled: (val: boolean) => void;
  bandwidthSaver: boolean;
  onToggleBandwidthSaver: () => void;
  hostStutterWarning: boolean;
  onDismissStutterWarning: () => void;
  onTurnOffCamerasForBandwidth: () => void;
}

interface RemoteVideoTileProps {
  participant: RemoteParticipant;
}

const RemoteVideoTile: React.FC<RemoteVideoTileProps> = ({ participant }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  const attachRemoteStream = React.useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      if (el && participant.stream) {
        if (el.srcObject !== participant.stream) {
          el.srcObject = participant.stream;
        }
        el.play().catch(() => {});
      }
    },
    [participant.stream]
  );

  useEffect(() => {
    if (videoRef.current && participant.stream) {
      if (videoRef.current.srcObject !== participant.stream) {
        videoRef.current.srcObject = participant.stream;
      }
      videoRef.current.play().catch(() => {});
    }
  }, [participant.stream]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !participant.stream) return;
    const start = performance.now();
    const handleFirstFrame = () => {
      const elapsed = performance.now() - start;
      if (typeof window !== 'undefined' && window.location.search.includes('debug=1')) {
        console.log(`[call startup] First video frame rendered in ${Math.round(elapsed)}ms for participant ${participant.peerId}`);
      }
    };
    if ('requestVideoFrameCallback' in el) {
      (el as any).requestVideoFrameCallback(handleFirstFrame);
    } else {
      (el as any).addEventListener('loadeddata', handleFirstFrame, { once: true });
      (el as any).addEventListener('resize', handleFirstFrame, { once: true });
    }
  }, [participant.stream]);

  const initial = (participant.name || 'F').charAt(0).toUpperCase();

  return (
    <div
      className={`relative w-28 sm:w-36 h-20 sm:h-24 bg-zinc-900 rounded-xl overflow-hidden border transition-all duration-200 shrink-0 select-none shadow-md ${
        participant.speaking
          ? 'border-sky-400 ring-2 ring-sky-400/60 shadow-sky-500/20'
          : 'border-zinc-800'
      }`}
    >
      {/* Video Element */}
      <video
        ref={attachRemoteStream}
        autoPlay
        playsInline
        className={`w-full h-full object-cover transition-opacity duration-200 ${
          participant.camOn ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Avatar Fallback if Camera is Off */}
      {!participant.camOn && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900/90 text-zinc-300">
          <div className="w-9 h-9 rounded-full bg-zinc-800 border border-zinc-700/80 flex items-center justify-center font-bold text-sky-400 text-sm shadow-inner">
            {initial}
          </div>
        </div>
      )}

      {/* Name and Indicators Bar */}
      <div className="absolute bottom-0 inset-x-0 px-1.5 py-0.5 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex items-center justify-between pointer-events-none">
        <span className="text-[10px] font-medium text-zinc-200 truncate max-w-[70px]">
          {participant.name}
        </span>
        <div className="flex items-center gap-1">
          {!participant.micOn && (
            <span
              className="p-0.5 bg-rose-500/30 text-rose-300 rounded-full"
              title="Muted"
            >
              <MicOff className="w-2.5 h-2.5" />
            </span>
          )}
          {participant.speaking && (
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
          )}
        </div>
      </div>
    </div>
  );
};

export const CallStrip: React.FC<CallStripProps> = ({
  localStream,
  remoteStreams,
  camEnabled,
  micEnabled,
  onToggleCam,
  onToggleMic,
  onEndCall,
  myName = 'You',
  devices,
  onSelectDevice,
  quality,
  onSetQuality,
  isDuckingEnabled,
  onSetDuckingEnabled,
  bandwidthSaver,
  onToggleBandwidthSaver,
  hostStutterWarning,
  onDismissStutterWarning,
  onTurnOffCamerasForBandwidth,
}) => {
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [isHidden, setIsHidden] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [showHeadphoneTip, setShowHeadphoneTip] = useState<boolean>(() => {
    try {
      return localStorage.getItem('omniplay-headphone-tip') !== 'dismissed';
    } catch {
      return true;
    }
  });

  const localVideoRef = useRef<HTMLVideoElement>(null);

  // Callback ref to re-attach stream immediately whenever the element mounts
  const attachLocalStream = React.useCallback(
    (el: HTMLVideoElement | null) => {
      localVideoRef.current = el;
      if (el && localStream) {
        if (el.srcObject !== localStream) {
          el.srcObject = localStream;
        }
        el.muted = true;
        el.play().catch((err) => {
          console.warn('[CallStrip] Local preview play error on mount:', err);
        });
      }
    },
    [localStream]
  );

  // Re-attach whenever localStream updates or popup opens/unminimizes
  useEffect(() => {
    if (!isMinimized && !isHidden && localVideoRef.current && localStream) {
      if (localVideoRef.current.srcObject !== localStream) {
        localVideoRef.current.srcObject = localStream;
      }
      localVideoRef.current.muted = true;
      localVideoRef.current.play().catch((err) => {
        console.warn('[CallStrip] Local preview play error on open:', err);
      });
    }
  }, [localStream, isMinimized, isHidden]);

  const dismissHeadphoneTip = () => {
    setShowHeadphoneTip(false);
    try {
      localStorage.setItem('omniplay-headphone-tip', 'dismissed');
    } catch {}
  };

  const participantCount = remoteStreams.size + 1;
  const selfInitial = myName.charAt(0).toUpperCase();

  // If Hidden: Show draggable compact floating badge to reopen
  if (isHidden) {
    return (
      <DraggableCallBadge
        participantCount={participantCount}
        onShowCall={() => {
          setIsHidden(false);
          setIsMinimized(false);
        }}
      />
    );
  }

  // If Minimized: Show sleek floating pill
  if (isMinimized) {
    return (
      <div className="absolute top-16 right-4 z-[100] animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center gap-1.5 p-1.5 bg-zinc-950/90 border border-zinc-800/90 backdrop-blur-md rounded-2xl shadow-2xl text-xs text-white">
          <div className="flex items-center gap-1.5 px-2 py-1 bg-zinc-900/80 rounded-xl font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <Users className="w-3.5 h-3.5 text-sky-400" />
            <span className="text-[11px] font-mono">{participantCount} in call</span>
          </div>

          {/* Quick Mic Toggle */}
          <button
            onClick={onToggleMic}
            className={`p-1.5 rounded-lg transition-colors ${
              micEnabled
                ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
            }`}
            title={micEnabled ? 'Mute Mic' : 'Unmute Mic'}
          >
            {micEnabled ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
          </button>

          {/* Quick Cam Toggle */}
          <button
            onClick={onToggleCam}
            className={`p-1.5 rounded-lg transition-colors ${
              camEnabled && !bandwidthSaver
                ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
            }`}
            title={camEnabled ? 'Turn Off Camera' : 'Turn On Camera'}
          >
            {camEnabled && !bandwidthSaver ? (
              <Video className="w-3.5 h-3.5" />
            ) : (
              <VideoOff className="w-3.5 h-3.5" />
            )}
          </button>

          {/* Expand Button */}
          <button
            onClick={() => setIsMinimized(false)}
            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors"
            title="Expand Video Call"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>

          {/* Hide Button */}
          <button
            onClick={() => setIsHidden(true)}
            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
            title="Hide Call Popup (Keep Talking)"
          >
            <X className="w-3.5 h-3.5" />
          </button>

          {/* End Call Button */}
          <button
            onClick={onEndCall}
            className="p-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition-colors"
            title="Leave Call (Disconnect camera & mic)"
          >
            <PhoneOff className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute top-16 right-4 z-[100] max-w-full animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="bg-zinc-950/90 border border-zinc-800/90 backdrop-blur-md rounded-2xl p-2.5 shadow-2xl flex flex-col gap-2">
        {/* Strip Header Bar */}
        <div className="flex items-center justify-between gap-3 px-1 pb-1 border-b border-zinc-800/60">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Call</span>
            <span className="text-[10px] text-zinc-500 font-mono">
              ({participantCount}/4)
            </span>
          </div>

          <div className="flex items-center gap-1">
            {/* Quick Bandwidth Saver Toggle */}
            <button
              onClick={onToggleBandwidthSaver}
              className={`p-1.5 rounded-lg text-xs transition-colors flex items-center gap-1 ${
                bandwidthSaver
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
              title={
                bandwidthSaver
                  ? 'Bandwidth saver active (cameras off)'
                  : 'Turn off camera to save bandwidth'
              }
            >
              <MonitorUp className="w-3.5 h-3.5" />
              <span className="hidden sm:inline text-[10px]">
                {bandwidthSaver ? 'Saver On' : 'Save Bandwidth'}
              </span>
            </button>

            {/* Settings button */}
            <button
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className={`p-1.5 rounded-lg text-xs transition-colors ${
                isSettingsOpen
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
              title="Call Settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>

            {/* Minimize button */}
            <button
              onClick={() => setIsMinimized(true)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              title="Minimize to Pill"
            >
              <Minimize2 className="w-3.5 h-3.5" />
            </button>

            {/* Hide / Close Popup button */}
            <button
              onClick={() => setIsHidden(true)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              title="Hide Call Popup (Keep Talking)"
            >
              <X className="w-3.5 h-3.5" />
            </button>

            {/* End Call button */}
            <button
              onClick={onEndCall}
              className="p-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition-colors"
              title="Leave Call (Disconnect camera & mic)"
            >
              <PhoneOff className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Headphone Tip Banner */}
        {showHeadphoneTip && (
          <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-sky-950/50 border border-sky-800/50 text-[11px] text-sky-200">
            <div className="flex items-center gap-1.5">
              <Headphones className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span>Use headphones to prevent movie echo through your mic.</span>
            </div>
            <button
              onClick={dismissHeadphoneTip}
              className="p-1 text-sky-400 hover:text-sky-200 transition-colors"
              title="Dismiss tip"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Host Stutter Warning */}
        {hostStutterWarning && (
          <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-amber-950/60 border border-amber-800/60 text-[11px] text-amber-200 animate-pulse">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>Movie stream is stuttering. Turn off cameras?</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={onTurnOffCamerasForBandwidth}
                className="px-2 py-0.5 rounded-md bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-[10px] transition-colors"
              >
                Cameras Off
              </button>
              <button
                onClick={onDismissStutterWarning}
                className="p-1 text-amber-400 hover:text-amber-200 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {/* Video Tiles Strip */}
        <div className="flex items-center gap-2 overflow-x-auto max-w-sm sm:max-w-md pb-1 scrollbar-none">
          {/* Local User Tile */}
          <div className="relative w-28 sm:w-36 h-20 sm:h-24 bg-zinc-900 rounded-xl overflow-hidden border border-zinc-800 shrink-0 select-none shadow-md">
            <video
              ref={attachLocalStream}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover -scale-x-100 transition-opacity duration-200 ${
                camEnabled && !bandwidthSaver
                  ? 'opacity-100'
                  : 'opacity-0 pointer-events-none'
              }`}
            />

            {/* Avatar Fallback if Camera is Off */}
            {(!camEnabled || bandwidthSaver) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900/90 text-zinc-300">
                <div className="w-9 h-9 rounded-full bg-zinc-800 border border-zinc-700/80 flex items-center justify-center font-bold text-sky-400 text-sm shadow-inner">
                  {selfInitial}
                </div>
              </div>
            )}

            {/* Name and Indicators Bar */}
            <div className="absolute bottom-0 inset-x-0 px-1.5 py-0.5 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex items-center justify-between pointer-events-none">
              <span className="text-[10px] font-medium text-zinc-200 truncate max-w-[70px]">
                {myName} (You)
              </span>
              <div className="flex items-center gap-1">
                {!micEnabled && (
                  <span
                    className="p-0.5 bg-rose-500/30 text-rose-300 rounded-full"
                    title="Muted"
                  >
                    <MicOff className="w-2.5 h-2.5" />
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Remote Participants Tiles */}
          {Array.from(remoteStreams.values()).map((p) => (
            <RemoteVideoTile key={p.peerId} participant={p} />
          ))}
        </div>

        {/* Bottom Quick Controls Bar */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-zinc-800/60">
          <div className="flex items-center gap-1.5">
            {/* Toggle Mic */}
            <button
              onClick={onToggleMic}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                micEnabled
                  ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/60'
                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30'
              }`}
            >
              {micEnabled ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
              <span>{micEnabled ? 'Mute' : 'Unmute'}</span>
            </button>

            {/* Toggle Cam */}
            <button
              onClick={onToggleCam}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                camEnabled && !bandwidthSaver
                  ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/60'
                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30'
              }`}
            >
              {camEnabled && !bandwidthSaver ? (
                <Video className="w-3.5 h-3.5" />
              ) : (
                <VideoOff className="w-3.5 h-3.5" />
              )}
              <span>{camEnabled && !bandwidthSaver ? 'Stop Cam' : 'Start Cam'}</span>
            </button>
          </div>

          <div className="text-[10px] text-zinc-500 font-mono">
            {quality.toUpperCase()}
          </div>
        </div>

        {/* Settings Popover / Drawer */}
        {isSettingsOpen && (
          <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl space-y-3 mt-1 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-sky-400" />
                <span>Call & Bandwidth Settings</span>
              </span>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="text-zinc-500 hover:text-zinc-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Quality Preset */}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-400 block">
                Camera Quality Preset
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {(['low', 'medium', 'high'] as CallQuality[]).map((q) => (
                  <button
                    key={q}
                    onClick={() => onSetQuality(q)}
                    className={`py-1.5 px-2 text-[11px] font-medium rounded-lg border transition-colors ${
                      quality === q
                        ? 'bg-sky-500/20 text-sky-300 border-sky-500/60'
                        : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                    }`}
                  >
                    {q === 'low' && 'Low (160p)'}
                    {q === 'medium' && 'Med (240p)'}
                    {q === 'high' && 'High (480p)'}
                  </button>
                ))}
              </div>
              {quality === 'high' && (
                <p className="text-[10px] text-amber-400 mt-0.5">
                  Warning: High quality uses more bandwidth and can affect movie streaming.
                </p>
              )}
            </div>

            {/* Audio Ducking Toggle */}
            <div className="flex items-center justify-between pt-1 border-t border-zinc-800/60">
              <div className="space-y-0.5">
                <span className="text-[11px] font-medium text-zinc-300 block">
                  Duck movie volume while talking
                </span>
                <span className="text-[10px] text-zinc-500 block">
                  Smoothly lowers movie to 30% when friends speak
                </span>
              </div>
              <input
                type="checkbox"
                checked={isDuckingEnabled}
                onChange={(e) => onSetDuckingEnabled(e.target.checked)}
                className="w-4 h-4 accent-sky-500 rounded cursor-pointer"
              />
            </div>

            {/* Microphone Selector */}
            {devices.audioInputs.length > 0 && (
              <div className="space-y-1 pt-1 border-t border-zinc-800/60">
                <label className="text-[11px] font-medium text-zinc-400 block">
                  Microphone
                </label>
                <select
                  onChange={(e) => onSelectDevice('audioinput', e.target.value)}
                  className="w-full px-2 py-1 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-sky-500"
                >
                  {devices.audioInputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Microphone ${d.deviceId.slice(0, 5)}`}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Camera Selector */}
            {devices.videoInputs.length > 0 && (
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-400 block">
                  Camera
                </label>
                <select
                  onChange={(e) => onSelectDevice('videoinput', e.target.value)}
                  className="w-full px-2 py-1 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-sky-500"
                >
                  {devices.videoInputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Camera ${d.deviceId.slice(0, 5)}`}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const DraggableCallBadge: React.FC<{
  participantCount: number;
  onShowCall: () => void;
}> = ({ participantCount, onShowCall }) => {
  const badgeRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
    hasMoved: false,
  });

  const [isDraggingState, setIsDraggingState] = useState(false);

  const getContainer = (): HTMLElement => {
    if (!badgeRef.current) return document.body;
    return (badgeRef.current.closest('.relative') || badgeRef.current.parentElement || document.body) as HTMLElement;
  };

  const updatePositionStyle = (x: number, y: number, transition = false) => {
    if (!badgeRef.current) return;
    badgeRef.current.style.transition = transition ? 'transform 200ms ease-out' : 'none';
    badgeRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };

  useEffect(() => {
    const badge = badgeRef.current;
    if (!badge) return;
    const container = getContainer();
    if (!container) return;

    const containerWidth = container.clientWidth || window.innerWidth;
    const containerHeight = container.clientHeight || window.innerHeight;
    const badgeWidth = badge.offsetWidth || 120;
    const badgeHeight = badge.offsetHeight || 28;

    let initialX = containerWidth - badgeWidth - 16;
    let initialY = 64;

    try {
      const saved = localStorage.getItem('omniplay.callBadgePos');
      if (saved) {
        const { xPct, yPct } = JSON.parse(saved);
        if (typeof xPct === 'number' && typeof yPct === 'number') {
          initialX = xPct * Math.max(1, containerWidth - badgeWidth - 16);
          initialY = yPct * Math.max(1, containerHeight - badgeHeight - 80);
        }
      }
    } catch {}

    initialX = Math.max(8, Math.min(initialX, containerWidth - badgeWidth - 8));
    initialY = Math.max(8, Math.min(initialY, containerHeight - badgeHeight - 80));

    updatePositionStyle(initialX, initialY, false);
    (badge as any).__currentX = initialX;
    (badge as any).__currentY = initialY;

    const handleResize = () => {
      if (!badge) return;
      const c = getContainer();
      if (!c) return;
      const cw = c.clientWidth || window.innerWidth;
      const ch = c.clientHeight || window.innerHeight;
      const bw = badge.offsetWidth || 120;
      const bh = badge.offsetHeight || 28;
      let x = (badge as any).__currentX ?? (cw - bw - 16);
      let y = (badge as any).__currentY ?? 64;
      x = Math.max(8, Math.min(x, cw - bw - 8));
      y = Math.max(8, Math.min(y, ch - bh - 80));
      updatePositionStyle(x, y, false);
      (badge as any).__currentX = x;
      (badge as any).__currentY = y;
    };

    window.addEventListener('resize', handleResize);
    document.addEventListener('fullscreenchange', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('fullscreenchange', handleResize);
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const badge = badgeRef.current;
    if (!badge) return;
    try {
      badge.setPointerCapture(e.pointerId);
    } catch {}

    const container = getContainer();
    const rect = badge.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    dragRef.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      initialX: rect.left - containerRect.left,
      initialY: rect.top - containerRect.top,
      hasMoved: false,
    };
    setIsDraggingState(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!dragRef.current.isDragging || !badgeRef.current) return;

    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 6) {
      dragRef.current.hasMoved = true;
    }

    const newX = dragRef.current.initialX + dx;
    const newY = dragRef.current.initialY + dy;

    const badge = badgeRef.current;
    const container = getContainer();
    const cw = container.clientWidth || window.innerWidth;
    const ch = container.clientHeight || window.innerHeight;
    const bw = badge.offsetWidth || 120;
    const bh = badge.offsetHeight || 28;

    const clampedX = Math.max(8, Math.min(newX, cw - bw - 8));
    const clampedY = Math.max(8, Math.min(newY, ch - bh - 80));

    (badge as any).__currentX = clampedX;
    (badge as any).__currentY = clampedY;

    updatePositionStyle(clampedX, clampedY, false);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const badge = badgeRef.current;
    if (!badge) return;
    try {
      badge.releasePointerCapture(e.pointerId);
    } catch {}

    if (!dragRef.current.isDragging) return;
    dragRef.current.isDragging = false;
    setIsDraggingState(false);

    if (!dragRef.current.hasMoved) {
      onShowCall();
      return;
    }

    const container = getContainer();
    const cw = container.clientWidth || window.innerWidth;
    const ch = container.clientHeight || window.innerHeight;
    const bw = badge.offsetWidth || 120;
    const bh = badge.offsetHeight || 28;

    let curX = (badge as any).__currentX ?? 8;
    let curY = (badge as any).__currentY ?? 64;

    const snapLeft = 8;
    const snapRight = Math.max(8, cw - bw - 8);
    const targetX = curX + bw / 2 < cw / 2 ? snapLeft : snapRight;
    const clampedY = Math.max(8, Math.min(curY, ch - bh - 80));

    (badge as any).__currentX = targetX;
    (badge as any).__currentY = clampedY;

    updatePositionStyle(targetX, clampedY, true);

    try {
      const xPct = targetX / Math.max(1, cw - bw - 16);
      const yPct = clampedY / Math.max(1, ch - bh - 80);
      localStorage.setItem('omniplay.callBadgePos', JSON.stringify({ xPct, yPct }));
    } catch {}
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onShowCall();
    }
  };

  return (
    <div className="absolute inset-0 z-[100] pointer-events-none overflow-hidden">
      <button
        ref={badgeRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={(e) => {
          e.stopPropagation();
          if (!dragRef.current.hasMoved) {
            onShowCall();
          }
        }}
        onKeyDown={handleKeyDown}
        className={`pointer-events-auto flex items-center gap-1.5 px-2.5 py-1 bg-zinc-950/85 hover:bg-zinc-900 border border-emerald-500/50 backdrop-blur-md rounded-full sm:rounded-2xl shadow-xl text-xs text-white transition-opacity duration-150 select-none touch-none absolute top-0 left-0 ${
          isDraggingState ? 'opacity-100 ring-2 ring-emerald-400/50 scale-105' : 'opacity-85 hover:opacity-100'
        }`}
        style={{ touchAction: 'none', height: '28px' }}
        aria-label={`Show call (${participantCount} participants)`}
        title="Drag to move, click to show call"
      >
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
        <Video className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        <span className="font-semibold text-emerald-200 text-xs sm:inline flex items-center">
         {/* <span className="hidden sm:inline">Show Call&nbsp;</span>({participantCount}) */}
         <span className="hidden sm:inline">&nbsp;</span>({participantCount})
        </span>
      </button>
    </div>
  );
};

