import React from 'react';
import { MessageSquare, Video, LogOut } from 'lucide-react';

interface RoomControlsProps {
  roomCode?: string;
  role: 'host' | 'guest' | null;
  viewerCount?: number;
  isChatOpen: boolean;
  onToggleChat: () => void;
  unreadCount: number;
  inCall: boolean;
  incomingCall?: { active: boolean; name: string } | null;
  onStartCall: () => void;
  onLeave: () => void;
  className?: string;
}

export const RoomControls: React.FC<RoomControlsProps> = ({
  roomCode,
  role,
  viewerCount = 0,
  isChatOpen,
  onToggleChat,
  unreadCount,
  inCall,
  incomingCall,
  onStartCall,
  onLeave,
  className = '',
}) => {
  if (!roomCode && role === null) return null;

  return (
    <div className={`flex items-center gap-2 shrink-0 min-w-0 ${className}`}>
      {/* Room Status Pill */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-900/90 border border-zinc-700/60 text-xs font-medium text-zinc-200 backdrop-blur-md shadow-lg whitespace-nowrap overflow-hidden">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
        <span className="truncate">
          {role === 'host' ? `LIVE · ${viewerCount} viewers` : `Room `}
          <span className="font-mono font-bold text-sky-400">{roomCode}</span>
        </span>
      </div>

      {/* Chat Button */}
      {onToggleChat && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleChat();
          }}
          className={`relative flex items-center justify-center w-10 h-10 sm:w-auto sm:h-10 sm:px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all backdrop-blur-md shadow-sm shrink-0 touch-manipulation ${
            isChatOpen
              ? 'bg-sky-500/20 text-sky-300 border-sky-500/50 ring-2 ring-sky-500/40'
              : 'bg-zinc-900/90 hover:bg-zinc-800 text-zinc-200 border-zinc-700/60'
          }`}
          title="Toggle Room Chat"
          aria-label="Toggle Room Chat"
        >
          <MessageSquare className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-sky-400 shrink-0" />
          <span className="hidden sm:inline ml-1.5">Chat</span>
          {typeof unreadCount === 'number' && unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full bg-sky-500 text-zinc-950 text-[10px] font-bold shadow-sm">
              {unreadCount}
            </span>
          )}
        </button>
      )}

      {/* Call Action Button */}
      {onStartCall && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (!inCall) onStartCall();
          }}
          className={`flex items-center justify-center w-10 h-10 sm:w-auto sm:h-10 sm:px-3 py-1.5 text-xs font-semibold rounded-lg transition-all backdrop-blur-md shadow-sm shrink-0 touch-manipulation ${
            inCall
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 cursor-default'
              : incomingCall
              ? 'bg-emerald-500 text-zinc-950 border border-emerald-400 ring-2 ring-emerald-400/60 animate-pulse'
              : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40'
          }`}
          title={
            inCall
              ? 'Currently in video call'
              : incomingCall
              ? `${incomingCall.name} started a call! Click to join`
              : 'Join Live Video Call'
          }
          aria-label={inCall ? 'In call' : incomingCall ? 'Join incoming call' : 'Join call'}
        >
          <Video
            className={`w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0 ${incomingCall && !inCall ? 'text-zinc-950' : 'text-emerald-400'}`}
          />
          <span className="hidden sm:inline ml-1.5">
            {inCall ? 'In Call' : incomingCall ? 'Join Call' : 'Join Call'}
          </span>
        </button>
      )}

      {/* Leave Button */}
      {onLeave && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onLeave();
          }}
          className="flex items-center justify-center w-10 h-10 sm:w-auto sm:h-10 sm:px-3 py-1.5 text-xs font-medium rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 transition-colors backdrop-blur-md shadow-sm shrink-0 touch-manipulation"
          title="Leave Watch Party"
          aria-label="Leave Watch Party"
        >
          <LogOut className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
          <span className="hidden sm:inline ml-1.5">Leave</span>
        </button>
      )}
    </div>
  );
};
