import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare, Video, X } from 'lucide-react';
import { ChatMessage } from '../types/chat';

interface AppNotificationsProps {
  messages: ChatMessage[];
  isChatOpen: boolean;
  onOpenChat: () => void;
  myId?: string;
  incomingCall?: { active: boolean; name: string } | null;
  inCall: boolean;
  onStartCall: () => void;
  onDismissCall: () => void;
}

interface ToastItem {
  id: string;
  type: 'chat' | 'call';
  title: string;
  subtitle?: string;
  senderId?: string;
}

export const AppNotifications: React.FC<AppNotificationsProps> = ({
  messages,
  isChatOpen,
  onOpenChat,
  myId,
  incomingCall,
  inCall,
  onStartCall,
  onDismissCall,
}) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Track latest chat messages for toast alerts
  useEffect(() => {
    if (isChatOpen || messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.kind === 'system' || !lastMsg.senderId) return;
    if (lastMsg.senderId === myId) return;

    const toastId = `msg-${lastMsg.id}`;
    setToasts((prev) => {
      if (prev.some((t) => t.id === toastId)) return prev;
      const newToast: ToastItem = {
        id: toastId,
        type: 'chat',
        title: lastMsg.from || 'New message',
        subtitle: lastMsg.text,
        senderId: lastMsg.senderId,
      };
      return [newToast, ...prev].slice(0, 3);
    });

    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toastId));
    }, 4000);

    return () => clearTimeout(timer);
  }, [messages, isChatOpen, myId]);

  // Handle incoming call toast
  useEffect(() => {
    if (incomingCall && incomingCall.active && !inCall) {
      const callToastId = 'incoming-call-toast';
      setToasts((prev) => {
        if (prev.some((t) => t.id === callToastId)) return prev;
        const callToast: ToastItem = {
          id: callToastId,
          type: 'call',
          title: `${incomingCall.name} started a video call`,
          subtitle: 'Join to chat with camera & microphone',
        };
        return [callToast, ...prev.filter((t) => t.type !== 'call')].slice(0, 3);
      });
    } else {
      setToasts((prev) => prev.filter((t) => t.type !== 'call'));
    }
  }, [incomingCall, inCall]);

  if (toasts.length === 0) return null;

  const content = (
    <div
      className="fixed top-20 right-4 left-4 sm:left-auto sm:right-6 sm:max-w-sm z-[60] flex flex-col gap-2 pointer-events-none"
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          onClick={() => {
            if (toast.type === 'chat') {
              onOpenChat();
              setToasts((prev) => prev.filter((t) => t.id !== toast.id));
            }
          }}
          className={`pointer-events-auto flex items-center justify-between gap-3 p-3 rounded-2xl shadow-2xl backdrop-blur-md border transition-all animate-in slide-in-from-top-2 duration-200 ${
            toast.type === 'call'
              ? 'bg-zinc-950/95 border-emerald-500/70 text-white cursor-default'
              : 'bg-zinc-900/95 border-sky-500/50 text-white cursor-pointer hover:bg-zinc-800/95'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`flex items-center justify-center w-8 h-8 rounded-full shrink-0 ${
                toast.type === 'call'
                  ? 'bg-emerald-500/20 text-emerald-400 relative'
                  : 'bg-sky-500/20 text-sky-400'
              }`}
            >
              {toast.type === 'call' && (
                <span className="absolute w-full h-full rounded-full bg-emerald-400/40 animate-ping" />
              )}
              {toast.type === 'call' ? <Video className="w-4 h-4" /> : <MessageSquare className="w-4 h-4" />}
            </div>
            <div className="text-xs min-w-0">
              <p className="font-semibold truncate">{toast.title}</p>
              {toast.subtitle && (
                <p className="text-[11px] text-zinc-400 truncate mt-0.5">{toast.subtitle}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {toast.type === 'call' ? (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onStartCall();
                  }}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1.5 transition-colors shadow-md min-h-[36px]"
                >
                  <Video className="w-3.5 h-3.5" />
                  <span>Join</span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismissCall();
                    setToasts((prev) => prev.filter((t) => t.id !== toast.id));
                  }}
                  className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-800 transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
                  title="Dismiss"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setToasts((prev) => prev.filter((t) => t.id !== toast.id));
                }}
                className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-800 transition-colors"
                title="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  const targetContainer = document.fullscreenElement || document.body;
  return createPortal(content, targetContainer);
};
