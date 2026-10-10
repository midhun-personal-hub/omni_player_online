import React from 'react';
import { MessageSquare, Video, LogOut } from 'lucide-react';

export interface RoomBarProps {
  roomCode: string;
  isChatOpen?: boolean;
  onToggleChat?: () => void;
  unreadCount?: number;
  inCall?: boolean;
  incomingCall?: { active: boolean; name: string } | null;
  onStartCall?: () => void;
  onLeave?: () => void;
  className?: string;
}

export const RoomBar: React.FC<RoomBarProps> = ({
  roomCode,
  isChatOpen,
  onToggleChat,
  unreadCount = 0,
  inCall = false,
  incomingCall,
  onStartCall,
  onLeave,
  className = '',
}) => {
  return (
    <div
      className={`flex items-center justify-between gap-2 px-3 sm:px-4 py-2 bg-zinc-950/90 border-b border-zinc-800/80 backdrop-blur-md w-full min-w-0 box-border text-zinc-100 z-20 ${className}`}
    >
      {/* Left: Room code pill */}
      <div className="flex items-center gap-2 min-w-0 shrink">
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-900/90 border border-zinc-700/60 text-xs font-medium text-zinc-200 backdrop-blur-md shadow-sm whitespace-nowrap overflow-hidden max-w-[220px] sm:max-w-xs">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
          <span className="truncate">Connected to room <span className="font-mono font-bold text-sky-400">{roomCode}</span></span>
        </div>
      </div>

      {/* Right: Room action buttons */}
      <div className="flex items-center gap-2 shrink-0 pointer-events-auto">
        {onToggleChat && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleChat();
            }}
            className={`relative flex items-center justify-center gap-1.5 w-10 h-10 sm:w-auto sm:h-9 sm:px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all backdrop-blur-md shadow-sm shrink-0 touch-manipulation ${
              isChatOpen
                ? 'bg-sky-500/20 text-sky-300 border-sky-500/50 ring-2 ring-sky-500/40'
                : 'bg-zinc-900/90 hover:bg-zinc-800 text-zinc-200 border-zinc-700/60'
            }`}
            title="Toggle Room Chat"
            aria-label="Toggle Room Chat"
          >
            <MessageSquare className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-sky-400 shrink-0" />
            <span className="hidden sm:inline">Chat</span>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full bg-sky-500 text-zinc-950 text-[10px] font-bold shadow-sm">
                {unreadCount}
              </span>
            )}
          </button>
        )}

        {!inCall && !incomingCall && onStartCall && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStartCall();
            }}
            className="flex items-center justify-center gap-1.5 w-10 h-10 sm:w-auto sm:h-9 sm:px-3 py-1.5 text-xs font-semibold rounded-lg transition-all backdrop-blur-md shadow-sm shrink-0 touch-manipulation bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40"
            title="Join Live Video Call"
            aria-label="Join call"
          >
            <Video className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0 text-emerald-400" />
            <span className="hidden sm:inline">Join Call</span>
          </button>
        )}

        {onLeave && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onLeave();
            }}
            className="flex items-center justify-center gap-1.5 w-10 h-10 sm:w-auto sm:h-9 sm:px-3 py-1.5 text-xs font-medium rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 transition-colors backdrop-blur-md shadow-sm shrink-0 touch-manipulation"
            title="Leave Watch Party"
            aria-label="Leave Watch Party"
          >
            <LogOut className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
            <span className="hidden sm:inline">Leave</span>
          </button>
        )}
      </div>
    </div>
  );
};
