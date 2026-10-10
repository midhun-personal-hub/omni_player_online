import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Volume1,
  Maximize2,
  Minimize2,
  RotateCcw,
  SkipBack,
  SkipForward,
  FastForward,
  Rewind,
  Sliders,
  Subtitles,
  Camera,
  PictureInPicture2,
  Info,
  Bookmark,
  ChevronRight,
  ChevronLeft,
  Settings,
  Sparkles,
  Repeat,
} from 'lucide-react';
import {
  MediaItem,
  VideoFilters,
  AspectRatioMode,
  SubtitleTrack,
  VisualizerMode,
} from '../types/media';
import { formatTime, formatTimeDetailed } from '../utils/formatters';
import { audioEngine } from '../utils/audioEngine';
import { AudioVisualizer } from './AudioVisualizer';
import { parseSubtitleFile } from '../utils/subtitles';

interface VideoPlayerProps {
  currentMedia: MediaItem;
  videoFilters: VideoFilters;
  aspectRatio: AspectRatioMode;
  onAspectRatioChange: (mode: AspectRatioMode) => void;
  onOpenEffects: () => void;
  onOpenInfo: () => void;
  onOpenBookmarks: () => void;
  onAddBookmark: (time: number, label: string) => void;
  onOpenShortcuts: () => void;
  onPreviousTrack: () => void;
  onNextTrack: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
  onCaptureScreenshot: (dataUrl: string, time: number) => void;
  volumeBoost: number;
  onMediaElementReady?: (el: HTMLMediaElement | null) => void;
  onSubtitleTrackChange?: (track: SubtitleTrack | null) => void;
  duckingMultiplier?: number;
  callStrip?: React.ReactNode;
}

