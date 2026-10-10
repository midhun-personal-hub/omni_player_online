import React, { useState } from 'react';
import { X, Download, Copy, Check, Camera } from 'lucide-react';
import { formatTime } from '../utils/formatters';

interface ScreenshotModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string | null;
  videoTitle: string;
  timestamp: number;
}

export const ScreenshotModal: React.FC<ScreenshotModalProps> = ({
  isOpen,
  onClose,
  imageUrl,
  videoTitle,
  timestamp,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen || !imageUrl) return null;

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = imageUrl;
    const cleanName = videoTitle.replace(/\.[^/.]+$/, '');
    a.download = `${cleanName}_snapshot_${formatTime(timestamp).replace(':', '-')}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleCopy = async () => {
    try {
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn('Clipboard write failed:', e);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-semibold text-white">Video Snapshot Captured</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="relative rounded-xl overflow-hidden border border-zinc-800 bg-black flex items-center justify-center max-h-[60vh]">
            <img src={imageUrl} alt="Video Frame Snapshot" className="max-h-[50vh] object-contain w-auto h-auto" />
            <span className="absolute bottom-3 right-3 px-2 py-1 bg-black/70 backdrop-blur-md rounded text-[11px] font-mono text-zinc-300">
              {formatTime(timestamp)}
            </span>
          </div>
        </div>

        <div className="px-6 py-3 bg-zinc-950/40 border-t border-zinc-800 flex items-center justify-between">
          <span className="text-xs text-zinc-400 truncate max-w-[280px]">
            {videoTitle} @ {formatTime(timestamp)}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg bg-sky-500 hover:bg-sky-400 text-zinc-950 font-semibold transition-colors"
            >
              <Download className="w-4 h-4" />
              <span>Download PNG</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
