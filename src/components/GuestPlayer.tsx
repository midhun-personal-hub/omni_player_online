import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Volume1,
  Maximize2,
  Minimize2,
  LogOut,
  Radio,
  Music,
  Lock,
  Subtitles,
  Loader2,
  AlertCircle,
  WifiOff,
  MessageSquare,
  Video,
} from 'lucide-react';
import { SubtitleTrack } from '../types/media';
import { formatTime } from '../utils/formatters';

interface GuestPlayerProps {
  roomCode: string;
  incomingStream: MediaStream | null;
  isReconnecting: boolean;
  hostState: {
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    playbackRate: number;
    mediaName: string;
    isAudio: boolean;
    allowGuestControl: boolean;
  };
  guestSubtitleTrack: SubtitleTrack | null;
  onSendControl: (action: 'play' | 'pause' | 'seek' | 'rate', time?: number, rate?: number) => void;
  onLeave: () => void;
  statusMessage?: string | null;
  isChatOpen?: boolean;
  onToggleChat?: () => void;
  unreadCount?: number;
  inCall?: boolean;
  incomingCall?: { active: boolean; name: string } | null;
  onStartCall?: () => void;
  duckingMultiplier?: number;
  callStrip?: React.ReactNode;
}

export const GuestPlayer: React.FC<GuestPlayerProps> = ({
  roomCode,
  incomingStream,
  isReconnecting,
  hostState,
  guestSubtitleTrack,
  onSendControl,
  onLeave,
  statusMessage,
  isChatOpen,
  onToggleChat,
  unreadCount,
  inCall = false,
  incomingCall,
  onStartCall,
  duckingMultiplier = 1.0,
  callStrip,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);

  const [volume, setVolume] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [controlsVisible, setControlsVisible] = useState<boolean>(true);
  const [showSpeedMenu, setShowSpeedMenu] = useState<boolean>(false);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState<boolean>(true);
  const [autoplayBlocked, setAutoplayBlocked] = useState<boolean>(false);
  const hideControlsTimerRef = useRef<number | null>(null);

  // Check if incoming stream has video tracks
  const hasVideoTrack = incomingStream
    ? incomingStream.getVideoTracks().length > 0 && !hostState.isAudio
    : !hostState.isAudio;

  // Bind incoming stream to <video> element
  useEffect(() => {
    if (videoRef.current && incomingStream) {
      videoRef.current.srcObject = incomingStream;
      videoRef.current
        .play()
        .then(() => {
          setAutoplayBlocked(false);
        })
        .catch((err) => {
          console.warn('Autoplay prevented by browser:', err);
          setAutoplayBlocked(true);
        });
    }
  }, [incomingStream]);

  // Fullscreen listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Controls auto-hide
  const handleMouseMove = () => {
    setControlsVisible(true);
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current);
    }
    if (hostState.isPlaying) {
      hideControlsTimerRef.current = window.setTimeout(() => {
        setControlsVisible(false);
        setShowSpeedMenu(false);
      }, 3000);
    }
  };

  // Autoplay unlock handler
  const handleUnlockAutoplay = () => {
    if (videoRef.current) {
      videoRef.current.muted = false;
      videoRef.current
        .play()
        .then(() => {
          setAutoplayBlocked(false);
          setIsMuted(false);
        })
        .catch(console.warn);
    }
  };

  // Toggle Play / Pause (sends request to host if allowed)
  const handleTogglePlay = useCallback(() => {
    if (!hostState.allowGuestControl) return;
    if (videoRef.current && videoRef.current.paused) {
      videoRef.current.play().catch(console.warn);
    }
    onSendControl(hostState.isPlaying ? 'pause' : 'play');
  }, [hostState.allowGuestControl, hostState.isPlaying, onSendControl]);

  // Seek on scrubber
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!hostState.allowGuestControl || !progressBarRef.current) return;
    const dur = hostState.duration || videoRef.current?.duration || 0;
    if (!dur) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetTime = pos * dur;
    onSendControl('seek', targetTime);
  };

  const handleSkip = useCallback(
    (seconds: number) => {
      if (!hostState.allowGuestControl) return;
      const dur = hostState.duration || videoRef.current?.duration || 0;
      const nextTime = Math.max(0, Math.min(dur || 999999, hostState.currentTime + seconds));
      onSendControl('seek', nextTime);
    },
    [hostState.allowGuestControl, hostState.duration, hostState.currentTime, onSendControl]
  );

  // Change playback speed
  const handleChangeSpeed = useCallback(
    (speed: number) => {
      if (!hostState.allowGuestControl) return;
      onSendControl('rate', undefined, speed);
      setShowSpeedMenu(false);
    },
    [hostState.allowGuestControl, onSendControl]
  );

  // Guest-side volume control
  const handleVolumeChange = useCallback((newVol: number) => {
    if (!videoRef.current) return;
    const clamped = Math.max(0, Math.min(1, newVol));
    videoRef.current.volume = clamped;
    setVolume(clamped);
    if (clamped > 0 && isMuted) {
      videoRef.current.muted = false;
      setIsMuted(false);
    }
  }, [isMuted]);

  const toggleMute = useCallback(() => {
    if (!videoRef.current) return;
    const nextMuted = !videoRef.current.muted;
    videoRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
  }, []);

  // Movie audio ducking: scale volume smoothly when friends speak
  useEffect(() => {
    if (!videoRef.current) return;
    const effective = typeof duckingMultiplier === 'number' ? duckingMultiplier : 1.0;
    const finalVol = Math.max(0, Math.min(1, (isMuted ? 0 : volume) * effective));
    videoRef.current.volume = finalVol;
  }, [volume, isMuted, duckingMultiplier]);

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(console.warn);
    } else {
      document.exitFullscreen().catch(console.warn);
    }
  }, []);

  // Keyboard shortcuts for guest player
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case ' ':
        case 'k':
          e.preventDefault();
          handleTogglePlay();
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case 'arrowleft':
        case 'j':
          e.preventDefault();
          handleSkip(-5);
          break;
        case 'arrowright':
        case 'l':
          e.preventDefault();
          handleSkip(5);
          break;
        case 'arrowup':
          e.preventDefault();
          handleVolumeChange(volume + 0.05);
          break;
        case 'arrowdown':
          e.preventDefault();
          handleVolumeChange(volume - 0.05);
          break;
        case '[':
          e.preventDefault();
          handleChangeSpeed(Math.max(0.25, Number((hostState.playbackRate - 0.25).toFixed(2))));
          break;
        case ']':
          e.preventDefault();
          handleChangeSpeed(Math.min(3, Number((hostState.playbackRate + 0.25).toFixed(2))));
          break;
        case 'c':
          e.preventDefault();
          setSubtitlesEnabled((prev) => !prev);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    handleTogglePlay,
    toggleFullscreen,
    toggleMute,
    handleSkip,
    handleVolumeChange,
    handleChangeSpeed,
    volume,
    hostState.playbackRate,
  ]);

  // Current active subtitle text
  const currentSubtitleText = (() => {
    if (!subtitlesEnabled || !guestSubtitleTrack) return null;
    const adjustedTime = hostState.currentTime - (guestSubtitleTrack.delaySeconds || 0);
    const cue = guestSubtitleTrack.cues.find(
      (c) => adjustedTime >= c.startTime && adjustedTime <= c.endTime
    );
    return cue ? cue.text : null;
  })();

  const progressPercent = hostState.duration
    ? Math.min(100, (hostState.currentTime / hostState.duration) * 100)
    : 0;

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className="relative w-full h-full bg-black flex items-center justify-center select-none overflow-hidden"
    >
      {/* Clickable video viewport */}
      <div
        className="w-full h-full flex items-center justify-center cursor-pointer"
        onClick={handleTogglePlay}
        onDoubleClick={toggleFullscreen}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className={`w-full h-full object-contain ${hasVideoTrack ? 'block' : 'hidden'}`}
        />
      </div>

      {/* Audio-only screen */}
      {!hasVideoTrack && (
        <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center z-10 bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950">
          <div className="w-24 h-24 rounded-3xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 mb-6 shadow-2xl animate-pulse">
            <Music className="w-12 h-12" />
          </div>
          <span className="text-xs uppercase font-bold tracking-widest text-sky-400 mb-2">
            Audio Stream Live
          </span>
          <h2 className="text-xl sm:text-2xl font-bold text-white max-w-lg truncate mb-2">
            {hostState.mediaName || 'Audio Playing'}
          </h2>
          <p className="text-xs text-zinc-400">
            Listening with high-fidelity host equalizer audio
          </p>

          {/* Sound wave visualizer animation */}
          <div className="flex items-center gap-1.5 mt-8 h-10">
            {[40, 70, 100, 60, 30, 85, 95, 45, 80, 50, 75, 35].map((h, i) => (
              <div
                key={i}
                className="w-1.5 bg-sky-400/80 rounded-full transition-all duration-300"
                style={{
                  height: hostState.isPlaying ? `${h}%` : '15%',
                  animationDuration: `${0.6 + (i % 4) * 0.2}s`,
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Autoplay blocked overlay (Browser requirement) */}
      {autoplayBlocked && (
        <div className="absolute inset-0 z-40 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-200">
          <button
            onClick={handleUnlockAutoplay}
            className="w-20 h-20 rounded-full bg-sky-500 text-zinc-950 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-2xl shadow-sky-500/30 mb-4"
          >
            <Play className="w-10 h-10 fill-current ml-1" />
          </button>
          <h3 className="text-lg font-bold text-white mb-1">Tap to Start Watching</h3>
          <p className="text-xs text-zinc-400 max-w-sm">
            Browser policy requires an initial click to enable live audio playback.
          </p>
        </div>
      )}

      {/* Reconnecting Overlay (if no heartbeat for 8s) */}
      {isReconnecting && (
        <div className="absolute inset-0 z-30 bg-black/75 backdrop-blur-xs flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-200">
          <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 flex flex-col items-center gap-3 shadow-2xl">
            <WifiOff className="w-8 h-8 text-amber-400 animate-pulse" />
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-white">Reconnecting to stream...</h4>
              <p className="text-xs text-zinc-400">
                Waiting for host signal. Please stand by.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Host left the room or disconnected screen */}
      {statusMessage && (
        <div className="absolute inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
          <div className="max-w-sm w-full p-6 rounded-2xl bg-zinc-900 border border-zinc-800 text-center space-y-4 shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Watch Party Ended</h3>
              <p className="text-xs text-zinc-400 mt-1">{statusMessage}</p>
            </div>
            <button
              onClick={onLeave}
              className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-white transition-colors"
            >
              Return to Home
            </button>
          </div>
        </div>
      )}

      {/* Host Paused Pill in Center */}
      {!hostState.isPlaying && !autoplayBlocked && !statusMessage && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <div className="px-4 py-2 rounded-full bg-black/75 border border-white/10 text-white text-xs font-semibold backdrop-blur-md flex items-center gap-2 shadow-2xl animate-in fade-in duration-150">
            <Pause className="w-3.5 h-3.5 fill-current text-sky-400" />
            <span>Host Paused</span>
          </div>
        </div>
      )}

      {/* Subtitles Overlay */}
      {currentSubtitleText && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 max-w-[85%] text-center pointer-events-none transition-all">
          <span className="px-3 py-1.5 bg-black/80 text-white font-medium text-base rounded-lg backdrop-blur-xs leading-relaxed shadow-lg whitespace-pre-line border border-white/10">
            {currentSubtitleText}
          </span>
        </div>
      )}

      {/* TOP HEADER BAR (Overlaid) */}
      <div
        className={`absolute top-0 left-0 right-0 z-30 px-3 sm:px-4 py-2 sm:py-3 bg-gradient-to-b from-black/80 to-transparent flex flex-wrap items-center justify-between gap-2 max-w-full box-border transition-opacity duration-300 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        style={{
          paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0px))',
          paddingLeft: 'max(0.75rem, env(safe-area-inset-left, 0px))',
          paddingRight: 'max(0.75rem, env(safe-area-inset-right, 0px))',
        }}
      >
        {/* Room Badge */}
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-900/90 border border-zinc-700/60 text-xs font-medium text-zinc-200 backdrop-blur-md shadow-lg whitespace-nowrap">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="hidden sm:inline">Connected to room</span>
            <span className="font-mono font-bold text-sky-400">{roomCode}</span>
          </div>
          {hostState.mediaName && (
            <span className="hidden md:inline text-xs text-zinc-400 truncate max-w-xs font-medium">
              {hostState.mediaName}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Chat Button - always visible in room controls & fullscreen view */}
          {onToggleChat && (
            <button
              onClick={onToggleChat}
              className={`relative flex items-center justify-center gap-1.5 min-w-[40px] min-h-[40px] w-10 sm:w-auto h-10 px-0 sm:px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all backdrop-blur-md shadow-sm shrink-0 touch-manipulation ${
                isChatOpen
                  ? 'bg-sky-500/20 text-sky-300 border-sky-500/50 ring-2 ring-sky-500/40 shadow-sky-500/20'
                  : 'bg-zinc-900/90 hover:bg-zinc-800 text-zinc-200 border-zinc-700/60'
              }`}
              title="Toggle Room Chat"
              aria-label="Toggle Room Chat"
            >
              <MessageSquare className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-sky-400 shrink-0" />
              <span className="hidden sm:inline">Chat</span>
              {typeof unreadCount === 'number' && unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full bg-sky-500 text-zinc-950 text-[10px] font-bold shadow-sm">
                  {unreadCount}
                </span>
              )}
            </button>
          )}

          {/* Video Call Button */}
          {!inCall && onStartCall && (
            <button
              onClick={onStartCall}
              className={`flex items-center justify-center gap-1.5 min-w-[40px] min-h-[40px] w-10 sm:w-auto h-10 px-0 sm:px-3 py-1.5 text-xs font-semibold rounded-lg transition-all backdrop-blur-md shadow-sm shrink-0 touch-manipulation ${
                incomingCall
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950 border border-emerald-400 ring-2 ring-emerald-400/60 animate-pulse'
                  : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40'
              }`}
              title={
                incomingCall
                  ? `${incomingCall.name} started a call! Click to join`
                  : 'Join Live Video Call'
              }
              aria-label={incomingCall ? 'Join incoming call' : 'Join call'}
            >
              <Video
                className={`w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0 ${incomingCall ? 'text-zinc-950' : 'text-emerald-400'}`}
              />
              <span className="hidden sm:inline">
                {incomingCall ? 'Incoming Call - Join' : 'Join Call'}
              </span>
            </button>
          )}

          {/* Leave Party Button - always visible and accessible on mobile */}
          <button
            onClick={onLeave}
            className="flex items-center justify-center gap-1.5 min-w-[40px] min-h-[40px] w-10 sm:w-auto h-10 px-0 sm:px-3 py-1.5 text-xs font-medium rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 transition-colors backdrop-blur-md shadow-sm shrink-0 touch-manipulation"
            title="Leave Watch Party"
            aria-label="Leave Watch Party"
          >
            <LogOut className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
            <span className="hidden sm:inline">Leave</span>
          </button>
        </div>
      </div>

      {/* BOTTOM CONTROLS BAR */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-30 px-4 pb-4 pt-8 bg-gradient-to-t from-black/90 via-black/50 to-transparent transition-opacity duration-300 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="max-w-5xl mx-auto space-y-2">
          {/* Progress Scrubber */}
          <div
            ref={progressBarRef}
            onClick={handleSeek}
            className={`group relative h-2 bg-zinc-800/80 hover:h-3 rounded-full overflow-hidden transition-all duration-150 backdrop-blur-xs ${
              hostState.allowGuestControl ? 'cursor-pointer' : 'cursor-default'
            }`}
            title={hostState.allowGuestControl ? 'Seek playback' : 'Playback locked to host'}
          >
            {/* Progress Fill */}
            <div
              className="absolute left-0 top-0 bottom-0 bg-sky-500 rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Controls Strip */}
          <div className="flex items-center justify-between text-zinc-300 pt-1">
            {/* Left Controls: Play/Pause, Time, Host Lock status */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleTogglePlay}
                disabled={!hostState.allowGuestControl}
                className={`p-2 rounded-lg transition-colors ${
                  hostState.allowGuestControl
                    ? 'hover:bg-zinc-800 text-white cursor-pointer'
                    : 'text-zinc-600 cursor-not-allowed'
                }`}
                title={
                  hostState.allowGuestControl
                    ? hostState.isPlaying
                      ? 'Pause'
                      : 'Play'
                    : 'Viewers cannot control playback'
                }
              >
                {hostState.isPlaying ? (
                  <Pause className="w-5 h-5 fill-current" />
                ) : (
                  <Play className="w-5 h-5 fill-current" />
                )}
              </button>

              {!hostState.allowGuestControl && (
                <div
                  className="flex items-center gap-1 text-[11px] text-zinc-400 bg-zinc-900/80 px-2 py-0.5 rounded-md border border-zinc-800"
                  title="Host controls playback"
                >
                  <Lock className="w-3 h-3 text-amber-400" />
                  <span>Host Locked</span>
                </div>
              )}

              {/* Time display */}
              <div className="text-xs font-mono text-zinc-400">
                <span>{formatTime(hostState.currentTime)}</span>
                <span className="mx-1 text-zinc-600">/</span>
                <span>{formatTime(hostState.duration)}</span>
              </div>
            </div>

            {/* Right Controls: Volume, Speed, Subtitles, Fullscreen */}
            <div className="flex items-center gap-2">
              {/* Playback speed selector */}
              {hostState.allowGuestControl && (
                <div className="relative">
                  <button
                    onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                    className="px-2 py-1 text-xs font-semibold text-zinc-300 hover:text-white rounded-md hover:bg-zinc-800 transition-colors"
                  >
                    {hostState.playbackRate}x
                  </button>
                  {showSpeedMenu && (
                    <div className="absolute bottom-full mb-2 right-0 bg-zinc-900 border border-zinc-800 rounded-xl py-1 shadow-2xl z-40 flex flex-col w-20">
                      {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
                        <button
                          key={s}
                          onClick={() => handleChangeSpeed(s)}
                          className={`px-3 py-1 text-xs text-left hover:bg-zinc-800 ${
                            hostState.playbackRate === s ? 'text-sky-400 font-bold' : 'text-zinc-300'
                          }`}
                        >
                          {s}x
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Subtitles CC Toggle */}
              {guestSubtitleTrack && (
                <button
                  onClick={() => setSubtitlesEnabled(!subtitlesEnabled)}
                  className={`p-2 rounded-lg transition-colors ${
                    subtitlesEnabled
                      ? 'text-sky-400 bg-sky-950/40 border border-sky-800/40'
                      : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                  }`}
                  title={subtitlesEnabled ? 'Disable subtitles' : 'Enable subtitles'}
                >
                  <Subtitles className="w-4 h-4" />
                </button>
              )}

              {/* Volume Slider & Mute */}
              <div className="flex items-center gap-1.5 group">
                <button
                  onClick={toggleMute}
                  className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors"
                  title={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4 text-rose-400" />
                  ) : volume < 0.5 ? (
                    <Volume1 className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                  className="w-16 sm:w-20 accent-sky-500 cursor-pointer h-1.5 bg-zinc-700 rounded-lg"
                />
              </div>

              {/* Fullscreen Button */}
              <button
                onClick={toggleFullscreen}
                className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors"
                title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Floating Video Call Strip */}
      {callStrip}
    </div>
  );
};
