import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, Send, X } from 'lucide-react';
import { ChatMessage } from '../types/chat';

interface FullscreenChatOverlayProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  isInputOpen: boolean;
  onToggleInput: (open: boolean) => void;
  myId: string;
}

interface TransientMessage {
  msg: ChatMessage;
  addedAt: number;
}

export const FullscreenChatOverlay: React.FC<FullscreenChatOverlayProps> = ({
  messages,
  onSendMessage,
  isInputOpen,
  onToggleInput,
  myId,
}) => {
  const [transientMessages, setTransientMessages] = useState<TransientMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // When new messages arrive, add to transient list
  useEffect(() => {
    if (messages.length === 0) return;
    const latest = messages[messages.length - 1];
    const now = Date.now();

    setTransientMessages((prev) => {
      // Avoid duplicate adding
      if (prev.some((item) => item.msg.id === latest.id)) return prev;
      const updated = [...prev, { msg: latest, addedAt: now }];
      // Keep only last 3
      return updated.slice(-3);
    });
  }, [messages]);

  // Clean up transient messages older than 6 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setTransientMessages((prev) => {
        const filtered = prev.filter((item) => now - item.addedAt < 6000);
        return filtered.length === prev.length ? prev : filtered;
      });
    }, 500);

    return () => clearInterval(timer);
  }, []);

  // Auto-focus input when opened
  useEffect(() => {
    if (isInputOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    } else {
      setInputText('');
    }
  }, [isInputOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = inputText.trim();
    if (!clean) return;
    onSendMessage(clean);
    setInputText('');
    onToggleInput(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onToggleInput(false);
    }
  };

  return (
    <div className="absolute inset-0 pointer-events-none z-30 flex flex-col justify-end p-6 select-none">
      {/* Bottom-left messages container */}
      <div className="flex flex-col gap-2 max-w-sm mb-16 pointer-events-none">
        {transientMessages.map(({ msg, addedAt }) => {
          const age = Date.now() - addedAt;
          const isFading = age > 4500;
          const isMe = Boolean(msg.senderId) && msg.senderId === myId;

          if (msg.kind === 'system' || !msg.senderId) {
            return (
              <div
                key={msg.id}
                className={`self-start px-2.5 py-1 rounded-full bg-black/70 border border-white/10 text-[11px] text-zinc-300 backdrop-blur-md transition-opacity duration-1000 ${
                  isFading ? 'opacity-0' : 'opacity-100'
                }`}
              >
                {msg.text}
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              className={`flex flex-col self-start p-2.5 rounded-xl backdrop-blur-md shadow-2xl transition-opacity duration-1000 max-w-[90%] border ${
                isFading ? 'opacity-0' : 'opacity-100'
              } ${
                isMe
                  ? 'bg-sky-500/90 text-zinc-950 border-sky-400/30'
                  : 'bg-zinc-900/90 text-zinc-100 border-zinc-700/60'
              }`}
            >
              <span
                className={`text-[10px] font-bold leading-none mb-1 truncate ${
                  isMe ? 'text-zinc-900' : 'text-sky-400'
                }`}
              >
                {msg.from}
              </span>
              <span className="text-xs leading-relaxed break-words">{msg.text}</span>
            </div>
          );
        })}

        {/* Floating Fullscreen Chat Input (Opened by 'T' key or button) */}
        {isInputOpen && (
          <form
            onSubmit={handleSubmit}
            className="pointer-events-auto mt-2 flex items-center gap-1.5 p-1.5 rounded-xl bg-zinc-900/95 border border-zinc-700/80 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150"
          >
            <input
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={500}
              placeholder="Chat in fullscreen... (Esc to close)"
              className="px-3 py-1.5 bg-zinc-950/80 border border-zinc-700/60 rounded-lg text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500 w-64"
            />
            <button
              type="submit"
              disabled={!inputText.trim()}
              className="p-1.5 rounded-lg bg-sky-500 text-zinc-950 hover:bg-sky-400 disabled:opacity-40 transition-colors"
              title="Send (Enter)"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onToggleInput(false)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white transition-colors"
              title="Close (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
