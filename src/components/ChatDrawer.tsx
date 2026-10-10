import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Send,
  MessageSquare,
  Volume2,
  VolumeX,
  ArrowDown,
  Users,
} from 'lucide-react';
import { ChatMessage } from '../types/chat';

interface ChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  myId?: string;
  myClientId?: string;
  participantCount: number;
  chatError: string | null;
  isConnected: boolean;
  soundEnabled: boolean;
  onToggleSound: (enabled: boolean) => void;
}

function formatChatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Safely auto-links http/https URLs into React elements without dangerouslySetInnerHTML.
 */
function renderMessageText(text: string): React.ReactNode {
  // Regex strictly matching http/https URLs
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);

  if (parts.length === 1) {
    return text;
  }

  return parts.map((part, index) => {
    if (part.match(urlRegex)) {
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="underline hover:opacity-80 break-all font-semibold"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    return part;
  });
}

export const ChatDrawer: React.FC<ChatDrawerProps> = ({
  isOpen,
  onClose,
  messages,
  onSendMessage,
  myId,
  myClientId,
  participantCount,
  chatError,
  isConnected,
  soundEnabled,
  onToggleSound,
}) => {
  const currentClientId = myClientId || myId || '';
  const [inputText, setInputText] = useState('');
  const [showScrollBottomPill, setShowScrollBottomPill] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isNearBottomRef = useRef<boolean>(true);

  // Auto-focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Handle Escape key to close drawer
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

  // Check scroll position to determine whether to auto-scroll or show "New messages ↓" pill
  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceToBottom < 60;
    isNearBottomRef.current = nearBottom;
    if (nearBottom && showScrollBottomPill) {
      setShowScrollBottomPill(false);
    }
  };

  const scrollToBottom = useCallback((smooth = true) => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      });
      setShowScrollBottomPill(false);
    }
  }, []);

  // When new messages arrive
  useEffect(() => {
    if (!isOpen) return;
    if (isNearBottomRef.current) {
      scrollToBottom(false);
    } else {
      setShowScrollBottomPill(true);
    }
  }, [messages, isOpen, scrollToBottom]);

  if (!isOpen) return null;

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed || !isConnected) return;
    onSendMessage(trimmed);
    setInputText('');
    setTimeout(() => {
      scrollToBottom(true);
    }, 50);
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:max-w-xs md:max-w-sm bg-zinc-900 border-l border-zinc-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-zinc-800 flex items-center justify-between shrink-0 bg-zinc-900/95 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-sky-400" />
          <h2 className="text-sm font-semibold text-white">Room Chat</h2>
          <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700/60 font-medium">
            <Users className="w-3 h-3 text-emerald-400" />
            <span>{participantCount}</span>
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Sound Notification Toggle */}
          <button
            onClick={() => onToggleSound(!soundEnabled)}
            className={`p-1.5 rounded-lg transition-colors ${
              soundEnabled
                ? 'text-sky-400 hover:bg-zinc-800'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
            }`}
            title={soundEnabled ? 'Mute notification sound' : 'Enable notification sound'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* Close Button */}
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
            title="Close chat (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Message List */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 p-4 overflow-y-auto space-y-3 min-h-0 relative select-text"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500 space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-zinc-800/60 border border-zinc-700/40 flex items-center justify-center text-zinc-400">
              <MessageSquare className="w-6 h-6" />
            </div>
            <p className="text-xs font-medium text-zinc-400">No messages yet.</p>
            <p className="text-[11px] text-zinc-500">Say hi to everyone in the room! 👋</p>
          </div>
        ) : (
          messages.map((msg, index) => {
            // If system message or has no senderId: treat as non-own and center like "guest joined" pill
            if (msg.kind === 'system' || !msg.senderId) {
              return (
                <div key={msg.id} className="flex justify-center my-1.5">
                  <span className="px-2.5 py-0.5 rounded-full bg-zinc-950/80 border border-zinc-800 text-[11px] text-zinc-400 font-medium text-center">
                    {msg.kind === 'system' ? msg.text : `${msg.from}: ${msg.text}`}
                  </span>
                </div>
              );
            }

            const isOwn = msg.senderId === currentClientId;
            const prevMsg = messages[index - 1];
            const isSameSender =
              prevMsg &&
              prevMsg.kind === 'user' &&
              Boolean(prevMsg.senderId) &&
              prevMsg.senderId === msg.senderId &&
              msg.ts - prevMsg.ts < 120000;

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} ${
                  isSameSender ? 'mt-1' : 'mt-2.5'
                }`}
                style={{ alignSelf: isOwn ? 'flex-end' : 'flex-start' }}
              >
                {!isOwn && !isSameSender && (
                  <div className="flex items-baseline gap-1.5 mb-1 px-1">
                    <span className="text-[11px] font-semibold text-sky-400 max-w-[160px] truncate">
                      {msg.from}
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      {formatChatTime(msg.ts)}
                    </span>
                  </div>
                )}

                <div className={`flex items-end gap-1.5 max-w-[80%] ${isOwn ? 'justify-end' : 'justify-start'}`}>
                  {isOwn && (
                    <span className="text-[10px] text-zinc-400 select-none shrink-0 mb-0.5">
                      {formatChatTime(msg.ts)}
                    </span>
                  )}
                  <div
                    className={`px-3 py-2 text-xs leading-relaxed break-words rounded-2xl shadow-sm ${
                      isOwn
                        ? 'bg-sky-500 text-zinc-950 font-medium rounded-tr-xs'
                        : 'bg-zinc-800 text-zinc-100 border border-zinc-700/60 rounded-tl-xs'
                    }`}
                  >
                    {renderMessageText(msg.text)}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Floating "New messages ↓" pill */}
      {showScrollBottomPill && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <button
            onClick={() => scrollToBottom(true)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-500 text-zinc-950 text-xs font-semibold shadow-lg hover:bg-sky-400 transition-colors"
          >
            <span>New messages</span>
            <ArrowDown className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Chat Error Notification (e.g. Rate Limit 'Slow down') */}
      {chatError && (
        <div className="px-4 py-1.5 bg-rose-950/60 border-t border-rose-800/60 text-[11px] text-rose-300 font-medium flex items-center justify-between">
          <span>{chatError}</span>
        </div>
      )}

      {/* Input area */}
      <div className="p-3 border-t border-zinc-800 bg-zinc-950/70 shrink-0">
        <form onSubmit={handleSend} className="space-y-1">
          <div className="relative flex items-center">
            <input
              ref={inputRef}
              type="text"
              value={inputText}
              disabled={!isConnected}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={isConnected ? 'Type a message...' : 'Reconnecting...'}
              maxLength={500}
              className="w-full pl-3.5 pr-10 py-2.5 bg-zinc-900 border border-zinc-700/70 rounded-xl text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500 transition-colors disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!inputText.trim() || !isConnected}
              className="absolute right-1.5 p-1.5 rounded-lg bg-sky-500 text-zinc-950 hover:bg-sky-400 disabled:opacity-30 disabled:hover:bg-sky-500 transition-colors"
              title="Send message (Enter)"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] text-zinc-500">
              Messages disappear when the room closes
            </span>
            {inputText.length >= 400 && (
              <span
                className={`text-[10px] font-mono font-medium ${
                  inputText.length >= 490 ? 'text-rose-400 font-bold' : 'text-zinc-400'
                }`}
              >
                {inputText.length}/500
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