const VideoPlayerComponent: React.FC<VideoPlayerProps> = ({
  currentMedia,
  videoFilters,
  aspectRatio,
  onAspectRatioChange,
  onOpenEffects,
  onOpenInfo,
  onOpenBookmarks,
  onAddBookmark,
  onOpenShortcuts,
  onPreviousTrack,
  onNextTrack,
  hasPrevious,
  hasNext,
  onCaptureScreenshot,
  volumeBoost,
  onMediaElementReady,
  onSubtitleTrackChange,
  duckingMultiplier = 1.0,
  callStrip,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const subFileInputRef = useRef<HTMLInputElement | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedPercent, setBufferedPercent] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const hideControlsTimerRef = useRef<number | null>(null);

  // Scrubber hover state
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState<number>(0);

  // A-B loop
  const [loopA, setLoopA] = useState<number | null>(null);
  const [loopB, setLoopB] = useState<number | null>(null);

  // Subtitles
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [selectedSubTrackId, setSelectedSubTrackId] = useState<string | null>(null);
  const [subtitleDelay, setSubtitleDelay] = useState(0); // in seconds
  const [activeSubtitleText, setActiveSubtitleText] = useState<string | null>(null);
  const [showSubMenu, setShowSubMenu] = useState(false);
  const [subFontSize, setSubFontSize] = useState<number>(20);

  // Audio Visualizer Mode (for audio playback)
  const [visualizerMode, setVisualizerMode] = useState<VisualizerMode>('bars');

  // Popover menus
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showAspectMenu, setShowAspectMenu] = useState(false);

  // Toast notification helper
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 2200);
  }, []);

  // Connect AudioEngine on media element load & maintain host local playback
  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;

    // Check 1: Host player must only use src (the blob/object URL), never srcObject
    if (el.srcObject) {
      console.warn('[OmniPlay Host] Clearing unexpected srcObject on host media element');
      el.srcObject = null;
    }
    if (currentMedia?.url && el.src !== currentMedia.url) {
      el.src = currentMedia.url;
    }

    audioEngine.init(el);
    audioEngine.setBoost(volumeBoost);
    onMediaElementReady?.(el);

    // Check 6: Add temporary console logs for video's error, stalled, and emptied events
    const handleError = () => {
      console.warn('[OmniPlay Host Video Error]', el.error, {
        src: el.src,
        srcObject: el.srcObject,
        readyState: el.readyState,
      });
    };
    const handleStalled = () => {
      console.warn('[OmniPlay Host Video Stalled]', {
        src: el.src,
        srcObject: el.srcObject,
        readyState: el.readyState,
      });
    };
    const handleEmptied = () => {
      console.warn('[OmniPlay Host Video Emptied]', {
        src: el.src,
        srcObject: el.srcObject,
      });
    };

    el.addEventListener('error', handleError);
    el.addEventListener('stalled', handleStalled);
    el.addEventListener('emptied', handleEmptied);

    // Initial diagnostic log
    console.log('[OmniPlay Host Video Ready]', {
      src: el.src,
      srcObject: el.srcObject,
      readyState: el.readyState,
      videoWidth: el.videoWidth,
      muted: el.muted,
      paused: el.paused,
    });

    return () => {
      el.removeEventListener('error', handleError);
      el.removeEventListener('stalled', handleStalled);
      el.removeEventListener('emptied', handleEmptied);
    };
  }, [currentMedia.url, volumeBoost, onMediaElementReady]);

  // Handle Fullscreen change
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Auto-hide controls during mouse inactivity
  const handleMouseMove = () => {
    setControlsVisible(true);
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current);
    }
    if (isPlaying) {
      hideControlsTimerRef.current = window.setTimeout(() => {
        setControlsVisible(false);
        setShowSpeedMenu(false);
        setShowAspectMenu(false);
        setShowSubMenu(false);
      }, 2500);
    }
  };

  // Play / Pause toggle with autoplay error handling
  const togglePlay = useCallback(() => {
    if (!mediaRef.current) return;
    audioEngine.resume();
    if (mediaRef.current.paused) {
      const playPromise = mediaRef.current.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => setIsPlaying(true))
          .catch((err) => {
            console.warn('[OmniPlay Host Autoplay/Play Rejection]:', err);
            setIsPlaying(false);
          });
      }
    } else {
      mediaRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  // Step Frame
  const stepFrame = (forward: boolean) => {
    if (!mediaRef.current) return;
    mediaRef.current.pause();
    setIsPlaying(false);
    const frameDuration = 1 / 30; // ~33ms for 30fps
    mediaRef.current.currentTime = Math.max(0, mediaRef.current.currentTime + (forward ? frameDuration : -frameDuration));
    showToast(forward ? 'Step: +1 Frame' : 'Step: -1 Frame');
  };

  // Skip relative seconds
  const skip = useCallback((seconds: number) => {
    if (!mediaRef.current) return;
    mediaRef.current.currentTime = Math.max(0, Math.min(mediaRef.current.duration || 0, mediaRef.current.currentTime + seconds));
    showToast(`${seconds > 0 ? '+' : ''}${seconds}s`);
  }, [showToast]);

  // Set speed
  const changeSpeed = (speed: number) => {
    if (!mediaRef.current) return;
    mediaRef.current.playbackRate = speed;
    setPlaybackSpeed(speed);
    setShowSpeedMenu(false);
    showToast(`Speed: ${speed}x`);
  };

  // Volume change
  const handleVolumeChange = (newVol: number) => {
    if (!mediaRef.current) return;
    mediaRef.current.volume = newVol;
    setVolume(newVol);
    if (newVol > 0 && isMuted) {
      mediaRef.current.muted = false;
      setIsMuted(false);
    }
  };

  // Movie audio ducking: smoothly scale element volume without touching EQ/audioEngine
  useEffect(() => {
    if (!mediaRef.current) return;
    const effective = typeof duckingMultiplier === 'number' ? duckingMultiplier : 1.0;
    const finalVol = Math.max(0, Math.min(1, volume * (isMuted ? 0 : effective)));
    mediaRef.current.volume = finalVol;
    mediaRef.current.muted = isMuted;
  }, [volume, isMuted, duckingMultiplier]);

  // Toggle Mute
  const toggleMute = useCallback(() => {
    if (!mediaRef.current) return;
    mediaRef.current.muted = !mediaRef.current.muted;
    setIsMuted(mediaRef.current.muted);
    showToast(mediaRef.current.muted ? 'Muted' : `Volume: ${Math.round(volume * 100)}%`);
  }, [volume, showToast]);

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch((err) => console.warn(err));
    } else {
      document.exitFullscreen().catch((err) => console.warn(err));
    }
  }, []);

  // Picture in Picture
  const togglePiP = async () => {
    if (!mediaRef.current || !currentMedia.isVideo) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await mediaRef.current.requestPictureInPicture();
      }
    } catch (e) {
      showToast('Picture-in-Picture not supported on this browser');
    }
  };

  // Capture High-res Screenshot
  const captureScreenshot = () => {
    const video = mediaRef.current;
    if (!video || !currentMedia.isVideo) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1920;
      canvas.height = video.videoHeight || 1080;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Apply video filters to the screenshot snapshot
      const f = videoFilters;
      let filterStr = `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturation}%) hue-rotate(${f.hueRotate}deg) blur(${f.blur}px)`;
      if (f.invert) filterStr += ' invert(100%)';
      if (f.sepia) filterStr += ' sepia(100%)';
      ctx.filter = filterStr;

      ctx.save();
      if (f.flipHorizontal || f.flipVertical) {
        ctx.translate(f.flipHorizontal ? canvas.width : 0, f.flipVertical ? canvas.height : 0);
        ctx.scale(f.flipHorizontal ? -1 : 1, f.flipVertical ? -1 : 1);
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.restore();

      const dataUrl = canvas.toDataURL('image/png');
      onCaptureScreenshot(dataUrl, video.currentTime);
      showToast('Screenshot Captured');
    } catch {
      showToast('Snapshot failed (CORS or codec restriction)');
    }
  };

  // Progress Bar click / drag
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = mediaRef.current;
    const dur = (el && Number.isFinite(el.duration) && el.duration > 0) ? el.duration : duration;
    if (!progressBarRef.current || !el || !dur) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetTime = pos * dur;
    el.currentTime = targetTime;
    setCurrentTime(targetTime);
  };

  const handleProgressMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = mediaRef.current;
    const dur = (el && Number.isFinite(el.duration) && el.duration > 0) ? el.duration : duration;
    if (!progressBarRef.current || !dur) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverPosition(pos);
    setHoverTime(pos * dur);
  };

  const handleProgressMouseLeave = () => {
    setHoverTime(null);
  };

  // Subtitle File Import
  const handleSubtitleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const cues = parseSubtitleFile(text);
      const newTrack: SubtitleTrack = {
        id: `track-${Date.now()}`,
        name: file.name.replace(/\.[^/.]+$/, ''),
        cues,
        delaySeconds: 0,
      };

      setSubtitleTracks((prev) => [...prev, newTrack]);
      setSelectedSubTrackId(newTrack.id);
      showToast(`Loaded ${cues.length} subtitles from ${file.name}`);
    } catch {
      showToast('Error parsing subtitle file');
    }
    e.target.value = '';
  };

  // Sync subtitle cues with currentTime
  useEffect(() => {
    if (!selectedSubTrackId) {
      setActiveSubtitleText(null);
      onSubtitleTrackChange?.(null);
      return;
    }

    const currentTrack = subtitleTracks.find((t) => t.id === selectedSubTrackId);
    if (!currentTrack) {
      setActiveSubtitleText(null);
      onSubtitleTrackChange?.(null);
      return;
    }

    onSubtitleTrackChange?.({ ...currentTrack, delaySeconds: subtitleDelay });

    const adjustedTime = currentTime - subtitleDelay;
    const activeCue = currentTrack.cues.find(
      (c) => adjustedTime >= c.startTime && adjustedTime <= c.endTime
    );

    setActiveSubtitleText(activeCue ? activeCue.text : null);
  }, [currentTime, selectedSubTrackId, subtitleTracks, subtitleDelay, onSubtitleTrackChange]);

  // A-B Loop Logic
  useEffect(() => {
    if (loopA !== null && loopB !== null && loopB > loopA) {
      if (currentTime >= loopB || currentTime < loopA) {
        if (mediaRef.current) {
          mediaRef.current.currentTime = loopA;
        }
      }
    }
  }, [currentTime, loopA, loopB]);

  // Global Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
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
          togglePlay();
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
          e.preventDefault();
          skip(-5);
          break;
        case 'arrowright':
          e.preventDefault();
          skip(5);
          break;
        case 'j':
          e.preventDefault();
          skip(-10);
          break;
        case 'l':
          e.preventDefault();
          skip(10);
          break;
        case 'arrowup':
          e.preventDefault();
          handleVolumeChange(Math.min(1, volume + 0.05));
          showToast(`Volume: ${Math.round(Math.min(1, volume + 0.05) * 100)}%`);
          break;
        case 'arrowdown':
          e.preventDefault();
          handleVolumeChange(Math.max(0, volume - 0.05));
          showToast(`Volume: ${Math.round(Math.max(0, volume - 0.05) * 100)}%`);
          break;
        case '[':
          e.preventDefault();
          changeSpeed(Math.max(0.25, Number((playbackSpeed - 0.25).toFixed(2))));
          break;
        case ']':
          e.preventDefault();
          changeSpeed(Math.min(3, Number((playbackSpeed + 0.25).toFixed(2))));
          break;
        case ',':
          e.preventDefault();
          stepFrame(false);
          break;
        case '.':
          e.preventDefault();
          stepFrame(true);
          break;
        case 's':
          e.preventDefault();
          if (currentMedia.isVideo) captureScreenshot();
          break;
        case 'b':
          e.preventDefault();
          onAddBookmark(currentTime, `Bookmark @ ${formatTime(currentTime)}`);
          showToast(`Bookmark added @ ${formatTime(currentTime)}`);
          break;
        case '?':
          e.preventDefault();
          onOpenShortcuts();
          break;
        case 'c':
          e.preventDefault();
          if (subtitleTracks.length > 0) {
            setSelectedSubTrackId((prev) => (prev ? null : subtitleTracks[0].id));
            showToast(selectedSubTrackId ? 'Subtitles Off' : 'Subtitles On');
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    togglePlay,
    toggleFullscreen,
    toggleMute,
    skip,
    volume,
    playbackSpeed,
    currentMedia.isVideo,
    currentTime,
    subtitleTracks,
    selectedSubTrackId,
    showToast,
    onAddBookmark,
    onOpenShortcuts,
  ]);

  // Compute CSS filter style for video
  const filterStyle: React.CSSProperties = {
    filter: `brightness(${videoFilters.brightness}%) contrast(${videoFilters.contrast}%) saturate(${videoFilters.saturation}%) hue-rotate(${videoFilters.hueRotate}deg) blur(${videoFilters.blur}px) ${
      videoFilters.invert ? 'invert(100%)' : ''
    } ${videoFilters.sepia ? 'sepia(100%)' : ''}`.trim(),
    transform: `${videoFilters.flipHorizontal ? 'scaleX(-1)' : ''} ${
      videoFilters.flipVertical ? 'scaleY(-1)' : ''
    }`.trim(),
  };

  // Object-fit aspect ratio styling
  const getAspectRatioClasses = () => {
    switch (aspectRatio) {
      case '16:9':
        return 'aspect-video object-cover w-full h-full';
      case '4:3':
        return 'aspect-4/3 object-cover w-full h-full';
      case '21:9':
        return 'aspect-[21/9] object-cover w-full h-full';
      case 'cover':
        return 'object-cover w-full h-full';
      case 'fill':
        return 'object-fill w-full h-full';
      case 'original':
      default:
        return 'object-contain w-full h-full';
    }
  };

  // Check 4: Always read playback time and duration directly from the real media element
  const actualCurrentTime = mediaRef.current ? mediaRef.current.currentTime : currentTime;
  const actualDuration =
    mediaRef.current && Number.isFinite(mediaRef.current.duration) && mediaRef.current.duration > 0
      ? mediaRef.current.duration
      : duration;
  const progressPercent = actualDuration > 0 ? (actualCurrentTime / actualDuration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className={`relative w-full h-full flex items-center justify-center bg-black overflow-hidden select-none group ${
        isFullscreen ? 'cursor-none-when-inactive' : ''
      }`}
    >
      {/* Toast Overlay */}
      {toastMessage && (
        <div className="absolute top-8 z-40 px-4 py-2 bg-zinc-900/90 text-sky-400 border border-zinc-700/80 rounded-xl text-xs font-mono font-medium shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-150">
          {toastMessage}
        </div>
      )}

      {/* Main Video or Audio Render Element */}
      {currentMedia.isAudio ? (
        <div className="w-full h-full flex flex-col items-center justify-center">
          <audio
            ref={(el) => {
              mediaRef.current = el as unknown as HTMLVideoElement;
            }}
            src={currentMedia.url}
            onPlay={() => {
              audioEngine.resume();
              setIsPlaying(true);
            }}
            onPause={() => setIsPlaying(false)}
            onRateChange={() => {
              if (mediaRef.current) setPlaybackSpeed(mediaRef.current.playbackRate);
            }}
            onTimeUpdate={() => {
              if (mediaRef.current) {
                setCurrentTime(mediaRef.current.currentTime);
              }
            }}
            onLoadedMetadata={() => {
              if (mediaRef.current) {
                setDuration(mediaRef.current.duration);
                currentMedia.duration = mediaRef.current.duration;
              }
            }}
            onEnded={() => {
              setIsPlaying(false);
              if (hasNext) onNextTrack();
            }}
            onProgress={() => {
              if (mediaRef.current && mediaRef.current.buffered.length > 0) {
                const end = mediaRef.current.buffered.end(mediaRef.current.buffered.length - 1);
                setBufferedPercent((end / (mediaRef.current.duration || 1)) * 100);
              }
            }}
          />
          <AudioVisualizer isPlaying={isPlaying} mode={visualizerMode} title={currentMedia.name} />

          {/* Visualizer Mode Tabs on top for audio */}
          <div className="absolute top-4 right-4 z-20 flex items-center gap-1 p-1 bg-zinc-900/80 border border-zinc-800 rounded-lg backdrop-blur-md">
            {(['bars', 'wave', 'radial', 'particles'] as VisualizerMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setVisualizerMode(m)}
                className={`px-2.5 py-1 text-[11px] font-medium capitalize rounded-md transition-colors ${
                  visualizerMode === m
                    ? 'bg-sky-500 text-zinc-950 font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div
          className="relative w-full h-full flex items-center justify-center cursor-pointer"
          onClick={togglePlay}
          onDoubleClick={toggleFullscreen}
        >
          <video
            ref={mediaRef}
            src={currentMedia.url}
            style={filterStyle}
            className={`transition-all duration-150 ${getAspectRatioClasses()}`}
            playsInline
            onPlay={() => {
              audioEngine.resume();
              setIsPlaying(true);
            }}
            onPause={() => setIsPlaying(false)}
            onRateChange={() => {
              if (mediaRef.current) setPlaybackSpeed(mediaRef.current.playbackRate);
            }}
            onTimeUpdate={() => {
              if (mediaRef.current) {
                setCurrentTime(mediaRef.current.currentTime);
              }
            }}
            onLoadedMetadata={() => {
              if (mediaRef.current) {
                setDuration(mediaRef.current.duration);
                currentMedia.duration = mediaRef.current.duration;
                currentMedia.width = mediaRef.current.videoWidth;
                currentMedia.height = mediaRef.current.videoHeight;
              }
            }}
            onEnded={() => {
              setIsPlaying(false);
              if (hasNext) onNextTrack();
            }}
            onProgress={() => {
              if (mediaRef.current && mediaRef.current.buffered.length > 0) {
                const end = mediaRef.current.buffered.end(mediaRef.current.buffered.length - 1);
                setBufferedPercent((end / (mediaRef.current.duration || 1)) * 100);
              }
            }}
          />

          {/* Subtitles Overlay */}
          {activeSubtitleText && (
            <div
              className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 max-w-[85%] text-center pointer-events-none transition-all"
              style={{ fontSize: `${subFontSize}px` }}
            >
              <span className="px-3 py-1.5 bg-black/80 text-white font-medium rounded-lg backdrop-blur-xs leading-relaxed shadow-lg whitespace-pre-line border border-white/10">
                {activeSubtitleText}
              </span>
            </div>
          )}

          {/* Play/Pause Splash Icon on Click */}
          <div
            className={`absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity duration-300 ${
              isPlaying ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
            }`}
          >
            <div className="w-16 h-16 rounded-full bg-black/60 border border-white/20 backdrop-blur-md flex items-center justify-center text-white shadow-2xl">
              <Play className="w-8 h-8 fill-current translate-x-0.5 text-sky-400" />
            </div>
          </div>
        </div>
      )}

      {/* Top Header Controls Bar (Auto-hides) */}
      <div
        className={`absolute top-0 inset-x-0 z-30 p-4 bg-gradient-to-b from-black/85 via-black/40 to-transparent transition-opacity duration-300 flex items-center justify-between ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0 pr-4">
          <div className="truncate">
            <h1 className="text-sm font-semibold text-white tracking-wide truncate">
              {currentMedia.name}
            </h1>
            <div className="flex items-center gap-2 text-[11px] text-zinc-400 font-mono mt-0.5">
              <span className="uppercase text-sky-400 font-semibold">{currentMedia.extension}</span>
              <span>·</span>
              <span>Local Storage Playback</span>
              {currentMedia.width && currentMedia.height && (
                <>
                  <span>·</span>
                  <span>
                    {currentMedia.width}×{currentMedia.height}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Aspect Ratio Menu */}
          {currentMedia.isVideo && (
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowAspectMenu(!showAspectMenu);
                  setShowSpeedMenu(false);
                  setShowSubMenu(false);
                }}
                className="px-2.5 py-1.5 text-xs text-zinc-300 hover:text-white rounded-lg bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800/80 transition-colors uppercase font-mono"
                title="Aspect Ratio"
              >
                {aspectRatio}
              </button>
              {showAspectMenu && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 top-full mt-2 w-36 bg-zinc-900/95 border border-zinc-800 rounded-xl shadow-2xl py-1 z-40 backdrop-blur-md"
                >
                  {(['original', '16:9', '4:3', '21:9', 'cover', 'fill'] as AspectRatioMode[]).map(
                    (mode) => (
                      <button
                        key={mode}
                        onClick={() => {
                          onAspectRatioChange(mode);
                          setShowAspectMenu(false);
                          showToast(`Aspect: ${mode}`);
                        }}
                        className={`w-full px-3 py-1.5 text-left text-xs capitalize transition-colors ${
                          aspectRatio === mode
                            ? 'text-sky-400 font-semibold bg-sky-950/40'
                            : 'text-zinc-300 hover:bg-zinc-800'
                        }`}
                      >
                        {mode}
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          )}

          {/* Screenshot Button */}
          {currentMedia.isVideo && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                captureScreenshot();
              }}
              className="p-2 text-zinc-300 hover:text-white rounded-lg bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800/80 transition-colors"
              title="Take Snapshot (S)"
            >
              <Camera className="w-4 h-4 text-sky-400" />
            </button>
          )}

          {/* Info Modal Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenInfo();
            }}
            className="p-2 text-zinc-300 hover:text-white rounded-lg bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800/80 transition-colors"
            title="Media Metadata & Details"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Bottom Main Controls Bar (Auto-hides) */}
      <div
        className={`absolute bottom-0 inset-x-0 z-30 p-4 bg-gradient-to-t from-black/95 via-black/60 to-transparent transition-opacity duration-300 space-y-3 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Scrubber Progress Bar */}
        <div
          ref={progressBarRef}
          onClick={handleSeek}
          onMouseMove={handleProgressMouseMove}
          onMouseLeave={handleProgressMouseLeave}
          className="relative group/progress h-2 bg-zinc-800/80 hover:h-3 rounded-full cursor-pointer transition-all flex items-center"
        >
          {/* Buffered Progress */}
          <div
            className="absolute left-0 top-0 bottom-0 bg-zinc-700/60 rounded-full pointer-events-none"
            style={{ width: `${bufferedPercent}%` }}
          />

          {/* Played Progress */}
          <div
            className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-sky-500 to-indigo-500 rounded-full pointer-events-none shadow-sm"
            style={{ width: `${progressPercent}%` }}
          />

          {/* Scrubber Thumb Knob */}
          <div
            className="absolute w-3.5 h-3.5 bg-white rounded-full shadow-md -translate-x-1/2 opacity-0 group-hover/progress:opacity-100 transition-opacity pointer-events-none"
            style={{ width: '14px', height: '14px', left: `${progressPercent}%` }}
          />

          {/* A-B Loop visual markers */}
          {actualDuration > 0 && loopA !== null && (
            <div
              className="absolute top-0 bottom-0 w-1 bg-amber-400 pointer-events-none shadow-sm"
              style={{ left: `${(loopA / actualDuration) * 100}%` }}
              title={`Loop Point A: ${formatTime(loopA)}`}
            />
          )}
          {actualDuration > 0 && loopB !== null && (
            <div
              className="absolute top-0 bottom-0 w-1 bg-amber-400 pointer-events-none shadow-sm"
              style={{ left: `${(loopB / actualDuration) * 100}%` }}
              title={`Loop Point B: ${formatTime(loopB)}`}
            />
          )}

          {/* Bookmarks markers on timeline */}
          {actualDuration > 0 &&
            currentMedia.bookmarks.map((bm) => (
              <div
                key={bm.id}
                className="absolute top-0 bottom-0 w-1 bg-sky-300 pointer-events-none rounded-full"
                style={{ left: `${(bm.time / actualDuration) * 100}%` }}
                title={bm.label}
              />
            ))}

          {/* Hover Time Tooltip */}
          {hoverTime !== null && (
            <div
              className="absolute -top-8 -translate-x-1/2 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-[11px] font-mono text-zinc-200 pointer-events-none shadow-lg"
              style={{ left: `${hoverPosition * 100}%` }}
            >
              {formatTimeDetailed(hoverTime)}
            </div>
          )}
        </div>

        {/* Control Buttons Strip */}
        <div className="flex items-center justify-between gap-2">
          {/* Left Controls: Play/Pause, Skips, Playlist Nav, Time */}
          <div className="flex items-center gap-2">
            {/* Previous Track */}
            <button
              onClick={onPreviousTrack}
              disabled={!hasPrevious}
              className={`p-2 rounded-lg transition-colors ${
                hasPrevious
                  ? 'text-zinc-300 hover:text-white hover:bg-zinc-800'
                  : 'text-zinc-600 cursor-not-allowed'
              }`}
              title="Previous Track"
            >
              <SkipBack className="w-4 h-4" />
            </button>

            {/* Skip -10s */}
            <button
              onClick={() => skip(-10)}
              className="p-2 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
              title="Rewind 10s (J)"
            >
              <Rewind className="w-4 h-4" />
            </button>

            {/* Play/Pause Button */}
            <button
              onClick={togglePlay}
              className="p-2.5 bg-sky-500 hover:bg-sky-400 text-zinc-950 rounded-xl font-bold transition-transform active:scale-95 shadow-md"
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 fill-current translate-x-0.5" />
              )}
            </button>

            {/* Skip +10s */}
            <button
              onClick={() => skip(10)}
              className="p-2 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
              title="Forward 10s (L)"
            >
              <FastForward className="w-4 h-4" />
            </button>

            {/* Next Track */}
            <button
              onClick={onNextTrack}
              disabled={!hasNext}
              className={`p-2 rounded-lg transition-colors ${
                hasNext
                  ? 'text-zinc-300 hover:text-white hover:bg-zinc-800'
                  : 'text-zinc-600 cursor-not-allowed'
              }`}
              title="Next Track"
            >
              <SkipForward className="w-4 h-4" />
            </button>

            {/* Time Display */}
            <div className="flex items-center gap-1 font-mono text-xs text-zinc-300 ml-1">
              <span>{formatTime(actualCurrentTime)}</span>
              <span className="text-zinc-600">/</span>
              <span className="text-zinc-500">{formatTime(actualDuration)}</span>
            </div>
          </div>

          {/* Right Controls: Volume, Subtitles, Effects, Speed, PiP, Fullscreen */}
          <div className="flex items-center gap-2">
            {/* Volume Control */}
            <div className="flex items-center gap-1.5 group/vol">
              <button
                onClick={toggleMute}
                className="p-2 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
                title="Mute / Unmute (M)"
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
                step="0.02"
                value={isMuted ? 0 : volume}
                onChange={(e) => handleVolumeChange(Number(e.target.value))}
                className="w-16 sm:w-20 accent-sky-400 bg-zinc-800 h-1 rounded-lg appearance-none cursor-pointer"
              />
              {volumeBoost > 1 && (
                <span
                  onClick={onOpenEffects}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-400 border border-amber-800/50 cursor-pointer"
                  title="Audio Boost Active. Click to adjust."
                >
                  {Math.round(volumeBoost * 100)}%
                </span>
              )}
            </div>

            {/* A-B Loop Controls */}
            <div className="hidden md:flex items-center gap-1">
              <button
                onClick={() => {
                  if (loopA === null) {
                    setLoopA(currentTime);
                    showToast(`Loop A set: ${formatTime(currentTime)}`);
                  } else if (loopB === null && currentTime > loopA) {
                    setLoopB(currentTime);
                    showToast(`Loop B set: ${formatTime(currentTime)}`);
                  } else {
                    setLoopA(null);
                    setLoopB(null);
                    showToast('Loop cleared');
                  }
                }}
                className={`px-2 py-1 text-xs rounded-lg border font-mono transition-colors ${
                  loopA !== null && loopB !== null
                    ? 'bg-amber-950/50 text-amber-300 border-amber-600/50'
                    : loopA !== null
                    ? 'bg-zinc-800 text-amber-400 border-zinc-700'
                    : 'text-zinc-400 border-zinc-800 hover:text-zinc-200 hover:bg-zinc-800'
                }`}
                title="A-B Repeat Segment"
              >
                {loopA === null ? 'A-B' : loopB === null ? 'Set B' : 'A⇄B'}
              </button>
            </div>

            {/* Subtitles Menu */}
            {currentMedia.isVideo && (
              <div className="relative">
                <input
                  type="file"
                  ref={subFileInputRef}
                  accept=".srt,.vtt,.sub"
                  onChange={handleSubtitleFileSelect}
                  className="hidden"
                />
                <button
                  onClick={() => {
                    setShowSubMenu(!showSubMenu);
                    setShowSpeedMenu(false);
                    setShowAspectMenu(false);
                  }}
                  className={`p-2 rounded-lg transition-colors ${
                    selectedSubTrackId
                      ? 'bg-sky-950/60 text-sky-400 border border-sky-600/40'
                      : 'text-zinc-300 hover:text-white hover:bg-zinc-800'
                  }`}
                  title="Subtitles & Closed Captions"
                >
                  <Subtitles className="w-4 h-4" />
                </button>

                {showSubMenu && (
                  <div className="absolute right-0 bottom-full mb-2 w-64 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-3 z-40 backdrop-blur-md space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                      <span className="text-xs font-semibold text-white">Subtitles</span>
                      <button
                        onClick={() => subFileInputRef.current?.click()}
                        className="text-[11px] text-sky-400 hover:text-sky-300 underline font-medium"
                      >
                        + Load .SRT / .VTT
                      </button>
                    </div>

                    <div className="space-y-1">
                      <button
                        onClick={() => {
                          setSelectedSubTrackId(null);
                          setShowSubMenu(false);
                        }}
                        className={`w-full px-2.5 py-1.5 text-xs text-left rounded-lg transition-colors ${
                          !selectedSubTrackId
                            ? 'bg-zinc-800 text-sky-400 font-semibold'
                            : 'text-zinc-300 hover:bg-zinc-800/60'
                        }`}
                      >
                        Off
                      </button>
                      {subtitleTracks.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => {
                            setSelectedSubTrackId(t.id);
                            setShowSubMenu(false);
                          }}
                          className={`w-full px-2.5 py-1.5 text-xs text-left rounded-lg transition-colors truncate ${
                            selectedSubTrackId === t.id
                              ? 'bg-zinc-800 text-sky-400 font-semibold'
                              : 'text-zinc-300 hover:bg-zinc-800/60'
                          }`}
                        >
                          {t.name}
                        </button>
                      ))}
                    </div>

                    {selectedSubTrackId && (
                      <div className="pt-2 border-t border-zinc-800 space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-zinc-400">Sync Offset</span>
                          <span className="font-mono text-sky-400">
                            {subtitleDelay > 0 ? `+${subtitleDelay}` : subtitleDelay}s
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setSubtitleDelay((d) => Number((d - 0.5).toFixed(1)))}
                            className="flex-1 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                          >
                            -0.5s
                          </button>
                          <button
                            onClick={() => setSubtitleDelay((d) => Number((d + 0.5).toFixed(1)))}
                            className="flex-1 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                          >
                            +0.5s
                          </button>
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <span className="text-zinc-400">Font Size</span>
                          <div className="flex gap-1">
                            {[16, 20, 24].map((sz) => (
                              <button
                                key={sz}
                                onClick={() => setSubFontSize(sz)}
                                className={`px-2 py-0.5 rounded text-[11px] ${
                                  subFontSize === sz
                                    ? 'bg-sky-500 text-zinc-950 font-bold'
                                    : 'bg-zinc-800 text-zinc-400'
                                }`}
                              >
                                {sz}px
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Playback Speed Menu */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowSpeedMenu(!showSpeedMenu);
                  setShowAspectMenu(false);
                  setShowSubMenu(false);
                }}
                className="px-2 py-1 text-xs text-zinc-300 hover:text-white rounded-lg hover:bg-zinc-800 font-mono transition-colors"
                title="Playback Speed ([ / ])"
              >
                {playbackSpeed}x
              </button>

              {showSpeedMenu && (
                <div className="absolute right-0 bottom-full mb-2 w-32 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl py-1 z-40 backdrop-blur-md">
                  {[0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0].map((s) => (
                    <button
                      key={s}
                      onClick={() => changeSpeed(s)}
                      className={`w-full px-3 py-1.5 text-xs text-left font-mono transition-colors ${
                        playbackSpeed === s
                          ? 'text-sky-400 font-semibold bg-sky-950/40'
                          : 'text-zinc-300 hover:bg-zinc-800'
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Audio & Video Equalizer / Effects */}
            <button
              onClick={onOpenEffects}
              className="p-2 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
              title="Color Grading & Audio Equalizer"
            >
              <Sliders className="w-4 h-4 text-sky-400" />
            </button>

            {/* Bookmarks Drawer button */}
            <button
              onClick={onOpenBookmarks}
              className="p-2 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors relative"
              title="Bookmarks & Keyframes (B)"
            >
              <Bookmark className="w-4 h-4" />
              {currentMedia.bookmarks.length > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-sky-400" />
              )}
            </button>

            {/* Picture in Picture */}
            {currentMedia.isVideo && (
              <button
                onClick={togglePiP}
                className="p-2 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
                title="Picture-in-Picture"
              >
                <PictureInPicture2 className="w-4 h-4" />
              </button>
            )}

            {/* Fullscreen Button */}
            <button
              onClick={toggleFullscreen}
              className="p-2 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
              title="Fullscreen (F)"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Floating Video Call Strip */}
      {callStrip}
    </div>
  );
};

export const VideoPlayer = React.memo(VideoPlayerComponent);
