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

  // If Hidden: Show compact floating button to reopen
  if (isHidden) {
    return (
      <div className="absolute top-16 right-4 z-[100] animate-in fade-in zoom-in-95 duration-150">
        <button
          onClick={() => {
            setIsHidden(false);
            setIsMinimized(false);
          }}
          className="flex items-center gap-2 px-3 py-1.5 bg-zinc-950/95 hover:bg-zinc-900 border border-emerald-500/50 backdrop-blur-md rounded-2xl shadow-2xl text-xs text-white transition-all group"
          title="Click to show video call"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <Video className="w-3.5 h-3.5 text-emerald-400 group-hover:scale-110 transition-transform" />
          <span className="font-semibold text-emerald-200">Show Call ({participantCount})</span>
        </button>
      </div>
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
