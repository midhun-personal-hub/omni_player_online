import React, { useState, useEffect } from 'react';
import {
  X,
  Users,
  Copy,
  Check,
  Radio,
  AlertTriangle,
  PlaySquare,
  LogIn,
  Sliders,
  LogOut,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import { WatchPartyRole, WatchPartyStatus, MovieQuality } from '../utils/watchParty';

interface WatchTogetherModalProps {
  isOpen: boolean;
  onClose: () => void;
  role: WatchPartyRole;
  roomCode: string | null;
  status: WatchPartyStatus;
  errorMessage: string | null;
  viewerCount: number;
  allowGuestControl: boolean;
  onToggleGuestControl: (allowed: boolean) => void;
  onCreateRoom: () => Promise<string>;
  onJoinRoom: (code: string, displayName?: string) => Promise<void>;
  onLeaveRoom: () => void;
  onShowToast: (msg: string) => void;
  hasLoadedMedia: boolean;
  onRename?: (newName: string) => void;
  movieQuality?: MovieQuality;
  onChangeMovieQuality?: (quality: MovieQuality) => void;
}

export const WatchTogetherModal: React.FC<WatchTogetherModalProps> = ({
  isOpen,
  onClose,
  role,
  roomCode,
  status,
  errorMessage,
  viewerCount,
  allowGuestControl,
  onToggleGuestControl,
  onCreateRoom,
  onJoinRoom,
  onLeaveRoom,
  onShowToast,
  hasLoadedMedia,
  onRename,
  movieQuality = '720p',
  onChangeMovieQuality,
}) => {
  const [activeTab, setActiveTab] = useState<'create' | 'join'>(
    role === 'guest' ? 'join' : 'create'
  );
  const [inputCode, setInputCode] = useState<string>('');
  const [displayName, setDisplayName] = useState<string>(() => {
    try {
      return localStorage.getItem('omniplay-chat-name') || '';
    } catch {
      return '';
    }
  });
  const [copied, setCopied] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Check captureStream support
  const isCaptureSupported =
    typeof HTMLMediaElement !== 'undefined' &&
    ('captureStream' in HTMLMediaElement.prototype ||
      'mozCaptureStream' in HTMLMediaElement.prototype);

  // Sync tab with active role
  useEffect(() => {
    if (role === 'guest') {
      setActiveTab('join');
    } else if (role === 'host') {
      setActiveTab('create');
    }
  }, [role]);

  // Reset errors when opening or switching tabs
  useEffect(() => {
    if (isOpen) {
      setLocalError(null);
      setIsSubmitting(false);
    }
  }, [isOpen, activeTab]);

  // Escape key closes modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCopyCode = async () => {
    if (!roomCode) return;
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      onShowToast('Code copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onShowToast('Code copied');
    }
  };

  const handleStartHost = async () => {
    setIsSubmitting(true);
    setLocalError(null);
    try {
      if (displayName.trim()) {
        try {
          localStorage.setItem('omniplay-chat-name', displayName.trim());
        } catch {}
        onRename?.(displayName.trim());
      }
      await onCreateRoom();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to start room';
      setLocalError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = inputCode.trim().toUpperCase();
    if (cleanCode.length !== 6) {
      setLocalError('Please enter a valid 6-character room code.');
      return;
    }

    setIsSubmitting(true);
    setLocalError(null);
    try {
      if (displayName.trim()) {
        try {
          localStorage.setItem('omniplay-chat-name', displayName.trim());
        } catch {}
      }
      await onJoinRoom(cleanCode, displayName.trim());
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to join room';
      setLocalError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-semibold text-white">Watch Together</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switch (only if not currently active host/guest) */}
        {role === null && (
          <div className="px-6 pt-3 pb-1 border-b border-zinc-800/80 flex gap-2">
            <button
              onClick={() => setActiveTab('create')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-lg transition-colors ${
                activeTab === 'create'
                  ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700/60'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Radio className="w-3.5 h-3.5 text-sky-400" />
              <span>Create Room</span>
            </button>
            <button
              onClick={() => setActiveTab('join')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-lg transition-colors ${
                activeTab === 'join'
                  ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700/60'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <LogIn className="w-3.5 h-3.5 text-sky-400" />
              <span>Join Room</span>
            </button>
          </div>
        )}

        {/* Content Body */}
        <div className="p-6 space-y-4 overflow-y-auto">
          {/* Display Name Input */}
          <div className="p-3 rounded-xl bg-zinc-950/70 border border-zinc-800 space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-zinc-300 block">
                Your Display Name
              </label>
              <span className="text-[10px] text-zinc-500 font-mono">
                {displayName.length}/20
              </span>
            </div>
            <input
              type="text"
              maxLength={20}
              value={displayName}
              onChange={(e) => {
                const val = e.target.value.slice(0, 20);
                setDisplayName(val);
                try {
                  localStorage.setItem('omniplay-chat-name', val.trim());
                } catch {}
                if (role !== null && val.trim()) {
                  onRename?.(val.trim());
                }
              }}
              placeholder={role === 'host' ? 'Host' : 'Guest'}
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700/60 rounded-lg text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-sky-500 transition-colors"
            />
          </div>

          {/* Error Banner */}
          {(localError || errorMessage) && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{localError || errorMessage}</span>
            </div>
          )}

          {/* CREATE TAB */}
          {activeTab === 'create' && (
            <div className="space-y-4">
              {/* Safari / CaptureStream warning */}
              {!isCaptureSupported && (
                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-950/40 border border-amber-800/60 text-xs text-amber-300">
                  <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    Your browser lacks direct media capture support. Please use Chrome or Edge to host.
                  </span>
                </div>
              )}

              {/* No media warning */}
              {!hasLoadedMedia && role !== 'host' && (
                <div className="p-3 rounded-xl bg-zinc-800/50 border border-zinc-700/40 text-xs text-zinc-400">
                  Tip: Open a movie or audio file first so your friends can immediately watch your stream!
                </div>
              )}

              {role === 'host' && roomCode ? (
                /* Active Host Room View */
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800 flex flex-col items-center justify-center text-center">
                    <span className="text-xs uppercase font-medium text-zinc-400 tracking-wider">
                      Your Room Code
                    </span>
                    <div className="mt-2 flex items-center gap-3">
                      <span className="text-3xl font-mono font-bold tracking-widest text-sky-400 select-all">
                        {roomCode}
                      </span>
                      <button
                        onClick={handleCopyCode}
                        className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/60 transition-colors shadow-xs"
                        title="Copy code"
                      >
                        {copied ? (
                          <Check className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Copy className="w-4 h-4 text-zinc-300" />
                        )}
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-zinc-400">
                      Share this code with your friends. They do not need your movie file.
                    </p>
                  </div>

                  {/* Room Stats */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-3 rounded-xl bg-zinc-800/40 border border-zinc-800 flex items-center justify-between">
                      <span className="text-zinc-400">Status</span>
                      <span className="flex items-center gap-1.5 font-medium text-emerald-400">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        {viewerCount > 0 ? 'Broadcasting' : 'Waiting for guests'}
                      </span>
                    </div>
                    <div className="p-3 rounded-xl bg-zinc-800/40 border border-zinc-800 flex items-center justify-between">
                      <span className="text-zinc-400">Viewers</span>
                      <span className="font-semibold text-white">
                        {viewerCount} / 3 max
                      </span>
                    </div>
                  </div>

                  {/* Host Setting: Allow viewers to control playback */}
                  <div className="p-3 rounded-xl bg-zinc-800/40 border border-zinc-800 flex items-center justify-between">
                    <div className="space-y-0.5 pr-2">
                      <span className="text-xs font-medium text-zinc-200 block">
                        Allow viewers to control playback
                      </span>
                      <span className="text-[11px] text-zinc-400 block">
                        Friends can play, pause, seek, or change speed
                      </span>
                    </div>
                    <button
                      onClick={() => onToggleGuestControl(!allowGuestControl)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        allowGuestControl ? 'bg-sky-500' : 'bg-zinc-700'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                          allowGuestControl ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Movie Stream Quality Selector */}
                  <div className="p-3 rounded-xl bg-zinc-800/40 border border-zinc-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <span className="text-xs font-medium text-zinc-200 block">
                          Stream Quality
                        </span>
                        <span className="text-[11px] text-zinc-400 block">
                          WebRTC movie bitrate to guests
                        </span>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30">
                        {movieQuality === '1080p'
                          ? '1080p ~8 Mbps'
                          : movieQuality === '720p'
                          ? '720p ~3 Mbps'
                          : 'Auto (Balanced)'}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5 pt-1">
                      {(
                        [
                          { key: 'auto', label: 'Auto', hint: 'Adaptive' },
                          { key: '720p', label: '720p', hint: '~3 Mbps' },
                          { key: '1080p', label: '1080p', hint: '~8 Mbps' },
                        ] as const
                      ).map((tier) => {
                        const isSelected = movieQuality === tier.key;
                        return (
                          <button
                            key={tier.key}
                            type="button"
                            onClick={() => onChangeMovieQuality?.(tier.key)}
                            className={`py-2 px-2 rounded-lg text-xs font-semibold flex flex-col items-center justify-center transition-all ${
                              isSelected
                                ? 'bg-sky-500 text-zinc-950 shadow-md shadow-sky-500/20'
                                : 'bg-zinc-800/80 hover:bg-zinc-800 text-zinc-300 border border-zinc-700/60'
                            }`}
                          >
                            <span>{tier.label}</span>
                            <span
                              className={`text-[9px] ${
                                isSelected ? 'text-zinc-900 font-medium' : 'text-zinc-500'
                              }`}
                            >
                              {tier.hint}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Close Room Button */}
                  <button
                    onClick={() => {
                      onLeaveRoom();
                      onClose();
                    }}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Close Room</span>
                  </button>
                </div>
              ) : (
                /* Create Room Button View */
                <div className="space-y-4">
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Host a private peer-to-peer watch party. Your media plays in real-time on your friends’
                    screens with synchronised controls, subtitles, and equalizer audio.
                  </p>

                  <button
                    onClick={handleStartHost}
                    disabled={isSubmitting}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-zinc-950 transition-colors shadow-lg shadow-sky-500/10 disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Creating room...</span>
                      </>
                    ) : (
                      <>
                        <Radio className="w-4 h-4" />
                        <span>Create Watch Room</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* JOIN TAB */}
          {activeTab === 'join' && (
            <div className="space-y-4">
              {role === 'guest' ? (
                /* Already watching room */
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800 text-center">
                    <span className="text-xs uppercase font-medium text-zinc-400 tracking-wider">
                      Currently Connected
                    </span>
                    <div className="mt-1 text-2xl font-mono font-bold tracking-widest text-sky-400">
                      ROOM {roomCode}
                    </div>
                    <p className="mt-2 text-xs text-zinc-400">
                      You are watching the host&apos;s live stream.
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      onLeaveRoom();
                      onClose();
                    }}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Leave Party</span>
                  </button>
                </div>
              ) : (
                /* Join input form */
                <form onSubmit={handleJoinSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-300 block">
                      Enter 6-character room code
                    </label>
                    <input
                      type="text"
                      maxLength={6}
                      autoFocus
                      value={inputCode}
                      onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                      placeholder="e.g. 7K2M9X"
                      className="w-full px-4 py-3 bg-zinc-950 border border-zinc-700/80 rounded-xl text-center font-mono text-xl font-bold tracking-widest text-white placeholder:text-zinc-600 focus:outline-none focus:border-sky-500 transition-colors uppercase"
                    />
                  </div>

                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    Enter the code given by your host. The stream will begin automatically without uploading or downloading any video file.
                  </p>

                  <button
                    type="submit"
                    disabled={inputCode.trim().length !== 6 || isSubmitting}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-zinc-950 transition-colors shadow-lg shadow-sky-500/10 disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Connecting to host...</span>
                      </>
                    ) : (
                      <>
                        <LogIn className="w-4 h-4" />
                        <span>Join Party</span>
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
