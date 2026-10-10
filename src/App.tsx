/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Film,
  FolderOpen,
  FilePlus,
  ListMusic,
  Sliders,
  Keyboard,
  ShieldCheck,
  Maximize,
  Users,
  MessageSquare,
  Video,
} from 'lucide-react';
import {
  MediaItem,
  VideoFilters,
  AspectRatioMode,
  EqualizerBand,
  LoopMode,
  SubtitleTrack,
} from './types/media';
import { detectMediaType, SUBTITLE_EXTENSIONS } from './utils/formatters';
import { audioEngine, DEFAULT_EQ_BANDS, EQ_PRESETS } from './utils/audioEngine';
import { EmptyState } from './components/EmptyState';
import { VideoPlayer } from './components/VideoPlayer';
import { PlaylistDrawer } from './components/PlaylistDrawer';
import { BookmarksDrawer } from './components/BookmarksDrawer';
import { EffectsModal } from './components/EffectsModal';
import { ShortcutsModal } from './components/ShortcutsModal';
import { MediaInfoModal } from './components/MediaInfoModal';
import { ScreenshotModal } from './components/ScreenshotModal';
import { WatchTogetherModal } from './components/WatchTogetherModal';
import { GuestPlayer } from './components/GuestPlayer';
import { ChatDrawer } from './components/ChatDrawer';
import { FullscreenChatOverlay } from './components/FullscreenChatOverlay';
import { CallStrip } from './components/CallStrip';
import { useWatchParty } from './hooks/useWatchParty';

export default function App() {
  const [playlist, setPlaylist] = useState<MediaItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);

  // Settings & state
  const [aspectRatio, setAspectRatio] = useState<AspectRatioMode>('original');
  const [videoFilters, setVideoFilters] = useState<VideoFilters>({
    brightness: 100,
    contrast: 100,
    saturation: 100,
    hueRotate: 0,
    blur: 0,
    invert: false,
    sepia: false,
    flipHorizontal: false,
    flipVertical: false,
  });

  // Audio Equalizer & Boost
  const [volumeBoost, setVolumeBoost] = useState<number>(1.0);
  const [eqBands, setEqBands] = useState<EqualizerBand[]>(DEFAULT_EQ_BANDS);

  // Playback playlist modes
  const [loopMode, setLoopMode] = useState<LoopMode>('off');
  const [isShuffle, setIsShuffle] = useState<boolean>(false);

  // Drawers and Modals
  const [isPlaylistOpen, setIsPlaylistOpen] = useState(false);
  const [isBookmarksOpen, setIsBookmarksOpen] = useState(false);
  const [isEffectsOpen, setIsEffectsOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [isWatchTogetherOpen, setIsWatchTogetherOpen] = useState(false);

  // App-level Toast banner
  const [appToast, setAppToast] = useState<string | null>(null);
  const showAppToast = React.useCallback((msg: string) => {
    setAppToast(msg);
    setTimeout(() => {
      setAppToast((prev) => (prev === msg ? null : prev));
    }, 2500);
  }, []);

  // Media element and subtitle tracking for Watch Together
  const [activeMediaElement, setActiveMediaElement] = useState<HTMLMediaElement | null>(null);
  const [activeSubtitleTrack, setActiveSubtitleTrack] = useState<SubtitleTrack | null>(null);

  // Screenshot modal
  const [screenshotData, setScreenshotData] = useState<{
    isOpen: boolean;
    imageUrl: string | null;
    time: number;
  }>({
    isOpen: false,
    imageUrl: null,
    time: 0,
  });

  // Hidden inputs for header buttons
  const headerFileInputRef = useRef<HTMLInputElement | null>(null);
  const headerFolderInputRef = useRef<HTMLInputElement | null>(null);

  // Helper to load files into playlist
  const handleAddFiles = (files: FileList | File[]) => {
    const fileList = Array.from(files);
    const newItems: MediaItem[] = [];

    fileList.forEach((file) => {
      const { isVideo, isAudio, extension } = detectMediaType(file.name, file.type);
      // Skip subtitle files from playlist; they are handled separately
      if (SUBTITLE_EXTENSIONS.has(extension)) return;

      const url = URL.createObjectURL(file);
      newItems.push({
        id: `media-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        file,
        name: file.name,
        url,
        size: file.size,
        type: file.type,
        extension,
        isVideo,
        isAudio,
        bookmarks: [],
      });
    });

    if (newItems.length > 0) {
      setPlaylist((prev) => {
        const nextList = [...prev, ...newItems];
        // If nothing was playing, play first new track
        if (prev.length === 0) {
          setCurrentIndex(0);
        }
        return nextList;
      });
    }
  };

  // Add individual media item (e.g. from demo generator)
  const handleLoadMediaItem = (item: MediaItem) => {
    setPlaylist((prev) => {
      const nextList = [item, ...prev];
      setCurrentIndex(0);
      return nextList;
    });
  };

  // Switch Track
  const handleSelectTrack = (index: number) => {
    if (index >= 0 && index < playlist.length) {
      setCurrentIndex(index);
    }
  };

  // Previous & Next navigation
  const handlePreviousTrack = () => {
    if (playlist.length === 0) return;
    if (isShuffle) {
      const rand = Math.floor(Math.random() * playlist.length);
      setCurrentIndex(rand);
    } else {
      setCurrentIndex((prev) => (prev > 0 ? prev - 1 : playlist.length - 1));
    }
  };

  const handleNextTrack = () => {
    if (playlist.length === 0) return;
    if (loopMode === 'one') {
      // Loop same track
      return;
    }
    if (isShuffle) {
      const rand = Math.floor(Math.random() * playlist.length);
      setCurrentIndex(rand);
    } else {
      if (currentIndex < playlist.length - 1) {
        setCurrentIndex((prev) => prev + 1);
      } else if (loopMode === 'all') {
        setCurrentIndex(0);
      }
    }
  };

  // Remove track
  const handleRemoveTrack = (id: string) => {
    setPlaylist((prev) => {
      const itemIdx = prev.findIndex((p) => p.id === id);
      const updated = prev.filter((p) => p.id !== id);
      if (itemIdx === currentIndex && updated.length > 0) {
        setCurrentIndex(Math.min(currentIndex, updated.length - 1));
      }
      return updated;
    });
  };

  // Clear playlist
  const handleClearPlaylist = () => {
    setPlaylist([]);
    setCurrentIndex(0);
  };

  // Toggle loop mode
  const handleToggleLoop = () => {
    setLoopMode((prev) => {
      if (prev === 'off') return 'all';
      if (prev === 'all') return 'one';
      return 'off';
    });
  };

  // Audio Equalizer handlers
  const handleBandChange = (index: number, gain: number) => {
    setEqBands((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], gain };
      return next;
    });
    audioEngine.setBandGain(index, gain);
  };

  const handleApplyEqPreset = (presetKey: string) => {
    const presetValues = EQ_PRESETS[presetKey] || EQ_PRESETS.flat;
    setEqBands((prev) =>
      prev.map((band, idx) => ({
        ...band,
        gain: presetValues[idx] || 0,
      }))
    );
    audioEngine.applyPreset(presetValues);
  };

  const handleVolumeBoostChange = (boost: number) => {
    setVolumeBoost(boost);
    audioEngine.setBoost(boost);
  };

  // Bookmarks handlers for currently playing media
  const currentMedia = playlist[currentIndex] || null;

  // Watch Together party hook
  const {
    role: watchRole,
    roomCode: watchRoomCode,
    status: watchStatus,
    errorMessage: watchErrorMessage,
    viewerCount: watchViewerCount,
    incomingStream: watchIncomingStream,
    isReconnecting: watchIsReconnecting,
    hostState: watchHostState,
    guestSubtitleTrack: watchGuestSubtitleTrack,
    allowGuestControl: watchAllowGuestControl,
    setAllowGuestControl: setWatchAllowGuestControl,
    createRoom: watchCreateRoom,
    joinRoom: watchJoinRoom,
    leaveRoom: watchLeaveRoom,
    sendGuestControl: watchSendGuestControl,
    messages: watchMessages,
    sendChat: watchSendChat,
    unreadCount: watchUnreadCount,
    isChatOpen: watchIsChatOpen,
    setChatOpen: setWatchChatOpen,
    chatError: watchChatError,
    soundEnabled: watchSoundEnabled,
    setSoundEnabled: setWatchSoundEnabled,
    rename: watchRename,
    myId: watchMyId,
    // Video Call additions
    localStream: watchLocalStream,
    remoteStreams: watchRemoteStreams,
    camEnabled: watchCamEnabled,
    micEnabled: watchMicEnabled,
    toggleCam: watchToggleCam,
    toggleMic: watchToggleMic,
    startCall: watchStartCall,
    endCall: watchEndCall,
    inCall: watchInCall,
    devices: watchDevices,
    selectDevice: watchSelectDevice,
    callQuality: watchCallQuality,
    setCallQuality: watchSetCallQuality,
    isDuckingEnabled: watchIsDuckingEnabled,
    setDuckingEnabled: watchSetDuckingEnabled,
    bandwidthSaver: watchBandwidthSaver,
    toggleBandwidthSaver: watchToggleBandwidthSaver,
    hostStutterWarning: watchHostStutterWarning,
    dismissStutterWarning: watchDismissStutterWarning,
    turnOffCamerasForBandwidth: watchTurnOffCamerasForBandwidth,
    volumeDuckingMultiplier: watchVolumeDuckingMultiplier,
  } = useWatchParty({
    mediaElement: activeMediaElement,
    currentMediaUrl: currentMedia?.url,
    mediaTitle: currentMedia?.name,
    isAudio: currentMedia?.isAudio,
    activeSubtitleTrack,
    onToast: showAppToast,
  });

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isFullscreenChatInputOpen, setIsFullscreenChatInputOpen] = useState(false);

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const callStripElement =
    watchRole !== null && watchInCall ? (
      <CallStrip
        localStream={watchLocalStream}
        remoteStreams={watchRemoteStreams}
        camEnabled={watchCamEnabled}
        micEnabled={watchMicEnabled}
        onToggleCam={watchToggleCam}
        onToggleMic={watchToggleMic}
        onEndCall={watchEndCall}
        myName={watchRole === 'host' ? 'Host' : 'Guest'}
        devices={watchDevices}
        onSelectDevice={watchSelectDevice}
        quality={watchCallQuality}
        onSetQuality={watchSetCallQuality}
        isDuckingEnabled={watchIsDuckingEnabled}
        onSetDuckingEnabled={watchSetDuckingEnabled}
        bandwidthSaver={watchBandwidthSaver}
        onToggleBandwidthSaver={watchToggleBandwidthSaver}
        hostStutterWarning={watchHostStutterWarning}
        onDismissStutterWarning={watchDismissStutterWarning}
        onTurnOffCamerasForBandwidth={watchTurnOffCamerasForBandwidth}
      />
    ) : null;

  const handleOpenEffects = React.useCallback(() => setIsEffectsOpen(true), []);
  const handleOpenInfo = React.useCallback(() => setIsInfoOpen(true), []);
  const handleOpenBookmarks = React.useCallback(() => setIsBookmarksOpen(true), []);
  const handleOpenShortcuts = React.useCallback(() => setIsShortcutsOpen(true), []);
  const handleCaptureScreenshot = React.useCallback((dataUrl: string, time: number) => {
    setScreenshotData({
      isOpen: true,
      imageUrl: dataUrl,
      time,
    });
  }, []);

  const handleAddBookmark = (time: number, label: string) => {
    if (!currentMedia) return;
    const newBm = {
      id: `bm-${Date.now()}`,
      time,
      label,
      createdAt: Date.now(),
    };
    setPlaylist((prev) =>
      prev.map((item, idx) =>
        idx === currentIndex
          ? { ...item, bookmarks: [...item.bookmarks, newBm] }
          : item
      )
    );
  };

  const handleDeleteBookmark = (id: string) => {
    if (!currentMedia) return;
    setPlaylist((prev) =>
      prev.map((item, idx) =>
        idx === currentIndex
          ? { ...item, bookmarks: item.bookmarks.filter((b) => b.id !== id) }
          : item
      )
    );
  };

  const handleSeekToBookmark = (time: number) => {
    const video = document.querySelector('video, audio') as HTMLMediaElement | null;
    if (video) {
      video.currentTime = time;
    }
  };

  // Global Drag & Drop Handler
  useEffect(() => {
    const handleWindowDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleWindowDrop = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        handleAddFiles(e.dataTransfer.files);
      }
    };

    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('drop', handleWindowDrop);

    return () => {
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('drop', handleWindowDrop);
    };
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen bg-zinc-950 text-zinc-100 overflow-hidden font-sans">
      {/* Top Application Header */}
      <header className="h-14 border-b border-zinc-800/80 bg-zinc-900/95 px-4 flex items-center justify-between z-30 shrink-0 backdrop-blur-md">
        {/* Brand & Status */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
              <Film className="w-4 h-4" />
            </div>
            <span className="font-bold text-sm tracking-wide text-white">OmniPlay</span>
          </div>
          {watchRole === 'host' ? (
            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
              <span>LIVE · {watchViewerCount} {watchViewerCount === 1 ? 'viewer' : 'viewers'}</span>
            </div>
          ) : (
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-zinc-800/80 border border-zinc-700/50 text-[11px] text-zinc-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>Direct Local Playback</span>
            </div>
          )}
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2">
          {/* Watch Together */}
          <button
            onClick={() => setIsWatchTogetherOpen(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              watchRole === 'host'
                ? 'bg-rose-950/60 text-rose-300 border-rose-600/50 shadow-xs'
                : watchRole === 'guest'
                ? 'bg-sky-950/60 text-sky-300 border-sky-600/50 shadow-xs'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700/60'
            }`}
            title="Watch Together with friends"
          >
            <Users className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">Watch Together</span>
            {watchRole === 'host' && (
              <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[10px] font-bold">
                {watchViewerCount}
              </span>
            )}
          </button>

          {/* Room Chat Button (only visible when a watch party is active) */}
          {watchRole !== null && (
            <button
              onClick={() => setWatchChatOpen(!watchIsChatOpen)}
              className={`relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors shadow-xs ${
                watchIsChatOpen
                  ? 'bg-sky-950/70 text-sky-300 border-sky-600/50'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700/60'
              }`}
              title="Toggle Room Chat"
            >
              <MessageSquare className="w-3.5 h-3.5 text-sky-400" />
              <span className="hidden sm:inline">Chat</span>
              {watchUnreadCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-sky-500 text-zinc-950 text-[10px] font-bold">
                  {watchUnreadCount}
                </span>
              )}
            </button>
          )}

          {/* Video Call Button (only visible when in watch party and not already in call) */}
          {watchRole !== null && !watchInCall && (
            <button
              onClick={watchStartCall}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 transition-colors shadow-xs"
              title="Join Live Video & Voice Call"
            >
              <Video className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Join Call</span>
            </button>
          )}

          {/* Open Files */}
          <input
            type="file"
            ref={headerFileInputRef}
            multiple
            accept="video/*,audio/*,.mkv,.avi,.flv,.wmv,.mov,.ts,.3gp,.opus,.weba,.m4v"
            onChange={(e) => {
              if (e.target.files) handleAddFiles(e.target.files);
              e.target.value = '';
            }}
            className="hidden"
          />
          <button
            onClick={() => headerFileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/60 transition-colors shadow-xs"
            title="Open local files"
          >
            <FilePlus className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">Choose Files</span>
          </button>

          {/* Open Folder */}
          <input
            type="file"
            ref={headerFolderInputRef}
            // @ts-expect-error webkitdirectory is standard for directory picker
            webkitdirectory="true"
            directory="true"
            onChange={(e) => {
              if (e.target.files) handleAddFiles(e.target.files);
              e.target.value = '';
            }}
            className="hidden"
          />
          <button
            onClick={() => headerFolderInputRef.current?.click()}
            className="hidden md:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/60 transition-colors"
            title="Import folder"
          >
            <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
            <span>Folder</span>
          </button>

          {/* Effects & EQ */}
          <button
            onClick={() => setIsEffectsOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/60 transition-colors"
            title="Audio Equalizer & Video Filters"
          >
            <Sliders className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden lg:inline">Audio & FX</span>
          </button>

          {/* Queue / Playlist Drawer Trigger */}
          <button
            onClick={() => setIsPlaylistOpen(!isPlaylistOpen)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              isPlaylistOpen
                ? 'bg-sky-950/60 text-sky-300 border-sky-600/50'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700/60'
            }`}
            title="Toggle Queue"
          >
            <ListMusic className="w-3.5 h-3.5 text-sky-400" />
            <span>Queue</span>
            {playlist.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-sky-500 text-zinc-950 text-[10px] font-bold">
                {playlist.length}
              </span>
            )}
          </button>

          {/* Keyboard Shortcuts Trigger */}
          <button
            onClick={() => setIsShortcutsOpen(true)}
            className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
            title="Keyboard Shortcuts (?)"
          >
            <Keyboard className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Player Display Area */}
      <main className="flex-1 relative flex items-center justify-center bg-black overflow-hidden">
        {watchRole === 'guest' ? (
          <GuestPlayer
            roomCode={watchRoomCode || ''}
            incomingStream={watchIncomingStream}
            isReconnecting={watchIsReconnecting}
            hostState={watchHostState}
            guestSubtitleTrack={watchGuestSubtitleTrack}
            onSendControl={watchSendGuestControl}
            onLeave={watchLeaveRoom}
            statusMessage={
              watchStatus === 'closed'
                ? watchErrorMessage || 'Host ended the watch party.'
                : null
            }
            isChatOpen={watchIsChatOpen}
            onToggleChat={() => setWatchChatOpen(!watchIsChatOpen)}
            unreadCount={watchUnreadCount}
            inCall={watchInCall}
            onStartCall={watchStartCall}
            duckingMultiplier={watchVolumeDuckingMultiplier}
            callStrip={callStripElement}
          />
        ) : playlist.length === 0 || !currentMedia ? (
          <EmptyState
            onAddFiles={handleAddFiles}
            onLoadMediaItem={handleLoadMediaItem}
          />
        ) : (
          <VideoPlayer
            currentMedia={currentMedia}
            videoFilters={videoFilters}
            aspectRatio={aspectRatio}
            onAspectRatioChange={setAspectRatio}
            onOpenEffects={handleOpenEffects}
            onOpenInfo={handleOpenInfo}
            onOpenBookmarks={handleOpenBookmarks}
            onAddBookmark={handleAddBookmark}
            onOpenShortcuts={handleOpenShortcuts}
            onPreviousTrack={handlePreviousTrack}
            onNextTrack={handleNextTrack}
            hasPrevious={playlist.length > 1}
            hasNext={playlist.length > 1}
            volumeBoost={volumeBoost}
            onMediaElementReady={setActiveMediaElement}
            onSubtitleTrackChange={setActiveSubtitleTrack}
            onCaptureScreenshot={handleCaptureScreenshot}
            duckingMultiplier={watchVolumeDuckingMultiplier}
            callStrip={callStripElement}
          />
        )}
      </main>

      {/* Slide-out Drawers & Modals */}
      <PlaylistDrawer
        isOpen={isPlaylistOpen}
        onClose={() => setIsPlaylistOpen(false)}
        playlist={playlist}
        currentIndex={currentIndex}
        onSelectTrack={handleSelectTrack}
        onRemoveTrack={handleRemoveTrack}
        onClearPlaylist={handleClearPlaylist}
        onAddFiles={handleAddFiles}
        loopMode={loopMode}
        onToggleLoop={handleToggleLoop}
        isShuffle={isShuffle}
        onToggleShuffle={() => setIsShuffle(!isShuffle)}
      />

      <BookmarksDrawer
        isOpen={isBookmarksOpen}
        onClose={() => setIsBookmarksOpen(false)}
        bookmarks={currentMedia?.bookmarks || []}
        currentTime={
          (document.querySelector('video, audio') as HTMLMediaElement | null)?.currentTime || 0
        }
        onAddBookmark={handleAddBookmark}
        onDeleteBookmark={handleDeleteBookmark}
        onSeekTo={handleSeekToBookmark}
      />

      <EffectsModal
        isOpen={isEffectsOpen}
        onClose={() => setIsEffectsOpen(false)}
        filters={videoFilters}
        onFiltersChange={setVideoFilters}
        bands={eqBands}
        onBandChange={handleBandChange}
        onApplyEqPreset={handleApplyEqPreset}
        volumeBoost={volumeBoost}
        onVolumeBoostChange={handleVolumeBoostChange}
        isVideo={currentMedia?.isVideo ?? true}
      />

      <ShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />

      <MediaInfoModal
        isOpen={isInfoOpen}
        onClose={() => setIsInfoOpen(false)}
        item={currentMedia}
      />

      <ScreenshotModal
        isOpen={screenshotData.isOpen}
        onClose={() => setScreenshotData({ isOpen: false, imageUrl: null, time: 0 })}
        imageUrl={screenshotData.imageUrl}
        videoTitle={currentMedia?.name || 'Video'}
        timestamp={screenshotData.time}
      />

      {/* Watch Together Room Modal */}
      <WatchTogetherModal
        isOpen={isWatchTogetherOpen}
        onClose={() => setIsWatchTogetherOpen(false)}
        role={watchRole}
        roomCode={watchRoomCode}
        status={watchStatus}
        errorMessage={watchErrorMessage}
        viewerCount={watchViewerCount}
        allowGuestControl={watchAllowGuestControl}
        onToggleGuestControl={setWatchAllowGuestControl}
        onCreateRoom={watchCreateRoom}
        onJoinRoom={watchJoinRoom}
        onLeaveRoom={watchLeaveRoom}
        onShowToast={showAppToast}
        hasLoadedMedia={!!currentMedia}
        onRename={watchRename}
      />

      {/* Real-time Watch Together Room Chat Drawer */}
      {watchRole !== null && (
        <ChatDrawer
          isOpen={watchIsChatOpen}
          onClose={() => setWatchChatOpen(false)}
          messages={watchMessages}
          onSendMessage={watchSendChat}
          myId={watchMyId}
          participantCount={watchViewerCount + 1}
          chatError={watchChatError}
          isConnected={watchStatus === 'connected' || watchStatus === 'waiting'}
          soundEnabled={watchSoundEnabled}
          onToggleSound={setWatchSoundEnabled}
        />
      )}

      {/* Fullscreen Chat Overlay for Live Transient Messages */}
      {watchRole !== null && isFullscreen && (
        <FullscreenChatOverlay
          messages={watchMessages}
          onSendMessage={watchSendChat}
          isInputOpen={isFullscreenChatInputOpen}
          onToggleInput={setIsFullscreenChatInputOpen}
          myId={watchMyId}
        />
      )}

      {/* App-level Toast Notification */}
      {appToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-zinc-900/95 text-zinc-100 text-xs font-semibold rounded-full border border-zinc-700/80 shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-150 flex items-center gap-2">
          <span>{appToast}</span>
        </div>
      )}
    </div>
  );
}
